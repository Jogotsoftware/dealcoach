import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, formatDate, formatDateLong } from '../lib/theme'
import { Card, Badge, Button, TabBar, EmptyState, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function QuoteEditor() {
  const { dealId, quoteId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deal, setDeal] = useState(null)
  const [quote, setQuote] = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [products, setProducts] = useState([])
  const [tab, setTab] = useState('products')
  const [showAddProduct, setShowAddProduct] = useState(false)

  // Contract terms
  const [contractYears, setContractYears] = useState(3)
  const [paymentTerms, setPaymentTerms] = useState('annual')
  const [contractStart, setContractStart] = useState('')
  const [globalDiscount, setGlobalDiscount] = useState(0)
  const [freeMonths, setFreeMonths] = useState(0)
  const [signingBonus, setSigningBonus] = useState(0)

  useEffect(() => { loadData() }, [dealId, quoteId])

  async function loadData() {
    setLoading(true)
    try {
      const [dealRes, productsRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', dealId).single(),
        supabase.from('products').select('*').eq('is_active', true).order('sort_order'),
      ])
      setDeal(dealRes.data)
      setProducts(productsRes.data || [])

      if (quoteId && quoteId !== 'new') {
        const { data: q } = await supabase.from('quotes').select('*').eq('id', quoteId).single()
        if (q) {
          setQuote(q)
          setContractYears(q.contract_years || 3)
          setPaymentTerms(q.payment_terms || 'annual')
          setContractStart(q.contract_start_date || '')
          setFreeMonths(q.free_months || 0)
          setSigningBonus(q.signing_bonus || 0)
        }
        const { data: items } = await supabase
          .from('quote_line_items')
          .select('*, products(*)')
          .eq('quote_id', quoteId)
          .order('line_order')
        setLineItems((items || []).map(i => ({
          id: i.id, product_id: i.product_id, product_name: i.products?.product_name || 'Unknown',
          category: i.products?.category || 'subscription', billing: i.products?.billing_frequency || 'annual',
          quantity: i.quantity, list_price: i.list_price, custom_price: i.custom_price,
          discount_pct: i.discount_percentage, net_price: i.net_price, override: i.override_discount,
        })))
      }
    } catch (err) {
      console.error('Error loading quote:', err)
    } finally {
      setLoading(false)
    }
  }

  function addProduct(product) {
    setLineItems(prev => [...prev, {
      id: `new_${Date.now()}`, product_id: product.id, product_name: product.product_name,
      category: product.category, billing: product.billing_frequency,
      quantity: 1, list_price: product.list_price, custom_price: null,
      discount_pct: globalDiscount, net_price: product.list_price * (1 - globalDiscount / 100),
      override: false,
    }])
    setShowAddProduct(false)
  }

  function updateLineItem(id, field, value) {
    setLineItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const updated = { ...item, [field]: value }
      // Recalculate net price
      const price = updated.custom_price != null ? updated.custom_price : updated.list_price
      const discount = updated.override ? updated.discount_pct : globalDiscount
      updated.discount_pct = discount
      updated.net_price = price * updated.quantity * (1 - discount / 100)
      return updated
    }))
  }

  function removeLineItem(id) {
    setLineItems(prev => prev.filter(i => i.id !== id))
  }

  // Calculations
  const subscriptionItems = lineItems.filter(i => i.category === 'subscription')
  const oneTimeItems = lineItems.filter(i => i.category !== 'subscription')

  const subscriptionListTotal = subscriptionItems.reduce((s, i) => s + (i.list_price * i.quantity), 0)
  const subscriptionNetTotal = subscriptionItems.reduce((s, i) => s + i.net_price, 0)
  const oneTimeTotal = oneTimeItems.reduce((s, i) => s + i.net_price, 0)
  const totalListPrice = lineItems.reduce((s, i) => s + (i.list_price * i.quantity), 0)
  const totalNetPrice = lineItems.reduce((s, i) => s + i.net_price, 0)
  const totalDiscount = totalListPrice - totalNetPrice
  const discountPct = totalListPrice > 0 ? (totalDiscount / totalListPrice * 100).toFixed(1) : 0
  const arr = subscriptionNetTotal
  const cmrr = arr / 12
  const freeMonthsValue = (subscriptionNetTotal / 12) * freeMonths
  const yearOneTotal = subscriptionNetTotal + oneTimeTotal - freeMonthsValue - signingBonus
  const tcv = (subscriptionNetTotal * contractYears) + oneTimeTotal - freeMonthsValue - signingBonus

  async function saveQuote() {
    setSaving(true)
    try {
      const quoteData = {
        deal_id: dealId, contract_years: contractYears, payment_terms: paymentTerms,
        contract_start_date: contractStart || null,
        list_price: totalListPrice, net_price: totalNetPrice,
        discount_amount: totalDiscount, discount_percent: parseFloat(discountPct) || 0,
        arr, cmrr, subscription_list_total: subscriptionListTotal,
        subscription_net_total: subscriptionNetTotal,
        subscription_discount_amount: subscriptionListTotal - subscriptionNetTotal,
        subscription_discount_percent: subscriptionListTotal > 0 ? ((subscriptionListTotal - subscriptionNetTotal) / subscriptionListTotal * 100) : 0,
        implementation_total: oneTimeItems.filter(i => i.category === 'implementation').reduce((s, i) => s + i.net_price, 0),
        services_total: oneTimeItems.filter(i => i.category === 'services').reduce((s, i) => s + i.net_price, 0),
        free_months: freeMonths, signing_bonus: signingBonus,
        year_one_total: yearOneTotal, total_contract_value: tcv,
        prepared_by: profile?.id, status: 'draft',
      }

      let savedQuoteId = quoteId && quoteId !== 'new' ? quoteId : null

      if (savedQuoteId) {
        await supabase.from('quotes').update(quoteData).eq('id', savedQuoteId)
      } else {
        quoteData.version = 1
        quoteData.is_primary = true
        const { data } = await supabase.from('quotes').insert(quoteData).select().single()
        savedQuoteId = data.id
      }

      // Delete existing line items and re-insert
      await supabase.from('quote_line_items').delete().eq('quote_id', savedQuoteId)
      if (lineItems.length > 0) {
        await supabase.from('quote_line_items').insert(lineItems.map((item, idx) => ({
          quote_id: savedQuoteId, product_id: item.product_id, quantity: item.quantity,
          list_price: item.list_price, custom_price: item.custom_price,
          discount_percentage: item.discount_pct, discount_amount: (item.list_price * item.quantity) - item.net_price,
          net_price: item.net_price, override_discount: item.override, line_order: idx,
        })))
      }

      // Update deal value to match quote
      await supabase.from('deals').update({ deal_value: arr, cmrr }).eq('id', dealId)

      navigate(`/deal/${dealId}`)
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const tabs = [
    { key: 'products', label: `Products (${lineItems.length})` },
    { key: 'terms', label: 'Contract Terms' },
    { key: 'summary', label: 'Summary' },
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
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Quote Editor</div>
            <div style={{ fontSize: 13, color: T.textSecondary }}>{deal.company_name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{formatCurrency(totalNetPrice)}</div>
            <div style={{ fontSize: 11, color: T.textSecondary }}>{formatCurrency(arr)} ARR | {formatCurrency(cmrr)}/mo CMRR</div>
          </div>
          <Button primary onClick={saveQuote} disabled={saving}>{saving ? 'Saving...' : 'Save Quote'}</Button>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: 24, maxWidth: 1200 }}>

        {/* PRODUCTS TAB */}
        {tab === 'products' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: T.textSecondary, fontWeight: 600 }}>Global Discount:</label>
                <input type="number" min="0" max="100" step="0.5" value={globalDiscount} onChange={e => setGlobalDiscount(Number(e.target.value) || 0)}
                  style={{ ...inputStyle, width: 80, padding: '6px 10px', textAlign: 'center' }} />
                <span style={{ fontSize: 12, color: T.textMuted }}>%</span>
              </div>
              <Button primary onClick={() => setShowAddProduct(true)}>+ Add Product</Button>
            </div>

            {/* Add Product Picker */}
            {showAddProduct && (
              <Card title="Select Product" style={{ marginBottom: 16 }}>
                <div style={{ maxHeight: 300, overflow: 'auto' }}>
                  {products.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: T.textMuted }}>
                      No products in catalog. Add products in Supabase.
                    </div>
                  ) : products.map(p => (
                    <div key={p.id} onClick={() => addProduct(p)} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${T.borderLight}`,
                      transition: 'background 0.1s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.product_name}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                          <Badge color={T.primary}>{p.category}</Badge>
                          <Badge color={T.textMuted}>{p.billing_frequency}</Badge>
                          {p.sku && <span style={{ fontSize: 11, color: T.textMuted }}>SKU: {p.sku}</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>
                        {formatCurrency(p.list_price)}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '10px 0 0', borderTop: `1px solid ${T.border}` }}>
                  <Button onClick={() => setShowAddProduct(false)}>Close</Button>
                </div>
              </Card>
            )}

            {/* Line Items Table */}
            {lineItems.length === 0 ? (
              <EmptyState message="No products added yet. Click '+ Add Product' to build the quote." />
            ) : (
              <Card>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                      {['Product', 'Type', 'Qty', 'List Price', 'Discount %', 'Net Price', ''].map((h, i) => (
                        <th key={i} style={{
                          textAlign: i >= 2 ? 'right' : 'left', padding: '8px 10px',
                          fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map(item => (
                      <tr key={item.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                        <td style={{ padding: '10px' }}>
                          <div style={{ fontWeight: 600, color: T.text }}>{item.product_name}</div>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <Badge color={item.category === 'subscription' ? T.primary : T.textMuted}>{item.category}</Badge>
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          <input type="number" min="1" value={item.quantity}
                            onChange={e => updateLineItem(item.id, 'quantity', Number(e.target.value) || 1)}
                            style={{ ...inputStyle, width: 60, padding: '5px 8px', textAlign: 'center' }} />
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                          {formatCurrency(item.list_price)}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          <input type="number" min="0" max="100" step="0.5"
                            value={item.discount_pct}
                            onChange={e => updateLineItem(item.id, 'discount_pct', Number(e.target.value) || 0)}
                            style={{ ...inputStyle, width: 70, padding: '5px 8px', textAlign: 'center' }} />
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"', color: T.text }}>
                          {formatCurrency(item.net_price)}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <button onClick={() => removeLineItem(item.id)} style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: T.textMuted, fontSize: 16, padding: 4, lineHeight: 1,
                          }}
                            onMouseEnter={e => e.currentTarget.style.color = T.error}
                            onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
                          >&#10005;</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${T.border}` }}>
                      <td colSpan={5} style={{ padding: '12px 10px', fontWeight: 700, color: T.text, textAlign: 'right' }}>
                        Total ({discountPct}% discount)
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, fontSize: 16, color: T.text, fontFeatureSettings: '"tnum"' }}>
                        {formatCurrency(totalNetPrice)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </Card>
            )}
          </div>
        )}

        {/* CONTRACT TERMS TAB */}
        {tab === 'terms' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card title="Contract">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Contract Start Date</label>
                  <input type="date" style={inputStyle} value={contractStart} onChange={e => setContractStart(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Contract Length (Years)</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={contractYears} onChange={e => setContractYears(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map(y => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Payment Terms</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}>
                    <option value="annual">Annual</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
            </Card>
            <Card title="Incentives">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Free Months</label>
                  <input type="number" min="0" max="12" style={inputStyle} value={freeMonths}
                    onChange={e => setFreeMonths(Number(e.target.value) || 0)} />
                  {freeMonths > 0 && (
                    <div style={{ fontSize: 12, color: T.success, marginTop: 4 }}>
                      Value: {formatCurrency(freeMonthsValue)}
                    </div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Signing Bonus</label>
                  <input type="number" min="0" style={inputStyle} value={signingBonus}
                    onChange={e => setSigningBonus(Number(e.target.value) || 0)} />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* SUMMARY TAB */}
        {tab === 'summary' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card title="Pricing Summary">
              {[
                ['Subscription List', subscriptionListTotal],
                ['Subscription Net', subscriptionNetTotal],
                ['One-Time Services', oneTimeTotal],
                ['Total List Price', totalListPrice],
                ['Total Discount', -totalDiscount],
                ['Total Net Price', totalNetPrice],
              ].map(([label, value]) => (
                <div key={label} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '8px 0',
                  borderBottom: `1px solid ${T.borderLight}`,
                }}>
                  <span style={{ fontSize: 13, color: T.textSecondary }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: value < 0 ? T.success : T.text, fontFeatureSettings: '"tnum"' }}>
                    {formatCurrency(Math.abs(value))}{value < 0 ? ' off' : ''}
                  </span>
                </div>
              ))}
            </Card>
            <Card title="Key Metrics">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[
                  ['ARR', arr, T.primary],
                  ['CMRR', cmrr, T.text],
                  ['Year 1 Total', yearOneTotal, T.success],
                  ['TCV', tcv, T.text],
                  ['Discount', `${discountPct}%`, totalDiscount > 0 ? T.success : T.textMuted],
                  ['Contract', `${contractYears} yr`, T.textMuted],
                ].map(([label, value, color]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color, fontFeatureSettings: '"tnum"' }}>
                      {typeof value === 'number' ? formatCurrency(value) : value}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            {freeMonths > 0 || signingBonus > 0 ? (
              <Card title="Incentives" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', gap: 24 }}>
                  {freeMonths > 0 && (
                    <div>
                      <div style={labelStyle}>Free Months</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: T.success }}>{freeMonths} mo ({formatCurrency(freeMonthsValue)})</div>
                    </div>
                  )}
                  {signingBonus > 0 && (
                    <div>
                      <div style={labelStyle}>Signing Bonus</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: T.success }}>{formatCurrency(signingBonus)}</div>
                    </div>
                  )}
                </div>
              </Card>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
