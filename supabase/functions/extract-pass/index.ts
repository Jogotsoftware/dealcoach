import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { EXTRACTION_PROTOCOL } from "../_shared/extraction-protocol.ts";
import { writeFact, gateFact, numberInQuote, writeDealSource, type FactWrite } from "../_shared/provenance-writer.ts";

// extract-pass v1
// The catalog-driven, concept-matched extraction engine (overhaul Phase 4).
// Runs per transcript AFTER process-transcript (fired by the import paths),
// or standalone via { conversation_id, reuse_raw: true } to re-run the
// parse+write stage from the stored raw response without burning credits.
//
// Trigger matrix: full pass (catalog fields + entities + metrics +
// hypotheses) on qdc / functional_discovery / scoping / demo; light pass
// (entities + metrics + hypotheses only) on sync / custom / everything else.
//
// Every write goes through the provenance gates: quote+speaker (verbatim),
// prospect-side speaker discipline, numeric containment, manual-lock ->
// suggestion, change-aware recency. The model proposes; this function
// disposes. Entity dedup is match-before-insert: the model receives every
// existing row inline and must return match_existing_id for same-entity
// candidates (ids are verified server-side; hallucinated ids insert as new
// with possible_duplicate_of cleared).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FULL_PASS_TYPES = new Set(["qdc", "functional_discovery", "scoping", "demo"]);

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function jr(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), "Content-Type": "application/json" } });
}

async function claude(body: any): Promise<Response> {
  for (let i = 1; i <= 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (r.ok) return r;
    if ([429, 500, 503, 529].includes(r.status)) { await new Promise((res) => setTimeout(res, 2000 * Math.pow(2, i))); continue; }
    return r;
  }
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
}

// Fuzzy natural-key match (server-side belt over the model's match ids).
function fuzzyName(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9 ]+/g, "").trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9 ]+/g, "").trim();
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

