import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// process-retrospective-queue v1
// Called by pg_cron every 5 minutes (and can be invoked manually)
// Polls retrospective_queue where processed=false AND retry_count<3
// For each, invokes generate-deal-retrospective; marks processed on success,
// increments retry_count on failure.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

async function callGenerateRetro(deal_id: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-deal-retrospective`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ deal_id }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { error: `${res.status}: ${t.substring(0, 300)}` };
  }
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const t0 = Date.now();

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const batchSize = Number(body.batch_size) || 10;

    const { data: queueItems, error: queueErr } = await sb
      .from('retrospective_queue')
      .select('id, deal_id, outcome, retry_count, queued_at')
      .eq('processed', false)
      .lt('retry_count', 3)
      .order('queued_at', { ascending: true })
      .limit(batchSize);

    if (queueErr) return jr({ error: `v1: queue read: ${queueErr.message}` }, 500);
    if (!queueItems || queueItems.length === 0) {
      return jr({ success: true, version: 'v1', processed: 0, failed: 0, duration_ms: Date.now() - t0, message: 'Queue empty' });
    }

    let processed = 0, failed = 0;
    const results: any[] = [];

    for (const item of queueItems) {
      await sb.from('retrospective_queue').update({ processing_started_at: new Date().toISOString() }).eq('id', item.id);

      const res = await callGenerateRetro(item.deal_id);

      if (res.error) {
        await sb.from('retrospective_queue').update({
          retry_count: (item.retry_count || 0) + 1,
          error_message: res.error,
          processing_started_at: null,
        }).eq('id', item.id);
        failed++;
        results.push({ deal_id: item.deal_id, status: 'failed', error: res.error });
      } else {
        await sb.from('retrospective_queue').update({
          processed: true,
          processed_at: new Date().toISOString(),
          error_message: null,
        }).eq('id', item.id);
        processed++;
        results.push({ deal_id: item.deal_id, status: 'ok' });
      }
    }

    return jr({ success: true, version: 'v1', processed, failed, total: queueItems.length, duration_ms: Date.now() - t0, results });
  } catch (e: any) {
    console.error('process-retrospective-queue v1 error:', e);
    return jr({ error: `v1: ${e.message}` }, 500);
  }
});
