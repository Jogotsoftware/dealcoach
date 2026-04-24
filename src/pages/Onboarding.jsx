import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Button, inputStyle, labelStyle } from '../components/Shared'

const METHODOLOGIES = [
  { id: 'rif', name: 'Revenue Instruments Framework', desc: 'Discovery-first, signal-driven, AI-coached. Seven pillars: Curiosity, Independently Wealthy, Continuous Qualification, Empathetic Listening, Outcome-Goal Alignment, Mutual Authoring, Buyer Risk Mitigation.', is_recommended: true },
  { id: 'bant', name: 'BANT', desc: 'Budget, Authority, Need, Timeline — classic qualification' },
  { id: 'meddpicc', name: 'MEDDPICC', desc: 'Metrics, Economic Buyer, Decision Criteria, Decision Process, Paper Process, Identified Pain, Champion, Competition' },
  { id: 'challenger', name: 'Challenger Sale', desc: 'Teach, tailor, take control (Dixon & Adamson)' },
  { id: 'spin', name: 'SPIN Selling', desc: 'Situation, Problem, Implication, Need-payoff (Rackham)' },
  { id: 'solution_selling', name: 'Solution Selling', desc: 'Pain chain, solution vision, compelling event (Bosworth)' },
  { id: 'sandler', name: 'Sandler', desc: 'Up-front contracts, pain funnel, post-sell (Sandler)' },
  { id: 'jolt', name: 'JOLT Effect', desc: 'Judge indecision, Offer recommendation, Limit exploration, Take risk off the table (Dixon & McKenna)' },
  { id: 'command_message', name: 'Command of the Message', desc: 'Required capabilities, differentiation, PBOs (Force Management)' },
]

const FY_PRESETS = [
  { month: 12, day: 31, label: 'Dec 31 (Calendar Year)' },
  { month: 6, day: 30, label: 'Jun 30' },
  { month: 9, day: 30, label: 'Sep 30' },
  { month: 3, day: 31, label: 'Mar 31' },
]
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const INDUSTRIES = ['SaaS / Technology', 'Financial Services', 'Healthcare', 'Manufacturing', 'Professional Services', 'Retail / E-Commerce', 'Real Estate', 'Nonprofit', 'Education', 'Construction', 'Distribution', 'Hospitality']
const COMPANY_SIZES = ['1-50', '51-200', '201-1000', '1000-5000', '5000+']
const REVENUE_RANGES = ['< $5M', '$5M-$25M', '$25M-$100M', '$100M-$500M', '$500M+']

const STEP_NAMES = ['Company', 'Product', 'Your market', 'Wins & losses', 'Your buyers', 'How you sell', 'Review']
const STEP_TITLES = [
  { title: 'Tell us about your company',
    subtitle: "We'll research your market so your AI coach starts with context on your competitive landscape and buyers." },
  { title: 'What do you sell?',
    subtitle: 'This shapes how your coach frames discovery and defines what a qualified deal looks like.' },
  { title: "Who's your ideal customer?",
    subtitle: "The clearer this is, the better your coach spots fit signals and flags deals that don't belong in your pipeline." },
  { title: 'What separates your best deals from your worst?',
    subtitle: 'Your coach watches for these patterns in every call and surfaces them as red and green flags.' },
  { title: 'Who do you actually sell to?',
    subtitle: "Understanding your buyers helps the AI know whose voice matters most on a call and what drives their decisions." },
  { title: "What's your sales methodology?",
    subtitle: 'Your coach uses these frameworks to evaluate calls and give targeted coaching at every stage.' },
  { title: 'Ready to launch.',
    subtitle: "Here's what we'll configure. You can change any of this in Settings after launch." },
]

const PROCESSING_MESSAGES = [
  'Researching your market...',
  'Analyzing your competitive landscape...',
  'Identifying your ideal buyers...',
  'Building your AI coach...',
  'Applying your methodology...',
  'Configuring your workspace...',
  'Almost there...',
]

const SHADOW_LG = '0 10px 40px rgba(0,0,0,0.08)'

