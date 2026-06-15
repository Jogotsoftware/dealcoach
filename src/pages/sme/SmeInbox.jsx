import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Card, Spinner } from '../../components/Shared'

function ago(d) {
  if (!d) return ''
  const ms = Date.now() - new Date(d).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const TABS = [
  { key: 'routed',     label: 'Routed to me',      statuses: ['routed'] },
  { key: 'clarifying', label: 'Clarifying',        statuses: ['clarifying'] },
  { key: 'answered',   label: 'Recently answered', statuses: ['answered', 'flagged_incorrect'] },
]

export default function SmeInbox() {
  const { profile } = useAuth()
  const { org } = useOrg() || {}
  const [tab, setTab] = useState('routed')
  const [counts, setCounts] = useState({ routed: 0, clarifying: 0, answered: 0 })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (profile?.id) load() }, [profile?.id, tab, org?.id])

  async function load() {
    setLoading(true)
    const tabDef = TABS.find(t => t.key === tab)
    const filters = (q) => q.eq('routed_to_sme_id', profile.id).in('status', tabDef.statuses)
    const ordered = (q) => tab === 'answered' ? q.order('answered_at', { ascending: false }) : q.order('routed_at', { ascending: false, nullsFirst: false })
    try {
      const [allRouted, allClarifying, allAnswered, listRes] = await Promise.all([
        supabase.from('sme_questions').select('id', { count: 'exact', head: true }).eq('routed_to_sme_id', profile.id).eq('status', 'routed'),
        supabase.from('sme_questions').select('id', { count: 'exact', head: true }).eq('routed_to_sme_id', profile.id).eq('status', 'clarifying'),
        supabase.from('sme_questions').select('id', { count: 'exact', head: true }).eq('routed_to_sme_id', profile.id).in('status', ['answered', 'flagged_incorrect']),
        ordered(filters(supabase.from('sme_questions').select('*'))).limit(50),
      ])
      setCounts({ routed: allRouted.count || 0, clarifying: allClarifying.count || 0, answered: allAnswered.count || 0 })
      setRows(listRes.data || [])
    } catch (e) { console.error('SmeInbox load:', e) } finally { setLoading(false) }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto', fontFamily: T.font }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: '0 0 6px' }}>SME Inbox</h1>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>Questions routed to you, awaiting your domain expertise.</div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${T.border}` }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ background: 'none', border: 'none', padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: tab === t.key ? T.primary : T.textMuted, borderBottom: tab === t.key ? `2px solid ${T.primary}` : '2px solid transparent', fontFamily: T.font }}>
            {t.label} <span style={{ marginLeft: 4, padding: '1px 6px', borderRadius: 8, background: tab === t.key ? T.primary : T.surfaceAlt, color: tab === t.key ? '#fff' : T.textMuted, fontSize: 10 }}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <Card><div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>Nothing here yet.</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const isCorrection = !!r.ai_correction_memory_id
            return (
              <Link key={r.id} to={`/sme/question/${r.id}`} style={{ textDecoration: 'none' }}>
                <Card style={{ padding: 14, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                    {isCorrection && (
                      <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Correction validation</span>
                    )}
                    {r.status === 'flagged_incorrect' && (
                      <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Flagged</span>
                    )}
                    <div style={{ flex: 1, fontSize: 13, color: T.text, lineHeight: 1.4 }}>{(r.question_text || '').slice(0, 200)}{(r.question_text || '').length > 200 ? '…' : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: T.textMuted }}>
                    <span>{ago(r.routed_at || r.created_at)}</span>
                    {(r.topic_tags || []).slice(0, 3).map(t => (
                      <span key={t} style={{ padding: '1px 8px', borderRadius: 10, background: T.surfaceAlt, color: T.textMuted, fontSize: 9, fontWeight: 600 }}>{t}</span>
                    ))}
                    {r.ai_citation_count > 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 600, color: T.primary }}>Lux cited this {r.ai_citation_count}×</span>
                    )}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
