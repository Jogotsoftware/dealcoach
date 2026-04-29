import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, TabBar, Spinner, EmptyState, inputStyle, labelStyle } from '../components/Shared'
import LogoUploader from '../components/LogoUploader'

// Round UP to whole dollar; backend keeps decimals.
function dollars(n) {
  const v = Number(n) || 0
  const rounded = Math.ceil(Math.abs(v))
  return (v < 0 ? '-$' : '$') + rounded.toLocaleString('en-US')
}

const STATUS_OPTIONS = ['draft', 'sent', 'accepted', 'rejected', 'superseded']
const STATUS_COLORS = {
  draft: T.textMuted, sent: T.primary, accepted: T.success, rejected: T.error, superseded: T.textMuted,
}
const BILLING_TYPE_LABELS = {
  fixed_bid_50_50: 'Fixed Bid (50/50)',
  tm_monthly: 'T&M (monthly)',
  one_time: 'One-time',
  milestone_custom: 'Custom milestones',
}
const PARTNER_CADENCE_OPTIONS = ['annual', 'quarterly', 'upfront', 'custom']

// Color map for payment schedule rows
const PAYMENT_TYPE_COLORS = {
  subscription_year: T.primary,
  subscription_quarter: T.primary,
  partner_subscription_year: T.sageGreen,
  implementation_arrears: T.warning,
  implementation_milestone: T.warning,
  one_time_service: T.textMuted,
  percent_surcharge: '#a855f7',  // purple
  custom: T.text,
}
const PAYMENT_TYPE_LABELS = {
  subscription_year: 'Subscription (annual)',
  subscription_quarter: 'Subscription (qtr)',
  partner_subscription_year: 'Partner sub',
  implementation_arrears: 'Impl arrears',
  implementation_milestone: 'Impl milestone',
  one_time_service: 'One-time',
  percent_surcharge: 'Surcharge',
  custom: 'Custom',
}

// Helper for the deal-room visibility config jsonb
function drGet(quote, path, fallback = true) {
  const cfg = quote?.deal_room_display_config || {}
  const parts = path.split('.')
  let cur = cfg
  for (const p of parts) {
    if (cur == null) return fallback
    cur = cur[p]
  }
  return cur === undefined ? fallback : !!cur
}
function drSetPatch(quote, path, value) {
  const cfg = JSON.parse(JSON.stringify(quote?.deal_room_display_config || {}))
  const parts = path.split('.')
  let cur = cfg
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
  return { deal_room_display_config: cfg }
}

