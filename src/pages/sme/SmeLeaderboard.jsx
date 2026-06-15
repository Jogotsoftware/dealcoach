import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Card, Spinner } from '../../components/Shared'
import { SME_RANK_COLORS } from '../../lib/sme'

const WINDOWS = [
  { key: 'month',     label: 'This month',   days: 30 },
  { key: 'quarter',   label: 'This quarter', days: 90 },
  { key: 'all',       label: 'All-time',     days: null },
]

export default function SmeLeaderboard() {
  const { profile } = useAuth()
  const [windowKey, setWindowKey] = useState('month')
  const [topicFilter, setTopicFilter] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (profile?.org_id) load() }, [profile?.org_id, windowKey])

  async function load() {
    setLoading(true)
    try {
      const w = WINDOWS.find(x => x.key === windowKey)
      const since = w.days ? new Date(Date.now() - w.days * 86400000).toISOString() : null

      // Read sme_profiles for the org. For windowed credit totals, sum sme_credit_ledger entries in that window.
      const { data: profiles } = await supabase.from('sme_profiles').select('user_id, credits_total, current_rank, total_answered, total_helpful_marks, expertise_tags, badges').eq('org_id', profile.org_id)
      if (!profiles || profiles.length === 0) { setRows([]); setLoading(false); return }

      let windowCreditMap = {}
      if (since) {
        const { data: ledger } = await supabase.from('sme_credit_ledger').select('sme_user_id, credit_amount').eq('org_id', profile.org_id).gte('created_at', since)
        for (const e of (ledger || [])) {
          windowCreditMap[e.sme_user_id] = (windowCreditMap[e.sme_user_id] || 0) + (e.credit_amount || 0)
        }
      }

      const userIds = profiles.map(p => p.user_id)
      const { data: profs } = await supabase.from('profiles').select('id, full_name, initials').in('id', userIds)
      const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]))

      const merged = profiles.map(p => ({
        user_id: p.user_id,
        full_name: profMap[p.user_id]?.full_name || 'SME',
        initials: profMap[p.user_id]?.initials,
        credits_window: since ? (windowCreditMap[p.user_id] || 0) : (p.credits_total || 0),
        credits_total: p.credits_total || 0,
        rank: p.current_rank,
        total_answered: p.total_answered || 0,
        total_helpful_marks: p.total_helpful_marks || 0,
        helpful_rate: (p.total_answered || 0) > 0 ? Math.round(((p.total_helpful_marks || 0) / p.total_answered) * 100) : 0,
        expertise_tags: p.expertise_tags || [],
      }))

      // Optional topic filter — restrict to SMEs whose expertise includes the tag.
      const filtered = topicFilter ? merged.filter(m => m.expertise_tags.includes(topicFilter)) : merged
      filtered.sort((a, b) => b.credits_window - a.credits_window)
      setRows(filtered)
    } catch (e) { console.error('SmeLeaderboard load:', e) } finally { setLoading(false) }
  }

  const allTopics = useMemo(() => {
    const set = new Set()
    rows.forEach(r => (r.expertise_tags || []).forEach(t => set.add(t)))
    return Array.from(set).sort()
  }, [rows])

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto', fontFamily: T.font }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: '0 0 6px' }}>SME Leaderboard</h1>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14 }}>Credits, answers, helpful rate by SME.</div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {WINDOWS.map(w => (
          <button key={w.key} onClick={() => setWindowKey(w.key)}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: windowKey === w.key ? T.primary : T.surface, color: windowKey === w.key ? '#fff' : T.textSecondary, border: `1px solid ${windowKey === w.key ? T.primary : T.border}`, borderRadius: 6, fontFamily: T.font }}>{w.label}</button>
        ))}
        {allTopics.length > 0 && (
          <select value={topicFilter} onChange={e => setTopicFilter(e.target.value)} style={{ marginLeft: 'auto', padding: '6px 10px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font }}>
            <option value="">All topics</option>
            {allTopics.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      {loading ? <Spinner /> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: T.surfaceAlt }}>
              <tr>
                <th style={th}>#</th>
                <th style={th}>SME</th>
                <th style={th}>Rank</th>
                <th style={th}>Credits ({windowKey})</th>
                <th style={th}>Answered</th>
                <th style={th}>Helpful</th>
                <th style={th}>Helpful rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: T.textMuted }}>No SMEs yet.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.user_id} style={{ borderTop: `1px solid ${T.borderLight}` }}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}><Link to={`/sme/profile/${r.user_id}`} style={{ color: T.primary, fontWeight: 600, textDecoration: 'none' }}>{r.full_name}</Link></td>
                  <td style={td}><span style={{ padding: '2px 8px', borderRadius: 10, background: SME_RANK_COLORS[r.rank] || T.textMuted, color: '#fff', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{r.rank}</span></td>
                  <td style={td}><strong>{r.credits_window}</strong></td>
                  <td style={td}>{r.total_answered}</td>
                  <td style={td}>{r.total_helpful_marks}</td>
                  <td style={td}>{r.helpful_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

const th = { textAlign: 'left', padding: '8px 12px', fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }
const td = { padding: '10px 12px', color: T.text }
