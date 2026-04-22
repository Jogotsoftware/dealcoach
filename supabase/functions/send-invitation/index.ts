import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "v1: send-invitation";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ ...data, version: VERSION }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function renderTeammateEmail(vars: Record<string, string>) {
  const personalBlock = vars.personal_message
    ? `<div style="background:#f5f9fc;border-left:4px solid #5DADE2;padding:16px 20px;margin:24px 0;border-radius:4px;"><div style="font-size:13px;font-weight:600;color:#5DADE2;margin-bottom:6px;">Message from ${vars.inviter_name}</div><div style="font-size:15px;line-height:1.6;color:#333;">${vars.personal_message}</div></div>`
    : "";
  const personalText = vars.personal_message
    ? `\nMessage from ${vars.inviter_name}:\n"${vars.personal_message}"\n`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:#f5f5f5;margin:0;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,0.04);"><div style="font-size:20px;font-weight:600;color:#5DADE2;margin-bottom:32px;">Revenue Instruments</div><h1 style="font-size:24px;font-weight:600;margin:0 0 16px 0;line-height:1.3;">Join ${vars.org_name} on Revenue Instruments</h1><p style="font-size:16px;line-height:1.6;margin:0 0 16px 0;color:#333;">${vars.inviter_name} invited you to join the ${vars.org_name} team on Revenue Instruments as a ${vars.role}. Accept the invitation to set up your account and start collaborating.</p>${personalBlock}<div style="text-align:center;margin:32px 0;"><a href="${vars.accept_url}" style="display:inline-block;background:#5DADE2;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">Accept Invitation</a></div><p style="font-size:14px;color:#666;margin:24px 0 0 0;line-height:1.6;">Or copy and paste this link: <a href="${vars.accept_url}" style="color:#5DADE2;word-break:break-all;">${vars.accept_url}</a></p><p style="font-size:13px;color:#888;margin:32px 0 0 0;padding-top:24px;border-top:1px solid #eee;line-height:1.6;">This invitation expires on ${vars.expires_date}. If you weren't expecting this invitation, you can safely ignore this email.</p></div></body></html>`;

  const text = `Join ${vars.org_name} on Revenue Instruments\n\n${vars.inviter_name} invited you to join the ${vars.org_name} team on Revenue Instruments as a ${vars.role}. Accept the invitation to set up your account and start collaborating.${personalText}\nAccept: ${vars.accept_url}\n\nThis invitation expires on ${vars.expires_date}. If you weren't expecting this invitation, you can safely ignore this email.`;

  return { subject: `${vars.inviter_name} invited you to join ${vars.org_name} on Revenue Instruments`, html, text };
}