// ──────────────────────────────────────────────────────────
// Top-level page
// ──────────────────────────────────────────────────────────
export default function QuoteBuilder() {
  const { dealId, quoteId } = useParams()
  const nav = useNavigate()
  const { profile } = useAuth()
  const { org } = useOrg()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('quote')
  const [savingFlash, setSavingFlash] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [shareCopied, setShareCopied] = useState(false)

  const [deal, setDeal] = useState(null)
  const [quote, setQuote] = useState(null)
  const [lines, setLines] = useState([])
  const [products, setProducts] = useState([])
  const [productMap, setProductMap] = useState({})
  const [bundleChildrenMap, setBundleChildrenMap] = useState({})
  const [favorites, setFavorites] = useState([])
  const [implItems, setImplItems] = useState([])
  const [partnerBlocks, setPartnerBlocks] = useState([])
  const [partnerLines, setPartnerLines] = useState([])
  const [schedule, setSchedule] = useState([])
  const [contractTerms, setContractTerms] = useState([])
  const [contacts, setContacts] = useState([])
  const [pains, setPains] = useState([])

  const [warningDismissed, setWarningDismissed] = useState(false)

  const pendingFlushers = useRef(new Set())
  function registerFlusher(fn) {
    pendingFlushers.current.add(fn)
    return () => pendingFlushers.current.delete(fn)
  }
  async function flushPending() {
    const fns = Array.from(pendingFlushers.current)
    await Promise.all(fns.map(fn => { try { return fn() } catch { return null } }))
  }

  const reload = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    setError('')
    try {
      const [dealRes, quoteRes, linesRes, prodRes, bundleRes, favRes, implRes, blocksRes, plinesRes, schedRes, termsRes, contactsRes, painsRes] = await Promise.all([
        supabase.from('deals').select('id, company_name, customer_logo_url, customer_logo_storage_path').eq('id', dealId).single(),
        supabase.from('quotes').select('*').eq('id', quoteId).single(),
        supabase.from('quote_lines').select('*').eq('quote_id', quoteId).order('line_order'),
        supabase.from('products').select('*').eq('active', true).order('sort_order').order('name'),
        supabase.from('product_bundle_items').select('*').order('sort_order'),
        supabase.from('product_favorites').select('*').eq('user_id', profile?.id || '').order('sort_order'),
        supabase.from('quote_implementation_items').select('*').eq('quote_id', quoteId).order('sort_order'),
        supabase.from('quote_partner_blocks').select('*').eq('quote_id', quoteId).order('sort_order'),
        supabase.from('quote_partner_lines').select('*').eq('quote_id', quoteId).order('sort_order'),
        supabase.from('quote_payment_schedule').select('*').eq('quote_id', quoteId).order('sequence_number'),
        supabase.from('contract_terms').select('*').eq('active', true).order('sort_order'),
        supabase.from('contacts').select('id, name, title, email, role_in_deal').eq('deal_id', dealId).order('name'),
        supabase.from('deal_pain_points').select('id, pain_description, annual_cost, annual_hours').eq('deal_id', dealId).order('annual_cost', { ascending: false, nullsFirst: false }),
      ])
      if (dealRes.error) throw dealRes.error
      if (quoteRes.error) throw quoteRes.error

      setDeal(dealRes.data)
      setQuote(quoteRes.data)
      setLines(linesRes.data || [])
      setProducts(prodRes.data || [])
      const map = {}
      for (const p of prodRes.data || []) map[p.id] = p
      setProductMap(map)
      const bMap = {}
      for (const b of bundleRes.data || []) {
        if (!bMap[b.bundle_product_id]) bMap[b.bundle_product_id] = []
        bMap[b.bundle_product_id].push(b)
      }
      setBundleChildrenMap(bMap)
      setFavorites(favRes.data || [])
      setImplItems(implRes.data || [])
      setPartnerBlocks(blocksRes.data || [])
      setPartnerLines(plinesRes.data || [])
      setSchedule(schedRes.data || [])
      setContractTerms(termsRes.data || [])
      setContacts(contactsRes.data || [])
      setPains(painsRes.data || [])
    } catch (e) {
      console.error('[QuoteBuilder] reload failed:', e)
      setError(e?.message || 'Load failed')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [dealId, quoteId, profile?.id])

  useEffect(() => { reload(true) }, [reload])

  async function recomputeSub() { try { await supabase.rpc('compute_quote', { p_quote_id: quoteId }) } catch (e) { console.error('compute_quote:', e) } }
  async function recomputePartner() {
    try { await supabase.rpc('compute_partner_lines', { p_quote_id: quoteId }) } catch (e) { console.error('compute_partner_lines:', e) }
    try { await supabase.rpc('recompute_quote_totals', { p_quote_id: quoteId }) } catch (e) { console.error('recompute_quote_totals:', e) }
  }
  async function recomputeTotals() { try { await supabase.rpc('recompute_quote_totals', { p_quote_id: quoteId }) } catch (e) { console.error('recompute_quote_totals:', e) } }
  async function regenSchedule() { try { await supabase.rpc('generate_payment_schedule', { p_quote_id: quoteId }) } catch (e) { console.error('generate_payment_schedule:', e) } }

  async function saveQuoteHeader(patch) {
    try {
      const { error: e } = await supabase.from('quotes').update(patch).eq('id', quoteId)
      if (e) throw e
      setQuote(prev => ({ ...prev, ...patch }))
    } catch (e) {
      console.error('saveQuoteHeader failed:', e, patch)
      setError(e?.message || 'Save failed')
    }
  }

  async function setPrimary() {
    try {
      await supabase.from('quotes').update({ is_primary: false }).eq('deal_id', dealId).neq('id', quoteId)
      await supabase.from('quotes').update({ is_primary: true }).eq('id', quoteId)
      setQuote(prev => ({ ...prev, is_primary: true }))
    } catch (e) { setError(e?.message || 'Set primary failed') }
  }

  async function handleSave() {
    setSavingFlash(true)
    try {
      await flushPending()
      await recomputeSub()
      await recomputePartner()
      await regenSchedule()
      await reload()
      setSavedAt(new Date())
    } finally { setSavingFlash(false) }
  }

  async function handleShareLink() {
    let token = quote.share_token
    if (!token) {
      // Generate a URL-safe random token
      const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2)
      token = rand + Math.random().toString(36).slice(2, 8)
      try {
        const { error: e } = await supabase.from('quotes').update({ share_token: token }).eq('id', quoteId)
        if (e) throw e
        setQuote(prev => ({ ...prev, share_token: token }))
      } catch (e) {
        console.error('share token save failed:', e)
        setError(e?.message || 'Failed to generate share link')
        return
      }
    }
    const url = `${window.location.origin}/share/quote/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 3000)
    } catch {
      // Fallback: prompt with the URL
      window.prompt('Copy this share link:', url)
    }
  }

  if (loading) return <Spinner />
  if (error && !quote) return <div style={{ padding: 40, color: T.error }}>{error}</div>
  if (!quote) return <div style={{ padding: 40, color: T.textMuted }}>Quote not found</div>

  const tabs = [
    { key: 'quote', label: 'Quote' },
    { key: 'partners', label: `Partners${partnerBlocks.length ? ` (${partnerBlocks.length})` : ''}` },
    { key: 'resources', label: 'Resources' },
    { key: 'roi', label: 'ROI' },
    { key: 'schedule', label: `Schedule${schedule.length ? ` (${schedule.length})` : ''}` },
    { key: 'msp', label: 'MSP' },
  ]

  const showWarning = !!quote.compute_warning && !warningDismissed

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <button onClick={() => nav(`/deal/${dealId}/quotes`)} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Quotes</button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              defaultValue={quote.name}
              onBlur={e => { if (e.target.value !== quote.name) saveQuoteHeader({ name: e.target.value }) }}
              style={{ ...inputStyle, fontSize: 16, fontWeight: 700, padding: '6px 10px', maxWidth: 280 }}
            />
            <Badge color={T.textMuted}>v{quote.version}</Badge>
            <select
              value={quote.status}
              onChange={e => saveQuoteHeader({ status: e.target.value })}
              style={{ ...inputStyle, fontSize: 11, padding: '4px 8px', maxWidth: 110, cursor: 'pointer', color: STATUS_COLORS[quote.status], fontWeight: 600, textTransform: 'uppercase' }}
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {!quote.is_primary ? (
              <Button onClick={setPrimary} style={{ padding: '4px 10px', fontSize: 11 }}>Set Primary</Button>
            ) : (
              <Badge color={T.primary}>Primary</Badge>
            )}
            <ContactPicker
              contacts={contacts}
              currentId={quote.signer_contact_id}
              onChange={async (id) => { await saveQuoteHeader({ signer_contact_id: id }); }}
            />
          </div>
          <Button onClick={() => nav(`/deal/${dealId}/quote/${quoteId}/proposal`)} style={{ padding: '10px 22px', fontSize: 13 }}>Preview</Button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <Button onClick={handleShareLink} style={{ padding: '8px 14px', fontSize: 12 }}>
              {shareCopied ? 'Link copied ✓' : 'Share link'}
            </Button>
            {quote.share_token && !shareCopied && (
              <span style={{ fontSize: 10, color: T.textMuted }}>Active</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <Button primary onClick={handleSave} disabled={savingFlash} style={{ padding: '8px 18px', fontSize: 13 }}>
              {savingFlash ? 'Saving…' : 'Save'}
            </Button>
            {savedAt && !savingFlash && (
              <span style={{ fontSize: 10, color: T.textMuted }}>Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {showWarning && (
        <div style={{ margin: '10px 24px 0', padding: '8px 12px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, border: `1px solid ${T.error}30`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong>Compute warning:</strong>
          <span style={{ flex: 1 }}>{quote.compute_warning}</span>
          <button onClick={() => setWarningDismissed(true)} style={{ background: 'transparent', border: 'none', color: T.error, cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
        </div>
      )}
      {error && (
        <div style={{ margin: '10px 24px 0', padding: '8px 12px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, border: `1px solid ${T.error}30` }}>{error}</div>
      )}

      <div style={{ padding: '16px 24px' }}>
        {tab === 'quote' && (
          <QuoteTab
            quote={quote}
            deal={deal}
            lines={lines}
            products={products}
            productMap={productMap}
            bundleChildrenMap={bundleChildrenMap}
            favorites={favorites}
            implItems={implItems.filter(i => i.source === 'sage')}
            contractTerms={contractTerms}
            profileId={profile?.id}
            saveQuoteHeader={saveQuoteHeader}
            registerFlusher={registerFlusher}
            onSubChanged={async () => { await recomputeSub(); await reload() }}
            onImplChanged={async () => { await recomputeTotals(); await regenSchedule(); await reload() }}
            onTermsChanged={async () => { await recomputeTotals(); await regenSchedule(); await reload() }}
            refreshFavorites={async () => {
              const { data } = await supabase.from('product_favorites').select('*').eq('user_id', profile?.id || '').order('sort_order')
              setFavorites(data || [])
            }}
          />
        )}
        {tab === 'partners' && (
          <PartnersTab
            quote={quote}
            quoteId={quoteId}
            partnerBlocks={partnerBlocks}
            partnerLines={partnerLines}
            implItems={implItems.filter(i => i.source === 'partner')}
            saveQuoteHeader={saveQuoteHeader}
            onPartnerSubChanged={async () => { await recomputePartner(); await reload() }}
            onImplChanged={async () => { await recomputeTotals(); await regenSchedule(); await reload() }}
          />
        )}
        {tab === 'resources' && (
          <ResourcesTab
            deal={deal}
            onDealUpdated={(patch) => setDeal(prev => prev ? { ...prev, ...patch } : prev)}
          />
        )}
        {tab === 'roi' && (
          <RoiTab quote={quote} pains={pains} />
        )}
        {tab === 'schedule' && (
          <ScheduleTab
            quote={quote}
            schedule={schedule}
            onRegenerate={async () => { await regenSchedule(); await reload() }}
            onChanged={async () => { await reload() }}
          />
        )}
        {tab === 'msp' && (
          <MspTab dealId={dealId} />
        )}
      </div>
    </div>
  )
}

function ContactPicker({ contacts, currentId, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Contact:</span>
      <select
        value={currentId || ''}
        onChange={e => onChange(e.target.value || null)}
        style={{ ...inputStyle, fontSize: 11, padding: '4px 6px', maxWidth: 200, cursor: 'pointer' }}
      >
        <option value="">— Select —</option>
        {contacts.map(c => (
          <option key={c.id} value={c.id}>{c.name}{c.title ? ` · ${c.title}` : ''}</option>
        ))}
      </select>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// QUOTE TAB — Subscription + Implementation + Terms stacked
// ══════════════════════════════════════════════════════════
function QuoteTab({ quote, deal, lines, products, productMap, bundleChildrenMap, favorites, implItems, contractTerms, profileId, saveQuoteHeader, registerFlusher, onSubChanged, onImplChanged, onTermsChanged, refreshFavorites }) {
  return (
    <div>
      <SubscriptionSection
        quote={quote}
        lines={lines}
        products={products}
        productMap={productMap}
        bundleChildrenMap={bundleChildrenMap}
        favorites={favorites}
        profileId={profileId}
        saveQuoteHeader={saveQuoteHeader}
        registerFlusher={registerFlusher}
        onChanged={onSubChanged}
        refreshFavorites={refreshFavorites}
      />
      <div style={{ marginTop: 24 }}>
        <ImplementationSection
          quote={quote}
          quoteId={quote.id}
          implItems={implItems}
          implementorDefault="Sage"
          source="sage"
          saveQuoteHeader={saveQuoteHeader}
          onChanged={onImplChanged}
        />
      </div>
      <div style={{ marginTop: 24 }}>
        <TermsSection quote={quote} contractTerms={contractTerms} saveQuoteHeader={saveQuoteHeader} onChanged={onTermsChanged} />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// SUBSCRIPTION SECTION
// ──────────────────────────────────────────────────────────
function SubscriptionSection({ quote, lines, products, productMap, bundleChildrenMap, favorites, profileId, saveQuoteHeader, registerFlusher, onChanged, refreshFavorites }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [showFavManager, setShowFavManager] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  // Local previews for in-flight discount/qty edits
  const [previews, setPreviews] = useState({})
  const debounceTimers = useRef({})

  // Group lines: parents + their children, ordered by line_order. Children indent under parent.
  const orderedLines = useMemo(() => {
    const byParent = new Map()
    for (const ln of lines) {
      const key = ln.parent_line_id || '__root'
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key).push(ln)
    }
    const roots = (byParent.get('__root') || []).slice().sort((a, b) => (a.line_order || 0) - (b.line_order || 0))
    const out = []
    for (const r of roots) {
      out.push(r)
      const kids = (byParent.get(r.id) || []).slice().sort((a, b) => (a.line_order || 0) - (b.line_order || 0))
      for (const c of kids) out.push(c)
    }
    return out
  }, [lines])

  const listSubtotal = Number(quote.list_subtotal) || 0
  const discountTotal = Number(quote.discount_total) || 0
  const percentTotal = Number(quote.percent_lines_total) || 0
  const sageSubscriptionTotal = Number(quote.sage_subscription_total) || 0

  const globalDiscountUiPct = Math.round((Number(quote.global_discount_pct) || 0) * 10000) / 100

  // Per-column deal-room visibility (toggles in column headers)
  const colVis = {
    qty: drGet(quote, 'columns.qty', true),
    list: drGet(quote, 'columns.list', true),
    discount: drGet(quote, 'columns.discount', true),
    price: drGet(quote, 'columns.price', true),
  }
  async function toggleColVis(key) {
    const patch = drSetPatch(quote, `columns.${key}`, !colVis[key])
    await saveQuoteHeader(patch)
  }

  async function addProductLines(productIds) {
    const maxOrder = lines.reduce((m, l) => Math.max(m, l.line_order || 0), -1)
    let nextOrder = maxOrder + 1
    for (const pid of productIds) {
      const p = productMap[pid]
      if (!p) continue
      try {
        const { data: parentLine, error: insErr } = await supabase.from('quote_lines').insert({
          quote_id: quote.id,
          product_id: pid,
          parent_line_id: null,
          line_order: nextOrder++,
          quantity: 1,
          unit_price: Number(p.list_price) || 0,
          discount_pct: 0,
          extended: 0,
          apply_global_discount: null,
          show_in_deal_room: true,
        }).select('id').single()
        if (insErr) { console.error('addProductLines parent insert failed:', insErr); continue }

        // Bundle: insert children read-only at $0
        if (p.is_bundle) {
          const children = bundleChildrenMap[pid] || []
          for (const child of children) {
            try {
              await supabase.from('quote_lines').insert({
                quote_id: quote.id,
                product_id: child.child_product_id,
                parent_line_id: parentLine.id,
                line_order: nextOrder++,
                quantity: Number(child.included_quantity) || 1,
                unit_price: 0,
                discount_pct: 0,
                extended: 0,
                apply_global_discount: null,
                show_in_deal_room: true,
              })
            } catch (e) { console.error('addProductLines child insert failed:', e) }
          }
        }
      } catch (e) { console.error('addProductLines failed:', e) }
    }
    await onChanged()
  }

  async function persistLine(lineId, patch) {
    try {
      const { error: e } = await supabase.from('quote_lines').update(patch).eq('id', lineId)
      if (e) throw e
    } catch (e) { console.error('persistLine failed:', e, patch) }
  }

  function scheduleLineUpdate(lineId, patch, delay = 250) {
    const k = lineId
    if (debounceTimers.current[k]) clearTimeout(debounceTimers.current[k])
    debounceTimers.current[k] = setTimeout(async () => {
      delete debounceTimers.current[k]
      await persistLine(lineId, patch)
      setPreviews(prev => {
        const next = { ...prev }
        delete next[lineId]
        return next
      })
      await onChanged()
    }, delay)
  }

  useEffect(() => {
    return registerFlusher(async () => {
      const ids = Object.keys(debounceTimers.current)
      for (const id of ids) { clearTimeout(debounceTimers.current[id]); delete debounceTimers.current[id] }
      const updates = Object.entries(previews)
      for (const [lineId, patch] of updates) await persistLine(lineId, patch)
      setPreviews({})
    })
  }, [previews, registerFlusher])

  function setPreviewField(lineId, field, value) {
    setPreviews(prev => ({ ...prev, [lineId]: { ...(prev[lineId] || {}), [field]: value } }))
  }

  async function deleteLine(lineId) {
    try {
      const { error: e } = await supabase.from('quote_lines').delete().eq('id', lineId)
      if (e) throw e
    } catch (e) { console.error('deleteLine failed:', e) }
    await onChanged()
  }

  async function reorderLines(draggedId, targetId) {
    if (draggedId === targetId) return
    // Only allow reordering of root lines (parent_line_id IS NULL)
    const dragged = orderedLines.find(l => l.id === draggedId)
    const target = orderedLines.find(l => l.id === targetId)
    if (!dragged || !target) return
    if (dragged.parent_line_id || target.parent_line_id) return  // ignore drags involving children

    const roots = orderedLines.filter(l => !l.parent_line_id)
    const others = roots.filter(l => l.id !== draggedId)
    const targetIdx = others.findIndex(l => l.id === targetId)
    const newOrder = [...others.slice(0, targetIdx), dragged, ...others.slice(targetIdx)]

    // Reassign root line_order; children follow their parents' new order via existing parent_line_id
    let nextOrder = 0
    for (const root of newOrder) {
      if ((root.line_order || 0) !== nextOrder) {
        try { await supabase.from('quote_lines').update({ line_order: nextOrder }).eq('id', root.id) }
        catch (e) { console.error('reorder failed:', e) }
      }
      nextOrder++
      // Bump children to be after the parent
      const kids = orderedLines.filter(l => l.parent_line_id === root.id)
      for (const k of kids) {
        if ((k.line_order || 0) !== nextOrder) {
          try { await supabase.from('quote_lines').update({ line_order: nextOrder }).eq('id', k.id) }
          catch (e) { console.error('reorder child failed:', e) }
        }
        nextOrder++
      }
    }
    await onChanged()
  }

  async function addFavorite(productId) {
    const maxOrder = favorites.reduce((m, f) => Math.max(m, f.sort_order || 0), -1)
    try {
      await supabase.from('product_favorites').insert({ user_id: profileId, product_id: productId, sort_order: maxOrder + 1 })
      await refreshFavorites()
    } catch (e) { console.warn('addFavorite skipped:', e?.message) }
  }
  async function removeFavorite(favId) {
    try {
      await supabase.from('product_favorites').delete().eq('id', favId)
      await refreshFavorites()
    } catch (e) { console.error('removeFavorite failed:', e) }
  }

  return (
    <Card title="Subscription">
      {/* Favorites bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.borderLight}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Favorites</span>
        {favorites.length === 0 ? (
          <span style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>
            Click the ☆ on any product in the picker to add it here for one-click adding.
          </span>
        ) : (
          favorites.map(f => {
            const p = productMap[f.product_id]
            if (!p) return null
            return <FavoriteChip key={f.id} product={p} onAdd={() => addProductLines([p.id])} onRemove={() => removeFavorite(f.id)} />
          })
        )}
        <div style={{ flex: 1 }} />
        {favorites.length > 0 && (
          <Button onClick={() => setShowFavManager(true)} style={{ padding: '4px 10px', fontSize: 11 }}>Manage</Button>
        )}
        <Button primary onClick={() => setPickerOpen(true)} style={{ padding: '5px 12px', fontSize: 11 }}>+ Add Product</Button>
      </div>

      {/* Global discount */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Global Discount %</span>
          <input
            type="number" min="0" max="100" step="0.5"
            defaultValue={globalDiscountUiPct}
            onBlur={e => {
              const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100
              if (Math.abs(v - (Number(quote.global_discount_pct) || 0)) > 0.0001) {
                saveQuoteHeader({ global_discount_pct: v }).then(onChanged)
              }
            }}
            style={{ ...inputStyle, fontSize: 12, padding: '4px 6px', width: 70, textAlign: 'right' }}
          />
        </label>
      </div>

      {orderedLines.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
          No subscription lines yet. Click <strong>+ Add Product</strong> above to start.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <th style={thStyle} title="Drag to reorder"></th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Name</th>
              <ColTH label="Qty" colKey="qty" visible={colVis.qty} onToggle={() => toggleColVis('qty')} align="right" />
              <ColTH label="List" colKey="list" visible={colVis.list} onToggle={() => toggleColVis('list')} align="right" />
              <ColTH label="Disc %" colKey="discount" visible={colVis.discount} onToggle={() => toggleColVis('discount')} align="right" />
              <th style={{ ...thStyle, textAlign: 'center' }}>Excl. Global</th>
              <ColTH label="Price" colKey="price" visible={colVis.price} onToggle={() => toggleColVis('price')} align="right" />
              <th style={{ ...thStyle, textAlign: 'center', whiteSpace: 'nowrap' }} title="Show row in customer DealRoom view">Deal Room</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {orderedLines.map(line => {
              const product = productMap[line.product_id]
              const preview = previews[line.id] || {}
              const isChild = !!line.parent_line_id
              const isDraggingThis = draggingId === line.id
              const isDropTarget = dragOverId === line.id && draggingId && draggingId !== line.id

              return (
                <SubscriptionLineRow
                  key={line.id}
                  line={line}
                  product={product}
                  preview={preview}
                  isChild={isChild}
                  isDraggingThis={isDraggingThis}
                  isDropTarget={isDropTarget}
                  globalDiscount={Number(quote.global_discount_pct) || 0}
                  onDragStart={() => setDraggingId(line.id)}
                  onDragOver={(id) => setDragOverId(id)}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
                  onDrop={async () => {
                    const dragged = draggingId
                    setDraggingId(null); setDragOverId(null)
                    if (dragged && dragged !== line.id) await reorderLines(dragged, line.id)
                  }}
                  onScheduleUpdate={(field, value) => {
                    setPreviewField(line.id, field, value)
                    scheduleLineUpdate(line.id, { [field]: value })
                  }}
                  onPersistImmediate={async (patch) => { await persistLine(line.id, patch); await onChanged() }}
                  onDelete={() => deleteLine(line.id)}
                />
              )
            })}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 14, padding: '12px 16px', background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <FooterCell label="List subtotal" value={dollars(listSubtotal)} />
        <FooterCell label="Discount" value={discountTotal > 0 ? `−${dollars(discountTotal)}` : '—'} color={discountTotal > 0 ? T.success : T.textMuted} />
        <FooterCell label="Percent surcharges" value={percentTotal !== 0 ? `${percentTotal > 0 ? '+' : ''}${dollars(percentTotal)}` : '—'} />
        <FooterCell label="Sage Subscription" value={dollars(sageSubscriptionTotal)} bold color={T.primary} />
      </div>

      {pickerOpen && (
        <ProductPicker
          products={products}
          favorites={favorites}
          onClose={() => setPickerOpen(false)}
          onAddFavorite={addFavorite}
          onRemoveFavorite={async (productId) => {
            const f = favorites.find(x => x.product_id === productId)
            if (f) await removeFavorite(f.id)
          }}
          onAddSelected={async (productIds) => {
            await addProductLines(productIds)
            setPickerOpen(false)
          }}
        />
      )}

      {showFavManager && (
        <FavoritesManager
          favorites={favorites}
          productMap={productMap}
          onClose={() => setShowFavManager(false)}
          onRemove={removeFavorite}
        />
      )}
    </Card>
  )
}

// Column header with a small "show in deal room" checkbox below the label
function ColTH({ label, colKey, visible, onToggle, align = 'left' }) {
  return (
    <th style={{ ...thStyle, textAlign: align, padding: '6px 10px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start', gap: 2 }}>
        <span>{label}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 500, color: visible ? T.success : T.textMuted, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }} title="Show this column in the customer DealRoom view">
          <input type="checkbox" checked={visible} onChange={onToggle} style={{ margin: 0, width: 11, height: 11 }} />
          DR
        </label>
      </div>
    </th>
  )
}

function SubscriptionLineRow({ line, product, preview, isChild, isDraggingThis, isDropTarget, globalDiscount, onDragStart, onDragOver, onDragEnd, onDrop, onScheduleUpdate, onPersistImmediate, onDelete }) {
  const isPercent = product?.pricing_method === 'percent_of_total'
  const nonDiscountable = !!product?.non_discountable
  const qtyEditable = product?.quantity_editable !== false && !isChild
  const maxRepDisc = product?.max_rep_discount_pct != null ? Number(product.max_rep_discount_pct) * 100 : null

  // Live price preview — flat lines compute client-side; percent lines show server's value.
  const livePrice = (() => {
    if (isChild) return 0
    if (isPercent) return Number(line.extended) || 0
    const qty = preview.quantity != null ? Number(preview.quantity) : Number(line.quantity)
    const unit = preview.unit_price != null ? Number(preview.unit_price) : Number(line.unit_price)
    const lineDisc = preview.discount_pct != null ? Number(preview.discount_pct) : Number(line.discount_pct)
    const explicitOverride = (line.apply_global_discount === false) || (line.apply_global_discount == null && product?.excluded_from_global_discount)
    const effectiveDisc = lineDisc > 0 || explicitOverride ? lineDisc : globalDiscount
    return qty * unit * (1 - effectiveDisc)
  })()

  const draggable = !isChild

  return (
    <tr
      draggable={draggable}
      onDragStart={(e) => { if (!draggable) return; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', line.id) } catch {} ; onDragStart() }}
      onDragOver={(e) => { if (!draggable) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(line.id) }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => { if (!draggable) return; e.preventDefault(); onDrop() }}
      onDragEnd={onDragEnd}
      style={{
        borderBottom: `1px solid ${T.borderLight}`,
        background: isDraggingThis ? T.warningLight : isDropTarget ? T.primaryLight : (isChild ? '#f9f9f9' : 'transparent'),
        cursor: isDraggingThis ? 'grabbing' : 'default',
        opacity: isDraggingThis ? 0.5 : 1,
      }}
    >
      <td style={{ padding: '6px 4px', color: T.textMuted, fontSize: 14, cursor: isChild ? 'default' : 'grab', userSelect: 'none', textAlign: 'center', width: 22 }}>{isChild ? '' : '⋮⋮'}</td>
      <td style={{ padding: '6px 10px', fontFamily: T.mono, fontSize: 11, color: T.textSecondary, whiteSpace: 'nowrap' }}>{product?.sku || '—'}</td>
      <td style={{ padding: '6px 10px', color: T.text, fontWeight: isChild ? 400 : 600 }}>
        <span style={{ paddingLeft: isChild ? 16 : 0, color: isChild ? T.textSecondary : T.text }}>
          {isChild && '↳ '}{product?.name || 'Unknown'}
        </span>
        {!isChild && product?.is_bundle && <Badge color={T.sageGreen} style={{ marginLeft: 6 }}>Bundle</Badge>}
        {!isChild && isPercent && <Badge color={T.warning} style={{ marginLeft: 6 }}>%</Badge>}
        {isChild && <Badge color={T.textMuted} style={{ marginLeft: 6 }}>Included</Badge>}
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        {qtyEditable ? (
          <input
            type="number" min="0" step="1"
            value={preview.quantity != null ? preview.quantity : line.quantity}
            onChange={e => { const v = Number(e.target.value); if (v < 0) return; onScheduleUpdate('quantity', v) }}
            style={{ ...inputStyle, fontSize: 12, padding: '4px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"', width: 60 }}
          />
        ) : (
          <span style={{ fontFeatureSettings: '"tnum"', color: T.textMuted }}>{line.quantity}</span>
        )}
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.textMuted }}>
        {isChild ? '—' : isPercent ? `${(Number(product.percentage_value) || 0) * 100}%` : dollars(product?.list_price || 0)}
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        {(!isChild && !nonDiscountable) ? (
          <DiscountInput line={line} preview={preview} maxRepDisc={maxRepDisc}
            onChange={(decimal) => onScheduleUpdate('discount_pct', decimal)} />
        ) : (
          <span title={nonDiscountable ? 'Non-discountable per price book' : ''} style={{ color: T.textMuted }}>—</span>
        )}
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
        {!isChild ? (
          <ExcludeGlobalCheckbox line={line} product={product} onChange={async (excluded) => {
            const next = excluded ? false : null
            await onPersistImmediate({ apply_global_discount: next })
          }} />
        ) : null}
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 600 }}>
        {isChild ? <span style={{ color: T.textMuted }}>$0</span> : dollars(livePrice)}
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
        {!isChild && (
          <input
            type="checkbox"
            checked={line.show_in_deal_room !== false}
            onChange={e => onPersistImmediate({ show_in_deal_room: e.target.checked })}
            title="Show this line in the customer DealRoom view"
          />
        )}
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
        {!isChild && (
          <button onClick={onDelete} title="Delete line" style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
        )}
      </td>
    </tr>
  )
}

function DiscountInput({ line, preview, maxRepDisc, onChange }) {
  const decimal = preview.discount_pct != null ? Number(preview.discount_pct) : Number(line.discount_pct)
  const display = Math.round(decimal * 10000) / 100
  const overCap = maxRepDisc != null && display > maxRepDisc + 0.0001
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <input
        type="number" min="0" max="100" step="0.5"
        value={display}
        onChange={e => {
          const v = Math.max(0, Math.min(100, Number(e.target.value) || 0))
          onChange(v / 100)
        }}
        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"', width: 70, borderColor: overCap ? T.error : T.border }}
        title={maxRepDisc != null ? `Max for rep: ${maxRepDisc}%` : ''}
      />
      {overCap && <span style={{ fontSize: 9, color: T.error, fontWeight: 600, marginTop: 2 }}>Over {maxRepDisc}% cap</span>}
    </div>
  )
}

function ExcludeGlobalCheckbox({ line, product, onChange }) {
  const effectivelyExcluded = line.apply_global_discount === false
    || (line.apply_global_discount == null && !!product?.excluded_from_global_discount)
  return (
    <input type="checkbox" checked={effectivelyExcluded} onChange={e => onChange(e.target.checked)} title="Exclude this line from the global discount" />
  )
}

const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }

function FooterCell({ label, value, bold, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: bold ? 18 : 14, fontWeight: bold ? 800 : 600, color: color || T.text, fontFeatureSettings: '"tnum"' }}>{value}</div>
    </div>
  )
}

function FavoriteChip({ product, onAdd, onRemove }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title={`${product.name} · ${dollars(product.list_price)}${product.is_bundle ? ' · Bundle' : ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: T.primaryLight, color: T.primary, fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '3px 4px 3px 10px', border: `1px solid ${T.primaryBorder}` }}
    >
      <span style={{ cursor: 'pointer' }} onClick={onAdd}>{product.sku}</span>
      {product.is_bundle && <Badge color={T.sageGreen}>BNDL</Badge>}
      <button onClick={onRemove} title="Remove from favorites"
        style={{ background: hover ? T.error : 'transparent', color: hover ? '#fff' : T.primary, border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
      >×</button>
    </div>
  )
}

