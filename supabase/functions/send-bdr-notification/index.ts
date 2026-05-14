// send-bdr-notification v1
// Writes a row to bdr_notifications and (if RESEND_API_KEY is configured) fires
// an email with the same content. Invoked async by pre-qdc-decision (on AI decision)
// and route-lead (on routing complete). M7 adds the post-QDC disqualification path.
//
// Invoked fire-and-forget from upstream functions; failures are non-fatal but logged.
// In-app insert happens FIRST and is the authoritative source — email is best-effort.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const INVITATION_FROM_EMAIL = Deno.env.get("INVITATION_FROM_EMAIL")
  ?? "Lumen <notifications@aidealcoach.netlify.app>";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://aidealcoach.netlify.app";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function jr(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
}

const VALID_TYPES = new Set([
  "lead_approved",
  "lead_denied",
  "lead_advanced",
  "lead_disqualified_post_qdc",
]);

type Sb = ReturnType<typeof createClient>;

async function sendEmail(to: string, subject: string, html: string): Promise<{ sent: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { sent: false, error: "RESEND_API_KEY not configured" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: INVITATION_FROM_EMAIL, to: [to], subject, html }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { sent: false, error: `Resend ${r.status}: ${txt.substring(0, 200)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function renderEmail(opts: {
  recipientName: string;
  notificationType: string;
  leadCompany: string;
  body: string;
  detailUrl: string;
}): { subject: string; html: string } {
  const { recipientName, notificationType, leadCompany, body, detailUrl } = opts;
  const typeLabel: Record<string, string> = {
    lead_approved: "Your lead was approved and routed",
    lead_denied: "Your lead needs revision before routing",
    lead_disqualified_post_qdc: "Your lead was disqualified after the QDC",
  };
  const subject = `${typeLabel[notificationType] ?? "Lead update"} — ${leadCompany}`;

  const greeting = recipientName ? `Hi ${recipientName.split(" ")[0]},` : "Hi,";
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #2c3e50; line-height: 1.5; max-width: 580px; margin: 0 auto; padding: 24px;">
<div style="font-size: 14px;">
  <p>${greeting}</p>
  <p>${body.replace(/\n/g, "<br>")}</p>
  <p style="margin-top: 24px;">
    <a href="${detailUrl}" style="display: inline-block; padding: 10px 18px; background: #5DADE2; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px;">View Lead</a>
  </p>
  <p style="margin-top: 32px; font-size: 11px; color: #999;">
    You are receiving this because you submitted a lead in Lumen. Reply to this email if you have questions.
  </p>
</div>
</body></html>`;
  return { subject, html };
}

async function processOne(sb: Sb, p: {
  recipient_user_id: string;
  org_id: string;
  notification_type: string;
  reference_id?: string | null;
  reference_table?: string | null;
  title: string;
  body?: string | null;
  email_body?: string | null;
}): Promise<{ notification_id: string | null; emailed: boolean; email_error?: string | null }> {
  // 1. Insert in-app notification (authoritative)
  const { data: notif, error: insErr } = await sb
    .from("bdr_notifications")
    .insert({
      recipient_user_id: p.recipient_user_id,
      org_id: p.org_id,
      notification_type: p.notification_type,
      reference_id: p.reference_id ?? null,
      reference_table: p.reference_table ?? null,
      title: p.title,
      body: p.body ?? null,
    })
    .select("id")
    .single();
  if (insErr) {
    throw new Error(`send-bdr-notification v1: bdr_notifications insert failed: ${insErr.message}`);
  }

  // 2. Best-effort email
  const { data: recipient } = await sb
    .from("profiles")
    .select("email, full_name")
    .eq("id", p.recipient_user_id)
    .maybeSingle();
  if (!recipient?.email) {
    return { notification_id: notif?.id ?? null, emailed: false, email_error: "no email on recipient profile" };
  }

  // Find associated lead company for context
  let leadCompany = "your lead";
  if (p.reference_table === "bdr_leads" && p.reference_id) {
    const { data: lead } = await sb
      .from("bdr_leads")
      .select("company_name")
      .eq("id", p.reference_id)
      .maybeSingle();
    if (lead?.company_name) leadCompany = lead.company_name;
  }

  const detailUrl = p.reference_table === "bdr_leads" && p.reference_id
    ? `${APP_BASE_URL}/bdr/leads/${p.reference_id}`
    : `${APP_BASE_URL}/bdr/my-leads`;

  const { subject, html } = renderEmail({
    recipientName: recipient.full_name ?? "",
    notificationType: p.notification_type,
    leadCompany,
    body: p.email_body || p.body || p.title,
    detailUrl,
  });

  const emailResult = await sendEmail(recipient.email, subject, html);

  // Log to email_log for audit (schema confirmed via M5 inventory)
  try {
    await sb.from("email_log").insert({
      email_type: `bdr_${p.notification_type}`,
      recipient_email: recipient.email,
      recipient_name: recipient.full_name ?? null,
      subject,
      status: emailResult.sent ? "sent" : "failed",
      provider: "resend",
      related_user_id: p.recipient_user_id,
      error_message: emailResult.error ?? null,
      sent_at: emailResult.sent ? new Date().toISOString() : null,
    });
  } catch (e) {
    console.log("send-bdr-notification v1: email_log insert non-fatal warning", e);
  }

  return { notification_id: notif?.id ?? null, emailed: emailResult.sent, email_error: emailResult.error ?? null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      recipient_user_id,
      org_id,
      notification_type,
      reference_id,
      reference_table,
      title,
      body: msgBody,
      email_body,
    } = body as Record<string, unknown>;

    if (!recipient_user_id) throw new Error("send-bdr-notification v1: recipient_user_id required");
    if (!org_id) throw new Error("send-bdr-notification v1: org_id required");
    if (!notification_type || !VALID_TYPES.has(notification_type as string)) {
      throw new Error(`send-bdr-notification v1: invalid notification_type: ${JSON.stringify(notification_type)}. Valid: ${Array.from(VALID_TYPES).join(", ")}`);
    }
    if (!title) throw new Error("send-bdr-notification v1: title required");

    const result = await processOne(sb, {
      recipient_user_id: recipient_user_id as string,
      org_id: org_id as string,
      notification_type: notification_type as string,
      reference_id: (reference_id as string | undefined) ?? null,
      reference_table: (reference_table as string | undefined) ?? null,
      title: title as string,
      body: (msgBody as string | undefined) ?? null,
      email_body: (email_body as string | undefined) ?? null,
    });

    return jr({ success: true, version: "v1", ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("send-bdr-notification v1 FATAL:", msg);
    return jr({ error: msg, version: "v1" }, 500);
  }
});
