import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, TabBar, Field, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

const AI_MODELS = [
  { key: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { key: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { key: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
]

const CATEGORIES = ['discovery', 'methodology', 'communication', 'qualification', 'closing', 'general', 'custom']

export default function CoachAdmin() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [allCoaches, setAllCoaches] = useState([])
  const [selectedCoachId, setSelectedCoachId] = useState(null)
  const [coach, setCoach] = useState(null)
  const [showCreateCoach, setShowCreateCoach] = useState(false)
  const [newCoach, setNewCoach] = useState({ name: '', description: '', model: 'claude-sonnet-4-6', temperature: 0.7 })
  const [prompts, setPrompts] = useState([])
  const [docs, setDocs] = useState([])
  const [scoringConfigs, setScoringConfigs] = useState([])
  const [repScoringConfigs, setRepScoringConfigs] = useState([])
  const [mspTemplates, setMspTemplates] = useState([])
  const [templateStages, setTemplateStages] = useState([])
  const [emailTemplatesAdmin, setEmailTemplatesAdmin] = useState([])
  const [showAddEmailTemplate, setShowAddEmailTemplate] = useState(false)
  const [newEmailTpl, setNewEmailTpl] = useState({ name: '', email_type: 'follow_up', description: '' })
  const [expandedEmailTemplate, setExpandedEmailTemplate] = useState(null)
  const [researchConfig, setResearchConfig] = useState(null)
  const [slideConfig, setSlideConfig] = useState(null)
  const [icp, setIcp] = useState(null)
  const [icpForm, setIcpForm] = useState({
    name: 'Default ICP', industries: [], geographies: [], current_systems: [], tech_red_flags: [], buying_signals: [], disqualifiers: [],
    revenue_min: '', revenue_max: '', employee_min: '', employee_max: '', entity_count_min: '', entity_count_max: '',
    weight_industry: 20, weight_revenue: 15, weight_employees: 10, weight_entities: 20, weight_current_system: 15, weight_buying_signals: 20,
    personas: [], green_flags: [], red_flags: [], functional_green_flags: [], functional_red_flags: [],
  })
  const [icpTestDealId, setIcpTestDealId] = useState('')
  const [icpTestResult, setIcpTestResult] = useState(null)
  const [icpDeals, setIcpDeals] = useState([])

  // Sharing tokens
  const [shareTokens, setShareTokens] = useState([])
  const [newTokenLabel, setNewTokenLabel] = useState('')
  const [newTokenMaxUses, setNewTokenMaxUses] = useState('')
  const [newTokenExpires, setNewTokenExpires] = useState('')
  const [copiedToken, setCopiedToken] = useState(null)

  // Editing states
  const [editingCoach, setEditingCoach] = useState(false)
  const [editCoachData, setEditCoachData] = useState({})
  const [editingPrompt, setEditingPrompt] = useState(null)
  const [editPromptData, setEditPromptData] = useState({})
  const [editingSystemPrompt, setEditingSystemPrompt] = useState(false)
  const [systemPromptVal, setSystemPromptVal] = useState('')
  const [editingResearchPrompt, setEditingResearchPrompt] = useState(false)
  const [researchPromptVal, setResearchPromptVal] = useState('')
  const [editingExtraction, setEditingExtraction] = useState(false)
  const [extractionVal, setExtractionVal] = useState('')

  // Template form
  const [showAddTemplate, setShowAddTemplate] = useState(false)
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '' })
  const [showAddTemplateStage, setShowAddTemplateStage] = useState(null)
  const [newTemplateStage, setNewTemplateStage] = useState({ stage_name: '', due_date_offset: 0 })
  const [expandedTemplate, setExpandedTemplate] = useState(null)

  // Document upload
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [newDoc, setNewDoc] = useState({ name: '', doc_type: 'battle_card', content: '' })

  // Prompt add
  const [showAddPrompt, setShowAddPrompt] = useState(false)
  const [newPrompt, setNewPrompt] = useState({ call_type: 'qdc', label: '', prompt: '' })

  useEffect(() => { if (profile) loadAllCoaches() }, [profile])
  useEffect(() => { if (selectedCoachId) loadCoachData(selectedCoachId) }, [selectedCoachId])

  async function loadAllCoaches() {
    setLoading(true)
    try {
      const isSystemAdmin = profile?.role === 'system_admin'
      let query = supabase.from('coaches').select('*').order('name')
      if (!isSystemAdmin) query = query.eq('created_by', profile.id)
      const { data } = await query
      const coaches = data || []
      setAllCoaches(coaches)
      // Auto-select: active coach first, then first owned, then first available
      const pick = coaches.find(c => c.id === profile.active_coach_id) || coaches[0]
      if (pick) { setSelectedCoachId(pick.id) } else { setLoading(false) }
    } catch (err) {
      console.error('Error loading coaches:', err)
      setLoading(false)
    }
  }

  async function loadCoachData(coachId) {
    setLoading(true)
    try {
      const { data: coachData } = await supabase.from('coaches').select('*').eq('id', coachId).single()
      const activeCoach = coachData
      setCoach(activeCoach)

      if (activeCoach) {
        const [promptsRes, docsRes, scoringRes, repScoringRes, templatesRes] = await Promise.all([
          supabase.from('call_type_prompts').select('*').eq('coach_id', activeCoach.id).order('created_at'),
          supabase.from('coach_documents').select('*').eq('coach_id', activeCoach.id).order('created_at'),
          supabase.from('scoring_configs').select('*').eq('coach_id', activeCoach.id).order('score_type'),
          supabase.from('rep_scoring_configs').select('*').eq('coach_id', activeCoach.id).order('created_at'),
          supabase.from('msp_templates').select('*').eq('coach_id', activeCoach.id).order('created_at'),
        ])
        setPrompts(promptsRes.data || [])
        setDocs(docsRes.data || [])
        setScoringConfigs(scoringRes.data || [])
        setRepScoringConfigs(repScoringRes.data || [])
        setMspTemplates(templatesRes.data || [])

        const { data: emailTpls } = await supabase.from('email_templates').select('*').eq('coach_id', activeCoach.id).order('sort_order')
        setEmailTemplatesAdmin(emailTpls || [])

        const { data: rc } = await supabase.from('coach_research_config').select('*').eq('coach_id', activeCoach.id).single()
        setResearchConfig(rc || null)

        const { data: sc } = await supabase.from('coach_slide_config').select('*').eq('coach_id', activeCoach.id).single()
        setSlideConfig(sc || null)

        const { data: icpData } = await supabase.from('coach_icp').select('*').eq('coach_id', activeCoach.id).eq('active', true).limit(1).single()
        setIcp(icpData || null)
        if (icpData) {
          setIcpForm({
            name: icpData.name || 'Default ICP', industries: icpData.industries || [], geographies: icpData.geographies || [],
            current_systems: icpData.current_systems || [], tech_red_flags: icpData.tech_red_flags || [],
            buying_signals: icpData.buying_signals || [], disqualifiers: icpData.disqualifiers || [],
            revenue_min: icpData.revenue_min || '', revenue_max: icpData.revenue_max || '',
            employee_min: icpData.employee_min || '', employee_max: icpData.employee_max || '',
            entity_count_min: icpData.entity_count_min || '', entity_count_max: icpData.entity_count_max || '',
            weight_industry: icpData.weight_industry ?? 20, weight_revenue: icpData.weight_revenue ?? 15,
            weight_employees: icpData.weight_employees ?? 10, weight_entities: icpData.weight_entities ?? 20,
            weight_current_system: icpData.weight_current_system ?? 15, weight_buying_signals: icpData.weight_buying_signals ?? 20,
            personas: icpData.personas || [], green_flags: icpData.green_flags || [], red_flags: icpData.red_flags || [],
            functional_green_flags: icpData.functional_green_flags || [], functional_red_flags: icpData.functional_red_flags || [],
          })
        }

        const { data: dealsForIcp } = await supabase.from('deals').select('id, company_name').order('created_at', { ascending: false }).limit(20)
        setIcpDeals(dealsForIcp || [])

        // Load share tokens for this coach
        const { data: tokens } = await supabase.from('coach_share_tokens').select('*').eq('coach_id', coachId).order('created_at', { ascending: false })
        setShareTokens(tokens || [])

        // Load template stages/milestones
        const tplIds = (templatesRes.data || []).map(t => t.id)
        if (tplIds.length > 0) {
          const { data: stagesData } = await supabase.from('msp_template_stages').select('*').in('template_id', tplIds).order('stage_order')
          setTemplateStages(stagesData || [])
        }
      }
    } catch (err) {
      console.error('Error loading coach:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Coach overview saves ──
  async function saveCoach() {
    await supabase.from('coaches').update(editCoachData).eq('id', coach.id)
    setCoach(prev => ({ ...prev, ...editCoachData }))
    setEditingCoach(false)
  }

  async function saveSystemPrompt() {
    await supabase.from('coaches').update({ system_prompt: systemPromptVal }).eq('id', coach.id)
    setCoach(prev => ({ ...prev, system_prompt: systemPromptVal }))
    setEditingSystemPrompt(false)
  }

  async function saveResearchPrompt() {
    await supabase.from('coaches').update({ research_prompt: researchPromptVal }).eq('id', coach.id)
    setCoach(prev => ({ ...prev, research_prompt: researchPromptVal }))
    setEditingResearchPrompt(false)
  }

  async function saveExtraction() {
    await supabase.from('coaches').update({ extraction_rules: extractionVal }).eq('id', coach.id)
    setCoach(prev => ({ ...prev, extraction_rules: extractionVal }))
    setEditingExtraction(false)
  }

  // ── Prompt saves ──
  async function savePrompt(promptId) {
    await supabase.from('call_type_prompts').update(editPromptData).eq('id', promptId)
    setPrompts(prev => prev.map(p => p.id === promptId ? { ...p, ...editPromptData } : p))
    setEditingPrompt(null)
  }

  // ── Rep scoring ──
  async function updateRepScoring(id, field, value) {
    await supabase.from('rep_scoring_configs').update({ [field]: value }).eq('id', id)
    setRepScoringConfigs(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  async function addRepScoringCriteria() {
    if (!coach) return
    const { data, error } = await supabase.from('rep_scoring_configs').insert({
      coach_id: coach.id, criteria_name: 'New Criteria', description: '',
      max_score: 10, weight: 1.0, category: 'general', active: true,
    }).select().single()
    if (!error && data) setRepScoringConfigs(prev => [...prev, data])
  }

  async function deleteRepScoringCriteria(id) {
    if (!window.confirm('Delete this scoring criteria?')) return
    await supabase.from('rep_scoring_configs').delete().eq('id', id)
    setRepScoringConfigs(prev => prev.filter(c => c.id !== id))
  }

  // ── MSP Templates ──
  async function addTemplate() {
    if (!newTemplate.name.trim() || !coach) return
    const { data, error } = await supabase.from('msp_templates').insert({
      coach_id: coach.id, template_name: newTemplate.name, description: newTemplate.description || null,
      is_default: mspTemplates.length === 0,
    }).select().single()
    if (!error && data) { setMspTemplates(prev => [...prev, data]); setShowAddTemplate(false); setNewTemplate({ name: '', description: '' }) }
  }

  async function updateTemplate(id, field, value) {
    await supabase.from('msp_templates').update({ [field]: value }).eq('id', id)
    setMspTemplates(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  }

  async function addTemplateStage(templateId) {
    if (!newTemplateStage.stage_name.trim()) return
    const existing = templateStages.filter(s => s.template_id === templateId)
    const nextOrder = existing.length > 0 ? Math.max(...existing.map(s => s.stage_order)) + 1 : 1
    const { data, error } = await supabase.from('msp_template_stages').insert({
      template_id: templateId, stage_name: newTemplateStage.stage_name,
      stage_order: nextOrder, due_date_offset: Number(newTemplateStage.due_date_offset) || 0,
      default_duration_days: Number(newTemplateStage.due_date_offset) || 0,
    }).select().single()
    if (!error && data) { setTemplateStages(prev => [...prev, data]); setShowAddTemplateStage(null); setNewTemplateStage({ stage_name: '', due_date_offset: 0 }) }
  }

  async function updateTemplateStage(id, field, value) {
    await supabase.from('msp_template_stages').update({ [field]: value }).eq('id', id)
    setTemplateStages(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  async function deleteTemplateStage(id) {
    if (!window.confirm('Delete this step?')) return
    await supabase.from('msp_template_stages').delete().eq('id', id)
    setTemplateStages(prev => prev.filter(s => s.id !== id))
  }

  async function deleteTemplate(id) {
    if (!window.confirm('Delete this template and all its steps?')) return
    await supabase.from('msp_template_stages').delete().eq('template_id', id)
    await supabase.from('msp_templates').delete().eq('id', id)
    setMspTemplates(prev => prev.filter(t => t.id !== id))
    setTemplateStages(prev => prev.filter(s => s.template_id !== id))
  }

  async function createNewCoach() {
    if (!newCoach.name.trim()) return
    const { data, error } = await supabase.from('coaches').insert({
      name: newCoach.name.trim(), description: newCoach.description || null,
      model: newCoach.model, temperature: newCoach.temperature,
      created_by: profile.id, active: true,
    }).select().single()
    if (!error && data) {
      setAllCoaches(prev => [...prev, data])
      setSelectedCoachId(data.id)
      setShowCreateCoach(false)
      setNewCoach({ name: '', description: '', model: 'claude-sonnet-4-6', temperature: 0.7 })
    }
  }

  async function addEmailTemplate() {
    if (!newEmailTpl.name.trim() || !coach) return
    const { data, error } = await supabase.from('email_templates').insert({
      coach_id: coach.id, name: newEmailTpl.name.trim(), email_type: newEmailTpl.email_type,
      description: newEmailTpl.description || null, active: true, sort_order: emailTemplatesAdmin.length + 1,
    }).select().single()
    if (!error && data) { setEmailTemplatesAdmin(prev => [...prev, data]); setShowAddEmailTemplate(false); setNewEmailTpl({ name: '', email_type: 'follow_up', description: '' }) }
  }

  async function updateEmailTemplate(id, field, value) {
    await supabase.from('email_templates').update({ [field]: value }).eq('id', id)
    setEmailTemplatesAdmin(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  }

  async function deleteEmailTemplate(id) {
    if (!window.confirm('Delete this email template?')) return
    await supabase.from('email_templates').delete().eq('id', id)
    setEmailTemplatesAdmin(prev => prev.filter(t => t.id !== id))
  }

  async function addDocument() {
    if (!newDoc.name.trim() || !coach) return
    const { data, error } = await supabase.from('coach_documents').insert({
      coach_id: coach.id, name: newDoc.name.trim(), doc_type: newDoc.doc_type,
      content: newDoc.content || null, active: true,
    }).select().single()
    if (!error && data) { setDocs(prev => [...prev, data]); setShowAddDoc(false); setNewDoc({ name: '', doc_type: 'battle_card', content: '' }) }
  }

  async function addPrompt() {
    if (!newPrompt.label.trim() || !coach) return
    const { data, error } = await supabase.from('call_type_prompts').insert({
      coach_id: coach.id, call_type: newPrompt.call_type, label: newPrompt.label.trim(),
      prompt: newPrompt.prompt || null, active: true,
    }).select().single()
    if (!error && data) { setPrompts(prev => [...prev, data]); setShowAddPrompt(false); setNewPrompt({ call_type: 'qdc', label: '', prompt: '' }) }
  }

  if (loading) return <Spinner />

  const DOC_TYPES = ['battle_card', 'roi_model', 'discovery_guide', 'objection_handling', 'pricing', 'methodology', 'qualifying_framework', 'custom']
  const CALL_TYPE_KEYS = ['qdc', 'functional_discovery', 'demo', 'scoping', 'proposal', 'negotiation', 'sync', 'custom']

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'prompts', label: `Call Prompts (${prompts.length})` },
    { key: 'docs', label: `Documents (${docs.length})` },
    { key: 'scoring', label: `Scoring (${scoringConfigs.length})` },
    { key: 'rep_scoring', label: `Rep Scoring (${repScoringConfigs.length})` },
    { key: 'templates', label: `MSP Templates (${mspTemplates.length})` },
    { key: 'emails', label: `Email Templates (${emailTemplatesAdmin.length})` },
    { key: 'research', label: 'Research' },
    { key: 'slides', label: 'Slides' },
    { key: 'icp', label: 'ICP' },
    { key: 'sharing', label: 'Sharing' },
  ]

  const EMAIL_TYPES = ['sc_briefing', 'scoping_kt', 'exec_alignment', 'follow_up', 'internal_update', 'custom']
  const RECIPIENT_TYPES = ['internal', 'external', 'client', 'partner']
  const CONTEXT_FIELDS = ['pain_points', 'contacts', 'competition', 'deal_analysis', 'company_profile', 'transcripts', 'tasks', 'scores', 'msp']

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Coach Admin</h2>
          <Button primary onClick={() => nav('/coach/builder')} style={{ padding: '5px 12px', fontSize: 11 }}>Coach Builder</Button>
          <select style={{ ...inputStyle, width: 'auto', padding: '6px 12px', cursor: 'pointer', fontWeight: 600, maxWidth: 250 }}
            value={selectedCoachId || ''} onChange={e => setSelectedCoachId(e.target.value)}>
            {allCoaches.map(c => <option key={c.id} value={c.id}>{c.name}{c.created_by === profile?.id ? '' : ' (shared)'}</option>)}
          </select>
          {coach && coach.created_by !== profile?.id && (
            <span style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>Owner: {coach.owner_name || 'Another admin'}</span>
          )}
          <div style={{ flex: 1 }} />
          <Button primary onClick={() => setShowCreateCoach(true)} style={{ padding: '6px 14px', fontSize: 12 }}>+ New Coach</Button>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: '16px 24px' }}>
        {/* Create Coach Form */}
        {showCreateCoach && (
          <Card title="Create New Coach" style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={newCoach.name} onChange={e => setNewCoach(p => ({ ...p, name: e.target.value }))} placeholder="Coach name" autoFocus /></div>
              <div><label style={labelStyle}>AI Model</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newCoach.model} onChange={e => setNewCoach(p => ({ ...p, model: e.target.value }))}>
                {AI_MODELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
            </div>
            <div style={{ marginBottom: 10 }}><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={newCoach.description} onChange={e => setNewCoach(p => ({ ...p, description: e.target.value }))} placeholder="What this coach specializes in..." /></div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Temperature: {newCoach.temperature}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: T.textMuted }}>0</span>
                <input type="range" min="0" max="1" step="0.05" value={newCoach.temperature} onChange={e => setNewCoach(p => ({ ...p, temperature: Number(e.target.value) }))} style={{ flex: 1, accentColor: T.primary }} />
                <span style={{ fontSize: 11, color: T.textMuted }}>1</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}><Button primary onClick={createNewCoach}>Create Coach</Button><Button onClick={() => setShowCreateCoach(false)}>Cancel</Button></div>
          </Card>
        )}
        {!coach ? (
          <Card><div style={{ textAlign: 'center', padding: 32, color: T.textMuted }}>No coach selected. Create one with "+ New Coach" above.</div></Card>
        ) : (
          <>
            {/* ══════════ OVERVIEW ══════════ */}
            {tab === 'overview' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Active Coach */}
                <Card title="Active Coach" action={
                  <Button style={{ padding: '4px 12px', fontSize: 11 }}
                    onClick={() => {
                      if (editingCoach) { setEditingCoach(false) }
                      else { setEditingCoach(true); setEditCoachData({ name: coach.name, description: coach.description, model: coach.model, temperature: coach.temperature }) }
                    }}>
                    {editingCoach ? 'Cancel' : 'Edit'}
                  </Button>
                }>
                  {editingCoach ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div><label style={labelStyle}>Name</label><input style={inputStyle} value={editCoachData.name || ''} onChange={e => setEditCoachData(p => ({ ...p, name: e.target.value }))} /></div>
                      <div><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={editCoachData.description || ''} onChange={e => setEditCoachData(p => ({ ...p, description: e.target.value }))} /></div>
                      <div>
                        <label style={labelStyle}>AI Model</label>
                        <select style={{ ...inputStyle, cursor: 'pointer' }} value={editCoachData.model || ''} onChange={e => setEditCoachData(p => ({ ...p, model: e.target.value }))}>
                          <option value="">Select model...</option>
                          {AI_MODELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Temperature: {editCoachData.temperature ?? 0.7}</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 11, color: T.textMuted }}>0</span>
                          <input type="range" min="0" max="1" step="0.05" value={editCoachData.temperature ?? 0.7}
                            onChange={e => setEditCoachData(p => ({ ...p, temperature: Number(e.target.value) }))}
                            style={{ flex: 1, cursor: 'pointer', accentColor: T.primary }} />
                          <span style={{ fontSize: 11, color: T.textMuted }}>1</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: T.primary, minWidth: 30, textAlign: 'right' }}>
                            {(editCoachData.temperature ?? 0.7).toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <Button primary onClick={saveCoach}>Save</Button>
                    </div>
                  ) : (
                    <>
                      <Field label="Name" value={coach.name} />
                      <Field label="Description" value={coach.description} />
                      <Field label="Model" value={AI_MODELS.find(m => m.key === coach.model)?.label || coach.model} />
                      <Field label="Temperature" value={String(coach.temperature ?? '0.7')} />
                    </>
                  )}
                </Card>

                {/* System Prompt — layered 4-layer preview */}
                <AssembledPromptPreview coach={coach} editing={editingSystemPrompt}
                  onEdit={() => { setEditingSystemPrompt(true); setSystemPromptVal(coach.system_prompt || '') }}
                  onCancel={() => setEditingSystemPrompt(false)}
                  value={systemPromptVal} setValue={setSystemPromptVal} onSave={saveSystemPrompt} />

                {/* Coach Voice & Behavior — structured fields */}
                <CoachVoiceEditor coach={coach} onSaved={(p) => setCoach(prev => ({ ...prev, ...p }))} />

                {/* Research Prompt */}
                <Card title="Research Prompt" action={
                  <Button style={{ padding: '4px 12px', fontSize: 11 }}
                    onClick={() => {
                      if (editingResearchPrompt) { setEditingResearchPrompt(false) }
                      else { setEditingResearchPrompt(true); setResearchPromptVal(coach.research_prompt || '') }
                    }}>
                    {editingResearchPrompt ? 'Cancel' : 'Edit'}
                  </Button>
                }>
                  {editingResearchPrompt ? (
                    <div>
                      <textarea style={{ ...inputStyle, fontSize: 13, minHeight: 240, resize: 'vertical', width: '100%', lineHeight: 1.55, fontFamily: T.font }}
                        value={researchPromptVal} onChange={e => setResearchPromptVal(e.target.value)}
                        placeholder="What should the AI investigate about each company? e.g. recent M&A, exec changes, tech stack, funding, busy-season patterns..." />
                      <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{researchPromptVal.length} chars</div>
                      <Button primary onClick={saveResearchPrompt} style={{ marginTop: 8 }}>Save</Button>
                    </div>
                  ) : coach.research_prompt ? (
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: T.text, background: T.surface, padding: 14, borderRadius: 6, border: `1px solid ${T.borderLight}`, borderLeft: `3px solid ${T.primary}`, fontFamily: T.font, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>
                      {coach.research_prompt}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', padding: 10 }}>
                      No research prompt configured. Click Edit to tell the AI what to investigate about each company.
                    </div>
                  )}
                </Card>

                {/* Extraction Rules — structured */}
                <ExtractionRulesEditor coach={coach} onSaved={(newRules) => setCoach(prev => ({ ...prev, extraction_rules: newRules }))} />
              </div>
            )}

            {/* ══════════ CALL PROMPTS ══════════ */}
            {tab === 'prompts' && (
              <div>
                {/* Call Type Definitions */}
                {Array.isArray(coach.call_type_definitions) && coach.call_type_definitions.length > 0 && (
                  <Card title="Call Type Definitions" style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>Configured in Coach Builder. Shows the purpose of each call type for coaching context.</div>
                    {coach.call_type_definitions.filter(ct => ct.enabled).map((ct, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: T.surfaceAlt, borderRadius: 6, marginBottom: 4, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.primary, minWidth: 120, flexShrink: 0 }}>{ct.label || ct.type}</span>
                        <span style={{ fontSize: 12, color: T.textSecondary }}>{ct.purpose || 'No purpose defined'}</span>
                      </div>
                    ))}
                  </Card>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}><Button primary onClick={() => setShowAddPrompt(true)}>+ Add Prompt</Button></div>
                {showAddPrompt && (
                  <Card title="New Prompt" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div><label style={labelStyle}>Call Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newPrompt.call_type} onChange={e => setNewPrompt(p => ({ ...p, call_type: e.target.value }))}>
                        {CALL_TYPE_KEYS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                      <div><label style={labelStyle}>Label *</label><input style={inputStyle} value={newPrompt.label} onChange={e => setNewPrompt(p => ({ ...p, label: e.target.value }))} autoFocus /></div>
                    </div>
                    <div style={{ marginBottom: 10 }}><label style={labelStyle}>Prompt</label><textarea style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12, minHeight: 300, resize: 'vertical', width: '100%' }} value={newPrompt.prompt} onChange={e => setNewPrompt(p => ({ ...p, prompt: e.target.value }))} /></div>
                    <div style={{ display: 'flex', gap: 6 }}><Button primary onClick={addPrompt}>Add Prompt</Button><Button onClick={() => setShowAddPrompt(false)}>Cancel</Button></div>
                  </Card>
                )}
                {prompts.map(p => (
                  <Card key={p.id}>
                    {editingPrompt === p.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div><label style={labelStyle}>Label</label><input style={inputStyle} value={editPromptData.label || ''} onChange={e => setEditPromptData(prev => ({ ...prev, label: e.target.value }))} /></div>
                        <div><label style={labelStyle}>Prompt</label><textarea style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12, minHeight: 300, resize: 'vertical', width: '100%' }} value={editPromptData.prompt || ''} onChange={e => setEditPromptData(prev => ({ ...prev, prompt: e.target.value }))} /><div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{(editPromptData.prompt || '').length} chars</div></div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button primary onClick={() => savePrompt(p.id)}>Save</Button>
                          <Button onClick={() => setEditingPrompt(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{p.label}</div>
                            <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>Type: {p.call_type}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {p.active && <Badge color={T.success}>Active</Badge>}
                            <Button style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => { setEditingPrompt(p.id); setEditPromptData({ label: p.label, prompt: p.prompt }) }}>Edit</Button>
                          </div>
                        </div>
                        {p.prompt && (
                          <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 11, lineHeight: 1.5, color: T.textSecondary, background: T.surfaceAlt, padding: 10, borderRadius: 4, maxHeight: 80, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                            {p.prompt.substring(0, 200)}{p.prompt.length > 200 ? '...' : ''}
                          </div>
                        )}
                      </>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {/* ══════════ DOCUMENTS ══════════ */}
            {tab === 'docs' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}><Button primary onClick={() => setShowAddDoc(true)}>+ Add Document</Button></div>
                {showAddDoc && (
                  <Card title="New Document" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={newDoc.name} onChange={e => setNewDoc(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
                      <div><label style={labelStyle}>Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newDoc.doc_type} onChange={e => setNewDoc(p => ({ ...p, doc_type: e.target.value }))}>
                        {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
                    </div>
                    <div style={{ marginBottom: 10 }}><label style={labelStyle}>Content (paste document text)</label><textarea style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12, minHeight: 200, resize: 'vertical' }} value={newDoc.content} onChange={e => setNewDoc(p => ({ ...p, content: e.target.value }))} placeholder="Paste document content..." /></div>
                    <div style={{ display: 'flex', gap: 6 }}><Button primary onClick={addDocument}>Add Document</Button><Button onClick={() => setShowAddDoc(false)}>Cancel</Button></div>
                  </Card>
                )}
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
                        </div>
                      </div>
                    </Card>
                  ))}
              </div>
            )}

            {/* ══════════ SCORING ══════════ */}
            {tab === 'scoring' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {scoringConfigs.map(s => (
                  <ScoringConfigEditor key={s.id} config={s}
                    onSaved={(patch) => setScoringConfigs(prev => prev.map(x => x.id === s.id ? { ...x, ...patch } : x))} />
                ))}
              </div>
            )}

            {/* ══════════ REP SCORING ══════════ */}
            {tab === 'rep_scoring' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <Button primary onClick={addRepScoringCriteria}>+ Add Criteria</Button>
                </div>
                {repScoringConfigs.length === 0 ? (
                  <Card><div style={{ textAlign: 'center', padding: 32, color: T.textMuted }}>No rep scoring criteria configured.</div></Card>
                ) : repScoringConfigs.map(config => (
                  <Card key={config.id} title={config.criteria_name}
                    action={
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div onClick={() => updateRepScoring(config.id, 'active', !config.active)}
                          style={{ width: 40, height: 22, borderRadius: 11, cursor: 'pointer', background: config.active ? T.success : T.borderLight, position: 'relative', transition: 'background 0.2s' }}>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: config.active ? 20 : 2, boxShadow: T.shadow, transition: 'left 0.2s' }} />
                        </div>
                        <button onClick={() => deleteRepScoringCriteria(config.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16, padding: '2px 4px' }}
                          onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&#10005;</button>
                      </div>
                    }>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div><label style={labelStyle}>Criteria Name</label><input style={inputStyle} defaultValue={config.criteria_name} onBlur={e => updateRepScoring(config.id, 'criteria_name', e.target.value)} /></div>
                      <div><label style={labelStyle}>Description</label><input style={inputStyle} defaultValue={config.description || ''} onBlur={e => updateRepScoring(config.id, 'description', e.target.value)} /></div>
                      <div><label style={labelStyle}>Max Score</label><input type="number" style={inputStyle} defaultValue={config.max_score} onBlur={e => updateRepScoring(config.id, 'max_score', Number(e.target.value) || 10)} /></div>
                      <div><label style={labelStyle}>Weight</label><input type="number" step="0.1" style={inputStyle} defaultValue={config.weight} onBlur={e => updateRepScoring(config.id, 'weight', Number(e.target.value) || 1.0)} /></div>
                      <div><label style={labelStyle}>Category</label><select style={{ ...inputStyle, cursor: 'pointer' }} defaultValue={config.category || 'general'} onChange={e => updateRepScoring(config.id, 'category', e.target.value)}>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}</select></div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* ══════════ MSP TEMPLATES ══════════ */}
            {tab === 'templates' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <Button primary onClick={() => setShowAddTemplate(true)}>+ Create Template</Button>
                </div>

                {showAddTemplate && (
                  <Card title="New Template" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}><label style={labelStyle}>Name *</label><input style={inputStyle} value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
                      <div style={{ flex: 1 }}><label style={labelStyle}>Description</label><input style={inputStyle} value={newTemplate.description} onChange={e => setNewTemplate(p => ({ ...p, description: e.target.value }))} /></div>
                      <Button primary onClick={addTemplate}>Create</Button>
                      <Button onClick={() => setShowAddTemplate(false)}>Cancel</Button>
                    </div>
                  </Card>
                )}

                {mspTemplates.length === 0 ? (
                  <Card><div style={{ textAlign: 'center', padding: 32, color: T.textMuted }}>No MSP templates. Create one to allow reps to quickly populate deal timelines.</div></Card>
                ) : mspTemplates.map(tpl => {
                  const tplStages = templateStages.filter(s => s.template_id === tpl.id)
                  const isExpanded = expandedTemplate === tpl.id

                  return (
                    <div key={tpl.id} style={{
                      background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
                      boxShadow: T.shadow, marginBottom: 16, overflow: 'hidden',
                    }}>
                      {/* Template header */}
                      <div style={{
                        padding: '12px 18px', background: T.surfaceAlt, borderBottom: isExpanded ? `1px solid ${T.border}` : 'none',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                      }} onClick={() => setExpandedTemplate(isExpanded ? null : tpl.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 12, color: T.textMuted, transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>{'\u25B6'}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{tpl.template_name || tpl.name}</span>
                          {tpl.is_default && <Badge color={T.success}>Default</Badge>}
                          <span style={{ fontSize: 12, color: T.textSecondary }}>{tplStages.length} stage{tplStages.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                          {!tpl.is_default && (
                            <Button style={{ padding: '3px 8px', fontSize: 10 }} onClick={() => updateTemplate(tpl.id, 'is_default', true)}>Set Default</Button>
                          )}
                          <Button style={{ padding: '3px 8px', fontSize: 10 }}
                            onClick={() => { setShowAddTemplateStage(tpl.id); setNewTemplateStage({ stage_name: '', default_duration_days: 14 }) }}>+ Stage</Button>
                          <button onClick={() => deleteTemplate(tpl.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}
                            onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&#10005;</button>
                        </div>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div style={{ padding: 18 }}>
                          {tpl.description && <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 12 }}>{tpl.description}</div>}

                          {/* Add stage form */}
                          {showAddTemplateStage === tpl.id && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 12, background: T.surfaceAlt, borderRadius: 6, marginBottom: 12, border: `1px solid ${T.borderLight}` }}>
                              <div style={{ flex: 1 }}><label style={labelStyle}>Step Name *</label><input style={inputStyle} value={newTemplateStage.stage_name} onChange={e => setNewTemplateStage(p => ({ ...p, stage_name: e.target.value }))} autoFocus /></div>
                              <div style={{ width: 140 }}><label style={labelStyle}>Days offset from start</label><input type="number" style={inputStyle} value={newTemplateStage.due_date_offset} onChange={e => setNewTemplateStage(p => ({ ...p, due_date_offset: e.target.value }))} /></div>
                              <Button primary onClick={() => addTemplateStage(tpl.id)}>Add</Button>
                              <Button onClick={() => setShowAddTemplateStage(null)}>Cancel</Button>
                            </div>
                          )}

                          {tplStages.length === 0 ? (
                            <div style={{ color: T.textMuted, fontSize: 13, textAlign: 'center', padding: 16 }}>No stages. Click "+ Stage" to add one.</div>
                          ) : tplStages.map((s, si) => (
                              <TemplateStageRow key={s.id} stage={s} index={si}
                                onUpdate={(field, val) => updateTemplateStage(s.id, field, val)}
                                onDelete={() => deleteTemplateStage(s.id)} />
                            ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ══════════ EMAIL TEMPLATES ══════════ */}
            {tab === 'emails' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <Button primary onClick={() => setShowAddEmailTemplate(true)}>+ Create Email Template</Button>
                </div>

                {showAddEmailTemplate && (
                  <Card title="New Email Template" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={newEmailTpl.name} onChange={e => setNewEmailTpl(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
                      <div><label style={labelStyle}>Email Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newEmailTpl.email_type} onChange={e => setNewEmailTpl(p => ({ ...p, email_type: e.target.value }))}>
                        {EMAIL_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
                    </div>
                    <div style={{ marginBottom: 10 }}><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={newEmailTpl.description} onChange={e => setNewEmailTpl(p => ({ ...p, description: e.target.value }))} /></div>
                    <div style={{ display: 'flex', gap: 6 }}><Button primary onClick={addEmailTemplate}>Save</Button><Button onClick={() => setShowAddEmailTemplate(false)}>Cancel</Button></div>
                  </Card>
                )}

                {emailTemplatesAdmin.length === 0 ? (
                  <Card><div style={{ textAlign: 'center', padding: 32, color: T.textMuted }}>No email templates. Create one to enable AI-generated emails.</div></Card>
                ) : emailTemplatesAdmin.map(tpl => {
                  const isExpanded = expandedEmailTemplate === tpl.id
                  return (
                    <div key={tpl.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow, marginBottom: 12, overflow: 'hidden' }}>
                      {/* Header */}
                      <div style={{ padding: '12px 18px', background: T.surfaceAlt, borderBottom: isExpanded ? `1px solid ${T.border}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                        onClick={() => setExpandedEmailTemplate(isExpanded ? null : tpl.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 12, color: T.textMuted, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>{'\u25B6'}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{tpl.name}</span>
                          <Badge color={T.primary}>{(tpl.email_type || '').replace(/_/g, ' ')}</Badge>
                          {tpl.recipient_type && <Badge color={T.textMuted}>{tpl.recipient_type}</Badge>}
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                          <div onClick={() => updateEmailTemplate(tpl.id, 'active', !tpl.active)} style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer', background: tpl.active ? T.success : T.borderLight, position: 'relative', transition: 'background 0.2s' }}>
                            <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: tpl.active ? 18 : 2, boxShadow: T.shadow, transition: 'left 0.2s' }} />
                          </div>
                          <button onClick={() => deleteEmailTemplate(tpl.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}
                            onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&times;</button>
                        </div>
                      </div>

                      {/* Expanded editor */}
                      {isExpanded && (
                        <div style={{ padding: 18 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                            <div><label style={labelStyle}>Name</label><input style={inputStyle} defaultValue={tpl.name} onBlur={e => updateEmailTemplate(tpl.id, 'name', e.target.value)} /></div>
                            <div><label style={labelStyle}>Email Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} defaultValue={tpl.email_type} onChange={e => updateEmailTemplate(tpl.id, 'email_type', e.target.value)}>
                              {EMAIL_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
                          </div>
                          <div style={{ marginBottom: 12 }}><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} defaultValue={tpl.description || ''} onBlur={e => updateEmailTemplate(tpl.id, 'description', e.target.value)} /></div>
                          <div style={{ marginBottom: 12 }}>
                            <label style={labelStyle}>Subject Template</label>
                            <input style={inputStyle} defaultValue={tpl.subject_template || ''} onBlur={e => updateEmailTemplate(tpl.id, 'subject_template', e.target.value)} placeholder="e.g. {{company_name}} - Follow Up from {{call_type}}" />
                            <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>Tokens: {'{{company_name}} {{deal_value}} {{forecast_category}} {{call_type}} {{call_date}}'}</div>
                          </div>
                          <EmailBodyTemplateEditor tpl={tpl} onSave={(val) => updateEmailTemplate(tpl.id, 'body_template', val)} />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                            <div>
                              <label style={labelStyle}>Tone & Voice</label>
                              <input style={inputStyle} defaultValue={tpl.tone || ''} onBlur={e => updateEmailTemplate(tpl.id, 'tone', e.target.value)} placeholder="e.g. Professional, direct" />
                            </div>
                            <div>
                              <label style={labelStyle}>Format</label>
                              <input style={inputStyle} defaultValue={tpl.response_format || ''} onBlur={e => updateEmailTemplate(tpl.id, 'response_format', e.target.value)} placeholder="e.g. Bullets, max 300 words" />
                            </div>
                            <div>
                              <label style={labelStyle}>Rules (dos/don'ts)</label>
                              <input style={inputStyle} defaultValue={tpl.rules || ''} onBlur={e => updateEmailTemplate(tpl.id, 'rules', e.target.value)} placeholder="e.g. Never promise pricing" />
                            </div>
                            <div>
                              <label style={labelStyle}>Custom Instructions</label>
                              <input style={inputStyle} defaultValue={tpl.ai_instructions || ''} onBlur={e => updateEmailTemplate(tpl.id, 'ai_instructions', e.target.value)} placeholder="Extra instructions..." />
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                            <div><label style={labelStyle}>Recipient Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} defaultValue={tpl.recipient_type || 'internal'} onChange={e => updateEmailTemplate(tpl.id, 'recipient_type', e.target.value)}>
                              {RECIPIENT_TYPES.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                            <div><label style={labelStyle}>Default Recipients</label><input style={inputStyle} defaultValue={tpl.default_recipients || ''} onBlur={e => updateEmailTemplate(tpl.id, 'default_recipients', e.target.value)} placeholder="email@example.com" /></div>
                          </div>
                          <div style={{ marginBottom: 8 }}><label style={labelStyle}>Context to Include</label></div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                            {CONTEXT_FIELDS.map(cf => {
                              const current = tpl.context_include || []
                              const checked = Array.isArray(current) ? current.includes(cf) : false
                              return (
                                <label key={cf} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.text, cursor: 'pointer' }}>
                                  <input type="checkbox" checked={checked} onChange={() => {
                                    const newVal = checked ? current.filter(x => x !== cf) : [...current, cf]
                                    updateEmailTemplate(tpl.id, 'context_include', newVal)
                                  }} />
                                  {cf.replace(/_/g, ' ')}
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ===== RESEARCH TAB ===== */}
        {tab === 'research' && coach && (
          <>
            <Card title="Perplexity Integration">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={researchConfig?.use_perplexity || false}
                    onChange={async e => {
                      const val = e.target.checked
                      if (researchConfig?.id) {
                        await supabase.from('coach_research_config').update({ use_perplexity: val }).eq('id', researchConfig.id)
                        setResearchConfig(p => ({ ...p, use_perplexity: val }))
                      } else {
                        const { data } = await supabase.from('coach_research_config').insert({ coach_id: coach.id, use_perplexity: val }).select().single()
                        if (data) setResearchConfig(data)
                      }
                    }} />
                  Enable Perplexity Research
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Perplexity API Key</label>
                  <input type="password" style={inputStyle} defaultValue={researchConfig?.perplexity_api_key || ''} placeholder="pplx-..."
                    onBlur={async e => {
                      if (!researchConfig?.id) return
                      await supabase.from('coach_research_config').update({ perplexity_api_key: e.target.value }).eq('id', researchConfig.id)
                    }} />
                </div>
                <div>
                  <label style={labelStyle}>Perplexity Model</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={researchConfig?.perplexity_model || 'sonar'}
                    onChange={async e => {
                      if (!researchConfig?.id) return
                      await supabase.from('coach_research_config').update({ perplexity_model: e.target.value }).eq('id', researchConfig.id)
                      setResearchConfig(p => ({ ...p, perplexity_model: e.target.value }))
                    }}>
                    <option value="sonar">sonar -- Fast, $0.20/M tokens</option>
                    <option value="sonar-pro">sonar-pro -- Better quality, $0.50/M tokens</option>
                    <option value="sonar-reasoning">sonar-reasoning -- Multi-step reasoning, $1/M tokens</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Claude Model for Research</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={researchConfig?.claude_model || 'claude-sonnet-4-20250514'}
                  onChange={async e => {
                    if (!researchConfig?.id) return
                    await supabase.from('coach_research_config').update({ claude_model: e.target.value }).eq('id', researchConfig.id)
                    setResearchConfig(p => ({ ...p, claude_model: e.target.value }))
                  }}>
                  <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514 -- Best balance</option>
                  <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001 -- Fastest, cheapest</option>
                </select>
              </div>
            </Card>
            <Card title="Focus Areas">
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>Type and press Enter or comma to add a bubble. These guide what the AI researches about each company.</div>
              <TagInput
                label=""
                value={researchConfig?.focus_areas || []}
                onChange={async (next) => {
                  if (!researchConfig?.id) return
                  setResearchConfig(p => ({ ...p, focus_areas: next }))
                  await supabase.from('coach_research_config').update({ focus_areas: next }).eq('id', researchConfig.id)
                }}
                placeholder="e.g. tech stack modernization, M&A activity, hiring freeze..." />
            </Card>
            <Card title="Anti-Rules / What NOT to do">
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>Things the AI should avoid when researching or writing. Type and press Enter to add.</div>
              <TagInput
                label=""
                value={researchConfig?.anti_rules || []}
                onChange={async (next) => {
                  if (!researchConfig?.id) return
                  setResearchConfig(p => ({ ...p, anti_rules: next }))
                  await supabase.from('coach_research_config').update({ anti_rules: next }).eq('id', researchConfig.id)
                }}
                placeholder="e.g. don't speculate on internal politics, never quote revenue figures without citation..." />
            </Card>
            <Card title="Custom Research Instructions">
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>Additional instructions for the AI when researching companies.</div>
              <textarea style={{ ...inputStyle, fontFamily: T.font, fontSize: 13, lineHeight: 1.55, minHeight: 140, resize: 'vertical', width: '100%' }}
                defaultValue={researchConfig?.custom_instructions || ''}
                onBlur={async e => {
                  if (!researchConfig?.id) return
                  await supabase.from('coach_research_config').update({ custom_instructions: e.target.value }).eq('id', researchConfig.id)
                  setResearchConfig(p => ({ ...p, custom_instructions: e.target.value }))
                }} />
            </Card>
          </>
        )}

        {/* ===== SLIDES TAB ===== */}
        {tab === 'slides' && coach && (
          <>
            <Card title="Default Sales Team">
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>Team members that appear on every Team Introductions slide.</div>
              {(slideConfig?.sage_team_defaults || []).map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid ' + T.borderLight }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                  <span style={{ fontSize: 12, color: T.textMuted }}>{m.title}</span>
                  <span style={{ cursor: 'pointer', color: T.textMuted, fontSize: 14 }} onClick={async () => {
                    const updated = (slideConfig.sage_team_defaults || []).filter((_, idx) => idx !== i)
                    await supabase.from('coach_slide_config').update({ sage_team_defaults: updated }).eq('id', slideConfig.id)
                    setSlideConfig(p => ({ ...p, sage_team_defaults: updated }))
                  }}>&times;</span>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input id="st-name" placeholder="Name" style={{ ...inputStyle, flex: 1 }} />
                <input id="st-title" placeholder="Title" style={{ ...inputStyle, flex: 1 }} />
                <Button onClick={async () => {
                  const name = document.getElementById('st-name').value.trim()
                  const title = document.getElementById('st-title').value.trim()
                  if (!name) return
                  const updated = [...(slideConfig?.sage_team_defaults || []), { name, title }]
                  if (slideConfig?.id) {
                    await supabase.from('coach_slide_config').update({ sage_team_defaults: updated }).eq('id', slideConfig.id)
                    setSlideConfig(p => ({ ...p, sage_team_defaults: updated }))
                  } else {
                    const { data } = await supabase.from('coach_slide_config').insert({ coach_id: coach.id, sage_team_defaults: updated }).select().single()
                    if (data) setSlideConfig(data)
                  }
                  document.getElementById('st-name').value = ''
                  document.getElementById('st-title').value = ''
                }} style={{ padding: '6px 12px', fontSize: 11 }}>+ Add</Button>
              </div>
            </Card>
            <Card title="Branding">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Primary Color</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={'#' + (slideConfig?.primary_color || '00D639')} onChange={async e => {
                      const val = e.target.value.replace('#', '')
                      if (!slideConfig?.id) return
                      await supabase.from('coach_slide_config').update({ primary_color: val }).eq('id', slideConfig.id)
                      setSlideConfig(p => ({ ...p, primary_color: val }))
                    }} style={{ width: 40, height: 30, border: 'none', cursor: 'pointer' }} />
                    <span style={{ fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>#{slideConfig?.primary_color || '00D639'}</span>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Accent Color</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={'#' + (slideConfig?.accent_color || '1A1A2E')} onChange={async e => {
                      const val = e.target.value.replace('#', '')
                      if (!slideConfig?.id) return
                      await supabase.from('coach_slide_config').update({ accent_color: val }).eq('id', slideConfig.id)
                      setSlideConfig(p => ({ ...p, accent_color: val }))
                    }} style={{ width: 40, height: 30, border: 'none', cursor: 'pointer' }} />
                    <span style={{ fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>#{slideConfig?.accent_color || '1A1A2E'}</span>
                  </div>
                </div>
              </div>
            </Card>
            <Card title="Footer & Fonts">
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Footer Text</label>
                <input style={inputStyle} defaultValue={slideConfig?.footer_text || '\u00A9 {year} All rights reserved.'}
                  onBlur={async e => { if (!slideConfig?.id) return; await supabase.from('coach_slide_config').update({ footer_text: e.target.value }).eq('id', slideConfig.id) }} />
                <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>Use {'{year}'} for dynamic year</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Title Font</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={slideConfig?.title_font || 'Calibri'} onChange={async e => {
                    if (!slideConfig?.id) return
                    await supabase.from('coach_slide_config').update({ title_font: e.target.value }).eq('id', slideConfig.id)
                    setSlideConfig(p => ({ ...p, title_font: e.target.value }))
                  }}>{['Calibri', 'Arial', 'Georgia', 'Trebuchet MS', 'Cambria'].map(f => <option key={f} value={f}>{f}</option>)}</select>
                </div>
                <div>
                  <label style={labelStyle}>Body Font</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={slideConfig?.body_font || 'Arial'} onChange={async e => {
                    if (!slideConfig?.id) return
                    await supabase.from('coach_slide_config').update({ body_font: e.target.value }).eq('id', slideConfig.id)
                    setSlideConfig(p => ({ ...p, body_font: e.target.value }))
                  }}>{['Arial', 'Calibri', 'Georgia', 'Trebuchet MS', 'Cambria'].map(f => <option key={f} value={f}>{f}</option>)}</select>
                </div>
                <div>
                  <label style={labelStyle}>Title Size</label>
                  <input type="number" style={inputStyle} defaultValue={slideConfig?.title_size || 32} onBlur={async e => {
                    if (!slideConfig?.id) return; await supabase.from('coach_slide_config').update({ title_size: Number(e.target.value) }).eq('id', slideConfig.id)
                  }} />
                </div>
                <div>
                  <label style={labelStyle}>Body Size</label>
                  <input type="number" style={inputStyle} defaultValue={slideConfig?.body_size || 16} onBlur={async e => {
                    if (!slideConfig?.id) return; await supabase.from('coach_slide_config').update({ body_size: Number(e.target.value) }).eq('id', slideConfig.id)
                  }} />
                </div>
              </div>
            </Card>
            <Card title="Default Selected Slides">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {['team_introductions', 'company_overview', 'why_we_are_here', 'solution_priorities', 'solution_map', 'agenda'].map(st => {
                  const defaults = slideConfig?.default_slides || ['team_introductions', 'company_overview', 'why_we_are_here', 'solution_priorities']
                  const checked = defaults.includes(st)
                  return (
                    <label key={st} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked} onChange={async () => {
                        const updated = checked ? defaults.filter(s => s !== st) : [...defaults, st]
                        if (!slideConfig?.id) return
                        await supabase.from('coach_slide_config').update({ default_slides: updated }).eq('id', slideConfig.id)
                        setSlideConfig(p => ({ ...p, default_slides: updated }))
                      }} />
                      {st.replace(/_/g, ' ')}
                    </label>
                  )
                })}
              </div>
            </Card>
          </>
        )}

        {/* ===== ICP TAB ===== */}
        {tab === 'icp' && coach && (() => {
          const weightTotal = (icpForm.weight_industry || 0) + (icpForm.weight_revenue || 0) + (icpForm.weight_employees || 0) + (icpForm.weight_entities || 0) + (icpForm.weight_current_system || 0) + (icpForm.weight_buying_signals || 0)

          async function saveIcp() {
            const record = {
              coach_id: coach.id, name: icpForm.name || 'Default ICP', active: true,
              industries: icpForm.industries, geographies: icpForm.geographies,
              revenue_min: icpForm.revenue_min || null, revenue_max: icpForm.revenue_max || null,
              employee_min: icpForm.employee_min || null, employee_max: icpForm.employee_max || null,
              entity_count_min: icpForm.entity_count_min || null, entity_count_max: icpForm.entity_count_max || null,
              current_systems: icpForm.current_systems, tech_red_flags: icpForm.tech_red_flags,
              buying_signals: icpForm.buying_signals, disqualifiers: icpForm.disqualifiers,
              weight_industry: icpForm.weight_industry, weight_revenue: icpForm.weight_revenue,
              weight_employees: icpForm.weight_employees, weight_entities: icpForm.weight_entities,
              weight_current_system: icpForm.weight_current_system, weight_buying_signals: icpForm.weight_buying_signals,
              personas: icpForm.personas, green_flags: icpForm.green_flags, red_flags: icpForm.red_flags,
              functional_green_flags: icpForm.functional_green_flags, functional_red_flags: icpForm.functional_red_flags,
            }
            if (icp?.id) {
              await supabase.from('coach_icp').update(record).eq('id', icp.id)
            } else {
              const { data } = await supabase.from('coach_icp').insert(record).select().single()
              if (data) setIcp(data)
            }
          }

          async function testIcpScore() {
            if (!icpTestDealId) return
            setIcpTestResult(null)
            const { data, error } = await supabase.rpc('compute_icp_score', { p_deal_id: icpTestDealId, p_coach_id: coach.id })
            if (error) setIcpTestResult({ error: error.message })
            else setIcpTestResult(data)
          }

          return (
            <>
              <Card title="Ideal Customer Profile">
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>ICP Name</label>
                  <input style={inputStyle} value={icpForm.name} onChange={e => setIcpForm(p => ({ ...p, name: e.target.value }))} />
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Target Firmographics</div>
                <TagInput label="Industries" value={icpForm.industries} onChange={v => setIcpForm(p => ({ ...p, industries: v }))} placeholder="e.g. Healthcare, Manufacturing..." />
                <TagInput label="Geographies" value={icpForm.geographies} onChange={v => setIcpForm(p => ({ ...p, geographies: v }))} placeholder="e.g. US, Canada, UK..." />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div><label style={labelStyle}>Revenue Min ($)</label><input type="number" style={inputStyle} value={icpForm.revenue_min} onChange={e => setIcpForm(p => ({ ...p, revenue_min: e.target.value }))} placeholder="e.g. 5000000" /></div>
                  <div><label style={labelStyle}>Revenue Max ($)</label><input type="number" style={inputStyle} value={icpForm.revenue_max} onChange={e => setIcpForm(p => ({ ...p, revenue_max: e.target.value }))} placeholder="e.g. 500000000" /></div>
                  <div><label style={labelStyle}>Employee Min</label><input type="number" style={inputStyle} value={icpForm.employee_min} onChange={e => setIcpForm(p => ({ ...p, employee_min: e.target.value }))} placeholder="e.g. 25" /></div>
                  <div><label style={labelStyle}>Employee Max</label><input type="number" style={inputStyle} value={icpForm.employee_max} onChange={e => setIcpForm(p => ({ ...p, employee_max: e.target.value }))} placeholder="e.g. 5000" /></div>
                  <div><label style={labelStyle}>Entity Count Min</label><input type="number" style={inputStyle} value={icpForm.entity_count_min} onChange={e => setIcpForm(p => ({ ...p, entity_count_min: e.target.value }))} placeholder="e.g. 2" /></div>
                  <div><label style={labelStyle}>Entity Count Max</label><input type="number" style={inputStyle} value={icpForm.entity_count_max} onChange={e => setIcpForm(p => ({ ...p, entity_count_max: e.target.value }))} placeholder="e.g. 50" /></div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>System Signals</div>
                <TagInput label="Current Systems (good fit)" value={icpForm.current_systems} onChange={v => setIcpForm(p => ({ ...p, current_systems: v }))} placeholder="e.g. QuickBooks, Xero, NetSuite..." />
                <TagInput label="Tech Red Flags" value={icpForm.tech_red_flags} onChange={v => setIcpForm(p => ({ ...p, tech_red_flags: v }))} placeholder="e.g. SAP, Oracle..." />

                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Behavioral Signals</div>
                <TagInput label="Buying Signals" value={icpForm.buying_signals} onChange={v => setIcpForm(p => ({ ...p, buying_signals: v }))} placeholder="e.g. PE acquisition, CFO hire..." />
                <TagInput label="Disqualifiers" value={icpForm.disqualifiers} onChange={v => setIcpForm(p => ({ ...p, disqualifiers: v }))} placeholder="e.g. Government, Pre-revenue..." />

                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Business Flags</div>
                <TagInput label="Green Flags (positive indicators)" value={icpForm.green_flags} onChange={v => setIcpForm(p => ({ ...p, green_flags: v }))} placeholder="e.g. Executive sponsor identified, Pain tied to revenue, Budget approved..." />
                <TagInput label="Red Flags (risk indicators)" value={icpForm.red_flags} onChange={v => setIcpForm(p => ({ ...p, red_flags: v }))} placeholder="e.g. No executive access, Unclear decision process, Competitor entrenched..." />

                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Functional / Product Flags</div>
                <TagInput label="Functional Green Flags (good fit features)" value={icpForm.functional_green_flags} onChange={v => setIcpForm(p => ({ ...p, functional_green_flags: v }))} placeholder="e.g. Multi-entity consolidation needed, AP automation required..." />
                <TagInput label="Functional Red Flags (poor fit requirements)" value={icpForm.functional_red_flags} onChange={v => setIcpForm(p => ({ ...p, functional_red_flags: v }))} placeholder="e.g. Requires on-premise deployment, Needs payroll processing..." />

                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Buyer Personas</div>
                <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>Key buyer roles your reps engage with. Manage detailed personas in Coach Builder.</div>
                {(icpForm.personas || []).map((p, i) => (
                  <div key={i} style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{p.title || `Persona ${i + 1}`}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {p.role_in_decision && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'rgba(93,173,226,0.1)', color: T.primary, fontWeight: 600 }}>{p.role_in_decision.replace(/_/g, ' ')}</span>}
                        <button onClick={() => setIcpForm(prev => ({ ...prev, personas: prev.personas.filter((_, j) => j !== i) }))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}
                          onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&times;</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div><label style={labelStyle}>Title</label><input style={inputStyle} value={p.title || ''} onChange={e => { const u = [...icpForm.personas]; u[i] = { ...u[i], title: e.target.value }; setIcpForm(prev => ({ ...prev, personas: u })) }} /></div>
                      <div><label style={labelStyle}>Role in Decision</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={p.role_in_decision || ''} onChange={e => { const u = [...icpForm.personas]; u[i] = { ...u[i], role_in_decision: e.target.value }; setIcpForm(prev => ({ ...prev, personas: u })) }}>
                        <option value="">Select...</option><option value="economic_buyer">Economic Buyer</option><option value="champion">Champion</option><option value="technical_evaluator">Technical Evaluator</option><option value="end_user">End User</option><option value="influencer">Influencer</option><option value="blocker">Potential Blocker</option><option value="coach">Coach</option>
                      </select></div>
                    </div>
                    <div style={{ marginTop: 6 }}><label style={labelStyle}>Pain Points</label><textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical', fontSize: 12 }} value={p.pain_points || ''} onChange={e => { const u = [...icpForm.personas]; u[i] = { ...u[i], pain_points: e.target.value }; setIcpForm(prev => ({ ...prev, personas: u })) }} /></div>
                    <div style={{ marginTop: 6 }}><label style={labelStyle}>Priorities</label><textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical', fontSize: 12 }} value={p.priorities || ''} onChange={e => { const u = [...icpForm.personas]; u[i] = { ...u[i], priorities: e.target.value }; setIcpForm(prev => ({ ...prev, personas: u })) }} /></div>
                    <div style={{ marginTop: 6 }}><label style={labelStyle}>Common Objections</label><textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical', fontSize: 12 }} value={p.objections || ''} onChange={e => { const u = [...icpForm.personas]; u[i] = { ...u[i], objections: e.target.value }; setIcpForm(prev => ({ ...prev, personas: u })) }} /></div>
                  </div>
                ))}
                <button onClick={() => setIcpForm(prev => ({ ...prev, personas: [...(prev.personas || []), { title: '', role_in_decision: '', pain_points: '', priorities: '', objections: '' }] }))}
                  style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: T.primary, fontFamily: T.font, marginTop: 4 }}>+ Add Persona</button>

                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Scoring Weights</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '6px 12px', background: weightTotal === 100 ? T.successLight : T.errorLight, borderRadius: 6, border: `1px solid ${weightTotal === 100 ? T.success + '40' : T.error + '40'}` }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: weightTotal === 100 ? T.success : T.error }}>Total: {weightTotal}/100</span>
                  {weightTotal !== 100 && <span style={{ fontSize: 11, color: T.error }}>Weights should sum to 100</span>}
                </div>
                {[
                  { key: 'weight_industry', label: 'Industry Match' },
                  { key: 'weight_revenue', label: 'Revenue Range' },
                  { key: 'weight_employees', label: 'Employee Count' },
                  { key: 'weight_entities', label: 'Entity Count' },
                  { key: 'weight_current_system', label: 'Current System' },
                  { key: 'weight_buying_signals', label: 'Buying Signals' },
                ].map(w => (
                  <div key={w.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: T.text, width: 120, flexShrink: 0 }}>{w.label}</span>
                    <input type="range" min="0" max="100" value={icpForm[w.key] || 0} onChange={e => setIcpForm(p => ({ ...p, [w.key]: Number(e.target.value) }))} style={{ flex: 1, accentColor: T.primary }} />
                    <input type="number" min="0" max="100" value={icpForm[w.key] || 0} onChange={e => setIcpForm(p => ({ ...p, [w.key]: Number(e.target.value) }))} style={{ ...inputStyle, width: 50, textAlign: 'center', padding: '4px' }} />
                  </div>
                ))}

                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <Button primary onClick={saveIcp}>Save ICP</Button>
                </div>
              </Card>

              <Card title="Test ICP Score">
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Select a Deal</label>
                    <select style={{ ...inputStyle, cursor: 'pointer' }} value={icpTestDealId} onChange={e => setIcpTestDealId(e.target.value)}>
                      <option value="">Choose deal...</option>
                      {icpDeals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
                    </select>
                  </div>
                  <Button primary onClick={testIcpScore} disabled={!icpTestDealId}>Test Score</Button>
                </div>
                {icpTestResult && (
                  icpTestResult.error ? (
                    <div style={{ color: T.error, fontSize: 12, padding: 10, background: T.errorLight, borderRadius: 6 }}>{icpTestResult.error}</div>
                  ) : (
                    <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                        <div style={{ fontSize: 36, fontWeight: 800, color: (icpTestResult.score ?? icpTestResult) >= 70 ? T.success : (icpTestResult.score ?? icpTestResult) >= 40 ? T.warning : T.error }}>
                          {icpTestResult.score ?? icpTestResult}
                        </div>
                        <span style={{ fontSize: 14, color: T.textMuted }}>/100</span>
                      </div>
                      {icpTestResult.breakdown && typeof icpTestResult.breakdown === 'object' && (
                        <div>
                          {Object.entries(icpTestResult.breakdown).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${T.borderLight}`, fontSize: 12 }}>
                              <span style={{ color: T.text }}>{k.replace(/_/g, ' ')}</span>
                              <span style={{ fontWeight: 700, color: typeof v === 'number' ? (v > 0 ? T.success : T.textMuted) : T.text }}>{typeof v === 'number' ? v : JSON.stringify(v)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}
              </Card>
            </>
          )
        })()}

        {/* ═══ SHARING ═══ */}
        {tab === 'sharing' && coach && (
          <>
            <Card title="Share This Coach">
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>
                Generate a share token so other users can add this coach to their Settings. Tokens can be limited by use count and expiry.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Label (optional)</label>
                  <input style={inputStyle} value={newTokenLabel} onChange={e => setNewTokenLabel(e.target.value)} placeholder="e.g. Partner network, Q1 beta cohort" />
                </div>
                <div>
                  <label style={labelStyle}>Max uses</label>
                  <input type="number" style={inputStyle} value={newTokenMaxUses} onChange={e => setNewTokenMaxUses(e.target.value)} placeholder="Unlimited" />
                </div>
                <div>
                  <label style={labelStyle}>Expires</label>
                  <input type="date" style={inputStyle} value={newTokenExpires} onChange={e => setNewTokenExpires(e.target.value)} />
                </div>
                <Button primary onClick={async () => {
                  const { data, error } = await supabase.from('coach_share_tokens').insert({
                    coach_id: coach.id, created_by: profile.id,
                    label: newTokenLabel || null,
                    max_uses: newTokenMaxUses ? Number(newTokenMaxUses) : null,
                    expires_at: newTokenExpires ? new Date(newTokenExpires).toISOString() : null,
                  }).select().single()
                  if (!error && data) {
                    setShareTokens(prev => [data, ...prev])
                    setNewTokenLabel(''); setNewTokenMaxUses(''); setNewTokenExpires('')
                  } else if (error) { alert('Failed: ' + error.message) }
                }}>Generate</Button>
              </div>

              {shareTokens.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: T.textMuted, fontSize: 13 }}>No tokens yet.</div>
              ) : shareTokens.map(tk => (
                <div key={tk.id} style={{ padding: 10, background: tk.active ? T.surfaceAlt : T.surface, opacity: tk.active ? 1 : 0.5, borderRadius: 6, border: `1px solid ${T.borderLight}`, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{tk.label || 'Untitled token'}</div>
                      <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                        Uses: {tk.use_count}{tk.max_uses ? ` / ${tk.max_uses}` : ''} ·
                        {tk.expires_at ? ` Expires ${new Date(tk.expires_at).toLocaleDateString()}` : ' No expiry'} ·
                        Created {new Date(tk.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <code style={{ fontFamily: T.mono, fontSize: 11, padding: '4px 8px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text }}>{tk.token}</code>
                    <Button onClick={async () => {
                      try { await navigator.clipboard.writeText(tk.token); setCopiedToken(tk.id); setTimeout(() => setCopiedToken(null), 1500) } catch {}
                    }} style={{ padding: '4px 10px', fontSize: 11 }}>{copiedToken === tk.id ? 'Copied!' : 'Copy'}</Button>
                    <Button danger onClick={async () => {
                      if (!window.confirm('Revoke this token? Existing users who already redeemed it keep access, but no new redemptions.')) return
                      await supabase.from('coach_share_tokens').update({ active: false }).eq('id', tk.id)
                      setShareTokens(prev => prev.map(t => t.id === tk.id ? { ...t, active: false } : t))
                    }} style={{ padding: '4px 10px', fontSize: 11 }} disabled={!tk.active}>{tk.active ? 'Revoke' : 'Revoked'}</Button>
                  </div>
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

// Layered assembled-prompt preview with collapsible locked sections
function AssembledPromptPreview({ coach, editing, onEdit, onCancel, value, setValue, onSave }) {
  const [assembled, setAssembled] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState({ platform_core: false, methodology: false, coach: true, icp: false })

  async function reload() {
    if (!coach?.id) return
    setLoading(true)
    try {
      const { data } = await supabase.rpc('assemble_coach_prompt', { p_coach_id: coach.id, p_call_type: null, p_action: 'process_transcript' })
      setAssembled(data || '')
    } catch (e) { console.log('assemble error:', e) }
    setLoading(false)
  }

  useEffect(() => { if (coach?.id && !editing) reload() }, [coach?.id, editing])

  // Split the assembled content into its layer sections. The assembler uses "=== HEADER ===" banners.
  const sections = []
  if (assembled) {
    const regex = /=== ([^=]+?) ===/g
    let lastIdx = 0
    let lastName = null
    const matches = []
    let m
    while ((m = regex.exec(assembled)) !== null) matches.push({ name: m[1].trim(), start: m.index, end: m.index + m[0].length })
    if (matches.length === 0) {
      sections.push({ name: 'FULL PROMPT', content: assembled, locked: false })
    } else {
      for (let i = 0; i < matches.length; i++) {
        const cur = matches[i]
        const nextStart = i + 1 < matches.length ? matches[i + 1].start : assembled.length
        const body = assembled.slice(cur.end, nextStart).trim()
        const nameLC = cur.name.toLowerCase()
        const locked = nameLC.includes('platform core') || nameLC.includes('methodology')
        sections.push({ name: cur.name, content: body, locked })
      }
    }
  }

  return (
    <Card title="System Prompt (Assembled View)" action={
      <Button style={{ padding: '4px 12px', fontSize: 11 }} onClick={editing ? onCancel : onEdit}>{editing ? 'Cancel' : 'Edit Coach Context'}</Button>
    }>
      {editing ? (
        <div>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>Editing just the coach-level context. Platform core + methodology layers are managed by Revenue Instruments and can't be changed here.</div>
          <textarea style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12, minHeight: 260, resize: 'vertical', width: '100%' }}
            value={value} onChange={e => setValue(e.target.value)} placeholder="Your coach's personality, voice, and custom instructions..." />
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{(value || '').length} chars · autosaves on Save</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Button primary onClick={onSave}>Save</Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div>
          {loading && <div style={{ fontSize: 12, color: T.textMuted, textAlign: 'center', padding: 10 }}>Loading assembled prompt...</div>}
          {!loading && sections.length === 0 && (
            <div style={{ fontSize: 12, color: T.textMuted, padding: 12 }}>No prompt assembled. Make sure coach has an ID and try saving.</div>
          )}
          {!loading && sections.map((s, i) => {
            const key = s.name.toLowerCase().includes('platform') ? 'platform_core' : s.name.toLowerCase().includes('methodology') ? 'methodology' : s.name.toLowerCase().includes('icp') ? 'icp' : 'coach'
            const isExpanded = expanded[key] !== undefined ? expanded[key] : false
            const accent = s.locked ? T.textMuted : T.primary
            return (
              <div key={i} style={{ marginBottom: 8, border: `1px solid ${s.locked ? T.border : T.primary}40`, borderRadius: 6, overflow: 'hidden' }}>
                <button onClick={() => setExpanded(e => ({ ...e, [key]: !isExpanded }))}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 12px', background: s.locked ? T.surfaceAlt : (T.primaryLight || 'rgba(93,173,226,0.08)'), border: 'none', cursor: 'pointer', fontFamily: T.font, textAlign: 'left' }}>
                  <span style={{ fontSize: 10, color: accent, fontWeight: 800 }}>{isExpanded ? '▼' : '▶'}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{s.name}</span>
                  {s.locked && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: T.border, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>🔒 Managed by Revenue Instruments</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: T.textMuted }}>{s.content.length} chars</span>
                </button>
                {isExpanded && (
                  <pre style={{ margin: 0, padding: 12, background: s.locked ? T.surfaceAlt : T.surface, fontFamily: T.mono, fontSize: 11, lineHeight: 1.5, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto' }}>{s.content || '(empty)'}</pre>
                )}
              </div>
            )
          })}
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6, fontStyle: 'italic' }}>This is what the AI sees when processing transcripts for this coach.</div>
        </div>
      )}
    </Card>
  )
}

// Coach voice & behavior — structured fields rendered as clean labeled cards
function CoachVoiceEditor({ coach, onSaved }) {
  const [fields, setFields] = useState({
    tone: coach.tone || '',
    response_format: coach.response_format || '',
    behavior_rules: coach.behavior_rules || '',
    custom_context: coach.custom_context || '',
  })
  const [editing, setEditing] = useState(null) // field key or null
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setFields({
      tone: coach.tone || '',
      response_format: coach.response_format || '',
      behavior_rules: coach.behavior_rules || '',
      custom_context: coach.custom_context || '',
    })
  }, [coach.id])

  async function saveField(key) {
    setBusy(true)
    const patch = { [key]: fields[key] || null }
    const { error } = await supabase.from('coaches').update(patch).eq('id', coach.id)
    setBusy(false)
    if (error) { alert('Save failed: ' + error.message); return }
    onSaved?.(patch)
    setEditing(null)
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  const sections = [
    { key: 'tone', label: 'Tone & Voice', placeholder: 'e.g. Direct. Data-driven. Coach, not cheerleader. Short sentences.', accent: '#8b5cf6' },
    { key: 'response_format', label: 'Response Format', placeholder: 'e.g. Bullets under 2 lines each. Lead with the punch-line. No preamble.', accent: '#0ea5e9' },
    { key: 'behavior_rules', label: 'Behavior Rules', placeholder: 'e.g. Never guess. Always cite the transcript. Never flatter. If data is missing, say so.', accent: '#dc3545' },
    { key: 'custom_context', label: 'Custom Context', placeholder: 'Anything extra you want every response to keep in mind...', accent: '#10b981' },
  ]

  return (
    <Card title="Coach Voice & Behavior" action={saved ? <span style={{ fontSize: 11, color: T.success, fontWeight: 700 }}>✓ Saved</span> : null}>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10, fontFamily: T.font }}>
        Structured coach personality. These four fields are woven into every AI response — transcripts, chat, emails, research.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {sections.map(s => {
          const isEdit = editing === s.key
          const val = fields[s.key]
          return (
            <div key={s.key} style={{ border: `1px solid ${T.border}`, borderLeft: `3px solid ${s.accent}`, borderRadius: 6, padding: 10, background: T.surface }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: T.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</span>
                {!isEdit ? (
                  <button onClick={() => setEditing(s.key)} style={{ background: 'transparent', border: 'none', color: T.primary, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: T.font, padding: 0 }}>Edit</button>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => saveField(s.key)} disabled={busy} style={{ background: T.primary, color: '#fff', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: T.font }}>Save</button>
                    <button onClick={() => { setFields(f => ({ ...f, [s.key]: coach[s.key] || '' })); setEditing(null) }} style={{ background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: 4, padding: '3px 10px', fontSize: 10, cursor: 'pointer', fontFamily: T.font }}>Cancel</button>
                  </div>
                )}
              </div>
              {isEdit ? (
                <textarea value={val} onChange={e => setFields(f => ({ ...f, [s.key]: e.target.value }))}
                  placeholder={s.placeholder}
                  style={{ width: '100%', minHeight: 80, padding: 8, border: `1px solid ${T.border}`, borderRadius: 4, fontSize: 13, fontFamily: T.font, lineHeight: 1.5, color: T.text, background: T.surfaceAlt, resize: 'vertical', outline: 'none' }} />
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.55, color: val ? T.text : T.textMuted, fontStyle: val ? 'normal' : 'italic', fontFamily: T.font, whiteSpace: 'pre-wrap', minHeight: 40 }}>
                  {val || s.placeholder}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

const EXTRACTION_ENTITIES = [
  { key: 'pain_points', label: 'Pain Points' },
  { key: 'catalysts', label: 'Business Catalysts' },
  { key: 'compelling_events', label: 'Compelling Events' },
  { key: 'tasks', label: 'Tasks / Commitments' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'competitors', label: 'Competitors' },
  { key: 'risks', label: 'Risks' },
  { key: 'decision_criteria', label: 'Decision Criteria' },
]

// Structured extraction rules editor. Serializes to JSON and stores in coaches.extraction_rules.
// Falls back to free-form text if the field isn't JSON yet.
function ExtractionRulesEditor({ coach, onSaved }) {
  const initial = (() => {
    try { return JSON.parse(coach.extraction_rules || '{}') }
    catch { return { _legacy_text: coach.extraction_rules || '' } }
  })()
  const [rules, setRules] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState({})

  function toggle(key) {
    setRules(r => ({ ...r, [key]: { ...(r[key] || {}), enabled: !(r[key]?.enabled ?? true) } }))
  }
  function setInstructions(key, text) {
    setRules(r => ({ ...r, [key]: { ...(r[key] || { enabled: true }), instructions: text } }))
  }

  async function save() {
    setSaving(true)
    const json = JSON.stringify(rules, null, 2)
    const { error } = await supabase.from('coaches').update({ extraction_rules: json }).eq('id', coach.id)
    setSaving(false)
    if (!error && onSaved) onSaved(json)
  }

  return (
    <Card title="Extraction Rules (Structured)" action={<Button primary onClick={save} disabled={saving} style={{ padding: '4px 12px', fontSize: 11 }}>{saving ? 'Saving...' : 'Save'}</Button>}>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>Pick which entity types the AI should extract and add optional org-specific instructions. Serialized as JSON and injected into the extraction prompt.</div>
      {rules._legacy_text && (
        <div style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, marginBottom: 10, fontSize: 11, color: T.textMuted }}>
          <div style={{ fontWeight: 700, color: T.warning, marginBottom: 4 }}>Legacy free-form rules detected:</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: T.mono }}>{rules._legacy_text}</pre>
          <div style={{ marginTop: 6, fontStyle: 'italic' }}>These will be kept and passed through. Add structured rules below to layer on top.</div>
        </div>
      )}
      {EXTRACTION_ENTITIES.map(ent => {
        const r = rules[ent.key] || { enabled: true }
        const isExpanded = expanded[ent.key]
        return (
          <div key={ent.key} style={{ marginBottom: 6, border: `1px solid ${r.enabled ? T.primary + '40' : T.borderLight}`, borderRadius: 6, background: r.enabled ? T.surface : T.surfaceAlt, opacity: r.enabled ? 1 : 0.65 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
              <div onClick={() => toggle(ent.key)}
                style={{ width: 32, height: 18, borderRadius: 9, cursor: 'pointer', background: r.enabled ? T.success : T.borderLight, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: r.enabled ? 16 : 2, boxShadow: T.shadow, transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{ent.label}</span>
              <button onClick={() => setExpanded(e => ({ ...e, [ent.key]: !isExpanded }))} style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer', color: T.textMuted, fontFamily: T.font }}>
                {r.instructions ? 'Edit instructions' : '+ Instructions'}
              </button>
            </div>
            {isExpanded && (
              <div style={{ padding: 10, borderTop: `1px solid ${T.borderLight}`, background: T.surfaceAlt }}>
                <textarea
                  placeholder={`Custom instructions for ${ent.label.toLowerCase()} extraction (optional)...`}
                  value={r.instructions || ''} onChange={e => setInstructions(ent.key, e.target.value)}
                  style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12, minHeight: 60, resize: 'vertical', width: '100%' }} />
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}

const EMAIL_TOKENS = ['{Company Name}', '{Contact Name}', '{Rep Name}', '{SC Name}', '{Deal Value}', '{Close Date}', '{Stage}', '{Next Steps}']

function EmailBodyTemplateEditor({ tpl, onSave }) {
  const [value, setValue] = useState(tpl.body_template || '')
  const [showTokens, setShowTokens] = useState(false)
  const taRef = useRef(null)

  function insertToken(token) {
    const ta = taRef.current
    if (!ta) { setValue(v => v + token); setShowTokens(false); return }
    const start = ta.selectionStart, end = ta.selectionEnd
    const next = value.substring(0, start) + token + value.substring(end)
    setValue(next)
    setShowTokens(false)
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + token.length }, 0)
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>Email Body Template</label>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowTokens(s => !s)} style={{ fontSize: 10, padding: '3px 8px', border: `1px solid ${T.border}`, borderRadius: 4, background: showTokens ? T.primary : T.surface, color: showTokens ? '#fff' : T.primary, cursor: 'pointer', fontFamily: T.font }}>
            Insert variable ▾
          </button>
          {showTokens && (
            <>
              <div onClick={() => setShowTokens(false)} style={{ position: 'fixed', inset: 0, zIndex: 100 }} />
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: T.shadow, zIndex: 101, minWidth: 180 }}>
                {EMAIL_TOKENS.map(t => (
                  <button key={t} onClick={() => insertToken(t)}
                    style={{ display: 'block', width: '100%', padding: '6px 12px', fontSize: 11, fontFamily: T.mono, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: T.text }}
                    onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>{t}</button>
                ))}
              </div>
            </>
          )}
        </div>
        <span style={{ fontSize: 10, color: T.textMuted }}>Use {'{Variable}'} tokens for personalization. The AI fills these in from deal context when generating.</span>
      </div>
      <textarea ref={taRef} style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12, minHeight: 150, resize: 'vertical' }}
        value={value} onChange={e => setValue(e.target.value)}
        onBlur={e => onSave(e.target.value)}
        placeholder="Describe the email content, structure, and key points to include..." />
    </div>
  )
}

const MSP_CALL_TYPES = ['qdc', 'functional_discovery', 'demo', 'scoping', 'proposal', 'negotiation', 'sync', 'custom']
const MSP_ATTENDEE_ROLES = ['AE', 'SC', 'Champion', 'Economic Buyer', 'Technical Evaluator', 'Executive Sponsor', 'Legal', 'Procurement']

const SCORE_TYPE_TOOLTIPS = {
  fit: 'Product Fit — how well the prospect matches your ICP (industry, size, systems, signals)',
  deal_health: 'Deal Health — qualification strength, stakeholder access, timeline clarity',
  champion: 'Champion Strength — evidence of internal advocacy + access to power',
  power: 'Access to Power — whether the rep has reached or can reach the economic buyer',
  icp_fit: 'ICP Fit — computed score against the Ideal Customer Profile',
  custom: 'Custom scoring dimension',
}

function ScoringConfigEditor({ config, onSaved }) {
  const [criteria, setCriteria] = useState(Array.isArray(config.criteria) ? config.criteria : [])
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [showTip, setShowTip] = useState(false)

  function updateField(i, field, value) {
    setCriteria(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }
  function addCriterion() { setCriteria(prev => [...prev, { name: 'New Criterion', weight: 0, description: '' }]) }
  function removeCriterion(i) { setCriteria(prev => prev.filter((_, idx) => idx !== i)) }

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('scoring_configs').update({ criteria }).eq('id', config.id)
    setSaving(false)
    if (!error) {
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 1500)
      if (onSaved) onSaved({ criteria })
    }
  }

  const total = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0)
  const tooltipText = SCORE_TYPE_TOOLTIPS[config.score_type] || SCORE_TYPE_TOOLTIPS.custom

  return (
    <Card title={
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {config.label}
        <span onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)}
          style={{ cursor: 'help', fontSize: 10, color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          ?
          {showTip && (
            <span style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: 240, padding: 8, background: T.text, color: T.surface, borderRadius: 4, fontSize: 11, fontWeight: 400, zIndex: 10, lineHeight: 1.4 }}>{tooltipText}</span>
          )}
        </span>
      </span>
    } action={
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {savedMsg && <span style={{ fontSize: 11, color: T.success, fontWeight: 600 }}>Saved</span>}
        <Button primary onClick={save} disabled={saving} style={{ padding: '4px 10px', fontSize: 11 }}>{saving ? 'Saving...' : 'Save'}</Button>
      </div>
    }>
      <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 8 }}>{config.description}</div>
      {criteria.map((c, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.3fr 60px 2fr 20px', gap: 6, alignItems: 'center', marginBottom: 4, padding: 6, background: T.surfaceAlt, borderRadius: 4 }}>
          <input style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, fontWeight: 600 }} value={c.name || c.label || ''} onChange={e => updateField(i, 'name', e.target.value)} />
          <input type="number" style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={c.weight ?? 0} onChange={e => updateField(i, 'weight', Number(e.target.value) || 0)} min={0} max={100} />
          <input style={{ ...inputStyle, padding: '4px 8px', fontSize: 11 }} value={c.description || ''} onChange={e => updateField(i, 'description', e.target.value)} placeholder="What this scores..." />
          <button onClick={() => removeCriterion(i)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <button onClick={addCriterion} style={{ background: 'none', border: `1px dashed ${T.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 11, color: T.primary, cursor: 'pointer', fontFamily: T.font }}>+ Add criterion</button>
        <span style={{ fontSize: 11, fontWeight: 700, color: total === 100 ? T.success : T.error }}>Total: {total}%</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: T.textMuted }}>Max score: {config.max_score}</div>
    </Card>
  )
}

function TemplateStageRow({ stage, index, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [callType, setCallType] = useState(stage.call_type || '')
  const [purpose, setPurpose] = useState(stage.purpose || '')
  const [notes, setNotes] = useState(stage.notes || '')
  const [attendees, setAttendees] = useState(stage.attendee_roles || [])

  function toggleRole(r) {
    const next = attendees.includes(r) ? attendees.filter(x => x !== r) : [...attendees, r]
    setAttendees(next)
    onUpdate('attendee_roles', next)
  }

  return (
    <div style={{ background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`, marginBottom: 4, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: T.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{index + 1}</span>
        <input style={{ ...inputStyle, flex: 1, padding: '4px 8px', fontSize: 13, fontWeight: 600 }}
          defaultValue={stage.stage_name} onBlur={e => onUpdate('stage_name', e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="number" style={{ ...inputStyle, width: 60, padding: '4px 6px', fontSize: 12, textAlign: 'center' }}
            defaultValue={stage.due_date_offset || stage.default_duration_days || 0}
            onBlur={e => { onUpdate('due_date_offset', Number(e.target.value) || 0); onUpdate('default_duration_days', Number(e.target.value) || 0) }} />
          <span style={{ fontSize: 11, color: T.textMuted }}>days</span>
        </div>
        <button onClick={() => setExpanded(e => !e)} style={{ fontSize: 10, padding: '3px 8px', border: `1px solid ${T.border}`, background: expanded ? T.primary : 'transparent', color: expanded ? '#fff' : T.textSecondary, borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>
          {expanded ? 'Hide' : 'More'}
        </button>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}
          onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>×</button>
      </div>
      {expanded && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${T.borderLight}`, background: T.surface }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>Call Type</label>
              <select style={{ ...inputStyle, cursor: 'pointer', padding: '4px 8px', fontSize: 12 }}
                value={callType} onChange={e => { setCallType(e.target.value); onUpdate('call_type', e.target.value || null) }}>
                <option value="">(none)</option>
                {MSP_CALL_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Purpose</label>
              <input style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }}
                value={purpose} onChange={e => setPurpose(e.target.value)}
                onBlur={e => onUpdate('purpose', e.target.value || null)}
                placeholder="What is this stage for?" />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Notes / Instructions</label>
            <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontSize: 12 }}
              value={notes} onChange={e => setNotes(e.target.value)}
              onBlur={e => onUpdate('notes', e.target.value || null)}
              placeholder="Rep-facing notes for running this stage..." />
          </div>
          <div>
            <label style={labelStyle}>Attendee Roles</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {MSP_ATTENDEE_ROLES.map(r => {
                const on = attendees.includes(r)
                return (
                  <button key={r} onClick={() => toggleRole(r)}
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, border: `1px solid ${on ? T.primary : T.border}`, background: on ? T.primary : 'transparent', color: on ? '#fff' : T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>
                    {r}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TagInput({ label, value, onChange, placeholder }) {
  const [input, setInput] = useState('')
  function addTag() {
    const tags = input.split(/[,\n]/).map(s => s.trim()).filter(s => s && !value.includes(s))
    if (tags.length) { onChange([...value, ...tags]); setInput('') }
  }
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 10, fontWeight: 600, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {value.map((tag, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'rgba(93,173,226,0.1)', border: '1px solid rgba(93,173,226,0.25)', color: '#2c3e50' }}>
            {tag}
            <span style={{ cursor: 'pointer', color: '#999', fontSize: 13, lineHeight: 1 }} onClick={() => onChange(value.filter((_, j) => j !== i))}>&times;</span>
          </span>
        ))}
      </div>
      <input
        style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid #e1e4e8', borderRadius: 6, background: '#fff', color: '#2c3e50', fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif" }}
        value={input} onChange={e => setInput(e.target.value)} placeholder={placeholder}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
        onBlur={addTag}
      />
    </div>
  )
}
