import { supabase } from './supabase'

// internal_notifications writer. RLS allows any same-org member to insert a
// row for any recipient in their org (with_check: org_id = user_org_id()), so
// this is safe client-side — no edge function needed. Best-effort: never
// throws into the caller's flow.
//
// kinds (the AE<->SC loop): sc_viewed_notes, ae_viewed_sc_notes,
// sc_selected_demo_modules, ae_updated_quote, ae_updated_msp, ae_pushed_to_sc,
// sc_uploaded_demo_video, sc_scheduled_demo.
export async function notify({ recipientId, actorId, dealId, orgId, kind, payload = {} }) {
  if (!recipientId || !kind) return
  if (actorId && recipientId === actorId) return // don't notify yourself
  try {
    const { error } = await supabase.from('internal_notifications').insert({
      recipient_user_id: recipientId,
      actor_user_id: actorId || null,
      deal_id: dealId || null,
      org_id: orgId || null,
      kind,
      payload,
    })
    if (error) console.error('[notify]', kind, error.message)
  } catch (e) { console.error('[notify]', kind, e) }
}

// Resolve a deal's SC + rep and notify the relevant party/parties.
// `to`: 'sc' | 'rep' | 'both'. `deal` needs { id, org_id, sc_user_id, rep_id }.
export async function notifyDealParties({ deal, actorId, kind, payload = {}, to = 'both' }) {
  if (!deal?.id) return
  const recipients = new Set()
  if ((to === 'sc' || to === 'both') && deal.sc_user_id) recipients.add(deal.sc_user_id)
  if ((to === 'rep' || to === 'both') && deal.rep_id) recipients.add(deal.rep_id)
  for (const r of recipients) {
    await notify({ recipientId: r, actorId, dealId: deal.id, orgId: deal.org_id, kind, payload })
  }
}

export const NOTIFICATION_LABELS = {
  sc_viewed_notes: 'viewed the discovery notes',
  ae_viewed_sc_notes: 'viewed your SC notes',
  sc_selected_demo_modules: 'updated the demo modules',
  ae_updated_quote: 'updated the quote',
  ae_updated_msp: 'updated the project plan',
  ae_pushed_to_sc: 'handed this deal to you',
  sc_uploaded_demo_video: 'uploaded a demo video',
  sc_scheduled_demo: 'scheduled a demo',
}