function FavoritesManager({ favorites, productMap, onClose, onRemove }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 8, width: '100%', maxWidth: 520, maxHeight: '80vh', overflow: 'auto', boxShadow: T.shadowMd }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text, flex: 1 }}>Manage Favorites</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: T.textMuted, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: 18 }}>
          {favorites.length === 0 ? (
            <div style={{ color: T.textMuted, fontSize: 13 }}>No favorites yet.</div>
          ) : favorites.map(f => {
            const p = productMap[f.product_id]
            if (!p) return null
            return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.borderLight}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>{p.sku}</div>
                </div>
                <Button danger onClick={() => onRemove(f.id)} style={{ padding: '4px 10px', fontSize: 11 }}>Remove</Button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// Product picker — per-SKU description expander
// ──────────────────────────────────────────────────────────
function ProductPicker({ products, favorites, onClose, onAddSelected, onAddFavorite, onRemoveFavorite }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [hideImpl, setHideImpl] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [productType, setProductType] = useState('')
  const [expandedDesc, setExpandedDesc] = useState(new Set())  // product ids with description shown

  const favoriteSet = useMemo(() => new Set(favorites.map(f => f.product_id)), [favorites])
  const productTypes = useMemo(() => Array.from(new Set(products.map(p => p.product_type).filter(Boolean))).sort(), [products])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return products.filter(p => {
      if (hideImpl && p.is_implementation) return false
      if (filter === 'bundles' && !p.is_bundle) return false
      if (filter === 'subs' && p.is_bundle) return false
      if (productType && p.product_type !== productType) return false
      if (!q) return true
      return (p.name || '').toLowerCase().includes(q)
        || (p.sku || '').toLowerCase().includes(q)
        || (p.description || '').toLowerCase().includes(q)
        || (p.product_type || '').toLowerCase().includes(q)
    })
  }, [products, search, filter, hideImpl, productType])

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleDesc(id) {
    setExpandedDesc(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 8, width: '100%', maxWidth: 800, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: T.shadowMd }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text, flex: 1 }}>Add Products</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: T.textMuted, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: '10px 18px', borderBottom: `1px solid ${T.borderLight}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Search by name, SKU, description, or type…"
            value={search} onChange={e => setSearch(e.target.value)} autoFocus
            style={{ ...inputStyle, fontSize: 13, padding: '6px 10px', flex: 1, minWidth: 220 }}
          />
          {[
            { k: 'all', l: 'All' },
            { k: 'subs', l: 'Subscriptions' },
            { k: 'bundles', l: 'Bundles' },
          ].map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${filter === f.k ? T.primary : T.border}`, borderRadius: 4, cursor: 'pointer', background: filter === f.k ? T.primary : T.surface, color: filter === f.k ? '#fff' : T.text, fontFamily: T.font }}>{f.l}</button>
          ))}
          <label style={{ fontSize: 11, color: T.text, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={hideImpl} onChange={e => setHideImpl(e.target.checked)} />
            Hide implementation
          </label>
          <select value={productType} onChange={e => setProductType(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: '4px 6px', maxWidth: 180, cursor: 'pointer' }}>
            <option value="">All types</option>
            {productTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>No products match.</div>
          ) : (
            filtered.map(p => {
              const isFav = favoriteSet.has(p.id)
              const isSelected = selected.has(p.id)
              const isDescOpen = expandedDesc.has(p.id)
              return (
                <div key={p.id} style={{ borderBottom: `1px solid ${T.borderLight}`, background: isSelected ? T.primaryLight : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px' }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(p.id)} />
                    <button
                      onClick={() => toggleDesc(p.id)}
                      title={p.description ? (isDescOpen ? 'Hide description' : 'Show description') : 'No description'}
                      disabled={!p.description}
                      style={{ background: 'none', border: 'none', cursor: p.description ? 'pointer' : 'default', color: p.description ? T.textSecondary : T.borderLight, fontSize: 12, padding: '0 4px', width: 18 }}
                    >{isDescOpen ? '▾' : '▸'}</button>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>{p.sku}</span>
                      <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{p.name}</span>
                      {p.is_bundle && <Badge color={T.sageGreen}>Bundle</Badge>}
                      {p.pricing_method === 'percent_of_total' && <Badge color={T.warning}>%</Badge>}
                      {p.non_discountable && <Badge color={T.error}>Non-disc</Badge>}
                      {p.product_type && <span style={{ fontSize: 10, color: T.textSecondary, fontStyle: 'italic' }}>· {p.product_type}</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFeatureSettings: '"tnum"', minWidth: 80, textAlign: 'right' }}>
                      {p.pricing_method === 'percent_of_total' ? `${(Number(p.percentage_value) || 0) * 100}%` : dollars(p.list_price)}
                    </div>
                    <button
                      onClick={() => isFav ? onRemoveFavorite(p.id) : onAddFavorite(p.id)}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: isFav ? T.warning : T.textMuted, fontSize: 18, padding: 0, lineHeight: 1 }}
                    >{isFav ? '★' : '☆'}</button>
                  </div>
                  {isDescOpen && p.description && (
                    <div style={{ padding: '4px 50px 10px 50px', fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>{p.description}</div>
                  )}
                </div>
              )
            })
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: T.textSecondary }}>{selected.size} selected</span>
          <div style={{ flex: 1 }} />
          <Button onClick={onClose} style={{ padding: '6px 14px' }}>Cancel</Button>
          <Button primary disabled={selected.size === 0} onClick={() => onAddSelected(Array.from(selected))} style={{ padding: '6px 14px' }}>Add {selected.size > 0 ? `(${selected.size})` : ''}</Button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// IMPLEMENTATION SECTION
// ──────────────────────────────────────────────────────────
function ImplementationSection({ quote, quoteId, implItems, implementorDefault, source, saveQuoteHeader, onChanged, partnerNames = [] }) {
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const sectionKey = source === 'sage' ? 'implementation' : 'partner_implementation'
  const sectionVisible = drGet(quote, `sections.${sectionKey}`, true)
  async function toggleSection() {
    await saveQuoteHeader(drSetPatch(quote, `sections.${sectionKey}`, !sectionVisible))
  }

  function newItem() {
    setEditing({
      quote_id: quoteId, source, implementor_name: implementorDefault || '',
      name: '', description: '', total_amount: 0, billing_type: 'one_time',
      tm_weeks: null, estimated_start_date: '', estimated_completion_date: '',
      sort_order: implItems.length, notes: '',
    })
  }

  async function save(item) {
    setBusy(true)
    try {
      const payload = {
        quote_id: quoteId, source: item.source || source,
        implementor_name: item.implementor_name || implementorDefault || 'Sage',
        name: item.name || 'Implementation',
        description: item.description || null,
        total_amount: Number(item.total_amount) || 0,
        billing_type: item.billing_type,
        tm_weeks: item.billing_type === 'tm_monthly' ? (Number(item.tm_weeks) || 4) : null,
        estimated_start_date: item.estimated_start_date || null,
        estimated_completion_date: item.estimated_completion_date || null,
        sort_order: Number(item.sort_order) || 0,
        notes: item.notes || null,
      }
      if (item.id) await supabase.from('quote_implementation_items').update(payload).eq('id', item.id)
      else await supabase.from('quote_implementation_items').insert(payload)
      setEditing(null)
      await onChanged()
    } catch (e) { console.error(e); alert(e?.message || 'Save failed') }
    finally { setBusy(false) }
  }

  async function del(id) {
    if (!confirm('Delete this implementation item?')) return
    setBusy(true)
    try { await supabase.from('quote_implementation_items').delete().eq('id', id); await onChanged() }
    catch (e) { console.error(e) }
    setBusy(false)
  }

  const total = implItems.reduce((s, i) => s + (Number(i.total_amount) || 0), 0)
  const title = source === 'sage' ? 'Implementation' : 'Partner Implementation'

  return (
    <Card title={title} action={
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <DealRoomToggle visible={sectionVisible} onToggle={toggleSection} />
        <Button primary onClick={newItem} style={{ padding: '4px 10px', fontSize: 11 }}>+ Add Implementation</Button>
      </div>
    }>
      {implItems.length === 0 ? (
        <div style={{ padding: '12px', textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
          Add fixed bid, T&amp;M, one-time, or custom milestone items here.
        </div>
      ) : implItems.map(item => (
        <div key={item.id} style={{ marginBottom: 8, padding: 10, background: T.surfaceAlt, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
              {item.name}
              <Badge color={T.primary} style={{ marginLeft: 6 }}>{BILLING_TYPE_LABELS[item.billing_type]}</Badge>
              {item.implementor_name && item.implementor_name !== (implementorDefault || 'Sage') && (
                <Badge color={T.sageGreen} style={{ marginLeft: 6 }}>{item.implementor_name}</Badge>
              )}
            </div>
            {item.description && <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 4 }}>{item.description}</div>}
            <div style={{ fontSize: 11, color: T.textMuted }}>
              {item.billing_type === 'tm_monthly' && item.tm_weeks && (
                <span>{item.tm_weeks} weeks → {Math.ceil(item.tm_weeks / 4)} monthly invoices of {dollars(Number(item.total_amount) / Math.ceil(item.tm_weeks / 4))} each</span>
              )}
              {item.billing_type === 'fixed_bid_50_50' && <span>50% start / 50% complete · {item.estimated_start_date || 'TBD'} → {item.estimated_completion_date || 'TBD'}</span>}
              {item.billing_type === 'one_time' && <span>One-time · {item.estimated_start_date || 'TBD'}</span>}
              {item.billing_type === 'milestone_custom' && <span>Custom milestone schedule (author manually on Schedule tab)</span>}
            </div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text, fontFeatureSettings: '"tnum"', minWidth: 100, textAlign: 'right' }}>
            {dollars(item.total_amount)}
          </div>
          <Button onClick={() => setEditing({ ...item })} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
          <Button danger disabled={busy} onClick={() => del(item.id)} style={{ padding: '4px 10px', fontSize: 11 }}>Delete</Button>
        </div>
      ))}
      {implItems.length > 0 && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>{source === 'sage' ? 'Implementation Total' : 'Partner Implementation Total'}</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: T.primary, fontFeatureSettings: '"tnum"' }}>{dollars(total)}</span>
        </div>
      )}

      {editing && <ImplementationEditor item={editing} source={source} partnerNames={partnerNames} onClose={() => setEditing(null)} onSave={save} />}
    </Card>
  )
}

