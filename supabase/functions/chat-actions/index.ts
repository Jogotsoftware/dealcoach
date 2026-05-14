// chat-actions edge function v1
//
// Sidecar to deal-chat. Takes a chat exchange and emits 0-3 clickable navigation
// actions for the UI to render as buttons. Rule-based (no LLM call) so it's
// deterministic and ~100ms.
//
// Input:
//   {
//     message: string,             // user's question
//     scope: 'rep' | 'deal',
//     user_id?: string,            // for rep scope (look up rep's pipeline)
//     deal_id?: string,            // for deal scope
//     assistant_text?: string      // the response from deal-chat (for context-aware extraction)
//   }
//
// Output:
//   {
//     version: 'v1',
//     actions: [
//       { label: string, route: string, kind: 'navigate', deal_id?: string, quote_id?: string }
//     ]
//   }

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

// --- helpers ---

function pickFirstMentionedDeal(
  text: string,
  deals: Array<{ id: string; company_name: string }>,
): { id: string; company_name: string } | null {
  if (!text || !deals?.length) return null;
  const lower = text.toLowerCase();
  // Try multi-word matches first (longer company names match first to avoid
  // "X Group" matching when "X Capital Group" is also in the text).
  const sorted = [...deals].sort((a, b) => (b.company_name?.length || 0) - (a.company_name?.length || 0));
  for (const d of sorted) {
    if (!d.company_name) continue;
    if (lower.includes(d.company_name.toLowerCase())) return d;
  }
  return null;
}

// Keyword map → action type. First match wins (order matters).
const ACTION_KEYWORDS: Array<{ kind: string; patterns: RegExp[] }> = [
  // Pricing/quote — most demo-relevant. Matches when the conversation involves
  // cost, pricing, competitors competing on price, discount discussion, etc.
  { kind: 'edit_quote', patterns: [
    /\b(price|pricing|cost|budget|discount|quote|competitive on price|too expensive|sticker shock|tco|net total|line items)\b/i,
  ]},
  // Multi-thread / stakeholder gaps
  { kind: 'review_msp', patterns: [
    /\b(msp|mutual success plan|plan|timeline|next step|implementation timeline|kickoff)\b/i,
  ]},
  // Activity / meeting cadence
  { kind: 'schedule_meeting', patterns: [
    /\b(schedule|meeting|next meeting|book a call|reach out|follow.?up|outreach)\b/i,
  ]},
  // Escalation
  { kind: 'escalate', patterns: [
    /\b(escalate|loop in (?:my )?manager|manager review|deal desk|exec sponsor)\b/i,
  ]},
];

function classifyDealAction(message: string, assistantText: string): string | null {
  const haystack = `${message || ''}\n${assistantText || ''}`;
  for (const { kind, patterns } of ACTION_KEYWORDS) {
    if (patterns.some((p) => p.test(haystack))) return kind;
  }
  return null;
}

// Build the route for a given action kind on a specific deal.
// Returns null if we can't form a valid route (missing quote, etc.).
async function buildActionRoute(
  sb: any,
  kind: string,
  dealId: string,
): Promise<{ route: string; label: string; quote_id?: string } | null> {
  switch (kind) {
    case 'edit_quote': {
      // Look up primary quote first, fall back to most-recent.
      const { data: quotes } = await sb
        .from('quotes')
        .select('id, name, is_primary, updated_at')
        .eq('deal_id', dealId)
        .order('is_primary', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1);
      if (quotes && quotes.length > 0) {
        const q = quotes[0];
        return {
          route: `/deal/${dealId}/quote/${q.id}`,
          label: 'Edit Quote',
          quote_id: q.id,
        };
      }
      // No quote yet — link to quotes list so user can create one.
      return { route: `/deal/${dealId}/quotes`, label: 'Open Quote Builder' };
    }
    case 'review_msp':
      return { route: `/deal/${dealId}/msp`, label: 'Review Project Plan' };
    case 'schedule_meeting':
      // No dedicated /tasks/new route; navigate to deal home where Tasks tab lives.
      return { route: `/deal/${dealId}`, label: 'Open Deal' };
    case 'escalate':
      // No escalation route; link to deal home for now.
      return { route: `/deal/${dealId}`, label: 'Open Deal to Escalate' };
    default:
      return null;
  }
}

// --- main ---

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  try {
    const body = await req.json();
    const message: string = body.message || '';
    const scope: string = body.scope || (body.deal_id ? 'deal' : 'rep');
    const user_id: string | undefined = body.user_id;
    const deal_id: string | undefined = body.deal_id;
    const assistant_text: string = body.assistant_text || '';

    if (!message && !assistant_text) {
      return jsonResponse({ version: 'v1', actions: [], error: 'v1: message or assistant_text required' }, 400);
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const actions: Array<any> = [];

    if (scope === 'rep') {
      if (!user_id) {
        return jsonResponse({ version: 'v1', actions: [], error: 'v1: user_id required for scope=rep' }, 400);
      }
      // Fetch rep's open deals to match against the assistant response.
      const { data: deals } = await sb
        .from('deals')
        .select('id, company_name')
        .eq('rep_id', user_id)
        .not('stage', 'in', '("closed_won","closed_lost","disqualified","needs_nurture")')
        .order('updated_at', { ascending: false })
        .limit(50);
      const mentioned = pickFirstMentionedDeal(assistant_text || message, deals || []);
      if (mentioned) {
        actions.push({
          kind: 'navigate',
          label: `View ${mentioned.company_name}`,
          route: `/deal/${mentioned.id}`,
          deal_id: mentioned.id,
        });
      }
      return jsonResponse({ version: 'v1', actions });
    }

    // scope === 'deal'
    if (!deal_id) {
      return jsonResponse({ version: 'v1', actions: [], error: 'v1: deal_id required for scope=deal' }, 400);
    }

    const kind = classifyDealAction(message, assistant_text);
    if (kind) {
      const built = await buildActionRoute(sb, kind, deal_id);
      if (built) {
        actions.push({ kind: 'navigate', label: built.label, route: built.route, deal_id, quote_id: built.quote_id });
      }
    }

    return jsonResponse({ version: 'v1', actions });
  } catch (err: any) {
    return jsonResponse({ version: 'v1', actions: [], error: `v1: ${err?.message || String(err)}` }, 500);
  }
});
