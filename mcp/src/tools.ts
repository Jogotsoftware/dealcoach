import type { SupabaseClient } from "@supabase/supabase-js";
import { logCreate, logMutation } from "./audit.js";
import { GLOBAL_REFERENCE, IMMUTABLE_COLUMNS, LumenError, NEVER_WRITABLE_TABLES, type Config } from "./config.js";
import { coerceValue, columnWritability } from "./guards.js";
import { describePath, isReadable, isWritable, requireOwnership, type Resolution } from "./resolver.js";
import { allowedFirstHopIds, filterOwnedRows } from "./scoping.js";

type Row = Record<string, unknown>;
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const OVERSAMPLE_CAP = 1000;

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

function renderKeyValues(label: string, row: Row | null): string {
  if (!row) return `${label}: none`;
  const lines = Object.entries(row)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return lines.length > 0 ? `${label}:\n${lines.join("\n")}` : `${label}: none`;
}

async function selectOne(
  supabase: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<Row | null> {
  try {
    const { data, error } = await supabase.from(table).select("*").eq(column, value).limit(2);
    if (error) throw new LumenError(`read failed on ${table}: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length > 1) {
      throw new LumenError(`${column}=${value} matched more than one row on ${table}`);
    }
    return rows[0] ?? null;
  } catch (err) {
    if (err instanceof LumenError) throw err;
    throw new LumenError(`read failed on ${table}: ${String(err)}`);
  }
}

export const TOOL_DEFINITIONS = [
  {
    name: "list_tables",
    description:
      "List every table this server can reach, with the number of foreign keys traversed to reach org_id, the resolved ownership path, and whether the table is readable and writable. Tables with no ownership path are refused for both read and write unless they are global reference data.",
    inputSchema: {
      type: "object",
      properties: {
        contains: {
          type: "string",
          description: "Optional substring filter on the table name.",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "List tables", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "describe_table",
    description:
      "Describe one table: its columns with data types, nullability, and whether each column can be written by update_field.",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string", description: "Table name." } },
      required: ["table"],
      additionalProperties: false,
    },
    annotations: { title: "Describe table", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "find_deal",
    description:
      "Find deals by company name (case-insensitive partial match). Returns id, company name, stage, forecast category, value and target close date. Most work starts here, because child tables are located by deal id.",
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Full or partial company name." },
      },
      required: ["company_name"],
      additionalProperties: false,
    },
    annotations: { title: "Find deal", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "read_deal",
    description:
      "Read one deal as a composed view: the deals row plus its deal_analysis and company_profile, rendered as labelled key/value text.",
    inputSchema: {
      type: "object",
      properties: { deal_id: { type: "string", description: "Deal id (uuid)." } },
      required: ["deal_id"],
      additionalProperties: false,
    },
    annotations: { title: "Read deal", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "query_rows",
    description:
      "Query rows from any readable table with optional equality filters. Organization scoping is applied automatically from the resolved ownership path. Use this to find the row_id that update_field needs.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name." },
        filters: {
          type: "array",
          description: "Equality filters, applied together.",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              value: { type: ["string", "null"] },
            },
            required: ["field", "value"],
            additionalProperties: false,
          },
        },
        limit: {
          type: "integer",
          description: `Maximum rows to return. Default ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT}.`,
          minimum: 1,
          maximum: MAX_LIMIT,
        },
      },
      required: ["table"],
      additionalProperties: false,
    },
    annotations: { title: "Query rows", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "create_row",
    description:
      "Create one row in a writable table. Values are supplied as strings and cast to each column's type; jsonb columns take JSON text. org_id is set automatically and cannot be supplied. Foreign-key columns ARE accepted here (unlike update_field), but every referenced parent row is first verified to belong to this organization by walking its foreign-key chain. Tables owned through a parent (quotes through deal_id, msp_milestones through stage_id) must include that parent column so the new row's organization is provable. Leave id, created_at and defaulted columns out. The created row is read back and the insert is recorded in audit_log. Creating a deal also auto-creates its company_profile and deal_analysis rows via a database trigger.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name." },
        values: {
          type: "object",
          description:
            'Column values as strings, or null for a nullable column. Example: {"company_name": "Acme Robotics", "stage": "qualify"}.',
          additionalProperties: { type: ["string", "null"] },
        },
      },
      required: ["table", "values"],
      additionalProperties: false,
    },
    annotations: {
      title: "Create row",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "update_field",
    description:
      "Set one field on one row. The row's ownership is verified by walking its foreign-key chain to org_id before anything is written. Immutable, generated and foreign-key columns are refused, the value is cast to the column's type, the row is read back, and the change is recorded in audit_log.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name." },
        row_id: { type: "string", description: "Primary key of the row to change." },
        field: { type: "string", description: "Column to set." },
        value: {
          type: ["string", "null"],
          description: "New value as a string, or null to clear a nullable column.",
        },
      },
      required: ["table", "row_id", "field", "value"],
      additionalProperties: false,
    },
    annotations: {
      title: "Update field",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const;

export function createToolHandlers(supabase: SupabaseClient, res: Resolution, cfg: Config) {
  const catalog = res.catalog;

  async function listTables(args: { contains?: string }): Promise<ToolResult> {
    const needle = args.contains?.toLowerCase();
    const lines: string[] = [];
    for (const name of [...res.ownership.keys()].sort()) {
      if (needle && !name.toLowerCase().includes(needle)) continue;
      const o = res.ownership.get(name)!;
      const read = isReadable(o) ? "read" : "refused";
      const write = isWritable(o) ? "write" : "no-write";
      const hops = o.kind === "SCOPED" ? String(o.hops.length) : "-";
      const path = o.kind === "SCOPED" ? describePath(o) : GLOBAL_REFERENCE.has(name) ? "global reference" : "none";
      lines.push(`${name} | hops=${hops} | ${path} | ${read}, ${write}`);
    }
    if (lines.length === 0) return text("No tables matched.");
    return text(
      `hops = foreign keys traversed to reach org_id; 0 means the table carries org_id itself.\n\n${lines.join("\n")}`,
    );
  }

  /**
   * A missing or wrongly-named argument used to surface as a raw TypeError --
   * "Cannot read properties of undefined (reading 'replace')" -- which says
   * nothing about which argument was wanted. Name it instead.
   */
  function requireArg(args: Record<string, unknown> | undefined, name: string, tool: string): string {
    const v = args?.[name];
    if (typeof v !== "string" || v.trim() === "") {
      const got = args && Object.keys(args).length ? Object.keys(args).join(", ") : "none";
      throw new LumenError(`${tool} requires a non-empty "${name}" argument. Received: ${got}.`);
    }
    return v;
  }

  async function describeTable(args: { table: string }): Promise<ToolResult> {
    requireArg(args as Record<string, unknown>, "table", "describe_table");
    const ownership = requireOwnership(res, args.table);
    const meta = catalog.tables.get(args.table)!;
    const header = [
      `table: ${args.table}`,
      `ownership: ${ownership.kind === "SCOPED" ? `${ownership.hops.length} hops via ${describePath(ownership)}` : GLOBAL_REFERENCE.has(args.table) ? "global reference (read-only)" : "none (refused)"}`,
      `primary key: ${meta.pk.length > 0 ? meta.pk.join(", ") : "none"}`,
      `readable: ${isReadable(ownership)}  writable: ${isWritable(ownership)}`,
      "",
      "columns:",
    ];
    const rows = [...meta.columns.values()].map((c) => {
      const verdict = isWritable(ownership)
        ? columnWritability(meta, c.name)
        : ({ writable: false, reason: "table is not writable" } as const);
      const writable = verdict.writable ? "writable" : `read-only (${verdict.reason})`;
      return `  ${c.name}: ${c.dataType}${c.isNullable ? "" : " NOT NULL"} - ${writable}`;
    });
    const footer = catalog.degraded
      ? "\nnote: catalog came from the PostgREST OpenAPI schema, which does not report identity or generated columns. Postgres still rejects such writes."
      : "";
    return text([...header, ...rows].join("\n") + footer);
  }

  async function findDeal(args: { company_name: string }): Promise<ToolResult> {
    const companyName = requireArg(args as Record<string, unknown>, "company_name", "find_deal");
    const pattern = `%${companyName.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    try {
      const { data, error } = await supabase
        .from("deals")
        .select("id, company_name, stage, forecast_category, deal_value, target_close_date")
        .eq("org_id", cfg.orgId)
        .ilike("company_name", pattern)
        .order("company_name")
        .limit(25);
      if (error) throw new LumenError(`find_deal failed: ${error.message}`);
      const rows = (data ?? []) as Row[];
      if (rows.length === 0) return text(`No deals matched "${args.company_name}".`);
      return text(JSON.stringify(rows, null, 2));
    } catch (err) {
      if (err instanceof LumenError) throw err;
      throw new LumenError(`find_deal failed: ${String(err)}`);
    }
  }

  async function readDeal(args: { deal_id: string }): Promise<ToolResult> {
    requireArg(args as Record<string, unknown>, "deal_id", "read_deal");
    const deal = await selectOne(supabase, "deals", "id", args.deal_id);
    if (!deal) throw new LumenError(`deal ${args.deal_id} not found`);
    if (deal.org_id !== cfg.orgId) {
      throw new LumenError(`deal ${args.deal_id} belongs to another organization; refused`);
    }
    const analysis = await selectOne(supabase, "deal_analysis", "deal_id", args.deal_id);
    const profile = await selectOne(supabase, "company_profile", "deal_id", args.deal_id);
    return text(
      [
        renderKeyValues("deal", deal),
        "",
        renderKeyValues("deal_analysis", analysis),
        "",
        renderKeyValues("company_profile", profile),
      ].join("\n"),
    );
  }

  async function queryRows(args: {
    table: string;
    filters?: { field: string; value: string | null }[];
    limit?: number;
  }): Promise<ToolResult> {
    const ownership = requireOwnership(res, args.table);
    if (!isReadable(ownership)) {
      throw new LumenError(
        `no ownership path for table ${args.table}; reads are refused. Only global reference tables may be read without one.`,
      );
    }
    const meta = catalog.tables.get(args.table)!;
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    for (const f of args.filters ?? []) {
      if (!meta.columns.has(f.field)) {
        throw new LumenError(`column ${f.field} does not exist on ${args.table}`);
      }
      if (f.field === "org_id") {
        throw new LumenError("org_id cannot be supplied as a filter; scoping is derived, not selected");
      }
    }

    const applyFilters = (q: any) => {
      let out = q;
      for (const f of args.filters ?? []) {
        out = f.value === null ? out.is(f.field, null) : out.eq(f.field, f.value);
      }
      return out;
    };

    // Global reference tables have no tenant data and no path to scope by.
    if (ownership.kind !== "SCOPED") {
      const { data, error } = await applyFilters(supabase.from(args.table).select("*")).limit(limit);
      if (error) throw new LumenError(`query_rows failed on ${args.table}: ${error.message}`);
      return text(JSON.stringify(data ?? [], null, 2));
    }

    if (ownership.hops.length === 0) {
      try {
        const { data, error } = await applyFilters(
          supabase.from(args.table).select("*").eq(ownership.orgColumn, cfg.orgId),
        ).limit(limit);
        if (error) throw new LumenError(`query_rows failed on ${args.table}: ${error.message}`);
        return text(JSON.stringify(data ?? [], null, 2));
      } catch (err) {
        if (err instanceof LumenError) throw err;
        throw new LumenError(`query_rows failed on ${args.table}: ${String(err)}`);
      }
    }

    const firstHop = ownership.hops[0]!;
    const parentIds = await allowedFirstHopIds(supabase, res, cfg, args.table);

    if (parentIds !== null) {
      if (parentIds.length === 0) return text("[]");
      const collected: Row[] = [];
      for (let i = 0; i < parentIds.length && collected.length < limit; i += 500) {
        const part = parentIds.slice(i, i + 500);
        const { data, error } = await applyFilters(
          supabase.from(args.table).select("*").in(firstHop.column, part),
        ).limit(limit - collected.length);
        if (error) throw new LumenError(`query_rows failed on ${args.table}: ${error.message}`);
        collected.push(...((data ?? []) as Row[]));
      }
      return text(JSON.stringify(collected.slice(0, limit), null, 2));
    }

    // Too many parent ids to push the filter down: fetch a wider page and verify
    // each row against its ownership chain rather than dropping the scope.
    const oversample = Math.min(limit * 10, OVERSAMPLE_CAP);
    const { data, error } = await applyFilters(supabase.from(args.table).select("*")).limit(oversample);
    if (error) throw new LumenError(`query_rows failed on ${args.table}: ${error.message}`);
    const page = (data ?? []) as Row[];
    const owned = await filterOwnedRows(supabase, res, cfg, args.table, page);
    const truncated = page.length === oversample;
    const body = JSON.stringify(owned.slice(0, limit), null, 2);
    return text(
      truncated
        ? `${body}\n\nnote: ${args.table} has too many parent rows to filter in the query, so a page of ${oversample} rows was scanned and verified. Add a filter (for example deal_id) for complete results.`
        : body,
    );
  }

  async function createRow(args: {
    table: string;
    values: Record<string, string | null>;
  }): Promise<ToolResult> {
    // 1. Resolve the table.
    const ownership = requireOwnership(res, args.table);
    if (ownership.kind !== "SCOPED") {
      throw new LumenError(`no ownership path for table ${args.table}; writes are refused`);
    }
    if (NEVER_WRITABLE_TABLES.has(args.table)) {
      throw new LumenError(`table ${args.table} is never writable through this server`);
    }

    const meta = catalog.tables.get(args.table)!;
    if (meta.pk.length !== 1) {
      throw new LumenError(
        `table ${args.table} has ${meta.pk.length === 0 ? "no" : "a composite"} primary key; create_row requires a single generated primary key column`,
      );
    }
    const pkColumn = meta.pk[0]!;

    // 2. Build the payload. Unlike update_field, foreign keys are allowed:
    // setting a parent at birth is not a re-parent. They are verified below.
    const payload: Row = {};
    for (const [key, raw] of Object.entries(args.values ?? {})) {
      const column = meta.columns.get(key);
      if (!column) {
        throw new LumenError(`column ${key} does not exist on ${args.table}`);
      }
      if (key === "org_id") {
        throw new LumenError("org_id cannot be supplied; it is derived from the server's configuration");
      }
      if (IMMUTABLE_COLUMNS.has(key) || meta.pk.includes(key)) {
        throw new LumenError(`${key} cannot be supplied on create; it is set by the database`);
      }
      if (column.isIdentity || column.isGenerated) {
        throw new LumenError(`${key} is ${column.isIdentity ? "an identity" : "a generated"} column and cannot be supplied`);
      }
      payload[key] = coerceValue(column, raw);
    }

    // 3. Ownership. Tables carrying org_id get it injected; deeper tables must
    // arrive with their ownership parent set or the row would be unreachable.
    if (ownership.hops.length === 0) {
      payload[ownership.orgColumn] = cfg.orgId;
    } else {
      const hopColumn = ownership.hops[0]!.column;
      if (payload[hopColumn] === null || payload[hopColumn] === undefined) {
        throw new LumenError(
          `${args.table} is owned through ${describePath(ownership)}; ${hopColumn} is required on create so the new row's organization can be proven`,
        );
      }
    }

    // 4. Every provided foreign key must point at a row this org owns.
    for (const fk of meta.fks) {
      const value = payload[fk.column];
      if (value === null || value === undefined) continue;
      const parentOwnership = res.ownership.get(fk.refTable);
      if (!parentOwnership || parentOwnership.kind !== "SCOPED") {
        if (GLOBAL_REFERENCE.has(fk.refTable)) continue; // reference data has no tenancy
        throw new LumenError(`${fk.column} references ${fk.refTable}, which has no ownership path; refused`);
      }
      if (fk.refTable === "organizations") {
        if (String(value) !== cfg.orgId) {
          throw new LumenError(`${fk.column} must be this server's organization; refused`);
        }
        continue;
      }
      const parent = await selectOne(supabase, fk.refTable, fk.refColumn, String(value));
      if (!parent) {
        throw new LumenError(`${fk.column}=${value} does not match any row in ${fk.refTable}`);
      }
      const owned = await filterOwnedRows(supabase, res, cfg, fk.refTable, [parent]);
      if (owned.length === 0) {
        throw new LumenError(
          `${fk.column}=${value} points at a ${fk.refTable} row that belongs to another organization; refused`,
        );
      }
    }

    // 5. Preflight required columns when the catalog can see defaults, so the
    // error names every missing column at once instead of one Postgres error at a time.
    if (!catalog.degraded) {
      const missing = [...meta.columns.values()]
        .filter((c) => !c.isNullable && !c.hasDefault && !c.isIdentity && !c.isGenerated)
        .filter((c) => c.name !== "org_id" && payload[c.name] === undefined)
        .map((c) => c.name);
      if (missing.length > 0) {
        throw new LumenError(`missing required columns on ${args.table}: ${missing.join(", ")}`);
      }
    }

    // 6. Insert and read back in one statement.
    let inserted: Row;
    try {
      const { data, error } = await supabase.from(args.table).insert(payload).select("*").single();
      if (error) throw new LumenError(`insert failed on ${args.table}: ${error.message}`);
      inserted = data as Row;
    } catch (err) {
      if (err instanceof LumenError) throw err;
      throw new LumenError(`insert failed on ${args.table}: ${String(err)}`);
    }

    // 7. Record the creation.
    const auditWarning = await logCreate(supabase, cfg, {
      table: args.table,
      rowId: String(inserted[pkColumn]),
      row: inserted,
    });

    const lines = [
      `created ${args.table} row ${pkColumn}=${String(inserted[pkColumn])}`,
      `  ownership: ${describePath(ownership)}`,
      renderKeyValues("row", inserted),
    ];
    if (auditWarning) lines.push(`warning: ${auditWarning}`);
    return text(lines.join("\n"));
  }

  async function updateField(args: {
    table: string;
    row_id: string;
    field: string;
    value: string | null;
  }): Promise<ToolResult> {
    // 1. Resolve the table.
    const ownership = requireOwnership(res, args.table);
    if (ownership.kind !== "SCOPED") {
      throw new LumenError(`no ownership path for table ${args.table}; writes are refused`);
    }
    if (NEVER_WRITABLE_TABLES.has(args.table)) {
      throw new LumenError(`table ${args.table} is never writable through this server`);
    }

    const meta = catalog.tables.get(args.table)!;
    if (meta.pk.length !== 1) {
      throw new LumenError(
        `table ${args.table} has ${meta.pk.length === 0 ? "no" : "a composite"} primary key; update_field addresses rows by a single primary key column`,
      );
    }
    const pkColumn = meta.pk[0]!;

    // 2. Verify ownership of this specific row by walking its chain to org_id.
    const row = await selectOne(supabase, args.table, pkColumn, args.row_id);
    if (!row) {
      throw new LumenError(`no row in ${args.table} with ${pkColumn}=${args.row_id}`);
    }
    const owned = await filterOwnedRows(supabase, res, cfg, args.table, [row]);
    if (owned.length === 0) {
      throw new LumenError(
        `row ${args.row_id} in ${args.table} does not belong to this organization (checked via ${describePath(ownership)}); refused`,
      );
    }

    // 3. Check the column is writable.
    const verdict = columnWritability(meta, args.field);
    if (!verdict.writable) {
      throw new LumenError(`cannot write ${args.table}.${args.field}: ${verdict.reason}`);
    }
    const column = meta.columns.get(args.field)!;

    // 4. Cast the value. Throws rather than writing anything on a failed cast.
    const coerced = coerceValue(column, args.value);
    const previous = row[args.field] ?? null;

    // 5. Write, then read back.
    try {
      let update = supabase.from(args.table).update({ [args.field]: coerced }).eq(pkColumn, args.row_id);
      if (ownership.hops.length === 0) update = update.eq(ownership.orgColumn, cfg.orgId);
      const { error } = await update;
      if (error) throw new LumenError(`update failed on ${args.table}.${args.field}: ${error.message}`);
    } catch (err) {
      if (err instanceof LumenError) throw err;
      throw new LumenError(`update failed on ${args.table}.${args.field}: ${String(err)}`);
    }

    const after = await selectOne(supabase, args.table, pkColumn, args.row_id);
    const current = after ? after[args.field] ?? null : null;

    // 6. Record the mutation.
    const auditWarning = await logMutation(supabase, cfg, {
      table: args.table,
      rowId: args.row_id,
      field: args.field,
      oldValue: previous,
      newValue: current,
    });

    const lines = [
      `updated ${args.table}.${args.field} on ${pkColumn}=${args.row_id}`,
      `  before: ${JSON.stringify(previous)}`,
      `  after:  ${JSON.stringify(current)}`,
      `  ownership verified via: ${describePath(ownership)}`,
    ];
    if (auditWarning) lines.push(`  warning: ${auditWarning}`);
    return text(lines.join("\n"));
  }

  return { listTables, describeTable, findDeal, readDeal, queryRows, createRow, updateField };
}
