// Provenance writer — the single write path for every AI-extracted fact.
// Enforces the provenance spine IN CODE (the model proposes; this module
// disposes):
//
//   1. Quote gate     — transcript facts need verbatim quote + speaker;
//                       research facts need a citable URL. No provenance,
//                       no write. The field stays Unknown.
//   2. Speaker rule   — facts about the prospect's business count only when
//                       stated or explicitly confirmed by a prospect-side
//                       speaker. Rep-side assertions without confirmation
//                       are dropped.
//   3. Numeric containment — a numeric value must literally appear in its
//                       quote, or carry a flagged unit conversion with the
//                       arithmetic recorded.
//   4. Manual lock    — manual values are permanent. Automated writes
//                       against them become field_suggestions rows
//                       (suggestion_kind='value_update'), never overwrites.
//   5. Change-aware recency — every accepted write classifies as new_fact /
//                       confirmation (observed_at + reconfirmed bump, value
//                       untouched) / changed_fact (new value wins, prior
//                       demotes to history, qualifying-spine changes emit a
//                       visible deal_change_events row).
//   6. One fact, one home — writes route via the field definition's
//                       storage_target. Everything also lands one
//                       deal_sources ledger row per observation.
//   7. Scores are never written by extraction.
//
// Used by process-transcript (transcript source) and research-company
// (research source). Callers run with the service-role client.

export interface Provenance {
  source: "transcript" | "research" | "manual";
  quote?: string;
  speaker?: string;
  speaker_side?: "prospect" | "rep" | "unknown";
  confirmed_by_prospect?: boolean;   // rep stated + prospect confirmed; quote must include the confirmation
  conversation_id?: string;
  call_type?: string;
  call_date?: string;
  source_url?: string;
  source_title?: string;
  published_date?: string;
  observed_at: string;               // call date or research run date (ISO)
  unit_conversion_note?: string;     // e.g. "3 weeks x 5 business days = 15 days"
}

export interface FactWrite {
  org_id: string;
  deal_id: string;
  field_key: string;
  field_type: string;                // number | text | boolean | multiselect
  storage_target: string | null;     // null => custom_field_values
  field_definition_id?: string | null;
  value: unknown;
  normalized_value?: unknown;
  prov: Provenance;
  pain_point_id?: string | null;
  metric_id?: string | null;
}

export interface WriteResult {
  disposition: "written" | "confirmed" | "suggested" | "rejected" | "skipped";
  classification?: "new_fact" | "confirmation" | "changed_fact";
  reason?: string;
  row_id?: string;
  source_id?: string;
}

// Qualifying-spine facts: material changes surface as visible deal events.
const SPINE_KEYS = new Set([
  "entity_count", "total_users", "reporting_readonly_users", "budget",
  "budget_range", "go_live_target", "decision_timeline", "timeline",
  "compelling_event", "catalyst", "contract_end_date", "fiscal_year_end",
]);

const norm = (s: unknown) => String(s ?? "").trim();
const normLower = (s: unknown) => norm(s).toLowerCase();

// ─── Gates ───────────────────────────────────────────────────────────────────

// Returns a rejection reason, or null when the write passes all gates.
export function gateFact(w: FactWrite): string | null {
  const p = w.prov;
  if (p.source === "transcript") {
    if (!norm(p.quote)) return "quote-gate: transcript write without verbatim quote";
    if (!norm(p.speaker)) return "quote-gate: transcript write without speaker";
    // Speaker discipline: prospect-business facts need prospect-side voice.
    // Unclassifiable speakers default rep-side (protocol step 1).
    const side = p.speaker_side || "unknown";
    if (side !== "prospect" && !p.confirmed_by_prospect) {
      return "speaker-rule: rep-side statement without prospect confirmation";
    }
  } else if (p.source === "research") {
    if (!norm(p.source_url) || !/^https?:\/\//i.test(norm(p.source_url))) {
      return "citation-gate: research write without source URL";
    }
  }
  // Numeric containment: the number must appear in the quote (allowing
  // thousands separators / decimal variants) or carry a conversion note.
  if (w.field_type === "number" && p.source === "transcript") {
    const n = Number(w.normalized_value ?? w.value);
    if (!isFinite(n)) return "numeric-gate: value is not a number";
    if (!numberInQuote(n, p.quote || "") && !norm(p.unit_conversion_note)) {
      return "numeric-gate: number absent from quote and no unit-conversion note";
    }
  }
  // Scores are computed, never extracted.
  if (/_score$/.test(w.field_key) || w.field_key === "score") {
    return "score-gate: extraction may not write scores";
  }
  return null;
}