function DealRoomToggle({ visible, onToggle, label = 'Show in deal room' }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: visible ? T.success : T.textMuted, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }} title={label}>
      <input type="checkbox" checked={visible} onChange={onToggle} style={{ margin: 0 }} />
      {label}
    </label>
  )
}

function ImplementationEditor({ item, source, partnerNames, onClose, onSave }) {
  const [draft, setDraft] = useState(item)
  function setF(k, v) { setDraft(prev => ({ ...prev, [k]: v })) }
  const tmInvoices = draft.billing_type === 'tm_monthly' && draft.tm_weeks ? Math.ceil(Number(draft.tm_weeks) / 4) : 0
  const tmPerInvoice = tmInvoices > 0 ? Number(draft.total_amount || 0) / tmInvoices : 0

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 8, width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', boxShadow: T.shadowMd }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text, flex: 1 }}>{item.id ? 'Edit Implementation' : 'Add Implementation'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: T.textMuted, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Implementor name *</label>
              {source === 'partner' && partnerNames.length > 0 ? (
                <input list="partner-names-impl" style={inputStyle} value={draft.implementor_name || ''} onChange={e => setF('implementor_name', e.target.value)} />
              ) : (
                <input style={inputStyle} value={draft.implementor_name || ''} onChange={e => setF('implementor_name', e.target.value)} />
              )}
              {source === 'partner' && (
                <datalist id="partner-names-impl">{partnerNames.map(n => <option key={n} value={n} />)}</datalist>
              )}
            </div>
            <div>
              <label style={labelStyle}>Total amount *</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 13 }}>$</span>
                <input type="number" min="0" step="0.01" style={{ ...inputStyle, paddingLeft: 18 }} value={draft.total_amount} onChange={e => setF('total_amount', Number(e.target.value) || 0)} />
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Item name *</label>
            <input style={inputStyle} value={draft.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. Onboarding & data migration" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={draft.description || ''} onChange={e => setF('description', e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Billing type *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {Object.entries(BILLING_TYPE_LABELS).map(([k, label]) => (
                <label key={k} style={{ padding: '8px 10px', border: `1px solid ${draft.billing_type === k ? T.primary : T.border}`, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, background: draft.billing_type === k ? T.primaryLight : T.surface }}>
                  <input type="radio" name="billing_type" checked={draft.billing_type === k} onChange={() => setF('billing_type', k)} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{label}</span>
                </label>
              ))}
            </div>
          </div>
          {draft.billing_type === 'tm_monthly' && (
            <div style={{ marginBottom: 12, padding: 10, background: T.primaryLight, borderRadius: 4 }}>
              <label style={labelStyle}>Number of weeks *</label>
              <input type="number" min="1" step="1" style={inputStyle} value={draft.tm_weeks || ''} onChange={e => setF('tm_weeks', Number(e.target.value) || null)} />
              {tmInvoices > 0 && <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 4 }}>{draft.tm_weeks} weeks → {tmInvoices} monthly invoices of {dollars(tmPerInvoice)} each, billed in arrears</div>}
            </div>
          )}
          {(draft.billing_type === 'fixed_bid_50_50' || draft.billing_type === 'one_time') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Estimated start date</label>
                <input type="date" style={inputStyle} value={draft.estimated_start_date || ''} onChange={e => setF('estimated_start_date', e.target.value)} />
              </div>
              {draft.billing_type === 'fixed_bid_50_50' && (
                <div>
                  <label style={labelStyle}>Estimated completion date</label>
                  <input type="date" style={inputStyle} value={draft.estimated_completion_date || ''} onChange={e => setF('estimated_completion_date', e.target.value)} />
                </div>
              )}
            </div>
          )}
          {draft.billing_type === 'milestone_custom' && (
            <div style={{ marginBottom: 12, padding: 10, background: T.warningLight, borderRadius: 4, fontSize: 11, color: T.warning, fontWeight: 600 }}>
              No payment schedule rows will be auto-generated. Add custom rows directly on the Schedule tab.
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Notes</label>
            <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} value={draft.notes || ''} onChange={e => setF('notes', e.target.value)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button primary disabled={!draft.name || (draft.billing_type === 'tm_monthly' && !draft.tm_weeks)} onClick={() => onSave(draft)}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// TERMS SECTION — 1/3/5 year, linked signing bonus
// ──────────────────────────────────────────────────────────
function TermsSection({ quote, contractTerms, saveQuoteHeader, onChanged }) {
  const [termFilter, setTermFilter] = useState(() => {
    const t = contractTerms.find(ct => ct.id === quote.contract_term_id)
    return t?.term_years || 3
  })
  const filteredTerms = useMemo(() => contractTerms.filter(ct => ct.term_years === termFilter), [contractTerms, termFilter])
  const selectedTerm = contractTerms.find(ct => ct.id === quote.contract_term_id)

  const sectionVisible = drGet(quote, 'sections.terms', true)
  const promoVisible = drGet(quote, 'sections.promo', true)

  async function save(patch) { await saveQuoteHeader(patch); await onChanged() }

  const startDate = quote.contract_start_date ? new Date(quote.contract_start_date + 'T00:00:00') : null
  const previewLines = useMemo(() => {
    if (!startDate) return []
    const fm = Number(quote.free_months) || 0
    if (fm === 0) return []
    const placement = quote.free_months_placement || 'back'
    const out = []
    if (placement === 'back') {
      const y1End = new Date(startDate); y1End.setMonth(y1End.getMonth() + 12 + fm)
      out.push(`Year 1 spans ${12 + fm} months (start ${startDate.toISOString().slice(0, 10)}, ends ${y1End.toISOString().slice(0, 10)})`)
    } else {
      const firstInvoice = new Date(startDate); firstInvoice.setMonth(firstInvoice.getMonth() + fm)
      out.push(`First Y1 invoice deferred ${fm} months → ${firstInvoice.toISOString().slice(0, 10)}`)
    }
    return out
  }, [startDate, quote.free_months, quote.free_months_placement])

  // Signing bonus — linked. The DB has: exactly one of {signing_bonus_amount, signing_bonus_months} non-zero.
  // UI strategy: show both fields. The non-source field displays the computed equivalent.
  // When user edits one field, save it; zero the other.
  const sageMonthly = (Number(quote.sage_subscription_total) || 0) / 12
  const dbAmount = Number(quote.signing_bonus_amount) || 0
  const dbMonths = Number(quote.signing_bonus_months) || 0
  // The "active" field is whichever is non-zero. The other shows computed equivalent.
  const activeField = dbAmount > 0 ? 'amount' : (dbMonths > 0 ? 'months' : null)

  const displayAmount = activeField === 'amount' ? dbAmount : (activeField === 'months' ? sageMonthly * dbMonths : 0)
  const displayMonths = activeField === 'months' ? dbMonths : (activeField === 'amount' && sageMonthly > 0 ? dbAmount / sageMonthly : 0)

  return (
    <Card title="Terms & Promo" action={<DealRoomToggle visible={sectionVisible} onToggle={() => save(drSetPatch(quote, 'sections.terms', !sectionVisible))} />}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Contract</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[1, 3, 5].map(yr => (
              <button key={yr} onClick={() => setTermFilter(yr)} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, border: `1px solid ${termFilter === yr ? T.primary : T.border}`, borderRadius: 4, background: termFilter === yr ? T.primary : T.surface, color: termFilter === yr ? '#fff' : T.text, cursor: 'pointer', fontFamily: T.font }}>{yr}-year</button>
            ))}
          </div>

          {termFilter === 1 ? (
            <>
              <select
                style={{ ...inputStyle, cursor: 'pointer', marginBottom: 8 }}
                value={selectedTerm && selectedTerm.term_years === 1 ? selectedTerm.id : ''}
                onChange={async e => { await save({ contract_term_id: e.target.value || null }) }}
              >
                <option value="">— Pick a term —</option>
                {filteredTerms.map(ct => <option key={ct.id} value={ct.id}>{ct.name}{ct.is_default ? ' (default)' : ''}</option>)}
              </select>
              <div style={{ marginBottom: 10, padding: 8, background: T.surfaceAlt, borderRadius: 4, fontSize: 11, color: T.textSecondary }}>
                1-year contract — no Year-2 escalation because there is no Year 2.
              </div>
            </>
          ) : (
            <>
              <label style={labelStyle}>Term template</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer', marginBottom: 10 }}
                value={selectedTerm && selectedTerm.term_years === termFilter ? selectedTerm.id : ''}
                onChange={async e => { await save({ contract_term_id: e.target.value || null }) }}
              >
                <option value="">— Pick a term —</option>
                {filteredTerms.map(ct => <option key={ct.id} value={ct.id}>{ct.name}{ct.is_default ? ' (default)' : ''}</option>)}
              </select>
              {selectedTerm && (
                <>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                    {selectedTerm.yoy_caps.map((c, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 600, color: T.text }}>
                        Y{i + 1}: {Number(c) === 0 ? 'locked' : `${Number(c)}%`}
                      </span>
                    ))}
                  </div>
                  {selectedTerm.description && <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 10 }}>{selectedTerm.description}</div>}
                </>
              )}
            </>
          )}

          <label style={labelStyle}>Contract start date</label>
          <input type="date" style={{ ...inputStyle, marginBottom: 10 }} value={quote.contract_start_date || ''} onChange={e => save({ contract_start_date: e.target.value || null })} />

          <label style={labelStyle}>Billing cadence</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {['annual', 'quarterly'].map(c => (
              <label key={c} style={{ padding: '6px 12px', border: `1px solid ${quote.billing_cadence === c ? T.primary : T.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: quote.billing_cadence === c ? T.primary : T.text, background: quote.billing_cadence === c ? T.primaryLight : T.surface }}>
                <input type="radio" name="cadence" checked={quote.billing_cadence === c} onChange={() => save({ billing_cadence: c })} style={{ display: 'none' }} />
                {c}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Promo &amp; Incentives</span>
            <DealRoomToggle visible={promoVisible} onToggle={() => save(drSetPatch(quote, 'sections.promo', !promoVisible))} />
          </div>
          <label style={labelStyle}>Free months (0–12)</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            <input type="number" min="0" max="12" step="1" style={{ ...inputStyle, width: 80, flex: '0 0 80px' }} defaultValue={quote.free_months}
              onBlur={e => {
                const v = Math.max(0, Math.min(12, Number(e.target.value) || 0))
                if (v !== quote.free_months) save({ free_months: v })
              }} />
            {['front', 'back'].map(k => (
              <label key={k} style={{ padding: '6px 12px', border: `1px solid ${quote.free_months_placement === k ? T.primary : T.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: quote.free_months_placement === k ? T.primary : T.text, background: quote.free_months_placement === k ? T.primaryLight : T.surface, flex: 1, textAlign: 'center', textTransform: 'capitalize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input type="radio" name="placement" checked={quote.free_months_placement === k} onChange={() => save({ free_months_placement: k })} style={{ display: 'none' }} />
                {k}
              </label>
            ))}
          </div>
          {previewLines.length > 0 && (
            <div style={{ marginTop: 8, padding: 8, background: T.primaryLight, borderRadius: 4, fontSize: 11, color: T.textSecondary, lineHeight: 1.5 }}>
              {previewLines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}

          <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${T.borderLight}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 6 }}>Signing bonus</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={labelStyle}>Lump sum</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 12 }}>$</span>
                  <input
                    type="number" min="0" step="100"
                    style={{ ...inputStyle, paddingLeft: 18, color: activeField === 'amount' ? T.text : T.textSecondary, fontStyle: activeField === 'amount' ? 'normal' : 'italic' }}
                    value={Math.round(displayAmount * 100) / 100}
                    onChange={e => {
                      // Type in lump sum: switch source, zero months
                      const v = Math.max(0, Number(e.target.value) || 0)
                      save({ signing_bonus_amount: v, signing_bonus_months: 0 })
                    }}
                  />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Months of subscription</label>
                <input
                  type="number" min="0" step="0.5"
                  style={{ ...inputStyle, color: activeField === 'months' ? T.text : T.textSecondary, fontStyle: activeField === 'months' ? 'normal' : 'italic' }}
                  value={Math.round(displayMonths * 100) / 100}
                  onChange={e => {
                    const v = Math.max(0, Number(e.target.value) || 0)
                    save({ signing_bonus_months: v, signing_bonus_amount: 0 })
                  }}
                />
              </div>
            </div>
            {(displayAmount > 0 || displayMonths > 0) && (
              <div style={{ marginTop: 8, padding: 8, background: T.successLight, borderRadius: 4, fontSize: 11, color: T.success, fontWeight: 600 }}>
                {dollars(displayAmount)} off Year 1 ({Math.round(displayMonths * 100) / 100} months × {dollars(sageMonthly)}/mo)
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────
// PARTNERS TAB
// ──────────────────────────────────────────────────────────
function PartnersTab({ quote, quoteId, partnerBlocks, partnerLines, implItems, saveQuoteHeader, onPartnerSubChanged, onImplChanged }) {
  const partnerNames = useMemo(() => Array.from(new Set(partnerBlocks.map(b => b.partner_name).filter(Boolean))), [partnerBlocks])
  const sectionVisible = drGet(quote, 'sections.partners', true)

  async function addBlock() {
    const maxOrder = partnerBlocks.reduce((m, b) => Math.max(m, b.sort_order || 0), -1)
    try {
      await supabase.from('quote_partner_blocks').insert({
        quote_id: quoteId, partner_name: 'New Partner', term_years: 3, billing_cadence: 'annual', partner_global_discount_pct: 0, sort_order: maxOrder + 1,
      })
      await onPartnerSubChanged()
    } catch (e) { alert(e?.message) }
  }
  async function updateBlock(id, patch) { try { await supabase.from('quote_partner_blocks').update(patch).eq('id', id); await onPartnerSubChanged() } catch (e) { console.error(e) } }
  async function deleteBlock(id) {
    if (!confirm('Delete this partner block (and its lines)?')) return
    try { await supabase.from('quote_partner_blocks').delete().eq('id', id); await onPartnerSubChanged() } catch (e) { console.error(e) }
  }
  async function addLine(blockId) {
    const blockLines = partnerLines.filter(l => l.block_id === blockId)
    const maxOrder = blockLines.reduce((m, l) => Math.max(m, l.sort_order || 0), -1)
    try {
      await supabase.from('quote_partner_lines').insert({ quote_id: quoteId, block_id: blockId, name: 'Line', quantity: 1, unit_price: 0, discount_pct: 0, sort_order: maxOrder + 1 })
      await onPartnerSubChanged()
    } catch (e) { alert(e?.message) }
  }
  async function updateLine(id, patch) { try { await supabase.from('quote_partner_lines').update(patch).eq('id', id); await onPartnerSubChanged() } catch (e) { console.error(e) } }
  async function deleteLine(id) { try { await supabase.from('quote_partner_lines').delete().eq('id', id); await onPartnerSubChanged() } catch (e) { console.error(e) } }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.text }}>Partner Subscriptions</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <DealRoomToggle visible={sectionVisible} onToggle={() => saveQuoteHeader(drSetPatch(quote, 'sections.partners', !sectionVisible))} />
          <Button primary onClick={addBlock}>+ Add Partner Block</Button>
        </div>
      </div>

      {partnerBlocks.length === 0 ? (
        <EmptyState title="No partner blocks" message="Add a block per partner. Each gets its own term, cadence, and lines." />
      ) : partnerBlocks.map(block => {
        const blockVisible = drGet(quote, `partner_blocks.${block.id}`, true)
        return (
          <Card key={block.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <DealRoomToggle visible={blockVisible} onToggle={() => saveQuoteHeader(drSetPatch(quote, `partner_blocks.${block.id}`, !blockVisible))} label="Show this block in deal room" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 10, alignItems: 'end' }}>
              <div>
                <label style={labelStyle}>Partner name *</label>
                <input style={inputStyle} defaultValue={block.partner_name} onBlur={e => { if (e.target.value !== block.partner_name) updateBlock(block.id, { partner_name: e.target.value }) }} />
              </div>
              <div>
                <label style={labelStyle}>Term (years)</label>
                <input type="number" min="1" max="10" style={inputStyle} defaultValue={block.term_years} onBlur={e => updateBlock(block.id, { term_years: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
              </div>
              <div>
                <label style={labelStyle}>Cadence</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} defaultValue={block.billing_cadence} onChange={e => updateBlock(block.id, { billing_cadence: e.target.value })}>
                  {PARTNER_CADENCE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Block discount %</label>
                <input type="number" min="0" max="100" step="0.5" style={inputStyle}
                  defaultValue={Math.round((Number(block.partner_global_discount_pct) || 0) * 10000) / 100}
                  onBlur={e => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100; updateBlock(block.id, { partner_global_discount_pct: v }) }} />
              </div>
              <Button danger onClick={() => deleteBlock(block.id)} style={{ padding: '4px 10px', fontSize: 11 }}>Delete</Button>
            </div>

            <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>Lines</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ ...thStyle, width: 110 }}>SKU</th>
                  <th style={thStyle}>Name</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 70 }}>Qty</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 100 }}>Unit</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 80 }}>Disc %</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 100 }}>Price</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {partnerLines.filter(l => l.block_id === block.id).map(line => (
                  <tr key={line.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                    <td style={{ padding: '4px 6px' }}>
                      <input defaultValue={line.sku || ''} placeholder="(opt)" onBlur={e => { if ((e.target.value || '') !== (line.sku || '')) updateLine(line.id, { sku: e.target.value || null }) }}
                        style={{ ...inputStyle, fontSize: 11, padding: '4px 6px', fontFamily: T.mono }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input defaultValue={line.name} onBlur={e => { if (e.target.value !== line.name) updateLine(line.id, { name: e.target.value }) }}
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px' }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input type="number" min="0" step="1" defaultValue={line.quantity}
                        onBlur={e => { const v = Number(e.target.value); if (v !== Number(line.quantity)) updateLine(line.id, { quantity: v }) }}
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"' }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input type="number" min="0" step="0.01" defaultValue={line.unit_price}
                        onBlur={e => { const v = Number(e.target.value); if (v !== Number(line.unit_price)) updateLine(line.id, { unit_price: v }) }}
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"' }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input type="number" min="0" max="100" step="0.5"
                        defaultValue={Math.round((Number(line.discount_pct) || 0) * 10000) / 100}
                        onBlur={e => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100; if (Math.abs(v - (Number(line.discount_pct) || 0)) > 0.00001) updateLine(line.id, { discount_pct: v }) }}
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"' }} />
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 600 }}>
                      {dollars(line.extended)}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <button onClick={() => deleteLine(line.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 0 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8 }}>
              <Button onClick={() => addLine(block.id)} style={{ padding: '4px 10px', fontSize: 11 }}>+ Add Line</Button>
            </div>
          </Card>
        )
      })}

      <div style={{ marginTop: 24 }}>
        <ImplementationSection
          quote={quote}
          quoteId={quoteId}
          implItems={implItems}
          implementorDefault={partnerNames[0] || 'Partner'}
          source="partner"
          partnerNames={partnerNames}
          saveQuoteHeader={saveQuoteHeader}
          onChanged={onImplChanged}
        />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// RESOURCES TAB — customer logo + files & links library
