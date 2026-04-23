import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, TabBar, inputStyle, labelStyle } from '../components/Shared'

const STEPS = [
  { key: 'identity', label: '1. Identity' },
  { key: 'product', label: '2. Product' },
  { key: 'icp', label: '3. ICP' },
  { key: 'methodology', label: '4. Methodology' },
  { key: 'scoring', label: '5. Scoring' },
  { key: 'tone', label: '6. Tone' },
  { key: 'review', label: '7. Review' },
]

const VOICE_OPTIONS = [
  { key: 'direct', label: 'Direct', desc: 'Straight talk, no sugarcoating. "You missed the budget question."' },
  { key: 'empathetic', label: 'Empathetic', desc: 'Supportive first, constructive second. "Good rapport building — next time also explore budget."' },
  { key: 'socratic', label: 'Socratic', desc: 'Questions that lead to self-discovery. "What would have happened if you\'d asked about budget?"' },
  { key: 'data_driven', label: 'Data-Driven', desc: 'Score everything, quantify gaps. "Discovery depth: 4/10 — 3 qualifying questions missed."' },
]

const ADDON_METHODOLOGIES = [
  { id: 'bant', name: 'BANT', desc: 'Budget, Authority, Need, Timeline' },
  { id: 'meddpicc', name: 'MEDDPICC', desc: 'Metrics, Economic Buyer, Decision Criteria/Process, Paper Process, Identified Pain, Champion, Competition' },
  { id: 'challenger', name: 'Challenger Sale', desc: 'Teach, tailor, take control' },
  { id: 'spin', name: 'SPIN Selling', desc: 'Situation, Problem, Implication, Need-payoff' },
  { id: 'solution_selling', name: 'Solution Selling', desc: 'Pain chain, solution vision, compelling event' },
  { id: 'sandler', name: 'Sandler', desc: 'Up-front contracts, pain funnel, post-sell' },
  { id: 'jolt', name: 'JOLT Effect', desc: 'Judge indecision, Offer recommendation, Limit exploration, Take risk off table' },
  { id: 'command_message', name: 'Command of the Message', desc: 'Required capabilities, differentiation, PBOs' },
]

