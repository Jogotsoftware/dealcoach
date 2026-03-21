import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatCurrency, formatDate, formatDateLong, daysUntil, STAGES, FORECAST_CATEGORIES, CALL_TYPES, TASK_CATEGORIES } from '../lib/theme'
import { Card, Badge, ForecastBadge, StageBadge, ScoreBar, Field, StatusDot, MilestoneStatus, TabBar, Button, EmptyState, Spinner, inputStyle, labelStyle } from '../components/Shared'

// === EDITABLE FIELD COMPONENT ===
function EditableField({ label, value, field, table, recordId, onSaved, type = 'text', options }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')
  const [saved, setSaved] = useState(false)
  const [hover, setHover] = useState(false)

  useEffect(() => { setVal(value || '') }, [value])

  async function save() {
    setEditing(false)
    const newVal = type === 'number' ? (Number(val) || null) : (val || null)
    if (newVal === value) return
    const { error } = await supabase.from(table).update({ [field]: newVal }).eq('id', recordId)
    if (!error) {
      onSaved?.(field, newVal)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && type !== 'textarea') save()
    if (e.key === 'Escape') { setVal(value || ''); setEditing(false) }
  }

  if (editing) {
    if (type === 'select' && options) {
      return (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...labelStyle }}>{label}</div>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={val} onChange={e => { setVal(e.target.value); }}
            onBlur={save} autoFocus>
            <option value="">--</option>
            {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
      )
    }
    if (type === 'textarea') {
      return (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...labelStyle }}>{label}</div>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={val}
            onChange={e => setVal(e.target.value)} onBlur={save} autoFocus />
        </div>
      )
    }
    if (type === 'date') {
      return (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...labelStyle }}>{label}</div>
          <input type="date" style={inputStyle} value={val} onChange={e => setVal(e.target.value)}
            onBlur={save} onKeyDown={handleKeyDown} autoFocus />
        </div>
      )
    }
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ ...labelStyle }}>{label}</div>
        <input type={type === 'number' ? 'number' : 'text'} style={inputStyle} value={val}
          onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={handleKeyDown} autoFocus />
      </div>
    )
  }

  const displayVal = type === 'select' && options
    ? (options.find(o => o.key === value)?.label || value)
    : type === 'date' ? formatDateLong(value) : value

  return (
    <div style={{ marginBottom: 12, cursor: 'pointer', position: 'relative' }}
      onClick={() => setEditing(true)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {hover && <span style={{ fontSize: 10, color: T.textMuted }}>{'\u270E'}</span>}
        {saved && <span style={{ fontSize: 10, color: T.success, fontWeight: 600 }}>Saved</span>}
      </div>
      <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5, whiteSpace: type === 'textarea' ? 'pre-wrap' : undefined }}>
        {displayVal || <span style={{ color: T.textMuted, fontStyle: 'italic' }}>Click to edit</span>}
      </div>
    </div>
  )
}

// === SEVERITY COLORS ===
const SEVERITY_COLORS = { critical: T.error, high: '#f97316', medium: T.warning, low: T.textMuted }
const STATUS_COLORS = { open: T.error, mitigating: T.warning, mitigated: T.success, accepted: T.textMuted, closed: T.textMuted }
const STRENGTH_COLORS = { strong: T.success, medium: T.warning, weak: T.error }
const URGENCY_COLORS = { high: T.error, medium: T.warning, low: T.textMuted }