// ──────────────────────────────────────────────────────────
const RESOURCE_TYPE_META = {
  demo:       { label: 'Demo',       color: '#a855f7', accept: 'video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm', allowFile: true,  allowUrl: true },
  link:       { label: 'Link',       color: T.primary, accept: '',                                                    allowFile: false, allowUrl: true },
  powerpoint: { label: 'PowerPoint', color: '#dc6b2f', accept: '.pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint', allowFile: true, allowUrl: true },
  document:   { label: 'Document',   color: T.sageGreen, accept: '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document', allowFile: true, allowUrl: true },
  misc:       { label: 'Other',      color: T.textMuted, accept: '',                                                  allowFile: true,  allowUrl: true },
}

function ResourcesTab({ deal, onDealUpdated }) {
  const { org } = useOrg()
  const { profile } = useAuth()
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)  // null | { ...resource } (for add/edit modal)

  useEffect(() => { if (deal?.id) load() }, [deal?.id])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data, error: e } = await supabase.from('deal_resources').select('*').eq('deal_id', deal.id).order('sort_order').order('created_at')
      if (e) throw e
      setResources(data || [])
    } catch (e) {
      console.error('[ResourcesTab] load failed:', e)
      setError(e?.message || 'Load failed')
    } finally { setLoading(false) }
  }

  function newResource() {
    setEditing({
      org_id: org?.id, deal_id: deal.id, created_by: profile?.id,
      resource_type: 'document', title: '', url: '', storage_path: '', mime_type: '', file_size: null, _file: null,
    })
  }

  async function save(draft) {
    setError('')
    try {
      const meta = RESOURCE_TYPE_META[draft.resource_type]
      if (!meta) throw new Error('Invalid resource type')
      if (!draft.title?.trim()) throw new Error('Title is required')
      if (!draft._file && !draft.url) throw new Error('Provide a URL or upload a file')

      const payload = {
        org_id: org.id, deal_id: deal.id,
        resource_type: draft.resource_type,
        title: draft.title.trim(),
        url: draft.url || null,
        storage_path: draft.storage_path || null,
        mime_type: draft.mime_type || null,
        file_size: draft.file_size || null,
        sort_order: Number(draft.sort_order) || resources.length,
        created_by: profile?.id,
      }

      // If a file is staged, upload first
      if (draft._file) {
        const file = draft._file
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
        const path = `${deal.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        // Delete old file if replacing
        if (draft.storage_path && draft.storage_path !== path) {
          try { await supabase.storage.from('deal-resources').remove([draft.storage_path]) } catch { /* non-fatal */ }
        }
        const { error: upErr } = await supabase.storage.from('deal-resources').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' })
        if (upErr) throw upErr
        const { data: { publicUrl } } = supabase.storage.from('deal-resources').getPublicUrl(path)
        payload.storage_path = path
        payload.url = publicUrl
        payload.mime_type = file.type
        payload.file_size = file.size
      }

      if (draft.id) {
        const { error: e } = await supabase.from('deal_resources').update(payload).eq('id', draft.id)
        if (e) throw e
      } else {
        const { error: e } = await supabase.from('deal_resources').insert(payload)
        if (e) throw e
      }
      setEditing(null)
      await load()
    } catch (e) {
      console.error('[ResourcesTab] save failed:', e)
      setError(e?.message || 'Save failed')
      throw e
    }
  }

  async function del(r) {
    if (!confirm(`Delete "${r.title}"?`)) return
    try {
      if (r.storage_path) {
        try { await supabase.storage.from('deal-resources').remove([r.storage_path]) } catch { /* non-fatal */ }
      }
      await supabase.from('deal_resources').delete().eq('id', r.id)
      await load()
    } catch (e) { console.error(e) }
  }

  return (
    <div>
      <Card title="Files & Links" action={<Button primary onClick={newResource} style={{ padding: '4px 10px', fontSize: 11 }}>+ Add Resource</Button>}>
        {error && (
          <div style={{ padding: '8px 10px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, marginBottom: 10, border: `1px solid ${T.error}30` }}>{error}</div>
        )}
        {loading ? (
          <div style={{ padding: 12, color: T.textMuted, fontSize: 12 }}>Loading…</div>
        ) : resources.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: T.textMuted, fontSize: 12 }}>
            No resources yet. Add demos, links, PowerPoints, documents, or anything else relevant to this deal.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {resources.map(r => (
              <ResourceCard key={r.id} resource={r} onEdit={() => setEditing({ ...r, _file: null })} onDelete={() => del(r)} />
            ))}
          </div>
        )}
      </Card>

      {editing && <ResourceEditor initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  )
}

function ResourceCard({ resource, onEdit, onDelete }) {
  const meta = RESOURCE_TYPE_META[resource.resource_type] || RESOURCE_TYPE_META.misc
  return (
    <div style={{ padding: 12, border: `1px solid ${T.border}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 6, background: T.surface, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Badge color={meta.color}>{meta.label}</Badge>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1, lineHeight: 1.3 }}>{resource.title}</div>
      </div>
      {resource.storage_path && resource.file_size != null && (
        <div style={{ fontSize: 10, color: T.textMuted }}>
          {Math.round(resource.file_size / 1024)} KB · {resource.mime_type || 'file'}
        </div>
      )}
      {!resource.storage_path && resource.url && (
        <div style={{ fontSize: 10, color: T.textMuted, wordBreak: 'break-all', fontFamily: T.mono }}>{resource.url}</div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
        {resource.url && (
          <a href={resource.url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, fontWeight: 600, color: T.primary, padding: '4px 10px', border: `1px solid ${T.border}`, borderRadius: 4, textDecoration: 'none', cursor: 'pointer', flex: 1, textAlign: 'center', background: T.surface }}>
            {resource.storage_path ? 'Download' : 'Open'}
          </a>
        )}
        <Button onClick={onEdit} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
        <Button danger onClick={onDelete} style={{ padding: '4px 10px', fontSize: 11 }}>Delete</Button>
      </div>
    </div>
  )
}