function StepIndicator({ current, total, currentName }) {
  // current is 1..total; 0 means welcome (no indicator)
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {Array.from({ length: total }).map((_, i) => {
          const stepNum = i + 1
          const isCompleted = stepNum < current
          const isCurrent = stepNum === current
          const circleBg = isCompleted ? T.primary : isCurrent ? '#fff' : '#f3f4f6'
          const circleBorder = isCompleted ? 'none' : isCurrent ? `2px solid ${T.primary}` : `1px solid ${T.border}`
          const circleColor = isCompleted ? '#fff' : isCurrent ? T.primary : T.textMuted
          const circleFontWeight = isCurrent ? 700 : 500
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i === total - 1 ? 'none' : 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: circleBg, border: circleBorder,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: circleFontWeight, color: circleColor,
                flexShrink: 0, transition: 'background 0.3s ease, border-color 0.3s ease, color 0.3s ease',
              }}>
                {isCompleted ? '✓' : stepNum}
              </div>
              {i < total - 1 && (
                <div style={{
                  flex: 1, height: 2,
                  background: isCompleted ? T.primary : T.border,
                  transition: 'background 0.4s ease',
                }} />
              )}
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 11, color: T.textMuted, textAlign: 'center', marginTop: 8 }}>
        {currentName} · Step {current} of {total}
      </div>
    </div>
  )
}

function Wordmark() {
  return (
    <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 16, letterSpacing: '-0.01em', textAlign: 'center' }}>
      Revenue Instruments
    </div>
  )
}

