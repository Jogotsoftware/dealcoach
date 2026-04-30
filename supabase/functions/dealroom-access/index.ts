// dealroom-access v8
// v8 changes: AE preview support. When the viewer row has is_ae_preview=true,
// validate-token + log-view skip view logging, viewer-counter increments, and
// first-view notifications. The AE clicks "Preview customer view" → DealRoomPreview
// finds/creates that synthetic viewer and redirects to /room/:shareToken?t=:magic
// so the customer URL is the source of truth for what the AE sees.
//
// v7 changes: per-tab visibility — deal_rooms.show_msp_tab/show_library_tab/show_proposal_tab.
// validate-token returns the filtered `tabs` array; get-*-tab requests for a hidden tab are rejected with 403.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://aidealcoach.netlify.app"

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function resp(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } })
}
async function hashIp(ip: string): Promise<string> {
  if (!ip) return ''
  const data = new TextEncoder().encode('dealroom:' + ip)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
}

type Sb = ReturnType<typeof createClient>

async function loadViewer(sb: Sb, magic_token: string) {
  if (!magic_token) return { error: 'v7: magic_token required' }
  const { data: viewer, error } = await sb.from('deal_room_viewers').select('*').eq('magic_token', magic_token).maybeSingle()
  if (error) return { error: `v7: viewer lookup failed: ${error.message}` }
  if (!viewer) return { error: 'v7: invalid token' }
  const { data: room, error: roomErr } = await sb.from('deal_rooms').select('*').eq('id', viewer.deal_room_id).single()
  if (roomErr || !room) return { error: `v7: room missing for viewer` }
  if (!room.enabled) return { error: 'v7: this room is disabled' }
  const archived = !!room.expires_at && new Date(room.expires_at).getTime() <= Date.now()
  return { viewer, room, archived }
}

function visibleTabs(room: Record<string, unknown>): string[] {
  const out: string[] = []
  if (room.show_msp_tab !== false) out.push('msp')
  if (room.show_library_tab !== false) out.push('library')
  if (room.show_proposal_tab !== false) out.push('proposal')
  return out
}

function tabAllowed(room: Record<string, unknown>, tab: string): boolean {
  if (tab === 'msp') return room.show_msp_tab !== false
  if (tab === 'library') return room.show_library_tab !== false
  if (tab === 'proposal') return room.show_proposal_tab !== false
  return true
}

