import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatDate, formatDateLong, daysUntil } from '../lib/theme'
import { Card, Badge, Button, EmptyState, Spinner, TabBar, inputStyle, labelStyle } from './Shared'
import MSPCalendar from './MSPCalendar'

const STATUS_COLORS = { pending: T.textMuted, in_progress: T.primary, completed: T.success, blocked: T.error, at_risk: T.warning }
const STATUS_OPTIONS = [
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Complete' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'at_risk', label: 'At Risk' },
]
const STAGE_COLOR_PRESETS = ['#5DADE2', '#6bb644', '#f59e0b', '#a855f7', '#ec4899', '#0ea5e9', '#10b981', '#dc6b2f', '#6b7280']

// Display rule used wherever an MSP stage/milestone date is rendered.
// Honors `date_mode` first (single | range | free_text), then falls back to
// the legacy heuristic for older rows that don't have a mode set.
export function displayMspDate(item, formatFn = formatDate) {
  const mode = item?.date_mode
  if (mode === 'free_text') return item?.date_label?.trim() || 'TBD'
  if (mode === 'range') {
    if (item?.start_date && item?.end_date) return `${formatFn(item.start_date)} – ${formatFn(item.end_date)}`
    if (item?.start_date) return formatFn(item.start_date)
    if (item?.end_date) return formatFn(item.end_date)
    return 'TBD'
  }
  if (mode === 'single') {
    if (item?.due_date) return formatFn(item.due_date)
    return 'TBD'
  }
  // Legacy fallback for rows without a mode: prefer label > due > start
  if (item?.date_label?.trim()) return item.date_label
  if (item?.due_date) return formatFn(item.due_date)
  if (item?.start_date && item?.end_date) return `${formatFn(item.start_date)} – ${formatFn(item.end_date)}`
  if (item?.start_date) return formatFn(item.start_date)
  return 'TBD'
}

export function displayMspColor(item, parentStage, fallback = T.primary) {
  return item?.color || parentStage?.color || fallback
}

/**
 * MSPEditor — single source of truth for the Project Plan editor surface.
 *
 * Modes:
 *  - "standalone": the full /deal/:dealId/msp page (header with back button,
 *    progress bar, sub-tabs Timeline/Resources/Sharing).
 *  - "embedded": just the timeline+calendar editor body. No header, no
 *    sub-tabs. Used inside the AE's Deal Room MSP sub-tab.
 *  - "readonly": same body as embedded but with no add/edit/delete affordances.
 *    Each row gets a "Request change" button and a per-item comment composer
 *    (when not archived). Used inside the customer-facing public viewer.
 *
 * Readonly mode requires a `readonlyAdapter` prop:
 *   {
 *     archived: bool,
 *     pendingRequestsByTarget: Map<"table:id", request>,
 *     commentCountsByRef: Map<"kind:id", number>,
 *     onRequestChange: ({kind, item, parentStage, targetTable}) => void,
 *     onComment: (refKind, refId, text) => Promise<bool>,
 *   }
 */
