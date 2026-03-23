import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatCurrency, formatDate, formatDateLong, daysUntil, STAGES, FORECAST_CATEGORIES, CALL_TYPES, TASK_CATEGORIES } from '../lib/theme'
import { Card, Badge, ForecastBadge, StageBadge, ScoreBar, Field, StatusDot, TabBar, Button, EmptyState, Spinner, inputStyle, labelStyle } from '../components/Shared'
import TranscriptUpload from '../components/TranscriptUpload'
import { callGenerateEmail, callResearchFunction } from '../lib/webhooks'
import { useAuth } from '../hooks/useAuth'

// === LOCAL LABEL STYLE ===
const ddLabelStyle = { fontSize: 11, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' }
const unknownStyle = { color: '#e8a0a0', fontStyle: 'italic', fontWeight: 400 }

// === BULLET ITEM with bold colon prefix ===
function BulletText({ text }) {
  if (text.includes(':')) {
    const colonIdx = text.indexOf(':')
    return <><span style={{ fontWeight: 700, color: T.text }}>{text.substring(0, colonIdx)}:</span>{text.substring(colonIdx + 1)}</>
  }
  return text
}

// === EDITABLE FIELD COMPONENT ===
function EditableField({ label, value, field, table, recordId, onSaved, type = 'text', options, displayAs }) {
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
          <div style={ddLabelStyle}>{label}</div>
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
          <div style={ddLabelStyle}>{label}</div>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={val}
            onChange={e => setVal(e.target.value)} onBlur={save} autoFocus />
        </div>
      )
    }
    if (type === 'date') {
      return (
        <div style={{ marginBottom: 12 }}>
          <div style={ddLabelStyle}>{label}</div>
          <input type="date" style={inputStyle} value={val} onChange={e => setVal(e.target.value)}
            onBlur={save} onKeyDown={handleKeyDown} autoFocus />
        </div>
      )
    }
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={ddLabelStyle}>{label}</div>
        <input type={type === 'number' ? 'number' : 'text'} style={inputStyle} value={val}
          onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={handleKeyDown} autoFocus />
      </div>
    )
  }

  const displayVal = type === 'select' && options
    ? (options.find(o => o.key === value)?.label || value)
    : type === 'date' ? formatDateLong(value) : value

  // List display for semicolon-separated fields
  if (displayAs === 'list' && value && value !== 'Unknown') {
    const items = value.split(/[;|\n]/).map(s => s.trim()).filter(s => s.length > 3)
    if (items.length > 0 && !(items.length === 1 && items[0] === 'Unknown')) {
      return (
        <div style={{ marginBottom: 12, cursor: 'pointer', position: 'relative' }}
          onClick={() => setEditing(true)}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <div style={{ ...ddLabelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
            {label}
            {hover && <span style={{ fontSize: 10, color: T.textMuted }}>{'\u270E'}</span>}
            {saved && <span style={{ fontSize: 10, color: T.success, fontWeight: 600 }}>Saved</span>}
          </div>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
              <span style={{ color: T.textMuted, flexShrink: 0 }}>&bull;</span>
              <span><BulletText text={item} /></span>
            </div>
          ))}
        </div>
      )
    }
  }

  return (
    <div style={{ marginBottom: 12, cursor: 'pointer', position: 'relative' }}
      onClick={() => setEditing(true)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ ...ddLabelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {hover && <span style={{ fontSize: 10, color: T.textMuted }}>{'\u270E'}</span>}
        {saved && <span style={{ fontSize: 10, color: T.success, fontWeight: 600 }}>Saved</span>}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: type === 'textarea' ? 'pre-wrap' : undefined, ...((!displayVal || displayVal === 'Unknown') ? unknownStyle : { color: T.text, fontWeight: 600 }) }}>
        {(!displayVal || displayVal === 'Unknown') ? (displayVal === 'Unknown' ? 'Unknown' : 'Click to edit') : displayVal}
      </div>
    </div>
  )
}

// === LIST FIELD (renders semicolon-separated text as bullet list) ===
function ListField({ label, value }) {
  const items = (value || '').split(/[;|\n]/).map(s => s.trim()).filter(s => s.length > 3)
  if (!items.length || (items.length === 1 && items[0] === 'Unknown')) return (
    <div style={{ marginBottom: 12 }}>
      <div style={ddLabelStyle}>{label}</div>
      <div style={unknownStyle}>Unknown</div>
    </div>
  )
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={ddLabelStyle}>{label}</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
          <span style={{ color: T.textMuted, flexShrink: 0 }}>&bull;</span>
          <span><BulletText text={item} /></span>
        </div>
      ))}
    </div>
  )
}

// === PARAGRAPH FIELD (renders long text with line breaks on periods/semicolons) ===
function ParagraphField({ label, value }) {
  if (!value || value === 'Unknown') return (
    <div style={{ marginBottom: 12 }}>
      <div style={ddLabelStyle}>{label}</div>
      <div style={unknownStyle}>Unknown</div>
    </div>
  )
  const lines = value.split(/[;|\n]/).map(s => s.trim()).filter(s => s.length > 3)
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={ddLabelStyle}>{label}</div>
      {lines.map((line, i) => (
        <div key={i} style={{ fontSize: 13, color: T.text, lineHeight: 1.6, marginBottom: 4 }}>{line}</div>
      ))}
    </div>
  )
}

// === SMALL DELETE BUTTON ===
function DeleteBtn({ onClick, title = 'Delete' }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted,
      fontSize: 14, padding: '2px 4px', lineHeight: 1, flexShrink: 0,
    }}
      onMouseEnter={e => e.currentTarget.style.color = T.error}
      onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
    >&times;</button>
  )
}

