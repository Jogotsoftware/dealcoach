import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, TabBar, Field, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function CoachAdmin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [coach, setCoach] = useState(null)
  const [prompts, setPrompts] = useState([])
  const [docs, setDocs] = useState([])
  const [scoringConfigs, setScoringConfigs] = useState([])

  useEffect(() => { loadCoach() }, [profile])

  async function loadCoach() {
    setLoading(true)
    try {
      // Load active coach (use profile.active_coach_id or just get the first active one)
      const coachId = profile?.active_coach_id
      let coachQuery = supabase.from('coaches').select('*').eq('active', true).limit(1)
      if (coachId) coachQuery = supabase.from('coaches').select('*').eq('id', coachId).single()
      const { data: coachData } = coachId ? await coachQuery : await coachQuery

      const activeCoach = coachId ? coachData : coachData?.[0]
      setCoach(activeCoach)

      if (activeCoach) {
        const [promptsRes, docsRes, scoringRes] = await Promise.all([
          supabase.from('call_type_prompts').select('*').eq('coach_id', activeCoach.id).order('created_at'),
          supabase.from('coach_documents').select('*').eq('coach_id', activeCoach.id).order('created_at'),
          supabase.from('scoring_configs').select('*').eq('coach_id', activeCoach.id).order('score_type'),
        ])
        setPrompts(promptsRes.data || [])
        setDocs(docsRes.data || [])
        setScoringConfigs(scoringRes.data || [])
      }
    } catch (err) {
      console.error('Error loading coach:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <Spinner />

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'prompts', label: `Call Prompts (${prompts.length})` },
    { key: 'docs', label: `Documents (${docs.length})` },
    { key: 'scoring', label: `Scoring (${scoringConfigs.length})` },
  ]

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: '0 0 12px 0' }}>Coach Admin</h2>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: 24, maxWidth: 1100 }}>
        {!coach ? (
          <Card>
            <div style={{ textAlign: 'center', padding: 32, color: T.textMuted }}>
              No active coach configured. Create one to get started.
            </div>
          </Card>
        ) : (
          <>
            {/* OVERVIEW */}
            {tab === 'overview' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Card title="Active Coach" action={<Button style={{ padding: '4px 12px', fontSize: 11 }}>Edit</Button>}>
                  <Field label="Name" value={coach.name} />
                  <Field label="Description" value={coach.description} />
                  <Field label="Model" value={coach.model} />
                  <Field label="Temperature" value={String(coach.temperature)} />
                </Card>
                <Card title="System Prompt" action={<Button style={{ padding: '4px 12px', fontSize: 11 }}>Edit</Button>}>
                  <div style={{
                    fontFamily: T.mono, fontSize: 12, lineHeight: 1.6, color: T.text,
                    background: T.surfaceAlt, padding: 14, borderRadius: 6, maxHeight: 300, overflow: 'auto',
                  }}>
                    {coach.system_prompt || 'No system prompt configured'}
                  </div>
                </Card>
                <Card title="Extraction Rules" style={{ gridColumn: '1 / -1' }}>
                  <div style={{
                    fontFamily: T.mono, fontSize: 12, lineHeight: 1.6, color: T.text,
                    background: T.surfaceAlt, padding: 14, borderRadius: 6, maxHeight: 200, overflow: 'auto',
                  }}>
                    {coach.extraction_rules || 'No extraction rules configured'}
                  </div>
                </Card>
              </div>
            )}

            {/* CALL PROMPTS */}
            {tab === 'prompts' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <Button primary>+ Add Prompt</Button>
                </div>
                {prompts.map(p => (
                  <Card key={p.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{p.label}</div>
                        <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>Type: {p.call_type}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {p.active && <Badge color={T.success}>Active</Badge>}
                        <Button style={{ padding: '4px 12px', fontSize: 11 }}>Edit</Button>
                      </div>
                    </div>
                    {p.prompt && (
                      <div style={{
                        marginTop: 10, fontFamily: T.mono, fontSize: 11, lineHeight: 1.5, color: T.textSecondary,
                        background: T.surfaceAlt, padding: 10, borderRadius: 4, maxHeight: 80, overflow: 'hidden',
                      }}>
                        {p.prompt.substring(0, 200)}{p.prompt.length > 200 ? '...' : ''}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {/* DOCUMENTS */}
            {tab === 'docs' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <Button primary>+ Upload Document</Button>
                </div>
                {docs.length === 0
                  ? <Card><div style={{ textAlign: 'center', padding: 24, color: T.textMuted }}>No documents uploaded yet.</div></Card>
                  : docs.map(d => (
                    <Card key={d.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{d.name}</div>
                          <Badge color={T.primary}>{(d.doc_type || '').replace(/_/g, ' ')}</Badge>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {d.active && <Badge color={T.success}>Active</Badge>}
                          <Button style={{ padding: '4px 12px', fontSize: 11 }}>Edit</Button>
                        </div>
                      </div>
                    </Card>
                  ))}
              </div>
            )}

            {/* SCORING */}
            {tab === 'scoring' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {scoringConfigs.map(s => (
                  <Card key={s.id} title={s.label} action={<Button style={{ padding: '4px 12px', fontSize: 11 }}>Edit</Button>}>
                    <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 10 }}>{s.description}</div>
                    {Array.isArray(s.criteria) && s.criteria.map((c, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 12px', background: T.surfaceAlt, borderRadius: 4, marginBottom: 4,
                      }}>
                        <span style={{ fontSize: 13, color: T.text }}>{c.name || c.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: T.primary }}>{c.weight}%</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted }}>
                      Max score: {s.max_score}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
