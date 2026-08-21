import type { SupabaseClient } from "@supabase/supabase-js";
import { LumenError, type Config } from "./config.js";

export type ColumnMeta = {
  name: string;
  /** Declaration order. Used to pick a row's structural parent when several
   *  foreign keys reach org_id at the same depth: the parent is declared first. */
  ordinal: number;
  dataType: string;
  isNullable: boolean;
  isIdentity: boolean;
  isGenerated: boolean;
  isUpdatable: boolean;
  hasDefault: boolean;
};

export type FkEdge = {
  column: string;
  refTable: string;
  refColumn: string;
};

export type TableMeta = {
  name: string;
  columns: Map<string, ColumnMeta>;
  pk: string[];
  fks: FkEdge[];
  /** Columns that are the local side of a foreign key. Never writable. */
  fkColumns: Set<string>;
};

export type CatalogSource = "rpc" | "openapi";

export type Catalog = {
  source: CatalogSource;
  /** True when the source cannot report identity/generated/updatable flags. */
  degraded: boolean;
  tables: Map<string, TableMeta>;
};

type RpcColumn = {
  name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  is_identity: string;
  is_generated: string;
  is_updatable: string;
  has_default: boolean;
};

type RpcTable = {
  name: string;
  columns: RpcColumn[];
  pk: string[];
  fks: { column: string; ref_table: string; ref_column: string }[];
};

function buildTable(
  name: string,
  columns: ColumnMeta[],
  pk: string[],
  fks: FkEdge[],
): TableMeta {
  return {
    name,
    columns: new Map(columns.map((c) => [c.name, c])),
    pk,
    fks,
    fkColumns: new Set(fks.map((f) => f.column)),
  };
}

/** Exported so the resolver can be exercised against a catalog snapshot offline. */
export function catalogFromRpcPayload(payload: unknown): Catalog | null {
  const rpcTables = (payload as { tables?: RpcTable[] } | null)?.tables;
  if (!Array.isArray(rpcTables) || rpcTables.length === 0) return null;

  const tables = new Map<string, TableMeta>();
  for (const t of rpcTables) {
    const columns: ColumnMeta[] = (t.columns ?? []).map((c, i) => ({
      name: c.name,
      ordinal: i,
      dataType: (c.data_type === "ARRAY" ? c.udt_name : c.data_type) ?? "text",
      isNullable: c.is_nullable === "YES",
      isIdentity: c.is_identity === "YES",
      isGenerated: c.is_generated !== "NEVER",
      isUpdatable: c.is_updatable !== "NO",
      hasDefault: Boolean(c.has_default),
    }));
    const fks: FkEdge[] = (t.fks ?? []).map((f) => ({
      column: f.column,
      refTable: f.ref_table,
      refColumn: f.ref_column,
    }));
    tables.set(t.name, buildTable(t.name, columns, t.pk ?? [], fks));
  }

  return { source: "rpc", degraded: false, tables };
}

async function loadFromRpc(supabase: SupabaseClient): Promise<Catalog | null> {
  try {
    const { data, error } = await supabase.rpc("lumen_mcp_catalog");
    if (error) return null;
    return catalogFromRpcPayload(data);
  } catch {
    return null;
  }
}

type SwaggerProperty = {
  type?: string;
  format?: string;
  description?: string;
  items?: { type?: string; format?: string };
};

type SwaggerDefinition = {
  required?: string[];
  properties?: Record<string, SwaggerProperty>;
};

const FK_RE = /<fk table='([^']+)' column='([^']+)'\/>/;
const PK_RE = /<pk\/>/;

/**
 * PostgREST publishes the exposed schema as a Swagger 2.0 document at the REST
 * root, including primary-key and foreign-key annotations in each property's
 * description. That is enough to derive the ownership graph without any DDL.
 * It cannot report identity/generated/updatable flags, hence degraded = true.
 */
async function loadFromOpenApi(cfg: Config): Promise<Catalog> {
  let res: Response;
  try {
    res = await fetch(`${cfg.supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: cfg.serviceRoleKey,
        Authorization: `Bearer ${cfg.serviceRoleKey}`,
        Accept: "application/openapi+json",
      },
    });
  } catch (err) {
    throw new LumenError(
      `could not read the schema. The lumen_mcp_catalog RPC is absent and the PostgREST OpenAPI request failed: ${String(err)}`,
    );
  }

  if (!res.ok) {
    throw new LumenError(
      `could not read the schema. The lumen_mcp_catalog RPC is absent and the PostgREST OpenAPI request returned HTTP ${res.status}. Apply supabase/migrations/*_lumen_mcp_catalog.sql, or check that SUPABASE_SERVICE_ROLE_KEY is a secret key.`,
    );
  }

  const doc = (await res.json()) as {
    definitions?: Record<string, SwaggerDefinition>;
  };
  const defs = doc.definitions ?? {};
  const tables = new Map<string, TableMeta>();

  for (const [name, def] of Object.entries(defs)) {
    const required = new Set(def.required ?? []);
    const columns: ColumnMeta[] = [];
    const pk: string[] = [];
    const fks: FkEdge[] = [];
    let ordinal = 0;

    for (const [colName, prop] of Object.entries(def.properties ?? {})) {
      const description = prop.description ?? "";
      if (PK_RE.test(description)) pk.push(colName);
      const fkMatch = FK_RE.exec(description);
      if (fkMatch?.[1] && fkMatch[2]) {
        fks.push({ column: colName, refTable: fkMatch[1], refColumn: fkMatch[2] });
      }
      const dataType =
        prop.format ?? (prop.type === "array" ? `${prop.items?.format ?? "text"}[]` : prop.type ?? "text");
      columns.push({
        name: colName,
        ordinal: ordinal++,
        dataType,
        isNullable: !required.has(colName),
        isIdentity: false,
        isGenerated: false,
        isUpdatable: true,
        hasDefault: false,
      });
    }

    tables.set(name, buildTable(name, columns, pk, fks));
  }

  if (tables.size === 0) {
    throw new LumenError("the PostgREST OpenAPI document listed no tables");
  }

  return { source: "openapi", degraded: true, tables };
}

/** Prefers the RPC (exact column flags); falls back to OpenAPI when it is absent. */
export async function loadCatalog(supabase: SupabaseClient, cfg: Config): Promise<Catalog> {
  const viaRpc = await loadFromRpc(supabase);
  if (viaRpc) return viaRpc;
  console.error(
    "lumen-mcp v1: lumen_mcp_catalog RPC unavailable, falling back to the PostgREST OpenAPI schema",
  );
  return loadFromOpenApi(cfg);
}
