import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T, formatCurrency, formatDateLong } from '../lib/theme'
import { Badge, Button, TabBar, EmptyState, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function ProposalBuilder() {
  const { dealId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { org } = useOrg()
  const vendorName = org?.name || 'Our Company'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deal, setDeal] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [insights, setInsights] = useState([])
  const [painPoints, setPainPoints] = useState([])
  const [primaryQuote, setPrimaryQuote] = useState(null)
  const [quoteLineItems, setQuoteLineItems] = useState([])
  const [paymentSchedules, setPaymentSchedules] = useState([])
  const [tcoBreakdown, setTcoBreakdown] = useState([])
  const [shares, setShares] = useState([])
  const [tab, setTab] = useState('builder')
  const [contacts, setContacts] = useState([])

  // Proposal settings (display)
  const [settings, setSettings] = useState({
    primary_color: '#5DADE2',
    secondary_color: '#6bb644',
    hide_order_schedule: false,
    hide_list_price_column: false,
    hide_discount_column: false,
    hide_net_price_column: false,
    hide_discount_percent: false,
    hide_total_discount: false,
    hide_total_row: false,
    hide_incentives_section: false,
    hide_payment_schedule: false,
    hide_tco_section: false,
  })

  // Builder form
  const [execSummary, setExecSummary] = useState('')
  const [problems, setProblems] = useState([])
  const [solutions, setSolutions] = useState([])
  const [totalImpact, setTotalImpact] = useState('')
  const [investment, setInvestment] = useState('')
  const [expectedRoi, setExpectedRoi] = useState('')

  useEffect(() => { loadData() }, [dealId])

  async function loadData() {
    setLoading(true)
    try {
      const [dealRes, propRes, insRes, painRes, settingsRes, sharesRes, contactsRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', dealId).single(),
        supabase.from('proposal_documents').select('*').eq('deal_id', dealId).eq('is_current', true).limit(1),
        supabase.from('proposal_insights').select('*').eq('deal_id', dealId).order('created_at'),
        supabase.from('deal_pain_points').select('*').eq('deal_id', dealId).order('annual_cost', { ascending: false }),
        supabase.from('proposal_settings').select('*').eq('deal_id', dealId).limit(1),
        supabase.from('proposal_shares').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
        supabase.from('contacts').select('*').eq('deal_id', dealId),
      ])

      setDeal(dealRes.data)
      setInsights(insRes.data || [])
      setPainPoints(painRes.data || [])
      setShares(sharesRes.data || [])
      setContacts(contactsRes.data || [])

      if (settingsRes.data?.[0]) {
        setSettings(prev => ({ ...prev, ...settingsRes.data[0] }))
      }

      const prop = propRes.data?.[0]
      if (prop) {
        setProposal(prop)
        setExecSummary(prop.executive_summary || '')
        setProblems(Array.isArray(prop.problems_challenges) ? prop.problems_challenges : [])
        setSolutions(Array.isArray(prop.solutions_benefits) ? prop.solutions_benefits : [])
        setTotalImpact(prop.total_annual_impact || '')
        setInvestment(prop.implementation_investment || '')
        setExpectedRoi(prop.expected_roi || '')
      }

      // Load primary quote + related data
      const { data: pqData } = await supabase.from('quotes').select('*').eq('deal_id', dealId).eq('is_primary', true).limit(1)
      const pq = pqData?.[0]
      if (pq) {
        setPrimaryQuote(pq)
        const [liRes, psRes, tcoRes] = await Promise.all([
          supabase.from('quote_line_items').select('*, products(product_name, sku, category)').eq('quote_id', pq.id).order('line_order'),
          supabase.from('payment_schedules').select('*').eq('quote_id', pq.id).order('payment_order'),
          supabase.from('quote_tco_breakdown').select('*').eq('quote_id', pq.id).order('year_number'),
        ])
        setQuoteLineItems(liRes.data || [])
        setPaymentSchedules(psRes.data || [])
        setTcoBreakdown(tcoRes.data || [])
      }
    } catch (err) {
      console.error('Error loading proposal:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Builder helpers ──
  function addProblem() { setProblems(prev => [...prev, { problem: '', impact: '', annual_cost: 0 }]) }
  function updateProblem(idx, field, value) { setProblems(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p)) }
  function removeProblem(idx) { setProblems(prev => prev.filter((_, i) => i !== idx)) }
  function moveProblem(idx, dir) {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= problems.length) return
    const arr = [...problems];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
    setProblems(arr)
  }

  function addSolution() { setSolutions(prev => [...prev, { solution: '', benefit: '', mapped_problem_idx: null }]) }
  function updateSolution(idx, field, value) { setSolutions(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s)) }
  function removeSolution(idx) { setSolutions(prev => prev.filter((_, i) => i !== idx)) }

  function importFromPainPoints() {
    const imported = painPoints.map(p => ({
      problem: p.pain_description || '',
      impact: p.business_impact || '',
      annual_cost: p.annual_cost || 0,
    }))
    setProblems(prev => [...prev, ...imported])
  }

  function importFromInsights() {
    const items = insights.filter(i => ['pain', 'risk', 'objection', 'challenge'].includes(i.insight_type))
    const imported = items.map(i => ({
      problem: i.primary_text || i.insight_text || '',
      impact: i.impact_text || i.secondary_text || '',
      annual_cost: 0,
    }))
    setProblems(prev => [...prev, ...imported])
  }

  // ── Calculations ──
  const autoTotalImpact = useMemo(() =>
    problems.reduce((s, p) => s + (Number(p.annual_cost) || 0), 0),
    [problems]
  )

  const quoteInvestment = useMemo(() => {
    if (!primaryQuote) return 0
    return primaryQuote.arr || primaryQuote.net_price || 0
  }, [primaryQuote])

  const autoRoi = useMemo(() => {
    if (autoTotalImpact > 0 && quoteInvestment > 0) {
      return Math.round((autoTotalImpact / quoteInvestment) * 100)
    }
    return 0
  }, [autoTotalImpact, quoteInvestment])

  // ── Save ──
  async function saveProposal() {
    setSaving(true)
    try {
      const data = {
        deal_id: dealId, executive_summary: execSummary,
        problems_challenges: problems, solutions_benefits: solutions,
        total_annual_impact: totalImpact || (autoTotalImpact > 0 ? `$${autoTotalImpact.toLocaleString()}` : ''),
        implementation_investment: investment || (quoteInvestment > 0 ? formatCurrency(quoteInvestment) : ''),
        expected_roi: expectedRoi || (autoRoi > 0 ? `${autoRoi}%` : ''),
        is_current: true, created_by: profile?.id,
      }

      if (proposal) {
        await supabase.from('proposal_documents').update(data).eq('id', proposal.id)
      } else {
        data.version = 1
        const { data: newProp } = await supabase.from('proposal_documents').insert(data).select().single()
        setProposal(newProp)
      }

      // Save settings
      const settingsData = { deal_id: dealId, ...settings }
      delete settingsData.id
      delete settingsData.created_at
      delete settingsData.updated_at
      const { data: existing } = await supabase.from('proposal_settings').select('id').eq('deal_id', dealId).single()
      if (existing) {
        await supabase.from('proposal_settings').update(settingsData).eq('id', existing.id)
      } else {
        await supabase.from('proposal_settings').insert(settingsData)
      }
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
  }

  // ── Share ──
  async function createShareLink() {
    const { error } = await supabase.from('proposal_shares').insert({
      deal_id: dealId, quote_id: primaryQuote?.id || null, created_by: profile?.id,
    })
    if (!error) loadData()
  }

  async function toggleShareActive(share) {
    await supabase.from('proposal_shares').update({ is_active: !share.is_active }).eq('id', share.id)
    setShares(prev => prev.map(s => s.id === share.id ? { ...s, is_active: !s.is_active } : s))
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const S = settings
  const pc = S.primary_color || '#5DADE2'
  const sc = S.secondary_color || '#6bb644'

  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + 30)
  const validUntilStr = formatDateLong(validUntil.toISOString().split('T')[0])

  // Signer / approval names
  const signerContact = contacts.find(c => c.id === primaryQuote?.signer_contact_id)
  const approvers = contacts.filter(c => c.is_economic_buyer || c.is_signer)

  const tabs = [
    { key: 'builder', label: 'Builder' },
    { key: 'preview', label: 'Preview' },
    { key: 'display', label: 'Display Settings' },
    { key: 'share', label: `Share (${shares.length})` },
  ]

  // ── Subscription / implementation line items split ──
  const subLineItems = quoteLineItems.filter(li => li.products?.category === 'subscription')
  const implLineItems = quoteLineItems.filter(li => li.products?.category === 'implementation')
  const svcLineItems = quoteLineItems.filter(li => li.products?.category !== 'subscription' && li.products?.category !== 'implementation')
  const subTotal = subLineItems.reduce((s, li) => s + (li.net_price || 0), 0)
  const implTotal = primaryQuote?.implementation_total || implLineItems.reduce((s, li) => s + (li.net_price || 0), 0)
  const annualTotal = subTotal + implTotal + svcLineItems.reduce((s, li) => s + (li.net_price || 0), 0)

  // Column count for table colspan calc
  const visibleCols = 2 + (!S.hide_list_price_column ? 1 : 0) + (!S.hide_discount_column ? 1 : 0) + (!S.hide_net_price_column ? 1 : 0)

  // ── Toggle switch component ──
  function Toggle({ value, onChange, label }) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 0', borderBottom: `1px solid ${T.borderLight}`,
      }}>
        <span style={{ fontSize: 13, color: T.text }}>{label}</span>
        <div onClick={() => onChange(!value)} style={{
          width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
          background: value ? pc : T.borderLight,
          position: 'relative', transition: 'background 0.2s',
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 2,
            left: value ? 20 : 2,
            boxShadow: T.shadow, transition: 'left 0.2s',
          }} />
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button onClick={() => navigate(`/deal/${dealId}`)} style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}>&larr; {deal.company_name}</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Proposal Builder</div>
            <div style={{ fontSize: 13, color: T.textSecondary }}>{deal.company_name}</div>
          </div>
          <Button primary onClick={saveProposal} disabled={saving}>{saving ? 'Saving...' : 'Save Proposal'}</Button>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: '16px 24px' }}>

        {/* ══════════ BUILDER TAB ══════════ */}
        {tab === 'builder' && (
          <div>
            {/* Executive Summary */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Executive Summary</span>
              </div>
              <div style={{ padding: 18 }}>
                <textarea
                  style={{ ...inputStyle, minHeight: 120, resize: 'vertical', lineHeight: 1.6 }}
                  value={execSummary}
                  onChange={e => setExecSummary(e.target.value)}
                  placeholder={`${deal.company_name} requires a modern financial platform to support its growth objectives...`}
                />
              </div>
            </div>

            {/* Problems & Solutions side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* Problems */}
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Problems / Challenges</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button style={{ padding: '3px 8px', fontSize: 10 }} onClick={importFromPainPoints}>Import Pain Points</Button>
                    <Button style={{ padding: '3px 8px', fontSize: 10 }} onClick={importFromInsights}>Import Insights</Button>
                    <Button style={{ padding: '3px 8px', fontSize: 10 }} onClick={addProblem}>+ Add</Button>
                  </div>
                </div>
                <div style={{ padding: 18 }}>
                  {problems.length === 0 ? (
                    <div style={{ color: T.textMuted, fontSize: 13, padding: '12px 0', textAlign: 'center' }}>
                      No problems added. Import from Pain Points or Insights, or add manually.
                    </div>
                  ) : problems.map((p, i) => (
                    <div key={i} style={{
                      padding: 12, background: T.errorLight, borderRadius: 6,
                      marginBottom: 8, borderLeft: `3px solid ${T.error}`, position: 'relative',
                    }}>
                      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
                        <button onClick={() => moveProblem(i, -1)} disabled={i === 0}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 11, opacity: i === 0 ? 0.3 : 1 }}>{'\u25B2'}</button>
                        <button onClick={() => moveProblem(i, 1)} disabled={i === problems.length - 1}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 11, opacity: i === problems.length - 1 ? 0.3 : 1 }}>{'\u25BC'}</button>
                        <button onClick={() => removeProblem(i)} style={{
                          background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14,
                        }}>&times;</button>
                      </div>
                      <textarea
                        style={{ ...inputStyle, background: 'white', fontSize: 13, fontWeight: 600, marginBottom: 6, minHeight: 40, resize: 'vertical' }}
                        value={p.problem} onChange={e => updateProblem(i, 'problem', e.target.value)}
                        placeholder="Problem description"
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          style={{ ...inputStyle, background: 'white', fontSize: 12, flex: 1 }}
                          value={p.impact} onChange={e => updateProblem(i, 'impact', e.target.value)}
                          placeholder="Business impact"
                        />
                        <div style={{ position: 'relative', width: 130 }}>
                          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 12 }}>$</span>
                          <input type="number" min="0"
                            style={{ ...inputStyle, background: 'white', fontSize: 12, paddingLeft: 18, width: '100%' }}
                            value={p.annual_cost || ''} onChange={e => updateProblem(i, 'annual_cost', Number(e.target.value) || 0)}
                            placeholder="Annual cost"
                          />
                        </div>
                      </div>
                      {(p.annual_cost || 0) > 0 && (
                        <div style={{ fontSize: 11, color: T.error, fontWeight: 600, marginTop: 4 }}>
                          Annual Impact: ${Number(p.annual_cost).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Solutions */}
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Solutions / Benefits</span>
                  <Button style={{ padding: '3px 8px', fontSize: 10 }} onClick={addSolution}>+ Add</Button>
                </div>
                <div style={{ padding: 18 }}>
                  {solutions.length === 0 ? (
                    <div style={{ color: T.textMuted, fontSize: 13, padding: '12px 0', textAlign: 'center' }}>
                      No solutions added yet. Add solutions mapped to your identified problems.
                    </div>
                  ) : solutions.map((s, i) => (
                    <div key={i} style={{
                      padding: 12, background: T.successLight, borderRadius: 6,
                      marginBottom: 8, borderLeft: `3px solid ${T.success}`, position: 'relative',
                    }}>
                      <button onClick={() => removeSolution(i)} style={{
                        position: 'absolute', top: 8, right: 8, background: 'none',
                        border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14,
                      }}>&times;</button>
                      {problems.length > 0 && (
                        <select style={{ ...inputStyle, background: 'white', fontSize: 11, marginBottom: 6, padding: '4px 8px', cursor: 'pointer' }}
                          value={s.mapped_problem_idx ?? ''} onChange={e => updateSolution(i, 'mapped_problem_idx', e.target.value === '' ? null : Number(e.target.value))}>
                          <option value="">Map to problem...</option>
                          {problems.map((p, pi) => (
                            <option key={pi} value={pi}>{pi + 1}. {(p.problem || '').substring(0, 50)}{(p.problem || '').length > 50 ? '...' : ''}</option>
                          ))}
                        </select>
                      )}
                      <textarea
                        style={{ ...inputStyle, background: 'white', fontSize: 13, fontWeight: 600, marginBottom: 6, minHeight: 40, resize: 'vertical' }}
                        value={s.solution} onChange={e => updateSolution(i, 'solution', e.target.value)}
                        placeholder="Solution description"
                      />
                      <input
                        style={{ ...inputStyle, background: 'white', fontSize: 12 }}
                        value={s.benefit} onChange={e => updateSolution(i, 'benefit', e.target.value)}
                        placeholder="Business benefit"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Financial Summary */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Financial Summary</span>
              </div>
              <div style={{ padding: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Total Annual Impact</label>
                    <input style={inputStyle} value={totalImpact} onChange={e => setTotalImpact(e.target.value)}
                      placeholder={autoTotalImpact > 0 ? `$${autoTotalImpact.toLocaleString()} (auto)` : 'e.g. $500,000'} />
                    {autoTotalImpact > 0 && !totalImpact && (
                      <div style={{ fontSize: 11, color: T.success, marginTop: 4, fontWeight: 600 }}>
                        Auto-calculated: ${autoTotalImpact.toLocaleString()} from {problems.filter(p => p.annual_cost > 0).length} pain points
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Investment (from Quote)</label>
                    <input style={inputStyle} value={investment} onChange={e => setInvestment(e.target.value)}
                      placeholder={quoteInvestment > 0 ? formatCurrency(quoteInvestment) + ' (from quote)' : 'No primary quote'} />
                    {quoteInvestment > 0 && !investment && (
                      <div style={{ fontSize: 11, color: T.primary, marginTop: 4, fontWeight: 600 }}>
                        From primary quote ARR: {formatCurrency(quoteInvestment)}
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Expected ROI</label>
                    <input style={inputStyle} value={expectedRoi} onChange={e => setExpectedRoi(e.target.value)}
                      placeholder={autoRoi > 0 ? `${autoRoi}% (auto)` : 'e.g. 200%'} />
                    {autoRoi > 0 && !expectedRoi && (
                      <div style={{ fontSize: 11, color: T.success, marginTop: 4, fontWeight: 600 }}>
                        Auto: {autoRoi}% ROI (impact / investment)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ PREVIEW TAB ══════════ */}
        {tab === 'preview' && (
          <div style={{
            background: '#fff', border: `1px solid ${T.border}`, borderRadius: 8,
            padding: '48px 56px', maxWidth: 900, margin: '0 auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontFamily: T.font,
          }}>

            {/* ── Proposal Header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36, paddingBottom: 24, borderBottom: `2px solid ${T.borderLight}` }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: sc, letterSpacing: '-0.02em' }}>{vendorName}</div>
              </div>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: T.text, letterSpacing: '-0.02em' }}>{deal.company_name}</div>
                <div style={{ fontSize: 13, color: T.textSecondary, marginTop: 4, fontWeight: 500 }}>Business Proposal</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Offer Valid Until</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{validUntilStr}</div>
                {approvers.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: T.textSecondary }}>
                    {approvers.map(c => c.contact_name).join(', ')}
                  </div>
                )}
              </div>
            </div>

            {/* ── Contract Details Grid ── */}
            {primaryQuote && (
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 0,
                marginBottom: 32, border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden',
              }}>
                {[
                  ['Contract Start', primaryQuote.contract_start_date ? formatDateLong(primaryQuote.contract_start_date) : 'TBD'],
                  ['Contract Length', `${primaryQuote.contract_years || 3} Year${(primaryQuote.contract_years || 3) > 1 ? 's' : ''}`],
                  ['Payment Terms', (primaryQuote.payment_terms || 'annual').charAt(0).toUpperCase() + (primaryQuote.payment_terms || 'annual').slice(1)],
                  ['Price Increases', primaryQuote.price_increases || 'N/A'],
                ].map(([label, val], idx) => (
                  <div key={label} style={{
                    padding: '14px 16px',
                    background: T.surfaceAlt,
                    borderRight: idx < 3 ? `1px solid ${T.border}` : 'none',
                  }}>
                    <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Software & Services Table ── */}
            {!S.hide_order_schedule && quoteLineItems.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Software & Services
                </div>
                <div style={{ border: `2px solid ${pc}`, borderRadius: 6, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#fff' }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Product</th>
                        <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Qty</th>
                        {!S.hide_list_price_column && <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>List Price</th>}
                        {!S.hide_discount_column && <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>
                          {S.hide_discount_percent ? 'Discount' : 'Discount %'}
                        </th>}
                        {!S.hide_net_price_column && <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Net Price</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {quoteLineItems.map((li, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${T.borderLight}`, background: i % 2 === 0 ? '#fff' : T.surfaceAlt }}>
                          <td style={{ padding: '10px 14px', color: T.text, fontWeight: 500 }}>
                            {li.products?.product_name || 'Product'}
                            {li.products?.sku && <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 6 }}>({li.products.sku})</span>}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{li.quantity}</td>
                          {!S.hide_list_price_column && <td style={{ padding: '10px 14px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>${(li.list_price || 0).toLocaleString()}</td>}
                          {!S.hide_discount_column && <td style={{ padding: '10px 14px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.success }}>
                            {S.hide_discount_percent
                              ? `$${Math.round((li.list_price * li.quantity) - (li.net_price || 0)).toLocaleString()}`
                              : (li.discount_percentage ? `${li.discount_percentage}%` : '--')}
                          </td>}
                          {!S.hide_net_price_column && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>${Math.round(li.net_price || 0).toLocaleString()}</td>}
                        </tr>
                      ))}
                    </tbody>
                    {!S.hide_total_row && (
                      <tfoot>
                        <tr style={{ borderTop: `2px solid ${pc}`, background: `${pc}08` }}>
                          <td colSpan={visibleCols - 1} style={{ padding: '10px 14px', fontWeight: 700, color: T.text }}>Subscription Total</td>
                          {!S.hide_net_price_column && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontFeatureSettings: '"tnum"', color: pc }}>${Math.round(subTotal).toLocaleString()}</td>}
                        </tr>
                        {implTotal > 0 && (
                          <tr style={{ background: `${pc}05` }}>
                            <td colSpan={visibleCols - 1} style={{ padding: '10px 14px', fontWeight: 600, color: T.textSecondary }}>Implementation</td>
                            {!S.hide_net_price_column && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>${Math.round(implTotal).toLocaleString()}</td>}
                          </tr>
                        )}
                        <tr style={{ background: `${pc}10`, borderTop: `1px solid ${pc}30` }}>
                          <td colSpan={visibleCols - 1} style={{ padding: '12px 14px', fontWeight: 800, color: T.text, fontSize: 14 }}>Annual Total</td>
                          {!S.hide_net_price_column && <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: pc, fontFeatureSettings: '"tnum"' }}>${Math.round(annualTotal).toLocaleString()}</td>}
                        </tr>
                        {!S.hide_total_discount && primaryQuote && primaryQuote.discount_percent > 0 && (
                          <tr style={{ background: T.successLight }}>
                            <td colSpan={visibleCols - 1} style={{ padding: '8px 14px', fontSize: 12, color: T.success, fontWeight: 600 }}>Total Discount</td>
                            <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, color: T.success, fontWeight: 600 }}>
                              {primaryQuote.discount_percent.toFixed(1)}% (-${Math.round(primaryQuote.discount_amount || 0).toLocaleString()})
                            </td>
                          </tr>
                        )}
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}

            {/* ── Incentives ── */}
            {!S.hide_incentives_section && primaryQuote && (primaryQuote.free_months > 0 || primaryQuote.signing_bonus > 0) && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Incentives
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {primaryQuote.signing_bonus > 0 && (
                    <div style={{
                      padding: '18px 20px', borderRadius: 8, background: `${pc}10`,
                      border: `1px solid ${pc}30`,
                    }}>
                      <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Signing Bonus</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: pc, fontFeatureSettings: '"tnum"' }}>
                        ${Math.round(primaryQuote.signing_bonus).toLocaleString()}
                      </div>
                    </div>
                  )}
                  {primaryQuote.free_months > 0 && (
                    <div style={{
                      padding: '18px 20px', borderRadius: 8, background: `${T.success}10`,
                      border: `1px solid ${T.success}30`,
                    }}>
                      <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Free Months</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: T.success, fontFeatureSettings: '"tnum"' }}>
                        {primaryQuote.free_months} Month{primaryQuote.free_months > 1 ? 's' : ''}
                      </div>
                      <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>
                        Value: ${Math.round((subTotal / 12) * primaryQuote.free_months).toLocaleString()}
                      </div>
                    </div>
                  )}
                  <div style={{
                    padding: '18px 20px', borderRadius: 8, background: `${pc}10`,
                    border: `1px solid ${pc}30`,
                  }}>
                    <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Total Incentives</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: pc, fontFeatureSettings: '"tnum"' }}>
                      ${Math.round((primaryQuote.signing_bonus || 0) + (subTotal / 12) * (primaryQuote.free_months || 0)).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Payment Schedule ── */}
            {!S.hide_payment_schedule && paymentSchedules.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Payment Schedule
                </div>
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: T.surfaceAlt }}>
                        {['Billing Date', 'Due Date', 'Type', 'Period', 'Amount'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paymentSchedules.map((ps, i) => {
                        const typeBg = ps.payment_type === 'implementation' ? 'rgba(139, 92, 246, 0.06)'
                          : ps.payment_type === 'subscription' ? 'rgba(93, 173, 226, 0.06)'
                          : ps.payment_type === 'free_month' ? 'rgba(220, 53, 69, 0.06)' : 'transparent'
                        const typeColor = ps.payment_type === 'implementation' ? '#8b5cf6'
                          : ps.payment_type === 'subscription' ? pc : T.error
                        return (
                          <tr key={i} style={{ background: typeBg, borderTop: `1px solid ${T.borderLight}` }}>
                            <td style={{ padding: '10px 14px' }}>{ps.payment_date ? formatDateLong(ps.payment_date) : '--'}</td>
                            <td style={{ padding: '10px 14px' }}>{ps.due_date ? formatDateLong(ps.due_date) : '--'}</td>
                            <td style={{ padding: '10px 14px' }}><Badge color={typeColor}>{ps.payment_type === 'free_month' ? 'Free Month' : ps.payment_type}</Badge></td>
                            <td style={{ padding: '10px 14px' }}>{ps.period_label || '--'}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"', color: ps.amount === 0 ? T.success : T.text }}>
                              {ps.amount === 0 ? '$0 (Free)' : `$${Math.round(ps.amount).toLocaleString()}`}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── TCO Breakdown ── */}
            {!S.hide_tco_section && tcoBreakdown.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Total Cost of Ownership
                </div>
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: T.surfaceAlt }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Category</th>
                        {tcoBreakdown.map(yr => (
                          <th key={yr.year_number} style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Year {yr.year_number}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Subscription', 'subscription'],
                        ['Implementation', 'implementation'],
                        ['Incentives', 'incentives'],
                      ].map(([label, key]) => (
                        <tr key={key} style={{ borderTop: `1px solid ${T.borderLight}` }}>
                          <td style={{ padding: '10px 14px', color: T.text, fontWeight: 500 }}>{label}</td>
                          {tcoBreakdown.map(yr => (
                            <td key={yr.year_number} style={{
                              padding: '10px 14px', textAlign: 'right', fontFeatureSettings: '"tnum"',
                              color: key === 'incentives' && (yr[key] || yr.discount || 0) > 0 ? T.success : T.text,
                            }}>
                              {key === 'incentives'
                                ? ((yr.incentives || yr.discount || 0) > 0 ? `-$${Math.round(yr.incentives || yr.discount || 0).toLocaleString()}` : '$0')
                                : `$${Math.round(yr[key] || 0).toLocaleString()}`}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr style={{ borderTop: `2px solid ${pc}`, background: `${pc}10` }}>
                        <td style={{ padding: '12px 14px', fontWeight: 800, color: T.text }}>Total</td>
                        {tcoBreakdown.map(yr => (
                          <td key={yr.year_number} style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, fontFeatureSettings: '"tnum"', color: pc, fontSize: 14 }}>
                            ${Math.round(yr.total || 0).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Summary Cards ── */}
            {primaryQuote && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 32 }}>
                {[
                  ['Year 1 Total', primaryQuote.year_one_total],
                  ['Total Contract Value', primaryQuote.total_contract_value],
                  ['ARR', primaryQuote.arr],
                ].map(([label, value]) => (
                  <div key={label} style={{
                    padding: '24px', textAlign: 'center', borderRadius: 8,
                    background: `${pc}08`, border: `1px solid ${pc}20`,
                  }}>
                    <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: pc, fontFeatureSettings: '"tnum"' }}>
                      ${Math.round(value || 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Problems & Solutions ── */}
            {(problems.length > 0 || solutions.length > 0) && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Challenges & Solutions
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* Problems column */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.error, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Challenges Identified
                    </div>
                    {problems.map((p, i) => (
                      <div key={i} style={{
                        padding: '14px 18px', background: '#fef2f2', borderRadius: 6,
                        marginBottom: 8, borderLeft: `3px solid ${T.error}`,
                      }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>{p.problem}</div>
                        {p.impact && <div style={{ fontSize: 12, color: '#7f1d1d' }}>{p.impact}</div>}
                        {(p.annual_cost || 0) > 0 && (
                          <div style={{ fontSize: 11, color: T.error, fontWeight: 700, marginTop: 6 }}>
                            Annual Impact: ${Number(p.annual_cost).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Solutions column */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.success, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Proposed Solutions
                    </div>
                    {solutions.map((s, i) => (
                      <div key={i} style={{
                        padding: '14px 18px', background: '#f0fdf4', borderRadius: 6,
                        marginBottom: 8, borderLeft: `3px solid ${T.success}`,
                      }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#166534', marginBottom: 4 }}>{s.solution}</div>
                        {s.benefit && <div style={{ fontSize: 12, color: '#15803d' }}>{s.benefit}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Executive Summary ── */}
            {execSummary && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Executive Summary
                </div>
                <div style={{ fontSize: 14, color: T.text, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{execSummary}</div>
              </div>
            )}

            {/* ── Footer ── */}
            <div style={{ marginTop: 40, paddingTop: 16, borderTop: `2px solid ${T.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: T.textMuted }}>Confidential - Prepared for {deal.company_name}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: sc }}>{vendorName}</div>
            </div>
          </div>
        )}

        {/* ══════════ DISPLAY SETTINGS TAB ══════════ */}
        {tab === 'display' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Settings panel */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Display Settings</span>
              </div>
              <div style={{ padding: 18 }}>
                {/* Colors */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 10 }}>Colors</div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div>
                      <label style={labelStyle}>Primary Color</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="color" value={settings.primary_color || '#5DADE2'}
                          onChange={e => setSettings(prev => ({ ...prev, primary_color: e.target.value }))}
                          style={{ width: 36, height: 36, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                        <input style={{ ...inputStyle, width: 90, padding: '6px 8px', fontSize: 12 }}
                          value={settings.primary_color || '#5DADE2'}
                          onChange={e => setSettings(prev => ({ ...prev, primary_color: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Secondary Color</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="color" value={settings.secondary_color || '#6bb644'}
                          onChange={e => setSettings(prev => ({ ...prev, secondary_color: e.target.value }))}
                          style={{ width: 36, height: 36, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                        <input style={{ ...inputStyle, width: 90, padding: '6px 8px', fontSize: 12 }}
                          value={settings.secondary_color || '#6bb644'}
                          onChange={e => setSettings(prev => ({ ...prev, secondary_color: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Toggles */}
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>Visibility</div>
                {[
                  ['hide_order_schedule', 'Show Order Schedule'],
                  ['hide_list_price_column', 'Show List Price Column'],
                  ['hide_discount_column', 'Show Discount Column'],
                  ['hide_net_price_column', 'Show Net Price Column'],
                  ['hide_discount_percent', 'Show Discount Percent'],
                  ['hide_total_discount', 'Show Total Discount'],
                  ['hide_total_row', 'Show Total Row'],
                  ['hide_incentives_section', 'Show Incentives Section'],
                  ['hide_payment_schedule', 'Show Payment Schedule'],
                  ['hide_tco_section', 'Show TCO Section'],
                ].map(([key, label]) => (
                  <Toggle key={key} label={label} value={!settings[key]}
                    onChange={val => setSettings(prev => ({ ...prev, [key]: !val }))} />
                ))}
              </div>
            </div>

            {/* Live mini preview */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Preview</span>
              </div>
              <div style={{ padding: 18 }}>
                <div style={{
                  background: '#fff', border: `1px solid ${T.border}`, borderRadius: 6,
                  padding: 20, fontSize: 10, transform: 'scale(0.95)', transformOrigin: 'top left',
                }}>
                  {/* Mini header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${T.borderLight}` }}>
                    <span style={{ fontWeight: 800, color: settings.secondary_color || sc }}>{vendorName}</span>
                    <span style={{ fontWeight: 700 }}>{deal.company_name}</span>
                    <span style={{ color: T.textMuted, fontSize: 9 }}>Valid Until: ...</span>
                  </div>

                  {/* Mini table */}
                  {!settings.hide_order_schedule && (
                    <div style={{ border: `1px solid ${settings.primary_color || pc}`, borderRadius: 4, marginBottom: 10, overflow: 'hidden' }}>
                      <div style={{ padding: '4px 8px', background: '#fff', fontSize: 8, color: T.textMuted, display: 'flex', gap: 20 }}>
                        <span style={{ flex: 1 }}>PRODUCT</span>
                        <span>QTY</span>
                        {!settings.hide_list_price_column && <span>LIST</span>}
                        {!settings.hide_discount_column && <span>DISC</span>}
                        {!settings.hide_net_price_column && <span>NET</span>}
                      </div>
                      <div style={{ padding: '4px 8px', fontSize: 9, borderTop: `1px solid ${T.borderLight}` }}>
                        Sample Product Line...
                      </div>
                      {!settings.hide_total_row && (
                        <div style={{ padding: '4px 8px', background: `${settings.primary_color || pc}10`, fontWeight: 700, fontSize: 9, borderTop: `1px solid ${settings.primary_color || pc}` }}>
                          Total
                        </div>
                      )}
                    </div>
                  )}

                  {!settings.hide_incentives_section && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                      <div style={{ flex: 1, padding: 6, background: `${settings.primary_color || pc}10`, borderRadius: 4, fontSize: 8 }}>
                        <div style={{ color: T.textMuted }}>SIGNING BONUS</div>
                        <div style={{ fontWeight: 700, color: settings.primary_color || pc }}>$X,XXX</div>
                      </div>
                      <div style={{ flex: 1, padding: 6, background: `${T.success}10`, borderRadius: 4, fontSize: 8 }}>
                        <div style={{ color: T.textMuted }}>FREE MONTHS</div>
                        <div style={{ fontWeight: 700, color: T.success }}>X Months</div>
                      </div>
                    </div>
                  )}

                  {!settings.hide_payment_schedule && (
                    <div style={{ marginBottom: 10, border: `1px solid ${T.borderLight}`, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ padding: '3px 8px', background: T.surfaceAlt, fontSize: 8, color: T.textMuted }}>PAYMENT SCHEDULE</div>
                      <div style={{ padding: '3px 8px', fontSize: 8, background: 'rgba(139,92,246,0.06)' }}>Implementation...</div>
                      <div style={{ padding: '3px 8px', fontSize: 8, background: 'rgba(93,173,226,0.06)' }}>Subscription...</div>
                    </div>
                  )}

                  {!settings.hide_tco_section && (
                    <div style={{ marginBottom: 10, border: `1px solid ${T.borderLight}`, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ padding: '3px 8px', background: T.surfaceAlt, fontSize: 8, color: T.textMuted }}>TCO BREAKDOWN</div>
                      <div style={{ padding: '3px 8px', fontSize: 8 }}>Y1 / Y2 / Y3...</div>
                      <div style={{ padding: '3px 8px', background: `${settings.primary_color || pc}10`, fontWeight: 700, fontSize: 8 }}>Total</div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6 }}>
                    {['Year 1', 'TCV', 'ARR'].map(l => (
                      <div key={l} style={{ flex: 1, padding: 6, textAlign: 'center', background: `${settings.primary_color || pc}08`, borderRadius: 4 }}>
                        <div style={{ fontSize: 7, color: T.textMuted }}>{l}</div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: settings.primary_color || pc }}>$XX,XXX</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ SHARE TAB ══════════ */}
        {tab === 'share' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: T.textSecondary }}>
                Share this proposal with your customer via a unique link.
              </div>
              <Button primary onClick={createShareLink}>Create Share Link</Button>
            </div>

            {shares.length === 0 ? (
              <EmptyState message="No share links yet. Create one to share this proposal with your customer." />
            ) : shares.map(share => {
              const shareUrl = `${window.location.origin}/proposal/shared/${share.share_token || share.id}`
              return (
                <div key={share.id} style={{
                  background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
                  boxShadow: T.shadow, marginBottom: 12, padding: 18,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontFamily: T.mono, color: T.text, marginBottom: 6,
                        padding: '8px 12px', background: T.surfaceAlt, borderRadius: 6,
                        border: `1px solid ${T.borderLight}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {shareUrl}
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: T.textSecondary, alignItems: 'center' }}>
                        <span>Views: <strong style={{ color: T.text }}>{share.view_count || 0}</strong></span>
                        {share.created_at && <span>Created: {formatDateLong(share.created_at.split('T')[0])}</span>}
                        {share.expires_at && <span>Expires: {formatDateLong(share.expires_at.split('T')[0])}</span>}
                        <span onClick={() => toggleShareActive(share)} style={{ cursor: 'pointer' }}>
                          {share.is_active !== false
                            ? <Badge color={T.success}>Active</Badge>
                            : <Badge color={T.error}>Inactive</Badge>}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
                      <Button onClick={() => navigator.clipboard.writeText(shareUrl)}
                        style={{ padding: '8px 16px', fontSize: 12 }}>
                        Copy Link
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