function renderNewInstanceEmail(vars: Record<string, string>) {
  const personalBlock = vars.personal_message
    ? `<div style="background:#f5f9fc;border-left:4px solid #5DADE2;padding:16px 20px;margin:24px 0;border-radius:4px;"><div style="font-size:13px;font-weight:600;color:#5DADE2;margin-bottom:6px;">Message from ${vars.inviter_name}</div><div style="font-size:15px;line-height:1.6;color:#333;">${vars.personal_message}</div></div>`
    : "";
  const personalText = vars.personal_message
    ? `\nMessage from ${vars.inviter_name}:\n"${vars.personal_message}"\n`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:#f5f5f5;margin:0;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,0.04);"><div style="font-size:20px;font-weight:600;color:#5DADE2;margin-bottom:32px;">Revenue Instruments</div><h1 style="font-size:24px;font-weight:600;margin:0 0 16px 0;line-height:1.3;">You're invited to Revenue Instruments</h1><p style="font-size:16px;line-height:1.6;margin:0 0 16px 0;color:#333;">${vars.inviter_name} invited you to create your own workspace on Revenue Instruments \u2014 an AI-powered sales coaching and deal intelligence platform built for enterprise B2B AEs.</p>${personalBlock}<p style="font-size:16px;line-height:1.6;margin:24px 0 32px 0;color:#333;">When you accept, you'll walk through a quick onboarding to set up your company, product, and sales methodology. Takes about 3 minutes.</p><div style="text-align:center;margin:32px 0;"><a href="${vars.accept_url}" style="display:inline-block;background:#5DADE2;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">Accept Invitation</a></div><p style="font-size:14px;color:#666;margin:24px 0 0 0;line-height:1.6;">Or copy and paste this link: <a href="${vars.accept_url}" style="color:#5DADE2;word-break:break-all;">${vars.accept_url}</a></p><p style="font-size:13px;color:#888;margin:32px 0 0 0;padding-top:24px;border-top:1px solid #eee;line-height:1.6;">This invitation expires on ${vars.expires_date}. If you weren't expecting this invitation, you can safely ignore this email.</p></div></body></html>`;

  const text = `You're invited to Revenue Instruments\n\n${vars.inviter_name} invited you to create your own workspace on Revenue Instruments \u2014 an AI-powered sales coaching and deal intelligence platform built for enterprise B2B AEs.${personalText}\nWhen you accept, you'll walk through a quick onboarding to set up your company, product, and sales methodology. Takes about 3 minutes.\n\nAccept: ${vars.accept_url}\n\nThis invitation expires on ${vars.expires_date}. If you weren't expecting this invitation, you can safely ignore this email.`;

  return { subject: `${vars.inviter_name} invited you to Revenue Instruments`, html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("INVITATION_FROM_EMAIL") || "noreply@resend.dev";
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://aidealcoach.netlify.app";

    if (!resendKey) return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500);

    // Verify caller
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { invitation_id } = await req.json();
    if (!invitation_id) return jsonResponse({ error: "invitation_id required" }, 400);

    // Fetch invitation with inviter profile
    const { data: invitation, error: invErr } = await adminClient
      .from("invitations")
      .select("*, organizations(name), profiles!invitations_invited_by_fkey(full_name, email)")
      .eq("id", invitation_id)
      .single();
    if (invErr || !invitation) return jsonResponse({ error: "Invitation not found" }, 404);

    // Authorization check
    const { data: platformAdmin } = await adminClient
      .from("platform_admins")
      .select("id")
      .eq("user_id", user.id)
      .single();
    const isPlatformAdmin = !!platformAdmin;

    if (invitation.invitation_type === "new_instance" && !isPlatformAdmin) {
      return jsonResponse({ error: "Only platform admins can send new_instance invitations" }, 403);
    }
    if (invitation.invitation_type === "teammate" && !isPlatformAdmin) {
      // Check if caller is org admin
      const { data: callerProfile } = await adminClient
        .from("profiles")
        .select("role, org_id")
        .eq("id", user.id)
        .single();
      if (!callerProfile || callerProfile.org_id !== invitation.org_id || !['admin', 'system_admin'].includes(callerProfile.role)) {
        return jsonResponse({ error: "Not authorized to send invitations for this org" }, 403);
      }
    }

    // Build template variables
    const inviterName = invitation.profiles?.full_name || invitation.profiles?.email || "Someone";
    const orgName = invitation.organizations?.name || "";
    const acceptUrl = `${appBaseUrl}/invite/${invitation.token}`;
    const expiresDate = invitation.expires_at
      ? new Date(invitation.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "30 days from now";

    const vars = {
      inviter_name: inviterName,
      org_name: orgName,
      role: invitation.role || "rep",
      accept_url: acceptUrl,
      expires_date: expiresDate,
      personal_message: invitation.personal_message || "",
    };

    const email = invitation.invitation_type === "new_instance"
      ? renderNewInstanceEmail(vars)
      : renderTeammateEmail(vars);

    // Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [invitation.email],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      const errMsg = resendData?.message || resendData?.error || "Resend API error";
      // Log failure
      await adminClient.from("email_log").insert({
        to_email: invitation.email,
        from_email: fromEmail,
        subject: email.subject,
        email_type: "invitation",
        status: "failed",
        error_message: errMsg,
        metadata: { invitation_id, invitation_type: invitation.invitation_type },
      });
      // Update invitation
      await adminClient.from("invitations").update({
        email_status: "failed",
        email_last_attempted_at: new Date().toISOString(),
        email_attempt_count: (invitation.email_attempt_count || 0) + 1,
        email_error: errMsg,
      }).eq("id", invitation_id);

      return jsonResponse({ error: `Email send failed: ${errMsg}` }, 500);
    }

    const messageId = resendData.id || null;

    // Log success
    await adminClient.from("email_log").insert({
      to_email: invitation.email,
      from_email: fromEmail,
      subject: email.subject,
      email_type: "invitation",
      status: "sent",
      provider_message_id: messageId,
      metadata: { invitation_id, invitation_type: invitation.invitation_type },
    });

    // Update invitation
    await adminClient.from("invitations").update({
      email_status: "sent",
      email_sent_at: new Date().toISOString(),
      email_last_attempted_at: new Date().toISOString(),
      email_attempt_count: (invitation.email_attempt_count || 0) + 1,
      resend_message_id: messageId,
      email_error: null,
    }).eq("id", invitation_id);

    return jsonResponse({ success: true, message_id: messageId, email_status: "sent" });
  } catch (err) {
    return jsonResponse({ error: err.message || "Unknown error" }, 500);
  }
});
