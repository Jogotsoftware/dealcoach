import type { SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./config.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MutationRecord = {
  table: string;
  rowId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
};

/**
 * Writes the mutation to audit_log. That table has no `source` column, so the
 * source is carried as actor_role = 'mcp' plus the tool name in reason/diff.
 * audit_log_action_check only admits created/updated/deleted/status_changed/
 * shared/archived/restored, so action uses those verbs, not the tool names.
 * Returns a warning string when the audit write fails: a silent audit gap is
 * worse than a noisy one.
 */
export async function logMutation(
  supabase: SupabaseClient,
  cfg: Config,
  record: MutationRecord,
): Promise<string | null> {
  const row = {
    org_id: cfg.orgId,
    actor_id: cfg.userId,
    actor_role: "mcp",
    entity_table: record.table,
    entity_id: UUID_RE.test(record.rowId) ? record.rowId : null,
    action: "updated",
    before_state: { [record.field]: record.oldValue ?? null },
    after_state: { [record.field]: record.newValue ?? null },
    diff: {
      tool: "update_field",
      row_id: record.rowId,
      field: record.field,
      old: record.oldValue ?? null,
      new: record.newValue ?? null,
    },
    reason: "lumen-mcp update_field",
  };

  try {
    const { error } = await supabase.from("audit_log").insert(row);
    if (error) return `audit_log write failed: ${error.message}`;
    return null;
  } catch (err) {
    return `audit_log write failed: ${String(err)}`;
  }
}

export type CreateRecord = {
  table: string;
  rowId: string;
  row: Record<string, unknown>;
};

/** Records a create_row insert. Same shape as logMutation: a silent audit gap is worse than a noisy one. */
export async function logCreate(
  supabase: SupabaseClient,
  cfg: Config,
  record: CreateRecord,
): Promise<string | null> {
  const row = {
    org_id: cfg.orgId,
    actor_id: cfg.userId,
    actor_role: "mcp",
    entity_table: record.table,
    entity_id: UUID_RE.test(record.rowId) ? record.rowId : null,
    action: "created",
    before_state: {},
    after_state: record.row,
    diff: { tool: "create_row", row_id: record.rowId },
    reason: "lumen-mcp create_row",
  };

  try {
    const { error } = await supabase.from("audit_log").insert(row);
    if (error) return `audit_log write failed: ${error.message}`;
    return null;
  } catch (err) {
    return `audit_log write failed: ${String(err)}`;
  }
}
