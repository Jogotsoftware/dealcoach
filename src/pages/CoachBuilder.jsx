import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, TabBar, inputStyle, labelStyle } from '../components/Shared'

const STEPS = [
  { key: 'identity', label: '1. Identity' },
  { key: 'product', label: '2. Product & Market' },
  { key: 'icp', label: '3. ICP' },
  { key: 'personas', label: '4. Personas' },
  { key: 'signals', label: '5. Signals & Flags' },
  { key: 'call_types', label: '6. Call Types' },
  { key: 'methodology', label: '7. Methodology' },
  { key: 'scoring', label: '8. Scoring' },
  { key: 'tone', label: '9. Tone' },
  { key: 'notes', label: '10. Notes' },
  { key: 'review', label: '11. Review' },
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

const DEFAULT_CALL_TYPES = [
  { type: 'qdc', label: 'QDC (Qualify/Discover/Close)', purpose: 'Initial qualification call to assess fit, understand pain, and determine next steps.', enabled: true },
  { type: 'functional_discovery', label: 'Functional Discovery', purpose: 'Deep-dive into specific functional requirements, workflows, and technical needs.', enabled: true },
  { type: 'demo', label: 'Demo / Presentation', purpose: 'Product demonstration tailored to prospect needs and pain points identified in discovery.', enabled: true },
  { type: 'scoping', label: 'Scoping', purpose: 'Technical scoping session to define implementation requirements, integrations, and timeline.', enabled: true },
  { type: 'proposal', label: 'Proposal Review', purpose: 'Walk through pricing, terms, and proposal details. Address objections and negotiate.', enabled: true },
  { type: 'negotiation', label: 'Negotiation', purpose: 'Final terms negotiation, concession strategy, and closing mechanics.', enabled: true },
  { type: 'sync', label: 'Internal Sync', purpose: 'Internal team alignment on deal strategy, next steps, and resource needs.', enabled: false },
  { type: 'custom', label: 'Custom', purpose: 'Ad-hoc call type for situations not covered by standard types.', enabled: false },
]

export default function CoachBuilder() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState('identity')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [coach, setCoach] = useState(null)
  const [assembledPrompt, setAssembledPrompt] = useState('')

  // Step 1: Identity
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [temperature, setTemperature] = useState(0.1)

  // Step 2: Product & Market
  const [productContext, setProductContext] = useState('')
  const [valuePropositions, setValuePropositions] = useState('')
  const [industryContext, setIndustryContext] = useState('')
  const [competitorContext, setCompetitorContext] = useState('')

  // Step 3: ICP
  const [icpIndustries, setIcpIndustries] = useState([])
  const [icpGeographies, setIcpGeographies] = useState([])
  const [icpRevMin, setIcpRevMin] = useState('')
  const [icpRevMax, setIcpRevMax] = useState('')
  const [icpEmpMin, setIcpEmpMin] = useState('')
  const [icpEmpMax, setIcpEmpMax] = useState('')
  const [icpEntMin, setIcpEntMin] = useState('')
  const [icpEntMax, setIcpEntMax] = useState('')

  // Step 4: Personas
  const [personas, setPersonas] = useState([])

  // Step 5: Signals & Flags
  const [greenFlags, setGreenFlags] = useState([])
  const [redFlags, setRedFlags] = useState([])
  const [functionalGreenFlags, setFunctionalGreenFlags] = useState([])
  const [functionalRedFlags, setFunctionalRedFlags] = useState([])
  const [currentSystems, setCurrentSystems] = useState([])
  const [techRedFlags, setTechRedFlags] = useState([])
  const [buyingSignals, setBuyingSignals] = useState([])
  const [disqualifiers, setDisqualifiers] = useState([])

  // Step 6: Call Types
  const [callTypeDefinitions, setCallTypeDefinitions] = useState(DEFAULT_CALL_TYPES)

  // Step 7: Methodology
  const [methodologyAddons, setMethodologyAddons] = useState([])

  // Step 9: Tone
  const [coachingStyle, setCoachingStyle] = useState('direct')
  const [coachingStyleNotes, setCoachingStyleNotes] = useState('')

  // Step 10: Notes
  const [generalNotes, setGeneralNotes] = useState('')

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
      setValuePropositions(data.value_propositions || '')
      setIndustryContext(data.industry_context || '')
      setCompetitorContext(data.competitor_context || '')
      setCoachingStyle(data.coaching_style || 'direct')
      setCoachingStyleNotes(data.coaching_style_notes || '')
      setMethodologyAddons(data.selected_methodology_addons || [])
      setGeneralNotes(data.general_notes || '')
      if (Array.isArray(data.call_type_definitions) && data.call_type_definitions.length > 0) {
        setCallTypeDefinitions(data.call_type_definitions)
      }
    }
    // Load ICP
    if (data?.id) {
      const { data: icp } = await supabase.from('coach_icp').select('*').eq('coach_id', data.id).eq('active', true).limit(1).single()
      if (icp) {
        setIcpIndustries(icp.industries || [])
        setIcpGeographies(icp.geographies || [])
        setIcpRevMin(icp.revenue_min || '')
        setIcpRevMax(icp.revenue_max || '')
        setIcpEmpMin(icp.employee_min || '')
        setIcpEmpMax(icp.employee_max || '')
        setIcpEntMin(icp.entity_count_min || '')
        setIcpEntMax(icp.entity_count_max || '')
        setPersonas(icp.personas || [])
        setGreenFlags(icp.green_flags || [])
        setRedFlags(icp.red_flags || [])
        setFunctionalGreenFlags(icp.functional_green_flags || [])
        setFunctionalRedFlags(icp.functional_red_flags || [])
        setCurrentSystems(icp.current_systems || [])
        setTechRedFlags(icp.tech_red_flags || [])
        setBuyingSignals(icp.buying_signals || [])
        setDisqualifiers(icp.disqualifiers || [])
      }
    }
    setLoading(false)
  }

  async function saveStep() {
    if (!coach?.id) return
    setSaving(true)

    // Save coach fields
    await supabase.from('coaches').update({
      name, description, model, temperature,
      product_context: productContext, value_propositions: valuePropositions,
      industry_context: industryContext, competitor_context: competitorContext,
      coaching_style: coachingStyle, coaching_style_notes: coachingStyleNotes,
      selected_methodology_addons: methodologyAddons.length ? methodologyAddons : null,
      general_notes: generalNotes || null,
      call_type_definitions: callTypeDefinitions,
    }).eq('id', coach.id)

    // Save ICP fields
    const icpRecord = {
      coach_id: coach.id, name: 'Default ICP', active: true,
      industries: icpIndustries, geographies: icpGeographies,
      revenue_min: icpRevMin || null, revenue_max: icpRevMax || null,
      employee_min: icpEmpMin || null, employee_max: icpEmpMax || null,
      entity_count_min: icpEntMin || null, entity_count_max: icpEntMax || null,
      personas, green_flags: greenFlags, red_flags: redFlags,
      functional_green_flags: functionalGreenFlags, functional_red_flags: functionalRedFlags,
      current_systems: currentSystems, tech_red_flags: techRedFlags,
      buying_signals: buyingSignals, disqualifiers,
    }
    const { data: existingIcp } = await supabase.from('coach_icp').select('id').eq('coach_id', coach.id).eq('active', true).limit(1).single()
    if (existingIcp?.id) {
      await supabase.from('coach_icp').update(icpRecord).eq('id', existingIcp.id)
    } else {
      await supabase.from('coach_icp').insert(icpRecord)
    }

    setSaving(false)
  }

  async function loadAssembledPrompt() {
    if (!coach?.id) return
    const { data } = await supabase.rpc('assemble_coach_prompt', { p_coach_id: coach.id, p_call_type: 'qdc', p_action: 'process_transcript' })
    setAssembledPrompt(data || '')
  }

  useEffect(() => { if (step === 'review' && coach?.id) { saveStep().then(loadAssembledPrompt) } }, [step])

  function toggleAddon(id) { setMethodologyAddons(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]) }

  // Persona helpers
  function addPersona() {
    setPersonas(prev => [...prev, { title: '', role_in_decision: '', pain_points: '', priorities: '', objections: '' }])
  }
  function updatePersona(idx, field, value) {
    setPersonas(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }
  function removePersona(idx) {
    setPersonas(prev => prev.filter((_, i) => i !== idx))
  }

  // Call type helpers
  function updateCallType(idx, field, value) {
    setCallTypeDefinitions(prev => prev.map((ct, i) => i === idx ? { ...ct, [field]: value } : ct))
  }
  function addCallType() {
    setCallTypeDefinitions(prev => [...prev, { type: 'custom_' + Date.now(), label: '', purpose: '', enabled: true }])
  }
  function removeCallType(idx) {
    setCallTypeDefinitions(prev => prev.filter((_, i) => i !== idx))
  }

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

  const sectionHeader = (text) => (
    <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{text}</div>
  )

  const helperText = (text) => (
    <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>{text}</div>
  )

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

      <div style={{ padding: '16px 24px', maxWidth: 860 }}>
        {/* ═══ Step 1: Identity ═══ */}
        {step === 'identity' && (
          <Card title="Coach Identity">
            {helperText('Define who this coach is and how it operates. These settings control the AI engine behind your coaching.')}
            <div style={{ display: 'grid', gap: 12 }}>
              <div><label style={labelStyle}>Coach Name</label><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Revenue Instruments Coach" /></div>
              <div><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this coach specialize in? What type of deals, team, or motion?" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>AI Model</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={model} onChange={e => setModel(e.target.value)}><option value="claude-sonnet-4-20250514">Claude Sonnet 4</option><option value="claude-opus-4-20250514">Claude Opus 4</option><option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option></select></div>
                <div><label style={labelStyle}>Temperature ({temperature})</label><input type="range" min="0" max="1" step="0.05" value={temperature} onChange={e => setTemperature(Number(e.target.value))} style={{ width: '100%', accentColor: T.primary }} /><div style={{ fontSize: 10, color: T.textMuted }}>Lower = more consistent, Higher = more creative</div></div>
              </div>
            </div>
          </Card>
        )}

        {/* ═══ Step 2: Product & Market ═══ */}
        {step === 'product' && (
          <>
            <Card title="Product Context">
              {helperText('Help the AI understand what you sell. The more detail here, the better the coaching on value articulation, objection handling, and competitive positioning.')}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Product Description</label>
                <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical', fontFamily: T.mono, fontSize: 12 }} value={productContext} onChange={e => setProductContext(e.target.value)}
                  placeholder="What is your product/service? Key capabilities, modules, use cases.&#10;Example: 'SaaS accounting platform for mid-market companies with multi-entity consolidation, AP automation, and real-time reporting.'" />
              </div>
              <div>
                <label style={labelStyle}>Key Value Propositions</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: T.mono, fontSize: 12 }} value={valuePropositions} onChange={e => setValuePropositions(e.target.value)}
                  placeholder="What are the top 3-5 reasons customers buy from you?&#10;Example:&#10;- 50% faster month-end close vs legacy tools&#10;- Single platform replaces 3+ point solutions&#10;- Built-in compliance for SOX / GAAP / IFRS&#10;- Self-service reporting without IT dependency" />
              </div>
            </Card>
            <Card title="Market Context">
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Industry Context</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: T.mono, fontSize: 12 }} value={industryContext} onChange={e => setIndustryContext(e.target.value)}
                  placeholder="Target industries, typical deal complexity, average sales cycle length, buying process.&#10;Example: 'Mid-market manufacturing & distribution, 3-6 month cycles, committee buying, typically CFO + Controller + IT.'" />
              </div>
              <div>
                <label style={labelStyle}>Competitive Landscape</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: T.mono, fontSize: 12 }} value={competitorContext} onChange={e => setCompetitorContext(e.target.value)}
                  placeholder="Key competitors and how you position against them.&#10;Example:&#10;- vs NetSuite: We're easier to implement, better UX, lower TCO for <$500M companies&#10;- vs Sage Intacct: Stronger multi-entity, better AP automation&#10;- vs QuickBooks Enterprise: We scale past 10 entities, real consolidation" />
              </div>
            </Card>
          </>
        )}

        {/* ═══ Step 3: ICP ═══ */}
        {step === 'icp' && (
          <Card title="Ideal Customer Profile">
            {helperText('Define the firmographic characteristics of your ideal customer. This drives deal scoring and helps the AI assess whether a prospect is a good fit.')}

            {sectionHeader('Target Industries')}
            <TagInput label="Industries" value={icpIndustries} onChange={setIcpIndustries} placeholder="e.g. Manufacturing, Healthcare, Financial Services, Distribution..." />

            {sectionHeader('Target Geographies')}
            <TagInput label="Geographies" value={icpGeographies} onChange={setIcpGeographies} placeholder="e.g. US, Canada, UK, EMEA, APAC..." />

            {sectionHeader('Company Size')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={labelStyle}>Revenue Min ($)</label><input type="number" style={inputStyle} value={icpRevMin} onChange={e => setIcpRevMin(e.target.value)} placeholder="5000000" /></div>
              <div><label style={labelStyle}>Revenue Max ($)</label><input type="number" style={inputStyle} value={icpRevMax} onChange={e => setIcpRevMax(e.target.value)} placeholder="500000000" /></div>
              <div><label style={labelStyle}>Employee Min</label><input type="number" style={inputStyle} value={icpEmpMin} onChange={e => setIcpEmpMin(e.target.value)} placeholder="25" /></div>
              <div><label style={labelStyle}>Employee Max</label><input type="number" style={inputStyle} value={icpEmpMax} onChange={e => setIcpEmpMax(e.target.value)} placeholder="5000" /></div>
              <div><label style={labelStyle}>Entity Count Min</label><input type="number" style={inputStyle} value={icpEntMin} onChange={e => setIcpEntMin(e.target.value)} placeholder="2" /></div>
              <div><label style={labelStyle}>Entity Count Max</label><input type="number" style={inputStyle} value={icpEntMax} onChange={e => setIcpEntMax(e.target.value)} placeholder="50" /></div>
            </div>
          </Card>
        )}

        {/* ═══ Step 4: Personas ═══ */}
        {step === 'personas' && (
          <Card title="Buyer Personas">
            {helperText('Define the key buyer roles your reps engage with. The AI uses these to coach on stakeholder strategy, messaging by persona, and multi-threading.')}
            {personas.length === 0 && (
              <div style={{ textAlign: 'center', padding: 24, color: T.textMuted, fontSize: 13 }}>
                No personas defined yet. Add the key buyer roles your team sells to.
              </div>
            )}
            {personas.map((p, i) => (
              <div key={i} style={{ padding: 14, background: T.surfaceAlt, borderRadius: 8, border: `1px solid ${T.borderLight}`, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Persona {i + 1}</span>
                  <button onClick={() => removePersona(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&times;</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>Title / Role</label>
                    <input style={inputStyle} value={p.title} onChange={e => updatePersona(i, 'title', e.target.value)}
                      placeholder="e.g. CFO, VP Finance, Controller, IT Director" />
                  </div>
                  <div>
                    <label style={labelStyle}>Role in Decision</label>
                    <select style={{ ...inputStyle, cursor: 'pointer' }} value={p.role_in_decision} onChange={e => updatePersona(i, 'role_in_decision', e.target.value)}>
                      <option value="">Select...</option>
                      <option value="economic_buyer">Economic Buyer (signs the check)</option>
                      <option value="champion">Champion (internal advocate)</option>
                      <option value="technical_evaluator">Technical Evaluator</option>
                      <option value="end_user">End User</option>
                      <option value="influencer">Influencer</option>
                      <option value="blocker">Potential Blocker</option>
                      <option value="coach">Coach (guides you through their org)</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Key Pain Points</label>
                  <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontSize: 12 }} value={p.pain_points} onChange={e => updatePersona(i, 'pain_points', e.target.value)}
                    placeholder="What keeps this persona up at night? What problems do they care about most?" />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Priorities & Motivations</label>
                  <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontSize: 12 }} value={p.priorities} onChange={e => updatePersona(i, 'priorities', e.target.value)}
                    placeholder="What are their KPIs? What does success look like for them?" />
                </div>
                <div>
                  <label style={labelStyle}>Common Objections</label>
                  <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontSize: 12 }} value={p.objections} onChange={e => updatePersona(i, 'objections', e.target.value)}
                    placeholder="What pushback do you typically hear from this persona?" />
                </div>
              </div>
            ))}
            <Button onClick={addPersona} style={{ marginTop: 8 }}>+ Add Persona</Button>
          </Card>
        )}

        {/* ═══ Step 5: Signals & Flags ═══ */}
        {step === 'signals' && (
          <>
            <Card title="Business Signals">
              {helperText('Define the green flags and red flags the AI should watch for during deal coaching. These help the coach identify strong vs risky opportunities.')}

              {sectionHeader('Green Flags (Positive Indicators)')}
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Business signals that indicate a strong opportunity. The AI will highlight these when detected.</div>
              <TagInput label="Green Flags" value={greenFlags} onChange={setGreenFlags}
                placeholder="e.g. Executive sponsor identified, Pain tied to revenue, Active project underway, Budget approved..." />

              {sectionHeader('Red Flags (Risk Indicators)')}
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Warning signs that suggest a deal is at risk. The AI will flag these and coach the rep on mitigation.</div>
              <TagInput label="Red Flags" value={redFlags} onChange={setRedFlags}
                placeholder="e.g. No executive access, Unclear decision process, Competitor entrenched, No defined timeline..." />
            </Card>

            <Card title="Functional / Product Signals">
              {helperText('Define functionality-related indicators that signal good or bad fit with your product capabilities.')}

              {sectionHeader('Functional Green Flags')}
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Feature requirements or use cases where your product excels.</div>
              <TagInput label="Functional Green Flags" value={functionalGreenFlags} onChange={setFunctionalGreenFlags}
                placeholder="e.g. Multi-entity consolidation needed, AP automation required, Real-time reporting, Cloud migration planned..." />

              {sectionHeader('Functional Red Flags')}
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Requirements or expectations your product cannot meet or that indicate a poor fit.</div>
              <TagInput label="Functional Red Flags" value={functionalRedFlags} onChange={setFunctionalRedFlags}
                placeholder="e.g. Requires on-premise deployment, Needs payroll processing, Industry-specific compliance we don't support..." />
            </Card>

            <Card title="Technology & Behavioral Signals">
              {helperText('Systems they use and behavioral patterns that indicate buying intent or disqualification.')}

              {sectionHeader('Current Systems (Good Fit)')}
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Systems the prospect uses today that indicate they are a good fit for your product.</div>
              <TagInput label="Current Systems" value={currentSystems} onChange={setCurrentSystems}
                placeholder="e.g. QuickBooks, Xero, Sage 50, Great Plains..." />

              {sectionHeader('Tech Red Flags')}
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Systems that suggest the prospect is unlikely to buy or is not a good fit.</div>
              <TagInput label="Tech Red Flags" value={techRedFlags} onChange={setTechRedFlags}
                placeholder="e.g. SAP, Oracle EBS, Workday Financials (too large / just implemented)..." />

              {sectionHeader('Buying Signals')}
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Behavioral events that indicate a company is likely in a buying window.</div>
              <TagInput label="Buying Signals" value={buyingSignals} onChange={setBuyingSignals}
                placeholder="e.g. PE acquisition, New CFO hire, IPO preparation, Audit findings, System sunset announced..." />

              {sectionHeader('Disqualifiers')}
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Hard disqualifiers that mean the deal should not be pursued.</div>
              <TagInput label="Disqualifiers" value={disqualifiers} onChange={setDisqualifiers}
                placeholder="e.g. Government/public sector, Pre-revenue startup, <$1M revenue, Single entity only..." />
            </Card>
          </>
        )}

        {/* ═══ Step 6: Call Types ═══ */}
        {step === 'call_types' && (
          <Card title="Call Types & Purpose">
            {helperText('Define the types of calls your team runs and the purpose of each. This tells the AI how to coach differently based on where you are in the sales cycle.')}
            {callTypeDefinitions.map((ct, i) => (
              <div key={i} style={{
                padding: 14, background: ct.enabled ? T.surfaceAlt : T.surface, borderRadius: 8,
                border: `1px solid ${ct.enabled ? T.primaryBorder || T.border : T.borderLight}`,
                marginBottom: 8, opacity: ct.enabled ? 1 : 0.6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div onClick={() => updateCallType(i, 'enabled', !ct.enabled)}
                      style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer', background: ct.enabled ? T.success : T.borderLight, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                      <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: ct.enabled ? 18 : 2, boxShadow: T.shadow, transition: 'left 0.2s' }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{ct.type}</span>
                  </div>
                  {i >= 8 && (
                    <button onClick={() => removeCallType(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16 }}
                      onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&times;</button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Display Label</label>
                    <input style={inputStyle} value={ct.label} onChange={e => updateCallType(i, 'label', e.target.value)} placeholder="Call type name" />
                  </div>
                  <div>
                    <label style={labelStyle}>Purpose & Objectives</label>
                    <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontSize: 12 }} value={ct.purpose} onChange={e => updateCallType(i, 'purpose', e.target.value)}
                      placeholder="What is the goal of this call type? What should the rep achieve?" />
                  </div>
                </div>
              </div>
            ))}
            <Button onClick={addCallType} style={{ marginTop: 8 }}>+ Add Custom Call Type</Button>
          </Card>
        )}

        {/* ═══ Step 7: Methodology ═══ */}
        {step === 'methodology' && (
          <Card title="Sales Methodology">
            <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 8, border: `1px solid ${T.primaryBorder || T.border}`, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.primary }}>Revenue Instruments Framework</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: T.success, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Baseline (locked)</span>
              </div>
              <div style={{ fontSize: 12, color: T.textMuted }}>Seven pillars: Curiosity, Independently Wealthy, Continuous Qualification, Empathetic Listening, Outcome-Goal Alignment, Mutual Authoring, Buyer Risk Mitigation. Managed by Revenue Instruments -- not editable.</div>
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

        {/* ═══ Step 8: Scoring ═══ */}
        {step === 'scoring' && (
          <Card title="Scoring Configuration">
            {helperText('Configure how the AI evaluates deals and rep performance. Detailed scoring criteria can be edited in Coach Admin after the wizard.')}
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

        {/* ═══ Step 9: Tone & Style ═══ */}
        {step === 'tone' && (
          <Card title="Coaching Voice & Style">
            {helperText('How should the AI coach deliver feedback? This sets the personality and communication style of all coaching interactions.')}
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

        {/* ═══ Step 10: Notes & Context ═══ */}
        {step === 'notes' && (
          <Card title="General Notes & Context">
            {helperText('Add any additional context, comments, or instructions that should inform how this coach operates. This is a free-form space for anything not captured in other steps.')}
            <textarea style={{ ...inputStyle, minHeight: 200, resize: 'vertical', fontFamily: T.mono, fontSize: 12 }} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)}
              placeholder={`Use this space for anything the AI should know that doesn't fit elsewhere:

- Special deal dynamics or market conditions
- Team-specific coaching rules or exceptions
- Pricing nuances, discount authority, approval thresholds
- Common deal killers your team encounters
- Messaging guidelines or brand voice rules
- Specific questions reps should always ask
- Things the coach should NEVER say or recommend
- Internal jargon or acronyms the AI should understand
- Seasonal patterns, fiscal year considerations
- Partner/channel-specific instructions`} />
          </Card>
        )}

        {/* ═══ Step 11: Review ═══ */}
        {step === 'review' && (
          <>
            <Card title="Configuration Summary">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
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

              {/* ICP Summary */}
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>ICP Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 16 }}>
                <SummaryTag label="Industries" count={icpIndustries.length} />
                <SummaryTag label="Geographies" count={icpGeographies.length} />
                <SummaryTag label="Personas" count={personas.length} />
                <SummaryTag label="Green Flags" count={greenFlags.length} />
                <SummaryTag label="Red Flags" count={redFlags.length} />
                <SummaryTag label="Functional Green" count={functionalGreenFlags.length} />
                <SummaryTag label="Functional Red" count={functionalRedFlags.length} />
                <SummaryTag label="Buying Signals" count={buyingSignals.length} />
                <SummaryTag label="Disqualifiers" count={disqualifiers.length} />
              </div>

              {/* Call Types Summary */}
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Call Types</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {callTypeDefinitions.filter(ct => ct.enabled).map(ct => (
                  <span key={ct.type} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, background: T.primaryLight || 'rgba(93,173,226,0.1)', color: T.primary, fontWeight: 600 }}>{ct.label || ct.type}</span>
                ))}
              </div>

              {/* Completeness check */}
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Completeness</div>
              <div style={{ display: 'grid', gap: 4 }}>
                <CompletenessRow label="Product Context" done={!!productContext} />
                <CompletenessRow label="Value Propositions" done={!!valuePropositions} />
                <CompletenessRow label="Competitive Landscape" done={!!competitorContext} />
                <CompletenessRow label="Industry Context" done={!!industryContext} />
                <CompletenessRow label="ICP Industries" done={icpIndustries.length > 0} />
                <CompletenessRow label="Buyer Personas" done={personas.length > 0} />
                <CompletenessRow label="Green / Red Flags" done={greenFlags.length > 0 || redFlags.length > 0} />
                <CompletenessRow label="Functional Flags" done={functionalGreenFlags.length > 0 || functionalRedFlags.length > 0} />
                <CompletenessRow label="Call Types Configured" done={callTypeDefinitions.some(ct => ct.enabled && ct.purpose)} />
                <CompletenessRow label="General Notes" done={!!generalNotes} />
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

// ── Helper Components ──

function TagInput({ label, value, onChange, placeholder }) {
  const [input, setInput] = useState('')
  function addTag() {
    const tags = input.split(/[,\n]/).map(s => s.trim()).filter(s => s && !value.includes(s))
    if (tags.length) { onChange([...value, ...tags]); setInput('') }
  }
  return (
    <div style={{ marginBottom: 10 }}>
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

function SummaryTag({ label, count }) {
  return (
    <div style={{ padding: '6px 10px', background: count > 0 ? 'rgba(93,173,226,0.06)' : '#f8f8f8', borderRadius: 6, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid ' + (count > 0 ? 'rgba(93,173,226,0.2)' : '#eee') }}>
      <span style={{ color: '#555' }}>{label}</span>
      <span style={{ fontWeight: 700, color: count > 0 ? '#5DADE2' : '#ccc' }}>{count}</span>
    </div>
  )
}

function CompletenessRow({ label, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
      <span style={{ width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, background: done ? '#27ae60' : '#e0e0e0', color: '#fff', flexShrink: 0 }}>{done ? '\u2713' : ''}</span>
      <span style={{ color: done ? '#2c3e50' : '#999' }}>{label}</span>
    </div>
  )
}
