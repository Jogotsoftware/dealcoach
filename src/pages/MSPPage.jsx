import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatDate, formatDateLong, daysUntil } from '../lib/theme'
import { Card, Badge, Button, MilestoneStatus, EmptyState, Spinner, TabBar, inputStyle, labelStyle } from '../components/Shared'

export default function MSPPage() {
  const { dealId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [deal, setDeal] = useState(null)
  const [stages, setStages] = useState([])
  const [milestones, setMilestones] = useState([])
  const [resources, setResources] = useState([])
  const [sharedLinks, setSharedLinks] = useState([])
  const [tab, setTab] = useState('timeline')

  // Add stage form
  const [showAddStage, setShowAddStage] = useState(false)
  const [newStage, setNewStage] = useState({ stage_name: '', notes: '' })

  // Add milestone form (keyed by stage id)
  const [showAddMilestone, setShowAddMilestone] = useState(null)
  const [newMilestone, setNewMilestone] = useState({ milestone_name: '', due_date: '' })

  // Inline editing
  const [editingStage, setEditingStage] = useState(null)
  const [editingStageName, setEditingStageName] = useState('')
  const [editingMilestone, setEditingMilestone] = useState(null)
  const [editingMilestoneName, setEditingMilestoneName] = useState('')

  // Expand/collapse
  const [collapsed, setCollapsed] = useState({})

  // Milestone notes
  const [showNotes, setShowNotes] = useState({})

  // Add resource form
  const [showAddResource, setShowAddResource] = useState(false)
  const [newResource, setNewResource] = useState({ resource_name: '', resource_type: 'document', resource_url: '', description: '' })

  useEffect(() => { loadData() }, [dealId])

  async function loadData() {
    setLoading(true)
    try {
      const [dealRes, stagesRes, msRes, resRes, linksRes] = await Promise.all([
        supabase.from('deals').select('id, company_name, website, stage, target_close_date').eq('id', dealId).single(),
        supabase.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
        supabase.from('msp_milestones').select('*').eq('deal_id', dealId).order('milestone_order'),
        supabase.from('msp_resources').select('*').eq('deal_id', dealId).order('created_at'),
        supabase.from('msp_shared_links').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
      ])
      setDeal(dealRes.data)
      setStages(stagesRes.data || [])
      setMilestones(msRes.data || [])
      setResources(resRes.data || [])
      setSharedLinks(linksRes.data || [])
    } catch (err) {
      console.error('Error loading MSP:', err)
    } finally {
      setLoading(false)
    }
  }

  async function addStage() {
    if (!newStage.stage_name.trim()) return
    const nextOrder = stages.length > 0 ? Math.max(...stages.map(s => s.stage_order)) + 1 : 1
    const { error } = await supabase.from('msp_stages').insert({
      deal_id: dealId, stage_name: newStage.stage_name, stage_order: nextOrder,
      notes: newStage.notes || null,
    })
    if (!error) { setShowAddStage(false); setNewStage({ stage_name: '', notes: '' }); loadData() }
  }

  async function addTweener(aboveStage, belowStage) {
    const order = belowStage
      ? (aboveStage.stage_order + belowStage.stage_order) / 2
      : aboveStage.stage_order + 0.5
    const { error } = await supabase.from('msp_stages').insert({
      deal_id: dealId, stage_name: 'New Step', stage_order: order,
      is_tweener: true, parent_stage_id: aboveStage.id,
    })
    if (!error) loadData()
  }

  async function saveStageNameInline(stageId) {
    if (!editingStageName.trim()) { setEditingStage(null); return }
    await supabase.from('msp_stages').update({ stage_name: editingStageName }).eq('id', stageId)
    setStages(prev => prev.map(s => s.id === stageId ? { ...s, stage_name: editingStageName } : s))
    setEditingStage(null)
  }

  async function updateStageDate(stageId, date) {
    await supabase.from('msp_stages').update({ start_date: date }).eq('id', stageId)
    setStages(prev => prev.map(s => s.id === stageId ? { ...s, start_date: date } : s))
  }

  async function toggleStageComplete(stage) {
    const val = !stage.is_completed
    await supabase.from('msp_stages').update({ is_completed: val }).eq('id', stage.id)
    setStages(prev => prev.map(s => s.id === stage.id ? { ...s, is_completed: val } : s))
  }

  async function addMilestone(stageId) {
    if (!newMilestone.milestone_name.trim()) return
    const stageMilestones = milestones.filter(m => m.msp_stage_id === stageId)
    const nextOrder = stageMilestones.length > 0 ? Math.max(...stageMilestones.map(m => m.milestone_order)) + 1 : 1
    const { error } = await supabase.from('msp_milestones').insert({
      deal_id: dealId, msp_stage_id: stageId, milestone_name: newMilestone.milestone_name,
      milestone_order: nextOrder, due_date: newMilestone.due_date || null, status: 'pending',
    })
    if (!error) { setShowAddMilestone(null); setNewMilestone({ milestone_name: '', due_date: '' }); loadData() }
  }

  async function toggleMilestoneStatus(ms) {
    const cycle = { pending: 'in_progress', in_progress: 'completed', completed: 'pending' }
    const next = cycle[ms.status] || 'pending'
    await supabase.from('msp_milestones').update({ status: next }).eq('id', ms.id)
    setMilestones(prev => prev.map(m => m.id === ms.id ? { ...m, status: next } : m))
  }

  async function saveMilestoneNameInline(msId) {
    if (!editingMilestoneName.trim()) { setEditingMilestone(null); return }
    await supabase.from('msp_milestones').update({ milestone_name: editingMilestoneName }).eq('id', msId)
    setMilestones(prev => prev.map(m => m.id === msId ? { ...m, milestone_name: editingMilestoneName } : m))
    setEditingMilestone(null)
  }

  async function updateMilestoneDate(id, date) {
    await supabase.from('msp_milestones').update({ due_date: date }).eq('id', id)
    setMilestones(prev => prev.map(m => m.id === id ? { ...m, due_date: date } : m))
  }

  async function updateMilestoneNotes(id, notes) {
    await supabase.from('msp_milestones').update({ notes }).eq('id', id)
    setMilestones(prev => prev.map(m => m.id === id ? { ...m, notes } : m))
  }

  async function deleteMilestone(id) {
    if (!window.confirm('Delete this milestone?')) return
    await supabase.from('msp_milestones').delete().eq('id', id)
    setMilestones(prev => prev.filter(m => m.id !== id))
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
    const { error } = await supabase.from('msp_shared_links').insert({
      deal_id: dealId, share_token: token, created_by: user.id,
    })
    if (!error) loadData()
  }

  async function toggleLinkActive(link) {
    await supabase.from('msp_shared_links').update({ is_active: !link.is_active }).eq('id', link.id)
    setSharedLinks(prev => prev.map(l => l.id === link.id ? { ...l, is_active: !l.is_active } : l))
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const stagesWithMs = stages.map(s => ({
    ...s,
    milestones: milestones.filter(m => m.msp_stage_id === s.id),
  }))

  const totalMs = milestones.length
  const completedMs = milestones.filter(m => m.status === 'completed').length
  const progressPct = totalMs > 0 ? Math.round((completedMs / totalMs) * 100) : 0
  const firstActiveIdx = stagesWithMs.findIndex(s => !s.is_completed)

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
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{completedMs}/{totalMs} milestones</div>
          </div>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: 24, maxWidth: 1100 }}>

        {/* TIMELINE TAB */}
        {tab === 'timeline' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 8 }}>
              <Button onClick={() => setShowAddStage(true)}>+ Add Stage</Button>
            </div>

            {showAddStage && (
              <Card title="New Stage" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Stage Name *</label>
                    <input style={inputStyle} value={newStage.stage_name}
                      onChange={e => setNewStage(p => ({ ...p, stage_name: e.target.value }))}
                      placeholder="e.g. Discovery, Solution Validation" autoFocus
                      onKeyDown={e => e.key === 'Enter' && addStage()}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Notes</label>
                    <input style={inputStyle} value={newStage.notes}
                      onChange={e => setNewStage(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
                  </div>
                  <Button primary onClick={addStage}>Add</Button>
                  <Button onClick={() => setShowAddStage(false)}>Cancel</Button>
                </div>
              </Card>
            )}

            {stagesWithMs.length === 0 ? (
              <EmptyState
                message="No MSP stages yet. Create your first stage to start building the timeline."
                action={<Button primary onClick={() => setShowAddStage(true)} style={{ marginTop: 8 }}>Create First Stage</Button>}
              />
            ) : (
              <div style={{ position: 'relative', paddingLeft: 40 }}>
                {/* Vertical line */}
                <div style={{
                  position: 'absolute', left: 15, top: 16, bottom: 16,
                  width: 2, background: T.border,
                }} />

                {stagesWithMs.map((stage, si) => {
                  const isActive = si === firstActiveIdx
                  const isExpanded = !collapsed[stage.id]
                  const circleColor = stage.is_completed ? T.success : isActive ? T.primary : T.border

                  return (
                    <div key={stage.id}>
                      {/* Stage card */}
                      <div style={{ position: 'relative', marginBottom: 8 }}>
                        {/* Circle on the line */}
                        <div style={{
                          position: 'absolute', left: -40 + 15 - 16, top: 16,
                          width: 32, height: 32, borderRadius: '50%',
                          background: circleColor, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, fontWeight: 700, zIndex: 1,
                          border: `2px solid ${stage.is_completed ? T.success : isActive ? T.primary : T.borderLight}`,
                        }}>
                          {stage.is_completed ? '\u2713' : si + 1}
                        </div>

                        <Card
                          title={
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                              {/* Expand/collapse */}
                              <button onClick={() => setCollapsed(p => ({ ...p, [stage.id]: !p[stage.id] }))} style={{
                                background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
                                color: T.textMuted, padding: 0, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                transition: 'transform 0.15s',
                              }}>{'\u25B6'}</button>

                              {/* Stage name inline edit */}
                              {editingStage === stage.id ? (
                                <input style={{ ...inputStyle, width: 200, padding: '4px 8px', fontSize: 13, fontWeight: 600 }}
                                  value={editingStageName}
                                  onChange={e => setEditingStageName(e.target.value)}
                                  onBlur={() => saveStageNameInline(stage.id)}
                                  onKeyDown={e => e.key === 'Enter' && saveStageNameInline(stage.id)}
                                  autoFocus
                                />
                              ) : (
                                <span
                                  onClick={() => { setEditingStage(stage.id); setEditingStageName(stage.stage_name) }}
                                  style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: T.text, position: 'relative' }}
                                  onMouseEnter={e => { const p = e.currentTarget.querySelector('.pencil'); if (p) p.style.opacity = 1 }}
                                  onMouseLeave={e => { const p = e.currentTarget.querySelector('.pencil'); if (p) p.style.opacity = 0 }}
                                >
                                  {stage.stage_name}
                                  <span className="pencil" style={{ marginLeft: 6, opacity: 0, transition: 'opacity 0.15s', fontSize: 11, color: T.textMuted }}>{'\u270E'}</span>
                                </span>
                              )}

                              {stage.is_completed && <Badge color={T.success}>Complete</Badge>}
                              {stage.is_tweener && <Badge color={T.textMuted}>Tweener</Badge>}
                            </div>
                          }
                          action={
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input type="date" value={stage.start_date?.split('T')[0] || ''}
                                onChange={e => updateStageDate(stage.id, e.target.value)}
                                style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11 }} />
                              <Button style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() => toggleStageComplete(stage)}>
                                {stage.is_completed ? 'Reopen' : 'Complete'}
                              </Button>
                              <Button style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() => { setShowAddMilestone(stage.id); setNewMilestone({ milestone_name: '', due_date: '' }) }}>
                                + Milestone
                              </Button>
                            </div>
                          }
                        >
                          {/* Add Milestone Form */}
                          {showAddMilestone === stage.id && (
                            <div style={{
                              display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12,
                              padding: 12, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`,
                            }}>
                              <div style={{ flex: 1 }}>
                                <label style={labelStyle}>Milestone Name *</label>
                                <input style={inputStyle} value={newMilestone.milestone_name}
                                  onChange={e => setNewMilestone(p => ({ ...p, milestone_name: e.target.value }))}
                                  placeholder="e.g. Demo Complete, SOW Review" autoFocus
                                  onKeyDown={e => e.key === 'Enter' && addMilestone(stage.id)} />
                              </div>
                              <div>
                                <label style={labelStyle}>Due Date</label>
                                <input type="date" style={{ ...inputStyle, width: 160 }} value={newMilestone.due_date}
                                  onChange={e => setNewMilestone(p => ({ ...p, due_date: e.target.value }))} />
                              </div>
                              <Button primary onClick={() => addMilestone(stage.id)}>Add</Button>
                              <Button onClick={() => setShowAddMilestone(null)}>Cancel</Button>
                            </div>
                          )}

                          {/* Milestones */}
                          {isExpanded && (
                            stage.milestones.length === 0 ? (
                              <div style={{ color: T.textMuted, fontSize: 13, padding: '8px 0' }}>No milestones yet.</div>
                            ) : stage.milestones.map(ms => {
                              const days = daysUntil(ms.due_date)
                              const overdue = ms.status !== 'completed' && days != null && days < 0
                              return (
                                <div key={ms.id} style={{ marginBottom: 8 }}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '12px 14px', background: T.surfaceAlt, borderRadius: 6,
                                    border: `1px solid ${overdue ? T.error + '30' : T.borderLight}`,
                                  }}>
                                    {/* Status checkbox */}
                                    <button onClick={() => toggleMilestoneStatus(ms)} style={{
                                      width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                                      border: `1.5px solid ${ms.status === 'completed' ? T.success : ms.status === 'in_progress' ? T.primary : T.border}`,
                                      background: ms.status === 'completed' ? T.success : ms.status === 'in_progress' ? T.primary + '20' : 'transparent',
                                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                                    }}>
                                      {ms.status === 'completed' && <span style={{ color: '#fff', fontSize: 13 }}>&#10003;</span>}
                                      {ms.status === 'in_progress' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.primary }} />}
                                    </button>

                                    {/* Name (inline editable) */}
                                    <div style={{ flex: 1 }}>
                                      {editingMilestone === ms.id ? (
                                        <input style={{ ...inputStyle, padding: '4px 8px', fontSize: 13, fontWeight: 600 }}
                                          value={editingMilestoneName}
                                          onChange={e => setEditingMilestoneName(e.target.value)}
                                          onBlur={() => saveMilestoneNameInline(ms.id)}
                                          onKeyDown={e => e.key === 'Enter' && saveMilestoneNameInline(ms.id)}
                                          autoFocus />
                                      ) : (
                                        <div
                                          onClick={() => { setEditingMilestone(ms.id); setEditingMilestoneName(ms.milestone_name) }}
                                          style={{
                                            fontSize: 13, fontWeight: 600, color: T.text, cursor: 'pointer',
                                            textDecoration: ms.status === 'completed' ? 'line-through' : 'none',
                                            opacity: ms.status === 'completed' ? 0.6 : 1,
                                          }}>
                                          {ms.milestone_name}
                                        </div>
                                      )}
                                    </div>

                                    <MilestoneStatus status={ms.status} />

                                    <input type="date" value={ms.due_date?.split('T')[0] || ''}
                                      onChange={e => updateMilestoneDate(ms.id, e.target.value)}
                                      style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 11 }} />

                                    {days != null && ms.status !== 'completed' && (
                                      <span style={{
                                        fontSize: 11, fontWeight: 600, fontFeatureSettings: '"tnum"',
                                        color: overdue ? T.error : days <= 7 ? T.warning : T.textMuted,
                                        whiteSpace: 'nowrap',
                                      }}>
                                        {overdue ? `${Math.abs(days)}d late` : `${days}d`}
                                      </span>
                                    )}

                                    <button onClick={() => setShowNotes(p => ({ ...p, [ms.id]: !p[ms.id] }))}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.textMuted, padding: '2px 6px' }}>
                                      Notes
                                    </button>

                                    <button onClick={() => deleteMilestone(ms.id)} style={{
                                      background: 'none', border: 'none', cursor: 'pointer',
                                      color: T.textMuted, fontSize: 14, padding: '2px 4px', lineHeight: 1,
                                    }}
                                      onMouseEnter={e => e.currentTarget.style.color = T.error}
                                      onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
                                    >&#10005;</button>
                                  </div>

                                  {/* Notes expandable */}
                                  {showNotes[ms.id] && (
                                    <div style={{ padding: '8px 14px' }}>
                                      <textarea
                                        style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontSize: 12 }}
                                        value={ms.notes || ''}
                                        onChange={e => setMilestones(prev => prev.map(m => m.id === ms.id ? { ...m, notes: e.target.value } : m))}
                                        onBlur={e => updateMilestoneNotes(ms.id, e.target.value)}
                                        placeholder="Add notes..."
                                      />
                                    </div>
                                  )}
                                </div>
                              )
                            })
                          )}

                          {stage.notes && !stage.milestones?.length && (
                            <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 8, fontStyle: 'italic' }}>{stage.notes}</div>
                          )}
                        </Card>
                      </div>

                      {/* Add Tweener button between stages */}
                      {si < stagesWithMs.length - 1 && (
                        <div style={{ position: 'relative', height: 24, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                          <button
                            onClick={() => addTweener(stage, stagesWithMs[si + 1])}
                            style={{
                              position: 'absolute', left: -40 + 15 - 10, top: 2,
                              width: 20, height: 20, borderRadius: '50%',
                              background: T.surface, border: `1.5px solid ${T.border}`,
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 14, color: T.textMuted, padding: 0, zIndex: 1,
                              transition: 'all 0.15s',
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
                  <div>
                    <label style={labelStyle}>Resource Name *</label>
                    <input style={inputStyle} value={newResource.resource_name}
                      onChange={e => setNewResource(p => ({ ...p, resource_name: e.target.value }))}
                      placeholder="e.g. Implementation Guide" />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select style={{ ...inputStyle, cursor: 'pointer' }} value={newResource.resource_type}
                      onChange={e => setNewResource(p => ({ ...p, resource_type: e.target.value }))}>
                      <option value="document">Document</option>
                      <option value="link">Link</option>
                      <option value="template">Template</option>
                      <option value="video">Video</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>URL</label>
                    <input style={inputStyle} value={newResource.resource_url}
                      onChange={e => setNewResource(p => ({ ...p, resource_url: e.target.value }))}
                      placeholder="https://..." />
                  </div>
                  <div>
                    <label style={labelStyle}>Description</label>
                    <input style={inputStyle} value={newResource.description}
                      onChange={e => setNewResource(p => ({ ...p, description: e.target.value }))}
                      placeholder="Brief description" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button primary onClick={addResource}>Add</Button>
                  <Button onClick={() => setShowAddResource(false)}>Cancel</Button>
                </div>
              </Card>
            )}

            {resources.length === 0 ? (
              <EmptyState message="No resources attached to this MSP yet." />
            ) : resources.map(r => (
              <Card key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{r.resource_name}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      {r.resource_type && <Badge color={T.primary}>{r.resource_type}</Badge>}
                    </div>
                    {r.description && <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>{r.description}</div>}
                  </div>
                  {r.resource_url && (
                    <a href={r.resource_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: T.primary, fontWeight: 600, textDecoration: 'none' }}>
                      Open &rarr;
                    </a>
                  )}
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
            {sharedLinks.length === 0 ? (
              <EmptyState message="No shared links. Create one to share the MSP timeline with your client." />
            ) : sharedLinks.map(link => (
              <Card key={link.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontFamily: T.mono, color: T.text, marginBottom: 4 }}>
                      {window.location.origin}/msp/shared/{link.share_token}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 11, color: T.textSecondary, alignItems: 'center' }}>
                      <span>Views: {link.access_count || 0}</span>
                      <span>Expires: {formatDateLong(link.expires_at)}</span>
                      <span onClick={() => toggleLinkActive(link)} style={{ cursor: 'pointer' }}>
                        {link.is_active
                          ? <Badge color={T.success}>Active</Badge>
                          : <Badge color={T.error}>Inactive</Badge>}
                      </span>
                    </div>
                  </div>
                  <Button style={{ padding: '6px 14px', fontSize: 12 }}
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/msp/shared/${link.share_token}`)}>
                    Copy Link
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
