import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, formatDateLong } from '../lib/theme'
import { Card, Badge, Button, TabBar, Field, EmptyState, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function ProposalBuilder() {
  const { dealId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deal, setDeal] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [insights, setInsights] = useState([])
  const [quotes, setQuotes] = useState([])
  const [painPoints, setPainPoints] = useState([])
  const [primaryQuote, setPrimaryQuote] = useState(null)
  const [quoteLineItems, setQuoteLineItems] = useState([])
  const [paymentSchedules, setPaymentSchedules] = useState([])
  const [tcoBreakdown, setTcoBreakdown] = useState([])
  const [proposalSettings, setProposalSettings] = useState({})
  const [shares, setShares] = useState([])
  const [tab, setTab] = useState('builder')

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
      const [dealRes, propRes, insRes, quotesRes, painRes, settingsRes, sharesRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', dealId).single(),
        supabase.from('proposal_documents').select('*').eq('deal_id', dealId).eq('is_current', true).limit(1),
        supabase.from('proposal_insights').select('*').eq('deal_id', dealId).order('created_at'),
        supabase.from('quotes').select('*').eq('deal_id', dealId).order('version', { ascending: false }),
        supabase.from('deal_pain_points').select('*').eq('deal_id', dealId).order('annual_cost', { ascending: false }),
        supabase.from('proposal_settings').select('*').eq('deal_id', dealId).limit(1),
        supabase.from('proposal_shares').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
      ])

      setDeal(dealRes.data)
      setInsights(insRes.data || [])
      setQuotes(quotesRes.data || [])
      setPainPoints(painRes.data || [])
      setProposalSettings(settingsRes.data?.[0] || {})
      setShares(sharesRes.data || [])

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

      // Load primary quote details
      const pq = (quotesRes.data || []).find(q => q.is_primary)
      if (pq) {
        setPrimaryQuote(pq)
        const [liRes, psRes, tcoRes] = await Promise.all([
          supabase.from('quote_line_items').select('*, products(product_name, category)').eq('quote_id', pq.id).order('line_order'),
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

  function addProblem() { setProblems(prev => [...prev, { problem: '', impact: '', annual_cost: null }]) }
  function updateProblem(idx, field, value) { setProblems(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p)) }
  function removeProblem(idx) { setProblems(prev => prev.filter((_, i) => i !== idx)) }
  function moveProblem(idx, dir) {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= problems.length) return
    const arr = [...problems];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
    setProblems(arr)
  }

  function addSolution() { setSolutions(prev => [...prev, { solution: '', benefit: '' }]) }
  function updateSolution(idx, field, value) { setSolutions(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s)) }
  function removeSolution(idx) { setSolutions(prev => prev.filter((_, i) => i !== idx)) }

  function importFromPainPoints() {
    const imported = painPoints.map(p => ({
      problem: p.pain_description,
      impact: p.annual_cost ? `Annual cost: ${formatCurrency(p.annual_cost)}` : '',
      annual_cost: p.annual_cost,
    }))
    setProblems(prev => [...prev, ...imported])
  }

  function importFromInsights() {
    const pains = insights.filter(i => ['pain', 'risk', 'objection'].includes(i.insight_type))
    const imported = pains.map(i => ({ problem: i.primary_text, impact: i.impact_text, annual_cost: null }))
    setProblems(prev => [...prev, ...imported])
  }

  async function saveProposal() {
    setSaving(true)
    try {
      const data = {
        deal_id: dealId, executive_summary: execSummary,
        problems_challenges: problems, solutions_benefits: solutions,
        total_annual_impact: totalImpact, implementation_investment: investment || formatCurrency(deal?.deal_value),
        expected_roi: expectedRoi, is_current: true, created_by: profile?.id,
      }

      if (proposal) {
        await supabase.from('proposal_documents').update(data).eq('id', proposal.id)
      } else {
        data.version = 1
        const { data: newProp } = await supabase.from('proposal_documents').insert(data).select().single()
        setProposal(newProp)
      }

      // Save settings
      await supabase.from('proposal_settings').upsert({
        deal_id: dealId, ...proposalSettings,
      }, { onConflict: 'deal_id' })
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
  }

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

  function updateSettings(field, value) {
    setProposalSettings(prev => ({ ...prev, [field]: value }))
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const S = proposalSettings
  const autoTotalImpact = painPoints.reduce((s, p) => s + (p.annual_cost || 0), 0)

  const tabs = [
    { key: 'builder', label: 'Builder' },
    { key: 'preview', label: 'Preview' },
    { key: 'display', label: 'Display Settings' },
    { key: 'share', label: `Share (${shares.length})` },
  ]

  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + 30)
  const validUntilStr = formatDateLong(validUntil.toISOString().split('T')[0])

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
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Proposal Builder</div>
            <div style={{ fontSize: 13, color: T.textSecondary }}>{deal.company_name}</div>
          </div>
          <Button primary onClick={saveProposal} disabled={saving}>{saving ? 'Saving...' : 'Save Proposal'}</Button>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: 24, maxWidth: 1100 }}>

        {/* BUILDER TAB */}
        {tab === 'builder' && (
          <div>
            <Card title="Executive Summary">
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                value={execSummary}
                onChange={e => setExecSummary(e.target.value)}
                placeholder={`${deal.company_name} requires a modern financial platform to...`}
              />
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Problems */}
              <Card
                title="Problems / Challenges"
                action={
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={importFromPainPoints}>Import Pain Points</Button>
                    <Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={importFromInsights}>Import Insights</Button>
                    <Button style={{ padding: '4px 10px', fontSize: 10 }} onClick={addProblem}>+ Add</Button>
                  </div>
                }
              >
                {problems.length === 0 ? (
                  <div style={{ color: T.textMuted, fontSize: 13, padding: '8px 0' }}>
                    No problems added. Click '+ Add' or import from Pain Points / Insights.
                  </div>
                ) : problems.map((p, i) => (
                  <div key={i} style={{
                    padding: 12, background: T.errorLight, borderRadius: 6,
                    marginBottom: 8, border: `1px solid ${T.error}15`, position: 'relative',
                  }}>
                    <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
                      <button onClick={() => moveProblem(i, -1)} disabled={i === 0}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 12, opacity: i === 0 ? 0.3 : 1 }}>{'\u25B2'}</button>
                      <button onClick={() => moveProblem(i, 1)} disabled={i === problems.length - 1}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 12, opacity: i === problems.length - 1 ? 0.3 : 1 }}>{'\u25BC'}</button>
                      <button onClick={() => removeProblem(i)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14,
                      }}>&#10005;</button>
                    </div>
                    <input
                      style={{ ...inputStyle, marginBottom: 6, background: 'white', fontSize: 13, fontWeight: 600 }}
                      value={p.problem} onChange={e => updateProblem(i, 'problem', e.target.value)}
                      placeholder="Problem description"
                    />
                    <input
                      style={{ ...inputStyle, background: 'white', fontSize: 12 }}
                      value={p.impact} onChange={e => updateProblem(i, 'impact', e.target.value)}
                      placeholder="Business impact"
                    />
                    {p.annual_cost != null && p.annual_cost > 0 && (
                      <div style={{ fontSize: 11, color: T.error, fontWeight: 600, marginTop: 4 }}>
                        Annual Cost: {formatCurrency(p.annual_cost)}
                      </div>
                    )}
                  </div>
                ))}
              </Card>

              {/* Solutions */}
              <Card
                title="Solutions / Benefits"
                action={<Button style={{ padding: '4px 12px', fontSize: 11 }} onClick={addSolution}>+ Add</Button>}
              >
                {solutions.length === 0 ? (
                  <div style={{ color: T.textMuted, fontSize: 13, padding: '8px 0' }}>No solutions added yet.</div>
                ) : solutions.map((s, i) => (
                  <div key={i} style={{
                    padding: 12, background: T.successLight, borderRadius: 6,
                    marginBottom: 8, border: `1px solid ${T.success}15`, position: 'relative',
                  }}>
                    <button onClick={() => removeSolution(i)} style={{
                      position: 'absolute', top: 8, right: 8, background: 'none',
                      border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14,
                    }}>&#10005;</button>
                    <input
                      style={{ ...inputStyle, marginBottom: 6, background: 'white', fontSize: 13, fontWeight: 600 }}
                      value={s.solution} onChange={e => updateSolution(i, 'solution', e.target.value)}
                      placeholder="Solution"
                    />
                    <input
                      style={{ ...inputStyle, background: 'white', fontSize: 12 }}
                      value={s.benefit} onChange={e => updateSolution(i, 'benefit', e.target.value)}
                      placeholder="Benefit"
                    />
                  </div>
                ))}
              </Card>
            </div>

            <Card title="Financial Summary">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Total Annual Impact</label>
                  <input style={inputStyle} value={totalImpact || (autoTotalImpact > 0 ? formatCurrency(autoTotalImpact) : '')}
                    onChange={e => setTotalImpact(e.target.value)} placeholder="e.g. $500K+" />
                  {autoTotalImpact > 0 && !totalImpact && (
                    <div style={{ fontSize: 11, color: T.success, marginTop: 4 }}>Auto: {formatCurrency(autoTotalImpact)} from pain points</div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Implementation Investment</label>
                  <input style={inputStyle} value={investment} onChange={e => setInvestment(e.target.value)}
                    placeholder={formatCurrency(deal.deal_value)} />
                </div>
                <div>
                  <label style={labelStyle}>Expected ROI</label>
                  <input style={inputStyle} value={expectedRoi} onChange={e => setExpectedRoi(e.target.value)}
                    placeholder="e.g. 130% Year 1" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* PREVIEW TAB */}
        {tab === 'preview' && (
          <div style={{
            background: '#fff', border: `1px solid ${T.border}`, borderRadius: 8,
            padding: '40px 48px', maxWidth: 900, margin: '0 auto', boxShadow: T.shadow,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.sageGreen }}>Sage</div>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: T.text }}>{deal.company_name}</div>
                <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>Proposal</div>
              </div>
              <div style={{ fontSize: 11, color: T.textSecondary, textAlign: 'right' }}>
                Offer Valid Until:<br />{validUntilStr}
              </div>
            </div>

            {/* Contract details */}
            {primaryQuote && (
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12,
                padding: 16, background: T.surfaceAlt, borderRadius: 6, marginBottom: 24,
                border: `1px solid ${T.border}`,
              }}>
                {[
                  ['Contract Start', primaryQuote.contract_start_date ? formatDateLong(primaryQuote.contract_start_date) : 'TBD'],
                  ['Contract Length', `${primaryQuote.contract_years || 3} years`],
                  ['Payment Terms', primaryQuote.payment_terms || 'Annual'],
                  ['Price Increases', primaryQuote.price_increases || 'N/A'],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Order Schedule */}
            {!S.hide_order_schedule && quoteLineItems.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Order Schedule
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Product</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Qty</th>
                      {!S.hide_list_price_column && <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>List Price</th>}
                      {!S.hide_discount_column && <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Discount</th>}
                      {!S.hide_net_price_column && <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Net Price</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {quoteLineItems.map((li, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                        <td style={{ padding: '8px 10px', color: T.text }}>{li.products?.product_name || 'Product'}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{li.quantity}</td>
                        {!S.hide_list_price_column && <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(li.list_price)}</td>}
                        {!S.hide_discount_column && <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.success }}>{li.discount_percentage ? `${li.discount_percentage}%` : '--'}</td>}
                        {!S.hide_net_price_column && <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>{formatCurrency(li.net_price)}</td>}
                      </tr>
                    ))}
                  </tbody>
                  {!S.hide_total_row && primaryQuote && (
                    <tfoot>
                      <tr style={{ borderTop: `2px solid ${T.border}` }}>
                        <td colSpan={S.hide_list_price_column && S.hide_discount_column ? 1 : 2} style={{ padding: '10px', fontWeight: 700 }}>Subscription Total</td>
                        {!S.hide_list_price_column && <td />}
                        {!S.hide_discount_column && <td />}
                        {!S.hide_net_price_column && <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{formatCurrency(primaryQuote.subscription_net_total)}</td>}
                      </tr>
                      <tr>
                        <td colSpan={S.hide_list_price_column && S.hide_discount_column ? 1 : 2} style={{ padding: '10px', fontWeight: 700 }}>Annual Total</td>
                        {!S.hide_list_price_column && <td />}
                        {!S.hide_discount_column && <td />}
                        {!S.hide_net_price_column && <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, fontSize: 16, color: T.primary, fontFeatureSettings: '"tnum"' }}>{formatCurrency(primaryQuote.net_price)}</td>}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            {/* Incentives */}
            {!S.hide_incentives_section && primaryQuote && (primaryQuote.free_months > 0 || primaryQuote.signing_bonus > 0) && (
              <div style={{ marginBottom: 24, padding: 16, background: T.successLight, borderRadius: 6, border: `1px solid ${T.success}20` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8 }}>Incentives</div>
                <div style={{ display: 'flex', gap: 24 }}>
                  {primaryQuote.free_months > 0 && (
                    <div><span style={{ fontSize: 13, color: T.textSecondary }}>Free Months:</span> <strong>{primaryQuote.free_months}</strong></div>
                  )}
                  {primaryQuote.signing_bonus > 0 && (
                    <div><span style={{ fontSize: 13, color: T.textSecondary }}>Signing Bonus:</span> <strong>{formatCurrency(primaryQuote.signing_bonus)}</strong></div>
                  )}
                </div>
              </div>
            )}

            {/* Payment Schedule */}
            {!S.hide_payment_schedule && paymentSchedules.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Payment Schedule
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
                      {['Billing Date', 'Due Date', 'Type', 'Period', 'Amount'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paymentSchedules.map((ps, i) => {
                      const typeBg = ps.payment_type === 'implementation' ? 'rgba(139, 92, 246, 0.06)'
                        : ps.payment_type === 'subscription' ? 'rgba(93, 173, 226, 0.06)'
                        : ps.payment_type === 'free_month' ? T.errorLight : 'transparent'
                      const typeColor = ps.payment_type === 'implementation' ? '#8b5cf6'
                        : ps.payment_type === 'subscription' ? T.primary : T.error
                      return (
                        <tr key={i} style={{ background: typeBg, borderBottom: `1px solid ${T.borderLight}` }}>
                          <td style={{ padding: '8px 10px' }}>{ps.payment_date ? formatDateLong(ps.payment_date) : '--'}</td>
                          <td style={{ padding: '8px 10px' }}>{ps.due_date ? formatDateLong(ps.due_date) : '--'}</td>
                          <td style={{ padding: '8px 10px' }}><Badge color={typeColor}>{ps.payment_type}</Badge></td>
                          <td style={{ padding: '8px 10px' }}>{ps.period_label || '--'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>{formatCurrency(ps.amount)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* TCO Breakdown */}
            {!S.hide_tco_section && tcoBreakdown.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Total Cost of Ownership
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Category</th>
                      {tcoBreakdown.map(yr => (
                        <th key={yr.year_number} style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Year {yr.year_number}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {['subscription', 'implementation', 'services'].map(cat => (
                      <tr key={cat} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                        <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>{cat}</td>
                        {tcoBreakdown.map(yr => (
                          <td key={yr.year_number} style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                            {formatCurrency(yr[cat] || 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr style={{ borderTop: `2px solid ${T.border}` }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>Total</td>
                      {tcoBreakdown.map(yr => (
                        <td key={yr.year_number} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontFeatureSettings: '"tnum"' }}>
                          {formatCurrency(yr.total || 0)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Problems & Solutions */}
            {(problems.length > 0 || solutions.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                {problems.length > 0 && (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Challenges Identified
                    </div>
                    {problems.map((p, i) => (
                      <div key={i} style={{ padding: '14px 18px', background: '#fef2f2', borderRadius: 6, marginBottom: 8, borderLeft: `3px solid ${T.error}` }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#991b1b' }}>{p.problem}</div>
                        {p.impact && <div style={{ fontSize: 13, color: '#7f1d1d', marginTop: 4 }}>Impact: {p.impact}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {solutions.length > 0 && (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Proposed Solutions
                    </div>
                    {solutions.map((s, i) => (
                      <div key={i} style={{ padding: '14px 18px', background: '#f0fdf4', borderRadius: 6, marginBottom: 8, borderLeft: `3px solid ${T.success}` }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>{s.solution}</div>
                        {s.benefit && <div style={{ fontSize: 13, color: '#15803d', marginTop: 4 }}>{s.benefit}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Financial Summary */}
            {(totalImpact || investment || expectedRoi || autoTotalImpact > 0) && (
              <div style={{ marginBottom: 24, padding: 24, background: T.surfaceAlt, borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Financial Summary
                </div>
                <div style={{ display: 'flex', gap: 32 }}>
                  {(totalImpact || autoTotalImpact > 0) && (
                    <div>
                      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Annual Impact</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: T.success }}>{totalImpact || formatCurrency(autoTotalImpact)}</div>
                    </div>
                  )}
                  {(investment || deal.deal_value) && (
                    <div>
                      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Investment</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: T.text }}>{investment || formatCurrency(deal.deal_value)}</div>
                    </div>
                  )}
                  {expectedRoi && (
                    <div>
                      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Expected ROI</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: T.primary }}>{expectedRoi}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Executive Summary */}
            {execSummary && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Executive Summary
                </div>
                <div style={{ fontSize: 14, color: T.text, lineHeight: 1.7 }}>{execSummary}</div>
              </div>
            )}
          </div>
        )}

        {/* DISPLAY SETTINGS TAB */}
        {tab === 'display' && (
          <div>
            <Card title="Display Settings">
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Primary Color</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={{ ...inputStyle, width: 120 }}
                    value={S.primary_color || '#5DADE2'}
                    onChange={e => updateSettings('primary_color', e.target.value)}
                    placeholder="#5DADE2" />
                  <div style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: S.primary_color || '#5DADE2',
                    border: `1px solid ${T.border}`,
                  }} />
                </div>
              </div>

              {[
                ['hide_order_schedule', 'Hide Order Schedule'],
                ['hide_list_price_column', 'Hide List Price Column'],
                ['hide_discount_column', 'Hide Discount Column'],
                ['hide_net_price_column', 'Hide Net Price Column'],
                ['hide_discount_percent', 'Hide Discount Percent'],
                ['hide_total_discount', 'Hide Total Discount'],
                ['hide_total_row', 'Hide Total Row'],
                ['hide_incentives_section', 'Hide Incentives Section'],
                ['hide_payment_schedule', 'Hide Payment Schedule'],
                ['hide_tco_section', 'Hide TCO Section'],
              ].map(([key, label]) => (
                <div key={key} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 0', borderBottom: `1px solid ${T.borderLight}`,
                }}>
                  <span style={{ fontSize: 13, color: T.text }}>{label}</span>
                  <div
                    onClick={() => updateSettings(key, !S[key])}
                    style={{
                      width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
                      background: S[key] ? T.primary : T.borderLight,
                      position: 'relative', transition: 'background 0.2s',
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      position: 'absolute', top: 2,
                      left: S[key] ? 20 : 2,
                      boxShadow: T.shadow, transition: 'left 0.2s',
                    }} />
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* SHARE TAB */}
        {tab === 'share' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button primary onClick={createShareLink}>Create Share Link</Button>
            </div>
            {shares.length === 0 ? (
              <EmptyState message="No share links yet. Create one to share this proposal." />
            ) : shares.map(share => (
              <Card key={share.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontFamily: T.mono, color: T.text, marginBottom: 4 }}>
                      {window.location.origin}/proposal/shared/{share.share_token || share.id}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 11, color: T.textSecondary, alignItems: 'center' }}>
                      <span>Views: {share.view_count || 0}</span>
                      {share.expires_at && <span>Expires: {formatDateLong(share.expires_at)}</span>}
                      <span onClick={() => toggleShareActive(share)} style={{ cursor: 'pointer' }}>
                        {share.is_active !== false
                          ? <Badge color={T.success}>Active</Badge>
                          : <Badge color={T.error}>Inactive</Badge>}
                      </span>
                    </div>
                  </div>
                  <Button style={{ padding: '6px 14px', fontSize: 12 }}
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/proposal/shared/${share.share_token || share.id}`)}>
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
