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
  const [showAddStage, setShowAddStage] = useState(false)
  const [newStage, setNewStage] = useState({ stage_name: '', notes: '' })
  const [showAddMilestone, setShowAddMilestone] = useState(null) // stage id
  const [newMilestone, setNewMilestone] = useState({ milestone_name: '', due_date: '' })

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

  async function updateMilestoneDate(id, date) {
    await supabase.from('msp_milestones').update({ due_date: date }).eq('id', id)
    setMilestones(prev => prev.map(m => m.id === id ? { ...m, due_date: date } : m))
  }

  async function toggleMilestoneStatus(ms) {
    const next = ms.status === 'completed' ? 'pending' : ms.status === 'pending' ? 'in_progress' : 'completed'
    await supabase.from('msp_milestones').update({ status: next }).eq('id', ms.id)
    setMilestones(prev => prev.map(m => m.id === ms.id ? { ...m, status: next } : m))
  }

  async function createShareLink() {
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('msp_shared_links').insert({
      deal_id: dealId, share_token: token, created_by: user.id,
    })
    if (!error) loadData()
  }

  async function addResource() {
    const name = prompt('Resource name:')
    if (!name) return
    const url = prompt('URL (optional):')
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('msp_resources').insert({
      deal_id: dealId, resource_name: name, resource_url: url || null, created_by: user.id,
    })
    loadData()
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
          <button
            onClick={() => navigate(`/deal/${dealId}`)}
            style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
              fontWeight: 600, fontFamily: T.font,
            }}
          >
            &larr; {deal.company_name}
          </button>
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
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
              {completedMs}/{totalMs} milestones
            </div>
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

            {/* Add Stage Form */}
            {showAddStage && (
              <Card title="New Stage" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Stage Name *</label>
                    <input
                      style={inputStyle} value={newStage.stage_name}
                      onChange={e => setNewStage(p => ({ ...p, stage_name: e.target.value }))}
                      placeholder="e.g. Discovery, Solution Validation" autoFocus
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Notes</label>
                    <input
                      style={inputStyle} value={newStage.notes}
                      onChange={e => setNewStage(p => ({ ...p, notes: e.target.value }))}
                      placeholder="Optional"
                    />
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
              stagesWithMs.map((stage, si) => (
                <Card
                  key={stage.id}
                  title={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: stage.is_completed ? T.success : T.primary,
                        color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                      }}>
                        {si + 1}
                      </span>
                      {stage.stage_name}
                      {stage.is_completed && <Badge color={T.success}>Complete</Badge>}
                    </span>
                  }
                  action={
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {stage.start_date && (
                        <span style={{ fontSize: 11, color: T.textSecondary }}>Start: {formatDate(stage.start_date)}</span>
                      )}
                      <Button
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={() => { setShowAddMilestone(stage.id); setNewMilestone({ milestone_name: '', due_date: '' }) }}
                      >
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
                        <input
                          style={inputStyle} value={newMilestone.milestone_name}
                          onChange={e => setNewMilestone(p => ({ ...p, milestone_name: e.target.value }))}
                          placeholder="e.g. Demo Complete, SOW Review" autoFocus
                          onKeyDown={e => e.key === 'Enter' && addMilestone(stage.id)}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Due Date</label>
                        <input
                          type="date" style={{ ...inputStyle, width: 160 }}
                          value={newMilestone.due_date}
                          onChange={e => setNewMilestone(p => ({ ...p, due_date: e.target.value }))}
                        />
                      </div>
                      <Button primary onClick={() => addMilestone(stage.id)}>Add</Button>
                      <Button onClick={() => setShowAddMilestone(null)}>Cancel</Button>
                    </div>
                  )}

                  {/* Milestones */}
                  {stage.milestones.length === 0 ? (
                    <div style={{ color: T.textMuted, fontSize: 13, padding: '8px 0' }}>
                      No milestones yet.
                    </div>
                  ) : (
                    stage.milestones.map(ms => {
                      const days = daysUntil(ms.due_date)
                      const overdue = ms.status !== 'completed' && days != null && days < 0
                      return (
                        <div key={ms.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 14px', background: T.surfaceAlt, borderRadius: 6,
                          border: `1px solid ${overdue ? T.error + '30' : T.borderLight}`, marginBottom: 8,
                        }}>
                          {/* Status checkbox */}
                          <button
                            onClick={() => toggleMilestoneStatus(ms)}
                            style={{
                              width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                              border: `1.5px solid ${ms.status === 'completed' ? T.success : T.border}`,
                              background: ms.status === 'completed' ? T.success : 'transparent',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                            }}
                          >
                            {ms.status === 'completed' && <span style={{ color: '#fff', fontSize: 13 }}>&#10003;</span>}
                          </button>

                          {/* Name */}
                          <div style={{ flex: 1 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 600, color: T.text,
                              textDecoration: ms.status === 'completed' ? 'line-through' : 'none',
                              opacity: ms.status === 'completed' ? 0.6 : 1,
                            }}>
                              {ms.milestone_name}
                            </div>
                            {ms.notes && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{ms.notes}</div>}
                          </div>

                          {/* Status badge */}
                          <MilestoneStatus status={ms.status} />

                          {/* Editable date */}
                          <input
                            type="date"
                            value={ms.due_date?.split('T')[0] || ''}
                            onChange={e => updateMilestoneDate(ms.id, e.target.value)}
                            style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 11 }}
                          />

                          {/* Days indicator */}
                          {days != null && ms.status !== 'completed' && (
                            <span style={{
                              fontSize: 11, fontWeight: 600, fontFeatureSettings: '"tnum"',
                              color: overdue ? T.error : days <= 7 ? T.warning : T.textMuted,
                              whiteSpace: 'nowrap',
                            }}>
                              {overdue ? `${Math.abs(days)}d late` : `${days}d`}
                            </span>
                          )}
                        </div>
                      )
                    })
                  )}

                  {stage.notes && (
                    <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 8, fontStyle: 'italic' }}>
                      {stage.notes}
                    </div>
                  )}
                </Card>
              ))
            )}
          </div>
        )}

        {/* RESOURCES TAB */}
        {tab === 'resources' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button primary onClick={addResource}>+ Add Resource</Button>
            </div>
            {resources.length === 0 ? (
              <EmptyState message="No resources attached to this MSP yet." />
            ) : (
              resources.map(r => (
                <Card key={r.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{r.resource_name}</div>
                      {r.resource_type && <Badge color={T.primary}>{r.resource_type}</Badge>}
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
              ))
            )}
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
            ) : (
              sharedLinks.map(link => (
                <Card key={link.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontFamily: T.mono, color: T.text, marginBottom: 4 }}>
                        {window.location.origin}/msp/shared/{link.share_token}
                      </div>
                      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: T.textSecondary }}>
                        <span>Views: {link.access_count}</span>
                        <span>Expires: {formatDateLong(link.expires_at)}</span>
                        {link.is_active ? <Badge color={T.success}>Active</Badge> : <Badge color={T.error}>Inactive</Badge>}
                      </div>
                    </div>
                    <Button
                      style={{ padding: '6px 14px', fontSize: 12 }}
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/msp/shared/${link.share_token}`)}
                    >
                      Copy Link
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