export function numberInQuote(n: number, quote: string): boolean {
  if (!quote) return false;
  const cleaned = quote.replace(/,/g, "");
  const variants = new Set<string>([
    String(n),
    String(Math.round(n)),
    n.toLocaleString("en-US"),
  ]);
  // "12k" / "1.5m" spoken forms
  if (n >= 1000 && n % 1000 === 0) variants.add(`${n / 1000}k`);
  if (n >= 1_000_000 && n % 1_000_000 === 0) variants.add(`${n / 1_000_000}m`);
  // number words for small counts ("twelve entities")
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  if (Number.isInteger(n) && n >= 0 && n <= 20) variants.add(words[n]);
  const hay = cleaned.toLowerCase();
  for (const v of variants) {
    if (v && hay.includes(String(v).toLowerCase())) return true;
  }
  return false;
}

// ─── deal_sources ledger ─────────────────────────────────────────────────────

export async function writeDealSource(admin: any, w: FactWrite, summary: string): Promise<string | null> {
  try {
    const { data, error } = await admin.from("deal_sources").insert({
      deal_id: w.deal_id,
      source_origin: w.prov.source === "research" ? "research" : w.prov.source === "manual" ? "manual" : "transcript",
      field_category: w.storage_target ? w.storage_target.split(".")[0] : "custom_field",
      field_name: w.field_key,
      summary: summary.slice(0, 500),
      source_url: w.prov.source_url || null,
      source_title: w.prov.source_title || null,
      published_date: w.prov.published_date || null,
      accessed_at: w.prov.source === "research" ? new Date().toISOString() : null,
      conversation_id: w.prov.conversation_id || null,
      speaker: w.prov.speaker || null,
      quote: w.prov.quote || null,
      call_date: w.prov.call_date || null,
      call_type: w.prov.call_type || null,
    }).select("id").single();
    if (error) {
      console.error("provenance-writer: deal_sources insert failed:", error.message);
      return null;
    }
    return data.id;
  } catch (e: any) {
    console.error("provenance-writer: deal_sources insert threw:", e?.message);
    return null;
  }
}

// ─── Change classification ───────────────────────────────────────────────────

export function classifyChange(prior: unknown, next: unknown): "new_fact" | "confirmation" | "changed_fact" {
  const a = normLower(prior);
  const b = normLower(next);
  if (!a || a === "unknown" || a === "null") return "new_fact";
  if (a === b) return "confirmation";
  // numeric equivalence ("12" vs "12.0")
  const na = Number(a), nb = Number(b);
  if (isFinite(na) && isFinite(nb) && na === nb) return "confirmation";
  return "changed_fact";
}

async function recordChangeEvent(admin: any, w: FactWrite, oldValue: unknown, oldSource: string | null) {
  if (!SPINE_KEYS.has(w.field_key)) return;
  try {
    await admin.from("deal_change_events").insert({
      org_id: w.org_id,
      deal_id: w.deal_id,
      field_key: w.field_key,
      old_value: norm(oldValue).slice(0, 300) || null,
      new_value: norm(w.normalized_value ?? w.value).slice(0, 300),
      old_source: oldSource,
      new_source: w.prov.source,
      quote: w.prov.quote || null,
      conversation_id: w.prov.conversation_id || null,
      observed_at: w.prov.observed_at,
    });
  } catch (e: any) {
    console.error("provenance-writer: change event insert failed:", e?.message);
  }
}