export default function Onboarding() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('token')
  const inviteId = searchParams.get('invite')

  const [step, setStep] = useState(0) // 0=welcome, 1..7 wizard, 8=processing
  const goingBackRef = useRef(false)
  const [renderKey, setRenderKey] = useState(0)
  const [inviterName, setInviterName] = useState('')
  const [inviterFirstName, setInviterFirstName] = useState('')
  const [error, setError] = useState(null)

  // processing state
  const [procMessageIdx, setProcMessageIdx] = useState(0)
  const [procMessageFading, setProcMessageFading] = useState(false)
  const [procProgress, setProcProgress] = useState(5)
  const [procDone, setProcDone] = useState(false)
  const [procError, setProcError] = useState(null)

  // invite code input toggle on welcome screen
  const [showInviteCodeInput, setShowInviteCodeInput] = useState(false)
  const [inviteCode, setInviteCode] = useState(inviteToken || '')

  // Form state
  const [orgName, setOrgName] = useState('')
  const [website, setWebsite] = useState('')
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [methodologies, setMethodologies] = useState(['rif'])
  const [fyEndMonth, setFyEndMonth] = useState(12)
  const [fyEndDay, setFyEndDay] = useState(31)
  const [fyCustom, setFyCustom] = useState(false)
  const [icpIndustries, setIcpIndustries] = useState([])
  const [icpSizes, setIcpSizes] = useState([])
  const [icpRevenue, setIcpRevenue] = useState([])
  const [teamSize, setTeamSize] = useState('2-5')

  const [dealSize, setDealSize] = useState('')
  const [salesCycle, setSalesCycle] = useState('')
  const [primaryBuyer, setPrimaryBuyer] = useState('')
  const [geographies, setGeographies] = useState([])
  const [competitors, setCompetitors] = useState(['', '', ''])
  const [valueProps, setValueProps] = useState('')
  const [greenFlagsText, setGreenFlagsText] = useState('')
  const [redFlagsText, setRedFlagsText] = useState('')
  const [objectionsText, setObjectionsText] = useState('')
  const [personas, setPersonas] = useState([{ title: '', role_in_decision: '', pain_points: '', priorities: '' }])

  // Redirect if already has org (shouldn't be here)
  useEffect(() => {
    if (profile?.org_id && step !== 8 && !procDone) navigate('/', { replace: true })
  }, [profile?.org_id])

  // On mount: look up the inviter for a personalised welcome
  useEffect(() => {
    if (!user?.email) return
    supabase
      .from('invitations')
      .select('inviter:profiles!invitations_invited_by_fkey(full_name)')
      .eq('email', user.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const name = data?.inviter?.full_name || ''
        setInviterName(name)
        if (name) setInviterFirstName(name.split(' ')[0])
      })
  }, [user?.email])

  // Pre-fill org name from accepted invitation (new_instance flow)
  useEffect(() => {
    if (!inviteId) return
    supabase.from('invitations').select('email, invited_name, personal_message').eq('id', inviteId).single()
      .then(({ data: inv }) => {
        if (!inv?.personal_message) return
        const match = inv.personal_message.match(/set up Revenue Instruments for (.+?)\./)
        if (match && !orgName) setOrgName(match[1])
      })
  }, [inviteId])

  function go(nextStep) {
    goingBackRef.current = nextStep < step
    setStep(nextStep)
    setRenderKey(k => k + 1)
  }

  async function lookupInvite() {
    if (!inviteCode.trim()) return
    setError(null)
    const { data } = await supabase.from('invitations').select('*, organizations(name)').eq('token', inviteCode.trim()).eq('status', 'pending').maybeSingle()
    if (data && (!data.expires_at || new Date(data.expires_at) > new Date())) {
      // Hand off to AcceptInvite which handles the join flow end-to-end
      navigate(`/invite/${inviteCode.trim()}`)
    } else {
      setError('Invalid or expired invitation code.')
    }
  }

  async function launchOrg() {
    if (!orgName.trim()) return
    setError(null)
    setProcError(null)
    setProcProgress(5)
    setProcDone(false)
    setProcMessageIdx(0)
    go(8)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onboard-organization`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            user_id: user.id,
            companyName: orgName,
            website,
            productName: productName || orgName,
            productDescription: productDesc,
            methodologies,
            icpIndustries,
            icpCompanySizes: icpSizes,
            icpRevenueRanges: icpRevenue,
            icpGeographies: geographies,
            coachingStyle: 'independently_wealthy',
            teamSize,
            fiscalYearEndMonth: fyEndMonth,
            fiscalYearEndDay: fyEndDay,
            dealSize, salesCycle, primaryBuyer,
            competitors: competitors.filter(c => c && c.trim()),
            valuePropositions: valueProps,
            greenFlags: greenFlagsText.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
            redFlags: redFlagsText.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
            objections: objectionsText,
            personas: personas.filter(p => p.title?.trim()),
            stages: [
              { id: 'qualify', name: 'Qualify', active: true },
              { id: 'discovery', name: 'Discovery', active: true },
              { id: 'solution_validation', name: 'Solution Validation', active: true },
              { id: 'confirming_value', name: 'Confirming Value', active: true },
              { id: 'selection', name: 'Selection', active: true },
            ],
            callTypes: [
              { id: 'qdc', name: 'QDC', active: true },
              { id: 'functional_discovery', name: 'Functional Discovery', active: true },
              { id: 'demo', name: 'Demo', active: true },
              { id: 'scoping', name: 'Scoping', active: true },
              { id: 'proposal', name: 'Proposal', active: true },
              { id: 'negotiation', name: 'Negotiation', active: true },
              { id: 'sync', name: 'Sync', active: true },
            ],
            scoreCategories: [
              { id: 'fit', name: 'Product Fit', active: true, details: {} },
              { id: 'deal_health', name: 'Deal Health', active: true, details: {} },
              { id: 'champion', name: 'Champion Strength', active: true, details: {} },
            ],
            teamMembers: [],
          }),
        }
      )
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      if (data.org_id) {
        const orgUpdates = { fiscal_year_end_month: fyEndMonth, fiscal_year_end_day: fyEndDay }
        const { data: freePlan } = await supabase.from('plans').select('id').eq('slug', 'free').single()
        if (freePlan) orgUpdates.plan_id = freePlan.id
        await supabase.from('organizations').update(orgUpdates).eq('id', data.org_id)

        if (data.coach_id) {
          const extras = methodologies.filter(m => m !== 'rif')
          const coachUpdate = {}
          if (extras.length) coachUpdate.methodology_extras = extras
          if (valueProps?.trim()) coachUpdate.value_propositions = valueProps.trim()
          const competitorList = competitors.filter(c => c && c.trim())
          if (competitorList.length) coachUpdate.competitor_context = competitorList.join('\n')
          if (objectionsText?.trim()) {
            coachUpdate.general_notes = `Common objections encountered:\n${objectionsText.trim()}`
          }
          if (Object.keys(coachUpdate).length) {
            await supabase.from('coaches').update(coachUpdate).eq('id', data.coach_id)
          }

          const filledPersonas = personas.filter(p => p.title?.trim())
          const greens = greenFlagsText.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
          const reds = redFlagsText.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
          if (filledPersonas.length || greens.length || reds.length) {
            const { data: existingIcp } = await supabase.from('coach_icp').select('id').eq('coach_id', data.coach_id).eq('active', true).limit(1).maybeSingle()
            const icpPatch = {
              ...(filledPersonas.length ? { personas: filledPersonas } : {}),
              ...(greens.length ? { green_flags: greens } : {}),
              ...(reds.length ? { red_flags: reds } : {}),
            }
            if (existingIcp?.id) {
              await supabase.from('coach_icp').update(icpPatch).eq('id', existingIcp.id)
            } else {
              await supabase.from('coach_icp').insert({ coach_id: data.coach_id, name: 'Default ICP', active: true, ...icpPatch })
            }
          }
        }
      }

      setProcProgress(100)
      setTimeout(() => {
        setProcDone(true)
        setTimeout(() => {
          navigate('/', { replace: true })
        }, 900)
      }, 350)
    } catch (err) {
      setProcError(err.message)
    }
  }

  // Processing: cycle message every 3.5s with 250ms fade
  useEffect(() => {
    if (step !== 8 || procDone || procError) return
    const interval = setInterval(() => {
      setProcMessageFading(true)
      setTimeout(() => {
        setProcMessageIdx(i => Math.min(i + 1, PROCESSING_MESSAGES.length - 1))
        setProcMessageFading(false)
      }, 250)
    }, 3500)
    return () => clearInterval(interval)
  }, [step, procDone, procError])

  // Processing: bump progress 2% every 2s, cap at 90 until real completion
  useEffect(() => {
    if (step !== 8 || procDone || procError) return
    const interval = setInterval(() => {
      setProcProgress(p => Math.min(p + 2, 90))
    }, 2000)
    return () => clearInterval(interval)
  }, [step, procDone, procError])

  const chipStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (active ? T.primary : T.border),
    background: active ? T.primaryLight : 'transparent', color: active ? T.primary : T.textSecondary, transition: 'all 0.15s', userSelect: 'none',
  })

  function toggleArr(arr, setArr, val) { setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]) }

  // ─── PROCESSING SCREEN (step 8, full viewport) ───
  if (step === 8) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-between',
        background: '#fff', fontFamily: T.font, padding: '40px 24px',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>
          Revenue Instruments
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          {/* Ripple */}
          <div style={{ position: 'relative', width: 64, height: 64 }}>
            <div style={{
              position: 'absolute', inset: 0, width: 64, height: 64, borderRadius: '50%',
              background: procDone ? T.success : T.primary,
              transition: 'background 0.3s ease, opacity 0.3s ease',
              opacity: procDone ? 1 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {procDone && <span style={{ color: '#fff', fontSize: 32, fontWeight: 300 }}>{'✓'}</span>}
            </div>
            {!procDone && !procError && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: `2.5px solid ${T.primary}`,
                animation: 'ripple 1.6s ease-out infinite',
              }} />
            )}
          </div>

          {/* Status message */}
          <div style={{
            fontSize: 16, fontWeight: 600, color: T.text, textAlign: 'center',
            maxWidth: 280, minHeight: 22,
            opacity: procMessageFading ? 0 : 1, transition: 'opacity 250ms ease',
          }}>
            {procError
              ? 'Something went wrong.'
              : procDone
                ? 'Your workspace is ready.'
                : PROCESSING_MESSAGES[procMessageIdx]}
          </div>

          {/* Progress bar */}
          <div style={{ width: 260, height: 4, background: T.border, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${procProgress}%`, height: '100%',
              background: procError ? T.error : T.primary,
              borderRadius: 2, transition: 'width 0.9s ease, background 0.3s ease',
            }} />
          </div>

          <div style={{ fontSize: 12, color: T.textMuted }}>
            {procError ? procError : 'Usually takes 20–30 seconds'}
          </div>

          {procError && (
            <button onClick={() => go(7)} style={secondaryBtn}>Back to review</button>
          )}
        </div>

        <div style={{ height: 20 }} />
      </div>
    )
  }

  // ─── CARDED FLOW ───
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '40px 24px',
      background: '#fff', fontFamily: T.font,
    }}>
      <Wordmark />
      <div style={{
        width: '100%', maxWidth: 560, background: '#fff',
        borderRadius: 12, boxShadow: SHADOW_LG, padding: 40,
      }}>
        {step >= 1 && step <= 7 && (
          <StepIndicator current={step} total={7} currentName={STEP_NAMES[step - 1]} />
        )}

        <div key={renderKey} style={{ animation: `${goingBackRef.current ? 'stepBack' : 'stepIn'} 0.22s ease` }}>
          {step === 0 && (
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 700, color: T.text, margin: 0, marginBottom: 12, letterSpacing: '-0.01em' }}>
                {inviterFirstName
                  ? `Welcome, ${(profile?.full_name || user?.email?.split('@')[0] || '').split(' ')[0] || 'there'}.`
                  : "Let's set up your workspace."}
              </h1>
              <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.6, marginBottom: 10 }}>
                {inviterFirstName
                  ? "Let's get your workspace ready. A few quick questions and your AI coach will understand your market from day one."
                  : "A few quick questions and you'll be ready to start tracking deals with AI context that gets smarter every call."}
              </p>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 24 }}>About 3 minutes</div>
              <button onClick={() => go(1)} style={primaryBtn}>Get started →</button>
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                {!showInviteCodeInput ? (
                  <button onClick={() => setShowInviteCodeInput(true)}
                    style={{ background: 'none', border: 'none', color: T.primary, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
                    Have an invite code?
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input style={{ ...inputStyle, flex: 1 }} placeholder="Paste invite code..." value={inviteCode}
                      onChange={e => setInviteCode(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && lookupInvite()} autoFocus />
                    <Button primary onClick={lookupInvite}>Use code</Button>
                  </div>
                )}
                {error && <div style={{ color: T.error, fontSize: 12, marginTop: 8 }}>{error}</div>}
              </div>
            </div>
          )}

          {step >= 1 && step <= 7 && (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0, marginBottom: 8, letterSpacing: '-0.01em' }}>
                {STEP_TITLES[step - 1].title}
              </h2>
              <p style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.6, marginBottom: 20 }}>
                {STEP_TITLES[step - 1].subtitle}
              </p>
            </>
          )}

          {step === 1 && (
            <>
              <div style={{ marginBottom: 12 }}><label style={labelStyle}>Company Name *</label><input style={inputStyle} value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Company name" autoFocus /></div>
              <div style={{ marginBottom: 12 }}><label style={labelStyle}>Website</label><input style={inputStyle} value={website} onChange={e => setWebsite(e.target.value)} placeholder="yourcompany.com" /></div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Target Industries</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {INDUSTRIES.map(i => <span key={i} onClick={() => toggleArr(icpIndustries, setIcpIndustries, i)} style={chipStyle(icpIndustries.includes(i))}>{i}</span>)}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Target Company Size</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {COMPANY_SIZES.map(s => <span key={s} onClick={() => toggleArr(icpSizes, setIcpSizes, s)} style={chipStyle(icpSizes.includes(s))}>{s}</span>)}
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Target Revenue</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {REVENUE_RANGES.map(r => <span key={r} onClick={() => toggleArr(icpRevenue, setIcpRevenue, r)} style={chipStyle(icpRevenue.includes(r))}>{r}</span>)}
                </div>
              </div>
              <StepFooter onBack={() => go(0)} onContinue={() => go(2)} continueDisabled={!orgName.trim()} />
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ marginBottom: 12 }}><label style={labelStyle}>Product Name</label><input style={inputStyle} value={productName} onChange={e => setProductName(e.target.value)} placeholder="Product name" autoFocus /></div>
              <div style={{ marginBottom: 12 }}><label style={labelStyle}>One-line description</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={productDesc} onChange={e => setProductDesc(e.target.value)} placeholder="What does it do, in one sentence?" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Average deal size</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={dealSize} onChange={e => setDealSize(e.target.value)}>
                    <option value="">Select...</option>
                    {['< $10K', '$10K-$50K', '$50K-$250K', '$250K+'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Average sales cycle</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={salesCycle} onChange={e => setSalesCycle(e.target.value)}>
                    <option value="">Select...</option>
                    {['< 1 month', '1-3 months', '3-6 months', '6+ months'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Primary buyer title</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['CFO', 'VP Finance', 'CEO', 'Operations', 'IT', 'Other'].map(b => <span key={b} onClick={() => setPrimaryBuyer(b)} style={chipStyle(primaryBuyer === b)}>{b}</span>)}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Team size</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={teamSize} onChange={e => setTeamSize(e.target.value)}>
                  {['1', '2-5', '6-15', '16-50', '50+'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Fiscal year end</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {FY_PRESETS.map(p => {
                    const active = !fyCustom && fyEndMonth === p.month && fyEndDay === p.day
                    return <span key={p.label} onClick={() => { setFyEndMonth(p.month); setFyEndDay(p.day); setFyCustom(false) }} style={chipStyle(active)}>{p.label}</span>
                  })}
                  <span onClick={() => setFyCustom(true)} style={chipStyle(fyCustom)}>Custom</span>
                </div>
                {fyCustom && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select style={{ ...inputStyle, cursor: 'pointer', flex: 1 }} value={fyEndMonth} onChange={e => { const m = Number(e.target.value); setFyEndMonth(m); if (fyEndDay > DAYS_IN_MONTH[m - 1]) setFyEndDay(DAYS_IN_MONTH[m - 1]) }}>
                      {MONTH_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                    </select>
                    <select style={{ ...inputStyle, cursor: 'pointer', width: 70 }} value={fyEndDay} onChange={e => setFyEndDay(Number(e.target.value))}>
                      {Array.from({ length: DAYS_IN_MONTH[fyEndMonth - 1] }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <StepFooter onBack={() => go(1)} onContinue={() => go(3)} />
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Target geographies</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['US', 'Canada', 'UK', 'EMEA', 'APAC', 'LATAM', 'Global'].map(g => <span key={g} onClick={() => toggleArr(geographies, setGeographies, g)} style={chipStyle(geographies.includes(g))}>{g}</span>)}
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Primary competitors (up to 3)</label>
                {competitors.map((c, i) => (
                  <input key={i} style={{ ...inputStyle, marginBottom: 6 }} value={c} onChange={e => setCompetitors(prev => prev.map((v, j) => j === i ? e.target.value : v))} placeholder={`Competitor ${i + 1}`} />
                ))}
              </div>
              <StepFooter onBack={() => go(2)} onContinue={() => go(4)} />
            </>
          )}

          {step === 4 && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Top 3 value propositions</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={valueProps} onChange={e => setValueProps(e.target.value)} placeholder={`e.g.\n- 50% faster close process vs legacy tools\n- Single platform replaces 3+ point solutions\n- Built-in compliance for SOX / GAAP`} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Signs of a good-fit deal (green flags)</label>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={greenFlagsText} onChange={e => setGreenFlagsText(e.target.value)} placeholder="Comma or newline separated. e.g. Executive sponsor identified, Budget approved, Compelling event with deadline" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Signs of a bad-fit deal (red flags)</label>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={redFlagsText} onChange={e => setRedFlagsText(e.target.value)} placeholder="Comma or newline separated. e.g. No executive access, Unclear decision process, Competitor entrenched" />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Common objections</label>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={objectionsText} onChange={e => setObjectionsText(e.target.value)} placeholder="e.g. 'Too expensive', 'Locked into our current vendor', 'Not a priority this quarter'" />
              </div>
              <StepFooter onBack={() => go(3)} onContinue={() => go(5)} />
            </>
          )}

          {step === 5 && (
            <>
              {personas.map((p, i) => (
                <div key={i} style={{ padding: 12, background: T.surfaceAlt, borderRadius: 8, border: `1px solid ${T.border}`, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Persona {i + 1}</span>
                    {personas.length > 1 && (
                      <button onClick={() => setPersonas(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}>{'×'}</button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <input style={inputStyle} value={p.title} onChange={e => setPersonas(prev => prev.map((v, j) => j === i ? { ...v, title: e.target.value } : v))} placeholder="Title (e.g. CFO)" />
                    <select style={{ ...inputStyle, cursor: 'pointer' }} value={p.role_in_decision} onChange={e => setPersonas(prev => prev.map((v, j) => j === i ? { ...v, role_in_decision: e.target.value } : v))}>
                      <option value="">Role in decision...</option>
                      <option value="economic_buyer">Economic Buyer</option>
                      <option value="champion">Champion</option>
                      <option value="technical_evaluator">Technical Evaluator</option>
                      <option value="end_user">End User</option>
                      <option value="influencer">Influencer</option>
                    </select>
                  </div>
                  <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', marginBottom: 6, fontSize: 12 }} value={p.pain_points} onChange={e => setPersonas(prev => prev.map((v, j) => j === i ? { ...v, pain_points: e.target.value } : v))} placeholder="Their pain points..." />
                  <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontSize: 12 }} value={p.priorities} onChange={e => setPersonas(prev => prev.map((v, j) => j === i ? { ...v, priorities: e.target.value } : v))} placeholder="Their priorities / KPIs..." />
                </div>
              ))}
              {personas.length < 3 && (
                <Button onClick={() => setPersonas(prev => [...prev, { title: '', role_in_decision: '', pain_points: '', priorities: '' }])} style={{ marginBottom: 12 }}>+ Add persona</Button>
              )}
              <StepFooter onBack={() => go(4)} onContinue={() => go(6)} continueDisabled={!personas.some(p => p.title?.trim())} />
            </>
          )}

          {step === 6 && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {METHODOLOGIES.map(m => {
                  const active = methodologies.includes(m.id)
                  return (
                    <div key={m.id} onClick={() => toggleArr(methodologies, setMethodologies, m.id)} style={{
                      padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                      border: m.is_recommended ? `2px solid ${active ? T.primary : T.primaryBorder}` : `1px solid ${active ? T.primary : T.border}`,
                      background: active ? T.primaryLight : m.is_recommended ? 'rgba(93,173,226,0.03)' : 'transparent',
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: active ? T.primary : T.text, flex: 1 }}>{m.name}</div>
                        {m.is_recommended && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: T.success + '18', color: T.success, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended</span>}
                      </div>
                      <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{m.desc}</div>
                    </div>
                  )
                })}
              </div>
              <StepFooter onBack={() => go(5)} onContinue={() => go(7)} continueDisabled={!methodologies.length} />
            </>
          )}

          {step === 7 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[
                  ['Company', orgName],
                  ['Website', website || '—'],
                  ['Product', productName || orgName],
                  ['Deal size', dealSize || '—'],
                  ['Sales cycle', salesCycle || '—'],
                  ['Primary buyer', primaryBuyer || '—'],
                  ['Team size', teamSize],
                  ['Industries', icpIndustries.join(', ') || 'Any'],
                  ['Geographies', geographies.join(', ') || '—'],
                  ['Competitors', competitors.filter(c => c?.trim()).join(', ') || '—'],
                  ['Personas', personas.filter(p => p.title?.trim()).map(p => p.title).join(', ') || '—'],
                  ['Fiscal year end', `${MONTH_NAMES[fyEndMonth - 1]} ${fyEndDay}`],
                  ['Methodologies', methodologies.map(id => METHODOLOGIES.find(m => m.id === id)?.name).join(', ')],
                ].map(([k, v]) => (
                  <div key={k} style={{ padding: '10px 12px', background: T.surfaceAlt, borderRadius: 6, fontSize: 12, border: `1px solid ${T.borderLight}` }}>
                    <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3, letterSpacing: '0.04em' }}>{k}</div>
                    <div style={{ fontWeight: 600, color: T.text, wordBreak: 'break-word' }}>{v}</div>
                  </div>
                ))}
              </div>
              {error && <div style={{ color: T.error, fontSize: 12, marginBottom: 12, padding: 8, background: T.errorLight, borderRadius: 6 }}>{error}</div>}
              <StepFooter onBack={() => go(6)} onContinue={launchOrg} continueLabel="Launch my workspace →" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StepFooter({ onBack, onContinue, continueDisabled, continueLabel = 'Continue →' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, gap: 8 }}>
      <button onClick={onBack} style={ghostBtn}>← Back</button>
      <button onClick={onContinue} disabled={continueDisabled}
        style={{ ...primaryBtnInline, opacity: continueDisabled ? 0.5 : 1, cursor: continueDisabled ? 'not-allowed' : 'pointer' }}>
        {continueLabel}
      </button>
    </div>
  )
}

const primaryBtn = {
  width: '100%', padding: 14, borderRadius: 6, border: 'none',
  background: '#5DADE2', color: '#fff', fontSize: 14, fontWeight: 600,
  cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
}

const primaryBtnInline = {
  padding: '10px 20px', borderRadius: 6, border: 'none',
  background: '#5DADE2', color: '#fff', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
}

const ghostBtn = {
  padding: '10px 12px', borderRadius: 6, border: 'none',
  background: 'transparent', color: T.textSecondary, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: T.font,
}

const secondaryBtn = {
  padding: '10px 16px', borderRadius: 6, border: `1px solid ${T.border}`,
  background: '#fff', color: T.text, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: T.font,
}
