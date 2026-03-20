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
  const [favorites, setFavorites] = useState([])
  const [tab, setTab] = useState('products')
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [customSchedule, setCustomSchedule] = useState(false)
  const [customPayments, setCustomPayments] = useState([])

  // Contract terms
  const [contractYears, setContractYears] = useState(3)
  const [paymentTerms, setPaymentTerms] = useState('annual')
  const [contractStart, setContractStart] = useState('')
  const [priceIncreases, setPriceIncreases] = useState('')
  const [renewalCap, setRenewalCap] = useState('')
  const [globalDiscount, setGlobalDiscount] = useState(0)
  const [freeMonths, setFreeMonths] = useState(0)
  const [signingBonus, setSigningBonus] = useState(0)
  const [status, setStatus] = useState('draft')

  useEffect(() => { loadData() }, [dealId, quoteId])

  async function loadData() {
    setLoading(true)
    try {
      const [dealRes, productsRes, favsRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', dealId).single(),
        supabase.from('products').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('quote_favorites').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
      ])
      setDeal(dealRes.data)
      setProducts(productsRes.data || [])
      setFavorites(favsRes.data || [])

      if (quoteId && quoteId !== 'new') {
        const { data: q } = await supabase.from('quotes').select('*').eq('id', quoteId).single()
        if (q) {
          setQuote(q)
          setContractYears(q.contract_years || 3)
          setPaymentTerms(q.payment_terms || 'annual')
          setContractStart(q.contract_start_date || '')
          setFreeMonths(q.free_months || 0)
          setSigningBonus(q.signing_bonus || 0)
          setPriceIncreases(q.price_increases || '')
          setRenewalCap(q.renewal_cap || '')
          setStatus(q.status || 'draft')
        }
        const { data: items } = await supabase
          .from('quote_line_items').select('*, products(*)').eq('quote_id', quoteId).order('line_order')
        setLineItems((items || []).map(i => ({
          id: i.id, product_id: i.product_id, product_name: i.products?.product_name || 'Unknown',
          sku: i.products?.sku || '', category: i.products?.category || 'subscription',
          billing: i.products?.billing_frequency || 'annual',
          quantity: i.quantity, list_price: i.list_price, custom_price: i.custom_price,
          useCustomPrice: i.custom_price != null, discount_pct: i.discount_percentage,
          net_price: i.net_price, override: i.override_discount,
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
      sku: product.sku || '', category: product.category, billing: product.billing_frequency,
      quantity: 1, list_price: product.list_price, custom_price: null, useCustomPrice: false,
      discount_pct: globalDiscount, net_price: product.list_price * (1 - globalDiscount / 100),
      override: false,
    }])
    setShowAddProduct(false)
  }

  function updateLineItem(id, field, value) {
    setLineItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const updated = { ...item, [field]: value }
      const price = updated.useCustomPrice && updated.custom_price != null ? updated.custom_price : updated.list_price
      const discount = updated.override ? updated.discount_pct : globalDiscount
      updated.discount_pct = discount
      updated.net_price = price * updated.quantity * (1 - discount / 100)
      return updated
    }))
  }

  function removeLineItem(id) { setLineItems(prev => prev.filter(i => i.id !== id)) }

  function moveLineItem(idx, dir) {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= lineItems.length) return
    const arr = [...lineItems];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
    setLineItems(arr)
  }

  // Apply global discount
  useEffect(() => {
    setLineItems(prev => prev.map(item => {
      if (item.override) return item
      const price = item.useCustomPrice && item.custom_price != null ? item.custom_price : item.list_price
      return { ...item, discount_pct: globalDiscount, net_price: price * item.quantity * (1 - globalDiscount / 100) }
    }))
  }, [globalDiscount])

  // Calculations
  const calc = useMemo(() => {
    const subItems = lineItems.filter(i => i.category === 'subscription')
    const otItems = lineItems.filter(i => i.category !== 'subscription')
    const subListTotal = subItems.reduce((s, i) => s + (i.list_price * i.quantity), 0)
    const subNetTotal = subItems.reduce((s, i) => s + i.net_price, 0)
    const otTotal = otItems.reduce((s, i) => s + i.net_price, 0)
    const implTotal = otItems.filter(i => i.category === 'implementation').reduce((s, i) => s + i.net_price, 0)
    const svcTotal = otItems.filter(i => i.category === 'services').reduce((s, i) => s + i.net_price, 0)
    const totalList = lineItems.reduce((s, i) => s + (i.list_price * i.quantity), 0)
    const totalNet = lineItems.reduce((s, i) => s + i.net_price, 0)
    const totalDiscount = totalList - totalNet
    const discountPct = totalList > 0 ? (totalDiscount / totalList * 100).toFixed(1) : 0
    const arr = subNetTotal
    const cmrr = arr / 12
    const fmValue = (subNetTotal / 12) * freeMonths
    const y1Total = subNetTotal + otTotal - fmValue - signingBonus
    const tcv = (subNetTotal * contractYears) + otTotal - fmValue - signingBonus
    return { subListTotal, subNetTotal, otTotal, implTotal, svcTotal, totalList, totalNet, totalDiscount, discountPct, arr, cmrr, fmValue, y1Total, tcv }
  }, [lineItems, contractYears, freeMonths, signingBonus])

  // Payment schedule generation
  const generatedSchedule = useMemo(() => {
    if (!contractStart || calc.totalNet === 0) return []
    const payments = []
    const start = new Date(contractStart + 'T00:00:00')
    let order = 0

    // Implementation payment at signing
    if (calc.implTotal > 0) {
      payments.push({
        payment_date: contractStart, due_date: contractStart,
        payment_type: 'implementation', period_label: 'Implementation',
        amount: calc.implTotal, payment_order: order++,
      })
    }

    // Subscription payments
    const periods = paymentTerms === 'annual' ? contractYears
      : paymentTerms === 'quarterly' ? contractYears * 4
      : contractYears * 12
    const perPayment = paymentTerms === 'annual' ? calc.subNetTotal
      : paymentTerms === 'quarterly' ? calc.subNetTotal / 4
      : calc.subNetTotal / 12
    const monthsPerPeriod = paymentTerms === 'annual' ? 12 : paymentTerms === 'quarterly' ? 3 : 1

    for (let i = 0; i < periods; i++) {
      const d = new Date(start)
      d.setMonth(d.getMonth() + (i * monthsPerPeriod))
      const dateStr = d.toISOString().split('T')[0]

      // Check if within free months
      const monthsFromStart = i * monthsPerPeriod
      if (monthsFromStart < freeMonths && paymentTerms === 'monthly') {
        payments.push({
          payment_date: dateStr, due_date: dateStr,
          payment_type: 'free_month', period_label: `Free Month ${monthsFromStart + 1}`,
          amount: 0, payment_order: order++,
        })
      } else {
        const yr = Math.floor(monthsFromStart / 12) + 1
        const periodNum = paymentTerms === 'annual' ? i + 1
          : paymentTerms === 'quarterly' ? (i % 4) + 1 : (i % 12) + 1
        payments.push({
          payment_date: dateStr, due_date: dateStr,
          payment_type: 'subscription',
          period_label: paymentTerms === 'annual' ? `Year ${yr}` : paymentTerms === 'quarterly' ? `Y${yr} Q${periodNum}` : `Y${yr} M${periodNum}`,
          amount: perPayment, payment_order: order++,
        })
      }
    }
    return payments
  }, [contractStart, paymentTerms, contractYears, calc, freeMonths])

  // TCO breakdown generation
  const generatedTco = useMemo(() => {
    const years = []
    for (let y = 1; y <= contractYears; y++) {
      years.push({
        year_number: y, subscription: calc.subNetTotal,
        implementation: y === 1 ? calc.implTotal : 0,
        services: y === 1 ? calc.svcTotal : 0,
        discount: y === 1 ? calc.fmValue + signingBonus : 0,
        free_months_value: y === 1 ? calc.fmValue : 0,
        signing_bonus: y === 1 ? signingBonus : 0,
        total: calc.subNetTotal + (y === 1 ? calc.implTotal + calc.svcTotal - calc.fmValue - signingBonus : 0),
      })
    }
    return years
  }, [contractYears, calc, signingBonus])

  async function advanceStatus() {
    const flow = { draft: 'pending_approval', pending_approval: 'approved', approved: 'sent' }
    const next = flow[status]
    if (!next) return
    if (quote) {
      await supabase.from('quotes').update({ status: next }).eq('id', quote.id)
    }
    setStatus(next)
  }

  async function saveAsFavorite() {
    const name = prompt('Favorite name:')
    if (!name) return
    const { data: fav } = await supabase.from('quote_favorites').insert({
      name, deal_id: dealId, created_by: profile?.id,
    }).select().single()
    if (fav) {
      await supabase.from('quote_favorite_items').insert(lineItems.map((item, idx) => ({
        favorite_id: fav.id, product_id: item.product_id, quantity: item.quantity,
        custom_price: item.useCustomPrice ? item.custom_price : null,
        discount_percentage: item.discount_pct, override_discount: item.override, line_order: idx,
      })))
      setFavorites(prev => [fav, ...prev])
    }
  }

  async function loadFavorite(favId) {
    const { data: items } = await supabase
      .from('quote_favorite_items').select('*, products(*)').eq('favorite_id', favId).order('line_order')
    if (items) {
      setLineItems(items.map(i => ({
        id: `fav_${Date.now()}_${i.id}`, product_id: i.product_id,
        product_name: i.products?.product_name || 'Unknown', sku: i.products?.sku || '',
        category: i.products?.category || 'subscription', billing: i.products?.billing_frequency || 'annual',
        quantity: i.quantity, list_price: i.products?.list_price || 0,
        custom_price: i.custom_price, useCustomPrice: i.custom_price != null,
        discount_pct: i.discount_percentage || globalDiscount,
        net_price: ((i.custom_price != null ? i.custom_price : i.products?.list_price) || 0) * i.quantity * (1 - (i.discount_percentage || 0) / 100),
        override: i.override_discount,
      })))
    }
  }

  async function saveQuote() {
    setSaving(true)
    try {
      const quoteData = {
        deal_id: dealId, contract_years: contractYears, payment_terms: paymentTerms,
        contract_start_date: contractStart || null, price_increases: priceIncreases || null,
        renewal_cap: renewalCap || null,
        list_price: calc.totalList, net_price: calc.totalNet,
        discount_amount: calc.totalDiscount, discount_percent: parseFloat(calc.discountPct) || 0,
        arr: calc.arr, cmrr: calc.cmrr, subscription_list_total: calc.subListTotal,
        subscription_net_total: calc.subNetTotal,
        subscription_discount_amount: calc.subListTotal - calc.subNetTotal,
        subscription_discount_percent: calc.subListTotal > 0 ? ((calc.subListTotal - calc.subNetTotal) / calc.subListTotal * 100) : 0,
        implementation_total: calc.implTotal, services_total: calc.svcTotal,
        free_months: freeMonths, signing_bonus: signingBonus,
        year_one_total: calc.y1Total, total_contract_value: calc.tcv,
        prepared_by: profile?.id, status,
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

      // Line items
      await supabase.from('quote_line_items').delete().eq('quote_id', savedQuoteId)
      if (lineItems.length > 0) {
        await supabase.from('quote_line_items').insert(lineItems.map((item, idx) => ({
          quote_id: savedQuoteId, product_id: item.product_id, quantity: item.quantity,
          list_price: item.list_price, custom_price: item.useCustomPrice ? item.custom_price : null,
          discount_percentage: item.discount_pct, discount_amount: (item.list_price * item.quantity) - item.net_price,
          net_price: item.net_price, override_discount: item.override, line_order: idx,
        })))
      }

      // Payment schedules
      await supabase.from('payment_schedules').delete().eq('quote_id', savedQuoteId)
      const scheduleToSave = customSchedule ? customPayments : generatedSchedule
      if (scheduleToSave.length > 0) {
        await supabase.from('payment_schedules').insert(scheduleToSave.map(p => ({
          quote_id: savedQuoteId, ...p,
        })))
      }

      // TCO
      await supabase.from('quote_tco_breakdown').delete().eq('quote_id', savedQuoteId)
      if (generatedTco.length > 0) {
        await supabase.from('quote_tco_breakdown').insert(generatedTco.map(t => ({
          quote_id: savedQuoteId, ...t,
        })))
      }

      // Update deal
      await supabase.from('deals').update({ deal_value: calc.arr, cmrr: calc.cmrr }).eq('id', dealId)

      navigate(`/deal/${dealId}`)
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const filteredProducts = products.filter(p =>
    p.product_name.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.sku || '').toLowerCase().includes(productSearch.toLowerCase())
  )

  const statusColors = { draft: T.textMuted, pending_approval: T.warning, approved: T.success, sent: T.primary }
  const statusFlow = { draft: 'pending_approval', pending_approval: 'approved', approved: 'sent' }

  const tabs2 = [
    { key: 'products', label: `Products (${lineItems.length})` },
    { key: 'terms', label: 'Contract Terms' },
    { key: 'schedule', label: 'Payment Schedule' },
    { key: 'tco', label: 'TCO Breakdown' },
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
            <div style={{ fontSize: 22, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{formatCurrency(calc.totalNet)}</div>
            <div style={{ fontSize: 11, color: T.textSecondary }}>{formatCurrency(calc.arr)} ARR | {formatCurrency(calc.cmrr)}/mo CMRR</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge color={statusColors[status]}>{status.replace('_', ' ')}</Badge>
            {statusFlow[status] && (
              <Button style={{ padding: '4px 10px', fontSize: 11 }} onClick={advanceStatus}>
                {statusFlow[status] === 'pending_approval' ? 'Submit' : statusFlow[status] === 'approved' ? 'Approve' : 'Send'}
              </Button>
            )}
          </div>
          <Button primary onClick={saveQuote} disabled={saving}>{saving ? 'Saving...' : 'Save Quote'}</Button>
        </div>
        <TabBar tabs={tabs2} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: 24, maxWidth: 1200 }}>

        {/* PRODUCTS TAB */}
        {tab === 'products' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: T.textSecondary, fontWeight: 600 }}>Global Discount:</label>
                <input type="number" min="0" max="100" step="0.5" value={globalDiscount}
                  onChange={e => setGlobalDiscount(Number(e.target.value) || 0)}
                  style={{ ...inputStyle, width: 80, padding: '6px 10px', textAlign: 'center' }} />
                <span style={{ fontSize: 12, color: T.textMuted }}>%</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {favorites.length > 0 && (
                  <select style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                    defaultValue="" onChange={e => e.target.value && loadFavorite(e.target.value)}>
                    <option value="">Load Favorite...</option>
                    {favorites.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                )}
                {lineItems.length > 0 && <Button onClick={saveAsFavorite}>Save as Favorite</Button>}
                <Button primary onClick={() => setShowAddProduct(true)}>+ Add Product</Button>
              </div>
            </div>

            {/* Add Product Picker */}
            {showAddProduct && (
              <Card title="Select Product" style={{ marginBottom: 16 }}>
                <input style={{ ...inputStyle, marginBottom: 12 }} placeholder="Search products..."
                  value={productSearch} onChange={e => setProductSearch(e.target.value)} autoFocus />
                <div style={{ maxHeight: 300, overflow: 'auto' }}>
                  {filteredProducts.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: T.textMuted }}>No products found.</div>
                  ) : filteredProducts.map(p => (
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
                  <Button onClick={() => { setShowAddProduct(false); setProductSearch('') }}>Close</Button>
                </div>
              </Card>
            )}

            {/* Line Items Table */}
            {lineItems.length === 0 ? (
              <EmptyState message="No products added yet. Click '+ Add Product' to build the quote." />
            ) : (
              <Card>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                        {['', 'Product', 'Type', 'Qty', 'List Price', 'Custom', 'Discount %', 'Discount $', 'Net Price', 'Override', ''].map((h, i) => (
                          <th key={i} style={{
                            textAlign: i >= 3 ? 'right' : 'left', padding: '8px 6px',
                            fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase',
                            letterSpacing: '0.04em', whiteSpace: 'nowrap',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item, idx) => {
                        const basePrice = item.useCustomPrice && item.custom_price != null ? item.custom_price : item.list_price
                        const discountAmt = (basePrice * item.quantity) - item.net_price
                        return (
                          <tr key={item.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                            <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <button onClick={() => moveLineItem(idx, -1)} disabled={idx === 0}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 10, opacity: idx === 0 ? 0.3 : 1 }}>{'\u25B2'}</button>
                                <button onClick={() => moveLineItem(idx, 1)} disabled={idx === lineItems.length - 1}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 10, opacity: idx === lineItems.length - 1 ? 0.3 : 1 }}>{'\u25BC'}</button>
                              </div>
                            </td>
                            <td style={{ padding: '8px 6px' }}>
                              <div style={{ fontWeight: 600, color: T.text }}>{item.product_name}</div>
                              {item.sku && <div style={{ fontSize: 10, color: T.textMuted }}>{item.sku}</div>}
                            </td>
                            <td style={{ padding: '8px 6px' }}>
                              <Badge color={item.category === 'subscription' ? T.primary : item.category === 'implementation' ? '#8b5cf6' : T.textMuted}>{item.category}</Badge>
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                              <input type="number" min="1" value={item.quantity}
                                onChange={e => updateLineItem(item.id, 'quantity', Number(e.target.value) || 1)}
                                style={{ ...inputStyle, width: 55, padding: '4px 6px', textAlign: 'center' }} />
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                              {formatCurrency(item.list_price)}
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                                <input type="checkbox" checked={item.useCustomPrice}
                                  onChange={e => updateLineItem(item.id, 'useCustomPrice', e.target.checked)}
                                  style={{ cursor: 'pointer' }} />
                                {item.useCustomPrice && (
                                  <input type="number" min="0" value={item.custom_price || ''}
                                    onChange={e => updateLineItem(item.id, 'custom_price', Number(e.target.value) || 0)}
                                    style={{ ...inputStyle, width: 75, padding: '4px 6px', textAlign: 'right' }} />
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                              <input type="number" min="0" max="100" step="0.5" value={item.discount_pct}
                                onChange={e => updateLineItem(item.id, 'discount_pct', Number(e.target.value) || 0)}
                                style={{ ...inputStyle, width: 60, padding: '4px 6px', textAlign: 'center' }} />
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right', fontSize: 12, color: T.success, fontFeatureSettings: '"tnum"' }}>
                              {discountAmt > 0 ? `-${formatCurrency(discountAmt)}` : '--'}
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"', color: T.text }}>
                              {formatCurrency(item.net_price)}
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                              <input type="checkbox" checked={item.override}
                                onChange={e => updateLineItem(item.id, 'override', e.target.checked)}
                                title="Override global discount" style={{ cursor: 'pointer' }} />
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                              <button onClick={() => removeLineItem(item.id)} style={{
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                color: T.textMuted, fontSize: 16, padding: 2, lineHeight: 1,
                              }}
                                onMouseEnter={e => e.currentTarget.style.color = T.error}
                                onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
                              >&#10005;</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: `2px solid ${T.border}` }}>
                        <td colSpan={8} style={{ padding: '12px 6px', fontWeight: 700, color: T.text, textAlign: 'right' }}>
                          Total ({calc.discountPct}% discount)
                        </td>
                        <td style={{ padding: '12px 6px', textAlign: 'right', fontWeight: 700, fontSize: 16, color: T.text, fontFeatureSettings: '"tnum"' }}>
                          {formatCurrency(calc.totalNet)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            )}

            {/* Summary card */}
            {lineItems.length > 0 && (
              <Card title="Quick Summary">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                  {[
                    ['ARR', calc.arr, T.primary],
                    ['CMRR', calc.cmrr, T.text],
                    ['Year 1', calc.y1Total, T.success],
                    ['TCV', calc.tcv, T.text],
                  ].map(([label, value, color]) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color, fontFeatureSettings: '"tnum"' }}>{formatCurrency(value)}</div>
                    </div>
                  ))}
                </div>
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
                <div>
                  <label style={labelStyle}>Price Increases</label>
                  <input style={inputStyle} value={priceIncreases} onChange={e => setPriceIncreases(e.target.value)} placeholder="e.g. 3% annual" />
                </div>
                <div>
                  <label style={labelStyle}>Renewal Cap</label>
                  <input style={inputStyle} value={renewalCap} onChange={e => setRenewalCap(e.target.value)} placeholder="e.g. 5% cap" />
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
                    <div style={{ fontSize: 12, color: T.success, marginTop: 4 }}>Value: {formatCurrency(calc.fmValue)}</div>
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

        {/* PAYMENT SCHEDULE TAB */}
        {tab === 'schedule' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button primary={!customSchedule} onClick={() => setCustomSchedule(false)}>Auto</Button>
                <Button primary={customSchedule} onClick={() => { setCustomSchedule(true); setCustomPayments([...generatedSchedule]) }}>Custom</Button>
              </div>
            </div>

            {!contractStart ? (
              <EmptyState message="Set a contract start date in Contract Terms to generate the payment schedule." />
            ) : (
              <Card>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                      {['Payment Date', 'Due Date', 'Type', 'Period', 'Amount'].map(h => (
                        <th key={h} style={{
                          textAlign: h === 'Amount' ? 'right' : 'left', padding: '8px 10px',
                          fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(customSchedule ? customPayments : generatedSchedule).map((p, i) => {
                      const typeColor = p.payment_type === 'implementation' ? '#8b5cf6'
                        : p.payment_type === 'subscription' ? T.primary : T.error
                      const typeBg = p.payment_type === 'implementation' ? 'rgba(139, 92, 246, 0.06)'
                        : p.payment_type === 'subscription' ? 'rgba(93, 173, 226, 0.06)' : T.errorLight
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}`, background: typeBg }}>
                          <td style={{ padding: '10px' }}>
                            {customSchedule ? (
                              <input type="date" value={p.payment_date || ''} style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }}
                                onChange={e => setCustomPayments(prev => prev.map((pp, j) => j === i ? { ...pp, payment_date: e.target.value } : pp))} />
                            ) : (p.payment_date ? formatDateLong(p.payment_date) : '--')}
                          </td>
                          <td style={{ padding: '10px' }}>{p.due_date ? formatDateLong(p.due_date) : '--'}</td>
                          <td style={{ padding: '10px' }}><Badge color={typeColor}>{p.payment_type}</Badge></td>
                          <td style={{ padding: '10px' }}>{p.period_label}</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>
                            {customSchedule ? (
                              <input type="number" value={p.amount || ''} style={{ ...inputStyle, width: 100, padding: '4px 8px', textAlign: 'right' }}
                                onChange={e => setCustomPayments(prev => prev.map((pp, j) => j === i ? { ...pp, amount: Number(e.target.value) || 0 } : pp))} />
                            ) : formatCurrency(p.amount)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}

        {/* TCO BREAKDOWN TAB */}
        {tab === 'tco' && (
          <Card title="Total Cost of Ownership">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Category</th>
                  {generatedTco.map(yr => (
                    <th key={yr.year_number} style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>
                      Year {yr.year_number}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Subscription', 'subscription'],
                  ['Implementation', 'implementation'],
                  ['Services', 'services'],
                  ['Incentives', 'discount'],
                ].map(([label, key]) => (
                  <tr key={key} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                    <td style={{ padding: '10px', color: T.text }}>{label}</td>
                    {generatedTco.map(yr => (
                      <td key={yr.year_number} style={{ padding: '10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: key === 'discount' && yr[key] > 0 ? T.success : T.text }}>
                        {key === 'discount' && yr[key] > 0 ? `-${formatCurrency(yr[key])}` : formatCurrency(yr[key] || 0)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${T.border}` }}>
                  <td style={{ padding: '10px', fontWeight: 700 }}>Total</td>
                  {generatedTco.map(yr => (
                    <td key={yr.year_number} style={{ padding: '10px', textAlign: 'right', fontWeight: 700, fontFeatureSettings: '"tnum"', fontSize: 14 }}>
                      {formatCurrency(yr.total)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Card>
        )}

        {/* SUMMARY TAB */}
        {tab === 'summary' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card title="Pricing Summary">
              {[
                ['Subscription List', calc.subListTotal],
                ['Subscription Net', calc.subNetTotal],
                ['One-Time Services', calc.otTotal],
                ['Total List Price', calc.totalList],
                ['Total Discount', -calc.totalDiscount],
                ['Total Net Price', calc.totalNet],
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
                  ['ARR', calc.arr, T.primary],
                  ['CMRR', calc.cmrr, T.text],
                  ['Year 1 Total', calc.y1Total, T.success],
                  ['TCV', calc.tcv, T.text],
                  ['Discount', `${calc.discountPct}%`, calc.totalDiscount > 0 ? T.success : T.textMuted],
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
            {(freeMonths > 0 || signingBonus > 0) && (
              <Card title="Incentives" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', gap: 24 }}>
                  {freeMonths > 0 && (
                    <div>
                      <div style={labelStyle}>Free Months</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: T.success }}>{freeMonths} mo ({formatCurrency(calc.fmValue)})</div>
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
            )}
          </div>
        )}
      </div>
    </div>
  )
}