function ResourceEditor({ initial, onClose, onSave }) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')

  function setF(k, v) { setDraft(prev => ({ ...prev, [k]: v })) }

  const meta = RESOURCE_TYPE_META[draft.resource_type] || RESOURCE_TYPE_META.misc
  const hasFile = !!draft._file || !!draft.storage_path

  async function handleSave() {
    setBusy(true)
    setLocalError('')
    try { await onSave(draft) }
    catch (e) { setLocalError(e?.message || 'Save failed') }
    finally { setBusy(false) }
  }

  function pickFile(file) {
    if (!file) return
    setF('_file', file)
    if (!draft.title) setF('title', file.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 8, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: T.shadowMd }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text, flex: 1 }}>{draft.id ? 'Edit Resource' : 'Add Resource'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: T.textMuted, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: 18 }}>
          {localError && (
            <div style={{ padding: '8px 10px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, marginBottom: 10 }}>{localError}</div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Type *</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {Object.entries(RESOURCE_TYPE_META).map(([k, m]) => (
                <label key={k} style={{ padding: '8px 6px', border: `1px solid ${draft.resource_type === k ? m.color : T.border}`, borderRadius: 4, cursor: 'pointer', textAlign: 'center', background: draft.resource_type === k ? m.color + '15' : T.surface }}>
                  <input type="radio" name="resource_type" checked={draft.resource_type === k} onChange={() => setF('resource_type', k)} style={{ display: 'none' }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: draft.resource_type === k ? m.color : T.text }}>{m.label}</div>
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={draft.title} onChange={e => setF('title', e.target.value)} placeholder="What is this resource?" />
          </div>

          {meta.allowUrl && (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>{draft.resource_type === 'link' ? 'URL *' : 'External URL (optional — or upload a file below)'}</label>
              <input style={inputStyle} type="url" value={draft.url || ''}
                onChange={e => { setF('url', e.target.value); if (e.target.value) setF('_file', null) }}
                placeholder="https://…" />
            </div>
          )}

          {meta.allowFile && (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Upload file</label>
              <div style={{ padding: 14, border: `2px dashed ${T.border}`, borderRadius: 6, background: T.surfaceAlt, textAlign: 'center' }}
                onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]) }}
                onDragOver={e => e.preventDefault()}>
                {draft._file ? (
                  <div style={{ fontSize: 12, color: T.text }}>
                    <strong>{draft._file.name}</strong> · {Math.round(draft._file.size / 1024)} KB
                    <button onClick={() => setF('_file', null)} style={{ marginLeft: 10, background: 'none', border: 'none', color: T.error, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Remove</button>
                  </div>
                ) : draft.storage_path ? (
                  <div style={{ fontSize: 12, color: T.textSecondary }}>
                    Existing file uploaded · {draft.mime_type || ''}
                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>Pick a new file to replace it.</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: T.textMuted }}>Drop a file here, or click to pick</div>
                )}
                <input type="file" accept={meta.accept || ''} onChange={e => pickFile(e.target.files?.[0])}
                  style={{ display: 'block', margin: '8px auto 0' }} />
                {meta.accept && <div style={{ fontSize: 9, color: T.textMuted, marginTop: 4 }}>Accepted: {meta.accept}</div>}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button primary disabled={busy || !draft.title || (!draft._file && !draft.url && !draft.storage_path)} onClick={handleSave}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// ROI TAB
// ──────────────────────────────────────────────────────────
function RoiTab({ quote, pains }) {
  const [benefitOverride, setBenefitOverride] = useState(null)
  const autoBenefit = pains.reduce((s, p) => s + (Number(p.annual_cost) || 0), 0)
  const annualBenefit = benefitOverride != null ? benefitOverride : autoBenefit

  const y1Cost = (Number(quote.sage_subscription_total) || 0) + (Number(quote.sage_implementation_total) || 0) + (Number(quote.partner_subscription_total) || 0) + (Number(quote.partner_implementation_total) || 0)
  const annualCost = (Number(quote.sage_subscription_total) || 0) + (Number(quote.partner_subscription_total) || 0)

  const paybackMonths = annualBenefit > 0 ? Math.ceil((y1Cost / annualBenefit) * 12) : null
  const roi3yr = y1Cost > 0 ? Math.round(((annualBenefit * 3 - (annualCost * 3 + (Number(quote.sage_implementation_total) || 0) + (Number(quote.partner_implementation_total) || 0))) / y1Cost) * 100) : null

  return (
    <Card title="ROI">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Annual customer benefit</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 13 }}>$</span>
            <input type="number" min="0" step="1000" value={annualBenefit} onChange={e => setBenefitOverride(Number(e.target.value) || 0)} style={{ ...inputStyle, paddingLeft: 18 }} />
          </div>
          {benefitOverride != null && benefitOverride !== autoBenefit && autoBenefit > 0 && (
            <button onClick={() => setBenefitOverride(null)} style={{ background: 'none', border: 'none', color: T.primary, fontSize: 10, cursor: 'pointer', padding: 0, marginTop: 4 }}>
              ↺ Reset to {dollars(autoBenefit)} (sum of {pains.length} pain points)
            </button>
          )}
          {autoBenefit === 0 && (
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
              No quantified pains on this deal. Type a benefit estimate above, or quantify pains on the deal page.
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>Year-1 total cost</label>
          <div style={{ ...inputStyle, padding: '8px 10px', background: T.surfaceAlt, fontFeatureSettings: '"tnum"', fontWeight: 700 }}>{dollars(y1Cost)}</div>
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>From the quote: subscription + implementation (Sage + Partner)</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Metric label="Annual benefit" value={dollars(annualBenefit)} />
        <Metric label="Payback period" value={paybackMonths != null ? `${paybackMonths} mo` : '—'} positive={paybackMonths != null && paybackMonths <= 18} />
        <Metric label="3-year ROI" value={roi3yr != null ? `${roi3yr}%` : '—'} positive={roi3yr != null && roi3yr > 0} />
      </div>

      {pains.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Pain points contributing to benefit</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {pains.filter(p => Number(p.annual_cost) > 0).slice(0, 10).map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                  <td style={{ padding: '6px 8px' }}>{p.pain_description}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 600 }}>{dollars(p.annual_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Metric({ label, value, positive }) {
  return (
    <div style={{ padding: '10px 12px', background: T.surfaceAlt, borderRadius: 6, borderLeft: `3px solid ${positive ? T.success : T.borderLight}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: positive ? T.success : T.text, fontFeatureSettings: '"tnum"' }}>{value}</div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// SCHEDULE TAB — sorted by invoice_date, color-coded by payment_type
// ──────────────────────────────────────────────────────────
function ScheduleTab({ quote, schedule, onRegenerate, onChanged }) {
  const [busy, setBusy] = useState(false)

  const sortedSchedule = useMemo(() => {
    return [...schedule].sort((a, b) => {
      const da = new Date(a.invoice_date).getTime()
      const db = new Date(b.invoice_date).getTime()
      if (da !== db) return da - db
      return (a.sequence_number || 0) - (b.sequence_number || 0)
    })
  }, [schedule])

  async function updateRow(id, patch) {
    try { await supabase.from('quote_payment_schedule').update(patch).eq('id', id); await onChanged() } catch (e) { console.error(e) }
  }
  async function toggleLock(row) { await updateRow(row.id, { manually_edited: !row.manually_edited }) }
  async function deleteRow(id) {
    if (!confirm('Delete this row?')) return
    try { await supabase.from('quote_payment_schedule').delete().eq('id', id); await onChanged() } catch (e) { console.error(e) }
  }
  async function addCustom() {
    const maxSeq = schedule.reduce((m, r) => Math.max(m, r.sequence_number || 0), 0)
    try {
      await supabase.from('quote_payment_schedule').insert({
        quote_id: quote.id, sequence_number: maxSeq + 1, source: 'sage', payment_type: 'custom',
        invoice_date: new Date().toISOString().slice(0, 10), amount: 0, description: 'Custom payment', manually_edited: true,
      })
      await onChanged()
    } catch (e) { alert(e?.message) }
  }
  async function regen() {
    if (!confirm('Regenerate the schedule? Manually edited rows will be preserved.')) return
    setBusy(true)
    try { await onRegenerate() } finally { setBusy(false) }
  }

  const total = schedule.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const sageTotal = schedule.filter(r => r.source === 'sage').reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const partnerTotal = schedule.filter(r => r.source === 'partner').reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const expectedSolution = Number(quote.solution_total) || 0
  const drift = Math.abs(total - expectedSolution)
  const sanityOK = drift < 1.0
  const datesMonotonic = sortedSchedule.every((r, i) => i === 0 || new Date(r.invoice_date) >= new Date(sortedSchedule[i - 1].invoice_date))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.text }}>Payment Schedule</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={regen} disabled={busy}>Regenerate</Button>
          <Button primary onClick={addCustom}>+ Add Custom Row</Button>
        </div>
      </div>

      {/* Color legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, padding: '8px 12px', background: T.surfaceAlt, borderRadius: 4 }}>
        {Object.entries(PAYMENT_TYPE_LABELS).map(([k, label]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: T.textSecondary }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: PAYMENT_TYPE_COLORS[k] }} />
            {label}
          </span>
        ))}
      </div>

      {schedule.length === 0 ? (
        <EmptyState title="No schedule rows yet" message="Add subscription lines, implementation items, or terms to generate the schedule, then click Regenerate." action={<Button primary onClick={regen}>Regenerate</Button>} />
      ) : (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th style={thStyle}>Invoice Date</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Implementor</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Locked</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {sortedSchedule.map(r => {
                const typeColor = PAYMENT_TYPE_COLORS[r.payment_type] || T.textMuted
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${T.borderLight}`, background: r.manually_edited ? T.warningLight : 'transparent', borderLeft: `4px solid ${typeColor}` }}>
                    <td style={{ padding: '4px 6px' }}>
                      <input type="date" defaultValue={r.invoice_date}
                        onBlur={e => { if (e.target.value !== r.invoice_date) updateRow(r.id, { invoice_date: e.target.value, manually_edited: true }) }}
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px' }} />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <Badge color={r.source === 'sage' ? T.primary : T.sageGreen}>{r.source}</Badge>
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input defaultValue={r.implementor_name || ''}
                        onBlur={e => { if ((e.target.value || '') !== (r.implementor_name || '')) updateRow(r.id, { implementor_name: e.target.value || null, manually_edited: true }) }}
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px' }} />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <Badge color={typeColor}>{PAYMENT_TYPE_LABELS[r.payment_type] || r.payment_type}</Badge>
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input defaultValue={r.description}
                        onBlur={e => { if (e.target.value !== r.description) updateRow(r.id, { description: e.target.value, manually_edited: true }) }}
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px' }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input type="number" min="0" step="0.01" defaultValue={r.amount}
                        onBlur={e => { const v = Number(e.target.value); if (v !== Number(r.amount)) updateRow(r.id, { amount: v, manually_edited: true }) }}
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px', textAlign: 'right', fontFeatureSettings: '"tnum"' }} />
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                      <button onClick={() => toggleLock(r)} title={r.manually_edited ? 'Locked — survives regenerate' : 'Click to lock'} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: r.manually_edited ? T.warning : T.textMuted, padding: 0 }}>{r.manually_edited ? '🔒' : '🔓'}</button>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <button onClick={() => deleteRow(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 0 }}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <div style={{ marginTop: 14, padding: '12px 16px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 10 }}>
          <FooterCell label="Total scheduled" value={dollars(total)} bold color={T.primary} />
          <FooterCell label="Sage" value={dollars(sageTotal)} />
          <FooterCell label="Partner" value={dollars(partnerTotal)} />
        </div>
        <div style={{ fontSize: 11, color: sanityOK ? T.success : T.warning, fontWeight: 600 }}>
          Sanity: scheduled {dollars(total)} {sanityOK ? '=' : '≠'} solution_total {dollars(expectedSolution)}
          {!sanityOK && ` · drift ${dollars(drift)}`}
        </div>
        {!datesMonotonic && (
          <div style={{ fontSize: 11, color: T.warning, fontWeight: 600, marginTop: 4 }}>Warning: invoice dates are not monotonic.</div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// MSP TAB — link out
// ──────────────────────────────────────────────────────────
function MspTab({ dealId }) {
  const nav = useNavigate()
  return (
    <Card title="MSP">
      <div style={{ padding: '12px 8px', fontSize: 13, color: T.textSecondary, lineHeight: 1.6 }}>
        <p style={{ margin: '0 0 12px' }}>The Mutual Success Plan lives on its own page. Open it to edit stages, milestones, and resources.</p>
        <Button primary onClick={() => nav(`/deal/${dealId}/msp`)}>Open MSP</Button>
        <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted }}>Inline embedding in this tab is on the followup list.</div>
      </div>
    </Card>
  )
}
