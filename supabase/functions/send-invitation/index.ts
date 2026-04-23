// VERSION: send-invitation@v2.0 — verify_jwt=false (function handles auth internally)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const FUNCTION_VERSION = 'send-invitation@v1.0'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const INVITATION_FROM_EMAIL = Deno.env.get('INVITATION_FROM_EMAIL')
    const APP_BASE_URL = Deno.env.get('APP_BASE_URL') || 'https://aidealcoach.netlify.app'
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if (!RESEND_API_KEY) return jsonError(500, `${FUNCTION_VERSION}: RESEND_API_KEY not set`)
    if (!INVITATION_FROM_EMAIL) return jsonError(500, `${FUNCTION_VERSION}: INVITATION_FROM_EMAIL not set`)

    const body = await req.json().catch(() => ({}))
    const invitation_id = body?.invitation_id
    const isResend = !!body?.resend
    if (!invitation_id) return jsonError(400, `${FUNCTION_VERSION}: invitation_id required`)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError(401, `${FUNCTION_VERSION}: missing Authorization header`)

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return jsonError(401, `${FUNCTION_VERSION}: invalid JWT`)
    const callerId = userData.user.id

    const { data: invitation, error: invErr } = await admin
      .from('invitations').select('*').eq('id', invitation_id).single()
    if (invErr || !invitation) return jsonError(404, `${FUNCTION_VERSION}: invitation not found`)

    const { data: isPlatformAdmin } = await admin
      .from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle()
    let authorized = !!isPlatformAdmin
    if (!authorized && invitation.invitation_type === 'teammate' && invitation.org_id) {
      const { data: callerProfile } = await admin
        .from('profiles').select('org_id, role').eq('id', callerId).single()
      if (callerProfile?.org_id === invitation.org_id && ['admin','system_admin'].includes(callerProfile?.role)) {
        authorized = true
      }
    }
    if (!authorized) return jsonError(403, `${FUNCTION_VERSION}: not authorized`)

    let orgName = ''
    if (invitation.org_id) {
      const { data: org } = await admin.from('organizations').select('name').eq('id', invitation.org_id).single()
      if (org) orgName = org.name
    }
    let inviterName = 'Revenue Instruments'
    if (invitation.invited_by) {
      const { data: inviter } = await admin
        .from('profiles').select('full_name').eq('id', invitation.invited_by).single()
      if (inviter?.full_name) inviterName = inviter.full_name
    }

    const acceptUrl = `${APP_BASE_URL}/invite/${invitation.token}`
    const expiresDate = new Date(invitation.expires_at).toLocaleDateString('en-US', {
      month:'long', day:'numeric', year:'numeric'
    })
    const isNewInstance = invitation.invitation_type === 'new_instance'
    const recipientGreeting = invitation.invited_name ? `Hi ${invitation.invited_name},` : 'Hi,'
    const subject = isNewInstance
      ? `${inviterName} invited you to Revenue Instruments`
      : `${inviterName} invited you to join ${orgName} on Revenue Instruments`

    const { html, text } = renderEmail({
      isNewInstance, inviterName, orgName, recipientGreeting,
      personalMessage: invitation.personal_message, acceptUrl, expiresDate, role: invitation.role,
    })

    let sendError: string | null = null
    let resendMessageId: string | null = null
    try {
      const resendResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: INVITATION_FROM_EMAIL,
          to: [invitation.email],
          subject, html, text,
          tags: [
            { name: 'invitation_type', value: invitation.invitation_type },
            { name: 'invitation_id', value: invitation.id },
          ],
        }),
      })
      const respBody = await resendResp.json().catch(() => ({}))
      if (!resendResp.ok) sendError = respBody?.message || `Resend ${resendResp.status}`
      else resendMessageId = respBody?.id || null
    } catch (e: any) {
      sendError = `Network error: ${e?.message || String(e)}`
    }

    const now = new Date().toISOString()
    const newAttemptCount = (invitation.email_attempt_count || 0) + 1
    const newEmailStatus = sendError ? 'failed' : 'sent'
    const updatePayload: any = {
      email_status: newEmailStatus,
      email_last_attempted_at: now,
      email_attempt_count: newAttemptCount,
      email_error: sendError,
      resend_message_id: resendMessageId,
    }
    if (!sendError) updatePayload.email_sent_at = now
    await admin.from('invitations').update(updatePayload).eq('id', invitation.id)
    try {
      await admin.from('email_log').insert({
        email_type: isNewInstance ? 'invitation_new_instance' : (isResend ? 'invitation_resend' : 'invitation_teammate'),
        recipient_email: invitation.email,
        recipient_name: invitation.invited_name,
        subject,
        related_invitation_id: invitation.id,
        status: newEmailStatus,
        provider: 'resend',
        provider_message_id: resendMessageId,
        error_message: sendError,
        sent_by: callerId,
        sent_at: sendError ? null : now,
      })
    } catch (_) { /* email_log is best-effort */ }

    if (sendError) return jsonError(500, `${FUNCTION_VERSION}: ${sendError}`)
    return new Response(JSON.stringify({
      success: true, version: FUNCTION_VERSION,
      invitation_id: invitation.id, message_id: resendMessageId,
      email_status: newEmailStatus, attempt: newAttemptCount,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error(`${FUNCTION_VERSION} fatal:`, err)
    return jsonError(500, `${FUNCTION_VERSION}: ${err?.message || String(err)}`)
  }
})

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function escapeHTML(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}
function renderEmail(a: any): { html: string; text: string } {
  const heading = a.isNewInstance ? "You're invited to Revenue Instruments" : `Join ${escapeHTML(a.orgName)} on Revenue Instruments`
  const headingText = a.isNewInstance ? "You're invited to Revenue Instruments" : `Join ${a.orgName} on Revenue Instruments`
  const body = a.isNewInstance
    ? `${escapeHTML(a.inviterName)} invited you to create your own workspace on Revenue Instruments \u2014 an AI-powered sales coaching and deal intelligence platform built for enterprise B2B AEs.`
    : `${escapeHTML(a.inviterName)} invited you to join the ${escapeHTML(a.orgName)} team on Revenue Instruments as a ${escapeHTML(a.role)}.`
  const bodyText = a.isNewInstance
    ? `${a.inviterName} invited you to create your own workspace on Revenue Instruments.`
    : `${a.inviterName} invited you to join the ${a.orgName} team as a ${a.role}.`
  const closer = a.isNewInstance
    ? `When you accept, you'll walk through a quick onboarding to set up your company, product, and sales methodology. Takes about 3 minutes.`
    : `Accept the invitation to set up your account and start collaborating.`
  const personalBlock = a.personalMessage
    ? `<div style="background:#f5f9fc;border-left:4px solid #5DADE2;padding:16px 20px;margin:24px 0;border-radius:4px;"><div style="font-size:13px;font-weight:600;color:#5DADE2;margin-bottom:6px;">Message from ${escapeHTML(a.inviterName)}</div><div style="font-size:15px;line-height:1.6;color:#333;white-space:pre-wrap;">${escapeHTML(a.personalMessage)}</div></div>`
    : ''
  const personalText = a.personalMessage ? `\nMessage from ${a.inviterName}:\n"${a.personalMessage}"\n` : ''
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:#f5f5f5;margin:0;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,0.04);"><div style="font-size:20px;font-weight:600;color:#5DADE2;margin-bottom:32px;">Revenue Instruments</div><h1 style="font-size:24px;font-weight:600;margin:0 0 16px 0;line-height:1.3;">${heading}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 16px 0;color:#333;">${a.recipientGreeting}</p><p style="font-size:16px;line-height:1.6;margin:0 0 16px 0;color:#333;">${body}</p>${personalBlock}<p style="font-size:16px;line-height:1.6;margin:24px 0 32px 0;color:#333;">${closer}</p><div style="text-align:center;margin:32px 0;"><a href="${a.acceptUrl}" style="display:inline-block;background:#5DADE2;color:#fff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">Accept Invitation</a></div><p style="font-size:14px;color:#666;margin:24px 0 0 0;line-height:1.6;">Or copy and paste: <a href="${a.acceptUrl}" style="color:#5DADE2;word-break:break-all;">${a.acceptUrl}</a></p><p style="font-size:13px;color:#888;margin:32px 0 0 0;padding-top:24px;border-top:1px solid #eee;line-height:1.6;">This invitation expires on ${a.expiresDate}. If you weren't expecting this invitation, you can safely ignore this email.</p></div></body></html>`
  const text = `${headingText}\n\n${a.recipientGreeting}\n\n${bodyText}\n${personalText}\n${closer}\n\nAccept: ${a.acceptUrl}\n\nThis invitation expires on ${a.expiresDate}. If you weren't expecting this invitation, you can safely ignore this email.\n`
  return { html, text }
}
