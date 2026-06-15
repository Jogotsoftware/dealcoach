import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
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

const STATUS_BADGE = {
  pending: { bg: '#fef3c7', fg: '#92400e', label: 'Pending route' },
  routed: { bg: T.primaryLight || 'rgba(93,173,226,0.12)', fg: T.primary, label: 'Awaiting SME' },
  clarifying: { bg: T.primaryLight || 'rgba(93,173,226,0.12)', fg: T.primary, label: 'SME drafting' },
  answered: { bg: '#dcfce7', fg: '#166534', label: 'Answered' },
  flagged_incorrect: { bg: '#fee2e2', fg: '#991b1b', label: 'Flagged' },
}

export default function SmeMyQuestions() {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase.from('sme_questions').select('*').eq('asked_by_user_id', profile.id).order('created_at', { ascending: false }).limit(100)
      setRows(data || [])
    } catch (e) { console.error('SmeMyQuestions load:', e) } finally { setLoading(false) }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto', fontFamily: T.font }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: '0 0 6px' }}>My SME Questions</h1>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>Questions you've escalated to SMEs in your org.</div>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <Card><div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>You haven't escalated any questions yet. Ask Lux something, then click "Ask an SME" if you want an authoritative human source.</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const badge = STATUS_BADGE[r.status] || { bg: T.surfaceAlt, fg: T.textMuted, label: r.status }
            return (
              <Link key={r.id} to={`/sme/question/${r.id}`} style={{ textDecoration: 'none' }}>
                <Card style={{ padding: 14, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: badge.bg, color: badge.fg, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{badge.label}</span>
                    {r.asker_helpful === true && <span style={{ padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#166534', fontSize: 9, fontWeight: 700 }}>You marked helpful</span>}
                    <div style={{ flex: 1, fontSize: 13, color: T.text, lineHeight: 1.4 }}>{(r.question_text || '').slice(0, 200)}{(r.question_text || '').length > 200 ? '…' : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: T.textMuted }}>
                    <span>{ago(r.created_at)}</span>
                    {(r.topic_tags || []).slice(0, 3).map(t => (
                      <span key={t} style={{ padding: '1px 8px', borderRadius: 10, background: T.surfaceAlt, color: T.textMuted, fontSize: 9, fontWeight: 600 }}>{t}</span>
                    ))}
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