// === SEVERITY COLORS ===
const SEVERITY_COLORS = { critical: T.error, high: '#f97316', medium: T.warning, low: T.textMuted }
const STATUS_COLORS = { open: T.error, mitigating: T.warning, mitigated: T.success, accepted: T.textMuted, closed: T.textMuted }
const STRENGTH_COLORS = { strong: T.success, medium: T.warning, weak: T.error }
const URGENCY_COLORS = { high: T.error, medium: T.warning, low: T.textMuted }
const RISK_STATUSES = ['open', 'mitigating', 'mitigated', 'accepted', 'closed']

const RISK_CATEGORIES = ['timing', 'competition', 'budget', 'access_to_power', 'functionality', 'personnel', 'legal', 'integration', 'adoption', 'general']
const PAIN_CATEGORIES = ['financial', 'operational', 'compliance', 'growth', 'competitive', 'technology', 'personnel', 'custom']
const CATALYST_CATEGORIES = ['regulatory', 'market', 'competitive', 'internal', 'technology', 'financial', 'personnel']

export default function DealDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [deal, setDeal] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [companyProfile, setCompanyProfile] = useState(null)
  const [contacts, setContacts] = useState([])
  const [conversations, setConversations] = useState([])
  const [mspStages, setMspStages] = useState([])
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

  // Transcript upload modal
  const [showTranscriptUpload, setShowTranscriptUpload] = useState(false)

  // Research
  const [researchStatus, setResearchStatus] = useState(null) // null | 'in_progress' | 'complete'
  const [researchRunning, setResearchRunning] = useState(false)

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
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', priority: 'medium', due_date: '', notes: '' })
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', title: '', email: '', role_in_deal: '' })

  // Email generation
  const [showEmailGenerator, setShowEmailGenerator] = useState(false)
  const [emailTemplates, setEmailTemplates] = useState([])
  const [selectedEmailTpl, setSelectedEmailTpl] = useState('')
  const [selectedEmailConv, setSelectedEmailConv] = useState('')
  const [generatingEmail, setGeneratingEmail] = useState(false)
  const [emailResult, setEmailResult] = useState(null)
  const [generatedEmails, setGeneratedEmails] = useState([])
  const [expandedEmail, setExpandedEmail] = useState(null)

  useEffect(() => { if (id && id !== 'new') loadDeal() }, [id])

  async function loadDeal() {
    setLoading(true)
    try {
      const [dealRes, analysisRes, profileRes, contactsRes, convosRes, mspRes, propDocRes, propInsRes, tasksRes, quotesRes, compRes, risksRes, eventsRes, catalystsRes, painsRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', id).single(),
        supabase.from('deal_analysis').select('*').eq('deal_id', id).single(),
        supabase.from('company_profile').select('*').eq('deal_id', id).single(),
        supabase.from('contacts').select('*').eq('deal_id', id).order('created_at'),
        supabase.from('conversations').select('*').eq('deal_id', id).order('call_date', { ascending: false }),
        supabase.from('msp_stages').select('*').eq('deal_id', id).order('stage_order'),
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
      setProposalDoc(propDocRes.data?.[0] || null)
      setProposalInsights(propInsRes.data || [])
      setTasks(tasksRes.data || [])
      setQuotes(quotesRes.data || [])
      setCompetitors(compRes.data || [])
      setRisks(risksRes.data || [])
      setEvents(eventsRes.data || [])
      setCatalysts(catalystsRes.data || [])
      setPainPoints(painsRes.data || [])

      // Load generated emails
      const { data: genEmails } = await supabase.from('generated_emails').select('*').eq('deal_id', id).order('created_at', { ascending: false })
      setGeneratedEmails(genEmails || [])

      // Load email templates for the coach
      if (profile?.active_coach_id) {
        const { data: eTpls } = await supabase.from('email_templates').select('*').eq('coach_id', profile.active_coach_id).eq('active', true).order('sort_order')
        setEmailTemplates(eTpls || [])
      }

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

  // Poll for research completion when company_profile has no researched_at
  useEffect(() => {
    if (!companyProfile || companyProfile.researched_at) {
      setResearchStatus(null)
      return
    }
    setResearchStatus('in_progress')
    const interval = setInterval(async () => {
      const { data } = await supabase.from('company_profile').select('researched_at').eq('deal_id', id).single()
      if (data?.researched_at) {
        setResearchStatus('complete')
        clearInterval(interval)
        setTimeout(() => { setResearchStatus(null); loadDeal() }, 3000)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [companyProfile?.researched_at, id])

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

  async function deleteContact(contactId) {
    if (!window.confirm('Delete this contact?')) return
    await supabase.from('contacts').delete().eq('id', contactId)
    setContacts(prev => prev.filter(c => c.id !== contactId))
  }

  async function deletePainPoint(painId) {
    await supabase.from('deal_pain_points').delete().eq('id', painId)
    setPainPoints(prev => prev.filter(p => p.id !== painId))
  }

  async function deleteRisk(riskId) {
    await supabase.from('deal_risks').delete().eq('id', riskId)
    setRisks(prev => prev.filter(r => r.id !== riskId))
  }

  async function deleteEvent(eventId) {
    await supabase.from('compelling_events').delete().eq('id', eventId)
    setEvents(prev => prev.filter(e => e.id !== eventId))
  }

  async function deleteCatalyst(catalystId) {
    await supabase.from('business_catalysts').delete().eq('id', catalystId)
    setCatalysts(prev => prev.filter(c => c.id !== catalystId))
  }

  async function updatePainField(painId, field, value) {
    await supabase.from('deal_pain_points').update({ [field]: value }).eq('id', painId)
    setPainPoints(prev => prev.map(p => p.id === painId ? { ...p, [field]: value } : p))
  }

  async function updateRiskField(riskId, field, value) {
    await supabase.from('deal_risks').update({ [field]: value }).eq('id', riskId)
    setRisks(prev => prev.map(r => r.id === riskId ? { ...r, [field]: value } : r))
  }

  async function addTask() {
    if (!newTask.title.trim()) return
    const { data, error } = await supabase.from('tasks').insert({
      deal_id: id, title: newTask.title.trim(), priority: newTask.priority,
      due_date: newTask.due_date || null, notes: newTask.notes || null,
      auto_generated: false, completed: false,
    }).select().single()
    if (!error && data) { setTasks(prev => [data, ...prev]); setShowAddTask(false); setNewTask({ title: '', priority: 'medium', due_date: '', notes: '' }) }
  }

  async function deleteTask(taskId) {
    if (!window.confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }

  async function addNewContact() {
    if (!newContact.name.trim()) return
    const { data, error } = await supabase.from('contacts').insert({
      deal_id: id, name: newContact.name.trim(), title: newContact.title || null,
      email: newContact.email || null, role_in_deal: newContact.role_in_deal || null,
      influence_level: 'Unknown',
    }).select().single()
    if (!error && data) { setContacts(prev => [...prev, data]); setShowAddContact(false); setNewContact({ name: '', title: '', email: '', role_in_deal: '' }) }
  }

  async function rerunResearch() {
    setResearchRunning(true)
    try {
      const res = await callResearchFunction(id)
      if (res.error) alert('Research failed: ' + res.error)
      else setResearchStatus('in_progress')
    } catch (err) { alert('Research failed') }
    finally { setResearchRunning(false) }
  }

  async function generateEmail() {
    if (!selectedEmailTpl) return
    setGeneratingEmail(true)
    setEmailResult(null)
    const res = await callGenerateEmail(id, selectedEmailTpl, selectedEmailConv || null)
    setGeneratingEmail(false)
    if (res.error) {
      setEmailResult({ error: res.error })
    } else {
      setEmailResult({ subject: res.subject || res.email?.subject || '', body: res.body || res.email?.body || '', id: res.id || res.email?.id })
      loadDeal()
    }
  }

  async function deleteGeneratedEmail(emailId) {
    await supabase.from('generated_emails').delete().eq('id', emailId)
    setGeneratedEmails(prev => prev.filter(e => e.id !== emailId))
  }

  async function updateGeneratedEmail(emailId, field, value) {
    await supabase.from('generated_emails').update({ [field]: value }).eq('id', emailId)
    setGeneratedEmails(prev => prev.map(e => e.id === emailId ? { ...e, [field]: value } : e))
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const stage = STAGES.find(s => s.key === deal.stage)
  const days = daysUntil(deal.target_close_date)
  const openTasks = tasks.filter(t => !t.completed)
  const doneTasks = tasks.filter(t => t.completed)


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
    { key: 'emails', label: `Emails (${generatedEmails.length})` },
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
          <div style={{ display: 'flex', gap: 8 }}>
            <Button primary onClick={() => setShowTranscriptUpload(true)} style={{ padding: '6px 12px', fontSize: 11 }}>Upload Transcript</Button>
            <Button primary onClick={() => setShowEmailGenerator(true)} style={{ padding: '6px 12px', fontSize: 11 }}>Generate Email</Button>
            <Button onClick={rerunResearch} disabled={researchRunning} style={{ padding: '6px 12px', fontSize: 11 }}>
              {researchRunning ? 'Researching...' : 'Re-run Research'}
            </Button>
            <Button danger onClick={async () => {
              if (!window.confirm('Delete this deal? This cannot be undone.')) return
              await supabase.from('deals').delete().eq('id', deal.id)
              navigate('/')
            }} style={{ padding: '6px 12px', fontSize: 11 }}>Delete Deal</Button>
          </div>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: '16px 24px' }}>

        {/* Research status banner */}
        {researchStatus === 'in_progress' && (
          <div style={{
            padding: '12px 18px', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
            background: T.primaryLight, border: `1px solid ${T.primaryBorder}`, animation: 'pulse 2s ease-in-out infinite',
          }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${T.primary}`, borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: T.primary, fontWeight: 600 }}>AI Research in Progress -- analyzing company data...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.7 } }`}</style>
          </div>
        )}
        {researchStatus === 'complete' && (
          <div style={{
            padding: '12px 18px', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
            background: T.successLight, border: `1px solid ${T.success}25`,
          }}>
            <span style={{ fontSize: 14, color: T.success }}>&#10003;</span>
            <span style={{ fontSize: 13, color: T.success, fontWeight: 600 }}>Research Complete -- reloading deal data...</span>
          </div>
        )}

        {/* ===== OVERVIEW TAB ===== */}
        {tab === 'overview' && (
          <div>
            {/* Processing banner */}
            {conversations.some(c => !c.processed) && (
              <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, background: T.primaryLight, border: `1px solid ${T.primaryBorder}` }}>
                <span style={{ display: 'inline-block', width: 12, height: 12, border: `2px solid ${T.primary}`, borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: T.primary, flex: 1 }}>AI is analyzing a transcript. Refresh to see results.</span>
                <Button onClick={loadDeal} style={{ padding: '4px 12px', fontSize: 11 }}>Refresh</Button>
              </div>
            )}

            {/* TOP — Call History with Next Steps in header */}
            <Card title={`Call History (${conversations.length})`} action={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 300, maxWidth: 600 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', whiteSpace: 'nowrap', letterSpacing: '0.05em' }}>Next Steps:</span>
                <div style={{ flex: 1 }}>
                  <EditableField label="" value={deal.next_steps} field="next_steps" table="deals" recordId={deal.id} type="textarea" onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                </div>
              </div>
            }>
              {companyProfile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: T.primaryLight, borderRadius: 6, marginBottom: 6, border: `1px solid ${T.primaryBorder}` }}>
                  <Badge color={T.primary}>Research</Badge>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>Pre-QDC Research</div>
                  {companyProfile.researched_at && <span style={{ fontSize: 11, color: T.textSecondary }}>{formatDateLong(companyProfile.researched_at)}</span>}
                  <span style={{ fontSize: 12, color: T.textSecondary }}>{companyProfile.industry || 'No data yet'}</span>
                </div>
              )}
              {conversations.length === 0 ? (
                <div style={{ color: '#bbb', fontSize: 13, fontStyle: 'italic', padding: '8px 0' }}>No calls yet. Upload a transcript to get started.</div>
              ) : conversations.map(cv => {
                const score = callScores[cv.id]
                const scoreColor = score >= 80 ? '#27ae60' : score >= 60 ? T.primary : score >= 40 ? T.warning : '#e74c3c'
                return (
                  <div key={cv.id} onClick={() => navigate(`/deal/${id}/call/${cv.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: T.surfaceAlt, borderRadius: 6, marginBottom: 4, border: `1px solid ${T.borderLight}`, cursor: 'pointer', transition: 'border-color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.primary} onMouseLeave={e => e.currentTarget.style.borderColor = T.borderLight}>
                    <Badge color={T.primary}>{cv.call_type}</Badge>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{cv.title || 'Untitled'}</div>
                      {cv.ai_summary && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cv.ai_summary.substring(0, 140)}</div>}
                    </div>
                    <span style={{ fontSize: 11, color: T.textSecondary, whiteSpace: 'nowrap' }}>{formatDate(cv.call_date)}</span>
                    {cv.processed ? <Badge color={T.success}>Complete</Badge> : (<>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: T.warning, textTransform: 'uppercase', animation: 'pulse 2s ease-in-out infinite' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: T.warning }} />Processing...</span>
                      <Button primary style={{ padding: '3px 10px', fontSize: 11 }} onClick={async (e) => { e.stopPropagation(); const { callProcessTranscript } = await import('../lib/webhooks'); const res = await callProcessTranscript(cv.id); if (res.error) alert('Processing failed: ' + res.error); else { alert('Processing complete!'); loadDeal() } }}>Reprocess</Button>
                    </>)}
                    {cv.task_count > 0 && <Badge color={T.textMuted}>{cv.task_count} tasks</Badge>}
                    {score != null && <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor, fontFeatureSettings: '"tnum"', minWidth: 28, textAlign: 'right' }}>{score}</span>}
                  </div>
                )
              })}
            </Card>

            {/* ROW 1 — 2fr 1fr: Company Profile | Scores & Deal */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
              <Card title="COMPANY PROFILE">
                <EditableField label="Overview" value={companyProfile?.overview} field="overview" table="company_profile" recordId={companyProfile?.id} type="textarea" onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <EditableField label="Industry" value={companyProfile?.industry} field="industry" table="company_profile" recordId={companyProfile?.id} onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Revenue" value={companyProfile?.revenue} field="revenue" table="company_profile" recordId={companyProfile?.id} onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Employees" value={companyProfile?.employee_count} field="employee_count" table="company_profile" recordId={companyProfile?.id} onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Headquarters" value={companyProfile?.headquarters} field="headquarters" table="company_profile" recordId={companyProfile?.id} onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Tech Stack" value={companyProfile?.tech_stack} field="tech_stack" table="company_profile" recordId={companyProfile?.id} type="textarea" displayAs="list" onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
                </div>
                <EditableField label="Business Goals" value={companyProfile?.business_goals} field="business_goals" table="company_profile" recordId={companyProfile?.id} type="textarea" displayAs="list" onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
                <EditableField label="Growth Plans" value={companyProfile?.growth_plans} field="growth_plans" table="company_profile" recordId={companyProfile?.id} type="textarea" displayAs="list" onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
                <EditableField label="Recent News" value={companyProfile?.recent_news} field="recent_news" table="company_profile" recordId={companyProfile?.id} type="textarea" displayAs="list" onSaved={(f, v) => setCompanyProfile(p => ({ ...p, [f]: v }))} />
              </Card>
              <Card title="SCORES & DEAL INFO">
                <ScoreBar score={deal.fit_score || 0} label="Fit" />
                <ScoreBar score={deal.deal_health_score || 0} label="Health" />
                <div style={{ marginTop: 12 }}>
                  <EditableField label="Stage" value={deal.stage} field="stage" table="deals" recordId={deal.id} type="select" options={allStageOptions} onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Forecast" value={deal.forecast_category} field="forecast_category" table="deals" recordId={deal.id} type="select" options={FORECAST_CATEGORIES} onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Deal Value" value={deal.deal_value} field="deal_value" table="deals" recordId={deal.id} type="number" onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                  <EditableField label="CMRR" value={deal.cmrr} field="cmrr" table="deals" recordId={deal.id} type="number" onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Target Close" value={deal.target_close_date} field="target_close_date" table="deals" recordId={deal.id} type="date" onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
                </div>
                {/* Running Problem Cost */}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.borderLight}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Running Problem Cost</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#e74c3c', fontFeatureSettings: '"tnum"' }}>
                    {totalPainCost > 0 ? formatCurrency(totalPainCost) : '$0'}
                  </div>
                  <EditableField label="Hard Dollars" value={analysis?.running_problem_cost_dollars} field="running_problem_cost_dollars" table="deal_analysis" recordId={analysis?.id} type="number" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Hours" value={analysis?.running_problem_cost_hours} field="running_problem_cost_hours" table="deal_analysis" recordId={analysis?.id} type="number" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                  <EditableField label="Notes" value={analysis?.running_problem_cost_notes} field="running_problem_cost_notes" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                </div>
              </Card>
            </div>

            {/* ROW 2 — 1fr 2fr: Key Contacts | Key Dates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
              <Card title={`KEY CONTACTS (${contacts.length})`} action={<Button style={{ padding: '3px 8px', fontSize: 10 }} onClick={() => setTab('contacts')}>View All</Button>}>
                {contacts.length === 0 ? <div style={{ color: '#bbb', fontSize: 13, fontStyle: 'italic' }}>No contacts yet</div> : contacts.slice(0, 6).map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.borderLight}` }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{c.name || c.contact_name}</div>
                      <div style={{ fontSize: 11, color: T.textSecondary }}>{c.title}{c.role_in_deal ? ` - ${c.role_in_deal}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {c.is_champion && <Badge color="#27ae60">Champion</Badge>}
                      {c.is_economic_buyer && <Badge color={T.primary}>EB</Badge>}
                      {c.is_signer && <Badge color="#f59e0b">Signer</Badge>}
                    </div>
                  </div>
                ))}
              </Card>
              <Card title="KEY DATES">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  {[
                    ['Decision Date', analysis?.decision_date, 'decision_date'],
                    ['Signature Date', analysis?.signature_date, 'signature_date'],
                    ['Kickoff Date', analysis?.kickoff_date, 'kickoff_date'],
                    ['Go-Live Date', analysis?.go_live_date, 'go_live_date'],
                    ['Busy Season', analysis?.busy_season, 'busy_season'],
                    ['Target Close', deal.target_close_date, null],
                  ].map(([lbl, val, fld]) => {
                    const d = val && fld !== 'busy_season' ? daysUntil(val) : null
                    const pillColor = d != null ? (d < 0 ? '#e74c3c' : d <= 14 ? T.warning : d <= 30 ? T.primary : '#27ae60') : null
                    return (
                      <div key={lbl}>
                        {fld && fld !== 'busy_season' ? (
                          <EditableField label={lbl} value={val} field={fld} table="deal_analysis" recordId={analysis?.id} type="date" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                        ) : fld === 'busy_season' ? (
                          <EditableField label={lbl} value={val} field={fld} table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                        ) : (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{lbl}</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{val ? formatDateLong(val) : <span style={{ color: '#e8a0a0', fontStyle: 'italic', fontWeight: 400 }}>Not set</span>}</div>
                          </div>
                        )}
                        {d != null && <span style={{ fontSize: 10, fontWeight: 700, color: pillColor, background: pillColor + '15', padding: '2px 8px', borderRadius: 10, display: 'inline-block', marginTop: -6, marginBottom: 4 }}>{d < 0 ? `${Math.abs(d)}d ago` : `${d}d away`}</span>}
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>

            {/* ROW 3 — 1fr 1fr: Deal Analysis | Qualification */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card title="DEAL ANALYSIS">
                <EditableField label="Quantified Pain" value={analysis?.quantified_pain} field="quantified_pain" table="deal_analysis" recordId={analysis?.id} type="textarea" displayAs="list" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Business Impact" value={analysis?.business_impact} field="business_impact" table="deal_analysis" recordId={analysis?.id} type="textarea" displayAs="list" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Driving Factors" value={analysis?.driving_factors} field="driving_factors" table="deal_analysis" recordId={analysis?.id} type="textarea" displayAs="list" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Decision Criteria" value={analysis?.decision_criteria} field="decision_criteria" table="deal_analysis" recordId={analysis?.id} type="textarea" displayAs="list" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Timeline Drivers" value={analysis?.timeline_drivers} field="timeline_drivers" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Integrations Needed" value={analysis?.integrations_needed} field="integrations_needed" table="deal_analysis" recordId={analysis?.id} type="textarea" displayAs="list" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Exec Alignment" value={analysis?.exec_alignment} field="exec_alignment" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Ideal Solution" value={analysis?.ideal_solution} field="ideal_solution" table="deal_analysis" recordId={analysis?.id} type="textarea" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              </Card>
              <Card title="QUALIFICATION">
                <EditableField label="Champion" value={analysis?.champion} field="champion" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Economic Buyer" value={analysis?.economic_buyer} field="economic_buyer" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Budget" value={analysis?.budget} field="budget" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Current Spend" value={analysis?.current_spend} field="current_spend" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Decision Process" value={analysis?.decision_process} field="decision_process" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Decision Method" value={analysis?.decision_method} field="decision_method" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <div style={{ flex: 1, background: T.errorLight, borderRadius: 6, padding: 10 }}>
                    <EditableField label="Red Flags" value={analysis?.red_flags} field="red_flags" table="deal_analysis" recordId={analysis?.id} type="textarea" displayAs="list" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                  </div>
                  <div style={{ flex: 1, background: T.successLight, borderRadius: 6, padding: 10 }}>
                    <EditableField label="Green Flags" value={analysis?.green_flags} field="green_flags" table="deal_analysis" recordId={analysis?.id} type="textarea" displayAs="list" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                  </div>
                </div>
              </Card>
            </div>

            {/* ROW 4 — Full width: Deal Risks */}
            <Card title={`DEAL RISKS (${risks.length})`} action={<Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => setShowAddRisk(true)}>+ Add Risk</Button>}>
              {showAddRisk && (
                <div style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, marginBottom: 8, border: `1px solid ${T.borderLight}` }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input style={{ ...inputStyle, flex: 2 }} value={newRisk.risk_description} onChange={e => setNewRisk(p => ({ ...p, risk_description: e.target.value }))} placeholder="Risk description *" autoFocus />
                    <select style={{ ...inputStyle, cursor: 'pointer', flex: 1 }} value={newRisk.severity} onChange={e => setNewRisk(p => ({ ...p, severity: e.target.value }))}>
                      {['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s}>{s}</option>)}</select>
                    <select style={{ ...inputStyle, cursor: 'pointer', flex: 1 }} value={newRisk.category} onChange={e => setNewRisk(p => ({ ...p, category: e.target.value }))}>
                      {RISK_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select>
                    <Button primary onClick={addRisk} style={{ fontSize: 11, padding: '4px 12px' }}>Add</Button>
                    <Button onClick={() => setShowAddRisk(false)} style={{ fontSize: 11, padding: '4px 8px' }}>Cancel</Button>
                  </div>
                </div>
              )}
              {risks.length === 0 ? <div style={{ color: '#bbb', fontSize: 13, fontStyle: 'italic' }}>No risks identified.</div> : risks.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.surfaceAlt, borderRadius: 6, marginBottom: 4, border: `1px solid ${T.borderLight}` }}>
                  <Badge color={SEVERITY_COLORS[r.severity] || T.textMuted}>{r.severity}</Badge>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>{r.risk_description}</div>
                  <Badge color={T.primary}>{(r.category || '').replace(/_/g, ' ')}</Badge>
                  <select style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, border: `1px solid ${STATUS_COLORS[r.status] || T.textMuted}30`, background: (STATUS_COLORS[r.status] || T.textMuted) + '12', color: STATUS_COLORS[r.status] || T.textMuted, cursor: 'pointer', fontFamily: T.font }}
                    value={r.status} onChange={e => updateRiskField(r.id, 'status', e.target.value)}>
                    {RISK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {r.source === 'ai_extracted' && <Badge color={T.primary}>AI</Badge>}
                  <DeleteBtn onClick={() => deleteRisk(r.id)} />
                </div>
              ))}
            </Card>

            {/* ROW 5 — Full width: Pain Points */}
            <Card title={`PAIN POINTS (${painPoints.length})`} action={<Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => setShowAddPain(true)}>+ Add Pain Point</Button>}>
              {/* Running Problem Cost */}
              <div style={{ display: 'flex', gap: 24, marginBottom: 16, padding: 14, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`, alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#1a2a3a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Running Problem Cost</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#e74c3c', fontFeatureSettings: '"tnum"' }}>{totalPainCost > 0 ? formatCurrency(totalPainCost) : '$0'}</div>
                </div>
                <EditableField label="Hard Dollars" value={analysis?.running_problem_cost_dollars} field="running_problem_cost_dollars" table="deal_analysis" recordId={analysis?.id} type="number" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Hours" value={analysis?.running_problem_cost_hours} field="running_problem_cost_hours" table="deal_analysis" recordId={analysis?.id} type="number" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
                <EditableField label="Notes" value={analysis?.running_problem_cost_notes} field="running_problem_cost_notes" table="deal_analysis" recordId={analysis?.id} onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              </div>
              {/* AI Pain Points from deal_analysis */}
              <EditableField label="AI Pain Points" value={analysis?.pain_points} field="pain_points" table="deal_analysis" recordId={analysis?.id} type="textarea" displayAs="list" onSaved={(f, v) => setAnalysis(p => ({ ...p, [f]: v }))} />
              {showAddPain && (
                <div style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, marginBottom: 8, border: `1px solid ${T.borderLight}` }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input style={{ ...inputStyle, flex: 2 }} value={newPain.pain_description} onChange={e => setNewPain(p => ({ ...p, pain_description: e.target.value }))} placeholder="Description *" autoFocus />
                    <select style={{ ...inputStyle, cursor: 'pointer', flex: 1 }} value={newPain.category} onChange={e => setNewPain(p => ({ ...p, category: e.target.value }))}>
                      {PAIN_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                    <input type="number" style={{ ...inputStyle, flex: 1 }} value={newPain.annual_cost} onChange={e => setNewPain(p => ({ ...p, annual_cost: e.target.value }))} placeholder="$ Annual" />
                    <input style={{ ...inputStyle, flex: 1 }} value={newPain.affected_team} onChange={e => setNewPain(p => ({ ...p, affected_team: e.target.value }))} placeholder="Team" />
                    <Button primary onClick={addPainPoint} style={{ fontSize: 11, padding: '4px 12px' }}>Add</Button>
                    <Button onClick={() => setShowAddPain(false)} style={{ fontSize: 11, padding: '4px 8px' }}>Cancel</Button>
                  </div>
                </div>
              )}
              {painPoints.length === 0 ? <div style={{ color: '#bbb', fontSize: 13, fontStyle: 'italic' }}>No pain points identified yet.</div> : painPoints.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.surfaceAlt, borderRadius: 6, marginBottom: 4, border: `1px solid ${T.borderLight}` }}>
                  <div style={{ flex: 2, fontSize: 13, fontWeight: 600, color: T.text }}>{p.pain_description}</div>
                  <Badge color={T.primary}>{p.category}</Badge>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#2ecc71', fontFeatureSettings: '"tnum"', whiteSpace: 'nowrap', minWidth: 60 }}>{p.annual_cost ? formatCurrency(p.annual_cost) : '--'}</div>
                  {p.affected_team && <span style={{ fontSize: 11, color: T.textSecondary }}>{p.affected_team}</span>}
                  {p.source === 'ai_extracted' ? <Badge color={T.primary}>AI</Badge> : <Badge color={T.textMuted}>Manual</Badge>}
                  <span onClick={() => updatePainField(p.id, 'verified', !p.verified)} style={{ cursor: 'pointer', fontSize: 10, fontWeight: 600, color: p.verified ? '#27ae60' : '#bbb', padding: '1px 6px', borderRadius: 3, background: p.verified ? 'rgba(39,174,96,0.08)' : 'transparent', border: `1px solid ${p.verified ? 'rgba(39,174,96,0.3)' : T.borderLight}` }}>
                    {p.verified ? 'VERIFIED' : 'UNVERIFIED'}
                  </span>
                  <DeleteBtn onClick={() => deletePainPoint(p.id)} />
                </div>
              ))}
            </Card>

            {/* ROW 6 — Full width: Notes */}
            <Card title="NOTES">
              <EditableField label="" value={deal.notes} field="notes" table="deals" recordId={deal.id} type="textarea" onSaved={(f, v) => setDeal(p => ({ ...p, [f]: v }))} />
            </Card>
          </div>
        )}

        {/* ===== CONTACTS TAB ===== */}
        {tab === 'contacts' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Contacts</h3>
              <Button primary onClick={() => setShowAddContact(true)}>+ Add Contact</Button>
            </div>
            {showAddContact && (
              <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, marginBottom: 12, border: `1px solid ${T.borderLight}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
                  <div><label style={labelStyle}>Title</label><input style={inputStyle} value={newContact.title} onChange={e => setNewContact(p => ({ ...p, title: e.target.value }))} /></div>
                  <div><label style={labelStyle}>Email</label><input style={inputStyle} value={newContact.email} onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))} /></div>
                  <div><label style={labelStyle}>Role in Deal</label><input style={inputStyle} value={newContact.role_in_deal} onChange={e => setNewContact(p => ({ ...p, role_in_deal: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button primary onClick={addNewContact}>Add Contact</Button>
                  <Button onClick={() => setShowAddContact(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {contacts.length === 0
              ? <EmptyState message="No contacts yet. Add manually or upload a transcript to auto-extract." />
              : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 12 }}>
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
                              <Button danger style={{ padding: '3px 8px', fontSize: 10 }} onClick={() => deleteContact(c.id)}>Delete</Button>
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
              <Button primary onClick={() => setShowTranscriptUpload(true)}>Upload Transcript</Button>
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

        {/* Transcript Upload Modal */}
        {showTranscriptUpload && (
          <TranscriptUpload
            deals={[deal]}
            onClose={() => setShowTranscriptUpload(false)}
            onUploaded={() => { setShowTranscriptUpload(false); loadDeal() }}
          />
        )}

        {/* ===== MSP TAB ===== */}
        {tab === 'msp' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Mutual Success Plan</h3>
              <Button primary onClick={() => navigate(`/deal/${id}/msp`)}>Open Full MSP</Button>
            </div>
            {mspStages.length === 0
              ? <EmptyState message="No MSP steps yet. Open the full MSP to create steps or apply a template." action={<Button primary onClick={() => navigate(`/deal/${id}/msp`)} style={{ marginTop: 8 }}>Open MSP</Button>} />
              : mspStages.map((step, si) => {
                const statusColor = step.is_completed ? T.success : step.status === 'in_progress' ? T.primary : step.status === 'blocked' ? T.error : T.border
                return (
                  <div key={step.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`, marginBottom: 6,
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', background: statusColor,
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                    }}>
                      {step.is_completed ? '\u2713' : step.status === 'blocked' ? '!' : si + 1}
                    </div>
                    <div style={{
                      flex: 1, fontSize: 13, fontWeight: 600, color: T.text,
                      textDecoration: step.is_completed ? 'line-through' : 'none',
                      opacity: step.is_completed ? 0.6 : 1,
                    }}>{step.stage_name}</div>
                    <Badge color={statusColor}>{step.status || 'pending'}</Badge>
                    {step.due_date && <span style={{ fontSize: 11, color: T.textSecondary }}>{formatDate(step.due_date)}</span>}
                  </div>
                )
              })}
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
              <Button primary onClick={() => setShowAddTask(true)}>+ Add Task</Button>
            </div>
            {showAddTask && (
              <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, marginBottom: 12, border: `1px solid ${T.borderLight}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div><label style={labelStyle}>Title *</label><input style={inputStyle} value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} autoFocus onKeyDown={e => e.key === 'Enter' && addTask()} /></div>
                  <div><label style={labelStyle}>Priority</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}>
                    {['high', 'medium', 'low'].map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                  <div><label style={labelStyle}>Due Date</label><input type="date" style={inputStyle} value={newTask.due_date} onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))} /></div>
                </div>
                <div><label style={labelStyle}>Notes</label><textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', marginBottom: 8 }} value={newTask.notes} onChange={e => setNewTask(p => ({ ...p, notes: e.target.value }))} /></div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button primary onClick={addTask}>Add Task</Button>
                  <Button onClick={() => setShowAddTask(false)}>Cancel</Button>
                </div>
              </div>
            )}
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
                      <DeleteBtn onClick={() => deleteTask(t.id)} />
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

        {/* ===== EMAILS TAB ===== */}
        {tab === 'emails' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Generated Emails ({generatedEmails.length})</h3>
              <Button primary onClick={() => setShowEmailGenerator(true)}>Generate New</Button>
            </div>
            {generatedEmails.length === 0 ? (
              <EmptyState message="No emails generated yet. Click 'Generate New' to create one from a template." />
            ) : generatedEmails.map(em => (
              <Card key={em.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: T.textSecondary, whiteSpace: 'nowrap' }}>{em.created_at ? formatDate(em.created_at.split('T')[0]) : ''}</span>
                  {em.email_type && <Badge color={T.primary}>{em.email_type.replace(/_/g, ' ')}</Badge>}
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClick={() => setExpandedEmail(expandedEmail === em.id ? null : em.id)}>
                    {em.subject || 'No subject'}
                  </div>
                  {em.recipient && <span style={{ fontSize: 11, color: T.textSecondary }}>{em.recipient}</span>}
                  <select style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, border: `1px solid ${T.border}`, background: em.status === 'sent' ? T.successLight : T.surfaceAlt, color: em.status === 'sent' ? T.success : T.textSecondary, cursor: 'pointer', fontFamily: T.font }}
                    value={em.status || 'draft'} onChange={e => updateGeneratedEmail(em.id, 'status', e.target.value)}>
                    <option value="draft">Draft</option><option value="sent">Sent</option><option value="archived">Archived</option>
                  </select>
                  <button onClick={() => deleteGeneratedEmail(em.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&times;</button>
                </div>
                {expandedEmail === em.id && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', marginBottom: 4 }}>Subject</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 12 }}>{em.subject}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', marginBottom: 4 }}>Body</div>
                    <div style={{ fontSize: 13, color: T.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: T.surfaceAlt, padding: 14, borderRadius: 6, border: `1px solid ${T.borderLight}`, marginBottom: 12 }}>{em.body}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button onClick={() => navigator.clipboard.writeText(`Subject: ${em.subject}\n\n${em.body}`)} style={{ fontSize: 11, padding: '4px 12px' }}>Copy to Clipboard</Button>
                      <Button onClick={() => window.open(`mailto:${em.recipient || ''}?subject=${encodeURIComponent(em.subject || '')}&body=${encodeURIComponent(em.body || '')}`, '_blank')} style={{ fontSize: 11, padding: '4px 12px' }}>Open in Mail</Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Generate Email Modal */}
        {showEmailGenerator && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
            onClick={() => { if (!generatingEmail) { setShowEmailGenerator(false); setEmailResult(null) } }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, width: 650, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <div style={{ padding: '20px 24px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Generate Email</div>
                <div style={{ fontSize: 13, color: T.textSecondary }}>AI will generate an email using deal context and your template</div>
              </div>
              <div style={{ padding: '16px 24px' }}>
                {!emailResult ? (
                  <>
                    <div style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>Email Template *</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={selectedEmailTpl} onChange={e => setSelectedEmailTpl(e.target.value)}>
                        <option value="">Select template...</option>
                        {emailTemplates.map(t => <option key={t.id} value={t.id}>{t.name} ({(t.email_type || '').replace(/_/g, ' ')})</option>)}
                      </select>
                      {selectedEmailTpl && emailTemplates.find(t => t.id === selectedEmailTpl)?.description && (
                        <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>{emailTemplates.find(t => t.id === selectedEmailTpl).description}</div>
                      )}
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>From Call (optional)</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={selectedEmailConv} onChange={e => setSelectedEmailConv(e.target.value)}>
                        <option value="">No specific call</option>
                        {conversations.map(c => <option key={c.id} value={c.id}>{c.title || c.call_type} - {formatDate(c.call_date)}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button onClick={() => { setShowEmailGenerator(false); setEmailResult(null) }}>Cancel</Button>
                      <Button primary onClick={generateEmail} disabled={!selectedEmailTpl || generatingEmail}>
                        {generatingEmail ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                            Generating...
                          </span>
                        ) : 'Generate'}
                      </Button>
                    </div>
                  </>
                ) : emailResult.error ? (
                  <div>
                    <div style={{ padding: '12px 16px', background: T.errorLight, borderRadius: 6, color: T.error, fontSize: 13, marginBottom: 12 }}>{emailResult.error}</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button onClick={() => setEmailResult(null)}>Try Again</Button>
                      <Button onClick={() => { setShowEmailGenerator(false); setEmailResult(null) }}>Close</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Subject</label>
                      <input style={{ ...inputStyle, fontWeight: 600 }} value={emailResult.subject} onChange={e => setEmailResult(p => ({ ...p, subject: e.target.value }))} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Body</label>
                      <textarea style={{ ...inputStyle, minHeight: 300, resize: 'vertical', lineHeight: 1.7 }} value={emailResult.body} onChange={e => setEmailResult(p => ({ ...p, body: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button onClick={() => navigator.clipboard.writeText(`Subject: ${emailResult.subject}\n\n${emailResult.body}`)}>Copy to Clipboard</Button>
                      <Button onClick={() => window.open(`mailto:?subject=${encodeURIComponent(emailResult.subject || '')}&body=${encodeURIComponent(emailResult.body || '')}`, '_blank')}>Open in Mail</Button>
                      <Button onClick={() => setEmailResult(null)}>Regenerate</Button>
                      <Button primary onClick={() => { setShowEmailGenerator(false); setEmailResult(null) }}>Done</Button>
                    </div>
                  </div>
                )}
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
