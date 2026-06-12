import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Spinner, StageBadge } from '../../components/Shared'
import { notify } from '../../lib/notifications'
import KtEmailButton from '../../components/KtEmailButton'
import SCDiscoveryNotes from '../../components/sc/SCDiscoveryNotes'
import PreCallResearch from '../../components/sc/PreCallResearch'
import ModulesSurface from '../../components/sc/ModulesSurface'
import DealRoomConfig from '../DealRoomConfig'

// SC deal workspace — four surfaces over one deal. Defaults to notes. On the
// first SC open after a push, stamps sc_handoff.first_viewed_by_sc_at and
// notifies the AE (sc_viewed_notes).
const VIEWS = [
  { key: 'notes', label: 'Discovery notes' },
  { key: 'research', label: 'Pre-call research' },
  { key: 'modules', label: 'Modules' },
  { key: 'dealroom', label: 'Deal room' },
]

export default function SCDealWorkspace() {
  const { dealId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [deal, setDeal] = useState(null)
  const [rep, setRep] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const view = params.get('view') || 'notes'
  const firedView = useRef(false)

  useEffect(() => { load() }, [dealId])

  async function load() {
    setLoading(true)
    try {
      const { data: d } = await supabase.from('deals')
        .select('id, company_name, stage, rep_id, org_id, sc_user_id')
        .eq('id', dealId).maybeSingle()
      setDeal(d || null)
      if (d?.rep_id) {
        const { data: r } = await supabase.from('profiles').select('id, full_name').eq('id', d.rep_id).maybeSingle()
        setRep(r || null)
      }
      const { data: rd } = await supabase.from('deal_readiness').select('*').eq('deal_id', dealId).maybeSingle()
      setReadiness(rd || null)
      if (d && profile?.role === 'sc' && !firedView.current) {
        firedView.current = true
        stampFirstView(d)
      }
    } catch (e) { console.error('[SCDealWorkspace] load', e) } finally { setLoading(false) }
  }

  async function stampFirstView(d) {
    try {
      const { data: ho } = await supabase.from('sc_handoff').select('deal_id, first_viewed_by_sc_at, pushed_by').eq('deal_id', d.id).maybeSingle()
      if (ho && !ho.first_viewed_by_sc_at) {
        await supabase.from('sc_handoff').update({ first_viewed_by_sc_at: new Date().toISOString() }).eq('deal_id', d.id)
        await notify({ recipientId: ho.pushed_by || d.rep_id, actorId: profile.id, dealId: d.id, orgId: d.org_id,
          kind: 'sc_viewed_notes', payload: { actor_name: profile.full_name, deal_company: d.company_name } })
      }
    } catch (e) { console.error('[SCDealWorkspace] stampFirstView', e) }
  }

  function setView(v) { setParams(prev => { const p = new URLSearchParams(prev); p.set('view', v); return p }, { replace: true }) }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, color: T.textMuted }}>Deal not found, or not assigned to you.</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <button onClick={() => navigate('/sc')} title="Back to your deals"
          style={{ background: T.surface, border: `1px solid ${T.border}`, cursor: 'pointer', color: T.textMuted, padding: '6px 10px', borderRadius: 7, fontFamily: T.font }}>←</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.text }}>{deal.company_name}</h1>
        <StageBadge stage={deal.stage} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.textSecondary }}>AE: {rep?.full_name || '—'}</span>
        <KtEmailButton dealId={deal.id} />
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${T.border}`, marginBottom: 18, overflowX: 'auto' }}>
        {VIEWS.map(v => {
          const active = v.key === view
          return (
            <button key={v.key} onClick={() => setView(v.key)}
              style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, fontFamily: T.font, border: 'none', cursor: 'pointer', background: 'transparent',
                color: active ? T.primary : T.textMuted, borderBottom: active ? `2px solid ${T.primary}` : '2px solid transparent', whiteSpace: 'nowrap' }}>
              {v.label}
            </button>
          )
        })}
      </div>

      {view === 'notes' && <SCDiscoveryNotes deal={deal} readiness={readiness} onReadinessChange={load} />}
      {view === 'research' && <PreCallResearch deal={deal} />}
      {view === 'modules' && <ModulesSurface deal={deal} />}
      {view === 'dealroom' && <DealRoomConfig embedded dealId={deal.id} />}
    </div>
  )
}
