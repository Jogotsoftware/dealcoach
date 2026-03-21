import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, formatDate, formatDateLong } from '../lib/theme'
import { Badge, Button, EmptyState, Spinner, inputStyle, labelStyle } from '../components/Shared'

// ── Price increase presets by contract years ──
const PRICE_INCREASE_PRESETS = {
  1: [{ label: '1 Year - 0%', values: [0] }],
  3: [
    { label: '3 Year - 0%, 5%, 5%', values: [0, 5, 5] },
    { label: '3 Year - 0%, 10%, 10%', values: [0, 10, 10] },
    { label: '3 Year - 0%, 3%, 3%', values: [0, 3, 3] },
    { label: '3 Year - 0%, 0%, 0%', values: [0, 0, 0] },
    { label: '3 Year - 0%, 7%, 7%', values: [0, 7, 7] },
  ],
  5: [
    { label: '5 Year - 0%, 5%, 5%, 5%, 5%', values: [0, 5, 5, 5, 5] },
    { label: '5 Year - 0%, 3%, 3%, 3%, 3%', values: [0, 3, 3, 3, 3] },
    { label: '5 Year - 0%, 10%, 10%, 10%, 10%', values: [0, 10, 10, 10, 10] },
    { label: '5 Year - 0%, 0%, 0%, 0%, 0%', values: [0, 0, 0, 0, 0] },
    { label: '5 Year - 0%, 7%, 7%, 7%, 7%', values: [0, 7, 7, 7, 7] },
  ],
}
// For years 2 and 4, generate generic presets
PRICE_INCREASE_PRESETS[2] = [
  { label: '2 Year - 0%, 5%', values: [0, 5] },
  { label: '2 Year - 0%, 3%', values: [0, 3] },
  { label: '2 Year - 0%, 0%', values: [0, 0] },
]
PRICE_INCREASE_PRESETS[4] = [
  { label: '4 Year - 0%, 5%, 5%, 5%', values: [0, 5, 5, 5] },
  { label: '4 Year - 0%, 3%, 3%, 3%', values: [0, 3, 3, 3] },
  { label: '4 Year - 0%, 0%, 0%, 0%', values: [0, 0, 0, 0] },
]