const OUTPUT_CONTRACT = `Return ONLY JSON matching:
{
 "speaker_map": {"<label-in-transcript>": {"name": "person or role if known", "side": "prospect|rep|unknown"}},
 "fields": [
   {"field_key": "from the catalog", "status": "found|partial|not_applicable",
    "value": "raw value as stated", "normalized_value": "per the field's normalization rule",
    "quote": "VERBATIM transcript text containing the fact (include the prospect confirmation when the rep stated it)",
    "speaker": "speaker label/name", "speaker_side": "prospect|rep",
    "confirmed_by_prospect": false,
    "unit_conversion_note": "arithmetic when normalized differs from spoken (e.g. '3 weeks x 5 business days = 15 days') or null",
    "partial_reason": "only when status=partial: what is still unknown",
    "pain_link": {"match_existing_id": "existing pain id or null", "propose_description": "new pain statement or null"}
   }],
 "entities": {
   "pain_points": [{"match_existing_id": "id or null", "possible_duplicate_of": "id when borderline or null", "description": "", "category": "financial|operational|compliance|growth|competitive|technology|personnel", "quote": "", "speaker": "", "speaker_side": "prospect|rep", "annual_cost": null, "annual_hours": null, "quantification_quote": "quote containing the numbers or null"}],
   "compelling_events": [{"match_existing_id": null, "description": "", "event_date": "YYYY-MM-DD or null", "strength": "strong|medium|weak", "impact": "", "quote": "", "speaker": "", "speaker_side": ""}],
   "business_catalysts": [{"match_existing_id": null, "catalyst": "", "category": "", "urgency": "high|medium|low", "impact": "high|medium|low", "quote": "", "speaker": "", "speaker_side": ""}],
   "decision_criteria": [{"match_existing_id": null, "criterion": "", "importance": "high|medium|low", "quote": "", "speaker": "", "speaker_side": ""}],
   "company_systems": [{"match_existing_id": null, "system_category": "accounting|billing_invoicing|crm|project_management|inventory|payroll|expenses|fpa|front_end_operational|banks_credit_cards|other", "system_name": "", "relationship": "current|competitor|prior|evaluating|complementary", "is_current": true, "is_needed": false, "integration_purpose": null, "quote": "", "speaker": "", "speaker_side": ""}],
   "risks_stated": [{"risk_key": "from the risk taxonomy or null", "description": "", "severity": "critical|high|medium|low", "quote": "", "speaker": "", "speaker_side": ""}]
 },
 "metrics": [{"metric_key": "taxonomy key or null", "label": "prospect's own term", "value": 0, "unit": "", "period": "month|year|event|point_in_time", "quote": "", "speaker": "", "speaker_side": ""}],
 "hypotheses": [{"hypothesis_type": "red_flag|green_flag", "hypothesis": "", "reasoning": "", "confidence": "high|medium|low"}]
}
HARD RULES (server enforces; violations are dropped):
- Quotes are VERBATIM from the transcript. Never paraphrase inside "quote".
- Facts about the prospect's business need a prospect-side speaker, or a quote containing BOTH the rep statement AND the prospect confirmation with confirmed_by_prospect=true.
- Numbers must appear in their quote, or include unit_conversion_note with the arithmetic.
- A field is found whenever its definition + signals match a prospect statement, regardless of what question preceded it. Never condition on the scripted question having been asked.
- match_existing_id: when a candidate is the SAME real-world thing as an existing row shown to you, return that row's id instead of describing it as new. Borderline -> new row + possible_duplicate_of.
- Every quantified business statement by a prospect-side speaker belongs in metrics[], even when no catalog field matches.
- Suspicions / pattern-reasoning (title implies role, industry patterns) go ONLY in hypotheses[].
- company_systems.relationship classifies how the prospect relates to each system, NOT every tool named on the call: current = they run it today; prior = they used it in the past / migrated off it; competitor = a vendor competing with us (e.g. the incumbent ERP we'd replace, or an alternative they're weighing AGAINST us); evaluating = a complementary tool they're considering alongside us; complementary = an adjacent tool that would integrate. Only relationship=current is their tech stack. Do not mark a system current unless the prospect says they actually use it now.
- status=partial when an answer is touched but incomplete; never guess values.
- Gated-off sections (inventory_type=services_only kills inventory fields, no projects kills project fields, uses_allocations=false kills allocation detail) -> status=not_applicable.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const conversationId = body.conversation_id;
    const reuseRaw = body.reuse_raw === true;
    if (!conversationId) return jr({ error: "extract-pass v1: conversation_id missing" }, 400);

    const { data: conv, error: convErr } = await sb.from("conversations").select("*").eq("id", conversationId).single();
    if (convErr || !conv) return jr({ error: "extract-pass v1: conversation not found" }, 404);
    if (!conv.transcript || conv.transcript.length < 100) return jr({ error: "extract-pass v1: transcript too short" }, 422);

    const { data: deal } = await sb.from("deals").select("id, org_id, rep_id, company_name, stage").eq("id", conv.deal_id).single();
    if (!deal) return jr({ error: "extract-pass v1: deal not found" }, 404);
    const orgId = deal.org_id;

    // Auth: service-role bearer (internal chain), the vault-backed cron
    // secret, or a user JWT whose org owns the deal. verify_jwt is false
    // platform-wide, so this is the gate.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!isCron && token !== SERVICE_KEY) {
      if (!token) return jr({ error: "extract-pass v1: missing authorization" }, 401);
      const { data: u, error: uErr } = await sb.auth.getUser(token);
      if (uErr || !u?.user) return jr({ error: "extract-pass v1: invalid token" }, 401);
      const { data: prof } = await sb.from("profiles").select("org_id").eq("id", u.user.id).single();
      if (!prof || prof.org_id !== orgId) return jr({ error: "extract-pass v1: not your org" }, 403);
    }

    const fullPass = FULL_PASS_TYPES.has(conv.call_type);
    const observedAt = conv.call_date ? new Date(conv.call_date).toISOString() : new Date(conv.created_at).toISOString();

    // ── Load context: catalog + current state + existing entities ──
    const [defsRes, valuesRes, sizingRes, painsRes, cesRes, catsRes, critsRes, sysRes, risksRes, taxonomyRes, riskDefsRes, entityDefsRes] = await Promise.all([
      sb.from("custom_field_definitions").select("id, field_key, field_label, field_type, display_section, ai_context, extraction_instructions, extraction_signals, negative_signals, storage_target, org_id")
        .eq("entity_type", "deal").eq("is_active", true).or(`org_id.eq.${orgId},org_id.is.null`),
      sb.from("custom_field_values").select("field_key, value_text, value_number, value_boolean, value_json, source, observed_at, is_manual_locked")
        .eq("entity_type", "deal").eq("entity_id", deal.id),
      sb.from("deal_sizing").select("*").eq("deal_id", deal.id).maybeSingle(),
      sb.from("deal_pain_points").select("id, pain_description, category, annual_cost, annual_hours").eq("deal_id", deal.id),
      sb.from("compelling_events").select("id, event_description, event_date, strength").eq("deal_id", deal.id),
      sb.from("business_catalysts").select("id, catalyst, category, urgency, impact").eq("deal_id", deal.id),
      sb.from("deal_decision_criteria").select("id, criterion, importance").eq("deal_id", deal.id),
      sb.from("company_systems").select("id, system_category, system_name, is_current, is_needed").eq("deal_id", deal.id),
      sb.from("deal_risks").select("id, risk_key, risk_description, status").eq("deal_id", deal.id).eq("status", "open"),
      sb.from("metric_taxonomy").select("metric_key, name, definition, unit_normalization, signals").eq("active", true),
      sb.from("risk_definitions").select("risk_key, plain_name, definition, evidence_signals, evidence_types").eq("active", true),
      sb.from("extraction_definitions").select("entity_type, canonical_definition, anti_patterns, grammar, good_examples, bad_examples")
        .eq("active", true).or(`org_id.eq.${orgId},org_id.is.null`),
    ]);

    // Org definitions override template ones on the same field_key.
    const defsByKey = new Map<string, any>();
    for (const d of (defsRes.data || [])) {
      const prior = defsByKey.get(d.field_key);
      if (!prior || (prior.org_id === null && d.org_id !== null)) defsByKey.set(d.field_key, d);
    }
    const valuesByKey = new Map<string, any>();
    for (const v of (valuesRes.data || [])) valuesByKey.set(v.field_key, v);
    const sizing = sizingRes.data || null;

    const readCurrent = (def: any): { value: unknown; source: string | null; locked: boolean } => {
      if (def.storage_target?.startsWith("deal_sizing.")) {
        const col = def.storage_target.split(".")[1];
        const meta = sizing?.sources?.[col] || {};
        return { value: sizing?.[col] ?? null, source: meta.source || null, locked: meta.source === "manual" };
      }
      const v = valuesByKey.get(def.field_key);
      if (!v) return { value: null, source: null, locked: false };
      const value = v.value_number ?? v.value_boolean ?? v.value_json ?? v.value_text;
      return { value, source: v.source, locked: !!v.is_manual_locked || v.source === "manual" };
    };

    // ── Build the prompt ──
    const sections: string[] = [EXTRACTION_PROTOCOL];

    sections.push("\nENTITY DEFINITIONS (canonical; match-before-insert):");
    for (const e of (entityDefsRes.data || [])) {
      sections.push(`- ${e.entity_type}: ${e.canonical_definition}\n  anti-patterns: ${JSON.stringify(e.anti_patterns)}\n  rules: ${JSON.stringify(e.grammar)}`);
    }

    sections.push("\nRISK TAXONOMY (stated risks only — quote-backed; use risk_key):");
    for (const r of (riskDefsRes.data || [])) {
      if ((r.evidence_types || []).includes("stated")) sections.push(`- ${r.risk_key}: ${r.plain_name}. ${r.definition || ""}`);
    }

    sections.push("\nMETRIC TAXONOMY (map quantified statements when unambiguous):");
    for (const m of (taxonomyRes.data || [])) {
      sections.push(`- ${m.metric_key}: ${m.name}. ${m.unit_normalization || ""} signals: ${m.signals || ""}`);
    }

    if (fullPass) {
      sections.push("\nFIELD CATALOG (concept-matched; current values shown — classify each found fact as new/confirm/change):");
      const bySection = new Map<string, any[]>();
      for (const def of defsByKey.values()) {
        const arr = bySection.get(def.display_section) || [];
        arr.push(def);
        bySection.set(def.display_section, arr);
      }
      for (const [section, defs] of bySection) {
        sections.push(`\n[${section}]`);
        for (const def of defs) {
          const cur = readCurrent(def);
          const curStr = cur.value === null || cur.value === undefined || cur.value === "" ? "Unknown" : `${JSON.stringify(cur.value)} (source=${cur.source || "?"}${cur.locked ? ", MANUAL-LOCKED" : ""})`;
          sections.push(
            `* ${def.field_key} (${def.field_type}) — ${def.field_label}\n` +
            `  def: ${def.ai_context || ""}\n` +
            `  signals: ${JSON.stringify(def.extraction_signals || [])} | negative: ${JSON.stringify(def.negative_signals || [])}\n` +
            `  normalize: ${(def.extraction_instructions || "").split("\n")[0]}\n` +
            `  current: ${curStr}`
          );
        }
      }
    } else {
      sections.push("\nLIGHT PASS: skip the field catalog entirely. Extract entities, metrics, stated risks, and hypotheses only (functional facts can surface anywhere, but the full catalog does not run on check-in calls). Return fields: [].");
    }

    const ent = (label: string, rows: any[], fmt: (r: any) => string) =>
      `\n${label} (existing rows for this deal — return match_existing_id for same-entity candidates):\n` +
      (rows.length ? rows.map((r) => `  ${r.id}: ${fmt(r)}`).join("\n") : "  (none)");
    sections.push(ent("EXISTING PAIN POINTS", painsRes.data || [], (r) => `${r.pain_description} [${r.category}]${r.annual_cost ? ` $${r.annual_cost}/yr` : ""}`));
    sections.push(ent("EXISTING COMPELLING EVENTS", cesRes.data || [], (r) => `${r.event_description} (${r.event_date || "undated"}, ${r.strength})`));
    sections.push(ent("EXISTING CATALYSTS", catsRes.data || [], (r) => `${r.catalyst} [${r.category}]`));
    sections.push(ent("EXISTING DECISION CRITERIA", critsRes.data || [], (r) => r.criterion));
    sections.push(ent("EXISTING SYSTEMS", sysRes.data || [], (r) => `${r.system_category}: ${r.system_name}${r.is_current ? " (current)" : ""}`));
    sections.push(ent("EXISTING OPEN RISKS", risksRes.data || [], (r) => `${r.risk_key || "unkeyed"}: ${r.risk_description}`));

    // Granola metadata is CONTEXT-ONLY: AI-generated, never provenance.
    const granola = conv.metadata?.granola;
    if (granola?.summary || granola?.notes || granola?.action_items) {
      sections.push("\nCONTEXT-ONLY (AI-generated meeting notes — may guide attention but can NEVER be quoted as provenance; only the transcript below produces quotes):");
      if (granola.summary) sections.push(`Summary: ${String(granola.summary).slice(0, 1500)}`);
      if (granola.action_items) sections.push(`Action items: ${JSON.stringify(granola.action_items).slice(0, 800)}`);
    }

    sections.push(`\nCALL: type=${conv.call_type}, date=${conv.call_date}, company=${deal.company_name}`);
    sections.push(`\nTRANSCRIPT (the ONLY source of quotes):\n${conv.transcript}`);
    sections.push(`\n${OUTPUT_CONTRACT}`);
    const prompt = sections.join("\n");

    // ── Get the raw response: fresh Claude call or stored raw ──
    let raw: string | null = null;
    let usage: any = {};
    if (reuseRaw) {
      raw = conv.metadata?.extract_pass?.raw || null;
      if (!raw) return jr({ error: "extract-pass v1: no stored raw response to reuse" }, 404);
    } else {
      // Credit gate (project standard).
      try {
        const { data: credits } = await sb.rpc("check_credits", { p_org_id: orgId, p_required: 1 });
        if (credits && credits.allowed === false) return jr({ error: "extract-pass v1: insufficient credits" }, 402);
      } catch (_) { /* missing RPC tolerated */ }

      if (!ANTHROPIC_API_KEY) return jr({ error: "extract-pass v1: no API key" }, 500);
      const cr = await claude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        temperature: 0,
        system: "You are Lumen's extraction engine. You follow the extraction protocol exactly. You return only JSON.",
        messages: [{ role: "user", content: prompt }],
      });
      if (!cr.ok) return jr({ error: `extract-pass v1: Claude ${cr.status}` }, 502);
      const cd = await cr.json();
      usage = cd.usage || {};
      raw = (cd.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");

      // Persist raw so re-extraction is credit-free.
      try {
        const meta = { ...(conv.metadata || {}), extract_pass: { raw, at: new Date().toISOString(), version: "v1" } };
        await sb.from("conversations").update({ metadata: meta }).eq("id", conversationId);
      } catch (e: any) { console.error("extract-pass v1: raw persist failed:", e?.message); }
    }

    let out: any;
    try {
      const cleaned = (raw || "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no JSON in response");
      out = JSON.parse(m[0]);
    } catch (e: any) {
      return jr({ error: `extract-pass v1: parse failed: ${e?.message}` }, 422);
    }

    const speakerMap: Record<string, any> = out.speaker_map || {};
    const sideOf = (speaker: string, claimed: string | undefined): "prospect" | "rep" | "unknown" => {
      const mapped = speakerMap[speaker]?.side;
      const side = claimed || mapped || "unknown";
      return side === "prospect" ? "prospect" : side === "rep" ? "rep" : "unknown";
    };

    const sum: any = {
      version: "extract-pass v1", pass: fullPass ? "full" : "light", reused_raw: reuseRaw,
      fields: { written: 0, confirmed: 0, suggested: 0, partial: 0, rejected: 0, na: 0 },
      entities: { inserted: 0, enriched: 0, rejected: 0 },
      metrics: 0, hypotheses: 0, risks: 0, tasks: 0,
    };
    const rejections: string[] = [];

    // ── 1. Catalog fields ──
    for (const f of (Array.isArray(out.fields) ? out.fields : [])) {
      if (!f?.field_key) continue;
      const def = defsByKey.get(f.field_key);
      if (!def) { sum.fields.rejected++; rejections.push(`${f.field_key}: unknown field`); continue; }
      if (f.status === "not_applicable") { sum.fields.na++; continue; }
      if (f.status === "partial") {
        // Partial never fills a value: record the observation + follow-up task.
        sum.fields.partial++;
        try {
          await sb.from("tasks").insert({
            deal_id: deal.id, conversation_id: conversationId,
            title: `Clarify: ${def.field_label}`,
            notes: `Partial answer on ${conv.call_type} (${conv.call_date}): "${(f.quote || "").slice(0, 300)}" — ${f.partial_reason || "incomplete"}`,
            priority: "medium", auto_generated: true, source: "extract_pass",
            source_conversation_id: conversationId, metadata: { field_key: f.field_key, kind: "partial_field_followup" },
          });
          sum.tasks++;
        } catch (e: any) { console.error("extract-pass v1: partial task failed:", e?.message); }
        continue;
      }
      if (f.status !== "found") continue;

      // company_systems-routed fields land via the entity path below.
      if (def.storage_target === "company_systems") continue;
      // entity-routed fields (pains/catalysts) also land via entities.
      if (def.storage_target === "deal_pain_points" || def.storage_target === "business_catalysts") continue;

      const w: FactWrite = {
        org_id: orgId, deal_id: deal.id,
        field_key: f.field_key, field_type: def.field_type,
        storage_target: def.storage_target,
        // Template definitions (org_id NULL) are real rows — the FK accepts
        // them; values always reference their definition.
        field_definition_id: def.id,
        value: f.value, normalized_value: f.normalized_value,
        prov: {
          source: "transcript", quote: f.quote, speaker: f.speaker,
          speaker_side: sideOf(f.speaker, f.speaker_side),
          confirmed_by_prospect: !!f.confirmed_by_prospect,
          conversation_id: conversationId, call_type: conv.call_type,
          call_date: conv.call_date, observed_at: observedAt,
          unit_conversion_note: f.unit_conversion_note || undefined,
        },
      };
      // Pain tie-in: quantified answers link or propose pains.
      if (f.pain_link?.match_existing_id && (painsRes.data || []).some((p: any) => p.id === f.pain_link.match_existing_id)) {
        w.pain_point_id = f.pain_link.match_existing_id;
      }
      const r = await writeFact(sb, w);
      if (r.disposition === "written") sum.fields.written++;
      else if (r.disposition === "confirmed") sum.fields.confirmed++;
      else if (r.disposition === "suggested") sum.fields.suggested++;
      else if (r.disposition === "rejected") { sum.fields.rejected++; rejections.push(`${f.field_key}: ${r.reason}`); }
    }

    // ── 2. Entities (match-before-insert) ──
    const ents = out.entities || {};
    const entityGate = (e: any): string | null => {
      if (!e?.quote || !String(e.quote).trim()) return "no quote";
      if (!e?.speaker) return "no speaker";
      const side = sideOf(e.speaker, e.speaker_side);
      if (side !== "prospect" && !e.confirmed_by_prospect) return "rep-side without confirmation";
      return null;
    };
    const realId = (id: unknown, rows: any[]) => (typeof id === "string" && rows.some((r) => r.id === id)) ? id : null;

    async function enrich(table: string, id: string, fieldName: string, summary: string, e: any, extra: Record<string, unknown> = {}) {
      await writeDealSource(sb, {
        org_id: orgId, deal_id: deal.id, field_key: fieldName, field_type: "text",
        storage_target: table, value: summary,
        prov: { source: "transcript", quote: e.quote, speaker: e.speaker, conversation_id: conversationId, call_type: conv.call_type, call_date: conv.call_date, observed_at: observedAt },
      } as FactWrite, summary);
      try {
        const { data: cur } = await sb.from(table).select("reconfirmed_count").eq("id", id).single();
        await sb.from(table).update({ observed_at: observedAt, reconfirmed_count: ((cur?.reconfirmed_count as number) || 0) + 1, ...extra }).eq("id", id);
        sum.entities.enriched++;
      } catch (err: any) { console.error(`extract-pass v1: enrich ${table} failed:`, err?.message); }
    }

    // pains
    for (const e of (ents.pain_points || [])) {
      const g = entityGate(e);
      if (g) { sum.entities.rejected++; rejections.push(`pain: ${g}`); continue; }
      const matched = realId(e.match_existing_id, painsRes.data || []) ||
        (painsRes.data || []).find((p: any) => fuzzyName(p.pain_description, e.description || ""))?.id || null;
      const quant: Record<string, unknown> = {};
      if (typeof e.annual_cost === "number" && e.quantification_quote) { quant.annual_cost = e.annual_cost; quant.quantification_excerpt = e.quantification_quote; quant.quantification_speaker = e.speaker; }
      if (typeof e.annual_hours === "number" && e.quantification_quote) { quant.annual_hours = e.annual_hours; quant.quantification_excerpt = e.quantification_quote; quant.quantification_speaker = e.speaker; }
      if (matched) { await enrich("deal_pain_points", matched, "pain_point", e.description || "pain reconfirmed", e, quant); continue; }
      try {
        const { data: ins, error } = await sb.from("deal_pain_points").insert({
          deal_id: deal.id, pain_description: e.description, category: e.category || "operational",
          source: "ai_transcript", source_conversation_id: conversationId,
          quote: e.quote, transcript_excerpt: e.quote, speaker: e.speaker, speaker_name: e.speaker,
          verified: false, observed_at: observedAt, ...quant,
          metadata: e.possible_duplicate_of ? { possible_duplicate_of: e.possible_duplicate_of } : null,
        }).select("id").single();
        if (error) throw error;
        sum.entities.inserted++;
        await writeDealSource(sb, { org_id: orgId, deal_id: deal.id, field_key: "pain_point", field_type: "text", storage_target: "deal_pain_points", value: e.description, prov: { source: "transcript", quote: e.quote, speaker: e.speaker, conversation_id: conversationId, call_type: conv.call_type, call_date: conv.call_date, observed_at: observedAt } } as FactWrite, e.description);
        void ins;
      } catch (err: any) { sum.entities.rejected++; rejections.push(`pain insert: ${err?.message}`); }
    }

    // compelling events
    for (const e of (ents.compelling_events || [])) {
      const g = entityGate(e);
      if (g) { sum.entities.rejected++; rejections.push(`ce: ${g}`); continue; }
      const matched = realId(e.match_existing_id, cesRes.data || []) ||
        (cesRes.data || []).find((c: any) => fuzzyName(c.event_description, e.description || ""))?.id || null;
      if (matched) { await enrich("compelling_events", matched, "compelling_event", e.description || "CE reconfirmed", e, { reconfirmed_at: new Date().toISOString(), verified: true }); continue; }
      try {
        const { error } = await sb.from("compelling_events").insert({
          deal_id: deal.id, event_description: e.description,
          event_date: e.event_date && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date) ? e.event_date : null,
          strength: ["strong", "medium", "weak"].includes(e.strength) ? e.strength : "medium",
          impact: e.impact || null, verified: true, source: "ai_transcript",
          source_conversation_id: conversationId, quote: e.quote, transcript_excerpt: e.quote,
          speaker: e.speaker, observed_at: observedAt,
        });
        if (error) throw error;
        sum.entities.inserted++;
        await writeDealSource(sb, { org_id: orgId, deal_id: deal.id, field_key: "compelling_event", field_type: "text", storage_target: "compelling_events", value: e.description, prov: { source: "transcript", quote: e.quote, speaker: e.speaker, conversation_id: conversationId, call_type: conv.call_type, call_date: conv.call_date, observed_at: observedAt } } as FactWrite, e.description);
      } catch (err: any) { sum.entities.rejected++; rejections.push(`ce insert: ${err?.message}`); }
    }

    // catalysts
    for (const e of (ents.business_catalysts || [])) {
      const g = entityGate(e);
      if (g) { sum.entities.rejected++; rejections.push(`catalyst: ${g}`); continue; }
      const matched = realId(e.match_existing_id, catsRes.data || []) ||
        (catsRes.data || []).find((c: any) => fuzzyName(c.catalyst, e.catalyst || ""))?.id || null;
      if (matched) { await enrich("business_catalysts", matched, "business_catalyst", e.catalyst || "catalyst reconfirmed", e, { reconfirmed_at: new Date().toISOString(), verified: true }); continue; }
      try {
        const { error } = await sb.from("business_catalysts").insert({
          deal_id: deal.id, catalyst: e.catalyst, category: e.category || null,
          urgency: ["high", "medium", "low"].includes(e.urgency) ? e.urgency : "medium",
          impact: ["high", "medium", "low"].includes(e.impact) ? e.impact : "medium",
          verified: true, source: "ai_transcript", source_conversation_id: conversationId,
          quote: e.quote, transcript_excerpt: e.quote, speaker: e.speaker, observed_at: observedAt,
        });
        if (error) throw error;
        sum.entities.inserted++;
        await writeDealSource(sb, { org_id: orgId, deal_id: deal.id, field_key: "business_catalyst", field_type: "text", storage_target: "business_catalysts", value: e.catalyst, prov: { source: "transcript", quote: e.quote, speaker: e.speaker, conversation_id: conversationId, call_type: conv.call_type, call_date: conv.call_date, observed_at: observedAt } } as FactWrite, e.catalyst);
      } catch (err: any) { sum.entities.rejected++; rejections.push(`catalyst insert: ${err?.message}`); }
    }

    // decision criteria
    for (const e of (ents.decision_criteria || [])) {
      const g = entityGate(e);
      if (g) { sum.entities.rejected++; rejections.push(`criterion: ${g}`); continue; }
      const matched = realId(e.match_existing_id, critsRes.data || []) ||
        (critsRes.data || []).find((c: any) => fuzzyName(c.criterion, e.criterion || ""))?.id || null;
      if (matched) { await enrich("deal_decision_criteria", matched, "decision_criterion", e.criterion || "criterion reconfirmed", e); continue; }
      try {
        const { error } = await sb.from("deal_decision_criteria").insert({
          deal_id: deal.id, criterion: e.criterion,
          importance: ["high", "medium", "low"].includes(e.importance) ? e.importance : "medium",
          source: "ai_transcript", source_conversation_id: conversationId,
          quote: e.quote, speaker: e.speaker, observed_at: observedAt,
        });
        if (error) throw error;
        sum.entities.inserted++;
      } catch (err: any) { sum.entities.rejected++; rejections.push(`criterion insert: ${err?.message}`); }
    }

    // systems (natural key: name + category)
    for (const e of (ents.company_systems || [])) {
      const g = entityGate(e);
      if (g) { sum.entities.rejected++; rejections.push(`system: ${g}`); continue; }
      const matched = realId(e.match_existing_id, sysRes.data || []) ||
        (sysRes.data || []).find((s: any) => fuzzyName(s.system_name, e.system_name || ""))?.id || null;
      const REL = ["current", "competitor", "prior", "evaluating", "complementary"];
      const rel = REL.includes(e.relationship) ? e.relationship : null;
      if (matched) {
        await enrich("company_systems", matched, "company_system", `${e.system_name} reconfirmed`, e, { confirmed: true, source_type: "transcript", ...(rel ? { relationship: rel } : {}) });
        continue;
      }
      try {
        const { error } = await sb.from("company_systems").insert({
          deal_id: deal.id, system_category: e.system_category || "other", system_name: e.system_name,
          relationship: rel, is_current: rel ? rel === "current" : (e.is_current !== false), is_needed: !!e.is_needed,
          integration_purpose: e.integration_purpose || null, confidence: "high", confirmed: true,
          source_type: "transcript", source_excerpt: e.quote, speaker: e.speaker,
          source_conversation_id: conversationId, observed_at: observedAt,
          notes: `Stated on ${conv.call_type} ${conv.call_date}`,
        });
        if (error) throw error;
        sum.entities.inserted++;
        await writeDealSource(sb, { org_id: orgId, deal_id: deal.id, field_key: "company_system", field_type: "text", storage_target: "company_systems", value: e.system_name, prov: { source: "transcript", quote: e.quote, speaker: e.speaker, conversation_id: conversationId, call_type: conv.call_type, call_date: conv.call_date, observed_at: observedAt } } as FactWrite, `${e.system_category}: ${e.system_name}`);
      } catch (err: any) { sum.entities.rejected++; rejections.push(`system insert: ${err?.message}`); }
    }

    // stated risks (taxonomy-keyed, quote-backed)
    const validRiskKeys = new Set((riskDefsRes.data || []).map((r: any) => r.risk_key));
    for (const e of (ents.risks_stated || [])) {
      const g = entityGate(e);
      if (g) { sum.entities.rejected++; rejections.push(`risk: ${g}`); continue; }
      const dup = (risksRes.data || []).find((r: any) => fuzzyName(r.risk_description, e.description || ""));
      if (dup) { await enrich("deal_risks", dup.id, "deal_risk", e.description || "risk reconfirmed", e); continue; }
      try {
        const { error } = await sb.from("deal_risks").insert({
          deal_id: deal.id, risk_description: e.description,
          risk_key: validRiskKeys.has(e.risk_key) ? e.risk_key : null,
          evidence_type: "stated",
          evidence: { quotes: [{ quote: e.quote, speaker: e.speaker, conversation_id: conversationId }] },
          severity: ["critical", "high", "medium", "low"].includes(e.severity) ? e.severity : "medium",
          category: "deal", status: "open", source: "ai_transcript",
          source_conversation_id: conversationId, auto_generated: false, observed_at: observedAt,
        });
        if (error) throw error;
        sum.risks++;
      } catch (err: any) { sum.entities.rejected++; rejections.push(`risk insert: ${err?.message}`); }
    }

    // ── 3. Metrics sweep ──
    // Re-extraction guard: a metric observation is unique per
    // (conversation, label-or-key, value) — same call reprocessed must not
    // duplicate observations.
    const { data: priorMetrics } = await sb.from("deal_metrics")
      .select("metric_key, label, value").eq("conversation_id", conversationId);
    const metricSeen = new Set((priorMetrics || []).map((r: any) => `${r.metric_key || r.label}|${r.value}`));
    for (const m of (Array.isArray(out.metrics) ? out.metrics : [])) {
      if (!m?.quote || !m?.speaker || typeof m.value !== "number") continue;
      const side = sideOf(m.speaker, m.speaker_side);
      if (side !== "prospect") continue;
      if (!numberInQuote(m.value, m.quote)) continue;
      const dedupKey = `${m.metric_key || m.label}|${m.value}`;
      if (metricSeen.has(dedupKey)) continue;
      metricSeen.add(dedupKey);
      try {
        const { error } = await sb.from("deal_metrics").insert({
          org_id: orgId, deal_id: deal.id,
          metric_key: m.metric_key || null, label: m.label || m.metric_key || "metric",
          value: m.value, unit: m.unit || null,
          period: ["month", "year", "event", "point_in_time"].includes(m.period) ? m.period : null,
          as_of: conv.call_date || null, quote: m.quote, speaker: m.speaker,
          conversation_id: conversationId, source: "transcript", observed_at: observedAt,
        });
        if (error) throw error;
        sum.metrics++;
      } catch (err: any) { console.error("extract-pass v1: metric insert:", err?.message); }
    }

    // ── 4. Hypotheses (quarantined) ──
    // Re-extraction guard: don't re-open an identical hypothesis (any status —
    // dismissed/refuted ones stay resolved unless genuinely new provenance).
    const { data: priorHyps } = await sb.from("deal_hypotheses")
      .select("hypothesis").eq("deal_id", deal.id);
    const hypSeen = new Set((priorHyps || []).map((r: any) => r.hypothesis.toLowerCase().trim()));
    for (const h of (Array.isArray(out.hypotheses) ? out.hypotheses : [])) {
      if (!h?.hypothesis) continue;
      const hKey = String(h.hypothesis).toLowerCase().trim();
      if (hypSeen.has(hKey)) continue;
      hypSeen.add(hKey);
      try {
        const { error } = await sb.from("deal_hypotheses").insert({
          org_id: orgId, deal_id: deal.id,
          hypothesis_type: h.hypothesis_type === "green_flag" ? "green_flag" : "red_flag",
          hypothesis: h.hypothesis, reasoning: h.reasoning || null,
          confidence: h.confidence || null, generated_by: "transcript_pass", status: "open",
        });
        if (error) throw error;
        sum.hypotheses++;
      } catch (err: any) { console.error("extract-pass v1: hypothesis insert:", err?.message); }
    }

    // Log + fire the risk engine (Phase 5) in the background.
    try {
      await sb.from("ai_response_log").insert({
        deal_id: deal.id, response_type: "extract_pass", ai_model_used: "claude-sonnet-4-20250514",
        status: "completed", processing_time_ms: Date.now() - t0,
        prompt_tokens: usage.input_tokens || null, completion_tokens: usage.output_tokens || null,
        extraction_summary: { ...sum, rejections: rejections.slice(0, 30) },
      });
    } catch (_) { /* non-fatal */ }
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY };
      const p = Promise.allSettled([
        fetch(`${SUPABASE_URL}/functions/v1/compute-deal-risks`, {
          method: "POST", headers, body: JSON.stringify({ deal_id: deal.id }),
        }),
        // Coaching dimension — skip on reuse_raw (analytics already exist).
        reuseRaw ? Promise.resolve(null) : fetch(`${SUPABASE_URL}/functions/v1/execution-pass`, {
          method: "POST", headers, body: JSON.stringify({ conversation_id: conversationId }),
        }),
      ]).catch((e) => console.error("extract-pass v1: downstream fire failed:", e));
      // @ts-ignore platform global
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
    } catch (_) { /* downstream functions may not be deployed yet */ }

    return jr({ success: true, ...sum, rejections: rejections.slice(0, 30), ms: Date.now() - t0 });
  } catch (e: any) {
    console.error("extract-pass v1 error:", e);
    return jr({ error: `extract-pass v1: ${e?.message || e}` }, 500);
  }
});
