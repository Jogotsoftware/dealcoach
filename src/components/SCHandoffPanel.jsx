import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Button, Badge, inputStyle } from './Shared'
import { notify } from '../lib/notifications'

// AE-side SC handoff + readiness companion. Assign an SC (sets
// deals.sc_user_id), push the deal to them (sc_handoff pushed +
// ae_pushed_to_sc), and read the discovery coverage/readiness. Viewing a
// deal that already has an SC fires ae_viewed_sc_notes once.
const GRADE = {
  ready: { label: 'Ready', color: T.success }, nearly_ready: { label: 'Nearly ready', color: '#84cc16' },
  gaps: { label: 'Gaps', color: T.warning }, blocked: { label: 'Blocked', color: T.error },
}

export default function SCHandoffPanel({ deal, onAssigned }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [scs, setSCs] = useState([])
  const [scUserId, setScUserId] = useState(deal?.sc_user_id || '')
  const [scName, setScName] = useState(null)
  const [handoff, setHandoff] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [busy, setBusy] = useState(false)
  const viewedFired = useRef(false)

  useEffect(() => { load() }, [deal?.id])

  async function load() {
    try {
      const [scRes, hoRes, rdRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('org_id', deal.org_id).eq('role', 'sc').order('full_name'),
        supabase.from('sc_handoff').select('*').eq('deal_id', deal.id).maybeSingle(),
        supabase.from('deal_readiness').select('coverage_pct, readiness_grade, open_blocker_count').eq('deal_id', deal.id).maybeSingle(),
      ])
      setSCs(scRes.data || [])
      setHandoff(hoRes.data || null)
      setReadiness(rdRes.data || null)
      setScUserId(deal.sc_user_id || '')
      setScName((scRes.data || []).find(s => s.id === deal.sc_user_id)?.full_name || null)

      // Fire ae_viewed_sc_notes once when an AE opens a deal that has an SC.
      if (deal.sc_user_id && profile?.id && profile.id !== deal.sc_user_id && !viewedFired.current) {
        viewedFired.current = true
        notify({ recipientId: deal.sc_user_id, actorId: profile.id, dealId: deal.id, orgId: deal.org_id,
          kind: 'ae_viewed_sc_notes', payload: { actor_name: profile.full_name, deal_company: deal.company_name } })
      }
    } catch (e) { console.error('[SCHandoffPanel] load', e) }
  }

  async function assign(newScId) {
    setBusy(true)
    try {
      await supabase.from('deals').update({ sc_user_id: newScId || null }).eq('id', deal.id)
      setScUserId(newScId)
      setScName(scs.find(s => s.id === newScId)?.full_name || null)
      onAssigned?.(newScId || null)
    } catch (e) { console.error('[SCHandoffPanel] assign', e) } finally { setBusy(false) }
  }

  async function push() {
    if (!scUserId) return
    setBusy(true)
    try {
      await supabase.from('sc_handoff').upsert({ deal_id: deal.id, org_id: deal.org_id, status: 'pushed', pushed_by: profile.id, pushed_at: new Date().toISOString() }, { onConflict: 'deal_id' })
      await notify({ recipientId: scUserId, actorId: profile.id, dealId: deal.id, orgId: deal.org_id,
        kind: 'ae_pushed_to_sc', payload: { actor_name: profile.full_name, deal_company: deal.company_name } })
      await load()
    } catch (e) { console.error('[SCHandoffPanel] push', e); alert(`Could not push: ${e?.message || e}`) } finally { setBusy(false) }
  }

  const gm = readiness ? (GRADE[readiness.readiness_grade] || { label: readiness.readiness_grade ? String(readiness.readiness_grade).replace(/_/g, ' ') : 'In progress', color: T.textMuted }) : null
  const status = handoff?.status

  return (
    <Card title="Solutions Consultant" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: T.textSecondary }}>Assigned to</span>
          <select value={scUserId} disabled={busy} onChange={e => assign(e.target.value)}
            style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>
            <option value="">Unassigned</option>
            {scs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>

        {readiness && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 9, color: gm.color, background: gm.color + '18' }}>{gm.label}</span>
            <span style={{ fontSize: 12, color: T.textSecondary }}>Coverage {readiness.coverage_pct ?? 0}%</span>
            {readiness.open_blocker_count > 0 && <span style={{ fontSize: 12, color: T.error, fontWeight: 600 }}>{readiness.open_blocker_count} blocker{readiness.open_blocker_count === 1 ? '' : 's'}</span>}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {status && <Badge color={status === 'pushed' ? T.success : status === 'in_review' ? T.primary : T.textMuted}>{status.replace(/_/g, ' ')}</Badge>}
        <Button onClick={() => navigate(`/deal/${deal.id}/discovery`)} style={{ padding: '6px 12px', fontSize: 12 }}>Discovery notes</Button>
        {scUserId && (
          <Button primary disabled={busy} onClick={push} style={{ padding: '6px 12px', fontSize: 12 }}>
            {status === 'pushed' ? 'Re-push to SC' : 'Push to SC'}
          </Button>
        )}
      </div>
      {scUserId && !status && (
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>Assigned but not pushed. Push when discovery is ready for the SC to take over.</div>
      )}
    </Card>
  )
}
