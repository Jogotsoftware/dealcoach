import type { SupabaseClient } from "@supabase/supabase-js";
import { LumenError, type Config } from "./config.js";
import type { Ownership, Resolution } from "./resolver.js";
import { describePath } from "./resolver.js";

/** Maximum parent ids collected when pushing the org filter into the query. */
const MAX_SCOPE_IDS = 20000;
const PAGE = 1000;
const IN_CHUNK = 500;

type Row = Record<string, unknown>;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function requireScoped(o: Ownership): Extract<Ownership, { kind: "SCOPED" }> {
  if (o.kind !== "SCOPED") {
    throw new LumenError(`no ownership path for table ${o.table}`);
  }
  return o;
}

/**
 * Walks each row forward along its resolved foreign-key chain and keeps only the
 * rows whose terminal org id matches. This is the authoritative ownership check:
 * a row id carries no tenancy information on its own.
 */
export async function filterOwnedRows(
  supabase: SupabaseClient,
  res: Resolution,
  cfg: Config,
  table: string,
  rows: Row[],
): Promise<Row[]> {
  const ownership = requireScoped(res.ownership.get(table) ?? { kind: "UNSCOPED", table });
  if (rows.length === 0) return [];

  if (ownership.hops.length === 0) {
    return rows.filter((r) => r[ownership.orgColumn] === cfg.orgId);
  }

  // Track, per row, the value that carries it to the next table in the chain.
  let carriers: (unknown | null)[] = rows.map((r) => r[ownership.hops[0]!.column] ?? null);

  for (let k = 0; k < ownership.hops.length; k++) {
    const hop = ownership.hops[k]!;
    const nextColumn = ownership.hops[k + 1]?.column ?? ownership.orgColumn;
    const keys = [...new Set(carriers.filter((v) => v !== null && v !== undefined))];
    if (keys.length === 0) {
      carriers = carriers.map(() => null);
      break;
    }

    const lookup = new Map<string, unknown>();
    for (const part of chunk(keys, IN_CHUNK)) {
      try {
        const { data, error } = await supabase
          .from(hop.refTable)
          .select(`${hop.refColumn}, ${nextColumn}`)
          .in(hop.refColumn, part as never[]);
        if (error) {
          throw new LumenError(
            `ownership walk failed at ${hop.refTable} (path ${describePath(ownership)}): ${error.message}`,
          );
        }
        for (const parent of (data ?? []) as unknown as Row[]) {
          lookup.set(String(parent[hop.refColumn]), parent[nextColumn] ?? null);
        }
      } catch (err) {
        if (err instanceof LumenError) throw err;
        throw new LumenError(`ownership walk failed at ${hop.refTable}: ${String(err)}`);
      }
    }

    carriers = carriers.map((v) => (v === null || v === undefined ? null : lookup.get(String(v)) ?? null));
  }

  return rows.filter((_, i) => carriers[i] === cfg.orgId);
}

/**
 * Collects the set of first-hop parent ids belonging to this org, so the filter can
 * be pushed into the query rather than applied after a page has been fetched.
 * Returns null when the set is too large to push down; the caller then falls back
 * to fetching a wider page and verifying it row by row.
 */
export async function allowedFirstHopIds(
  supabase: SupabaseClient,
  res: Resolution,
  cfg: Config,
  table: string,
): Promise<string[] | null> {
  const ownership = requireScoped(res.ownership.get(table) ?? { kind: "UNSCOPED", table });
  if (ownership.hops.length === 0) return null;

  const last = ownership.hops[ownership.hops.length - 1]!;
  let ids = await selectColumn(
    supabase,
    ownership.orgTable,
    last.refColumn,
    (q) => q.eq(ownership.orgColumn, cfg.orgId),
  );
  if (ids === null) return null;

  for (let k = ownership.hops.length - 2; k >= 0; k--) {
    const hop = ownership.hops[k]!;
    const childColumn = ownership.hops[k + 1]!.column;
    if (ids.length === 0) return [];
    const next: string[] = [];
    for (const part of chunk(ids, IN_CHUNK)) {
      const page = await selectColumn(supabase, hop.refTable, hop.refColumn, (q) =>
        q.in(childColumn, part as never[]),
      );
      if (page === null) return null;
      next.push(...page);
      if (next.length > MAX_SCOPE_IDS) return null;
    }
    ids = [...new Set(next)];
  }

  return ids;
}

async function selectColumn(
  supabase: SupabaseClient,
  table: string,
  column: string,
  apply: (q: any) => any,
): Promise<string[] | null> {
  const values: string[] = [];
  for (let offset = 0; offset <= MAX_SCOPE_IDS; offset += PAGE) {
    try {
      const { data, error } = await apply(supabase.from(table).select(column)).range(
        offset,
        offset + PAGE - 1,
      );
      if (error) {
        throw new LumenError(`ownership scope query failed on ${table}: ${error.message}`);
      }
      const rows = (data ?? []) as Row[];
      for (const row of rows) {
        const v = row[column];
        if (v !== null && v !== undefined) values.push(String(v));
      }
      if (rows.length < PAGE) return values;
      if (values.length > MAX_SCOPE_IDS) return null;
    } catch (err) {
      if (err instanceof LumenError) throw err;
      throw new LumenError(`ownership scope query failed on ${table}: ${String(err)}`);
    }
  }
  return null;
}
