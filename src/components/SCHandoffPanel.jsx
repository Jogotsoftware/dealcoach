import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Button, Badge, inputStyle } from './Shared'
import { notify } from '../lib/notifications'
import KtEmailButton from './KtEmailButton'

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
  const [scs, setSCs] = useState([])              // org SCs available to add
  const [assigned, setAssigned] = useState([])    // [{ sc_user_id, full_name, is_primary }]
  const [handoff, setHandoff] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const viewedFired = useRef(false)

  useEffect(() => { load() }, [deal?.id])

  async function load() {
    try {
      // SC pool = role='sc' plus ops roles (admins/managers can act as SC).
      const [scRes, asRes, hoRes, rdRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role').eq('org_id', deal.org_id).in('role', ['sc', 'admin', 'system_admin', 'manager']).order('full_name'),
        supabase.from('deal_sc_assignments').select('sc_user_id, is_primary').eq('deal_id', deal.id),
        supabase.from('sc_handoff').select('*').eq('deal_id', deal.id).maybeSingle(),
        supabase.from('deal_readiness').select('coverage_pct, readiness_grade, open_blocker_count').eq('deal_id', deal.id).maybeSingle(),
      ])
      const pool = scRes.data || []
      setSCs(pool)
      const nameOf = (id) => pool.find(s => s.id === id)?.full_name || 'SC'
      setAssigned((asRes.data || []).map(a => ({ ...a, full_name: nameOf(a.sc_user_id) })))
      setHandoff(hoRes.data || null)
      setReadiness(rdRes.data || null)

      const assignedIds = new Set((asRes.data || []).map(a => a.sc_user_id))
      if (assignedIds.size && profile?.id && !assignedIds.has(profile.id) && !viewedFired.current) {
        viewedFired.current = true
        // Notify each assigned SC that the AE viewed the deal.
        for (const id of assignedIds) {
          notify({ recipientId: id, actorId: profile.id, dealId: deal.id, orgId: deal.org_id,
            kind: 'ae_viewed_sc_notes', payload: { actor_name: profile.full_name, deal_company: deal.company_name } })
        }
      }
    } catch (e) { console.error('[SCHandoffPanel] load', e) }
  }

  async function addSC(scId) {
    if (!scId) return
    setBusy(true)
    try {
      const isFirst = assigned.length === 0
      await supabase.from('deal_sc_assignments').upsert(
        { org_id: deal.org_id, deal_id: deal.id, sc_user_id: scId, is_primary: isFirst, assigned_by: profile.id },
        { onConflict: 'deal_id,sc_user_id' })
      if (isFirst) { await supabase.from('deals').update({ sc_user_id: scId }).eq('id', deal.id); onAssigned?.(scId) }
      setAdding(false)
      await load()
    } catch (e) { console.error('[SCHandoffPanel] addSC', e) } finally { setBusy(false) }
  }

  async function removeSC(scId) {
    setBusy(true)
    try {
      await supabase.from('deal_sc_assignments').delete().eq('deal_id', deal.id).eq('sc_user_id', scId)
      if (deal.sc_user_id === scId) {
        const next = assigned.find(a => a.sc_user_id !== scId)?.sc_user_id || null
        await supabase.from('deals').update({ sc_user_id: next }).eq('id', deal.id)
        if (next) await supabase.from('deal_sc_assignments').update({ is_primary: true }).eq('deal_id', deal.id).eq('sc_user_id', next)
        onAssigned?.(next)
      }
      await load()
    } catch (e) { console.error('[SCHandoffPanel] removeSC', e) } finally { setBusy(false) }
  }

  async function push() {
    if (assigned.length === 0) return
    setBusy(true)
    try {
      await supabase.from('sc_handoff').upsert({ deal_id: deal.id, org_id: deal.org_id, status: 'pushed', pushed_by: profile.id, pushed_at: new Date().toISOString() }, { onConflict: 'deal_id' })
      for (const a of assigned) {
        if (a.sc_user_id === profile.id) continue
        await notify({ recipientId: a.sc_user_id, actorId: profile.id, dealId: deal.id, orgId: deal.org_id,
          kind: 'ae_pushed_to_sc', payload: { actor_name: profile.full_name, deal_company: deal.company_name } })
      }
      await load()
    } catch (e) { console.error('[SCHandoffPanel] push', e); alert(`Could not push: ${e?.message || e}`) } finally { setBusy(false) }
  }

  const gm = readiness ? (GRADE[readiness.readiness_grade] || { label: readiness.readiness_grade ? String(readiness.readiness_grade).replace(/_/g, ' ') : 'In progress', color: T.textMuted }) : null
  const status = handoff?.status
  const assignedIds = new Set(assigned.map(a => a.sc_user_id))
  const meAssigned = profile?.id && assignedIds.has(profile.id)
  const addable = scs.filter(s => !assignedIds.has(s.id))

  return (
    <Card title="Solutions Consultants" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {assigned.length === 0 && <span style={{ fontSize: 12, color: T.textMuted }}>No SC assigned yet.</span>}
        {assigned.map(a => (
          <span key={a.sc_user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 10px', borderRadius: 16, background: T.primaryLight, border: `1px solid ${T.primaryBorder}` }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{a.full_name}</span>
            {a.is_primary && <span style={{ fontSize: 8, fontWeight: 800, color: T.primary, textTransform: 'uppercase' }}>lead</span>}
            <button disabled={busy} onClick={() => removeSC(a.sc_user_id)} title="Remove" style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
        {!meAssigned && profile?.role && (
          <button disabled={busy} onClick={() => addSC(profile.id)} style={{ padding: '4px 10px', borderRadius: 16, border: `1px solid ${T.border}`, background: T.surface, color: T.primary, fontSize: 12, fontWeight: 600, fontFamily: T.font, cursor: 'pointer' }}>+ Assign me</button>
        )}
        {adding ? (
          <select autoFocus disabled={busy} defaultValue="" onChange={e => e.target.value && addSC(e.target.value)} onBlur={() => setAdding(false)}
            style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
            <option value="">Select an SC…</option>
            {addable.map(s => <option key={s.id} value={s.id}>{s.full_name}{s.role !== 'sc' ? ` (${s.role})` : ''}</option>)}
          </select>
        ) : (
          <button disabled={busy} onClick={() => setAdding(true)} style={{ padding: '4px 10px', borderRadius: 16, border: `1px dashed ${T.border}`, background: 'transparent', color: T.textSecondary, fontSize: 12, fontFamily: T.font, cursor: 'pointer' }}>+ Add SC</button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {readiness && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 9, color: gm.color, background: gm.color + '18' }}>{gm.label}</span>
            <span style={{ fontSize: 12, color: T.textSecondary }}>Coverage {readiness.coverage_pct ?? 0}%</span>
            {readiness.open_blocker_count > 0 && <span style={{ fontSize: 12, color: T.error, fontWeight: 600 }}>{readiness.open_blocker_count} blocker{readiness.open_blocker_count === 1 ? '' : 's'}</span>}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {status && <Badge color={status === 'pushed' ? T.success : status === 'in_review' ? T.primary : T.textMuted}>{status.replace(/_/g, ' ')}</Badge>}
        <KtEmailButton dealId={deal.id} />
        <Button onClick={() => navigate(`/deal/${deal.id}/discovery`)} style={{ padding: '6px 12px', fontSize: 12 }}>Discovery notes</Button>
        {assigned.length > 0 && (
          <Button primary disabled={busy} onClick={push} style={{ padding: '6px 12px', fontSize: 12 }}>
            {status === 'pushed' ? 'Re-push to SC' : 'Push to SC'}
          </Button>
        )}
      </div>
      {assigned.length > 0 && !status && (
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>Assigned but not pushed. Push when discovery is ready for the SC to take over.</div>
      )}
    </Card>
  )
}
