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
  const [repScoringConfigs, setRepScoringConfigs] = useState([])
  const [mspTemplates, setMspTemplates] = useState([])
  const [templateStages, setTemplateStages] = useState([])
  const [templateMilestones, setTemplateMilestones] = useState([])

  // Editing states
  const [editingCoach, setEditingCoach] = useState(false)
  const [editCoachData, setEditCoachData] = useState({})
  const [editingPrompt, setEditingPrompt] = useState(null)
  const [editPromptData, setEditPromptData] = useState({})
  const [editingSystemPrompt, setEditingSystemPrompt] = useState(false)
  const [systemPromptVal, setSystemPromptVal] = useState('')

  // Template form
  const [showAddTemplate, setShowAddTemplate] = useState(false)
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '' })
  const [showAddTemplateStage, setShowAddTemplateStage] = useState(null)
  const [newTemplateStage, setNewTemplateStage] = useState({ stage_name: '', default_duration_days: 14 })

  useEffect(() => { loadCoach() }, [profile])

  async function loadCoach() {
    setLoading(true)
    try {
      const coachId = profile?.active_coach_id
      let coachQuery = supabase.from('coaches').select('*').eq('active', true).limit(1)
      if (coachId) coachQuery = supabase.from('coaches').select('*').eq('id', coachId).single()
      const { data: coachData } = coachId ? await coachQuery : await coachQuery

      const activeCoach = coachId ? coachData : coachData?.[0]
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

        // Load template stages/milestones
        const tplIds = (templatesRes.data || []).map(t => t.id)
        if (tplIds.length > 0) {
          const [stagesRes, msRes] = await Promise.all([
            supabase.from('msp_template_stages').select('*').in('template_id', tplIds).order('stage_order'),
            supabase.from('msp_template_milestones').select('*').in('template_id', tplIds).order('milestone_order'),
          ])
          setTemplateStages(stagesRes.data || [])
          setTemplateMilestones(msRes.data || [])
        }
      }
    } catch (err) {
      console.error('Error loading coach:', err)
    } finally {
      setLoading(false)
    }
  }

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

  async function savePrompt(promptId) {
    await supabase.from('call_type_prompts').update(editPromptData).eq('id', promptId)
    setPrompts(prev => prev.map(p => p.id === promptId ? { ...p, ...editPromptData } : p))
    setEditingPrompt(null)
  }

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

  async function addTemplate() {
    if (!newTemplate.name.trim() || !coach) return
    const { data, error } = await supabase.from('msp_templates').insert({
      coach_id: coach.id, name: newTemplate.name, description: newTemplate.description || null,
      is_default: mspTemplates.length === 0,
    }).select().single()
    if (!error && data) { setMspTemplates(prev => [...prev, data]); setShowAddTemplate(false); setNewTemplate({ name: '', description: '' }) }
  }

  async function addTemplateStage(templateId) {
    if (!newTemplateStage.stage_name.trim()) return
    const existing = templateStages.filter(s => s.template_id === templateId)
    const nextOrder = existing.length > 0 ? Math.max(...existing.map(s => s.stage_order)) + 1 : 1
    const { data, error } = await supabase.from('msp_template_stages').insert({
      template_id: templateId, stage_name: newTemplateStage.stage_name,
      stage_order: nextOrder, default_duration_days: Number(newTemplateStage.default_duration_days) || 14,
    }).select().single()
    if (!error && data) { setTemplateStages(prev => [...prev, data]); setShowAddTemplateStage(null); setNewTemplateStage({ stage_name: '', default_duration_days: 14 }) }
  }

  async function deleteTemplate(id) {
    if (!window.confirm('Delete this template and all its stages?')) return
    await supabase.from('msp_template_milestones').delete().in('template_stage_id', templateStages.filter(s => s.template_id === id).map(s => s.id))
    await supabase.from('msp_template_stages').delete().eq('template_id', id)
    await supabase.from('msp_templates').delete().eq('id', id)
    setMspTemplates(prev => prev.filter(t => t.id !== id))
    setTemplateStages(prev => prev.filter(s => s.template_id !== id))
  }

  if (loading) return <Spinner />

  const CATEGORIES = ['discovery', 'methodology', 'communication', 'qualification', 'closing', 'general', 'custom']

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'prompts', label: `Call Prompts (${prompts.length})` },
    { key: 'docs', label: `Documents (${docs.length})` },
    { key: 'scoring', label: `Scoring (${scoringConfigs.length})` },
    { key: 'rep_scoring', label: `Rep Scoring (${repScoringConfigs.length})` },
    { key: 'templates', label: `MSP Templates (${mspTemplates.length})` },
  ]

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: '0 0 12px 0' }}>Coach Admin</h2>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: 24, maxWidth: 1100 }}>
        {!coach ? (
          <Card><div style={{ textAlign: 'center', padding: 32, color: T.textMuted }}>No active coach configured.</div></Card>
        ) : (
          <>
            {/* OVERVIEW */}
            {tab === 'overview' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Card title="Active Coach" action={<Button style={{ padding: '4px 12px', fontSize: 11 }}
                  onClick={() => { setEditingCoach(true); setEditCoachData({ name: coach.name, description: coach.description, model: coach.model, temperature: coach.temperature }) }}>
                  {editingCoach ? 'Cancel' : 'Edit'}</Button>}>
                  {editingCoach ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div><label style={labelStyle}>Name</label><input style={inputStyle} value={editCoachData.name || ''} onChange={e => setEditCoachData(p => ({ ...p, name: e.target.value }))} /></div>
                      <div><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={editCoachData.description || ''} onChange={e => setEditCoachData(p => ({ ...p, description: e.target.value }))} /></div>
                      <div><label style={labelStyle}>Model</label><input style={inputStyle} value={editCoachData.model || ''} onChange={e => setEditCoachData(p => ({ ...p, model: e.target.value }))} /></div>
                      <div><label style={labelStyle}>Temperature</label><input type="number" step="0.1" style={inputStyle} value={editCoachData.temperature || ''} onChange={e => setEditCoachData(p => ({ ...p, temperature: Number(e.target.value) }))} /></div>
                      <Button primary onClick={saveCoach}>Save</Button>
                    </div>
                  ) : (
                    <><Field label="Name" value={coach.name} /><Field label="Description" value={coach.description} /><Field label="Model" value={coach.model} /><Field label="Temperature" value={String(coach.temperature)} /></>
                  )}
                </Card>
                <Card title="System Prompt" action={<Button style={{ padding: '4px 12px', fontSize: 11 }}
                  onClick={() => { if (editingSystemPrompt) { setEditingSystemPrompt(false) } else { setEditingSystemPrompt(true); setSystemPromptVal(coach.system_prompt || '') } }}>
                  {editingSystemPrompt ? 'Cancel' : 'Edit'}</Button>}>
                  {editingSystemPrompt ? (
                    <div>
                      <textarea style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12, minHeight: 250, resize: 'vertical' }}
                        value={systemPromptVal} onChange={e => setSystemPromptVal(e.target.value)} />
                      <Button primary onClick={saveSystemPrompt} style={{ marginTop: 8 }}>Save</Button>
                    </div>
                  ) : (
                    <div style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.6, color: T.text, background: T.surfaceAlt, padding: 14, borderRadius: 6, maxHeight: 300, overflow: 'auto' }}>
                      {coach.system_prompt || 'No system prompt configured'}
                    </div>
                  )}
                </Card>
                <Card title="Extraction Rules" style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.6, color: T.text, background: T.surfaceAlt, padding: 14, borderRadius: 6, maxHeight: 200, overflow: 'auto' }}>
                    {coach.extraction_rules || 'No extraction rules configured'}
                  </div>
                </Card>
              </div>
            )}

            {/* CALL PROMPTS */}
            {tab === 'prompts' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}><Button primary>+ Add Prompt</Button></div>
                {prompts.map(p => (
                  <Card key={p.id}>
                    {editingPrompt === p.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div><label style={labelStyle}>Label</label><input style={inputStyle} value={editPromptData.label || ''} onChange={e => setEditPromptData(prev => ({ ...prev, label: e.target.value }))} /></div>
                        <div><label style={labelStyle}>Prompt</label><textarea style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12, minHeight: 200, resize: 'vertical' }} value={editPromptData.prompt || ''} onChange={e => setEditPromptData(prev => ({ ...prev, prompt: e.target.value }))} /></div>
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
                          <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 11, lineHeight: 1.5, color: T.textSecondary, background: T.surfaceAlt, padding: 10, borderRadius: 4, maxHeight: 80, overflow: 'hidden' }}>
                            {p.prompt.substring(0, 200)}{p.prompt.length > 200 ? '...' : ''}
                          </div>
                        )}
                      </>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {/* DOCUMENTS */}
            {tab === 'docs' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}><Button primary>+ Upload Document</Button></div>
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

            {/* SCORING */}
            {tab === 'scoring' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {scoringConfigs.map(s => (
                  <Card key={s.id} title={s.label}>
                    <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 10 }}>{s.description}</div>
                    {Array.isArray(s.criteria) && s.criteria.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: T.surfaceAlt, borderRadius: 4, marginBottom: 4 }}>
                        <span style={{ fontSize: 13, color: T.text }}>{c.name || c.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: T.primary }}>{c.weight}%</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted }}>Max score: {s.max_score}</div>
                  </Card>
                ))}
              </div>
            )}

            {/* REP SCORING */}
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

            {/* MSP TEMPLATES */}
            {tab === 'templates' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <Button primary onClick={() => setShowAddTemplate(true)}>+ Add Template</Button>
                </div>

                {showAddTemplate && (
                  <Card title="New Template" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}><label style={labelStyle}>Name *</label><input style={inputStyle} value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
                      <div style={{ flex: 1 }}><label style={labelStyle}>Description</label><input style={inputStyle} value={newTemplate.description} onChange={e => setNewTemplate(p => ({ ...p, description: e.target.value }))} /></div>
                      <Button primary onClick={addTemplate}>Add</Button>
                      <Button onClick={() => setShowAddTemplate(false)}>Cancel</Button>
                    </div>
                  </Card>
                )}

                {mspTemplates.length === 0 ? (
                  <Card><div style={{ textAlign: 'center', padding: 32, color: T.textMuted }}>No MSP templates. Create one to allow reps to quickly populate deal timelines.</div></Card>
                ) : mspTemplates.map(tpl => {
                  const tplStages = templateStages.filter(s => s.template_id === tpl.id)
                  return (
                    <Card key={tpl.id} title={<span>{tpl.name} {tpl.is_default && <Badge color={T.success}>Default</Badge>}</span>}
                      action={
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => { setShowAddTemplateStage(tpl.id); setNewTemplateStage({ stage_name: '', default_duration_days: 14 }) }}>+ Stage</Button>
                          <button onClick={() => deleteTemplate(tpl.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}
                            onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&#10005;</button>
                        </div>
                      }>
                      {tpl.description && <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 8 }}>{tpl.description}</div>}

                      {showAddTemplateStage === tpl.id && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 10, background: T.surfaceAlt, borderRadius: 6, marginBottom: 8 }}>
                          <div style={{ flex: 1 }}><label style={labelStyle}>Stage Name *</label><input style={inputStyle} value={newTemplateStage.stage_name} onChange={e => setNewTemplateStage(p => ({ ...p, stage_name: e.target.value }))} autoFocus /></div>
                          <div style={{ width: 120 }}><label style={labelStyle}>Duration (days)</label><input type="number" style={inputStyle} value={newTemplateStage.default_duration_days} onChange={e => setNewTemplateStage(p => ({ ...p, default_duration_days: e.target.value }))} /></div>
                          <Button primary onClick={() => addTemplateStage(tpl.id)}>Add</Button>
                          <Button onClick={() => setShowAddTemplateStage(null)}>Cancel</Button>
                        </div>
                      )}

                      {tplStages.length === 0 ? (
                        <div style={{ color: T.textMuted, fontSize: 13 }}>No stages in this template yet.</div>
                      ) : tplStages.map((s, si) => (
                        <div key={s.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                          background: T.surfaceAlt, borderRadius: 6, marginBottom: 4, border: `1px solid ${T.borderLight}`,
                        }}>
                          <span style={{ width: 22, height: 22, borderRadius: '50%', background: T.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{si + 1}</span>
                          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>{s.stage_name}</div>
                          <span style={{ fontSize: 11, color: T.textSecondary }}>{s.default_duration_days}d</span>
                          {templateMilestones.filter(m => m.template_stage_id === s.id).length > 0 && (
                            <Badge color={T.textMuted}>{templateMilestones.filter(m => m.template_stage_id === s.id).length} milestones</Badge>
                          )}
                        </div>
                      ))}
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
