import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../contexts/OrgContext'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, formatDateLong } from '../lib/theme'
import { Spinner, Button } from '../components/Shared'

const BILLING_TYPE_LABELS = {
  fixed_bid_50_50: 'Fixed Bid (50% on start, 50% on completion)',
  tm_monthly: 'Time & Materials (monthly invoices)',
  one_time: 'One-time fee',
  milestone_custom: 'Custom milestone schedule',
}

export default function ProposalRenderer() {
  const { dealId, quoteId } = useParams()
  const nav = useNavigate()
  const { org } = useOrg()
  const { profile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deal, setDeal] = useState(null)
  const [quote, setQuote] = useState(null)
  const [lines, setLines] = useState([])
  const [productMap, setProductMap] = useState({})
  const [implItems, setImplItems] = useState([])
  const [partnerBlocks, setPartnerBlocks] = useState([])
  const [partnerLines, setPartnerLines] = useState([])
  const [contractTerm, setContractTerm] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [showSchedule, setShowSchedule] = useState(false)

  useEffect(() => { load() }, [dealId, quoteId])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [dealRes, quoteRes, linesRes, implRes, blocksRes, plinesRes, schedRes] = await Promise.all([
        supabase.from('deals').select('id, company_name, customer_logo_url').eq('id', dealId).single(),
        supabase.from('quotes').select('*').eq('id', quoteId).single(),
        supabase.from('quote_lines').select('*').eq('quote_id', quoteId).order('line_order'),
        supabase.from('quote_implementation_items').select('*').eq('quote_id', quoteId).order('sort_order'),
        supabase.from('quote_partner_blocks').select('*').eq('quote_id', quoteId).order('sort_order'),
        supabase.from('quote_partner_lines').select('*').eq('quote_id', quoteId).order('sort_order'),
        supabase.from('quote_payment_schedule').select('*').eq('quote_id', quoteId).order('sequence_number'),
      ])
      if (dealRes.error) throw dealRes.error
      if (quoteRes.error) throw quoteRes.error
      setDeal(dealRes.data)
      setQuote(quoteRes.data)
      setLines(linesRes.data || [])
      setImplItems(implRes.data || [])
      setPartnerBlocks(blocksRes.data || [])
      setPartnerLines(plinesRes.data || [])
      setSchedule(schedRes.data || [])

      // Load only the products that appear on this quote
      const productIds = Array.from(new Set((linesRes.data || []).map(l => l.product_id)))
      if (productIds.length) {
        const { data: products } = await supabase.from('products').select('*').in('id', productIds)
        const map = {}
        for (const p of products || []) map[p.id] = p
        setProductMap(map)
      }

      if (quoteRes.data?.contract_term_id) {
        const { data: term } = await supabase.from('contract_terms').select('*').eq('id', quoteRes.data.contract_term_id).maybeSingle()
        setContractTerm(term || null)
      }
    } catch (e) {
      console.error('[ProposalRenderer] load failed:', e)
      setError(e?.message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  // Group lines: parents + their children
  const orderedLines = useMemo(() => {
    const byParent = new Map()
    for (const ln of lines) {
      const key = ln.parent_line_id || '__root'
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key).push(ln)
    }
    const roots = (byParent.get('__root') || []).slice().sort((a, b) => a.line_order - b.line_order)
    const out = []
    for (const r of roots) {
      out.push({ line: r, children: (byParent.get(r.id) || []).slice().sort((a, b) => a.line_order - b.line_order) })
    }
    return out
  }, [lines])

  const orgLogoUrl = org?.logo_url
  const customerLogoUrl = deal?.customer_logo_url
  const aeName = profile?.full_name || profile?.email
  const orgName = org?.name || 'Our Company'
  const orgPrimary = org?.primary_color || T.primary

  if (loading) return <Spinner />
  if (error) return <div style={{ padding: 40, color: T.error }}>{error}</div>
  if (!quote || !deal) return <div style={{ padding: 40, color: T.textMuted }}>Proposal not found</div>

  const sageSubTotal = Number(quote.sage_subscription_total) || 0
  const sageImplTotal = Number(quote.sage_implementation_total) || 0
  const sageTotal = Number(quote.sage_total) || 0
  const partnerSubTotal = Number(quote.partner_subscription_total) || 0
  const partnerImplTotal = Number(quote.partner_implementation_total) || 0
  const partnerTotal = Number(quote.partner_total) || 0
  const solutionTotal = Number(quote.solution_total) || 0
  const sageMonthly = sageSubTotal / 12
  const signingBonusValue = Number(quote.signing_bonus_amount) > 0
    ? Number(quote.signing_bonus_amount)
    : sageMonthly * (Number(quote.signing_bonus_months) || 0)

  const termYears = contractTerm?.term_years || 3
  const sageTcv = sageSubTotal * termYears + sageImplTotal - signingBonusValue
  const partnerTcv = partnerBlocks.reduce((sum, b) => {
    const bLines = partnerLines.filter(l => l.block_id === b.id)
    const blockNet = bLines.reduce((s, l) => s + (Number(l.extended) || 0), 0)
    return sum + blockNet * (b.term_years || 1)
  }, 0)

  return (
    <div>
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .proposal-shell { background: #fff !important; padding: 0 !important; box-shadow: none !important; border: none !important; }
          .proposal-section { page-break-inside: avoid; }
          .proposal-section.page-break { page-break-before: always; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
          .proposal-logo-org, .proposal-logo-customer { width: 120px !important; max-height: 70px !important; }
        }
      `}</style>

      {/* Toolbar (hidden on print) */}
      <div className="no-print" style={{ padding: '12px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => nav(`/deal/${dealId}/quote/${quoteId}`)} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Back to Editor</button>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0, flex: 1 }}>Proposal Preview · {deal.company_name}</h2>
        <Button onClick={() => navigator.clipboard.writeText(window.location.href).then(() => alert('Link copied'))} style={{ padding: '6px 14px' }}>Copy share link</Button>
        <Button primary onClick={() => window.print()} style={{ padding: '6px 14px' }}>Print</Button>
      </div>

      {/* Proposal */}
      <div className="proposal-shell" style={{ background: '#fff', maxWidth: 880, margin: '24px auto', padding: '48px 56px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontFamily: T.font, color: T.text }}>

        {/* ── Header ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, marginBottom: 32, paddingBottom: 24, borderBottom: `2px solid ${T.borderLight}`, alignItems: 'flex-start' }}>
          <div style={{ textAlign: 'left' }}>
            {orgLogoUrl ? (
              <img className="proposal-logo-org" src={orgLogoUrl} alt={orgName} style={{ width: 120, maxHeight: 70, objectFit: 'contain' }} />
            ) : (
              <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>(No org logo — upload at /settings/organization)</div>
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Proposal for</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: T.text, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{deal.company_name}</div>
            <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 8 }}>
              Prepared by {aeName || 'your account team'}, {orgName}<br />
              {formatDateLong(new Date().toISOString())} · {quote.name} v{quote.version}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {customerLogoUrl ? (
              <img className="proposal-logo-customer" src={customerLogoUrl} alt={deal.company_name} style={{ width: 120, maxHeight: 70, objectFit: 'contain', marginLeft: 'auto' }} />
            ) : (
              <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>(No customer logo — upload from the deal page)</div>
            )}
          </div>
        </div>

        {/* ── Section 1: Sage Terms ── */}
        <Section title="Sage Terms" accent={orgPrimary}>
          {!contractTerm ? (
            <div style={{ color: T.textMuted, fontStyle: 'italic' }}>No contract term selected.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <Stat label="Term length" value={`${contractTerm.term_years} year${contractTerm.term_years === 1 ? '' : 's'}`} />
                <Stat label="Term template" value={contractTerm.name} />
                <Stat label="Start" value={quote.contract_start_date ? formatDateLong(quote.contract_start_date) : 'TBD'} />
                <Stat label="Billing" value={(quote.billing_cadence || 'annual').replace(/^./, c => c.toUpperCase())} />
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>YoY caps</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                  {contractTerm.yoy_caps.map((c, i) => (
                    <li key={i}>Year {i + 1}: {Number(c) === 0 ? 'locked' : `up to ${Number(c)}%`}</li>
                  ))}
                </ul>
              </div>
              {contractTerm.description && (
                <div style={{ marginTop: 10, fontSize: 12, color: T.textSecondary, lineHeight: 1.6 }}>{contractTerm.description}</div>
              )}
            </>
          )}
        </Section>

        {/* ── Section 2: Sage Subscription ── */}
        <Section title="Sage Subscription" accent={orgPrimary} pageBreak>
          {orderedLines.length === 0 ? (
            <div style={{ color: T.textMuted, fontStyle: 'italic' }}>No subscription lines.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${orgPrimary}` }}>
                  <th style={pthStyle}>Product</th>
                  <th style={{ ...pthStyle, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...pthStyle, textAlign: 'right' }}>Year-1</th>
                </tr>
              </thead>
              <tbody>
                {orderedLines.map(({ line, children }) => {
                  const product = productMap[line.product_id]
                  return (
                    <>
                      <tr key={line.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                        <td style={{ padding: '8px 6px', fontWeight: 600 }}>
                          {product?.name || 'Unknown'}
                          {product?.sku && <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 6, fontFamily: T.mono }}>({product.sku})</span>}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{line.quantity}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 600 }}>{formatCurrency(Number(line.extended) || 0)}</td>
                      </tr>
                      {children.map(c => {
                        const cp = productMap[c.product_id]
                        return (
                          <tr key={c.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                            <td style={{ padding: '4px 6px 4px 22px', fontSize: 12, color: T.textSecondary }}>↳ {cp?.name || 'Module'}</td>
                            <td style={{ padding: '4px 6px', textAlign: 'right', fontSize: 12, color: T.textSecondary, fontFeatureSettings: '"tnum"' }}>{c.quantity}</td>
                            <td style={{ padding: '4px 6px', textAlign: 'right', fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>Included</td>
                          </tr>
                        )
                      })}
                    </>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${orgPrimary}`, background: `${orgPrimary}10` }}>
                  <td style={{ padding: '10px 6px', fontWeight: 700 }}>Year-1 Subtotal</td>
                  <td></td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: orgPrimary, fontFeatureSettings: '"tnum"' }}>{formatCurrency(sageSubTotal)}</td>
                </tr>
                {termYears > 1 && (
                  <tr>
                    <td style={{ padding: '6px', fontSize: 11, color: T.textSecondary }}>Total contract value (subscription × {termYears} years, before incentives)</td>
                    <td></td>
                    <td style={{ padding: '6px', textAlign: 'right', fontSize: 11, color: T.textSecondary, fontFeatureSettings: '"tnum"' }}>{formatCurrency(sageSubTotal * termYears)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </Section>

        {/* ── Section 3: Sage Implementation ── */}
        {implItems.filter(i => i.source === 'sage').length > 0 && (
          <Section title="Sage Implementation" accent={orgPrimary}>
            {implItems.filter(i => i.source === 'sage').map(i => (
              <ImplementationBlock key={i.id} item={i} accent={orgPrimary} />
            ))}
            <div style={{ marginTop: 12, padding: '10px 14px', background: `${orgPrimary}10`, borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.text, textTransform: 'uppercase' }}>Sage Implementation Total</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: orgPrimary, fontFeatureSettings: '"tnum"' }}>{formatCurrency(sageImplTotal)}</span>
            </div>
          </Section>
        )}

        {/* ── Section 4: Promo / Free months (conditional) ── */}
        {(Number(quote.free_months) > 0 || signingBonusValue > 0) && (
          <Section title="Promo &amp; Incentives" accent={T.success}>
            {Number(quote.free_months) > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong>{quote.free_months} free month{Number(quote.free_months) === 1 ? '' : 's'}</strong> ({quote.free_months_placement === 'front' ? 'deferred from start' : 'extending Year 1'})
              </div>
            )}
            {signingBonusValue > 0 && (
              <div>
                <strong>Signing incentive: {formatCurrency(signingBonusValue)}</strong> off Year 1
                {Number(quote.signing_bonus_months) > 0 && <span style={{ color: T.textSecondary }}> ({quote.signing_bonus_months} months × monthly subscription)</span>}
              </div>
            )}
          </Section>
        )}

        {/* ── Section 5: Sage Total ── */}
        <Section title="Sage Total" accent={orgPrimary}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, fontSize: 13, lineHeight: 1.8 }}>
            <div>Subscription Year 1</div><div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(sageSubTotal)}</div>
            {termYears > 1 && <>
              <div style={{ color: T.textSecondary }}>Subscription years 2–{termYears}</div>
              <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.textSecondary }}>{formatCurrency(sageSubTotal * (termYears - 1))}</div>
            </>}
            <div>Implementation</div><div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(sageImplTotal)}</div>
            {signingBonusValue > 0 && <>
              <div style={{ color: T.success }}>Signing incentive</div>
              <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.success }}>−{formatCurrency(signingBonusValue)}</div>
            </>}
            <div style={{ paddingTop: 10, borderTop: `2px solid ${orgPrimary}`, fontSize: 16, fontWeight: 800 }}>Sage Total ({termYears}-year)</div>
            <div style={{ paddingTop: 10, borderTop: `2px solid ${orgPrimary}`, fontSize: 18, fontWeight: 800, color: orgPrimary, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(sageTcv)}</div>
          </div>
        </Section>

        {/* ── Sections 6-9: Partners ── */}
        {partnerBlocks.length > 0 && (
          <>
            <Section title="Partner Terms" accent={T.sageGreen} pageBreak>
              {partnerBlocks.map(b => (
                <div key={b.id} style={{ marginBottom: 10, padding: 10, background: T.surfaceAlt, borderRadius: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>{b.partner_name}</div>
                  <div style={{ fontSize: 12, color: T.textSecondary }}>
                    {b.term_years}-year · {b.billing_cadence} billing
                    {Number(b.partner_global_discount_pct) > 0 && ` · ${(Number(b.partner_global_discount_pct) * 100).toFixed(1)}% block discount`}
                  </div>
                  {b.notes && <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>{b.notes}</div>}
                </div>
              ))}
            </Section>

            <Section title="Partner Subscription" accent={T.sageGreen}>
              {partnerBlocks.map(b => {
                const bLines = partnerLines.filter(l => l.block_id === b.id)
                const blockNet = bLines.reduce((s, l) => s + (Number(l.extended) || 0), 0)
                return (
                  <div key={b.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 6 }}>{b.partner_name}</div>
                    {bLines.length === 0 ? (
                      <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>No lines.</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${T.sageGreen}` }}>
                            <th style={pthStyle}>Item</th>
                            <th style={{ ...pthStyle, textAlign: 'right' }}>Qty</th>
                            <th style={{ ...pthStyle, textAlign: 'right' }}>Year-1</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bLines.map(l => (
                            <tr key={l.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                              <td style={{ padding: '6px', fontWeight: 600 }}>{l.name}{l.sku && <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 4, fontFamily: T.mono }}>({l.sku})</span>}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{l.quantity}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 600 }}>{formatCurrency(Number(l.extended) || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: `1px solid ${T.sageGreen}`, background: `${T.sageGreen}10` }}>
                            <td style={{ padding: '6px', fontSize: 12, fontWeight: 700 }}>Year-1 Subtotal</td>
                            <td></td>
                            <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700, color: T.sageGreen, fontFeatureSettings: '"tnum"' }}>{formatCurrency(blockNet)}</td>
                          </tr>
                          {b.term_years > 1 && (
                            <tr>
                              <td style={{ padding: '4px 6px', fontSize: 11, color: T.textSecondary }}>{b.term_years}-year total</td>
                              <td></td>
                              <td style={{ padding: '4px 6px', textAlign: 'right', fontSize: 11, color: T.textSecondary, fontFeatureSettings: '"tnum"' }}>{formatCurrency(blockNet * b.term_years)}</td>
                            </tr>
                          )}
                        </tfoot>
                      </table>
                    )}
                  </div>
                )
              })}
            </Section>

            {implItems.filter(i => i.source === 'partner').length > 0 && (
              <Section title="Partner Implementation" accent={T.sageGreen}>
                {implItems.filter(i => i.source === 'partner').map(i => (
                  <ImplementationBlock key={i.id} item={i} accent={T.sageGreen} />
                ))}
                <div style={{ marginTop: 12, padding: '10px 14px', background: `${T.sageGreen}10`, borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text, textTransform: 'uppercase' }}>Partner Implementation Total</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: T.sageGreen, fontFeatureSettings: '"tnum"' }}>{formatCurrency(partnerImplTotal)}</span>
                </div>
              </Section>
            )}

            <Section title="Partner Total" accent={T.sageGreen}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, fontSize: 13, lineHeight: 1.8 }}>
                <div>Subscription (across {partnerBlocks.length} block{partnerBlocks.length === 1 ? '' : 's'}, total contract value)</div>
                <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(partnerTcv)}</div>
                <div>Implementation</div>
                <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(partnerImplTotal)}</div>
                <div style={{ paddingTop: 10, borderTop: `2px solid ${T.sageGreen}`, fontSize: 16, fontWeight: 800 }}>Partner Total</div>
                <div style={{ paddingTop: 10, borderTop: `2px solid ${T.sageGreen}`, fontSize: 18, fontWeight: 800, color: T.sageGreen, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(partnerTcv + partnerImplTotal)}</div>
              </div>
            </Section>
          </>
        )}

        {/* ── Section 10: Solution Total ── */}
        <Section title="Solution Total" accent={orgPrimary} pageBreak>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, fontSize: 14, lineHeight: 1.8 }}>
            <div>Sage Total</div>
            <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(sageTotal)}</div>
            {partnerBlocks.length > 0 && <>
              <div>Partner Total</div>
              <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(partnerTotal)}</div>
            </>}
            <div style={{ paddingTop: 14, borderTop: `3px solid ${orgPrimary}`, fontSize: 22, fontWeight: 900 }}>Solution Total</div>
            <div style={{ paddingTop: 14, borderTop: `3px solid ${orgPrimary}`, fontSize: 28, fontWeight: 900, color: orgPrimary, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(solutionTotal)}</div>
          </div>
        </Section>

        {/* Optional appendix: payment schedule */}
        {schedule.length > 0 && (
          <div className="proposal-section page-break" style={{ marginTop: 36, borderTop: `1px solid ${T.borderLight}`, paddingTop: 24 }}>
            <div className="no-print" style={{ marginBottom: 10 }}>
              <Button onClick={() => setShowSchedule(s => !s)} style={{ padding: '6px 14px', fontSize: 12 }}>{showSchedule ? 'Hide' : 'Show'} payment schedule</Button>
            </div>
            <div style={{ display: showSchedule ? 'block' : 'none' }} className="schedule-block">
              <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Payment Schedule</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${orgPrimary}` }}>
                    <th style={{ ...pthStyle, fontSize: 9 }}>Date</th>
                    <th style={{ ...pthStyle, fontSize: 9 }}>Description</th>
                    <th style={{ ...pthStyle, fontSize: 9, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map(r => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                      <td style={{ padding: '4px 6px', fontFeatureSettings: '"tnum"', color: T.textSecondary }}>{r.invoice_date}</td>
                      <td style={{ padding: '4px 6px' }}>{r.description}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 600 }}>{formatCurrency(Number(r.amount) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* In print, always show schedule */}
            <style>{`@media print { .schedule-block { display: block !important; } }`}</style>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, accent, children, pageBreak }) {
  return (
    <div className={`proposal-section${pageBreak ? ' page-break' : ''}`} style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: accent, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `2px solid ${accent}30`, paddingBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{value}</div>
    </div>
  )
}

function ImplementationBlock({ item, accent }) {
  return (
    <div style={{ marginBottom: 14, padding: 12, border: `1px solid ${accent}30`, borderRadius: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{item.name}</div>
          <div style={{ fontSize: 11, color: T.textSecondary }}>{item.implementor_name} · {BILLING_TYPE_LABELS[item.billing_type] || item.billing_type}</div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: accent, fontFeatureSettings: '"tnum"' }}>{formatCurrency(Number(item.total_amount) || 0)}</div>
      </div>
      {item.description && <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 6 }}>{item.description}</div>}
      <div style={{ fontSize: 11, color: T.textMuted }}>
        {item.billing_type === 'tm_monthly' && item.tm_weeks && (
          <>{item.tm_weeks} weeks → {Math.ceil(item.tm_weeks / 4)} monthly invoices of {formatCurrency(Number(item.total_amount) / Math.ceil(item.tm_weeks / 4))} each</>
        )}
        {item.billing_type === 'fixed_bid_50_50' && (
          <>50% on start{item.estimated_start_date ? ` (${item.estimated_start_date})` : ''}; 50% on completion{item.estimated_completion_date ? ` (${item.estimated_completion_date})` : ''}</>
        )}
        {item.billing_type === 'one_time' && (
          <>One-time fee{item.estimated_start_date ? ` on ${item.estimated_start_date}` : ''}</>
        )}
      </div>
    </div>
  )
}

const pthStyle = { textAlign: 'left', padding: '6px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }
