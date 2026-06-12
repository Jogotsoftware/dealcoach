import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// extract-from-document v1
// Reads a deal document's text (passed directly, or downloaded from the
// deal-documents bucket when text-decodable) and proposes catalog field
// values as field_suggestions (suggestion_kind='value_update',
// suggestion_source='document'). They surface inline in the discovery notes
// for accept/dismiss — autofill, reviewed. Binary docs (PDF/docx) that can't
// be decoded server-side return { autofill: 'needs_text' }; the caller can
// pass extracted/pasted text instead.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" }; }
function jr(d: unknown, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), "Content-Type": "application/json" } }); }

async function claude(body: any): Promise<Response> {
  for (let i = 1; i <= 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
    if (r.ok) return r;
    if ([429, 500, 503, 529].includes(r.status)) { await new Promise(res => setTimeout(res, 1500 * Math.pow(2, i))); continue; }
    return r;
  }
  return fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
}

const isTextMime = (m: string, name: string) => /^text\//.test(m || "") || /\.(txt|md|markdown|csv|json|html?)$/i.test(name || "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    if (!ANTHROPIC_API_KEY) return jr({ error: "extract-from-document v1: no API key" }, 500);
    const body = await req.json().catch(() => ({}));
    const { deal_id, document_id } = body;
    let text: string = body.text || "";
    if (!deal_id) return jr({ error: "extract-from-document v1: deal_id required" }, 400);

    const { data: deal } = await sb.from("deals").select("id, org_id").eq("id", deal_id).maybeSingle();
    if (!deal) return jr({ error: "extract-from-document v1: deal not found" }, 404);

    // Auth: service bearer or a user JWT in the deal's org.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    let actor: string | null = null;
    if (token !== SERVICE_KEY) {
      if (!token) return jr({ error: "extract-from-document v1: missing authorization" }, 401);
      const { data: u } = await sb.auth.getUser(token);
      if (!u?.user) return jr({ error: "extract-from-document v1: invalid token" }, 401);
      const { data: prof } = await sb.from("profiles").select("org_id").eq("id", u.user.id).maybeSingle();
      if (!prof || prof.org_id !== deal.org_id) return jr({ error: "extract-from-document v1: not your org" }, 403);
      actor = u.user.id;
    }

    // Resolve text from the stored document if not passed directly.
    if (!text && document_id) {
      const { data: doc } = await sb.from("deal_documents").select("storage_path, name, mime_type").eq("id", document_id).maybeSingle();
      if (doc?.storage_path) {
        if (!isTextMime(doc.mime_type || "", doc.name || "")) return jr({ success: true, autofill: "needs_text", reason: "binary document — paste its text to autofill", suggested: 0 });
        const { data: file } = await sb.storage.from("deal-documents").download(doc.storage_path);
        if (file) text = await file.text();
      }
    }
    text = (text || "").trim();
    if (text.length < 40) return jr({ success: true, autofill: "no_text", suggested: 0 });

    // Catalog definitions to map against.
    const { data: defs } = await sb.from("custom_field_definitions")
      .select("id, field_key, field_label, field_type, ai_context, org_id")
      .eq("entity_type", "deal").eq("is_active", true).or(`org_id.eq.${deal.org_id},org_id.is.null`).order("sort_order");
    const byKey = new Map<string, any>();
    for (const d of (defs || [])) { const p = byKey.get(d.field_key); if (!p || (p.org_id === null && d.org_id !== null)) byKey.set(d.field_key, d); }
    const defList = [...byKey.values()];
    const catalog = defList.map(d => `${d.field_key} (${d.field_type}) — ${d.field_label}${d.ai_context ? `: ${String(d.ai_context).slice(0, 120)}` : ""}`).join("\n");

    const system = "You map a sales document to a fixed discovery catalog. For each catalog field the document CLEARLY answers, return the value the document states. Never guess or infer beyond the text. Quote the supporting snippet. Return ONLY JSON: {\"fields\":[{\"field_key\":\"<exact key>\",\"value\":\"the answer as stated\",\"quote\":\"verbatim snippet from the document\"}]}. Omit fields the document doesn't clearly answer.";
    const user = `CATALOG:\n${catalog}\n\nDOCUMENT:\n${text.slice(0, 60000)}`;
    const cr = await claude({ model: "claude-sonnet-4-20250514", max_tokens: 4000, temperature: 0, system, messages: [{ role: "user", content: user }] });
    if (!cr.ok) return jr({ error: `extract-from-document v1: Claude ${cr.status}` }, 502);
    const cd = await cr.json();
    const raw = (cd.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    let out: any;
    try { const m = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").match(/\{[\s\S]*\}/); out = m ? JSON.parse(m[0]) : { fields: [] }; }
    catch { return jr({ error: "extract-from-document v1: parse failed" }, 422); }

    // Current values, to skip fields that already match.
    const { data: cur } = await sb.from("custom_field_values").select("field_key, value_text, value_json").eq("entity_type", "deal").eq("entity_id", deal_id);
    const curByKey = new Map((cur || []).map((r: any) => [r.field_key, r.value_text ?? (r.value_json ? JSON.stringify(r.value_json) : null)]));

    let suggested = 0;
    for (const f of (Array.isArray(out.fields) ? out.fields : [])) {
      const def = byKey.get(f?.field_key);
      if (!def || !f.value || !String(f.value).trim()) continue;
      const proposed = String(f.value).trim();
      if (String(curByKey.get(f.field_key) ?? "").trim() === proposed) continue; // already matches
      // Skip if an open document suggestion with the same value already exists.
      const { data: dup } = await sb.from("field_suggestions").select("id")
        .eq("deal_id", deal_id).eq("field_key", f.field_key).eq("suggestion_kind", "value_update").eq("status", "open");
      if ((dup || []).length) continue;
      try {
        await sb.from("field_suggestions").insert({
          org_id: deal.org_id, suggestion_kind: "value_update", deal_id,
          field_key: f.field_key, entity_table: "custom_field_values",
          suggested_value: proposed, current_value: curByKey.get(f.field_key) ?? null,
          suggestion_source: "document",
          provenance: { quote: f.quote || null, document_id: document_id || null, observed_at: new Date().toISOString() },
          conflict_context: "Proposed from an uploaded document", status: "open",
          suggested_field_label: def.field_label, suggested_field_type: def.field_type,
          suggested_description: "Document autofill", ai_reasoning: f.quote || "From uploaded document",
          resolved_by: actor,
        });
        suggested++;
      } catch (e: any) { console.error("extract-from-document v1: suggestion insert:", e?.message); }
    }
    return jr({ success: true, version: "extract-from-document v1", suggested });
  } catch (e: any) {
    console.error("extract-from-document v1 error:", e);
    return jr({ error: `extract-from-document v1: ${e?.message || e}` }, 500);
  }
});
