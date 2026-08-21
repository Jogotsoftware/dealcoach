export const VERSION_TAG = "lumen-mcp v1";

export class LumenError extends Error {
  constructor(message: string) {
    super(`${VERSION_TAG}: ${message}`);
    this.name = "LumenError";
  }
}

export type Config = {
  supabaseUrl: string;
  serviceRoleKey: string;
  orgId: string;
  userId: string;
};

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LUMEN_ORG_ID",
  "LUMEN_USER_ID",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads and validates env. Fails fast to stderr rather than starting half-configured. */
export function loadConfig(): Config {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    console.error(`${VERSION_TAG}: missing required environment variables: ${missing.join(", ")}`);
    console.error(`${VERSION_TAG}: set them in the mcpServers entry of claude_desktop_config.json`);
    process.exit(1);
  }

  const orgId = process.env.LUMEN_ORG_ID!.trim();
  const userId = process.env.LUMEN_USER_ID!.trim();
  for (const [name, value] of [
    ["LUMEN_ORG_ID", orgId],
    ["LUMEN_USER_ID", userId],
  ] as const) {
    if (!UUID_RE.test(value)) {
      console.error(`${VERSION_TAG}: ${name} is not a uuid`);
      process.exit(1);
    }
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL!.trim().replace(/\/+$/, ""),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    orgId,
    userId,
  };
}

/**
 * Tables readable despite having no ownership path: genuine global reference data.
 * Never writable. Nothing is added here without confirming the table has no tenant
 * data in it at all.
 */
export const GLOBAL_REFERENCE = new Set([
  "plans",
  "modules",
  "roi_industries",
  "msp_predefined_steps",
  "widget_registry",
  "metric_taxonomy",
  "ai_providers",
  "credit_costs",
  "module_reference",
  "risk_definitions",
  "stage_exit_criteria",
]);

/** Never writable through this server regardless of what the resolver says. */
export const NEVER_WRITABLE_TABLES = new Set(["organizations", "audit_log"]);

/** Columns that are never writable, on any table. */
export const IMMUTABLE_COLUMNS = new Set(["id", "org_id", "created_at"]);
