import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatCurrency, formatDate, formatDateLong, daysUntil, STAGES, CALL_TYPES, TASK_CATEGORIES } from '../lib/theme'
import { Card, Badge, ForecastBadge, StageBadge, ScoreBar, Field, StatusDot, MilestoneStatus, TabBar, Button, EmptyState, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function DealDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [deal, setDeal] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [companyProfile, setCompanyProfile] = useState(null)
  const [contacts, setContacts] = useState([])
  const [conversations, setConversations] = useState([])
  const [mspStages, setMspStages] = useState([])
  const [milestones, setMilestones] = useState([])
  const [proposalDoc, setProposalDoc] = useState(null)
  const [proposalInsights, setProposalInsights] = useState([])
  const [tasks, setTasks] = useState([])
  const [quotes, setQuotes] = useState([])
  const [competitors, setCompetitors] = useState([])

  useEffect(() => {
    if (id && id !== 'new') loadDeal()
  }, [id])

  async function loadDeal() {
    setLoading(true)
    try {
      const [dealRes, analysisRes, profileRes, contactsRes, convosRes, mspRes, msRes, propDocRes, propInsRes, tasksRes, quotesRes, compRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', id).single(),
        supabase.from('deal_analysis').select('*').eq('deal_id', id).single(),
        supabase.from('company_profile').select('*').eq('deal_id', id).single(),
        supabase.from('contacts').select('*').eq('deal_id', id).order('created_at'),
        supabase.from('conversations').select('*').eq('deal_id', id).order('call_date', { ascending: false }),
        supabase.from('msp_stages').select('*').eq('deal_id', id).order('stage_order'),
        supabase.from('msp_milestones').select('*').eq('deal_id', id).order('milestone_order'),
        supabase.from('proposal_documents').select('*').eq('deal_id', id).eq('is_current', true).limit(1),
        supabase.from('proposal_insights').select('*').eq('deal_id', id).eq('include_in_proposal', true).order('created_at'),
        supabase.from('tasks').select('*').eq('deal_id', id).order('created_at', { ascending: false }),
        supabase.from('quotes').select('*').eq('deal_id', id).order('version', { ascending: false }),
        supabase.from('deal_competitors').select('*').eq('deal_id', id),
      ])

      setDeal(dealRes.data)
      setAnalysis(analysisRes.data)
      setCompanyProfile(profileRes.data)
      setContacts(contactsRes.data || [])
      setConversations(convosRes.data || [])
      setMspStages(mspRes.data || [])
      setMilestones(msRes.data || [])
      setProposalDoc(propDocRes.data?.[0] || null)
      setProposalInsights(propInsRes.data || [])
      setTasks(tasksRes.data || [])
      setQuotes(quotesRes.data || [])
      setCompetitors(compRes.data || [])
    } catch (err) {
      console.error('Error loading deal:', err)
    } finally {
      setLoading(false)
    }
  }

  async function toggleTask(taskId) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const { error } = await supabase
      .from('tasks')
      .update({ completed: !task.completed, completed_at: !task.completed ? new Date().toISOString() : null })
      .eq('id', taskId)
    if (!error) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t))
  }

  async function updateMilestoneDate(milestoneId, newDate) {
    const { error } = await supabase
      .from('msp_milestones')
      .update({ due_date: newDate })
      .eq('id', milestoneId)
    if (!error) setMilestones(prev => prev.map(m => m.id === milestoneId ? { ...m, due_date: newDate } : m))
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const stage = STAGES.find(s => s.key === deal.stage)
  const days = daysUntil(deal.target_close_date)
  const openTasks = tasks.filter(t => !t.completed)
  const doneTasks = tasks.filter(t => t.completed)

  // Attach milestones to stages
  const stagesWithMilestones = mspStages.map(s => ({
    ...s,
    milestones: milestones.filter(m => m.msp_stage_id === s.id),
  }))

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'contacts', label: `Contacts (${contacts.length})` },
    { key: 'transcripts', label: `Transcripts (${conversations.length})` },
    { key: 'msp', label: 'MSP' },
    { key: 'proposal', label: 'Proposal' },
    { key: 'tasks', label: `Tasks (${openTasks.length})` },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
              fontWeight: 600, fontFamily: T.font,
            }}
          >
            &larr; Pipeline
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{deal.company_name}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <StageBadge stage={deal.stage} />
              <ForecastBadge category={deal.forecast_category} />
              {deal.website && <span style={{ fontSize: 13, color: T.textSecondary }}>{deal.website}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>
              {formatCurrency(deal.deal_value)}
            </div>
            <div style={{ fontSize: 12, color: T.textSecondary }}>
              {formatCurrency(deal.cmrr)}/mo CMRR
              {days != null && (
                <span style={{
                  marginLeft: 8, fontWeight: 600,
                  color: days < 0 ? T.error : days <= 30 ? T.warning : T.success,
                }}>
                  Close: {formatDate(deal.target_close_date)} ({days < 0 ? `${Math.abs(days)}d late` : `${days}d`})
                </span>
              )}
            </div>
          </div>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: 24, maxWidth: 1200 }}>

        {/* ===== OVERVIEW TAB ===== */}
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card title="Deal Analysis">
              <Field label="Pain Points" value={analysis?.pain_points} />
              <Field label="Quantified Pain" value={analysis?.quantified_pain} />
              <Field label="Business Impact" value={analysis?.business_impact} />
              <Field label="Decision Criteria" value={analysis?.decision_criteria} />
              <Field label="Timeline Drivers" value={analysis?.timeline_drivers} />
              <Field label="Driving Factors" value={analysis?.driving_factors} />
            </Card>

            <Card title="Qualification">
              <Field label="Champion" value={analysis?.champion} />
              <Field label="Economic Buyer" value={analysis?.economic_buyer} />
              <Field label="Budget" value={analysis?.budget} />
              <Field label="Decision Process" value={analysis?.decision_process} />
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <div style={{ flex: 1, background: T.errorLight, borderRadius: 6, padding: 12 }}>
                  <div style={{ ...labelStyle, color: T.error }}>Red Flags</div>
                  <div style={{ fontSize: 12, color: T.error, lineHeight: 1.5 }}>{analysis?.red_flags || 'None identified'}</div>
                </div>
                <div style={{ flex: 1, background: T.successLight, borderRadius: 6, padding: 12 }}>
                  <div style={{ ...labelStyle, color: T.success }}>Green Flags</div>
                  <div style={{ fontSize: 12, color: T.success, lineHeight: 1.5 }}>{analysis?.green_flags || 'None identified'}</div>
                </div>
              </div>
            </Card>

            <Card title="Scores">
              <ScoreBar score={deal.fit_score || 0} label="Fit" />
              <ScoreBar score={deal.deal_health_score || 0} label="Health" />
            </Card>

            <Card title="Company Profile">
              <Field label="Industry" value={companyProfile?.industry} />
              <Field label="Revenue" value={companyProfile?.revenue} />
              <Field label="Employees" value={companyProfile?.employee_count} />
              <Field label="Tech Stack" value={companyProfile?.tech_stack} />
            </Card>

            {competitors.length > 0 && (
              <Card title="Competition" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {competitors.map(c => (
                    <div key={c.id} style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}` }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 6 }}>{c.competitor_name}</div>
                      <Field label="Strengths" value={c.strengths} />
                      <Field label="Weaknesses" value={c.weaknesses} />
                      <Field label="Strategy" value={c.strategy} />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card title="Next Steps" style={{ gridColumn: '1 / -1' }}>
              <div style={{
                fontFamily: T.mono, fontSize: 12, lineHeight: 1.6, color: T.text,
                whiteSpace: 'pre-wrap', background: T.surfaceAlt, padding: 14, borderRadius: 6,
                border: `1px solid ${T.border}`,
              }}>
                {deal.next_steps || 'No next steps entered'}
              </div>
            </Card>

            <Card title="My Notes" style={{ gridColumn: '1 / -1' }} action={<Button style={{ padding: '4px 12px', fontSize: 11 }}>Edit</Button>}>
              <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}>{deal.notes || 'No notes'}</div>
            </Card>
          </div>
        )}

        {/* ===== CONTACTS TAB ===== */}
        {tab === 'contacts' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Contacts</h3>
              <Button primary>+ Add Contact</Button>
            </div>
            {contacts.length === 0
              ? <EmptyState message="No contacts yet. Add manually or upload a transcript to auto-extract." />
              : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {contacts.map(c => (
                    <Card key={c.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{c.name}</div>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>{c.title}{c.department ? ` - ${c.department}` : ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {c.is_champion && <Badge color={T.success}>Champion</Badge>}
                          {c.is_economic_buyer && <Badge color={T.primary}>EB</Badge>}
                          {c.is_signer && <Badge color={T.warning}>Signer</Badge>}
                          <Badge color={c.influence_level === 'high' ? T.error : c.influence_level === 'medium' ? T.warning : T.textMuted}>
                            {c.influence_level || 'Unknown'}
                          </Badge>
                        </div>
                      </div>
                      <Field label="Role in Deal" value={c.role_in_deal} />
                      <Field label="Priorities" value={c.priorities} />
                      <Field label="Communication Style" value={c.communication_style} />
                      {c.email && <div style={{ fontSize: 12, color: T.primary }}>{c.email}</div>}
                    </Card>
                  ))}
                </div>
              )}
          </div>
        )}

        {/* ===== TRANSCRIPTS TAB ===== */}
        {tab === 'transcripts' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Transcripts</h3>
              <Button primary>Upload Transcript</Button>
            </div>
            {conversations.length === 0
              ? <EmptyState message="No transcripts yet. Upload a call transcript for AI analysis and auto-extracted tasks." />
              : conversations.map(cv => (
                <Card key={cv.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{cv.title || 'Untitled'}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <Badge color={T.primary}>{cv.call_type}</Badge>
                        <span style={{ fontSize: 12, color: T.textSecondary }}>{formatDateLong(cv.call_date)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {cv.processed && <Badge color={T.success}>Processed</Badge>}
                      {cv.task_count > 0 && <span style={{ fontSize: 11, color: T.textSecondary }}>{cv.task_count} tasks</span>}
                    </div>
                  </div>
                  {cv.ai_summary && (
                    <div style={{
                      fontSize: 13, color: T.text, lineHeight: 1.6, background: T.surfaceAlt,
                      padding: 14, borderRadius: 6, border: `1px solid ${T.border}`,
                    }}>
                      {cv.ai_summary}
                    </div>
                  )}
                </Card>
              ))}
          </div>
        )}

        {/* ===== MSP TAB ===== */}
        {tab === 'msp' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Mutual Success Plan</h3>
              <Button primary onClick={() => navigate(`/deal/${id}/msp`)}>Open Full MSP</Button>
              <Button>+ Add Stage</Button>
            </div>
            {stagesWithMilestones.length === 0
              ? <EmptyState message="No MSP stages yet. Create stages and milestones to track your deal timeline." action={<Button primary style={{ marginTop: 8 }}>Create MSP</Button>} />
              : stagesWithMilestones.map((stage, si) => (
                <Card
                  key={stage.id}
                  title={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: stage.is_completed ? T.success : T.primary,
                        color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700,
                      }}>
                        {si + 1}
                      </span>
                      {stage.stage_name}
                      {stage.is_completed && <Badge color={T.success}>Done</Badge>}
                    </span>
                  }
                  action={
                    <span style={{ fontSize: 11, color: T.textSecondary }}>
                      {stage.start_date && `Start: ${formatDate(stage.start_date)}`}
                    </span>
                  }
                >
                  {stage.milestones.length === 0
                    ? <div style={{ color: T.textMuted, fontSize: 13 }}>No milestones</div>
                    : stage.milestones.map(ms => (
                      <div key={ms.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', background: T.surfaceAlt, borderRadius: 6,
                        border: `1px solid ${T.borderLight}`, marginBottom: 8,
                      }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: 4,
                          border: `1.5px solid ${ms.status === 'completed' ? T.success : T.border}`,
                          background: ms.status === 'completed' ? T.success : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          {ms.status === 'completed' && <span style={{ color: '#fff', fontSize: 11 }}>&#10003;</span>}
                        </div>
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>{ms.milestone_name}</div>
                        <MilestoneStatus status={ms.status} />
                        <input
                          type="date"
                          value={ms.due_date?.split('T')[0] || ''}
                          onChange={e => updateMilestoneDate(ms.id, e.target.value)}
                          style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 11 }}
                        />
                      </div>
                    ))}
                </Card>
              ))}
          </div>
        )}

        {/* ===== PROPOSAL TAB ===== */}
        {tab === 'proposal' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Proposal Builder</h3>
              {proposalDoc && <Button primary onClick={() => navigate(`/deal/${id}/proposal`)}>Edit in Builder</Button>}
              <Button onClick={() => navigate(`/deal/${id}/quote/new`)}>New Quote</Button>
            </div>
            {!proposalDoc && quotes.length === 0
              ? <EmptyState message="No proposal or quote yet. Build from transcript insights." action={<Button primary onClick={() => navigate(`/deal/${id}/proposal`)} style={{ marginTop: 8 }}>Create Proposal</Button>} />
              : (
                <div>
                  {proposalDoc && (
                    <>
                      <Card title={`Proposal v${proposalDoc.version}`} action={<Badge color={T.primary}>Draft</Badge>}>
                        <Field label="Executive Summary" value={proposalDoc.executive_summary} />
                      </Card>
                      {proposalDoc.problems_challenges && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <Card title="Problems / Challenges">
                            {(Array.isArray(proposalDoc.problems_challenges) ? proposalDoc.problems_challenges : []).map((p, i) => (
                              <div key={i} style={{ padding: '10px 14px', background: T.errorLight, borderRadius: 6, marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: T.error }}>{p.problem || p.title}</div>
                                <div style={{ fontSize: 12, color: T.textSecondary }}>Impact: {p.impact}</div>
                              </div>
                            ))}
                          </Card>
                          <Card title="Solutions / Benefits">
                            {(Array.isArray(proposalDoc.solutions_benefits) ? proposalDoc.solutions_benefits : []).map((s, i) => (
                              <div key={i} style={{ padding: '10px 14px', background: T.successLight, borderRadius: 6, marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: T.success }}>{s.solution || s.title}</div>
                                <div style={{ fontSize: 12, color: T.textSecondary }}>{s.benefit}</div>
                              </div>
                            ))}
                          </Card>
                        </div>
                      )}
                      <Card title="Financial Summary">
                        <div style={{ display: 'flex', gap: 24 }}>
                          <div>
                            <div style={labelStyle}>Annual Impact</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: T.success }}>{proposalDoc.total_annual_impact || '--'}</div>
                          </div>
                          <div>
                            <div style={labelStyle}>Investment</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: T.text }}>{proposalDoc.implementation_investment || formatCurrency(deal.deal_value)}</div>
                          </div>
                          <div>
                            <div style={labelStyle}>ROI</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: T.primary }}>{proposalDoc.expected_roi || '--'}</div>
                          </div>
                        </div>
                      </Card>
                    </>
                  )}

                  {/* Proposal Insights */}
                  {proposalInsights.length > 0 && (
                    <Card title={`Insights (${proposalInsights.length})`}>
                      {proposalInsights.map(ins => (
                        <div key={ins.id} style={{
                          padding: '10px 14px', background: T.surfaceAlt, borderRadius: 6,
                          marginBottom: 8, border: `1px solid ${T.borderLight}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <Badge color={ins.insight_type === 'pain' ? T.error : ins.insight_type === 'value_driver' ? T.success : T.primary}>
                                {ins.insight_type}
                              </Badge>
                              <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginTop: 4 }}>{ins.primary_text}</div>
                              <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{ins.impact_text}</div>
                            </div>
                            {ins.source_type === 'ai_extracted' && <Badge color={T.primary}>AI</Badge>}
                          </div>
                        </div>
                      ))}
                    </Card>
                  )}

                  {/* Quotes */}
                  {quotes.length > 0 && (
                    <Card title={`Quotes (${quotes.length})`}>
                      {quotes.map(q => (
                        <div key={q.id} onClick={() => navigate(`/deal/${id}/quote/${q.id}`)} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '12px 14px', background: T.surfaceAlt, borderRadius: 6,
                          marginBottom: 8, border: `1px solid ${T.borderLight}`, cursor: 'pointer',
                          transition: 'border-color 0.15s',
                        }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = T.primary}
                          onMouseLeave={e => e.currentTarget.style.borderColor = T.borderLight}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                              Quote v{q.version} {q.quote_number && `(${q.quote_number})`}
                            </div>
                            <div style={{ fontSize: 11, color: T.textSecondary }}>
                              {q.contract_years}yr contract | {formatCurrency(q.arr)} ARR
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <Badge color={q.status === 'approved' ? T.success : q.status === 'sent' ? T.primary : T.textMuted}>{q.status}</Badge>
                            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>
                              {formatCurrency(q.net_price)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </Card>
                  )}
                </div>
              )}
          </div>
        )}

        {/* ===== TASKS TAB ===== */}
        {tab === 'tasks' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Action Items ({openTasks.length} open)</h3>
              <Button primary>+ Add Task</Button>
            </div>

            {openTasks.length > 0 && (
              <Card title="Open">
                {openTasks.map(t => {
                  const overdue = t.due_date && daysUntil(t.due_date) < 0
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${T.borderLight}` }}>
                      <button
                        onClick={() => toggleTask(t.id)}
                        style={{
                          width: 20, height: 20, borderRadius: 5,
                          border: `1.5px solid ${T.border}`, background: 'transparent',
                          cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                        }}
                      />
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: t.priority === 'high' ? T.error : t.priority === 'medium' ? T.warning : T.textMuted,
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t.title}
                          {t.is_blocking && <Badge color={T.error}>Blocking</Badge>}
                          {t.auto_generated && <Badge color={T.primary}>AI</Badge>}
                        </div>
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{t.category || 'Uncategorized'}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 500, color: overdue ? T.error : T.textMuted, fontFeatureSettings: '"tnum"' }}>
                        {t.due_date ? formatDate(t.due_date) : ''}
                      </span>
                    </div>
                  )
                })}
              </Card>
            )}

            {doneTasks.length > 0 && (
              <Card title="Completed">
                {doneTasks.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${T.borderLight}`, opacity: 0.5 }}>
                    <button
                      onClick={() => toggleTask(t.id)}
                      style={{
                        width: 20, height: 20, borderRadius: 5,
                        border: `1.5px solid ${T.success}`, background: T.success,
                        cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                      }}
                    >
                      <span style={{ color: '#fff', fontSize: 12 }}>&#10003;</span>
                    </button>
                    <span style={{ flex: 1, fontSize: 13, color: T.textMuted, textDecoration: 'line-through' }}>{t.title}</span>
                  </div>
                ))}
              </Card>
            )}

            {openTasks.length === 0 && doneTasks.length === 0 && (
              <EmptyState message="No tasks for this deal yet." />
            )}
          </div>
        )}

      </div>
    </div>
  )
}
