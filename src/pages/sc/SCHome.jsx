import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Spinner, EmptyState, StageBadge } from '../../components/Shared'

// SC home — deal cards for every assigned/pushed deal, sorted by urgency
// (open blockers first, then thinnest coverage). Org-scoped by RLS; filtered
// to the SC's assigned deals (sc_user_id) for focus.
const GRADE = {
  ready:        { label: 'Ready',        color: T.success },
  nearly_ready: { label: 'Nearly ready', color: '#84cc16' },
  gaps:         { label: 'Gaps',         color: T.warning },
  blocked:      { label: 'Blocked',      color: T.error },
}
function gradeMeta(g) {
  return GRADE[g] || { label: g ? String(g).replace(/_/g, ' ') : 'Not started', color: T.textMuted }
}

export default function SCHome() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState([])

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    setLoading(true)
    try {
      // An SC sees only deals assigned to them. Everyone else who can reach
      // the portal (ops/admins/super-admins previewing) sees every assigned
      // deal, RLS-scoped to their accessible orgs.
      let q = supabase.from('deals').select('id, company_name, stage, rep_id, target_close_date')
      q = profile.role === 'sc' ? q.eq('sc_user_id', profile.id) : q.not('sc_user_id', 'is', null)
      const { data: deals } = await q
      const list = deals || []
      const ids = list.map(d => d.id)
      if (ids.length === 0) { setCards([]); setLoading(false); return }

      const [readyRes, repRes, demoRes, unreadRes] = await Promise.all([
        supabase.from('deal_readiness').select('deal_id, coverage_pct, readiness_grade, open_blocker_count').in('deal_id', ids),
        supabase.from('profiles').select('id, full_name').in('id', list.map(d => d.rep_id).filter(Boolean)),
        supabase.from('msp_stages').select('deal_id, stage_name, call_type, start_date, due_date')
          .in('deal_id', ids).or('call_type.eq.demo,stage_name.ilike.%demo%'),
        supabase.from('internal_notifications').select('deal_id').eq('recipient_user_id', profile.id).is('read_at', null).in('deal_id', ids),
      ])
      const ready = Object.fromEntries((readyRes.data || []).map(r => [r.deal_id, r]))
      const reps = Object.fromEntries((repRes.data || []).map(r => [r.id, r.full_name]))
      const unread = {}
      ;(unreadRes.data || []).forEach(r => { unread[r.deal_id] = (unread[r.deal_id] || 0) + 1 })
      const nextDemo = {}
      const today = new Date().toISOString().slice(0, 10)
      ;(demoRes.data || []).forEach(s => {
        const dt = s.due_date || (s.start_date ? String(s.start_date).slice(0, 10) : null)
        if (dt && dt >= today && (!nextDemo[s.deal_id] || dt < nextDemo[s.deal_id])) nextDemo[s.deal_id] = dt
      })

      const built = list.map(d => ({
        ...d,
        rep: reps[d.rep_id] || '—',
        readiness: ready[d.id] || {},
        unread: unread[d.id] || 0,
        nextDemo: nextDemo[d.id] || null,
      })).sort((a, b) =>
        (b.readiness.open_blocker_count || 0) - (a.readiness.open_blocker_count || 0)
        || (a.readiness.coverage_pct || 0) - (b.readiness.coverage_pct || 0)
      )
      setCards(built)
    } catch (e) { console.error('[SCHome] load', e) } finally { setLoading(false) }
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text }}>Your deals</h1>
        <span style={{ fontSize: 13, color: T.textMuted }}>{cards.length} assigned</span>
      </div>
      {cards.length === 0 ? (
        <EmptyState icon="▦" title="No deals assigned yet" message="When an AE hands you a deal, it shows up here with its discovery coverage and demo readiness." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {cards.map(c => {
            const gm = gradeMeta(c.readiness.readiness_grade)
            const cov = c.readiness.coverage_pct ?? 0
            return (
              <button key={c.id} onClick={() => navigate(`/sc/deals/${c.id}`)}
                style={{ textAlign: 'left', cursor: 'pointer', fontFamily: T.font, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, position: 'relative' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = T.shadowMd}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                {c.unread > 0 && <span title={`${c.unread} unread`} style={{ position: 'absolute', top: 14, right: 14, width: 9, height: 9, borderRadius: 5, background: T.error }} />}
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 8, paddingRight: 16 }}>{c.company_name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <StageBadge stage={c.stage} />
                  <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 9, color: gm.color, background: gm.color + '18' }}>{gm.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: T.textMuted }}>Discovery coverage</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{cov}%</span>
                </div>
                <div style={{ height: 5, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${cov}%`, height: '100%', background: cov >= 70 ? T.success : cov >= 30 ? T.warning : T.error, borderRadius: 3 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 11, color: T.textSecondary }}>
                  <span>AE: {c.rep}</span>
                  {c.readiness.open_blocker_count > 0
                    ? <span style={{ color: T.error, fontWeight: 600 }}>{c.readiness.open_blocker_count} blocker{c.readiness.open_blocker_count === 1 ? '' : 's'}</span>
                    : c.nextDemo
                      ? <span>Demo {new Date(c.nextDemo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      : <span style={{ color: T.textMuted }}>No demo set</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
