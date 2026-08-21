import type { Catalog, TableMeta } from "./catalog.js";
import { GLOBAL_REFERENCE, LumenError, NEVER_WRITABLE_TABLES } from "./config.js";

export type Hop = {
  /** Column on the current table holding the parent reference. */
  column: string;
  refTable: string;
  refColumn: string;
};

export type Ownership =
  | {
      kind: "SCOPED";
      table: string;
      /** Foreign keys traversed. Length 0 means the table carries org_id itself. */
      hops: Hop[];
      /** Table where ownership terminates. */
      orgTable: string;
      /** Column on orgTable holding the org id: "org_id", or "id" for organizations. */
      orgColumn: string;
    }
  | { kind: "UNSCOPED"; table: string };

export type Resolution = {
  ownership: Map<string, Ownership>;
  catalog: Catalog;
};

const MAX_DEPTH = 4;

/**
 * Edges whose parent is the person who acted on the row rather than the thing the
 * row belongs to. A path through one of these is a claim about who touched the row,
 * so it is used only when nothing better exists at the same depth. Any `*_by` or
 * `*_by_*` column is treated this way, plus these.
 */
const WEAK_EDGE_COLUMNS = new Set([
  "assigned_to",
  "owner_id",
  "actor_id",
  "author_user_id",
  "recipient_user_id",
  "viewer_id",
]);

function isWeakEdge(column: string): boolean {
  return WEAK_EDGE_COLUMNS.has(column) || /(^|_)by(_|$)/.test(column);
}

/** A table terminates a path when it carries the org id directly. */
function orgColumnOf(table: TableMeta): string | null {
  if (table.name === "organizations") return "id";
  if (table.columns.has("org_id")) return "org_id";
  return null;
}

/**
 * Lower is better. An actor column is a last resort; a nullable foreign key is a
 * weaker owner than a required one, because a null there makes ownership
 * unprovable and the row unreachable.
 */
function edgePenalty(table: TableMeta, column: string): number {
  let penalty = isWeakEdge(column) ? 100 : 0;
  if (table.columns.get(column)?.isNullable) penalty += 5;
  return penalty;
}

function compareOrdinals(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? -1) - (b[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Breadth-first search from `table` to the nearest table carrying org_id.
 * Shortest path wins; ties break toward structural parents over person columns,
 * then alphabetically so the report is stable across restarts. Depth is capped and
 * visited tables are tracked, so cycles terminate.
 */
function resolveTable(name: string, catalog: Catalog): Ownership {
  const start = catalog.tables.get(name);
  if (!start) return { kind: "UNSCOPED", table: name };

  const startOrgColumn = orgColumnOf(start);
  if (startOrgColumn) {
    return { kind: "SCOPED", table: name, hops: [], orgTable: name, orgColumn: startOrgColumn };
  }

  type Node = { table: string; hops: Hop[]; penalty: number; ordinals: number[] };
  const visited = new Set<string>([name]);
  let frontier: Node[] = [{ table: name, hops: [], penalty: 0, ordinals: [] }];

  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      const meta = catalog.tables.get(node.table);
      if (!meta) continue;
      for (const fk of meta.fks) {
        if (visited.has(fk.refTable)) continue;
        if (!catalog.tables.has(fk.refTable)) continue;
        next.push({
          table: fk.refTable,
          hops: [...node.hops, { column: fk.column, refTable: fk.refTable, refColumn: fk.refColumn }],
          penalty: node.penalty + edgePenalty(meta, fk.column),
          ordinals: [...node.ordinals, meta.columns.get(fk.column)?.ordinal ?? 9999],
        });
      }
    }
    if (next.length === 0) break;

    next.sort(
      (a, b) =>
        a.penalty - b.penalty ||
        compareOrdinals(a.ordinals, b.ordinals) ||
        a.table.localeCompare(b.table),
    );

    for (const node of next) {
      const meta = catalog.tables.get(node.table)!;
      const orgColumn = orgColumnOf(meta);
      if (orgColumn) {
        return {
          kind: "SCOPED",
          table: name,
          hops: node.hops,
          orgTable: node.table,
          orgColumn,
        };
      }
    }

    // Keep only the first arrival at each table so the next level stays shortest-path.
    const level: Node[] = [];
    for (const node of next) {
      if (visited.has(node.table)) continue;
      visited.add(node.table);
      level.push(node);
    }
    frontier = level;
  }

  return { kind: "UNSCOPED", table: name };
}

export function resolveAll(catalog: Catalog): Resolution {
  const ownership = new Map<string, Ownership>();
  for (const name of catalog.tables.keys()) {
    ownership.set(name, resolveTable(name, catalog));
  }
  return { ownership, catalog };
}

/** "deal_id -> deals.org_id", or "template_id -> msp_templates.coach_id -> coaches.org_id". */
export function describePath(o: Ownership): string {
  if (o.kind === "UNSCOPED") return "none";
  if (o.hops.length === 0) return `${o.table}.${o.orgColumn}`;
  const tokens: string[] = [o.hops[0]!.column];
  for (let i = 0; i < o.hops.length; i++) {
    const hop = o.hops[i]!;
    const nextColumn = o.hops[i + 1]?.column ?? o.orgColumn;
    tokens.push(`${hop.refTable}.${nextColumn}`);
  }
  return tokens.join(" -> ");
}

export function isReadable(o: Ownership): boolean {
  if (o.kind === "SCOPED") return true;
  return GLOBAL_REFERENCE.has(o.table);
}

export function isWritable(o: Ownership): boolean {
  if (o.kind !== "SCOPED") return false;
  return !NEVER_WRITABLE_TABLES.has(o.table);
}

export function requireOwnership(res: Resolution, table: string): Ownership {
  const o = res.ownership.get(table);
  if (!o) {
    throw new LumenError(`unknown table ${table}. Call list_tables to see what this server can reach.`);
  }
  return o;
}

/** Startup audit report. stderr only: stdout is the JSON-RPC transport. */
export function printReport(res: Resolution): void {
  const scoped: string[] = [];
  const globals: string[] = [];
  const refused: string[] = [];

  const names = [...res.ownership.keys()].sort();
  for (const name of names) {
    const o = res.ownership.get(name)!;
    if (o.kind === "SCOPED") {
      const write = isWritable(o) ? "rw" : "ro";
      scoped.push(`  ${name}: ${o.hops.length} hops via ${describePath(o)} [${write}]`);
    } else if (GLOBAL_REFERENCE.has(name)) {
      globals.push(`  ${name}: global reference [ro]`);
    } else {
      refused.push(`  ${name}: no ownership path [refused]`);
    }
  }

  console.error("");
  console.error("lumen-mcp v1: ownership resolver report");
  console.error(`  catalog source: ${res.catalog.source}${res.catalog.degraded ? " (degraded: identity/generated/updatable flags unavailable)" : ""}`);
  console.error(`  tables: ${names.length}  scoped: ${scoped.length}  global-reference: ${globals.length}  refused: ${refused.length}`);
  console.error("  hop count = number of foreign keys traversed; 0 means the table carries org_id itself");
  console.error("");
  console.error(`SCOPED (${scoped.length})`);
  for (const line of scoped) console.error(line);
  console.error("");
  console.error(`GLOBAL REFERENCE, read-only (${globals.length})`);
  for (const line of globals) console.error(line);
  console.error("");
  console.error(`UNSCOPED, refused for read and write (${refused.length})`);
  for (const line of refused) console.error(line);
  console.error("");
}
