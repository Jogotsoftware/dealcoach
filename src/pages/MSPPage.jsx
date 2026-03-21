import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatDate, formatDateLong, daysUntil } from '../lib/theme'
import { Card, Badge, Button, EmptyState, Spinner, TabBar, inputStyle, labelStyle } from '../components/Shared'

const STATUS_COLORS = { pending: T.border, in_progress: T.primary, completed: T.success, blocked: T.error }

export default function MSPPage() {
  const { dealId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [deal, setDeal] = useState(null)
  const [steps, setSteps] = useState([])
  const [resources, setResources] = useState([])
  const [sharedLinks, setSharedLinks] = useState([])
  const [tab, setTab] = useState('timeline')

  // Add step
  const [showAddStep, setShowAddStep] = useState(false)
  const [newStepName, setNewStepName] = useState('')

  // Inline editing
  const [editingStep, setEditingStep] = useState(null)
  const [editingName, setEditingName] = useState('')

  // Notes
  const [showNotes, setShowNotes] = useState({})

  // Resources
  const [showAddResource, setShowAddResource] = useState(false)
  const [newResource, setNewResource] = useState({ resource_name: '', resource_type: 'document', resource_url: '', description: '' })

  // Templates
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [applyingTemplate, setApplyingTemplate] = useState(false)

  useEffect(() => { loadData() }, [dealId])

  async function loadData() {
    setLoading(true)
    try {
      const [dealRes, stepsRes, resRes, linksRes] = await Promise.all([
        supabase.from('deals').select('id, company_name, website, stage, target_close_date').eq('id', dealId).single(),
        supabase.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
        supabase.from('msp_resources').select('*').eq('deal_id', dealId).order('created_at'),
        supabase.from('msp_shared_links').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
      ])
      setDeal(dealRes.data)
      setSteps(stepsRes.data || [])
      setResources(resRes.data || [])
      setSharedLinks(linksRes.data || [])

      if (!stepsRes.data?.length) {
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

  async function applyTemplate() {
    if (!selectedTemplate) return
    setApplyingTemplate(true)
    try {
      const { data: tplSteps } = await supabase.from('msp_template_stages').select('*').eq('template_id', selectedTemplate).order('stage_order')
      if (!tplSteps?.length) { setApplyingTemplate(false); return }

      const today = new Date()
      for (const ts of tplSteps) {
        const dueDate = new Date(today)
        dueDate.setDate(dueDate.getDate() + (ts.due_date_offset || ts.default_duration_days || 0))
        await supabase.from('msp_stages').insert({
          deal_id: dealId, stage_name: ts.stage_name, stage_order: ts.stage_order,
          due_date: dueDate.toISOString().split('T')[0],
          notes: ts.notes || null, status: 'pending', is_completed: false,
        })
      }
      loadData()
    } catch (err) {
      console.error('Error applying template:', err)
    } finally {
      setApplyingTemplate(false)
    }
  }

  async function addStep() {
    if (!newStepName.trim()) return
    const nextOrder = steps.length > 0 ? Math.max(...steps.map(s => s.stage_order)) + 1 : 1
    await supabase.from('msp_stages').insert({
      deal_id: dealId, stage_name: newStepName.trim(), stage_order: nextOrder,
      status: 'pending', is_completed: false, is_custom: true,
    })
    setNewStepName('')
    setShowAddStep(false)
    loadData()
  }

  async function addTweener(aboveStep, belowStep) {
    const order = (aboveStep.stage_order + belowStep.stage_order) / 2
    await supabase.from('msp_stages').insert({
      deal_id: dealId, stage_name: 'New Step', stage_order: order,
      status: 'pending', is_completed: false, is_tweener: true, is_custom: true,
    })
    loadData()
  }

  async function cycleStatus(step) {
    const cycle = { pending: 'in_progress', in_progress: 'completed', completed: 'blocked', blocked: 'pending' }
    const next = cycle[step.status] || 'pending'
    const isCompleted = next === 'completed'
    const updates = { status: next, is_completed: isCompleted }
    if (isCompleted) updates.completion_date = new Date().toISOString()
    else { updates.completion_date = null }
    await supabase.from('msp_stages').update(updates).eq('id', step.id)
    setSteps(prev => prev.map(s => s.id === step.id ? { ...s, ...updates } : s))
  }

  async function saveNameInline(stepId) {
    if (!editingName.trim()) { setEditingStep(null); return }
    await supabase.from('msp_stages').update({ stage_name: editingName }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, stage_name: editingName } : s))
    setEditingStep(null)
  }

  async function updateDueDate(stepId, date) {
    await supabase.from('msp_stages').update({ due_date: date }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, due_date: date } : s))
  }

  async function updateNotes(stepId, notes) {
    await supabase.from('msp_stages').update({ notes }).eq('id', stepId)
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, notes } : s))
  }

  async function deleteStep(stepId) {
    if (!window.confirm('Delete this step?')) return
    await supabase.from('msp_stages').delete().eq('id', stepId)
    setSteps(prev => prev.filter(s => s.id !== stepId))
  }

  async function moveStep(idx, dir) {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= steps.length) return
    const a = steps[idx], b = steps[newIdx]
    await Promise.all([
      supabase.from('msp_stages').update({ stage_order: b.stage_order }).eq('id', a.id),
      supabase.from('msp_stages').update({ stage_order: a.stage_order }).eq('id', b.id),
    ])
    loadData()
  }

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
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const completedSteps = steps.filter(s => s.is_completed).length
  const progressPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0

  const tabs = [
    { key: 'timeline', label: 'Timeline' },
    { key: 'resources', label: `Resources (${resources.length})` },
    { key: 'sharing', label: 'Sharing' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button onClick={() => navigate(`/deal/${dealId}`)} style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}>&larr; {deal.company_name}</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Mutual Success Plan</div>
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

      <div style={{ padding: 24, maxWidth: 1100 }}>

        {/* TIMELINE TAB */}
        {tab === 'timeline' && (
          <div>
            {steps.length === 0 ? (
              <Card>
                <div style={{ textAlign: 'center', padding: 32 }}>
                  <div style={{ fontSize: 14, color: T.textMuted, marginBottom: 16 }}>No MSP steps yet. Apply a template or add steps manually.</div>
                  {templates.length > 0 && (
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
            ) : (
              <div style={{ position: 'relative', paddingLeft: 40 }}>
                {/* Vertical line */}
                <div style={{ position: 'absolute', left: 15, top: 16, bottom: 16, width: 2, background: T.border }} />

                {steps.map((step, si) => {
                  const days = daysUntil(step.due_date)
                  const overdue = !step.is_completed && step.status !== 'blocked' && days != null && days < 0
                  const statusColor = STATUS_COLORS[step.status] || T.border

                  return (
                    <div key={step.id}>
                      <div style={{ position: 'relative', marginBottom: 4 }}>
                        {/* Status circle */}
                        <button onClick={() => cycleStatus(step)} title={`Status: ${step.status}. Click to change.`} style={{
                          position: 'absolute', left: -40 + 15 - 14, top: 14, width: 28, height: 28, borderRadius: '50%',
                          background: statusColor, color: '#fff', border: `2px solid ${statusColor}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, zIndex: 1, cursor: 'pointer', padding: 0,
                          animation: step.status === 'in_progress' ? 'pulse 2s ease-in-out infinite' : 'none',
                        }}>
                          {step.status === 'completed' ? '\u2713' : step.status === 'blocked' ? '!' : si + 1}
                        </button>

                        <div style={{
                          background: T.surface, border: `1px solid ${overdue ? T.error + '40' : T.border}`,
                          borderRadius: T.radius, boxShadow: T.shadow, padding: '12px 16px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {/* Reorder */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <button onClick={() => moveStep(si, -1)} disabled={si === 0}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 10, opacity: si === 0 ? 0.3 : 1, padding: 0 }}>{'\u25B2'}</button>
                              <button onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 10, opacity: si === steps.length - 1 ? 0.3 : 1, padding: 0 }}>{'\u25BC'}</button>
                            </div>

                            {/* Name */}
                            <div style={{ flex: 1 }}>
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

                            {/* Status badge */}
                            <Badge color={statusColor}>{step.status}</Badge>

                            {/* Due date */}
                            <input type="date" value={step.due_date?.split('T')[0] || ''}
                              onChange={e => updateDueDate(step.id, e.target.value)}
                              style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11 }} />

                            {days != null && !step.is_completed && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: overdue ? T.error : days <= 7 ? T.warning : T.textMuted, whiteSpace: 'nowrap', fontFeatureSettings: '"tnum"' }}>
                                {overdue ? `${Math.abs(days)}d late` : `${days}d`}
                              </span>
                            )}

                            {/* Notes toggle */}
                            <button onClick={() => setShowNotes(p => ({ ...p, [step.id]: !p[step.id] }))}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '2px 6px',
                                color: step.notes ? T.primary : T.textMuted, fontWeight: step.notes ? 600 : 400,
                              }}>
                              Notes{step.notes ? ' *' : ''}
                            </button>

                            {/* Delete */}
                            <button onClick={() => deleteStep(step.id)} style={{
                              background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: '2px 4px', lineHeight: 1,
                            }}
                              onMouseEnter={e => e.currentTarget.style.color = T.error}
                              onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
                            >&times;</button>
                          </div>

                          {/* Notes */}
                          {showNotes[step.id] && (
                            <div style={{ marginTop: 8 }}>
                              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontSize: 12 }}
                                value={step.notes || ''}
                                onChange={e => setSteps(prev => prev.map(s => s.id === step.id ? { ...s, notes: e.target.value } : s))}
                                onBlur={e => updateNotes(step.id, e.target.value)}
                                placeholder="Add notes..." />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* + button between steps */}
                      {si < steps.length - 1 && (
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

            {/* Add Step */}
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
            <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }`}</style>
          </div>
        )}

        {/* RESOURCES TAB */}
        {tab === 'resources' && (
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
            {resources.length === 0 ? <EmptyState message="No resources attached to this MSP yet." /> : resources.map(r => (
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

        {/* SHARING TAB */}
        {tab === 'sharing' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button primary onClick={createShareLink}>Create Share Link</Button>
            </div>
            {sharedLinks.length === 0 ? <EmptyState message="No shared links. Create one to share the MSP with your client." /> : sharedLinks.map(link => (
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