async function suggestValue(admin: any, w: FactWrite, currentValue: unknown, context: string): Promise<WriteResult> {
  try {
    // Re-suggest only when provenance is new: skip if an open suggestion for
    // this field already proposes the same value.
    const { data: existing } = await admin.from("field_suggestions")
      .select("id, suggested_value")
      .eq("deal_id", w.deal_id).eq("field_key", w.field_key)
      .eq("suggestion_kind", "value_update").eq("status", "open");
    const proposed = JSON.stringify(w.normalized_value ?? w.value);
    if ((existing || []).some((r: any) => JSON.stringify(r.suggested_value) === proposed)) {
      return { disposition: "skipped", reason: "open suggestion with same value exists" };
    }
    const { data, error } = await admin.from("field_suggestions").insert({
      org_id: w.org_id,
      suggestion_kind: "value_update",
      deal_id: w.deal_id,
      field_key: w.field_key,
      entity_table: w.storage_target ? w.storage_target.split(".")[0] : "custom_field_values",
      current_value: currentValue === undefined ? null : JSON.parse(JSON.stringify({ v: currentValue })).v,
      suggested_value: JSON.parse(JSON.stringify({ v: w.normalized_value ?? w.value })).v,
      suggestion_source: w.prov.source,
      provenance: {
        quote: w.prov.quote || null, speaker: w.prov.speaker || null,
        conversation_id: w.prov.conversation_id || null, source_url: w.prov.source_url || null,
        source_title: w.prov.source_title || null, observed_at: w.prov.observed_at,
      },
      conflict_context: context,
      status: "open",
      suggested_field_label: w.field_key,
      suggested_field_type: w.field_type,
      ai_reasoning: context,
    }).select("id").single();
    if (error) return { disposition: "rejected", reason: `suggestion insert failed: ${error.message}` };
    return { disposition: "suggested", row_id: data.id };
  } catch (e: any) {
    return { disposition: "rejected", reason: `suggestion insert threw: ${e?.message}` };
  }
}

// ─── custom_field_values home ────────────────────────────────────────────────

function valueColumns(fieldType: string, value: unknown): Record<string, unknown> {
  const cols: Record<string, unknown> = { value_text: null, value_number: null, value_boolean: null, value_json: null };
  if (fieldType === "number") cols.value_number = Number(value);
  else if (fieldType === "boolean") cols.value_boolean = Boolean(value);
  else if (fieldType === "multiselect") cols.value_json = Array.isArray(value) ? value : [value];
  else cols.value_text = norm(value);
  return cols;
}

function readValue(row: any): unknown {
  if (!row) return null;
  if (row.value_number !== null && row.value_number !== undefined) return row.value_number;
  if (row.value_boolean !== null && row.value_boolean !== undefined) return row.value_boolean;
  if (row.value_json !== null && row.value_json !== undefined) return row.value_json;
  return row.value_text;
}