export default function MSPEditor({ dealId, mode = 'standalone', readonlyAdapter = null, injectedData = null }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isStandalone = mode === 'standalone'
  const isReadonly = mode === 'readonly'
  const isWritable = !isReadonly  // standalone + embedded both write

  // injectedData={ stages, milestones } lets the public viewer hand us data
  // it already loaded via the dealroom-access edge function, so we don't
  // need authenticated supabase access. Used in readonly mode by the
  // anonymous customer viewer.

  const [loading, setLoading] = useState(true)
  const [deal, setDeal] = useState(null)
  const [steps, setSteps] = useState([])
  const [milestones, setMilestones] = useState([])
  const [resources, setResources] = useState([])
  const [sharedLinks, setSharedLinks] = useState([])
  const [tab, setTab] = useState('timeline')
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(`msp.view.${dealId}`) || localStorage.getItem('msp.view') || 'timeline' } catch { return 'timeline' }
  })
  const [expandedStages, setExpandedStages] = useState(new Set())

  const [showAddStep, setShowAddStep] = useState(false)
  const [newStepName, setNewStepName] = useState('')
  const [editingStep, setEditingStep] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [showNotes, setShowNotes] = useState({})

  const [showAddResource, setShowAddResource] = useState(false)
  const [newResource, setNewResource] = useState({ resource_name: '', resource_type: 'document', resource_url: '', description: '' })

  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [applyingTemplate, setApplyingTemplate] = useState(false)

  useEffect(() => {
    if (injectedData) {
      setSteps(injectedData.stages || [])
      setMilestones(injectedData.milestones || [])
      setDeal({ id: dealId, company_name: injectedData.company_name || '' })
      setLoading(false)
    } else {
      loadData()
    }
    // We intentionally re-run when injectedData reference changes so the
    // viewer can refresh after a request-change is accepted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, injectedData])

  async function loadData() {
    setLoading(true)
    try {
      const dealCols = isStandalone
        ? 'id, company_name, website, stage, target_close_date'
        : 'id, company_name'
      const [dealRes, stepsRes, milestonesRes, resRes, linksRes] = await Promise.all([
        supabase.from('deals').select(dealCols).eq('id', dealId).single(),
        supabase.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
        supabase.from('msp_milestones').select('*').eq('deal_id', dealId).order('milestone_order'),
        isStandalone ? supabase.from('msp_resources').select('*').eq('deal_id', dealId).order('created_at') : Promise.resolve({ data: [] }),
        isStandalone ? supabase.from('msp_shared_links').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
      ])
      setDeal(dealRes.data)
      setSteps(stepsRes.data || [])
      setMilestones(milestonesRes.data || [])
      setResources(resRes.data || [])
      setSharedLinks(linksRes.data || [])

      if (isStandalone && !stepsRes.data?.length) {
        let tplQuery = supabase.from('msp_templates').select('*')
        if (profile?.active_coach_id) tplQuery = tplQuery.eq('coach_id', profile.active_coach_id)
        const { data: tpls } = await tplQuery.order('is_default', { ascending: false })
        setTemplates(tpls || [])
        if (tpls?.length) setSelectedTemplate(tpls[0].id)
      }
    } catch (err) {
      console.error('Error loading MSP:', err)
    } finally {
      setLoading(false)
    }
  }

  function setViewPersist(v) {
    setView(v)
    try { localStorage.setItem(`msp.view.${dealId}`, v); localStorage.setItem('msp.view', v) } catch { /* ignore */ }
  }

  // ── Template apply (writable only) ──
  async function applyTemplate() {
    if (!selectedTemplate || !isWritable) return
    setApplyingTemplate(true)
    try {
      const { data: tplSteps } = await supabase.from('msp_template_stages').select('*').eq('template_id', selectedTemplate).order('stage_order')
      if (!tplSteps?.length) { setApplyingTemplate(false); return }
      const today = new Date()
      for (const ts of tplSteps) {
        // Stages seeded from a template inherit a real date if the template
        // carries an offset; otherwise fall back to free_text so the AE can
        // type a label.
        const offset = ts.due_date_offset || ts.default_duration_days || 0
        const hasOffset = !!ts.due_date_offset || !!ts.default_duration_days
        const dueDate = new Date(today)
        dueDate.setDate(dueDate.getDate() + offset)
        const { data: newStage } = await supabase.from('msp_stages').insert({
          deal_id: dealId, stage_name: ts.stage_name, stage_order: ts.stage_order,
          date_mode: hasOffset ? 'single' : 'free_text',
          due_date: hasOffset ? dueDate.toISOString().split('T')[0] : null,
          notes: ts.notes || null, status: 'pending', is_completed: false,
          color: ts.color || null,
        }).select('id').single()
        if (newStage?.id) {
          try {
            const { data: tplMs } = await supabase.from('msp_template_milestones').select('*').eq('template_stage_id', ts.id).order('milestone_order')
            if (tplMs?.length) {
              for (const tm of tplMs) {
                const mDue = new Date(today)
                mDue.setDate(mDue.getDate() + (tm.default_days_offset || 0))
                await supabase.from('msp_milestones').insert({
                  deal_id: dealId, msp_stage_id: newStage.id,
                  milestone_name: tm.milestone_name, milestone_order: tm.milestone_order,
                  due_date: mDue.toISOString(), notes: tm.notes || null, status: 'pending',
                })
              }
            }
          } catch (e) { console.warn('milestone seed failed (non-fatal):', e) }
        }
      }
      loadData()
    } catch (err) {
      console.error('Error applying template:', err)
    } finally {
      setApplyingTemplate(false)
    }
  }

  // ── Milestone CRUD (writable) ──
  async function addMilestone(stageId, name = 'New Milestone') {
    if (!isWritable) return
    const stageMs = milestones.filter(m => m.msp_stage_id === stageId)
    const order = stageMs.length > 0 ? Math.max(...stageMs.map(m => m.milestone_order)) + 1 : 1
    try {
      const { data } = await supabase.from('msp_milestones').insert({
        deal_id: dealId, msp_stage_id: stageId,
        milestone_name: name, milestone_order: order, status: 'pending',
      }).select().single()
      if (data) setMilestones(prev => [...prev, data])
      setExpandedStages(prev => { const n = new Set(prev); n.add(stageId); return n })
    } catch (e) { console.error('addMilestone failed:', e) }
  }
  async function updateMilestone(milestoneId, patch) {
    if (!isWritable) return
    try {
      await supabase.from('msp_milestones').update(patch).eq('id', milestoneId)
      setMilestones(prev => prev.map(m => m.id === milestoneId ? { ...m, ...patch } : m))
    } catch (e) { console.error('updateMilestone failed:', e) }
  }
  async function deleteMilestone(milestoneId) {
    if (!isWritable) return
    if (!window.confirm('Delete this milestone?')) return
    try {
      await supabase.from('msp_milestones').delete().eq('id', milestoneId)
      setMilestones(prev => prev.filter(m => m.id !== milestoneId))
    } catch (e) { console.error('deleteMilestone failed:', e) }
  }

  function toggleStageExpanded(stageId) {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId); else next.add(stageId)
      return next
    })
  }

  // ── Stage CRUD (writable) ──
  async function addStep() {
    if (!isWritable || !newStepName.trim()) return
    const nextOrder = steps.length > 0 ? Math.max(...steps.map(s => s.stage_order)) + 1 : 1
    // Manually-added stages default to free_text mode so the AE can type
    // "Mid May" / "Q3 2026" / "TBD" without first picking a calendar date.
    await supabase.from('msp_stages').insert({
      deal_id: dealId, stage_name: newStepName.trim(), stage_order: nextOrder,
      status: 'pending', is_completed: false, is_custom: true,
      date_mode: 'free_text',
    })
    setNewStepName('')
    setShowAddStep(false)
    loadData()
  }
  async function addTweener(aboveStep, belowStep) {
    if (!isWritable) return
    const order = (aboveStep.stage_order + belowStep.stage_order) / 2
    await supabase.from('msp_stages').insert({
      deal_id: dealId, stage_name: 'New Step', stage_order: order,
      status: 'pending', is_completed: false, is_tweener: true, is_custom: true,
      date_mode: 'free_text',
    })
    loadData()
  }
  async function cycleStatus(step) {
    if (!isWritable) return
    const cycle = { pending: 'in_progress', in_progress: 'completed', completed: 'pending' }
    const next = cycle[step.status] || 'pending'
    await setStatus(step, next)
  }
  async function setStatus(step, next) {
    if (!isWritable) return
    const isCompleted = next === 'completed'
    const updates = { status: next, is_completed: isCompleted }
    updates.completion_date = isCompleted ? new Date().toISOString() : null
    await supabase.from('msp_stages').update(updates).eq('id', step.id)
    setSteps(prev => prev.map(s => s.id === step.id ? { ...s, ...updates } : s))
  }
  async function updateAssignedContacts(stepId, side, list) {
    if (!isWritable) return
    const field = side === 'client' ? 'assigned_client_contacts' : 'assigned_team_contacts'
    await supabase.from('msp_stages').update({ [field]: list }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, [field]: list } : s))
  }
  async function saveNameInline(stepId) {
    if (!isWritable) return
    if (!editingName.trim()) { setEditingStep(null); return }
    await supabase.from('msp_stages').update({ stage_name: editingName }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, stage_name: editingName } : s))
    setEditingStep(null)
  }
  async function updateDueDate(stepId, date) {
    if (!isWritable) return
    await supabase.from('msp_stages').update({ due_date: date }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, due_date: date } : s))
  }
  async function updateNotes(stepId, notes) {
    if (!isWritable) return
    await supabase.from('msp_stages').update({ notes }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, notes } : s))
  }
  async function updateDateLabel(stepId, dateLabel) {
    if (!isWritable) return
    const value = dateLabel?.trim() ? dateLabel : null
    await supabase.from('msp_stages').update({ date_label: value }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, date_label: value } : s))
  }
  async function updateDateMode(stepId, mode) {
    if (!isWritable) return
    if (!['single', 'range', 'free_text'].includes(mode)) return
    // Clear the columns that don't apply to the new mode so display logic
    // doesn't pick up stale values.
    const patch = { date_mode: mode }
    if (mode === 'single')    { patch.start_date = null; patch.end_date = null; patch.date_label = null }
    if (mode === 'range')     { patch.due_date = null;   patch.date_label = null }
    if (mode === 'free_text') { patch.due_date = null;   patch.start_date = null; patch.end_date = null }
    await supabase.from('msp_stages').update(patch).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, ...patch } : s))
  }
  async function updateStageRange(stepId, side, dateStr) {
    if (!isWritable) return
    const col = side === 'start' ? 'start_date' : 'end_date'
    const value = dateStr || null
    await supabase.from('msp_stages').update({ [col]: value }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, [col]: value } : s))
  }
  async function updateDuration(stepId, duration) {
    if (!isWritable) return
    const value = duration?.trim() ? duration : null
    await supabase.from('msp_stages').update({ duration: value }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, duration: value } : s))
  }
  async function updateColor(stepId, color) {
    if (!isWritable) return
    await supabase.from('msp_stages').update({ color }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, color } : s))
  }
  async function deleteStep(stepId) {
    if (!isWritable) return
    if (!window.confirm('Delete this step?')) return
    await supabase.from('msp_stages').delete().eq('id', stepId)
    setSteps(prev => prev.filter(s => s.id !== stepId))
  }
  async function moveStep(idx, dir) {
    if (!isWritable) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= steps.length) return
    const a = steps[idx], b = steps[newIdx]
    await Promise.all([
      supabase.from('msp_stages').update({ stage_order: b.stage_order }).eq('id', a.id),
      supabase.from('msp_stages').update({ stage_order: a.stage_order }).eq('id', b.id),
    ])
    loadData()
  }

  // ── Resources / Sharing (standalone only) ──
  async function deleteResource(resId) {
    await supabase.from('msp_resources').delete().eq('id', resId)
    setResources(prev => prev.filter(r => r.id !== resId))
  }
  async function addResource() {
    if (!newResource.resource_name.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('msp_resources').insert({
      deal_id: dealId, resource_name: newResource.resource_name,
      resource_type: newResource.resource_type, resource_url: newResource.resource_url || null,
      description: newResource.description || null, created_by: user.id,
    })
    setShowAddResource(false)
    setNewResource({ resource_name: '', resource_type: 'document', resource_url: '', description: '' })
    loadData()
  }
  async function createShareLink() {
    const token = crypto.randomUUID()
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('msp_shared_links').insert({ deal_id: dealId, share_token: token, created_by: user.id })
    loadData()
  }
  async function toggleLinkActive(link) {
    await supabase.from('msp_shared_links').update({ is_active: !link.is_active }).eq('id', link.id)
    setSharedLinks(prev => prev.map(l => l.id === link.id ? { ...l, is_active: !l.is_active } : l))
  }

  if (loading) return <Spinner />
  if (isStandalone && !deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const completedSteps = steps.filter(s => s.is_completed).length
  const progressPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0

  const tabs = [
    { key: 'timeline', label: 'Timeline' },
    { key: 'resources', label: `Resources (${resources.length})` },
    { key: 'sharing', label: 'Sharing' },
  ]

  // Readonly adapter helpers
  const archived = !!readonlyAdapter?.archived
  const pendingByTarget = readonlyAdapter?.pendingRequestsByTarget || new Map()
  const commentCounts = readonlyAdapter?.commentCountsByRef || new Map()
  const requestChange = readonlyAdapter?.onRequestChange || (() => {})
  const submitComment = readonlyAdapter?.onComment || (async () => false)
  const calendarThemeColor = readonlyAdapter?.themeColor || T.primary

  return (
    <div>
      {/* Standalone-only page header */}
      {isStandalone && deal && (
        <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <button onClick={() => navigate(`/deal/${dealId}`)} style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
              fontWeight: 600, fontFamily: T.font,
            }}>&larr; {deal.company_name}</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Project Plan</div>
              <div style={{ fontSize: 13, color: T.textSecondary }}>
                {deal.company_name} {deal.target_close_date && `| Target: ${formatDateLong(deal.target_close_date)}`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.primary }}>{progressPct}% Complete</div>
              <div style={{ width: 120, height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                <div style={{ height: '100%', width: `${progressPct}%`, background: T.primary, borderRadius: 3, transition: 'width 0.5s' }} />
              </div>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{completedSteps}/{steps.length} steps</div>
            </div>
          </div>
          <TabBar tabs={tabs} active={tab} onChange={setTab} />
        </div>
      )}

      <div style={{ padding: isStandalone ? '16px 24px' : 0 }}>

        {/* TIMELINE TAB (always rendered in embedded/readonly; gated in standalone) */}
        {(!isStandalone || tab === 'timeline') && (
          <div>
            {/* View toggle */}
            {steps.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {[
                  { k: 'timeline', l: 'Timeline' },
                  { k: 'calendar', l: 'Calendar' },
                ].map(v => (
                  <button key={v.k} onClick={() => setViewPersist(v.k)}
                    style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${view === v.k ? T.primary : T.border}`, borderRadius: 4, background: view === v.k ? T.primary : T.surface, color: view === v.k ? '#fff' : T.text, cursor: 'pointer', fontFamily: T.font }}>
                    {v.l}
                  </button>
                ))}
              </div>
            )}

            {/* Calendar view */}
            {view === 'calendar' && steps.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <MSPCalendar
                  stages={steps}
                  milestones={milestones}
                  readOnly={isReadonly}
                  themeColor={calendarThemeColor}
                  onSelectEvent={(evt) => {
                    const r = evt.resource || {}
                    if (isReadonly) {
                      // Customer flow: clicking an event opens "request change" modal
                      if (r.kind === 'stage' && r.stage) {
                        requestChange({ kind: 'stage', item: r.stage, parent: null, targetTable: 'msp_stages' })
                      } else if (r.kind === 'milestone' && r.milestone) {
                        requestChange({ kind: 'milestone', item: r.milestone, parent: r.parentStage, targetTable: 'msp_milestones' })
                      }
                      return
                    }
                    // AE flow: jump back to timeline + focus
                    if (r.kind === 'stage' && r.stage) {
                      setEditingStep(r.stage.id); setEditingName(r.stage.stage_name)
                    } else if (r.kind === 'milestone' && r.milestone) {
                      setExpandedStages(prev => { const n = new Set(prev); n.add(r.milestone.msp_stage_id); return n })
                    }
                    setViewPersist('timeline')
                  }}
                  onMoveStage={isWritable ? async (stage, newStart, newEnd) => {
                    const startStr = newStart.toISOString().split('T')[0]
                    const endStr = newEnd.toISOString().split('T')[0]
                    const patch = { start_date: startStr, end_date: endStr, due_date: endStr }
                    await supabase.from('msp_stages').update(patch).eq('id', stage.id)
                    setSteps(prev => prev.map(s => s.id === stage.id ? { ...s, ...patch } : s))
                  } : undefined}
                  onResizeStage={isWritable ? async (stage, newStart, newEnd) => {
                    const startStr = newStart.toISOString().split('T')[0]
                    const endStr = newEnd.toISOString().split('T')[0]
                    const patch = { start_date: startStr, end_date: endStr, due_date: endStr }
                    await supabase.from('msp_stages').update(patch).eq('id', stage.id)
                    setSteps(prev => prev.map(s => s.id === stage.id ? { ...s, ...patch } : s))
                  } : undefined}
                />
              </div>
            )}

            {/* Timeline list view */}
            {(view === 'timeline' || steps.length === 0) && (
              <>
                {steps.length === 0 ? (
                  isReadonly ? (
                    <div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
                      No stages yet — your AE is preparing this section.
                    </div>
                  ) : (
                    <Card>
                      <div style={{ textAlign: 'center', padding: 32 }}>
                        <div style={{ fontSize: 14, color: T.textMuted, marginBottom: 16 }}>No project plan steps yet. {isStandalone && templates.length > 0 ? 'Apply a template or add steps manually.' : 'Add steps manually.'}</div>
                        {isStandalone && templates.length > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                            {templates.length > 1 ? (
                              <select style={{ ...inputStyle, width: 'auto', padding: '8px 12px', cursor: 'pointer' }}
                                value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)}>
                                {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (Default)' : ''}</option>)}
                              </select>
                            ) : (
                              <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>Template: {templates[0].name}</span>
                            )}
                            <Button primary onClick={applyTemplate} disabled={applyingTemplate}>
                              {applyingTemplate ? 'Applying...' : 'Apply Template'}
                            </Button>
                          </div>
                        )}
                        <Button onClick={() => setShowAddStep(true)}>Add Step Manually</Button>
                      </div>
                    </Card>
                  )
                ) : (
                  <div style={{ position: 'relative', paddingLeft: 40 }}>
                    {/* Vertical line */}
                    <div style={{ position: 'absolute', left: 15, top: 16, bottom: 16, width: 2, background: T.border }} />

                    {steps.map((step, si) => {
                      const days = daysUntil(step.due_date)
                      const overdue = !step.is_completed && step.status !== 'blocked' && days != null && days < 0
                      const statusColor = STATUS_COLORS[step.status] || T.border
                      const stageReq = pendingByTarget.get(`msp_stages:${step.id}`)

                      return (
                        <div key={step.id}>
                          <div style={{ position: 'relative', marginBottom: 4 }}>
                            {/* Status circle */}
                            {isWritable ? (
                              <button onClick={() => cycleStatus(step)} title={`Status: ${step.status}. Click to change.`} style={{
                                position: 'absolute', left: -40 + 15 - 14, top: 14, width: 28, height: 28, borderRadius: '50%',
                                background: statusColor, color: '#fff', border: `2px solid ${statusColor}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, fontWeight: 700, zIndex: 1, cursor: 'pointer', padding: 0,
                                animation: step.status === 'in_progress' ? 'pulse 2s ease-in-out infinite' : 'none',
                              }}>
                                {step.status === 'completed' ? '✓' : step.status === 'blocked' ? '!' : si + 1}
                              </button>
                            ) : (
                              <div style={{
                                position: 'absolute', left: -40 + 15 - 14, top: 14, width: 28, height: 28, borderRadius: '50%',
                                background: statusColor, color: '#fff', border: `2px solid ${statusColor}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, fontWeight: 700, zIndex: 1,
                                animation: step.status === 'in_progress' ? 'pulse 2s ease-in-out infinite' : 'none',
                              }}>
                                {step.status === 'completed' ? '✓' : step.status === 'blocked' ? '!' : si + 1}
                              </div>
                            )}

                            <div style={{
                              background: T.surface, border: `1px solid ${overdue ? T.error + '40' : T.border}`,
                              borderLeft: `4px solid ${displayMspColor(step, null)}`,
                              borderRadius: T.radius, boxShadow: T.shadow, padding: '12px 16px',
                            }}>
                              {/* Writable row */}
                              {isWritable && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  {/* Reorder */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <button onClick={() => moveStep(si, -1)} disabled={si === 0}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 10, opacity: si === 0 ? 0.3 : 1, padding: 0 }}>{'▲'}</button>
                                    <button onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 10, opacity: si === steps.length - 1 ? 0.3 : 1, padding: 0 }}>{'▼'}</button>
                                  </div>

                                  <ColorSwatch color={step.color || T.primary} onChange={(c) => updateColor(step.id, c)} />

                                  <div style={{ flex: 1, minWidth: 160 }}>
                                    {editingStep === step.id ? (
                                      <input style={{ ...inputStyle, padding: '4px 8px', fontSize: 13, fontWeight: 600 }}
                                        value={editingName} onChange={e => setEditingName(e.target.value)}
                                        onBlur={() => saveNameInline(step.id)}
                                        onKeyDown={e => { if (e.key === 'Enter') saveNameInline(step.id); if (e.key === 'Escape') setEditingStep(null) }}
                                        autoFocus />
                                    ) : (
                                      <div onClick={() => { setEditingStep(step.id); setEditingName(step.stage_name) }}
                                        style={{
                                          fontSize: 13, fontWeight: 600, color: T.text, cursor: 'pointer',
                                          textDecoration: step.is_completed ? 'line-through' : 'none',
                                          opacity: step.is_completed ? 0.6 : 1,
                                        }}>
                                        {step.stage_name}
                                        {step.is_tweener && <Badge color={T.textMuted} style={{ marginLeft: 6 }}>custom</Badge>}
                                      </div>
                                    )}
                                  </div>

                                  <StatusPicker step={step} onCycle={() => cycleStatus(step)} onSet={(s) => setStatus(step, s)} />

                                  <DateModeEditor
                                    step={step}
                                    onUpdateMode={(mode) => updateDateMode(step.id, mode)}
                                    onUpdateDueDate={(d) => updateDueDate(step.id, d)}
                                    onUpdateRange={(side, d) => updateStageRange(step.id, side, d)}
                                    onUpdateDateLabel={(v) => updateDateLabel(step.id, v)}
                                  />

                                  <input
                                    type="text" defaultValue={step.duration || ''}
                                    onBlur={e => { if ((e.target.value || '') !== (step.duration || '')) updateDuration(step.id, e.target.value) }}
                                    placeholder="Duration"
                                    title="Free-text duration (e.g. '1 Hour', '2 Weeks After Contract', 'TBD')"
                                    style={{ ...inputStyle, width: 100, padding: '4px 8px', fontSize: 11, fontStyle: step.duration ? 'normal' : 'italic' }}
                                  />

                                  {(step.date_mode === 'single' || !step.date_mode) && days != null && !step.is_completed && !step.date_label && (
                                    <span style={{ fontSize: 11, fontWeight: 600, color: overdue ? T.error : days <= 7 ? T.warning : T.textMuted, whiteSpace: 'nowrap', fontFeatureSettings: '"tnum"' }}>
                                      {overdue ? `${Math.abs(days)}d late` : `${days}d`}
                                    </span>
                                  )}

                                  <button onClick={() => setShowNotes(p => ({ ...p, [step.id]: !p[step.id] }))}
                                    style={{
                                      background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '2px 6px',
                                      color: step.notes ? T.primary : T.textMuted, fontWeight: step.notes ? 600 : 400,
                                    }}>
                                    Notes{step.notes ? ' *' : ''}
                                  </button>

                                  <button onClick={() => deleteStep(step.id)} style={{
                                    background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: '2px 4px', lineHeight: 1,
                                  }}
                                    onMouseEnter={e => e.currentTarget.style.color = T.error}
                                    onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
                                  >&times;</button>
                                </div>
                              )}

                              {/* Read-only row */}
                              {isReadonly && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                                  <div style={{ flex: 1, minWidth: 220 }}>
                                    <div style={{
                                      fontSize: 14, fontWeight: 700, color: T.text,
                                      textDecoration: step.is_completed ? 'line-through' : 'none',
                                      opacity: step.is_completed ? 0.6 : 1,
                                    }}>{step.stage_name}</div>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, fontSize: 12, color: T.textSecondary, flexWrap: 'wrap' }}>
                                      <span><strong>Date:</strong> {displayMspDate(step)}</span>
                                      {step.duration && <span><strong>Duration:</strong> {step.duration}</span>}
                                      <ReadonlyStatusPill status={step.status} />
                                    </div>
                                    {step.notes && (
                                      <div style={{ marginTop: 8, fontSize: 12, color: T.textSecondary, whiteSpace: 'pre-wrap' }}>{step.notes}</div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {stageReq ? (
                                      <span style={{ padding: '4px 10px', background: T.warningLight, color: T.warning, fontSize: 10, fontWeight: 600, borderRadius: 999, border: `1px solid ${T.warning}30` }}>Change requested · pending review</span>
                                    ) : !archived && (
                                      <button onClick={() => requestChange({ kind: 'stage', item: step, parent: null, targetTable: 'msp_stages' })}
                                        style={{ padding: '4px 10px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.primary, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
                                        Request change
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Contact chips (writable only) */}
                              {isWritable && (
                                <ContactChips
                                  stepId={step.id}
                                  clients={step.assigned_client_contacts || []}
                                  team={step.assigned_team_contacts || []}
                                  dealId={dealId}
                                  userId={profile?.id}
                                  onChangeClients={(list) => updateAssignedContacts(step.id, 'client', list)}
                                  onChangeTeam={(list) => updateAssignedContacts(step.id, 'team', list)}
                                />
                              )}

                              {/* Notes editor (writable only) */}
                              {isWritable && showNotes[step.id] && (
                                <div style={{ marginTop: 8 }}>
                                  <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontSize: 12 }}
                                    value={step.notes || ''}
                                    onChange={e => setSteps(prev => prev.map(s => s.id === step.id ? { ...s, notes: e.target.value } : s))}
                                    onBlur={e => updateNotes(step.id, e.target.value)}
                                    placeholder="Add notes..." />
                                </div>
                              )}

                              {/* Milestones */}
                              <MilestonesSection
                                stage={step}
                                milestones={milestones.filter(m => m.msp_stage_id === step.id)}
                                expanded={expandedStages.has(step.id)}
                                onToggle={() => toggleStageExpanded(step.id)}
                                onAdd={() => addMilestone(step.id)}
                                onUpdate={updateMilestone}
                                onDelete={deleteMilestone}
                                isReadonly={isReadonly}
                                archived={archived}
                                pendingByTarget={pendingByTarget}
                                onRequestChange={requestChange}
                              />

                              {/* Per-stage comment composer (readonly + non-archived) */}
                              {isReadonly && !archived && (
                                <ReadonlyCommentComposer
                                  refKind="msp_stage"
                                  refId={step.id}
                                  count={commentCounts.get(`msp_stage:${step.id}`) || 0}
                                  placeholder="Comment on this stage…"
                                  onSubmit={submitComment}
                                />
                              )}
                            </div>
                          </div>

                          {/* + button between steps (writable only) */}
                          {isWritable && si < steps.length - 1 && (
                            <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                              <button onClick={() => addTweener(step, steps[si + 1])} style={{
                                position: 'absolute', left: -40 + 15 - 8, top: 2, width: 16, height: 16, borderRadius: '50%',
                                background: T.surface, border: `1.5px solid ${T.border}`, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, color: T.textMuted, padding: 0, zIndex: 1, transition: 'all 0.15s',
                              }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.color = T.primary }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted }}
                                title="Add step between"
                              >+</button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Add Step (writable only) */}
                {isWritable && (
                  <div style={{ marginTop: 16 }}>
                    {showAddStep ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input style={{ ...inputStyle, flex: 1 }} value={newStepName}
                          onChange={e => setNewStepName(e.target.value)} placeholder="Step name..."
                          onKeyDown={e => e.key === 'Enter' && addStep()} autoFocus />
                        <Button primary onClick={addStep}>Add</Button>
                        <Button onClick={() => { setShowAddStep(false); setNewStepName('') }}>Cancel</Button>
                      </div>
                    ) : (
                      <Button onClick={() => setShowAddStep(true)}>+ Add Step</Button>
                    )}
                  </div>
                )}
                <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }`}</style>
              </>
            )}
          </div>
        )}

        {/* RESOURCES TAB (standalone only) */}
        {isStandalone && tab === 'resources' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button primary onClick={() => setShowAddResource(true)}>+ Add Resource</Button>
            </div>
            {showAddResource && (
              <Card title="New Resource" style={{ marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div><label style={labelStyle}>Resource Name *</label><input style={inputStyle} value={newResource.resource_name} onChange={e => setNewResource(p => ({ ...p, resource_name: e.target.value }))} placeholder="e.g. Implementation Guide" /></div>
                  <div><label style={labelStyle}>Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newResource.resource_type} onChange={e => setNewResource(p => ({ ...p, resource_type: e.target.value }))}><option value="document">Document</option><option value="link">Link</option><option value="template">Template</option><option value="video">Video</option></select></div>
                  <div><label style={labelStyle}>URL</label><input style={inputStyle} value={newResource.resource_url} onChange={e => setNewResource(p => ({ ...p, resource_url: e.target.value }))} placeholder="https://..." /></div>
                  <div><label style={labelStyle}>Description</label><input style={inputStyle} value={newResource.description} onChange={e => setNewResource(p => ({ ...p, description: e.target.value }))} placeholder="Brief description" /></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}><Button primary onClick={addResource}>Add</Button><Button onClick={() => setShowAddResource(false)}>Cancel</Button></div>
              </Card>
            )}
            {resources.length === 0 ? <EmptyState message="No resources attached to this project plan yet." /> : resources.map(r => (
              <Card key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{r.resource_name}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>{r.resource_type && <Badge color={T.primary}>{r.resource_type}</Badge>}</div>
                    {r.description && <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>{r.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {r.resource_url && <a href={r.resource_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.primary, fontWeight: 600, textDecoration: 'none' }}>Open &rarr;</a>}
                    <button onClick={() => deleteResource(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}
                      onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&times;</button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* SHARING TAB (standalone only) */}
        {isStandalone && tab === 'sharing' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button primary onClick={createShareLink}>Create Share Link</Button>
            </div>
            {sharedLinks.length === 0 ? <EmptyState message="No shared links. Create one to share the project plan with your client." /> : sharedLinks.map(link => (
              <Card key={link.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontFamily: T.mono, color: T.text, marginBottom: 4 }}>{window.location.origin}/msp/shared/{link.share_token}</div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 11, color: T.textSecondary, alignItems: 'center' }}>
                      <span>Views: {link.access_count || 0}</span>
                      {link.expires_at && <span>Expires: {formatDateLong(link.expires_at)}</span>}
                      <span onClick={() => toggleLinkActive(link)} style={{ cursor: 'pointer' }}>
                        {link.is_active ? <Badge color={T.success}>Active</Badge> : <Badge color={T.error}>Inactive</Badge>}
                      </span>
                    </div>
                  </div>
                  <Button style={{ padding: '6px 14px', fontSize: 12 }}
                    onClick={() => window.open(`${window.location.origin}/msp/shared/${link.share_token}`, '_blank')}>Open</Button>
                  <Button style={{ padding: '6px 14px', fontSize: 12 }}
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/msp/shared/${link.share_token}`)}>Copy Link</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════════

function StatusPicker({ step, onCycle, onSet }) {
  const [open, setOpen] = useState(false)
  const color = STATUS_COLORS[step.status] || T.textMuted
  const label = STATUS_OPTIONS.find(o => o.key === step.status)?.label || step.status
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={onCycle} title="Click to cycle (pending → in progress → complete)"
        style={{ padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          background: color + '18', color, border: `1px solid ${color}40`, cursor: 'pointer', fontFamily: T.font }}>
        {label}
      </button>
      <button onClick={() => setOpen(o => !o)} title="Pick any status"
        style={{ padding: '3px 6px', marginLeft: -1, borderRadius: 10, fontSize: 10, border: `1px solid ${color}40`, background: color + '18', color, cursor: 'pointer', fontFamily: T.font }}>▾</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: T.shadow, zIndex: 501, minWidth: 140 }}>
            {STATUS_OPTIONS.map(o => {
              const c = STATUS_COLORS[o.key] || T.textMuted
              return (
                <button key={o.key} onClick={() => { onSet(o.key); setOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', background: step.status === o.key ? T.surfaceAlt : 'transparent', border: 'none', cursor: 'pointer', fontFamily: T.font, textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                  onMouseLeave={e => e.currentTarget.style.background = step.status === o.key ? T.surfaceAlt : 'transparent'}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                  <span style={{ fontSize: 12, color: T.text }}>{o.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function ReadonlyStatusPill({ status }) {
  const c = STATUS_COLORS[status] || T.textMuted
  return (
    <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, color: c, background: c + '18', border: `1px solid ${c}30`, textTransform: 'uppercase' }}>
      {(status || '').replace('_', ' ')}
    </span>
  )
}

function MilestonesSection({ stage, milestones, expanded, onToggle, onAdd, onUpdate, onDelete, isReadonly, archived, pendingByTarget, onRequestChange }) {
  const count = milestones.length
  return (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${T.borderLight}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onToggle}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 11, fontWeight: 600, padding: 0, fontFamily: T.font }}>
          <span style={{ display: 'inline-block', width: 10, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▸</span>
          {' '}Milestones{count ? ` (${count})` : ''}
        </button>
        <div style={{ flex: 1 }} />
        {!isReadonly && (
          <button onClick={onAdd}
            style={{ background: 'none', border: `1px dashed ${T.border}`, cursor: 'pointer', color: T.textMuted, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, fontFamily: T.font }}>
            + Add Milestone
          </button>
        )}
      </div>

      {expanded && count > 0 && (
        <div style={{ marginTop: 8, paddingLeft: 14 }}>
          {milestones.map(m => {
            const mColor = displayMspColor(m, stage)
            const mDays = m.due_date ? Math.ceil((new Date(m.due_date) - new Date()) / 86400000) : null
            const mOverdue = m.status !== 'completed' && mDays != null && mDays < 0
            const mReq = pendingByTarget?.get?.(`msp_milestones:${m.id}`)

            if (isReadonly) {
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginBottom: 4, background: T.surfaceAlt, borderRadius: 4, borderLeft: `3px solid ${mColor}`, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{m.milestone_name}</div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: T.textSecondary, marginTop: 2 }}>
                      <span>{displayMspDate(m)}</span>
                      <ReadonlyStatusPill status={m.status} />
                    </div>
                  </div>
                  {mReq ? (
                    <span style={{ padding: '2px 8px', background: T.warningLight, color: T.warning, fontSize: 10, fontWeight: 600, borderRadius: 999, border: `1px solid ${T.warning}30` }}>Change requested</span>
                  ) : !archived && (
                    <button onClick={() => onRequestChange({ kind: 'milestone', item: m, parent: stage, targetTable: 'msp_milestones' })}
                      style={{ padding: '3px 8px', fontSize: 10, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.primary, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
                      Request change
                    </button>
                  )}
                </div>
              )
            }

            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: T.surfaceAlt, borderRadius: 4, borderLeft: `3px solid ${mColor}`, marginBottom: 4, flexWrap: 'wrap' }}>
                <ColorSwatch color={mColor} onChange={(c) => onUpdate(m.id, { color: c })} />
                <input
                  defaultValue={m.milestone_name}
                  onBlur={e => { if (e.target.value !== m.milestone_name) onUpdate(m.id, { milestone_name: e.target.value }) }}
                  placeholder="Milestone name"
                  style={{ ...inputStyle, padding: '3px 6px', fontSize: 11, flex: 1, minWidth: 140 }}
                />
                <select value={m.status} onChange={e => onUpdate(m.id, { status: e.target.value })}
                  style={{ ...inputStyle, padding: '3px 6px', fontSize: 10, width: 'auto', cursor: 'pointer', color: STATUS_COLORS[m.status] || T.text, fontWeight: 600 }}>
                  {STATUS_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <input type="date" value={m.due_date ? new Date(m.due_date).toISOString().split('T')[0] : ''}
                  onChange={e => onUpdate(m.id, { due_date: e.target.value || null })}
                  style={{ ...inputStyle, padding: '3px 6px', fontSize: 10, width: 'auto' }}
                  title="Due date" />
                <input type="text" defaultValue={m.date_label || ''}
                  onBlur={e => { if ((e.target.value || '') !== (m.date_label || '')) onUpdate(m.id, { date_label: e.target.value || null }) }}
                  placeholder="Date label"
                  style={{ ...inputStyle, padding: '3px 6px', fontSize: 10, width: 100, fontStyle: m.date_label ? 'normal' : 'italic' }} />
                {mDays != null && m.status !== 'completed' && !m.date_label && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: mOverdue ? T.error : mDays <= 7 ? T.warning : T.textMuted, fontFeatureSettings: '"tnum"' }}>
                    {mOverdue ? `${Math.abs(mDays)}d late` : `${mDays}d`}
                  </span>
                )}
                <button onClick={() => onDelete(m.id)} title="Delete milestone"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ColorSwatch({ color, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Stage color"
        style={{
          width: 18, height: 18, borderRadius: 4, background: color, cursor: 'pointer',
          border: `1px solid ${T.borderLight}`, padding: 0, flexShrink: 0,
        }}
      />
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, padding: 8, background: T.surface,
            border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: T.shadow, zIndex: 501, width: 180,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 6 }}>
              {STAGE_COLOR_PRESETS.map(c => (
                <button key={c} onClick={() => { onChange(c); setOpen(false) }}
                  style={{
                    width: 24, height: 24, borderRadius: 4, background: c, cursor: 'pointer',
                    border: c.toLowerCase() === (color || '').toLowerCase() ? `2px solid ${T.text}` : `1px solid ${T.borderLight}`,
                    padding: 0,
                  }} />
              ))}
            </div>
            <input
              type="color" defaultValue={color || '#5DADE2'}
              onChange={e => onChange(e.target.value)}
              style={{ width: '100%', height: 28, padding: 0, border: `1px solid ${T.borderLight}`, borderRadius: 4, cursor: 'pointer' }}
            />
          </div>
        </>
      )}
    </div>
  )
}

function ContactChips({ stepId, clients, team, dealId, userId, onChangeClients, onChangeTeam }) {
  const [pickerSide, setPickerSide] = useState(null)
  const [options, setOptions] = useState([])

  async function openPicker(side) {
    setPickerSide(side)
    if (side === 'client') {
      const { data } = await supabase.from('contacts').select('id, name, title, role_in_deal').eq('deal_id', dealId).order('name')
      setOptions(data || [])
    } else {
      const { data } = await supabase.from('user_team_members').select('id, name, title, member_type').eq('user_id', userId).order('name')
      setOptions(data || [])
    }
  }

  function add(side, contact) {
    const entry = { id: contact.id, name: contact.name, title: contact.title || null }
    if (side === 'client') {
      const exists = clients.some(c => c.id === entry.id)
      if (!exists) onChangeClients([...clients, entry])
    } else {
      const exists = team.some(c => c.id === entry.id)
      if (!exists) onChangeTeam([...team, entry])
    }
    setPickerSide(null)
  }

  function remove(side, id) {
    if (side === 'client') onChangeClients(clients.filter(c => c.id !== id))
    else onChangeTeam(team.filter(c => c.id !== id))
  }

  const Chip = ({ c, side }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: side === 'client' ? T.primaryLight || 'rgba(93,173,226,0.1)' : T.surfaceAlt, border: `1px solid ${side === 'client' ? T.primary + '40' : T.borderLight}`, fontSize: 10, color: side === 'client' ? T.primary : T.textSecondary, fontFamily: T.font, cursor: 'pointer' }}
      onClick={() => remove(side, c.id)} title={c.title ? `${c.title} — click to remove` : 'Click to remove'}>
      {c.name}
    </span>
  )

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginRight: 2 }}>Client:</span>
        {clients.map(c => <Chip key={c.id} c={c} side="client" />)}
        <button onClick={() => openPicker('client')} style={{ fontSize: 10, padding: '2px 6px', border: `1px dashed ${T.border}`, background: 'transparent', borderRadius: 10, cursor: 'pointer', color: T.textMuted, fontFamily: T.font }}>+ add</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginRight: 2 }}>Team:</span>
        {team.map(c => <Chip key={c.id} c={c} side="team" />)}
        <button onClick={() => openPicker('team')} style={{ fontSize: 10, padding: '2px 6px', border: `1px dashed ${T.border}`, background: 'transparent', borderRadius: 10, cursor: 'pointer', color: T.textMuted, fontFamily: T.font }}>+ add</button>
      </div>

      {pickerSide && (
        <>
          <div onClick={() => setPickerSide(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 600 }} />
          <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', zIndex: 601, width: 360, maxHeight: 400, overflow: 'auto' }}>
            <div style={{ padding: 10, borderBottom: `1px solid ${T.border}`, fontWeight: 700, fontSize: 13, color: T.text }}>
              Add {pickerSide === 'client' ? 'client' : 'team'} contact
            </div>
            {options.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>No {pickerSide === 'client' ? 'deal contacts' : 'team members'} yet.</div>
            ) : options.map(o => (
              <button key={o.id} onClick={() => add(pickerSide, o)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, width: '100%', padding: '8px 12px', border: 'none', borderBottom: `1px solid ${T.borderLight}`, background: 'transparent', cursor: 'pointer', fontFamily: T.font, textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{o.name}</span>
                {o.title && <span style={{ fontSize: 11, color: T.textMuted }}>{o.title}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// 3-mode date editor for a stage row. Switching modes clears the columns
// that don't apply to the new mode (handled by the onUpdateMode handler in
// MSPEditor) so displayMspDate doesn't get confused by stale values.
function DateModeEditor({ step, onUpdateMode, onUpdateDueDate, onUpdateRange, onUpdateDateLabel }) {
  const mode = step.date_mode || (step.start_date && step.end_date ? 'range' : (step.date_label ? 'free_text' : 'single'))
  const MODES = [
    { k: 'single',    l: 'Date',     title: 'Single date — pick one calendar day' },
    { k: 'range',     l: 'Range',    title: 'Date range — pick start and end dates' },
    { k: 'free_text', l: 'Free text', title: 'Free text — e.g. "Mid May", "Q3 2026", "TBD"' },
  ]
  const startStr = step.start_date ? new Date(step.start_date).toISOString().split('T')[0] : ''
  const endStr   = step.end_date   ? new Date(step.end_date).toISOString().split('T')[0]   : ''
  const dueStr   = step.due_date   ? String(step.due_date).split('T')[0]                   : ''
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
        {MODES.map((o, i) => {
          const active = mode === o.k
          return (
            <button key={o.k} onClick={() => onUpdateMode(o.k)} title={o.title}
              style={{
                padding: '4px 8px', fontSize: 10, fontWeight: 600, fontFamily: T.font,
                border: 'none', borderLeft: i > 0 ? `1px solid ${T.border}` : 'none',
                background: active ? T.primary : T.surface,
                color: active ? '#fff' : T.textMuted,
                cursor: 'pointer',
              }}>
              {o.l}
            </button>
          )
        })}
      </div>
      {mode === 'single' && (
        <input type="date" value={dueStr}
          onChange={e => onUpdateDueDate(e.target.value)}
          style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11 }} />
      )}
      {mode === 'range' && (
        <>
          <input type="date" value={startStr}
            onChange={e => onUpdateRange('start', e.target.value)}
            title="Start date"
            style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11 }} />
          <span style={{ fontSize: 11, color: T.textMuted }}>→</span>
          <input type="date" value={endStr}
            onChange={e => onUpdateRange('end', e.target.value)}
            title="End date"
            style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11 }} />
        </>
      )}
      {mode === 'free_text' && (
        <input
          type="text"
          defaultValue={step.date_label || ''}
          onBlur={e => { if ((e.target.value || '') !== (step.date_label || '')) onUpdateDateLabel(e.target.value) }}
          placeholder="e.g. Mid May, Q3 2026"
          style={{ ...inputStyle, width: 160, padding: '4px 8px', fontSize: 11, fontStyle: step.date_label ? 'normal' : 'italic' }}
        />
      )}
    </div>
  )
}

function ReadonlyCommentComposer({ refKind, refId, count, placeholder, onSubmit }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  return (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${T.borderLight}` }}>
      {!open ? (
        <button onClick={() => setOpen(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 11, padding: 0, fontFamily: T.font }}>
          {count > 0 ? `${count} comment${count === 1 ? '' : 's'} · ` : ''}+ Add a comment
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} rows={2}
            style={{ flex: 1, padding: 8, fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, resize: 'vertical' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button onClick={async () => { if (text.trim()) { const ok = await onSubmit(refKind, refId, text.trim()); if (ok) { setText(''); setOpen(false) } } }}
              style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, background: T.primary, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>Post</button>
            <button onClick={() => { setOpen(false); setText('') }}
              style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, background: T.surface, color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
