// compute-coaching-nudges v1
//
// Generates the 6 canonical Sage canon coaching nudges. Idempotent: skips when an active
// non-dismissed nudge of the same type already exists for the deal. All new nudges expire
// 14 days after creation (auto-clear stale).
//
// Inputs: { org_id?: optional, deal_id?: optional }
//   - no args: sweep ALL active deals across all orgs (intended for pg_cron use)
//   - deal_id given: only that deal
//   - org_id given: all active deals in that org
//
// Canonical nudge types (v1):
//   thursday_update_overdue   — next-steps not updated since previous Thursday 5pm PT
//   zero_cmrr_in_pipeline     — cmrr null/0 on a deal past 'qualify'
//   msp_not_formally_agreed   — MSP exists, prospect_agreed_flag false, stage in confirming_value/selection
//   month_end_eod_required    — last 5 days of month + close in current month + no update today
//   stale_contact_eb          — EB contact's last_touched_at > 14d ago
//   stalled_push_to_nurture   — eligible early-mid stages + close within 6mo + max activity > 21d + no future call in 14d
//
// next_steps_updated_at is derived from MAX(next_steps_history.created_at) for v1.
// TODO: denormalize to deals column when scale justifies.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERSION = "compute-coaching-nudges v1";

const FOURTEEN_DAYS_MS = 14 * 24 * 3600 * 1000;
const TWENTY_ONE_DAYS_MS = 21 * 24 * 3600 * 1000;
const SIX_MONTHS_MS = 6 * 30 * 24 * 3600 * 1000; // approximate

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function jr(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(), "Content-Type": "application/json" } });
}

// Returns the most recent Thursday 5pm PT as ISO. If today is Thu and it's past 5pm PT, returns today 5pm PT.
function lastThursdayFivePmPT(now: Date): Date {
  // PT offset varies (PST/PDT). For v1, approximate as UTC-8. TODO: timezone-aware via Intl.
  const PT_OFFSET_HOURS = -8;
  const utc = now.getTime();
  const ptNow = new Date(utc + PT_OFFSET_HOURS * 3600 * 1000);
  const dayOfWeek = ptNow.getUTCDay(); // 0=Sun..6=Sat
  const hour = ptNow.getUTCHours();
  // Days to go back to get to most-recent Thursday (4)
  let daysBack: number;
  if (dayOfWeek > 4 || (dayOfWeek === 4 && hour >= 17)) {
    daysBack = dayOfWeek - 4;
  } else {
    daysBack = dayOfWeek + 3; // wrap to last week's Thursday
  }
  const thuPt = new Date(Date.UTC(ptNow.getUTCFullYear(), ptNow.getUTCMonth(), ptNow.getUTCDate() - daysBack, 17, 0, 0));
  // Convert back to UTC
  const thuUtc = new Date(thuPt.getTime() - PT_OFFSET_HOURS * 3600 * 1000);
  return thuUtc;
}

function isFridayOrLater(now: Date): boolean {
  // PT-aware: after Thursday 5pm PT or any later weekday before next Thursday 5pm PT
  const last = lastThursdayFivePmPT(now);
  return now.getTime() >= last.getTime();
}

function isLastFiveDaysOfMonth(now: Date): boolean {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const firstOfNext = new Date(Date.UTC(y, m + 1, 1));
  const lastOfMonth = new Date(firstOfNext.getTime() - 24 * 3600 * 1000);
  const cutoff = new Date(lastOfMonth.getTime() - 4 * 24 * 3600 * 1000); // last 5 days = lastDay-4 .. lastDay
  return now.getTime() >= cutoff.getTime() && now.getTime() <= firstOfNext.getTime();
}