// ── Collapsible Section component ──
function Section({ title, defaultOpen = true, children, badge, sticky }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
      boxShadow: T.shadow, marginBottom: 16, overflow: 'hidden',
      ...(sticky ? { position: 'sticky', top: 0, zIndex: 10 } : {}),
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 18px', background: T.surfaceAlt, border: 'none', cursor: 'pointer',
        borderBottom: open ? `1px solid ${T.border}` : 'none', fontFamily: T.font,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{title}</span>
          {badge}
        </div>
        <span style={{ fontSize: 12, color: T.textMuted, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          {'\u25BC'}
        </span>
      </button>
      {open && <div style={{ padding: 18 }}>{children}</div>}
    </div>
  )
}

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
  const [contacts, setContacts] = useState([])
  const [favorites, setFavorites] = useState([])
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [saveFavName, setSaveFavName] = useState('')
  const [showSaveFav, setShowSaveFav] = useState(false)

  // Quote details
  const [quoteName, setQuoteName] = useState('')
  const [signerId, setSignerId] = useState('')
  const [status, setStatus] = useState('draft')

  // Contract terms
  const [contractType, setContractType] = useState('price_cap')
  const [contractYears, setContractYears] = useState(3)
  const [priceIncreasePreset, setPriceIncreasePreset] = useState('')
  const [priceIncreaseValues, setPriceIncreaseValues] = useState([0, 0, 0])
  const [paymentFrequency, setPaymentFrequency] = useState('annual')
  const [signingDate, setSigningDate] = useState('')
  const [contractStart, setContractStart] = useState('')
  const [globalDiscount, setGlobalDiscount] = useState(0)

  // Implementation
  const [implementor, setImplementor] = useState('')
  const [implCost, setImplCost] = useState(0)
  const [implMonths, setImplMonths] = useState(3)
  const [kickoffDate, setKickoffDate] = useState('')

  // Incentives
  const [signingBonusType, setSigningBonusType] = useState('fixed')
  const [signingBonusAmount, setSigningBonusAmount] = useState(0)
  const [signingBonusMonths, setSigningBonusMonths] = useState(0)
  const [freeMonths, setFreeMonths] = useState(0)
  const [freeMonthsTiming, setFreeMonthsTiming] = useState('beginning')

  // Display settings
  const [displaySettings, setDisplaySettings] = useState({
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

  useEffect(() => { loadData() }, [dealId, quoteId])

  async function loadData() {
    setLoading(true)
    try {
      const [dealRes, productsRes, favsRes, contactsRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', dealId).single(),
        supabase.from('products').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('quote_favorites').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
        supabase.from('contacts').select('*').eq('deal_id', dealId).order('contact_name'),
      ])
      const d = dealRes.data
      setDeal(d)
      setProducts(productsRes.data || [])
      setFavorites(favsRes.data || [])
      setContacts(contactsRes.data || [])

      // Auto-generate quote name
      if (!quoteId || quoteId === 'new') {
        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        setQuoteName(`Quote - ${d?.company_name || 'Company'} - ${today}`)
      }

      if (quoteId && quoteId !== 'new') {
        const [quoteRes, settingsRes] = await Promise.all([
          supabase.from('quotes').select('*').eq('id', quoteId).single(),
          supabase.from('proposal_settings').select('*').eq('deal_id', dealId).single(),
        ])
        const q = quoteRes.data
        if (q) {
          setQuote(q)
          setQuoteName(q.quote_name || `Quote - ${d?.company_name || 'Company'}`)
          setSignerId(q.signer_contact_id || '')
          setContractType(q.contract_type || 'price_cap')
          setContractYears(q.contract_years || 3)
          setPaymentFrequency(q.payment_terms || 'annual')
          setContractStart(q.contract_start_date || '')
          setSigningDate(q.signing_date || '')
          setFreeMonths(q.free_months || 0)
          setFreeMonthsTiming(q.free_months_timing || 'beginning')
          setSigningBonusType(q.signing_bonus_type || 'fixed')
          setSigningBonusAmount(q.signing_bonus || 0)
          setSigningBonusMonths(q.signing_bonus_months || 0)
          setGlobalDiscount(q.discount_percent || 0)
          setImplementor(q.implementor || '')
          setImplCost(q.implementation_total || 0)
          setImplMonths(q.implementation_months || 3)
          setKickoffDate(q.kickoff_date || '')
          setStatus(q.status || 'draft')
          if (q.price_increases) {
            setPriceIncreasePreset(q.price_increases)
            try {
              const parsed = JSON.parse(q.price_increase_values || '[]')
              if (Array.isArray(parsed) && parsed.length) setPriceIncreaseValues(parsed)
            } catch { /* use defaults */ }
          }
        }
        if (settingsRes.data) {
          setDisplaySettings(prev => ({ ...prev, ...settingsRes.data }))
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

  // ── Product operations ──
  function addProduct(product) {
    setLineItems(prev => [...prev, {
      id: `new_${Date.now()}`, product_id: product.id, product_name: product.product_name,
      sku: product.sku || '', category: product.category, billing: product.billing_frequency,
      quantity: 1, list_price: product.list_price, custom_price: null, useCustomPrice: false,
      discount_pct: globalDiscount, net_price: product.list_price * (1 - globalDiscount / 100),
      override: false,
    }])
    setShowAddProduct(false)
    setProductSearch('')
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

  // Apply global discount to non-override items
  useEffect(() => {
    setLineItems(prev => prev.map(item => {
      if (item.override) return item
      const price = item.useCustomPrice && item.custom_price != null ? item.custom_price : item.list_price
      return { ...item, discount_pct: globalDiscount, net_price: price * item.quantity * (1 - globalDiscount / 100) }
    }))
  }, [globalDiscount])

  // Reset price increase preset when years change
  useEffect(() => {
    const presets = PRICE_INCREASE_PRESETS[contractYears] || []
    if (presets.length > 0) {
      setPriceIncreasePreset(presets[0].label)
      setPriceIncreaseValues(presets[0].values)
    } else {
      setPriceIncreasePreset('')
      setPriceIncreaseValues(Array(contractYears).fill(0))
    }
  }, [contractYears])

  // ── Calculations ──
  const calc = useMemo(() => {
    const subItems = lineItems.filter(i => i.category === 'subscription')
    const implItems = lineItems.filter(i => i.category === 'implementation')
    const svcItems = lineItems.filter(i => i.category === 'services' || i.category === 'training' || i.category === 'support')

    const subListTotal = subItems.reduce((s, i) => s + (i.list_price * i.quantity), 0)
    const subNetTotal = subItems.reduce((s, i) => s + i.net_price, 0)
    const subDiscountAmt = subListTotal - subNetTotal
    const subDiscountPct = subListTotal > 0 ? ((subDiscountAmt / subListTotal) * 100) : 0
    const implTotal = implCost > 0 ? implCost : implItems.reduce((s, i) => s + i.net_price, 0)
    const svcTotal = svcItems.reduce((s, i) => s + i.net_price, 0)

    const arr = subNetTotal
    const cmrr = arr / 12
    const fmValue = (subNetTotal / 12) * freeMonths
    const sigBonus = signingBonusType === 'months' ? (arr / 12) * signingBonusMonths : signingBonusAmount
    const y1Total = subNetTotal + implTotal + svcTotal - fmValue - sigBonus
    const tcv = (subNetTotal * contractYears) + implTotal + svcTotal - fmValue - sigBonus

    return { subListTotal, subNetTotal, subDiscountAmt, subDiscountPct, implTotal, svcTotal, arr, cmrr, fmValue, sigBonus, y1Total, tcv }
  }, [lineItems, contractYears, freeMonths, signingBonusType, signingBonusAmount, signingBonusMonths, implCost])

  // ── TCO Breakdown ──
  const generatedTco = useMemo(() => {
    const years = []
    let cumulativeSub = calc.subNetTotal
    for (let y = 1; y <= contractYears; y++) {
      const increaseRate = priceIncreaseValues[y - 1] || 0
      if (y > 1) cumulativeSub = cumulativeSub * (1 + increaseRate / 100)
      const incentives = y === 1 ? calc.fmValue + calc.sigBonus : 0
      years.push({
        year_number: y,
        subscription: Math.round(cumulativeSub * 100) / 100,
        implementation: y === 1 ? calc.implTotal : 0,
        services: y === 1 ? calc.svcTotal : 0,
        incentives,
        total: Math.round((cumulativeSub + (y === 1 ? calc.implTotal + calc.svcTotal : 0) - incentives) * 100) / 100,
      })
    }
    return years
  }, [contractYears, calc, priceIncreaseValues])

  const tcoGrandTotal = useMemo(() => generatedTco.reduce((s, y) => s + y.total, 0), [generatedTco])

  // ── Payment Schedule ──
  const generatedSchedule = useMemo(() => {
    if (!contractStart || calc.subNetTotal === 0) return []
    const payments = []
    const start = new Date(contractStart + 'T00:00:00')
    let order = 0

    // Implementation payments split over implMonths starting from kickoff
    if (calc.implTotal > 0 && implMonths > 0) {
      const implStart = kickoffDate ? new Date(kickoffDate + 'T00:00:00') : new Date(start)
      const perMonth = calc.implTotal / implMonths
      for (let m = 0; m < implMonths; m++) {
        const d = new Date(implStart)
        d.setMonth(d.getMonth() + m)
        const due = new Date(d)
        due.setDate(due.getDate() + 30)
        payments.push({
          payment_date: d.toISOString().split('T')[0],
          due_date: due.toISOString().split('T')[0],
          payment_type: 'implementation',
          period_label: `Implementation ${m + 1}/${implMonths}`,
          amount: Math.round(perMonth * 100) / 100,
          payment_order: order++,
        })
      }
    }

    // Subscription payments
    const periods = paymentFrequency === 'annual' ? contractYears
      : paymentFrequency === 'quarterly' ? contractYears * 4
      : contractYears * 12
    const monthsPerPeriod = paymentFrequency === 'annual' ? 12 : paymentFrequency === 'quarterly' ? 3 : 1

    // Build year-by-year subscription amounts using price increases
    const yearAmounts = []
    let cumSub = calc.subNetTotal
    for (let y = 0; y < contractYears; y++) {
      if (y > 0) cumSub = cumSub * (1 + (priceIncreaseValues[y] || 0) / 100)
      yearAmounts.push(cumSub)
    }

    let freeMonthsRemaining = freeMonths
    const freeAtEnd = freeMonthsTiming === 'end'

    for (let i = 0; i < periods; i++) {
      const d = new Date(start)
      d.setMonth(d.getMonth() + (i * monthsPerPeriod))
      const due = new Date(d)
      due.setDate(due.getDate() + 30)
      const dateStr = d.toISOString().split('T')[0]
      const dueDateStr = due.toISOString().split('T')[0]
      const monthsFromStart = i * monthsPerPeriod
      const yr = Math.floor(monthsFromStart / 12)
      const yearSub = yearAmounts[yr] || yearAmounts[yearAmounts.length - 1]
      const perPayment = paymentFrequency === 'annual' ? yearSub
        : paymentFrequency === 'quarterly' ? yearSub / 4
        : yearSub / 12
      const periodNum = paymentFrequency === 'annual' ? yr + 1
        : paymentFrequency === 'quarterly' ? (i % 4) + 1
        : (i % 12) + 1
      const periodLabel = paymentFrequency === 'annual' ? `Year ${yr + 1}`
        : paymentFrequency === 'quarterly' ? `Y${yr + 1} Q${periodNum}`
        : `Y${yr + 1} M${periodNum}`

      // Free months at beginning
      if (!freeAtEnd && freeMonthsRemaining > 0 && paymentFrequency === 'monthly') {
        payments.push({
          payment_date: dateStr, due_date: dueDateStr,
          payment_type: 'free_month', period_label: `Free Month ${freeMonths - freeMonthsRemaining + 1}`,
          amount: 0, payment_order: order++,
        })
        freeMonthsRemaining--
        continue
      }

      // Free months at end - handle last N months
      if (freeAtEnd && paymentFrequency === 'monthly') {
        const totalMonths = contractYears * 12
        const monthIdx = i + 1
        if (monthIdx > totalMonths - freeMonths) {
          payments.push({
            payment_date: dateStr, due_date: dueDateStr,
            payment_type: 'free_month', period_label: `Free Month`,
            amount: 0, payment_order: order++,
          })
          continue
        }
      }

      payments.push({
        payment_date: dateStr, due_date: dueDateStr,
        payment_type: 'subscription', period_label: periodLabel,
        amount: Math.round(perPayment * 100) / 100,
        payment_order: order++,
      })
    }

    return payments
  }, [contractStart, paymentFrequency, contractYears, calc, freeMonths, freeMonthsTiming, priceIncreaseValues, kickoffDate, implMonths])

  // ── Status workflow ──
  function advanceStatus() {
    const flow = { draft: 'pending_approval', pending_approval: 'approved', approved: 'sent' }
    const next = flow[status]
    if (next) setStatus(next)
  }

  // ── Favorites ──
  async function saveAsFavorite() {
    if (!saveFavName.trim()) return
    const { data: fav } = await supabase.from('quote_favorites').insert({
      name: saveFavName.trim(), deal_id: dealId, created_by: profile?.id,
    }).select().single()
    if (fav) {
      await supabase.from('quote_favorite_items').insert(lineItems.map((item, idx) => ({
        favorite_id: fav.id, product_id: item.product_id, quantity: item.quantity,
        custom_price: item.useCustomPrice ? item.custom_price : null,
        discount_percentage: item.discount_pct, override_discount: item.override, line_order: idx,
      })))
      setFavorites(prev => [fav, ...prev])
    }
    setSaveFavName('')
    setShowSaveFav(false)
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

  // ── Save ──
  async function saveQuote() {
    setSaving(true)
    try {
      const quoteData = {
        deal_id: dealId,
        quote_name: quoteName,
        signer_contact_id: signerId || null,
        contract_type: contractType,
        contract_years: contractYears,
        payment_terms: paymentFrequency,
        contract_start_date: contractStart || null,
        signing_date: signingDate || null,
        price_increases: priceIncreasePreset || null,
        price_increase_values: JSON.stringify(priceIncreaseValues),
        implementor: implementor || null,
        implementation_total: calc.implTotal,
        implementation_months: implMonths,
        kickoff_date: kickoffDate || null,
        list_price: calc.subListTotal,
        net_price: calc.subNetTotal,
        discount_amount: calc.subDiscountAmt,
        discount_percent: parseFloat(calc.subDiscountPct.toFixed(1)) || 0,
        arr: calc.arr,
        cmrr: calc.cmrr,
        subscription_list_total: calc.subListTotal,
        subscription_net_total: calc.subNetTotal,
        subscription_discount_amount: calc.subDiscountAmt,
        subscription_discount_percent: calc.subDiscountPct,
        services_total: calc.svcTotal,
        free_months: freeMonths,
        free_months_timing: freeMonthsTiming,
        signing_bonus: calc.sigBonus,
        signing_bonus_type: signingBonusType,
        signing_bonus_months: signingBonusMonths,
        year_one_total: calc.y1Total,
        total_contract_value: calc.tcv,
        prepared_by: profile?.id,
        status,
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
          discount_percentage: item.discount_pct,
          discount_amount: (item.list_price * item.quantity) - item.net_price,
          net_price: item.net_price, override_discount: item.override, line_order: idx,
        })))
      }

      // Payment schedules
      await supabase.from('payment_schedules').delete().eq('quote_id', savedQuoteId)
      if (generatedSchedule.length > 0) {
        await supabase.from('payment_schedules').insert(generatedSchedule.map(p => ({
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

      // Display settings
      const settingsData = { deal_id: dealId, ...displaySettings }
      delete settingsData.id
      delete settingsData.created_at
      delete settingsData.updated_at
      const { data: existingSettings } = await supabase.from('proposal_settings').select('id').eq('deal_id', dealId).single()
      if (existingSettings) {
        await supabase.from('proposal_settings').update(settingsData).eq('id', existingSettings.id)
      } else {
        await supabase.from('proposal_settings').insert(settingsData)
      }

      // Update deal value
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
    p.product_name?.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.sku || '').toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.category || '').toLowerCase().includes(productSearch.toLowerCase())
  )

  const statusColors = { draft: T.textMuted, pending_approval: T.warning, approved: T.success, sent: T.primary }
  const statusLabels = { draft: 'Draft', pending_approval: 'Pending Approval', approved: 'Approved', sent: 'Sent' }
  const statusFlow = { draft: 'Submit for Approval', pending_approval: 'Approve', approved: 'Mark as Sent' }

  const categoryColors = {
    subscription: T.primary,
    implementation: '#8b5cf6',
    services: '#f59e0b',
    training: '#10b981',
    support: '#0ea5e9',
  }

  // Signer contacts: signers first, then all
  const signerContacts = contacts.filter(c => c.is_signer)
  const otherContacts = contacts.filter(c => !c.is_signer)

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(`/deal/${dealId}`)} style={{
          background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
          padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
          fontWeight: 600, fontFamily: T.font,
        }}>&larr; {deal.company_name}</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Quote Builder</div>
          <div style={{ fontSize: 13, color: T.textSecondary }}>{deal.company_name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {favorites.length > 0 && (
            <select style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
              defaultValue="" onChange={e => e.target.value && loadFavorite(e.target.value)}>
              <option value="">Load Favorite...</option>
              {favorites.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          {lineItems.length > 0 && !showSaveFav && (
            <Button onClick={() => setShowSaveFav(true)}>Save as Favorite</Button>
          )}
          {showSaveFav && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input style={{ ...inputStyle, width: 160, padding: '6px 10px', fontSize: 12 }}
                placeholder="Favorite name..." value={saveFavName} onChange={e => setSaveFavName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveAsFavorite()} autoFocus />
              <Button primary onClick={saveAsFavorite} style={{ padding: '6px 10px', fontSize: 11 }}>Save</Button>
              <Button onClick={() => { setShowSaveFav(false); setSaveFavName('') }} style={{ padding: '6px 10px', fontSize: 11 }}>Cancel</Button>
            </div>
          )}
          <Button primary onClick={saveQuote} disabled={saving}>{saving ? 'Saving...' : 'Save Quote'}</Button>
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>

        {/* ══════════ SECTION 1: QUOTE DETAILS ══════════ */}
        <Section title="Quote Details" badge={<Badge color={statusColors[status]}>{statusLabels[status]}</Badge>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Quote Name</label>
              <input style={inputStyle} value={quoteName} onChange={e => setQuoteName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Signer Contact</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={signerId} onChange={e => setSignerId(e.target.value)}>
                <option value="">Select signer...</option>
                {signerContacts.length > 0 && (
                  <optgroup label="Signers">
                    {signerContacts.map(c => <option key={c.id} value={c.id}>{c.contact_name} - {c.title || 'No title'}</option>)}
                  </optgroup>
                )}
                {otherContacts.length > 0 && (
                  <optgroup label="Other Contacts">
                    {otherContacts.map(c => <option key={c.id} value={c.id}>{c.contact_name} - {c.title || 'No title'}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Prepared By</label>
              <input style={{ ...inputStyle, background: T.surfaceAlt }} value={profile?.full_name || profile?.email || 'You'} readOnly />
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: T.textSecondary, fontWeight: 600 }}>Status:</span>
            <Badge color={statusColors[status]}>{statusLabels[status]}</Badge>
            {statusFlow[status] && (
              <Button onClick={advanceStatus} style={{ padding: '4px 12px', fontSize: 11 }}>
                {statusFlow[status]}
              </Button>
            )}
          </div>
        </Section>

        {/* ══════════ SECTION 2: PRODUCTS & PRICING ══════════ */}
        <Section title="Products & Pricing" badge={
          <span style={{ fontSize: 12, color: T.textSecondary }}>{lineItems.length} item{lineItems.length !== 1 ? 's' : ''}</span>
        }>
          {/* Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: T.textSecondary, fontWeight: 600 }}>Global Discount:</label>
              <input type="number" min="0" max="100" step="0.5" value={globalDiscount}
                onChange={e => setGlobalDiscount(Number(e.target.value) || 0)}
                style={{ ...inputStyle, width: 80, padding: '6px 10px', textAlign: 'center' }} />
              <span style={{ fontSize: 12, color: T.textMuted }}>%</span>
            </div>
            <Button primary onClick={() => setShowAddProduct(true)}>+ Add Product</Button>
          </div>

          {/* Add Product Modal */}
          {showAddProduct && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.4)', zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} onClick={e => { if (e.target === e.currentTarget) { setShowAddProduct(false); setProductSearch('') } }}>
              <div style={{
                background: T.surface, borderRadius: T.radius, width: 600, maxHeight: '70vh',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)', overflow: 'hidden',
              }}>
                <div style={{ padding: '16px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Add Product</span>
                  <button onClick={() => { setShowAddProduct(false); setProductSearch('') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: T.textMuted }}>&times;</button>
                </div>
                <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.borderLight}` }}>
                  <input style={inputStyle} placeholder="Search by name, SKU, or category..."
                    value={productSearch} onChange={e => setProductSearch(e.target.value)} autoFocus />
                </div>
                <div style={{ maxHeight: 400, overflow: 'auto' }}>
                  {filteredProducts.length === 0 ? (
                    <div style={{ padding: 30, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>No products found.</div>
                  ) : filteredProducts.map(p => (
                    <div key={p.id} onClick={() => addProduct(p)} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '12px 18px', cursor: 'pointer', borderBottom: `1px solid ${T.borderLight}`,
                      transition: 'background 0.1s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.product_name}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                          <Badge color={categoryColors[p.category] || T.textMuted}>{p.category}</Badge>
                          <Badge color={T.textMuted}>{p.billing_frequency}</Badge>
                          {p.sku && <span style={{ fontSize: 11, color: T.textMuted }}>SKU: {p.sku}</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>
                        ${(p.list_price || 0).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Line Items Table */}
          {lineItems.length === 0 ? (
            <EmptyState message="No products added yet. Click '+ Add Product' to build the quote." />
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                      {['', 'Product', 'Category', 'Qty', 'List Price', 'Custom Price', 'Discount %', 'Discount $', 'Net Price', 'Override', ''].map((h, i) => (
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
                            {item.sku && <div style={{ fontSize: 10, color: T.textMuted }}>SKU: {item.sku}</div>}
                          </td>
                          <td style={{ padding: '8px 6px' }}>
                            <Badge color={categoryColors[item.category] || T.textMuted}>{item.category}</Badge>
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            <input type="number" min="1" value={item.quantity}
                              onChange={e => updateLineItem(item.id, 'quantity', Number(e.target.value) || 1)}
                              style={{ ...inputStyle, width: 55, padding: '4px 6px', textAlign: 'center' }} />
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                            ${(item.list_price || 0).toLocaleString()}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                              <input type="checkbox" checked={item.useCustomPrice}
                                onChange={e => updateLineItem(item.id, 'useCustomPrice', e.target.checked)}
                                style={{ cursor: 'pointer' }} />
                              {item.useCustomPrice && (
                                <input type="number" min="0" value={item.custom_price || ''}
                                  onChange={e => updateLineItem(item.id, 'custom_price', Number(e.target.value) || 0)}
                                  style={{ ...inputStyle, width: 85, padding: '4px 6px', textAlign: 'right' }} />
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            <input type="number" min="0" max="100" step="0.5"
                              value={item.override ? item.discount_pct : globalDiscount}
                              onChange={e => {
                                if (!item.override) return
                                updateLineItem(item.id, 'discount_pct', Number(e.target.value) || 0)
                              }}
                              disabled={!item.override}
                              style={{ ...inputStyle, width: 60, padding: '4px 6px', textAlign: 'center', opacity: item.override ? 1 : 0.6 }} />
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', fontSize: 12, color: discountAmt > 0 ? T.success : T.textMuted, fontFeatureSettings: '"tnum"' }}>
                            {discountAmt > 0 ? `-$${Math.round(discountAmt).toLocaleString()}` : '--'}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"', color: T.text }}>
                            ${Math.round(item.net_price).toLocaleString()}
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
                            >&times;</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${T.border}`, background: T.surfaceAlt }}>
                      <td colSpan={4} style={{ padding: '10px 6px', fontSize: 12, color: T.textSecondary }}>
                        <div style={{ display: 'flex', gap: 16 }}>
                          <span>Sub List: <strong style={{ color: T.text }}>${Math.round(calc.subListTotal).toLocaleString()}</strong></span>
                          <span>Sub Net: <strong style={{ color: T.primary }}>${Math.round(calc.subNetTotal).toLocaleString()}</strong></span>
                          <span>Sub Discount: <strong style={{ color: T.success }}>${Math.round(calc.subDiscountAmt).toLocaleString()}</strong></span>
                        </div>
                      </td>
                      <td colSpan={3} style={{ padding: '10px 6px', fontSize: 12, color: T.textSecondary, textAlign: 'right' }}>
                        <span>Impl: <strong style={{ color: T.text }}>${Math.round(calc.implTotal).toLocaleString()}</strong></span>
                        <span style={{ marginLeft: 12 }}>Svc: <strong style={{ color: T.text }}>${Math.round(calc.svcTotal).toLocaleString()}</strong></span>
                      </td>
                      <td colSpan={2} style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700, fontSize: 15, color: T.text, fontFeatureSettings: '"tnum"' }}>
                        ${Math.round(calc.subNetTotal + calc.implTotal + calc.svcTotal).toLocaleString()}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </Section>

        {/* ══════════ SECTION 3: IMPLEMENTATION ══════════ */}
        <Section title="Implementation" defaultOpen={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Implementor</label>
              <input style={inputStyle} value={implementor} onChange={e => setImplementor(e.target.value)} placeholder="Implementor name" />
            </div>
            <div>
              <label style={labelStyle}>Implementation Cost</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 13 }}>$</span>
                <input type="number" min="0" style={{ ...inputStyle, paddingLeft: 22 }} value={implCost || ''}
                  onChange={e => setImplCost(Number(e.target.value) || 0)} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Implementation Months</label>
              <input type="number" min="1" max="24" style={inputStyle} value={implMonths}
                onChange={e => setImplMonths(Number(e.target.value) || 3)} />
            </div>
            <div>
              <label style={labelStyle}>Project Kickoff Date</label>
              <input type="date" style={inputStyle} value={kickoffDate} onChange={e => setKickoffDate(e.target.value)} />
            </div>
          </div>
        </Section>

        {/* ══════════ SECTION 4: CONTRACT TERMS ══════════ */}
        <Section title="Contract Terms">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Contract Type</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={contractType} onChange={e => setContractType(e.target.value)}>
                <option value="price_cap">Price Cap</option>
                <option value="myc">MYC (Multi-Year Contract)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Contract Length</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={contractYears} onChange={e => setContractYears(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map(y => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Price Increases</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={priceIncreasePreset}
                onChange={e => {
                  const preset = (PRICE_INCREASE_PRESETS[contractYears] || []).find(p => p.label === e.target.value)
                  setPriceIncreasePreset(e.target.value)
                  if (preset) setPriceIncreaseValues(preset.values)
                }}>
                <option value="">Select preset...</option>
                {(PRICE_INCREASE_PRESETS[contractYears] || []).map(p => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Payment Frequency</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={paymentFrequency} onChange={e => setPaymentFrequency(e.target.value)}>
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Signing Date</label>
              <input type="date" style={inputStyle} value={signingDate} onChange={e => setSigningDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Contract Start Date</label>
              <input type="date" style={inputStyle} value={contractStart} onChange={e => setContractStart(e.target.value)} />
            </div>
          </div>
        </Section>

        {/* ══════════ SECTION 5: INCENTIVES ══════════ */}
        <Section title="Incentives" defaultOpen={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Signing Bonus */}
            <div>
              <label style={labelStyle}>Signing Bonus</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button onClick={() => setSigningBonusType('fixed')} style={{
                  flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, fontFamily: T.font,
                  border: `1px solid ${signingBonusType === 'fixed' ? T.primary : T.border}`,
                  background: signingBonusType === 'fixed' ? T.primaryLight : T.surface,
                  color: signingBonusType === 'fixed' ? T.primary : T.textSecondary,
                  borderRadius: 6, cursor: 'pointer',
                }}>Fixed ($)</button>
                <button onClick={() => setSigningBonusType('months')} style={{
                  flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, fontFamily: T.font,
                  border: `1px solid ${signingBonusType === 'months' ? T.primary : T.border}`,
                  background: signingBonusType === 'months' ? T.primaryLight : T.surface,
                  color: signingBonusType === 'months' ? T.primary : T.textSecondary,
                  borderRadius: 6, cursor: 'pointer',
                }}>Months-based</button>
              </div>
              {signingBonusType === 'fixed' ? (
                <div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 13 }}>$</span>
                    <input type="number" min="0" style={{ ...inputStyle, paddingLeft: 22 }} value={signingBonusAmount || ''}
                      onChange={e => setSigningBonusAmount(Number(e.target.value) || 0)} />
                  </div>
                </div>
              ) : (
                <div>
                  <input type="number" min="0" max="12" style={inputStyle} value={signingBonusMonths || ''}
                    onChange={e => setSigningBonusMonths(Number(e.target.value) || 0)} placeholder="Number of months" />
                  {signingBonusMonths > 0 && calc.arr > 0 && (
                    <div style={{ fontSize: 12, color: T.success, marginTop: 6, fontWeight: 600 }}>
                      Calculated value: ${Math.round((calc.arr / 12) * signingBonusMonths).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Free Months */}
            <div>
              <label style={labelStyle}>Free Months</label>
              <input type="number" min="0" max="12" style={{ ...inputStyle, marginBottom: 8 }} value={freeMonths || ''}
                onChange={e => setFreeMonths(Number(e.target.value) || 0)} />
              {freeMonths > 0 && (
                <div style={{ fontSize: 12, color: T.success, marginBottom: 10, fontWeight: 600 }}>
                  Value: ${Math.round(calc.fmValue).toLocaleString()} ({freeMonths} months x ${Math.round(calc.subNetTotal / 12).toLocaleString()}/mo)
                </div>
              )}
              <label style={labelStyle}>Free Months Timing</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setFreeMonthsTiming('beginning')} style={{
                  flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, fontFamily: T.font,
                  border: `1px solid ${freeMonthsTiming === 'beginning' ? T.primary : T.border}`,
                  background: freeMonthsTiming === 'beginning' ? T.primaryLight : T.surface,
                  color: freeMonthsTiming === 'beginning' ? T.primary : T.textSecondary,
                  borderRadius: 6, cursor: 'pointer',
                }}>Beginning</button>
                <button onClick={() => setFreeMonthsTiming('end')} style={{
                  flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, fontFamily: T.font,
                  border: `1px solid ${freeMonthsTiming === 'end' ? T.primary : T.border}`,
                  background: freeMonthsTiming === 'end' ? T.primaryLight : T.surface,
                  color: freeMonthsTiming === 'end' ? T.primary : T.textSecondary,
                  borderRadius: 6, cursor: 'pointer',
                }}>End</button>
              </div>
            </div>
          </div>
        </Section>

        {/* ══════════ SECTION 6: QUOTE SUMMARY (sticky) ══════════ */}
        <Section title="Quote Summary" sticky>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {[
              ['Subscription List', calc.subListTotal, T.textSecondary],
              ['Subscription Net', calc.subNetTotal, T.primary],
              ['Sub Discount', calc.subDiscountAmt, T.success, `${calc.subDiscountPct.toFixed(1)}%`],
              ['Implementation', calc.implTotal, '#8b5cf6'],
              ['Services', calc.svcTotal, T.textSecondary],
              ['ARR', calc.arr, T.primary],
              ['CMRR', calc.cmrr, T.text],
              ['Year 1 Total', calc.y1Total, T.success],
            ].map(([label, value, color, extra]) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color, fontFeatureSettings: '"tnum"' }}>
                  ${Math.round(value).toLocaleString()}
                  {extra && <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 4 }}>({extra})</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `2px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Total Contract Value</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: T.text, fontFeatureSettings: '"tnum"' }}>
                ${Math.round(calc.tcv).toLocaleString()}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: T.textSecondary }}>
              <div>{contractYears} year{contractYears > 1 ? 's' : ''} | {paymentFrequency}</div>
              {(freeMonths > 0 || calc.sigBonus > 0) && (
                <div style={{ color: T.success }}>
                  Incentives: ${Math.round(calc.fmValue + calc.sigBonus).toLocaleString()} off
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ══════════ SECTION 7: TCO BREAKDOWN ══════════ */}
        <Section title="TCO Breakdown" defaultOpen={false}>
          {generatedTco.length === 0 ? (
            <EmptyState message="Add products to see the TCO breakdown." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Category</th>
                    {generatedTco.map(yr => (
                      <th key={yr.year_number} style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>
                        Year {yr.year_number}
                      </th>
                    ))}
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.text, textTransform: 'uppercase' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Subscription', 'subscription', T.primary],
                    ['Implementation', 'implementation', '#8b5cf6'],
                    ['Services', 'services', T.textSecondary],
                    ['Incentives', 'incentives', T.success],
                  ].map(([label, key, color]) => (
                    <tr key={key} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                      <td style={{ padding: '10px', color: T.text, fontWeight: 500 }}>{label}</td>
                      {generatedTco.map(yr => (
                        <td key={yr.year_number} style={{
                          padding: '10px', textAlign: 'right', fontFeatureSettings: '"tnum"',
                          color: key === 'incentives' && yr[key] > 0 ? T.success : T.text,
                        }}>
                          {key === 'incentives' && yr[key] > 0 ? `-$${Math.round(yr[key]).toLocaleString()}` : `$${Math.round(yr[key] || 0).toLocaleString()}`}
                        </td>
                      ))}
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"', color }}>
                        {key === 'incentives'
                          ? `-$${Math.round(generatedTco.reduce((s, y) => s + (y[key] || 0), 0)).toLocaleString()}`
                          : `$${Math.round(generatedTco.reduce((s, y) => s + (y[key] || 0), 0)).toLocaleString()}`
                        }
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `2px solid ${T.border}`, background: T.surfaceAlt }}>
                    <td style={{ padding: '12px 10px', fontWeight: 700, color: T.text }}>Total</td>
                    {generatedTco.map(yr => (
                      <td key={yr.year_number} style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, fontFeatureSettings: '"tnum"', fontSize: 14, color: T.text }}>
                        ${Math.round(yr.total).toLocaleString()}
                      </td>
                    ))}
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 800, fontFeatureSettings: '"tnum"', fontSize: 15, color: T.primary }}>
                      ${Math.round(tcoGrandTotal).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ══════════ SECTION 8: PAYMENT SCHEDULE ══════════ */}
        <Section title="Payment Schedule" defaultOpen={false}
          badge={<span style={{ fontSize: 12, color: T.textSecondary }}>{generatedSchedule.length} payment{generatedSchedule.length !== 1 ? 's' : ''}</span>}>
          {!contractStart ? (
            <EmptyState message="Set a contract start date in Contract Terms to generate the payment schedule." />
          ) : generatedSchedule.length === 0 ? (
            <EmptyState message="Add products to generate the payment schedule." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {['Billing Date', 'Due Date', 'Type', 'Period', 'Amount'].map(h => (
                      <th key={h} style={{
                        textAlign: h === 'Amount' ? 'right' : 'left', padding: '8px 10px',
                        fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {generatedSchedule.map((p, i) => {
                    const typeBg = p.payment_type === 'implementation' ? 'rgba(139, 92, 246, 0.06)'
                      : p.payment_type === 'subscription' ? 'rgba(93, 173, 226, 0.06)'
                      : 'rgba(220, 53, 69, 0.06)'
                    const typeColor = p.payment_type === 'implementation' ? '#8b5cf6'
                      : p.payment_type === 'subscription' ? T.primary : T.error
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}`, background: typeBg }}>
                        <td style={{ padding: '10px' }}>{p.payment_date ? formatDateLong(p.payment_date) : '--'}</td>
                        <td style={{ padding: '10px' }}>{p.due_date ? formatDateLong(p.due_date) : '--'}</td>
                        <td style={{ padding: '10px' }}><Badge color={typeColor}>{p.payment_type === 'free_month' ? 'Free Month' : p.payment_type}</Badge></td>
                        <td style={{ padding: '10px' }}>{p.period_label}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum"', color: p.amount === 0 ? T.success : T.text }}>
                          {p.amount === 0 ? '$0 (Free)' : `$${Math.round(p.amount).toLocaleString()}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${T.border}`, background: T.surfaceAlt }}>
                    <td colSpan={4} style={{ padding: '12px 10px', fontWeight: 700, color: T.text }}>Total Payments</td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, fontSize: 15, fontFeatureSettings: '"tnum"', color: T.primary }}>
                      ${Math.round(generatedSchedule.reduce((s, p) => s + p.amount, 0)).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Section>

        {/* ══════════ SECTION 9: DISPLAY SETTINGS ══════════ */}
        <Section title="Display Settings" defaultOpen={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Colors */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 12 }}>Colors</div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Primary Color</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={displaySettings.primary_color}
                      onChange={e => setDisplaySettings(prev => ({ ...prev, primary_color: e.target.value }))}
                      style={{ width: 36, height: 36, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                    <input style={{ ...inputStyle, width: 100, padding: '6px 10px', fontSize: 12 }}
                      value={displaySettings.primary_color}
                      onChange={e => setDisplaySettings(prev => ({ ...prev, primary_color: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Secondary Color</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={displaySettings.secondary_color}
                      onChange={e => setDisplaySettings(prev => ({ ...prev, secondary_color: e.target.value }))}
                      style={{ width: 36, height: 36, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                    <input style={{ ...inputStyle, width: 100, padding: '6px 10px', fontSize: 12 }}
                      value={displaySettings.secondary_color}
                      onChange={e => setDisplaySettings(prev => ({ ...prev, secondary_color: e.target.value }))} />
                  </div>
                </div>
              </div>
            </div>

            {/* Show/Hide Toggles */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 12 }}>Visibility</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['hide_order_schedule', 'Order Schedule'],
                  ['hide_list_price_column', 'List Price Column'],
                  ['hide_discount_column', 'Discount Column'],
                  ['hide_net_price_column', 'Net Price Column'],
                  ['hide_discount_percent', 'Discount %'],
                  ['hide_total_discount', 'Total Discount'],
                  ['hide_total_row', 'Total Row'],
                  ['hide_incentives_section', 'Incentives Section'],
                  ['hide_payment_schedule', 'Payment Schedule'],
                  ['hide_tco_section', 'TCO Section'],
                ].map(([key, label]) => (
                  <label key={key} style={{
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    padding: '6px 8px', borderRadius: 6, fontSize: 12, color: T.text,
                    background: displaySettings[key] ? T.errorLight : 'transparent',
                  }}>
                    <input type="checkbox" checked={!displaySettings[key]}
                      onChange={e => setDisplaySettings(prev => ({ ...prev, [key]: !e.target.checked }))}
                      style={{ cursor: 'pointer' }} />
                    <span style={{ color: displaySettings[key] ? T.error : T.text }}>
                      {displaySettings[key] ? 'Hidden' : 'Show'}: {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}
