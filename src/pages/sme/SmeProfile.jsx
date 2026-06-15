import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'
import { Card, Spinner } from '../../components/Shared'
import { SME_RANK_COLORS, SME_BADGE_LABELS } from '../../lib/sme'

export default function SmeProfile() {
  const { userId } = useParams()
  const [profile, setProfile] = useState(null)
  const [smeProf, setSmeProf] = useState(null)
  const [topAnswers, setTopAnswers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (userId) load() }, [userId])

  async function load() {
    setLoading(true)
    try {
      const [profRes, smeRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, initials, role, org_id').eq('id', userId).single(),
        supabase.from('sme_profiles').select('*').eq('user_id', userId).maybeSingle(),
      ])
      setProfile(profRes.data || null)
      setSmeProf(smeRes.data || null)

      // Top 5 answers by citation count (this SME's answered questions).
      const { data: answerThreads } = await supabase.from('sme_answer_thread')
        .select('sme_question_id, sme_questions!inner(id, question_text, ai_citation_count, asker_helpful, topic_tags)')
        .eq('author_user_id', userId).eq('author_type', 'sme').eq('message_type', 'answer')
      const seen = new Set()
      const top = (answerThreads || [])
        .map((row) => row.sme_questions).filter(Boolean)
        .filter(q => { if (seen.has(q.id)) return false; seen.add(q.id); return true })
        .sort((a, b) => (b.ai_citation_count || 0) - (a.ai_citation_count || 0))
        .slice(0, 5)
      setTopAnswers(top)
    } catch (e) { console.error('SmeProfile load:', e) } finally { setLoading(false) }
  }

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spinner /></div>
  if (!profile) return <div style={{ padding: 32, textAlign: 'center', color: T.textMuted }}>User not found.</div>

  const rank = smeProf?.current_rank || 'bronze'
  const rankColor = SME_RANK_COLORS[rank] || T.textMuted

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: T.font }}>
      <Card style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: T.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>{profile.initials || (profile.full_name || '?').slice(0, 2).toUpperCase()}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{profile.full_name || 'SME'}</div>
            <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{profile.role || 'rep'}</div>
          </div>
          {smeProf && (
            <div style={{ padding: '6px 14px', borderRadius: 20, background: rankColor, color: '#fff', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{rank}</div>
          )}
        </div>

        {smeProf && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 18 }}>
            <Stat label="Credits" value={smeProf.credits_total || 0} />
            <Stat label="Answered" value={smeProf.total_answered || 0} />
            <Stat label="Helpful marks" value={smeProf.total_helpful_marks || 0} />
            <Stat label="Open flags" value={smeProf.total_incorrect_flags || 0} />
          </div>
        )}

        {smeProf?.expertise_tags && smeProf.expertise_tags.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Expertise</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {smeProf.expertise_tags.map(t => (
                <span key={t} style={{ padding: '2px 8px', borderRadius: 10, background: T.surfaceAlt, color: T.textSecondary, fontSize: 10, fontWeight: 600 }}>{t}</span>
              ))}
            </div>
          </div>
        )}

        {smeProf?.badges && smeProf.badges.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Badges</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {smeProf.badges.map(b => (
                <div key={b} style={{ padding: '4px 10px', borderRadius: 6, background: T.primaryLight || 'rgba(93,173,226,0.12)', border: `1px solid ${T.primary}40`, color: T.primary, fontSize: 11, fontWeight: 600 }}>{SME_BADGE_LABELS[b] || b}</div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {topAnswers.length > 0 && (
        <Card style={{ padding: 16, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 10 }}>Top answers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topAnswers.map(q => (
              <Link key={q.id} to={`/sme/question/${q.id}`} style={{ textDecoration: 'none' }}>
                <div style={{ padding: 10, borderRadius: 6, background: T.surfaceAlt, cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, color: T.text, marginBottom: 4, lineHeight: 1.4 }}>{(q.question_text || '').slice(0, 160)}{(q.question_text || '').length > 160 ? '…' : ''}</div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 9, color: T.textMuted }}>
                    <span>Cited {q.ai_citation_count || 0}×</span>
                    {q.asker_helpful && <span style={{ color: '#166534', fontWeight: 600 }}>marked helpful</span>}
                    {(q.topic_tags || []).slice(0, 2).map(t => <span key={t}>{t}</span>)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{value}</div>
      <div style={{ fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</div>
    </div>
  )
}