function isSameMonthUtc(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

function nowPlusDays(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}

interface DealRow {
  id: string;
  org_id: string;
  rep_id: string | null;
  stage: string;
  cmrr: number | null;
  target_close_date: string | null;
  forecast_category: string | null;
  next_steps_color_changed_at: string | null;
}

async function getNextStepsUpdatedAt(sb: ReturnType<typeof createClient>, dealId: string): Promise<Date | null> {
  const { data } = await sb
    .from("next_steps_history")
    .select("created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (data?.created_at) return new Date(data.created_at as string);
  return null;
}

async function insertNudgeIfAbsent(
  sb: ReturnType<typeof createClient>,
  payload: {
    org_id: string;
    deal_id: string;
    user_id: string | null;
    nudge_type: string;
    severity: "info" | "attention" | "urgent";
    title: string;
    message: string;
    action_label?: string;
    action_target?: string;
    expires_at?: string;
  },
): Promise<boolean> {
  const { data: existing } = await sb
    .from("coaching_nudges")
    .select("id")
    .eq("deal_id", payload.deal_id)
    .eq("nudge_type", payload.nudge_type)
    .eq("dismissed", false)
    .gt("expires_at", new Date().toISOString())
    .limit(1).maybeSingle();
  if (existing) return false;

  const { error } = await sb.from("coaching_nudges").insert({
    org_id: payload.org_id,
    deal_id: payload.deal_id,
    user_id: payload.user_id,
    nudge_type: payload.nudge_type,
    severity: payload.severity,
    title: payload.title,
    message: payload.message,
    action_label: payload.action_label ?? "Open deal",
    action_target: payload.action_target ?? `/deal/${payload.deal_id}`,
    expires_at: payload.expires_at ?? nowPlusDays(14),
  });
  if (error) {
    console.log(`${VERSION}: insertNudgeIfAbsent error for ${payload.nudge_type}/${payload.deal_id}:`, error.message);
    return false;
  }
  return true;
}

async function processDeal(sb: ReturnType<typeof createClient>, deal: DealRow, now: Date): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  function bump(key: string, val: boolean) {
    if (val) counts[key] = (counts[key] ?? 0) + 1;
  }

  // Activity signal (derived next_steps_updated_at + last conversation + last task completion)
  const nextStepsUpdatedAt = await getNextStepsUpdatedAt(sb, deal.id);

  const { data: lastConv } = await sb
    .from("conversations")
    .select("created_at")
    .eq("deal_id", deal.id)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();

  const { data: lastTaskCompleted } = await sb
    .from("tasks")
    .select("completed_at")
    .eq("deal_id", deal.id)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1).maybeSingle();

  const maxActivity = Math.max(
    nextStepsUpdatedAt ? nextStepsUpdatedAt.getTime() : 0,
    lastConv?.created_at ? new Date(lastConv.created_at as string).getTime() : 0,
    lastTaskCompleted?.completed_at ? new Date(lastTaskCompleted.completed_at as string).getTime() : 0,
  );

  // Future scheduled call check — NOT IMPLEMENTED for v1 (no conversations.scheduled_at exists).
  // TODO: when scheduled-calls tracking exists, query "any future conversations within 14 days".
  const hasScheduledFutureCall = false;

  // 1. thursday_update_overdue
  if (isFridayOrLater(now)) {
    const lastThu = lastThursdayFivePmPT(now);
    const updated = nextStepsUpdatedAt;
    if (!updated || updated.getTime() < lastThu.getTime()) {
      bump("thursday_update_overdue", await insertNudgeIfAbsent(sb, {
        org_id: deal.org_id, deal_id: deal.id, user_id: deal.rep_id,
        nudge_type: "thursday_update_overdue", severity: "attention",
        title: "Forecast update overdue",
        message: "Sage canon: next-steps update due Thursdays by 5pm PT.",
        action_label: "Update next steps",
        action_target: `/deal/${deal.id}?action=focus_next_steps`,
      }));
    }
  }

  // 2. zero_cmrr_in_pipeline
  if ((deal.cmrr == null || Number(deal.cmrr) === 0) && deal.stage !== "qualify") {
    bump("zero_cmrr_in_pipeline", await insertNudgeIfAbsent(sb, {
      org_id: deal.org_id, deal_id: deal.id, user_id: deal.rep_id,
      nudge_type: "zero_cmrr_in_pipeline", severity: "info",
      title: "$0 CMRR",
      message: "Every deal needs a dollar amount per Sage canon.",
      action_label: "Edit deal",
      action_target: `/deal/${deal.id}?action=edit_cmrr`,
    }));
  }

  // 3. msp_not_formally_agreed
  if (deal.stage === "confirming_value" || deal.stage === "selection") {
    const { data: portal } = await sb
      .from("msp_customer_portals")
      .select("id, prospect_agreed_flag")
      .eq("deal_id", deal.id).maybeSingle();
    if (portal && !portal.prospect_agreed_flag) {
      bump("msp_not_formally_agreed", await insertNudgeIfAbsent(sb, {
        org_id: deal.org_id, deal_id: deal.id, user_id: deal.rep_id,
        nudge_type: "msp_not_formally_agreed", severity: "attention",
        title: "MSP not formally agreed",
        message: "Walk through the MSP with the EB and get explicit sign-off.",
        action_label: "Open MSP",
        action_target: `/deal/${deal.id}/msp`,
      }));
    }
  }

  // 4. month_end_eod_required
  if (isLastFiveDaysOfMonth(now)) {
    const closeDate = deal.target_close_date ? new Date(deal.target_close_date + "T00:00:00Z") : null;
    if (closeDate && isSameMonthUtc(closeDate, now)) {
      const inForecast = deal.forecast_category === "commit" || deal.forecast_category === "forecast";
      if (inForecast) {
        // No update today (today UTC 00:00 cutoff)
        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        if (!nextStepsUpdatedAt || nextStepsUpdatedAt.getTime() < todayStart.getTime()) {
          bump("month_end_eod_required", await insertNudgeIfAbsent(sb, {
            org_id: deal.org_id, deal_id: deal.id, user_id: deal.rep_id,
            nudge_type: "month_end_eod_required", severity: "urgent",
            title: "EOD update needed today",
            message: "Sage canon requires EOD updates during last 5 days of month.",
            action_label: "Update next steps",
            action_target: `/deal/${deal.id}?action=focus_next_steps`,
          }));
        }
      }
    }
  }

  // 5. stale_contact_eb
  const { data: ebContacts } = await sb
    .from("contacts")
    .select("id, last_touched_at, name, role")
    .eq("deal_id", deal.id)
    .or("role.ilike.%economic%,role.ilike.%eb%");
  if (ebContacts && ebContacts.length > 0) {
    const fourteenAgo = now.getTime() - FOURTEEN_DAYS_MS;
    const stale = ebContacts.some((c: Record<string, unknown>) => {
      if (!c.last_touched_at) return true;
      return new Date(c.last_touched_at as string).getTime() < fourteenAgo;
    });
    if (stale) {
      bump("stale_contact_eb", await insertNudgeIfAbsent(sb, {
        org_id: deal.org_id, deal_id: deal.id, user_id: deal.rep_id,
        nudge_type: "stale_contact_eb", severity: "attention",
        title: "EB silent 14+ days",
        message: "Re-engage the Economic Buyer before they go dark.",
        action_label: "Open deal",
        action_target: `/deal/${deal.id}?action=scroll_contacts`,
      }));
    }
  }

  // 6. stalled_push_to_nurture
  const eligibleStages = new Set(["discovery", "solution_validation", "confirming_value", "selection"]);
  if (eligibleStages.has(deal.stage)) {
    const closeDate = deal.target_close_date ? new Date(deal.target_close_date + "T00:00:00Z") : null;
    const within6Months = closeDate && closeDate.getTime() - now.getTime() <= SIX_MONTHS_MS && closeDate.getTime() >= now.getTime();
    if (within6Months) {
      const stalled = maxActivity > 0 && (now.getTime() - maxActivity > TWENTY_ONE_DAYS_MS) || maxActivity === 0;
      if (stalled && !hasScheduledFutureCall) {
        const defaultPush = new Date(now.getTime() + SIX_MONTHS_MS + 24 * 3600 * 1000).toISOString().substring(0, 10);
        bump("stalled_push_to_nurture", await insertNudgeIfAbsent(sb, {
          org_id: deal.org_id, deal_id: deal.id, user_id: deal.rep_id,
          nudge_type: "stalled_push_to_nurture", severity: "attention",
          title: "No activity in 21 days",
          message: "Sage canon: clean six-month pipeline. Push this deal past 6 months or work it now.",
          action_label: "Push close date",
          action_target: `/deal/${deal.id}?action=edit_close_date&default_date=${defaultPush}`,
        }));
      }
    }
  }

  return counts;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const reqBody = await req.json().catch(() => ({} as Record<string, unknown>));
    const filter_deal_id = reqBody.deal_id as string | undefined;
    const filter_org_id = reqBody.org_id as string | undefined;

    const ACTIVE_STAGES = ["qualify", "discovery", "solution_validation", "confirming_value", "selection"];

    let q = sb.from("deals").select("id, org_id, rep_id, stage, cmrr, target_close_date, forecast_category, next_steps_color_changed_at").in("stage", ACTIVE_STAGES);
    if (filter_deal_id) q = q.eq("id", filter_deal_id);
    if (filter_org_id) q = q.eq("org_id", filter_org_id);
    const { data: deals, error: dErr } = await q.limit(2000);
    if (dErr) throw new Error(`${VERSION}: deals select error: ${dErr.message}`);
    const dealRows = (deals ?? []) as DealRow[];

    const now = new Date();
    const totals: Record<string, number> = {};
    for (const deal of dealRows) {
      try {
        const counts = await processDeal(sb, deal, now);
        for (const [k, v] of Object.entries(counts)) {
          totals[k] = (totals[k] ?? 0) + v;
        }
      } catch (e) {
        console.log(`${VERSION}: processDeal failed for ${deal.id}:`, e instanceof Error ? e.message : e);
      }
    }

    return jr({
      success: true, version: "v1",
      deals_evaluated: dealRows.length,
      nudges_created: totals,
      total_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(VERSION, msg);
    return jr({ success: false, version: "v1", error: msg }, 500);
  }
});