function requireWrite(archived: boolean) {
  if (archived) {
    return resp({ error: 'v7: This room is archived. Contact the AE for the current proposal.' }, 403)
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const ipHeader = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
  const ipHash = await hashIp(ipHeader.split(',')[0].trim())
  const userAgent = (req.headers.get('user-agent') || '').slice(0, 300)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body */ }

  const action = String(body.action || '').trim()
  const magic_token = String(body.magic_token || '')

  try {
    if (action === 'validate-token') {
      const v = await loadViewer(sb, magic_token)
      if ((v as Record<string, unknown>).error) return resp({ error: (v as Record<string, unknown>).error }, 401)
      const { viewer, room, archived } = v as { viewer: Record<string, unknown>, room: Record<string, unknown>, archived: boolean }

      const { data: deal } = await sb.from('deals').select('id, company_name, customer_logo_url, org_id, rep_id').eq('id', room.deal_id).single()
      const { data: org } = deal ? await sb.from('organizations').select('name, logo_url').eq('id', deal.org_id).single() : { data: null }
      const { data: rep } = deal?.rep_id ? await sb.from('profiles').select('full_name, email, phone').eq('id', deal.rep_id).maybeSingle() : { data: null }

      // AE-preview viewers don't generate analytics or notifications. The AE
      // is using the customer URL just to see what the customer would see.
      if (!viewer.is_ae_preview) {
        const wasFirstView = !viewer.last_viewed_at && (viewer.view_count || 0) === 0
        try { await sb.from('deal_room_views').insert({ deal_room_id: viewer.deal_room_id, viewer_id: viewer.id, viewer_email: viewer.email, tab: null, user_agent: userAgent, ip_hash: ipHash }) } catch (e) { console.warn('v8: view log failed', e) }
        try { await sb.from('deal_room_viewers').update({ last_viewed_at: new Date().toISOString(), view_count: (Number(viewer.view_count) || 0) + 1 }).eq('id', viewer.id) } catch (e) { console.warn('v8: viewer counter update failed', e) }
        if (wasFirstView && deal?.rep_id) {
          try { await sb.from('deal_room_notifications').insert({ deal_room_id: viewer.deal_room_id, ae_user_id: deal.rep_id, kind: 'first_view', payload: { viewer_email: viewer.email, viewer_name: viewer.name, deal_company: deal.company_name } }) } catch (e) { console.warn('v8: first_view notification failed', e) }
        }
      }

      return resp({
        ok: true,
        viewer: { id: viewer.id, email: viewer.email, name: viewer.name },
        deal_room_id: viewer.deal_room_id,
        share_token: room.share_token,
        deal: deal ? { company_name: deal.company_name, customer_logo_url: deal.customer_logo_url } : null,
        org: org ? { name: org.name, logo_url: org.logo_url } : null,
        rep: rep ? { full_name: rep.full_name, email: rep.email, phone: rep.phone } : null,
        ae_notes: room.ae_notes || null,
        ae_notes_msp: room.ae_notes_msp || null,
        ae_notes_library: room.ae_notes_library || null,
        ae_notes_proposal: room.ae_notes_proposal || null,
        theme_color: room.theme_color || null,
        theme_color_secondary: room.theme_color_secondary || null,
        theme_color_tertiary: room.theme_color_tertiary || null,
        hide_line_pricing: !!room.hide_line_pricing,
        hide_discounts: !!room.hide_discounts,
        proposal_column_visibility: room.proposal_column_visibility || null,
        tabs: visibleTabs(room),
        expires_at: room.expires_at,
        archived,
        has_proposal_snapshot: !!room.proposal_snapshot,
      })
    }

    const v = await loadViewer(sb, magic_token)
    if ((v as Record<string, unknown>).error) return resp({ error: (v as Record<string, unknown>).error }, 401)
    const { viewer, room, archived } = v as { viewer: Record<string, unknown>, room: Record<string, unknown>, archived: boolean }
    const dealId = room.deal_id

    if (action === 'get-msp-tab') {
      if (!tabAllowed(room, 'msp')) return resp({ error: 'v7: this tab is not visible in this room' }, 403)
      const [stagesRes, milestonesRes, requestsRes, commentsRes] = await Promise.all([
        sb.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
        sb.from('msp_milestones').select('*').eq('deal_id', dealId).order('milestone_order'),
        sb.from('deal_room_change_requests').select('id, target_table, target_id, requested_change, reason, status').eq('deal_room_id', viewer.deal_room_id).eq('status', 'pending'),
        sb.from('deal_room_comments').select('id, tab, reference_kind, reference_id, body, author_kind, author_name, author_email, created_at').eq('deal_room_id', viewer.deal_room_id).eq('tab', 'msp'),
      ])
      const counts: Record<string, number> = {}
      for (const c of commentsRes.data || []) {
        if (c.reference_kind && c.reference_id) {
          const key = `${c.reference_kind}:${c.reference_id}`
          counts[key] = (counts[key] || 0) + 1
        }
      }
      return resp({ ok: true, stages: stagesRes.data || [], milestones: milestonesRes.data || [], pending_requests: requestsRes.data || [], comment_counts: counts })
    }

    if (action === 'get-library-tab') {
      if (!tabAllowed(room, 'library')) return resp({ error: 'v7: this tab is not visible in this room' }, 403)
      const { data, error } = await sb.from('deal_resources').select('id, resource_type, title, notes, url, storage_path, mime_type, file_size').eq('deal_id', dealId).order('sort_order').order('created_at')
      if (error) return resp({ error: `v7: library load failed: ${error.message}` }, 500)
      return resp({ ok: true, resources: data || [] })
    }

    if (action === 'get-proposal-tab') {
      if (!tabAllowed(room, 'proposal')) return resp({ error: 'v7: this tab is not visible in this room' }, 403)
      if (!room.proposal_snapshot) return resp({ ok: true, snapshot: null, message: 'Proposal not yet shared' })
      return resp({ ok: true, snapshot: room.proposal_snapshot, snapshotted_at: room.proposal_snapshotted_at })
    }

    if (action === 'add-comment') {
      const archivedResp = requireWrite(archived); if (archivedResp) return archivedResp
      const tab = String(body.tab || 'general')
      if (!['msp', 'library', 'proposal', 'general'].includes(tab)) return resp({ error: 'v7: invalid tab' }, 400)
      if (tab !== 'general' && !tabAllowed(room, tab)) return resp({ error: 'v7: this tab is not visible in this room' }, 403)
      const txt = String(body.body || '').trim()
      if (!txt) return resp({ error: 'v7: comment body required' }, 400)
      const { data, error } = await sb.from('deal_room_comments').insert({
        deal_room_id: viewer.deal_room_id, parent_comment_id: body.parent_comment_id || null,
        tab, reference_kind: body.reference_kind || null, reference_id: body.reference_id || null,
        author_kind: 'viewer', author_email: viewer.email, author_name: viewer.name, body: txt,
      }).select('id').single()
      if (error) return resp({ error: `v7: comment insert failed: ${error.message}` }, 500)
      return resp({ ok: true, comment_id: data?.id })
    }

    if (action === 'request-change') {
      const archivedResp = requireWrite(archived); if (archivedResp) return archivedResp
      const target_table = String(body.target_table || '')
      const target_id = String(body.target_id || '')
      const requested_change = body.requested_change
      const reason = body.reason ? String(body.reason) : null
      if (!['msp_milestones', 'msp_stages'].includes(target_table)) return resp({ error: 'v7: invalid target_table' }, 400)
      if (!tabAllowed(room, 'msp')) return resp({ error: 'v7: project plan is not visible in this room' }, 403)
      if (!target_id) return resp({ error: 'v7: target_id required' }, 400)
      if (!requested_change || typeof requested_change !== 'object') return resp({ error: 'v7: requested_change must be an object' }, 400)
      const fieldWhitelist: Record<string, string[]> = {
        msp_milestones: ['due_date', 'date_label', 'status', 'milestone_name', 'notes'],
        msp_stages: ['start_date', 'end_date', 'due_date', 'date_label', 'duration', 'stage_name', 'status', 'notes'],
      }
      const field = String((requested_change as Record<string, unknown>).field || '')
      if (!fieldWhitelist[target_table].includes(field)) return resp({ error: `v7: field '${field}' not allowed for ${target_table}` }, 400)
      const { data, error } = await sb.from('deal_room_change_requests').insert({
        deal_room_id: viewer.deal_room_id, target_table, target_id, requested_change, reason, status: 'pending',
        requester_email: viewer.email, requester_name: viewer.name,
      }).select('id').single()
      if (error) return resp({ error: `v7: change request insert failed: ${error.message}` }, 500)
      return resp({ ok: true, request_id: data?.id })
    }

    if (action === 'email-ae') {
      const archivedResp = requireWrite(archived); if (archivedResp) return archivedResp
      const subject = String(body.subject || '').trim()
      const text = String(body.body || '').trim()
      if (!subject || !text) return resp({ error: 'v7: subject and body required' }, 400)
      const { data: deal } = await sb.from('deals').select('rep_id, company_name').eq('id', dealId).single()
      if (deal?.rep_id) {
        try { await sb.from('deal_room_notifications').insert({ deal_room_id: viewer.deal_room_id, ae_user_id: deal.rep_id, kind: 'email_ae', payload: { subject, body: text, viewer_email: viewer.email, viewer_name: viewer.name, deal_company: deal.company_name } }) } catch (e) { console.warn('v7: email-ae notification failed', e) }
      }
      try { await sb.from('deal_room_comments').insert({ deal_room_id: viewer.deal_room_id, tab: 'general', author_kind: 'viewer', author_email: viewer.email, author_name: viewer.name, body: subject + '\n\n' + text }) } catch (e) { console.warn('v7: email-ae comment failed', e) }
      return resp({ ok: true })
    }

    if (action === 'add-viewer') {
      const archivedResp = requireWrite(archived); if (archivedResp) return archivedResp
      const email = String(body.email || '').trim().toLowerCase()
      const name = body.name ? String(body.name) : null
      if (!email) return resp({ error: 'v7: email required' }, 400)
      const { data: existing } = await sb.from('deal_room_viewers').select('id, magic_token').eq('deal_room_id', viewer.deal_room_id).eq('email', email).maybeSingle()
      if (existing) {
        const link = `${APP_BASE_URL}/room/${room.share_token}?t=${existing.magic_token}`
        return resp({ ok: true, viewer_id: existing.id, magic_link: link, already_existed: true })
      }
      const { data: newViewer, error } = await sb.from('deal_room_viewers').insert({
        deal_room_id: viewer.deal_room_id, email, name, added_by: viewer.email,
      }).select('id, magic_token').single()
      if (error) return resp({ error: `v7: viewer insert failed: ${error.message}` }, 500)
      const { data: deal } = await sb.from('deals').select('rep_id, company_name').eq('id', dealId).single()
      if (deal?.rep_id) {
        try { await sb.from('deal_room_notifications').insert({ deal_room_id: viewer.deal_room_id, ae_user_id: deal.rep_id, kind: 'viewer_added', payload: { added_email: email, added_name: name, by_email: viewer.email, by_name: viewer.name, deal_company: deal.company_name } }) } catch (e) { console.warn('v7: viewer_added notification failed', e) }
      }
      const link = `${APP_BASE_URL}/room/${room.share_token}?t=${newViewer.magic_token}`
      return resp({ ok: true, viewer_id: newViewer.id, magic_link: link })
    }

    if (action === 'log-view') {
      const tab = String(body.tab || '')
      // AE-preview viewers don't show up in tab analytics either.
      if (!viewer.is_ae_preview) {
        try { await sb.from('deal_room_views').insert({ deal_room_id: viewer.deal_room_id, viewer_id: viewer.id, viewer_email: viewer.email, tab: tab || null, user_agent: userAgent, ip_hash: ipHash }) } catch (e) { console.warn('v8: log-view failed', e) }
        try { await sb.from('deal_room_viewers').update({ last_viewed_at: new Date().toISOString() }).eq('id', viewer.id) } catch (e) { console.warn('v8: log-view counter failed', e) }
      }
      return resp({ ok: true })
    }

    return resp({ error: `v8: unknown action '${action}'` }, 400)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('v7 fatal:', msg)
    return resp({ error: `v7: ${msg}` }, 500)
  }
})