async function writeCustomField(admin: any, w: FactWrite): Promise<WriteResult> {
  const { data: existing } = await admin.from("custom_field_values")
    .select("*")
    .eq("entity_type", "deal").eq("entity_id", w.deal_id).eq("field_key", w.field_key)
    .maybeSingle();

  const current = readValue(existing);
  const next = w.normalized_value ?? w.value;

  // Manual lock: locked rows or human-sourced rows never get overwritten.
  if (existing && (existing.is_manual_locked || existing.source === "manual")) {
    const cls = classifyChange(current, next);
    if (cls === "confirmation") {
      // Same value re-observed: harmless metadata bump, value untouched.
      try {
        await admin.from("custom_field_values").update({ observed_at: w.prov.observed_at }).eq("id", existing.id);
      } catch (_) { /* non-fatal */ }
      return { disposition: "confirmed", classification: "confirmation", row_id: existing.id };
    }
    return await suggestValue(admin, w, current, `Manual value conflicts with newer ${w.prov.source} observation`);
  }

  if (!existing) {
    const sourceId = await writeDealSource(admin, w, `${w.field_key} = ${norm(next)}`);
    const { data, error } = await admin.from("custom_field_values").insert({
      org_id: w.org_id,
      field_definition_id: w.field_definition_id || null,
      entity_type: "deal",
      entity_id: w.deal_id,
      field_key: w.field_key,
      ...valueColumns(w.field_type, next),
      source: w.prov.source === "transcript" ? "transcript" : w.prov.source,
      source_conversation_id: w.prov.conversation_id || null,
      extraction_quote: w.prov.quote || null,
      extraction_speaker: w.prov.speaker || null,
      observed_at: w.prov.observed_at,
      pain_point_id: w.pain_point_id || null,
      metric_id: w.metric_id || null,
    }).select("id").single();
    if (error) return { disposition: "rejected", reason: `insert failed: ${error.message}` };
    return { disposition: "written", classification: "new_fact", row_id: data.id, source_id: sourceId || undefined };
  }

  const cls = classifyChange(current, next);
  if (cls === "confirmation") {
    const sourceId = await writeDealSource(admin, w, `${w.field_key} reconfirmed = ${norm(next)}`);
    try {
      await admin.from("custom_field_values").update({ observed_at: w.prov.observed_at }).eq("id", existing.id);
    } catch (_) { /* non-fatal */ }
    return { disposition: "confirmed", classification: "confirmation", row_id: existing.id, source_id: sourceId || undefined };
  }

  // changed_fact: most recent automated observation wins; prior demotes to history.
  // Recency check: never let an OLDER observation overwrite a newer one.
  if (existing.observed_at && new Date(w.prov.observed_at).getTime() < new Date(existing.observed_at).getTime()) {
    return { disposition: "skipped", reason: "older observation than current value" };
  }
  const sourceId = await writeDealSource(admin, w, `${w.field_key}: ${norm(current)} -> ${norm(next)}`);
  try {
    await admin.from("custom_field_value_history").insert({
      field_value_id: existing.id,
      org_id: w.org_id,
      entity_type: "deal",
      entity_id: w.deal_id,
      field_key: w.field_key,
      old_value_json: { value: current, source: existing.source, observed_at: existing.observed_at },
      new_value_json: { value: next, source: w.prov.source, observed_at: w.prov.observed_at },
      change_source: w.prov.source,
      change_reason: "change-aware recency: newer observation",
    });
  } catch (e: any) {
    console.error("provenance-writer: history insert failed:", e?.message);
  }
  const { error: upErr } = await admin.from("custom_field_values").update({
    ...valueColumns(w.field_type, next),
    source: w.prov.source,
    source_conversation_id: w.prov.conversation_id || null,
    extraction_quote: w.prov.quote || null,
    extraction_speaker: w.prov.speaker || null,
    observed_at: w.prov.observed_at,
    previous_value_json: { value: current, source: existing.source },
    pain_point_id: w.pain_point_id || existing.pain_point_id || null,
    metric_id: w.metric_id || existing.metric_id || null,
  }).eq("id", existing.id);
  if (upErr) return { disposition: "rejected", reason: `update failed: ${upErr.message}` };
  await recordChangeEvent(admin, w, current, existing.source);
  return { disposition: "written", classification: "changed_fact", row_id: existing.id, source_id: sourceId || undefined };
}

// ─── deal_sizing home (scalar columns + per-field sources jsonb) ─────────────