const RISK_CATEGORIES = ['timing', 'competition', 'budget', 'access_to_power', 'functionality', 'personnel', 'legal', 'integration', 'adoption', 'general']
const PAIN_CATEGORIES = ['financial', 'operational', 'compliance', 'growth', 'competitive', 'technology', 'personnel', 'custom']
const CATALYST_CATEGORIES = ['regulatory', 'market', 'competitive', 'internal', 'technology', 'financial', 'personnel']

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
  const [risks, setRisks] = useState([])
  const [events, setEvents] = useState([])
  const [catalysts, setCatalysts] = useState([])
  const [painPoints, setPainPoints] = useState([])
  const [callScores, setCallScores] = useState({})

  // Contact editing
  const [editingContact, setEditingContact] = useState(null)
  const [editContactData, setEditContactData] = useState({})

  // Competitor editing
  const [editingCompetitor, setEditingCompetitor] = useState(null)
  const [editCompData, setEditCompData] = useState({})

  // Form toggles
  const [showAddRisk, setShowAddRisk] = useState(false)
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [showAddCatalyst, setShowAddCatalyst] = useState(false)
  const [showAddPain, setShowAddPain] = useState(false)
  const [expandedRisk, setExpandedRisk] = useState(null)

  // New item forms
  const [newRisk, setNewRisk] = useState({ risk_description: '', category: 'general', severity: 'medium', mitigation_plan: '' })
  const [newEvent, setNewEvent] = useState({ event_description: '', event_date: '', strength: 'medium', impact: '' })
  const [newCatalyst, setNewCatalyst] = useState({ catalyst: '', category: 'internal', urgency: 'medium', impact: '' })
  const [newPain, setNewPain] = useState({ pain_description: '', category: 'operational', annual_cost: '', affected_team: '', notes: '' })

  useEffect(() => { if (id && id !== 'new') loadDeal() }, [id])

  async function loadDeal() {
    setLoading(true)
    try {
      const [dealRes, analysisRes, profileRes, contactsRes, convosRes, mspRes, msRes, propDocRes, propInsRes, tasksRes, quotesRes, compRes, risksRes, eventsRes, catalystsRes, painsRes] = await Promise.all([
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
        supabase.from('deal_risks').select('*').eq('deal_id', id).order('created_at', { ascending: false }),
        supabase.from('compelling_events').select('*').eq('deal_id', id).order('event_date'),
        supabase.from('business_catalysts').select('*').eq('deal_id', id).order('created_at'),
        supabase.from('deal_pain_points').select('*').eq('deal_id', id).order('annual_cost', { ascending: false }),
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
      setRisks(risksRes.data || [])
      setEvents(eventsRes.data || [])
      setCatalysts(catalystsRes.data || [])
      setPainPoints(painsRes.data || [])

      // Load call scores for each conversation
      const convIds = (convosRes.data || []).map(c => c.id)
      if (convIds.length > 0) {
        const { data: scores } = await supabase.from('call_analyses').select('conversation_id, overall_score').in('conversation_id', convIds)
        if (scores) {
          const map = {}
          scores.forEach(s => { map[s.conversation_id] = s.overall_score })
          setCallScores(map)
        }
      }
    } catch (err) {
      console.error('Error loading deal:', err)
    } finally {
      setLoading(false)
    }
  }

  async function saveContact(contactId) {
    const { error } = await supabase.from('contacts').update(editContactData).eq('id', contactId)
    if (!error) {
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, ...editContactData } : c))
      setEditingContact(null)
    }
  }

  async function saveCompetitor(compId) {
    const { error } = await supabase.from('deal_competitors').update(editCompData).eq('id', compId)
    if (!error) {
      setCompetitors(prev => prev.map(c => c.id === compId ? { ...c, ...editCompData } : c))
      setEditingCompetitor(null)
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
    const { error } = await supabase.from('msp_milestones').update({ due_date: newDate }).eq('id', milestoneId)
    if (!error) setMilestones(prev => prev.map(m => m.id === milestoneId ? { ...m, due_date: newDate } : m))
  }

  async function addRisk() {
    if (!newRisk.risk_description.trim()) return
    const { data, error } = await supabase.from('deal_risks').insert({
      deal_id: id, ...newRisk, status: 'open', source: 'manual',
    }).select().single()
    if (!error && data) { setRisks(prev => [data, ...prev]); setShowAddRisk(false); setNewRisk({ risk_description: '', category: 'general', severity: 'medium', mitigation_plan: '' }) }
  }

  async function addEvent() {
    if (!newEvent.event_description.trim()) return
    const { data, error } = await supabase.from('compelling_events').insert({
      deal_id: id, ...newEvent, event_date: newEvent.event_date || null,
    }).select().single()
    if (!error && data) { setEvents(prev => [...prev, data]); setShowAddEvent(false); setNewEvent({ event_description: '', event_date: '', strength: 'medium', impact: '' }) }
  }

  async function addCatalyst() {
    if (!newCatalyst.catalyst.trim()) return
    const { data, error } = await supabase.from('business_catalysts').insert({
      deal_id: id, ...newCatalyst,
    }).select().single()
    if (!error && data) { setCatalysts(prev => [...prev, data]); setShowAddCatalyst(false); setNewCatalyst({ catalyst: '', category: 'internal', urgency: 'medium', impact: '' }) }
  }

  async function addPainPoint() {
    if (!newPain.pain_description.trim()) return
    const { data, error } = await supabase.from('deal_pain_points').insert({
      deal_id: id, ...newPain, annual_cost: Number(newPain.annual_cost) || null,
      source: 'manual', verified: false,
    }).select().single()
    if (!error && data) { setPainPoints(prev => [...prev, data].sort((a, b) => (b.annual_cost || 0) - (a.annual_cost || 0))); setShowAddPain(false); setNewPain({ pain_description: '', category: 'operational', annual_cost: '', affected_team: '', notes: '' }) }
  }

  async function togglePainProposal(painId, current) {
    await supabase.from('deal_pain_points').update({ include_in_proposal: !current }).eq('id', painId)
    setPainPoints(prev => prev.map(p => p.id === painId ? { ...p, include_in_proposal: !current } : p))
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const stage = STAGES.find(s => s.key === deal.stage)
  const days = daysUntil(deal.target_close_date)
  const openTasks = tasks.filter(t => !t.completed)
  const doneTasks = tasks.filter(t => t.completed)

  const stagesWithMilestones = mspStages.map(s => ({
    ...s, milestones: milestones.filter(m => m.msp_stage_id === s.id),
  }))

  const allStageOptions = [...STAGES, { key: 'closed_won', label: 'Closed Won' }, { key: 'closed_lost', label: 'Closed Lost' }, { key: 'disqualified', label: 'Disqualified' }]
  const totalPainCost = painPoints.reduce((s, p) => s + (p.annual_cost || 0), 0)
  const painCostColor = totalPainCost > 500000 ? T.error : totalPainCost > 100000 ? T.warning : T.primary

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
          <button onClick={() => navigate('/')} style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}>&larr; Pipeline</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{deal.company_name}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <StageBadge stage={deal.stage} />
              <ForecastBadge category={deal.forecast_category} />
              {deal.website && <span style={{ fontSize: 13, color: T.textSecondary }}>{deal.website}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{formatCurrency(deal.deal_value)}</div>
            <div style={{ fontSize: 12, color: T.textSecondary }}>
              {formatCurrency(deal.cmrr)}/mo CMRR
              {days != null && (
                <span style={{ marginLeft: 8, fontWeight: 600, color: days < 0 ? T.error : days <= 30 ? T.warning : T.success }}>
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

            {/* CALL HISTORY & ANALYSIS */}
            <Card title={`Call History & Analysis (${conversations.length})`} style={{ gridColumn: '1 / -1' }}>
              {/* Pre-QDC Research row */}
              {companyProfile && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  background: T.primaryLight, borderRadius: 6, marginBottom: 6, border: `1px solid ${T.primaryBorder}`,
                }}>
                  <Badge color={T.primary}>Research</Badge>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>Pre-QDC Research</div>
                  {companyProfile.researched_at && (
                    <span style={{ fontSize: 11, color: T.textSecondary }}>{formatDateLong(companyProfile.researched_at)}</span>
                  )}
                  <span style={{ fontSize: 12, color: T.textSecondary }}>
                    {companyProfile.industry || 'No data yet'}
                  </span>
                </div>
              )}
              {conversations.length === 0 ? (
                <div style={{ color: T.textMuted, fontSize: 13, padding: '8px 0' }}>No calls yet. Upload a transcript to get started.</div>
              ) : conversations.map(cv => {
                const score = callScores[cv.id]
                const scoreColor = score >= 80 ? T.success : score >= 60 ? T.primary : score >= 40 ? T.warning : T.error
                return (
                  <div key={cv.id} onClick={() => navigate(`/deal/${id}/call/${cv.id}`)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    background: T.surfaceAlt, borderRadius: 6, marginBottom: 6,
                    border: `1px solid ${T.borderLight}`, cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.primary}
                    onMouseLeave={e => e.currentTarget.style.borderColor = T.borderLight}
                  >
                    <Badge color={T.primary}>{cv.call_type}</Badge>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{cv.title || 'Untitled'}</div>
                      {cv.ai_summary && (
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cv.ai_summary.substring(0, 100)}{cv.ai_summary.length > 100 ? '...' : ''}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: T.textSecondary, whiteSpace: 'nowrap' }}>{formatDate(cv.call_date)}</span>
                    {cv.processed && <Badge color={T.success}>Processed</Badge>}
                    {cv.task_count > 0 && <Badge color={T.textMuted}>{cv.task_count} tasks</Badge>}
                    {score != null && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: scoreColor, fontFeatureSettings: '"tnum"', minWidth: 24, textAlign: 'right' }}>{score}</span>
                    )}
                  </div>
                )
              })}
            </Card>

            {/* WHY THIS DEAL? */}
            <Card title="Why This Deal?" style={{ gridColumn: '1 / -1' }}
              action={
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => setShowAddEvent(true)}>+ Event</Button>
                  <Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => setShowAddCatalyst(true)}>+ Catalyst</Button>
                </div>
              }>
              {showAddEvent && (
                <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, marginBottom: 12, border: `1px solid ${T.borderLight}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div><label style={labelStyle}>Event Description *</label>
                      <input style={inputStyle} value={newEvent.event_description} onChange={e => setNewEvent(p => ({ ...p, event_description: e.target.value }))} placeholder="What's happening?" autoFocus /></div>
                    <div><label style={labelStyle}>Date</label>
                      <input type="date" style={inputStyle} value={newEvent.event_date} onChange={e => setNewEvent(p => ({ ...p, event_date: e.target.value }))} /></div>
                    <div><label style={labelStyle}>Strength</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={newEvent.strength} onChange={e => setNewEvent(p => ({ ...p, strength: e.target.value }))}>
                        {['strong', 'medium', 'weak'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                    <div><label style={labelStyle}>Impact</label>
                      <input style={inputStyle} value={newEvent.impact} onChange={e => setNewEvent(p => ({ ...p, impact: e.target.value }))} placeholder="Business impact" /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button primary onClick={addEvent}>Add Event</Button>
                    <Button onClick={() => setShowAddEvent(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              {showAddCatalyst && (
                <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, marginBottom: 12, border: `1px solid ${T.borderLight}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div><label style={labelStyle}>Catalyst *</label>
                      <input style={inputStyle} value={newCatalyst.catalyst} onChange={e => setNewCatalyst(p => ({ ...p, catalyst: e.target.value }))} autoFocus /></div>
                    <div><label style={labelStyle}>Category</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={newCatalyst.category} onChange={e => setNewCatalyst(p => ({ ...p, category: e.target.value }))}>
                        {CATALYST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div><label style={labelStyle}>Urgency</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={newCatalyst.urgency} onChange={e => setNewCatalyst(p => ({ ...p, urgency: e.target.value }))}>
                        {['high', 'medium', 'low'].map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                    <div><label style={labelStyle}>Impact</label>
                      <input style={inputStyle} value={newCatalyst.impact} onChange={e => setNewCatalyst(p => ({ ...p, impact: e.target.value }))} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button primary onClick={addCatalyst}>Add Catalyst</Button>
                    <Button onClick={() => setShowAddCatalyst(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Compelling Events ({events.length})</div>
                  {events.length === 0 ? <div style={{ fontSize: 13, color: T.textMuted }}>None identified yet</div> : events.map(ev => (
                    <div key={ev.id} style={{ padding: '10px 12px', background: T.surfaceAlt, borderRadius: 6, marginBottom: 6, borderLeft: `3px solid ${STRENGTH_COLORS[ev.strength] || T.textMuted}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{ev.event_description}</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Badge color={STRENGTH_COLORS[ev.strength] || T.textMuted}>{ev.strength}</Badge>
                          {ev.verified && <Badge color={T.success}>Verified</Badge>}
                        </div>
                      </div>
                      {ev.event_date && <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>{formatDateLong(ev.event_date)}</div>}
                      {ev.impact && <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{ev.impact}</div>}
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Business Catalysts ({catalysts.length})</div>
                  {catalysts.length === 0 ? <div style={{ fontSize: 13, color: T.textMuted }}>None identified yet</div> : catalysts.map(cat => (
                    <div key={cat.id} style={{ padding: '10px 12px', background: T.surfaceAlt, borderRadius: 6, marginBottom: 6, borderLeft: `3px solid ${URGENCY_COLORS[cat.urgency] || T.textMuted}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{cat.catalyst}</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Badge color={T.primary}>{cat.category}</Badge>
                          <Badge color={URGENCY_COLORS[cat.urgency] || T.textMuted}>{cat.urgency}</Badge>
                        </div>
                      </div>
                      {cat.impact && <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{cat.impact}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* PAIN POINTS */}
            <Card title="Pain Points" style={{ gridColumn: '1 / -1' }}
              action={<Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => setShowAddPain(true)}>+ Add Pain</Button>}>
              {/* Running Problem Cost */}
              <div style={{ marginBottom: 16, padding: 16, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}` }}>
                <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Running Problem Cost</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: painCostColor, fontFeatureSettings: '"tnum"' }}>
                  {totalPainCost > 0 ? formatCurrency(totalPainCost) : '$0'}
                </div>
                {totalPainCost > 0 && (
                  <div style={{ height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden', marginTop: 8, maxWidth: 400 }}>
                    <div style={{ height: '100%', width: `${Math.min((totalPainCost / 1000000) * 100, 100)}%`, background: painCostColor, borderRadius: 3, transition: 'width 0.4s' }} />
                  </div>
                )}
              </div>

              {showAddPain && (
                <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, marginBottom: 12, border: `1px solid ${T.borderLight}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div><label style={labelStyle}>Description *</label>
                      <input style={inputStyle} value={newPain.pain_description} onChange={e => setNewPain(p => ({ ...p, pain_description: e.target.value }))} autoFocus /></div>
                    <div><label style={labelStyle}>Category</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={newPain.category} onChange={e => setNewPain(p => ({ ...p, category: e.target.value }))}>
                        {PAIN_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div><label style={labelStyle}>Annual Cost ($)</label>
                      <input type="number" style={inputStyle} value={newPain.annual_cost} onChange={e => setNewPain(p => ({ ...p, annual_cost: e.target.value }))} placeholder="0" /></div>
                    <div><label style={labelStyle}>Affected Team</label>
                      <input style={inputStyle} value={newPain.affected_team} onChange={e => setNewPain(p => ({ ...p, affected_team: e.target.value }))} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button primary onClick={addPainPoint}>Add Pain Point</Button>
                    <Button onClick={() => setShowAddPain(false)}>Cancel</Button>
                  </div>
                </div>
              )}

              {painPoints.length === 0 ? <div style={{ color: T.textMuted, fontSize: 13 }}>No pain points identified yet.</div> : painPoints.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  background: T.surfaceAlt, borderRadius: 6, marginBottom: 6, border: `1px solid ${T.borderLight}`,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.pain_description}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                      <Badge color={T.primary}>{p.category}</Badge>
                      {p.affected_team && <span style={{ fontSize: 11, color: T.textSecondary }}>{p.affected_team}</span>}
                      {p.verified ? <Badge color={T.success}>Verified</Badge> : <Badge color={T.textMuted}>Unverified</Badge>}
                      {p.source === 'ai_extracted' ? (
                        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <Badge color={T.primary}>AI</Badge>
                          {p.speaker_name && <span style={{ fontSize: 10, color: T.textMuted }}>{p.speaker_name}</span>}
                        </span>
                      ) : <Badge color={T.textMuted}>Manual</Badge>}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"', whiteSpace: 'nowrap' }}>
                    {p.annual_cost ? formatCurrency(p.annual_cost) : '--'}
                  </div>
                  <div onClick={() => togglePainProposal(p.id, p.include_in_proposal)} style={{
                    width: 32, height: 18, borderRadius: 9, cursor: 'pointer',
                    background: p.include_in_proposal ? T.success : T.borderLight,
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }} title="Include in proposal">
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', background: '#fff',
                      position: 'absolute', top: 2, left: p.include_in_proposal ? 16 : 2,
                      boxShadow: T.shadow, transition: 'left 0.2s',
                    }} />
                  </div>
                </div>
              ))}
            </Card>

            {/* DEAL RISKS */}
            <Card title={`Deal Risks (${risks.length})`} style={{ gridColumn: '1 / -1' }}
              action={<Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => setShowAddRisk(true)}>+ Add Risk</Button>}>
              {showAddRisk && (
                <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, marginBottom: 12, border: `1px solid ${T.borderLight}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div><label style={labelStyle}>Risk Description *</label>
                      <input style={inputStyle} value={newRisk.risk_description} onChange={e => setNewRisk(p => ({ ...p, risk_description: e.target.value }))} autoFocus /></div>
                    <div><label style={labelStyle}>Category</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={newRisk.category} onChange={e => setNewRisk(p => ({ ...p, category: e.target.value }))}>
                        {RISK_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></div>
                    <div><label style={labelStyle}>Severity</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={newRisk.severity} onChange={e => setNewRisk(p => ({ ...p, severity: e.target.value }))}>
                        {['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                    <div><label style={labelStyle}>Mitigation Plan</label>
                      <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={newRisk.mitigation_plan} onChange={e => setNewRisk(p => ({ ...p, mitigation_plan: e.target.value }))} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button primary onClick={addRisk}>Add Risk</Button>
                    <Button onClick={() => setShowAddRisk(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              {risks.length === 0 ? <div style={{ color: T.textMuted, fontSize: 13 }}>No risks identified.</div> : risks.map(r => (
                <div key={r.id} style={{ padding: '10px 12px', background: T.surfaceAlt, borderRadius: 6, marginBottom: 6, border: `1px solid ${T.borderLight}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, cursor: 'pointer' }}
                        onClick={() => setExpandedRisk(expandedRisk === r.id ? null : r.id)}>
                        {r.risk_description}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <Badge color={SEVERITY_COLORS[r.severity] || T.textMuted}>{r.severity}</Badge>
                        <Badge color={STATUS_COLORS[r.status] || T.textMuted}>{r.status}</Badge>
                        <Badge color={T.primary}>{(r.category || '').replace(/_/g, ' ')}</Badge>
                        {r.source === 'ai_extracted' && <Badge color={T.primary}>AI</Badge>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, color: T.textSecondary }}>
                      {r.owner && <div>{r.owner}</div>}
                      {r.due_date && <div>{formatDate(r.due_date)}</div>}
                    </div>
                  </div>
                  {expandedRisk === r.id && r.mitigation_plan && (
                    <div style={{ marginTop: 8, padding: 10, background: T.surface, borderRadius: 4, fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>
                      <strong>Mitigation:</strong> {r.mitigation_plan}
                    </div>
                  )}
                </div>
              ))}
            </Card>

            {/* Deal Analysis (editable) */}
            <Card title="Deal Analysis">
              <EditableField label="Pain Points" value={analysis?.pain_points} field="pain_points" table="deal_analysis" recordId={analysis?.id} type="textarea"
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Quantified Pain" value={analysis?.quantified_pain} field="quantified_pain" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Business Impact" value={analysis?.business_impact} field="business_impact" table="deal_analysis" recordId={analysis?.id} type="textarea"
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Decision Criteria" value={analysis?.decision_criteria} field="decision_criteria" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Timeline Drivers" value={analysis?.timeline_drivers} field="timeline_drivers" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Driving Factors" value={analysis?.driving_factors} field="driving_factors" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Integrations Needed" value={analysis?.integrations_needed} field="integrations_needed" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Exec Alignment" value={analysis?.exec_alignment} field="exec_alignment" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
            </Card>

            {/* Qualification (editable) */}
            <Card title="Qualification">
              <EditableField label="Champion" value={analysis?.champion} field="champion" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Economic Buyer" value={analysis?.economic_buyer} field="economic_buyer" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Budget" value={analysis?.budget} field="budget" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <EditableField label="Decision Process" value={analysis?.decision_process} field="decision_process" table="deal_analysis" recordId={analysis?.id}
                onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <div style={{ flex: 1, background: T.errorLight, borderRadius: 6, padding: 12 }}>
                  <EditableField label="Red Flags" value={analysis?.red_flags} field="red_flags" table="deal_analysis" recordId={analysis?.id} type="textarea"
                    onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                </div>
                <div style={{ flex: 1, background: T.successLight, borderRadius: 6, padding: 12 }}>
                  <EditableField label="Green Flags" value={analysis?.green_flags} field="green_flags" table="deal_analysis" recordId={analysis?.id} type="textarea"
                    onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                </div>
              </div>
            </Card>

            {/* Scores + Deal Fields */}
            <Card title="Scores & Deal Info">
              <ScoreBar score={deal.fit_score || 0} label="Fit" />
              <ScoreBar score={deal.deal_health_score || 0} label="Health" />
              <div style={{ marginTop: 12 }}>
                <EditableField label="Stage" value={deal.stage} field="stage" table="deals" recordId={deal.id} type="select"
                  options={allStageOptions} onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                <EditableField label="Forecast" value={deal.forecast_category} field="forecast_category" table="deals" recordId={deal.id} type="select"
                  options={FORECAST_CATEGORIES} onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                <EditableField label="Deal Value" value={deal.deal_value} field="deal_value" table="deals" recordId={deal.id} type="number"
                  onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                <EditableField label="CMRR" value={deal.cmrr} field="cmrr" table="deals" recordId={deal.id} type="number"
                  onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                <EditableField label="Target Close" value={deal.target_close_date} field="target_close_date" table="deals" recordId={deal.id} type="date"
                  onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
              </div>
            </Card>

            {/* Company Profile (editable) */}
            <Card title="Company Profile">
              <EditableField label="Industry" value={companyProfile?.industry} field="industry" table="company_profile" recordId={companyProfile?.id}
                onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
              <EditableField label="Revenue" value={companyProfile?.revenue} field="revenue" table="company_profile" recordId={companyProfile?.id}
                onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
              <EditableField label="Employees" value={companyProfile?.employee_count} field="employee_count" table="company_profile" recordId={companyProfile?.id}
                onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
              <EditableField label="Tech Stack" value={companyProfile?.tech_stack} field="tech_stack" table="company_profile" recordId={companyProfile?.id} type="textarea"
                onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
              <EditableField label="Headquarters" value={companyProfile?.headquarters} field="headquarters" table="company_profile" recordId={companyProfile?.id}
                onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
              <EditableField label="Business Goals" value={companyProfile?.business_goals} field="business_goals" table="company_profile" recordId={companyProfile?.id} type="textarea"
                onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
              <EditableField label="Business Priorities" value={companyProfile?.business_priorities} field="business_priorities" table="company_profile" recordId={companyProfile?.id} type="textarea"
                onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
            </Card>

            {/* Competition */}
            {competitors.length > 0 && (
              <Card title="Competition" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {competitors.map(c => (
                    <div key={c.id} style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}` }}>
                      {editingCompetitor === c.id ? (
                        <div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div><label style={labelStyle}>Name</label><input style={inputStyle} value={editCompData.competitor_name || ''} onChange={e => setEditCompData(p => ({ ...p, competitor_name: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Strengths</label><textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} value={editCompData.strengths || ''} onChange={e => setEditCompData(p => ({ ...p, strengths: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Weaknesses</label><textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} value={editCompData.weaknesses || ''} onChange={e => setEditCompData(p => ({ ...p, weaknesses: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Strategy</label><textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} value={editCompData.strategy || ''} onChange={e => setEditCompData(p => ({ ...p, strategy: e.target.value }))} /></div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <Button primary onClick={() => saveCompetitor(c.id)}>Save</Button>
                            <Button onClick={() => setEditingCompetitor(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{c.competitor_name}</div>
                            <Button style={{ padding: '3px 8px', fontSize: 10 }} onClick={() => { setEditingCompetitor(c.id); setEditCompData({ ...c }) }}>Edit</Button>
                          </div>
                          <Field label="Strengths" value={c.strengths} />
                          <Field label="Weaknesses" value={c.weaknesses} />
                          <Field label="Strategy" value={c.strategy} />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Key Dates */}
            <Card title="Key Dates" style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                <EditableField label="Decision Date" value={analysis?.decision_date} field="decision_date" table="deal_analysis" recordId={analysis?.id} type="date"
                  onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Signature Date" value={analysis?.signature_date} field="signature_date" table="deal_analysis" recordId={analysis?.id} type="date"
                  onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Kickoff Date" value={analysis?.kickoff_date} field="kickoff_date" table="deal_analysis" recordId={analysis?.id} type="date"
                  onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Go-Live Date" value={analysis?.go_live_date} field="go_live_date" table="deal_analysis" recordId={analysis?.id} type="date"
                  onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Busy Season" value={analysis?.busy_season} field="busy_season" table="deal_analysis" recordId={analysis?.id}
                  onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              </div>
            </Card>

            {/* Next Steps */}
            <Card title="Next Steps" style={{ gridColumn: '1 / -1' }}>
              <EditableField label="" value={deal.next_steps} field="next_steps" table="deals" recordId={deal.id} type="textarea"
                onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
            </Card>

            {/* Notes */}
            <Card title="My Notes" style={{ gridColumn: '1 / -1' }}>
              <EditableField label="" value={deal.notes} field="notes" table="deals" recordId={deal.id} type="textarea"
                onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
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
                      {editingContact === c.id ? (
                        <div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                            <div><label style={labelStyle}>Name</label><input style={inputStyle} value={editContactData.name || ''} onChange={e => setEditContactData(p => ({ ...p, name: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Title</label><input style={inputStyle} value={editContactData.title || ''} onChange={e => setEditContactData(p => ({ ...p, title: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Email</label><input style={inputStyle} value={editContactData.email || ''} onChange={e => setEditContactData(p => ({ ...p, email: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Department</label><input style={inputStyle} value={editContactData.department || ''} onChange={e => setEditContactData(p => ({ ...p, department: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Role in Deal</label><input style={inputStyle} value={editContactData.role_in_deal || ''} onChange={e => setEditContactData(p => ({ ...p, role_in_deal: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Priorities</label><input style={inputStyle} value={editContactData.priorities || ''} onChange={e => setEditContactData(p => ({ ...p, priorities: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Communication Style</label><input style={inputStyle} value={editContactData.communication_style || ''} onChange={e => setEditContactData(p => ({ ...p, communication_style: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Influence</label>
                              <select style={{ ...inputStyle, cursor: 'pointer' }} value={editContactData.influence_level || ''} onChange={e => setEditContactData(p => ({ ...p, influence_level: e.target.value }))}>
                                <option value="">Unknown</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                              </select></div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            {['is_champion', 'is_economic_buyer', 'is_signer'].map(flag => (
                              <label key={flag} style={{ fontSize: 12, color: T.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input type="checkbox" checked={editContactData[flag] || false} onChange={e => setEditContactData(p => ({ ...p, [flag]: e.target.checked }))} />
                                {flag.replace('is_', '').replace('_', ' ')}
                              </label>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                            <Button primary onClick={() => saveContact(c.id)}>Save</Button>
                            <Button onClick={() => setEditingContact(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                            <div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{c.name}</div>
                              <div style={{ fontSize: 12, color: T.textSecondary }}>{c.title}{c.department ? ` - ${c.department}` : ''}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              {c.is_champion && <Badge color={T.success}>Champion</Badge>}
                              {c.is_economic_buyer && <Badge color={T.primary}>EB</Badge>}
                              {c.is_signer && <Badge color={T.warning}>Signer</Badge>}
                              <Badge color={c.influence_level === 'high' ? T.error : c.influence_level === 'medium' ? T.warning : T.textMuted}>
                                {c.influence_level || 'Unknown'}
                              </Badge>
                              <Button style={{ padding: '3px 8px', fontSize: 10 }} onClick={() => { setEditingContact(c.id); setEditContactData({ ...c }) }}>Edit</Button>
                            </div>
                          </div>
                          <Field label="Role in Deal" value={c.role_in_deal} />
                          <Field label="Priorities" value={c.priorities} />
                          <Field label="Communication Style" value={c.communication_style} />
                          {c.email && <div style={{ fontSize: 12, color: T.primary }}>{c.email}</div>}
                        </>
                      )}
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
                <div key={cv.id} onClick={() => navigate(`/deal/${id}/call/${cv.id}`)} style={{ cursor: 'pointer' }}>
                  <Card>
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
                      }}>{cv.ai_summary}</div>
                    )}
                  </Card>
                </div>
              ))}
          </div>
        )}

        {/* ===== MSP TAB ===== */}
        {tab === 'msp' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Mutual Success Plan</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button primary onClick={() => navigate(`/deal/${id}/msp`)}>Open Full MSP</Button>
                <Button>+ Add Stage</Button>
              </div>
            </div>
            {stagesWithMilestones.length === 0
              ? <EmptyState message="No MSP stages yet. Create stages and milestones to track your deal timeline." action={<Button primary style={{ marginTop: 8 }}>Create MSP</Button>} />
              : stagesWithMilestones.map((s, si) => (
                <Card key={s.id}
                  title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: '50%', background: s.is_completed ? T.success : T.primary,
                      color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
                    }}>{si + 1}</span>
                    {s.stage_name}
                    {s.is_completed && <Badge color={T.success}>Done</Badge>}
                  </span>}
                  action={<span style={{ fontSize: 11, color: T.textSecondary }}>{s.start_date && `Start: ${formatDate(s.start_date)}`}</span>}
                >
                  {s.milestones.length === 0
                    ? <div style={{ color: T.textMuted, fontSize: 13 }}>No milestones</div>
                    : s.milestones.map(ms => (
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
                        <input type="date" value={ms.due_date?.split('T')[0] || ''}
                          onChange={e => updateMilestoneDate(ms.id, e.target.value)}
                          style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 11 }} />
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
              <div style={{ display: 'flex', gap: 8 }}>
                {proposalDoc && <Button primary onClick={() => navigate(`/deal/${id}/proposal`)}>Edit in Builder</Button>}
                <Button onClick={() => navigate(`/deal/${id}/quote/new`)}>New Quote</Button>
              </div>
            </div>
            {!proposalDoc && quotes.length === 0
              ? <EmptyState message="No proposal or quote yet." action={<Button primary onClick={() => navigate(`/deal/${id}/proposal`)} style={{ marginTop: 8 }}>Create Proposal</Button>} />
              : (
                <div>
                  {proposalDoc && (
                    <>
                      <Card title={`Proposal v${proposalDoc.version}`} action={<Badge color={T.primary}>Draft</Badge>}>
                        <Field label="Executive Summary" value={proposalDoc.executive_summary} />
                      </Card>
                      <Card title="Financial Summary">
                        <div style={{ display: 'flex', gap: 24 }}>
                          <div><div style={labelStyle}>Annual Impact</div><div style={{ fontSize: 22, fontWeight: 700, color: T.success }}>{proposalDoc.total_annual_impact || '--'}</div></div>
                          <div><div style={labelStyle}>Investment</div><div style={{ fontSize: 22, fontWeight: 700, color: T.text }}>{proposalDoc.implementation_investment || formatCurrency(deal.deal_value)}</div></div>
                          <div><div style={labelStyle}>ROI</div><div style={{ fontSize: 22, fontWeight: 700, color: T.primary }}>{proposalDoc.expected_roi || '--'}</div></div>
                        </div>
                      </Card>
                    </>
                  )}
                  {quotes.length > 0 && (
                    <Card title={`Quotes (${quotes.length})`}>
                      {quotes.map(q => (
                        <div key={q.id} onClick={() => navigate(`/deal/${id}/quote/${q.id}`)} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '12px 14px', background: T.surfaceAlt, borderRadius: 6,
                          marginBottom: 8, border: `1px solid ${T.borderLight}`, cursor: 'pointer',
                        }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = T.primary}
                          onMouseLeave={e => e.currentTarget.style.borderColor = T.borderLight}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Quote v{q.version} {q.quote_number && `(${q.quote_number})`}</div>
                            <div style={{ fontSize: 11, color: T.textSecondary }}>{q.contract_years}yr | {formatCurrency(q.arr)} ARR</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <Badge color={q.status === 'approved' ? T.success : q.status === 'sent' ? T.primary : T.textMuted}>{q.status}</Badge>
                            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{formatCurrency(q.net_price)}</div>
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
                      <button onClick={() => toggleTask(t.id)} style={{
                        width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${T.border}`, background: 'transparent',
                        cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                      }} />
                      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: t.priority === 'high' ? T.error : t.priority === 'medium' ? T.warning : T.textMuted }} />
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
                    <button onClick={() => toggleTask(t.id)} style={{
                      width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${T.success}`, background: T.success,
                      cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}><span style={{ color: '#fff', fontSize: 12 }}>&#10003;</span></button>
                    <span style={{ flex: 1, fontSize: 13, color: T.textMuted, textDecoration: 'line-through' }}>{t.title}</span>
                  </div>
                ))}
              </Card>
            )}
            {openTasks.length === 0 && doneTasks.length === 0 && <EmptyState message="No tasks for this deal yet." />}
          </div>
        )}
      </div>
    </div>
  )
}
