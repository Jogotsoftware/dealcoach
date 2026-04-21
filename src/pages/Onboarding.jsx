import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

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

export default function Onboarding() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('token')

  const [mode, setMode] = useState(inviteToken ? 'invite' : null) // null = choose, 'create', 'invite'
  const [step, setStep] = useState(0) // 0=welcome, 1=company, 2=product, 3=methodology, 4=review
  const [invitation, setInvitation] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

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
  const [inviteCode, setInviteCode] = useState(inviteToken || '')

  // Redirect if already has org
  useEffect(() => {
    if (profile?.org_id) navigate('/', { replace: true })
  }, [profile?.org_id])

  // Load invitation if token provided
  useEffect(() => {
    if (!inviteToken) return
    supabase.from('invitations').select('*, organizations(name)').eq('token', inviteToken).eq('status', 'pending').single()
      .then(({ data }) => {
        if (data && (!data.expires_at || new Date(data.expires_at) > new Date())) {
          setInvitation(data)
        } else {
          setError('This invitation is invalid or has expired.')
          setMode(null)
        }
      })
  }, [inviteToken])

  async function acceptInvitation() {
    if (!invitation) return
    setProcessing(true)
    setError(null)
    try {
      await supabase.from('invitations').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invitation.id)
      await supabase.from('profiles').update({ org_id: invitation.org_id, role: invitation.role || 'rep' }).eq('id', user.id)
      window.location.href = '/'
    } catch (err) {
      setError(err.message)
      setProcessing(false)
    }
  }

  async function lookupInvite() {
    if (!inviteCode.trim()) return
    setError(null)
    const { data } = await supabase.from('invitations').select('*, organizations(name)').eq('token', inviteCode.trim()).eq('status', 'pending').single()
    if (data && (!data.expires_at || new Date(data.expires_at) > new Date())) {
      setInvitation(data)
      setMode('invite')
    } else {
      setError('Invalid or expired invitation code.')
    }
  }

  async function launchOrg() {
    if (!orgName.trim()) return
    setProcessing(true)
    setError(null)
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
            coachingStyle: 'independently_wealthy',
            teamSize,
            fiscalYearEndMonth: fyEndMonth,
            fiscalYearEndDay: fyEndDay,
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

      // Assign free plan if org has no plan
      if (data.org_id) {
        const { data: freePlan } = await supabase.from('plans').select('id').eq('slug', 'free').single()
        if (freePlan) {
          await supabase.from('organizations').update({ plan_id: freePlan.id }).eq('id', data.org_id).is('plan_id', null)
        }
      }

      setResult(data)
    } catch (err) {
      setError(err.message)
      setProcessing(false)
    }
  }

  // === RENDER ===
  const cardStyle = { background: T.surface, border: '1px solid ' + T.border, borderRadius: 12, padding: 32, maxWidth: 560, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }
  const chipStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (active ? T.primary : T.border),
    background: active ? T.primaryLight : 'transparent', color: active ? T.primary : T.textSecondary, transition: 'all 0.15s', userSelect: 'none',
  })

  function toggleArr(arr, setArr, val) { setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]) }

  // Result screen
  if (result) return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font }}>
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#fff', fontSize: 28, fontWeight: 800 }}>D</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 8 }}>You're All Set</h1>
        <p style={{ fontSize: 13, color: T.textSecondary, marginBottom: 20, lineHeight: 1.5 }}>
          Your DealCoach environment is configured. {result.summary?.coach && `Coach "${result.summary.coach}" is ready with ${result.summary.call_type_prompts || 0} call prompts.`}
        </p>
        {result.summary && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20, textAlign: 'left' }}>
            {[
              ['Organization', result.summary.organization],
              ['Coach', result.summary.coach],
              ['Call Prompts', result.summary.call_type_prompts],
              ['Scoring Configs', result.summary.scoring_configs],
              ['Pipeline Stages', result.summary.pipeline_stages],
              ['Credits', result.summary.credits_granted],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ padding: '6px 10px', background: T.surfaceAlt, borderRadius: 6, fontSize: 12 }}>
                <span style={{ color: T.textMuted }}>{k}: </span><strong>{v}</strong>
              </div>
            ))}
          </div>
        )}
        <Button primary onClick={() => { window.location.href = '/' }} style={{ width: '100%', justifyContent: 'center' }}>Go to Dashboard</Button>
      </div>
    </div>
  )

  // Processing screen
  if (processing) return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font }}>
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <Spinner />
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginTop: 20, marginBottom: 8 }}>Setting Up Your Environment</h2>
        <p style={{ fontSize: 13, color: T.textSecondary }}>Perplexity is researching your market. Claude is generating coaching prompts. This takes 15-30 seconds.</p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font, padding: 24 }}>
      <div style={cardStyle}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, color: '#fff' }}>D</div>
          <span style={{ fontSize: 18, fontWeight: 700, color: T.text }}>DealCoach</span>
        </div>

        {/* Mode selection */}
        {!mode && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 8 }}>Welcome to Revenue Instruments</h1>
            <p style={{ fontSize: 13, color: T.textSecondary, marginBottom: 24, lineHeight: 1.5 }}>Get started by creating your organization or joining an existing team.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Button primary onClick={() => { setMode('create'); setStep(1) }} style={{ width: '100%', justifyContent: 'center', padding: '12px 20px' }}>Create Organization</Button>
              <div style={{ textAlign: 'center', fontSize: 12, color: T.textMuted }}>or</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inputStyle, flex: 1 }} placeholder="Paste invitation code..." value={inviteCode} onChange={e => setInviteCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && lookupInvite()} />
                <Button onClick={lookupInvite}>Join</Button>
              </div>
            </div>
            {error && <div style={{ color: T.error, fontSize: 12, marginTop: 12, padding: 8, background: T.errorLight, borderRadius: 6 }}>{error}</div>}
          </>
        )}

        {/* Invitation acceptance */}
        {mode === 'invite' && invitation && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 8 }}>Join {invitation.organizations?.name}</h1>
            <p style={{ fontSize: 13, color: T.textSecondary, marginBottom: 20, lineHeight: 1.5 }}>
              You've been invited to join <strong>{invitation.organizations?.name}</strong> as a <strong>{invitation.role || 'rep'}</strong>.
            </p>
            <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
              <div><span style={{ color: T.textMuted }}>Email:</span> {invitation.email}</div>
              <div><span style={{ color: T.textMuted }}>Role:</span> {invitation.role}</div>
            </div>
            {error && <div style={{ color: T.error, fontSize: 12, marginBottom: 12, padding: 8, background: T.errorLight, borderRadius: 6 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => { setMode(null); setInvitation(null) }}>Back</Button>
              <Button primary onClick={acceptInvitation} style={{ flex: 1, justifyContent: 'center' }}>Accept & Join</Button>
            </div>
          </>
        )}

        {/* Create org wizard */}
        {mode === 'create' && (
          <>
            {/* Progress */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
              {['Company', 'Product', 'Methodology', 'Review'].map((label, i) => (
                <div key={label} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: 3, borderRadius: 2, background: i < step ? T.primary : T.border, marginBottom: 4, transition: 'background 0.3s' }} />
                  <span style={{ fontSize: 10, color: i < step ? T.primary : i === step ? T.text : T.textMuted, fontWeight: 600 }}>{label}</span>
                </div>
              ))}
            </div>

            {/* Step 1: Company */}
            {step === 1 && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>Your Company</h2>
                <p style={{ fontSize: 12, color: T.textSecondary, marginBottom: 16 }}>Tell us about your company and who you sell to.</p>
                <div style={{ marginBottom: 12 }}><label style={labelStyle}>Company Name *</label><input style={inputStyle} value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Company name" /></div>
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
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Target Revenue</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {REVENUE_RANGES.map(r => <span key={r} onClick={() => toggleArr(icpRevenue, setIcpRevenue, r)} style={chipStyle(icpRevenue.includes(r))}>{r}</span>)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button onClick={() => setMode(null)}>Back</Button>
                  <Button primary onClick={() => setStep(2)} disabled={!orgName.trim()}>Continue</Button>
                </div>
              </>
            )}

            {/* Step 2: Product */}
            {step === 2 && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>Your Product</h2>
                <p style={{ fontSize: 12, color: T.textSecondary, marginBottom: 16 }}>The AI needs to understand what you sell to coach effectively.</p>
                <div style={{ marginBottom: 12 }}><label style={labelStyle}>Product Name</label><input style={inputStyle} value={productName} onChange={e => setProductName(e.target.value)} placeholder="Product name" /></div>
                <div style={{ marginBottom: 12 }}><label style={labelStyle}>What does it do?</label><textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={productDesc} onChange={e => setProductDesc(e.target.value)} placeholder="What does it do?" /></div>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Team Size</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={teamSize} onChange={e => setTeamSize(e.target.value)}>
                    {['1', '2-5', '6-15', '16-50', '50+'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Fiscal Year End</label>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>When does your company's fiscal year end?</div>
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
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button onClick={() => setStep(1)}>Back</Button>
                  <Button primary onClick={() => setStep(3)}>Continue</Button>
                </div>
              </>
            )}

            {/* Step 3: Methodology */}
            {step === 3 && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>Sales Methodology</h2>
                <p style={{ fontSize: 12, color: T.textSecondary, marginBottom: 16 }}>Select all frameworks your team uses. These shape how the AI coaches.</p>
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
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button onClick={() => setStep(2)}>Back</Button>
                  <Button primary onClick={() => setStep(4)} disabled={!methodologies.length}>Continue</Button>
                </div>
              </>
            )}

            {/* Step 4: Review & Launch */}
            {step === 4 && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>Review & Launch</h2>
                <p style={{ fontSize: 12, color: T.textSecondary, marginBottom: 16 }}>The AI will research your market and auto-configure your coaching environment.</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {[
                    ['Company', orgName],
                    ['Website', website || '\u2014'],
                    ['Product', productName || orgName],
                    ['Team Size', teamSize],
                    ['Industries', icpIndustries.join(', ') || 'Any'],
                    ['Fiscal Year End', `${MONTH_NAMES[fyEndMonth - 1]} ${fyEndDay}`],
                    ['Methodologies', methodologies.map(id => METHODOLOGIES.find(m => m.id === id)?.name).join(', ')],
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: '8px 10px', background: T.surfaceAlt, borderRadius: 6, fontSize: 12 }}>
                      <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>{k}</div>
                      <div style={{ fontWeight: 600, color: T.text }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: 12, background: T.primaryLight, border: '1px solid ' + T.primaryBorder, borderRadius: 8, marginBottom: 16, fontSize: 12, color: T.primary, lineHeight: 1.5 }}>
                  Perplexity will research your market and ICP. Claude Opus will generate your coach persona, call prompts, scoring criteria, and pipeline configuration.
                </div>
                {error && <div style={{ color: T.error, fontSize: 12, marginBottom: 12, padding: 8, background: T.errorLight, borderRadius: 6 }}>{error}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button onClick={() => setStep(3)}>Back</Button>
                  <Button primary onClick={launchOrg}>Launch DealCoach</Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