async function writeDealSizing(admin: any, w: FactWrite, column: string): Promise<WriteResult> {
  let { data: sizing } = await admin.from("deal_sizing").select("*").eq("deal_id", w.deal_id).maybeSingle();
  if (!sizing) {
    const { data: created, error } = await admin.from("deal_sizing").insert({ deal_id: w.deal_id }).select("*").single();
    if (error) return { disposition: "rejected", reason: `deal_sizing create failed: ${error.message}` };
    sizing = created;
  }
  const fieldMeta = (sizing.sources || {})[column] || {};
  const current = sizing[column];
  const next = Number(w.normalized_value ?? w.value);

  if (fieldMeta.source === "manual") {
    const cls = classifyChange(current, next);
    if (cls === "confirmation") return { disposition: "confirmed", classification: "confirmation", row_id: sizing.id };
    return await suggestValue(admin, w, current, `Manual ${column} conflicts with newer ${w.prov.source} observation`);
  }
  const cls = classifyChange(current, next);
  if (cls === "confirmation") {
    const sourceId = await writeDealSource(admin, w, `${w.field_key} reconfirmed = ${next}`);
    const sources = { ...(sizing.sources || {}), [column]: { ...fieldMeta, observed_at: w.prov.observed_at, reconfirmed: (fieldMeta.reconfirmed || 0) + 1 } };
    try { await admin.from("deal_sizing").update({ sources }).eq("id", sizing.id); } catch (_) { /* non-fatal */ }
    return { disposition: "confirmed", classification: "confirmation", row_id: sizing.id, source_id: sourceId || undefined };
  }
  if (fieldMeta.observed_at && new Date(w.prov.observed_at).getTime() < new Date(fieldMeta.observed_at).getTime()) {
    return { disposition: "skipped", reason: "older observation than current value" };
  }
  const sourceId = await writeDealSource(admin, w, `${w.field_key}: ${norm(current)} -> ${next}`);
  const sources = {
    ...(sizing.sources || {}),
    [column]: {
      source: w.prov.source, quote: w.prov.quote || null, speaker: w.prov.speaker || null,
      conversation_id: w.prov.conversation_id || null, source_url: w.prov.source_url || null,
      observed_at: w.prov.observed_at, prior: current === null || current === undefined ? null : { value: current, ...fieldMeta },
    },
  };
  const { error } = await admin.from("deal_sizing").update({ [column]: next, sources }).eq("id", sizing.id);
  if (error) return { disposition: "rejected", reason: `deal_sizing update failed: ${error.message}` };
  await recordChangeEvent(admin, w, current, fieldMeta.source || null);
  return {
    disposition: "written",
    classification: cls === "new_fact" ? "new_fact" : "changed_fact",
    row_id: sizing.id,
    source_id: sourceId || undefined,
  };
}

// ─── deal_analysis.<col> home (ideal_solution etc.) ──────────────────────────

async function writeDealAnalysisField(admin: any, w: FactWrite, column: string): Promise<WriteResult> {
  const { data: da } = await admin.from("deal_analysis").select(`id, ${column}`).eq("deal_id", w.deal_id).maybeSingle();
  if (!da) return { disposition: "rejected", reason: "deal_analysis row missing" };
  const current = (da as any)[column];
  const next = norm(w.normalized_value ?? w.value);
  const cls = classifyChange(current, next);
  if (cls === "confirmation") {
    return { disposition: "confirmed", classification: "confirmation", row_id: da.id };
  }
  // deal_analysis has no per-column source tracking: treat any existing
  // non-Unknown value as potentially human -> suggest instead of overwrite
  // (Manual-is-permanent, conservatively applied).
  if (cls === "changed_fact") {
    return await suggestValue(admin, w, current, `Existing ${column} differs from newer ${w.prov.source} observation`);
  }
  const sourceId = await writeDealSource(admin, w, `${w.field_key} = ${next.slice(0, 120)}`);
  const { error } = await admin.from("deal_analysis").update({ [column]: next }).eq("id", da.id);
  if (error) return { disposition: "rejected", reason: `deal_analysis update failed: ${error.message}` };
  return { disposition: "written", classification: "new_fact", row_id: da.id, source_id: sourceId || undefined };
}

// ─── Router ──────────────────────────────────────────────────────────────────

// company_systems / deal_pain_points / business_catalysts routes are handled
// by the entity dedup path in process-transcript (match-before-insert), not
// here — this router covers scalar fact homes.
export async function writeFact(admin: any, w: FactWrite): Promise<WriteResult> {
  const rejection = gateFact(w);
  if (rejection) return { disposition: "rejected", reason: rejection };

  const target = w.storage_target || "custom_field_values";
  if (target === "custom_field_values") return await writeCustomField(admin, w);
  if (target.startsWith("deal_sizing.")) return await writeDealSizing(admin, w, target.split(".")[1]);
  if (target.startsWith("deal_analysis.")) return await writeDealAnalysisField(admin, w, target.split(".")[1]);
  return { disposition: "rejected", reason: `unroutable storage_target: ${target}` };
}