export default function CoachBuilder() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState('identity')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [coach, setCoach] = useState(null)
  const [assembledPrompt, setAssembledPrompt] = useState('')

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [temperature, setTemperature] = useState(0.1)
  const [productContext, setProductContext] = useState('')
  const [industryContext, setIndustryContext] = useState('')
  const [coachingStyle, setCoachingStyle] = useState('direct')
  const [coachingStyleNotes, setCoachingStyleNotes] = useState('')
  const [methodologyAddons, setMethodologyAddons] = useState([])
  const [icpIndustries, setIcpIndustries] = useState([])
  const [icpRevMin, setIcpRevMin] = useState('')
  const [icpRevMax, setIcpRevMax] = useState('')
  const [icpEmpMin, setIcpEmpMin] = useState('')
  const [icpEmpMax, setIcpEmpMax] = useState('')

  useEffect(() => { loadCoach() }, [])

  async function loadCoach() {
    setLoading(true)
    if (!profile?.active_coach_id) { setLoading(false); return }
    const { data } = await supabase.from('coaches').select('*').eq('id', profile.active_coach_id).single()
    if (data) {
      setCoach(data)
      setName(data.name || '')
      setDescription(data.description || '')
      setModel(data.model || 'claude-sonnet-4-20250514')
      setTemperature(data.temperature || 0.1)
      setProductContext(data.product_context || '')
      setIndustryContext(data.industry_context || '')
      setCoachingStyle(data.coaching_style || 'direct')
      setCoachingStyleNotes(data.coaching_style_notes || '')
      setMethodologyAddons(data.selected_methodology_addons || [])
    }
    // Load ICP
    if (data?.id) {
      const { data: icp } = await supabase.from('coach_icp').select('*').eq('coach_id', data.id).eq('active', true).limit(1).single()
      if (icp) {
        setIcpIndustries(icp.industries || [])
        setIcpRevMin(icp.revenue_min || '')
        setIcpRevMax(icp.revenue_max || '')
        setIcpEmpMin(icp.employee_min || '')
        setIcpEmpMax(icp.employee_max || '')
      }
    }
    setLoading(false)
  }

  async function saveStep() {
    if (!coach?.id) return
    setSaving(true)
    await supabase.from('coaches').update({
      name, description, model, temperature,
      product_context: productContext, industry_context: industryContext,
      coaching_style: coachingStyle, coaching_style_notes: coachingStyleNotes,
      selected_methodology_addons: methodologyAddons.length ? methodologyAddons : null,
    }).eq('id', coach.id)
    setSaving(false)
  }

  async function loadAssembledPrompt() {
    if (!coach?.id) return
    const { data } = await supabase.rpc('assemble_coach_prompt', { p_coach_id: coach.id, p_call_type: 'qdc', p_action: 'process_transcript' })
    setAssembledPrompt(data || '')
  }

  useEffect(() => { if (step === 'review' && coach?.id) { saveStep().then(loadAssembledPrompt) } }, [step])

  function toggleAddon(id) { setMethodologyAddons(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]) }

  const stepIdx = STEPS.findIndex(s => s.key === step)
  const nextStep = () => { saveStep(); if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1].key) }
  const prevStep = () => { if (stepIdx > 0) setStep(STEPS[stepIdx - 1].key) }

  if (loading) return <Spinner />
  if (!coach) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No active coach</div><div style={{ fontSize: 13 }}>Select a coach in Settings first.</div><Button primary onClick={() => navigate('/settings')} style={{ marginTop: 12 }}>Go to Settings</Button></div>

  const chipStyle = (active) => ({
    padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? T.primary : T.border}`,
    background: active ? T.primaryLight : 'transparent',
    color: active ? T.primary : T.textSecondary,
    transition: 'all 0.15s',
  })

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/coach')} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Coach Admin</button>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Coach Builder</h2>
          <Badge color={T.primary}>{coach.name}</Badge>
        </div>
      </div>

      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        <TabBar tabs={STEPS} active={step} onChange={setStep} />
      </div>

      <div style={{ padding: '16px 24px', maxWidth: 800 }}>
        {/* Step 1: Identity */}
        {step === 'identity' && (
          <Card title="Coach Identity">
            <div style={{ display: 'grid', gap: 12 }}>
              <div><label style={labelStyle}>Coach Name</label><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Revenue Instruments Coach" /></div>
              <div><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this coach specialize in?" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>AI Model</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={model} onChange={e => setModel(e.target.value)}><option value="claude-sonnet-4-20250514">Claude Sonnet 4</option><option value="claude-opus-4-20250514">Claude Opus 4</option><option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option></select></div>
                <div><label style={labelStyle}>Temperature ({temperature})</label><input type="range" min="0" max="1" step="0.05" value={temperature} onChange={e => setTemperature(Number(e.target.value))} style={{ width: '100%', accentColor: T.primary }} /></div>
              </div>
            </div>
          </Card>
        )}

        {/* Step 2: Product Context */}
        {step === 'product' && (
          <Card title="Product Context">
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>What does your company sell? This shapes how the AI coaches reps on value articulation and competitive positioning.</div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Product Description</label><textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical', fontFamily: T.mono, fontSize: 12 }} value={productContext} onChange={e => setProductContext(e.target.value)} placeholder="Product name, what it does, key capabilities, target buyer titles, common objections..." /></div>
            <div><label style={labelStyle}>Industry Context</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: T.mono, fontSize: 12 }} value={industryContext} onChange={e => setIndustryContext(e.target.value)} placeholder="Target industries, typical deal complexity, buying process..." /></div>
          </Card>
        )}

        {/* Step 3: ICP */}
        {step === 'icp' && (
          <Card title="Ideal Customer Profile">
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>Define your ideal customer so the AI can score deal fit and tailor coaching.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={labelStyle}>Revenue Min ($)</label><input type="number" style={inputStyle} value={icpRevMin} onChange={e => setIcpRevMin(e.target.value)} placeholder="5000000" /></div>
              <div><label style={labelStyle}>Revenue Max ($)</label><input type="number" style={inputStyle} value={icpRevMax} onChange={e => setIcpRevMax(e.target.value)} placeholder="500000000" /></div>
              <div><label style={labelStyle}>Employee Min</label><input type="number" style={inputStyle} value={icpEmpMin} onChange={e => setIcpEmpMin(e.target.value)} placeholder="25" /></div>
              <div><label style={labelStyle}>Employee Max</label><input type="number" style={inputStyle} value={icpEmpMax} onChange={e => setIcpEmpMax(e.target.value)} placeholder="5000" /></div>
            </div>
          </Card>
        )}

        {/* Step 4: Methodology */}
        {step === 'methodology' && (
          <Card title="Sales Methodology">
            <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 8, border: `1px solid ${T.primaryBorder}`, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.primary }}>Revenue Instruments Framework</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: T.success, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Baseline (locked)</span>
              </div>
              <div style={{ fontSize: 12, color: T.textMuted }}>Seven pillars: Curiosity, Independently Wealthy, Continuous Qualification, Empathetic Listening, Outcome-Goal Alignment, Mutual Authoring, Buyer Risk Mitigation. Managed by Revenue Instruments — not editable.</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 8 }}>Add-on Methodologies</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>Select additional frameworks to layer onto the baseline coaching approach.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ADDON_METHODOLOGIES.map(m => (
                <div key={m.id} onClick={() => toggleAddon(m.id)} style={chipStyle(methodologyAddons.includes(m.id))}>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{m.desc}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Step 5: Scoring */}
        {step === 'scoring' && (
          <Card title="Scoring Configuration">
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>Configure how the AI evaluates deals and rep performance. Detailed scoring criteria can be edited in Coach Admin after the wizard.</div>
            <div style={{ padding: 16, background: T.surfaceAlt, borderRadius: 8, fontSize: 13, color: T.text }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Default Scoring Categories</div>
              {['Product Fit (how well the prospect matches your ICP)', 'Deal Health (qualification strength, stakeholder access, timeline clarity)', 'Champion Strength (evidence of internal advocacy)'].map((s, i) => (
                <div key={i} style={{ padding: '6px 0', borderBottom: i < 2 ? `1px solid ${T.borderLight}` : 'none', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.success, flexShrink: 0 }} />
                  {s}
                </div>
              ))}
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>Edit weights and criteria in Coach Admin &rarr; Scoring tab.</div>
            </div>
          </Card>
        )}

        {/* Step 6: Tone & Style */}
        {step === 'tone' && (
          <Card title="Coaching Voice & Style">
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>How should the AI coach deliver feedback?</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {VOICE_OPTIONS.map(v => (
                <div key={v.key} onClick={() => setCoachingStyle(v.key)} style={{
                  padding: 14, borderRadius: 8, cursor: 'pointer',
                  border: `2px solid ${coachingStyle === v.key ? T.primary : T.border}`,
                  background: coachingStyle === v.key ? T.primaryLight : 'transparent',
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: coachingStyle === v.key ? T.primary : T.text }}>{v.label}</div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{v.desc}</div>
                </div>
              ))}
            </div>
            <div><label style={labelStyle}>Additional Style Notes</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={coachingStyleNotes} onChange={e => setCoachingStyleNotes(e.target.value)} placeholder="Phrases to use, things to avoid, specific coaching preferences..." /></div>
          </Card>
        )}

        {/* Step 7: Review */}
        {step === 'review' && (
          <>
            <Card title="Configuration Summary">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[
                  ['Coach', name],
                  ['Model', model],
                  ['Temperature', temperature],
                  ['Voice', VOICE_OPTIONS.find(v => v.key === coachingStyle)?.label || coachingStyle],
                  ['Methodology Add-ons', methodologyAddons.length ? methodologyAddons.join(', ') : 'None'],
                  ['Product', productContext?.substring(0, 60) + (productContext?.length > 60 ? '...' : '') || '--'],
                ].map(([k, v]) => (
                  <div key={k} style={{ padding: '8px 10px', background: T.surfaceAlt, borderRadius: 6, fontSize: 12 }}>
                    <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>{k}</div>
                    <div style={{ fontWeight: 600, color: T.text }}>{v}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Assembled Prompt Preview">
              {assembledPrompt ? (
                <div style={{ maxHeight: 400, overflow: 'auto' }}>
                  {assembledPrompt.split(/(?==== )/g).map((section, i) => {
                    const isLocked = section.includes('(locked)') || section.includes('PLATFORM CORE') || section.includes('METHODOLOGY')
                    return (
                      <div key={i} style={{ marginBottom: 12 }}>
                        {isLocked && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.textMuted, marginBottom: 4, display: 'inline-block' }}>Managed by Revenue Instruments</span>}
                        <pre style={{ fontSize: 11, fontFamily: T.mono, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: isLocked ? T.surfaceAlt : 'transparent', padding: isLocked ? 10 : 0, borderRadius: 4, color: T.text, margin: 0 }}>{section}</pre>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 20 }}><Spinner /><div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>Loading assembled prompt...</div></div>
              )}
            </Card>
          </>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <Button onClick={prevStep} disabled={stepIdx === 0}>Back</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            {saving && <span style={{ fontSize: 12, color: T.textMuted, alignSelf: 'center' }}>Saving...</span>}
            {stepIdx < STEPS.length - 1 ? (
              <Button primary onClick={nextStep}>Continue</Button>
            ) : (
              <Button primary onClick={() => { saveStep(); navigate('/coach') }}>Save & Close</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
