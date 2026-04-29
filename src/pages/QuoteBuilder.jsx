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

// Compact icon button for the QuoteBuilder header. `accent` = primary-tinted (Save),
// `danger` = red-on-hover (Delete). Same 28px square as the back button so the row aligns.
function QbIconButton({ title, onClick, disabled, children, accent, danger }) {
  const baseColor = accent ? T.primary : danger ? T.error : T.textMuted
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{
        width: 30, height: 30, padding: 0, borderRadius: 5,
        border: `1px solid ${accent ? T.primary : T.border}`,
        background: accent ? T.primary : T.surface,
        color: accent ? '#fff' : baseColor,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font,
        transition: 'background 0.1s, color 0.1s, border-color 0.1s',
      }}
      onMouseEnter={e => {
        if (disabled) return
        if (accent) return
        if (danger) { e.currentTarget.style.background = T.errorLight; e.currentTarget.style.color = T.error; e.currentTarget.style.borderColor = T.error + '55' }
        else { e.currentTarget.style.background = T.surfaceAlt; e.currentTarget.style.color = T.text }
      }}
      onMouseLeave={e => {
        if (accent) return
        e.currentTarget.style.background = T.surface
        e.currentTarget.style.color = baseColor
        e.currentTarget.style.borderColor = T.border
      }}>
      {children}
    </button>
  )
}

// ──────────────────────────────────────────────────────────
// Top-level page
// ──────────────────────────────────────────────────────────
export default function QuoteBuilder({
  dealId: dealIdProp,
  quoteId: quoteIdProp,
  embedded = false,
  forcedTab = null,
  // When the parent owns a quote selector (Deal Room Quotes tab), pass the quote
  // list + change handler so the picker renders inside this single unified header
  // instead of in a separate parent Card.
  headerQuotes = null,
  onChangeQuote = null,
  // Quote-management actions for embedded contexts that want full create/dup/del
  // surfaced inline (e.g. Deal Room Quotes tab — no need to bounce out to /quotes).
  onCreateQuote = null,
  onDuplicateQuote = null,
  onDeleteQuote = null,
  headerBusy = false,
  // Slot for parent-supplied actions (e.g. "Push to customer Proposal tab" + last
  // pushed timestamp). Rendered between the identity row and the Preview button.
  headerExtraAction = null,
  // Optional eye-icon visibility toggle (e.g. for the customer Proposal tab).
  headerVisibilityToggle = null,
  // Hides the entire builder header (identity row + tabbar) so a parent surface
  // can drop straight into a single tab's body — e.g. the Deal Room Models tab,
  // which inherits the quote chosen on the Quotes tab and shouldn't show its
  // own quote selector / save / status / contact controls.
  hideHeader = false,
} = {}) {
  // Embedded mode lets DealDetail's "Quotes" sub-tab mount the full builder
  // inline. The standalone /deal/:dealId/quote/:quoteId route still works —
  // useParams falls through when no prop is passed.
  // forcedTab pins the inner sub-tab (e.g. 'models') and hides the inner
  // TabBar — used when a parent surface only wants one slice of the builder.
  const params = useParams()
  const dealId = dealIdProp || params.dealId
  const quoteId = quoteIdProp || params.quoteId
  const nav = useNavigate()
  const { profile } = useAuth()
  const { org } = useOrg()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(forcedTab || 'quote')
  const [savingFlash, setSavingFlash] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

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


  if (loading) return <Spinner />
  if (error && !quote) return <div style={{ padding: 40, color: T.error }}>{error}</div>
  if (!quote) return <div style={{ padding: 40, color: T.textMuted }}>Quote not found</div>

  const tabs = [
    { key: 'quote', label: 'Quote' },
    { key: 'resources', label: 'Resources' },
    { key: 'models', label: 'Models' },
    { key: 'msp', label: 'Project Plan' },
  ]

  const showWarning = !!quote.compute_warning && !warningDismissed

  return (
    <div>
      {!hideHeader && (
      <div style={embedded
        ? { padding: '10px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`, background: T.surface }
        : { padding: '12px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`, background: T.surface, position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!embedded && (
            <button onClick={() => nav(`/deal/${dealId}/quotes`)} title="Back to quotes" style={{ background: 'transparent', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: T.textMuted, display: 'inline-flex', alignItems: 'center' }}
              onMouseEnter={e => { e.currentTarget.style.background = T.surfaceAlt; e.currentTarget.style.color = T.text }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = T.textMuted }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
          {/* Quote selector when there are 2+ quotes — otherwise just edit the name inline */}
          {headerQuotes && headerQuotes.length > 1 && onChangeQuote ? (
            <select
              value={quoteId}
              onChange={e => onChangeQuote(e.target.value)}
              title="Switch active quote"
              style={{ ...inputStyle, fontSize: 14, fontWeight: 700, padding: '6px 10px', maxWidth: 260, cursor: 'pointer' }}
            >
              {headerQuotes.map(q => <option key={q.id} value={q.id}>{q.name}{q.is_primary ? ' · primary' : ''}</option>)}
            </select>
          ) : (
            <input
              defaultValue={quote.name}
              onBlur={e => { if (e.target.value !== quote.name) saveQuoteHeader({ name: e.target.value }) }}
              style={{ ...inputStyle, fontSize: 14, fontWeight: 700, padding: '6px 10px', maxWidth: 260 }}
            />
          )}
          {/* Inline rename when a selector is shown */}
          {headerQuotes && headerQuotes.length > 1 && (
            <input
              defaultValue={quote.name}
              onBlur={e => { if (e.target.value !== quote.name) saveQuoteHeader({ name: e.target.value }) }}
              placeholder="Rename"
              style={{ ...inputStyle, fontSize: 12, padding: '5px 8px', maxWidth: 160 }}
            />
          )}
          {/* Primary star toggle */}
          <button
            onClick={() => { if (!quote.is_primary) setPrimary() }}
            disabled={quote.is_primary}
            title={quote.is_primary ? 'Primary quote' : 'Set as primary quote'}
            style={{
              width: 28, height: 28, padding: 0, border: 'none', borderRadius: 4,
              background: 'transparent', color: quote.is_primary ? T.warning : T.textMuted,
              cursor: quote.is_primary ? 'default' : 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font,
            }}
            onMouseEnter={e => { if (!quote.is_primary) { e.currentTarget.style.background = T.surfaceAlt; e.currentTarget.style.color = T.warning } }}
            onMouseLeave={e => { if (!quote.is_primary) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = T.textMuted } }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={quote.is_primary ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </button>
          <ContactPicker
            contacts={contacts}
            currentId={quote.signer_contact_id}
            onChange={async (id) => { await saveQuoteHeader({ signer_contact_id: id }); }}
          />

          <div style={{ flex: 1 }} />

          {/* Action icons */}
          {onCreateQuote && (
            <QbIconButton title="New quote" onClick={onCreateQuote} disabled={headerBusy}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </QbIconButton>
          )}
          {onDuplicateQuote && (
            <QbIconButton title="Save as new quote (duplicate)" onClick={() => onDuplicateQuote(quoteId)} disabled={headerBusy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </QbIconButton>
          )}
          <QbIconButton title={savingFlash ? 'Saving…' : (savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Save')}
            onClick={handleSave} disabled={savingFlash} accent>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          </QbIconButton>
          <QbIconButton title="Preview proposal" onClick={() => nav(`/deal/${dealId}/quote/${quoteId}/proposal`)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </QbIconButton>
          {headerExtraAction}
          {headerVisibilityToggle}
          {onDeleteQuote && (
            <QbIconButton title="Delete this quote" onClick={() => onDeleteQuote(quoteId)} disabled={headerBusy} danger>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </QbIconButton>
          )}
        </div>
        {/* Inner sub-tab bar — hidden when embedded inside the Deal Room (parent
            already exposes Quote / Resources / Models / Project Plan as top-level tabs). */}
        {!forcedTab && !embedded && <TabBar tabs={tabs} active={tab} onChange={setTab} />}
      </div>
      )}

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
            quoteId={quoteId}
            lines={lines}
            products={products}
            productMap={productMap}
            bundleChildrenMap={bundleChildrenMap}
            favorites={favorites}
            sageImplItems={implItems.filter(i => i.source === 'sage')}
            partnerImplItems={implItems.filter(i => i.source === 'partner')}
            partnerBlocks={partnerBlocks}
            partnerLines={partnerLines}
            contractTerms={contractTerms}
            profileId={profile?.id}
            saveQuoteHeader={saveQuoteHeader}
            registerFlusher={registerFlusher}
            onSubChanged={async () => { await recomputeSub(); await reload() }}
            onImplChanged={async () => { await recomputeTotals(); await regenSchedule(); await reload() }}
            onTermsChanged={async () => { await recomputeTotals(); await regenSchedule(); await reload() }}
            onPartnerSubChanged={async () => { await recomputePartner(); await reload() }}
            refreshFavorites={async () => {
              const { data } = await supabase.from('product_favorites').select('*').eq('user_id', profile?.id || '').order('sort_order')
              setFavorites(data || [])
            }}
          />
        )}
        {tab === 'resources' && (
          <ResourcesTab
            deal={deal}
            onDealUpdated={(patch) => setDeal(prev => prev ? { ...prev, ...patch } : prev)}
          />
        )}
        {tab === 'models' && (
          <ModelsTab
            quote={quote}
            pains={pains}
            schedule={schedule}
            contractTerms={contractTerms}
            partnerBlocks={partnerBlocks}
            partnerLines={partnerLines}
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
// QUOTE TAB — Subscription + Implementation + Terms + (collapsible) Partners
// ══════════════════════════════════════════════════════════
function QuoteTab({ quote, deal, quoteId, lines, products, productMap, bundleChildrenMap, favorites, sageImplItems, partnerImplItems, partnerBlocks, partnerLines, contractTerms, profileId, saveQuoteHeader, registerFlusher, onSubChanged, onImplChanged, onTermsChanged, onPartnerSubChanged, refreshFavorites }) {
  const [partnersOpen, setPartnersOpen] = useState(false)
  const partnerCount = partnerBlocks.length + partnerImplItems.length

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
          implItems={sageImplItems}
          implementorDefault="Sage"
          source="sage"
          saveQuoteHeader={saveQuoteHeader}
          onChanged={onImplChanged}
        />
      </div>
      <div style={{ marginTop: 24 }}>
        <TermsSection quote={quote} contractTerms={contractTerms} saveQuoteHeader={saveQuoteHeader} onChanged={onTermsChanged} />
      </div>

      {/* Collapsible Partners — bottom of the Quote tab */}
      <div style={{ marginTop: 24 }}>
        <Card style={{ marginBottom: 0 }}>
          <button
            onClick={() => setPartnersOpen(s => !s)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px',
              background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: T.font, textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 14, color: T.textMuted, transform: partnersOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block', width: 14 }}>▸</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Partners</span>
            {partnerCount > 0 && <Badge color={T.sageGreen}>{partnerCount}</Badge>}
            {Number(quote.partner_total) > 0 && (
              <span style={{ fontSize: 11, color: T.textSecondary, fontFeatureSettings: '"tnum"' }}>· {dollars(quote.partner_total)}</span>
            )}
          </button>
          {partnersOpen && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.borderLight}` }}>
              <PartnersTab
                quote={quote}
                quoteId={quoteId}
                partnerBlocks={partnerBlocks}
                partnerLines={partnerLines}
                implItems={partnerImplItems}
                saveQuoteHeader={saveQuoteHeader}
                onPartnerSubChanged={onPartnerSubChanged}
                onImplChanged={onImplChanged}
              />
            </div>
          )}
        </Card>
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

  // Blended Discount % — internal metric. We exclude entity SKUs (which are
  // typically heavily discounted as a sales tactic and skew the rate) and
  // percent_of_total lines (they aren't list-priced) so the rep sees the
  // effective discount on the rest of the bundle.
  const blendedDiscountPct = (() => {
    const eligible = lines.filter(l => {
      if (l.parent_line_id) return false
      const p = productMap[l.product_id]
      if (!p) return false
      if (p.is_entity) return false
      if (p.pricing_method === 'percent_of_total') return false
      return true
    })
    let listSum = 0
    let netSum = 0
    for (const l of eligible) {
      listSum += (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)
      netSum += Number(l.extended) || 0
    }
    if (listSum <= 0) return null
    return ((listSum - netSum) / listSum) * 100
  })()

  const globalDiscountUiPct = Math.round((Number(quote.global_discount_pct) || 0) * 10000) / 100

  // Per-column deal-room visibility (toggles in column headers)
  const colVis = {
    qty: drGet(quote, 'columns.qty', true),
    list: drGet(quote, 'columns.list', true),
    discount: drGet(quote, 'columns.discount', true),
    discount_amount: drGet(quote, 'columns.discount_amount', true),
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
              <ColTH label="Disc $" colKey="discount_amount" visible={colVis.discount_amount} onToggle={() => toggleColVis('discount_amount')} align="right" />
              <th style={{ ...thStyle, textAlign: 'center' }}>Exclude Global</th>
              <ColTH label="Price" colKey="price" visible={colVis.price} onToggle={() => toggleColVis('price')} align="right" />
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
        <FooterCell
          label="Blended Discount"
          value={blendedDiscountPct == null ? '—' : `${blendedDiscountPct.toFixed(1)}%`}
          color={blendedDiscountPct == null ? T.textMuted : (blendedDiscountPct > 0 ? T.success : T.textMuted)}
          title="Internal metric: weighted discount across non-entity SKUs (entity SKUs excluded since they're often heavily discounted and skew the rate)."
        />
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

// Column header with an inline eye-icon visibility toggle next to the label.
// Open eye = column visible in customer deal room, slashed eye = hidden.
function ColTH({ label, colKey, visible, onToggle, align = 'left' }) {
  return (
    <th style={{ ...thStyle, textAlign: align, padding: '6px 10px' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start', whiteSpace: 'nowrap' }}>
        {label}
        <DealRoomToggle visible={visible} onToggle={onToggle} size={13} inline />
      </span>
    </th>
  )
}

function SubscriptionLineRow({ line, product, preview, isChild, isDraggingThis, isDropTarget, globalDiscount, onDragStart, onDragOver, onDragEnd, onDrop, onScheduleUpdate, onPersistImmediate, onDelete }) {
  const isPercent = product?.pricing_method === 'percent_of_total'
  const nonDiscountable = !!product?.non_discountable
  const qtyEditable = product?.quantity_editable !== false && !isChild
  const maxRepDisc = product?.max_rep_discount_pct != null ? Number(product.max_rep_discount_pct) * 100 : null

  // Live price preview — flat lines compute client-side; percent lines show server's value.
  // Also expose the discount $ savings amount per line for the new Disc $ column.
  const { livePrice, liveDiscountAmount } = (() => {
    if (isChild) return { livePrice: 0, liveDiscountAmount: 0 }
    if (isPercent) return { livePrice: Number(line.extended) || 0, liveDiscountAmount: 0 }
    const qty = preview.quantity != null ? Number(preview.quantity) : Number(line.quantity)
    const unit = preview.unit_price != null ? Number(preview.unit_price) : Number(line.unit_price)
    const lineDisc = preview.discount_pct != null ? Number(preview.discount_pct) : Number(line.discount_pct)
    const explicitOverride = (line.apply_global_discount === false) || (line.apply_global_discount == null && product?.excluded_from_global_discount)
    const effectiveDisc = lineDisc > 0 || explicitOverride ? lineDisc : globalDiscount
    return { livePrice: qty * unit * (1 - effectiveDisc), liveDiscountAmount: qty * unit * effectiveDisc }
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
      <td style={{ padding: '6px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: liveDiscountAmount > 0 ? T.success : T.textMuted }}>
        {isChild ? '—' : (liveDiscountAmount > 0 ? `−${dollars(liveDiscountAmount)}` : '—')}
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

function FooterCell({ label, value, bold, color, title }) {
  return (
    <div title={title}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', cursor: title ? 'help' : undefined }}>{label}</div>
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

// Eye-icon visibility toggle. Open eye = visible to customer, slashed eye =
// hidden. Drop-in replacement for the previous "[ ] SHOW IN DEAL ROOM"
// checkbox — same { visible, onToggle, label } API.
function DealRoomToggle({ visible, onToggle, label = 'Show in deal room', size = 16, inline = false }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={visible ? `Visible in customer deal room — click to hide` : `Hidden from customer deal room — click to show`}
      aria-label={label}
      aria-pressed={visible}
      style={{
        background: 'transparent', border: 'none', padding: inline ? 0 : 4, marginLeft: inline ? 6 : 0,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: visible ? T.primary : T.textMuted, borderRadius: 4, lineHeight: 0,
        verticalAlign: inline ? 'middle' : 'baseline',
      }}
    >
      {visible ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      )}
    </button>
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
  // Sub-section visibility (eye toggles next to each sub-label inside Terms & Promo).
  const contractVisible      = drGet(quote, 'sections.contract', true)
  const termTemplateVisible  = drGet(quote, 'sections.term_template', true)
  const freeMonthsVisible    = drGet(quote, 'sections.free_months', true)
  const signingBonusVisible  = drGet(quote, 'sections.signing_bonus', true)

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
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8, display: 'inline-flex', alignItems: 'center' }}>
            Contract
            <DealRoomToggle visible={contractVisible} onToggle={() => save(drSetPatch(quote, 'sections.contract', !contractVisible))} size={13} inline />
          </div>
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
              <label style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center' }}>
                Term template
                <DealRoomToggle visible={termTemplateVisible} onToggle={() => save(drSetPatch(quote, 'sections.term_template', !termTemplateVisible))} size={13} inline />
              </label>
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
          <label style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center' }}>
            Free months (0–12)
            <DealRoomToggle visible={freeMonthsVisible} onToggle={() => save(drSetPatch(quote, 'sections.free_months', !freeMonthsVisible))} size={13} inline />
          </label>
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
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6, display: 'inline-flex', alignItems: 'center' }}>
              Signing bonus
              <DealRoomToggle visible={signingBonusVisible} onToggle={() => save(drSetPatch(quote, 'sections.signing_bonus', !signingBonusVisible))} size={13} inline />
            </div>
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
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Partner Subscriptions</h3>
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

export function ResourcesTab({ deal, onDealUpdated, headerExtra = null }) {
  const { org } = useOrg()
  const { profile } = useAuth()
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)  // null | { ...resource } (for add/edit modal)
  const [showLibrary, setShowLibrary] = useState(false)

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
      resource_type: 'document', title: '', notes: '', url: '', storage_path: '', mime_type: '', file_size: null, _file: null,
    })
  }

  // Save an existing per-deal resource into the org's reusable library so
  // any teammate can pull it into a future deal.
  async function saveToLibrary(r) {
    setError('')
    try {
      const { data: existing } = await supabase.from('org_resource_library').select('id').eq('org_id', org.id).eq('title', r.title).maybeSingle()
      if (existing) {
        if (!confirm(`A library resource named "${r.title}" already exists. Replace it?`)) return
        const { error: upErr } = await supabase.from('org_resource_library').update({
          resource_type: r.resource_type, notes: r.notes || null,
          url: r.url || null, storage_path: r.storage_path || null,
          mime_type: r.mime_type || null, file_size: r.file_size || null,
        }).eq('id', existing.id)
        if (upErr) throw upErr
      } else {
        const { error: insErr } = await supabase.from('org_resource_library').insert({
          org_id: org.id, created_by: profile?.id,
          resource_type: r.resource_type, title: r.title, notes: r.notes || null,
          url: r.url || null, storage_path: r.storage_path || null,
          mime_type: r.mime_type || null, file_size: r.file_size || null,
        })
        if (insErr) throw insErr
      }
      alert(`"${r.title}" saved to your team library.`)
    } catch (e) {
      console.error('[ResourcesTab] saveToLibrary failed:', e)
      setError(e?.message || 'Save to library failed')
    }
  }

  // Add a library entry to this deal as a deal_resources row. Storage paths
  // are shared (same bucket) so we just copy references — no re-upload.
  async function addFromLibrary(libItem) {
    setError('')
    try {
      const { error: insErr } = await supabase.from('deal_resources').insert({
        org_id: org.id, deal_id: deal.id, created_by: profile?.id,
        resource_type: libItem.resource_type, title: libItem.title, notes: libItem.notes || null,
        url: libItem.url || null, storage_path: libItem.storage_path || null,
        mime_type: libItem.mime_type || null, file_size: libItem.file_size || null,
        sort_order: resources.length,
      })
      if (insErr) throw insErr
      try { await supabase.from('org_resource_library').update({ usage_count: (libItem.usage_count || 0) + 1 }).eq('id', libItem.id) } catch { /* non-fatal */ }
      setShowLibrary(false)
      await load()
    } catch (e) {
      console.error('[ResourcesTab] addFromLibrary failed:', e)
      setError(e?.message || 'Add from library failed')
    }
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
        notes: draft.notes?.trim() ? draft.notes.trim() : null,
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

  // Group resources by type, in friendly order — matches the customer-facing
  // viewer layout so the rep sees what they're configuring.
  const TYPE_ORDER = ['demo', 'powerpoint', 'document', 'link', 'misc']
  const grouped = TYPE_ORDER
    .map(type => ({ type, items: resources.filter(r => (r.resource_type || 'misc') === type) }))
    .filter(g => g.items.length > 0)

  return (
    <div>
      <Card title="Files & Links" action={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {headerExtra}
          <Button onClick={() => setShowLibrary(true)} style={{ padding: '4px 10px', fontSize: 11 }}>From library</Button>
          <Button primary onClick={newResource} style={{ padding: '4px 10px', fontSize: 11 }}>+ Add Resource</Button>
        </div>
      }>
        <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 10 }}>
          Description text on each resource shows to the customer in the Evaluation Room Library tab. Use it to explain what the file is and why it matters.
        </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {grouped.map(({ type, items }) => {
              const meta = RESOURCE_TYPE_META[type] || RESOURCE_TYPE_META.misc
              return (
                <div key={type} style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: meta.color + '0d', borderBottom: `1px solid ${T.borderLight}` }}>
                    <span style={{ padding: '3px 10px', background: meta.color + '22', color: meta.color, fontSize: 10, fontWeight: 800, borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{meta.label}</span>
                    <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>
                      {items.length} {items.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}>
                          <th style={{ textAlign: 'left',  padding: '8px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', width: '28%' }}>Title</th>
                          <th style={{ textAlign: 'left',  padding: '8px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes</th>
                          <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', width: 240 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(r => (
                          <tr key={r.id} style={{ borderBottom: `1px solid ${T.borderLight}`, verticalAlign: 'top' }}>
                            <td style={{ padding: '12px 14px' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                <button
                                  onClick={() => del(r)}
                                  title={`Remove "${r.title}"`}
                                  aria-label={`Remove ${r.title}`}
                                  style={{
                                    width: 18, height: 18, padding: 0, marginTop: 1,
                                    border: 'none', background: 'transparent',
                                    color: T.textMuted, cursor: 'pointer', borderRadius: 3, lineHeight: 1,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    fontFamily: T.font, flexShrink: 0,
                                    transition: 'background 0.1s, color 0.1s',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.background = T.errorLight; e.currentTarget.style.color = T.error }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = T.textMuted }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                  </svg>
                                </button>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, lineHeight: 1.35 }}>{r.title}</div>
                                  {r.storage_path && r.file_size != null && (
                                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>
                                      {Math.round(r.file_size / 1024)} KB · {r.mime_type || 'file'}
                                    </div>
                                  )}
                                  {!r.storage_path && r.url && (
                                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4, wordBreak: 'break-all', fontFamily: T.mono }}>{r.url}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '12px 14px', fontSize: 12, color: T.textSecondary, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                              {r.notes || <span style={{ color: T.textMuted, fontStyle: 'italic' }}>—</span>}
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {r.url && (
                                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                                    style={{ fontSize: 11, fontWeight: 600, color: T.primary, padding: '4px 10px', border: `1px solid ${T.border}`, borderRadius: 4, textDecoration: 'none', background: T.surface }}>
                                    {r.storage_path ? 'Download' : 'Open'}
                                  </a>
                                )}
                                <Button onClick={() => setEditing({ ...r, _file: null })} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
                                <Button onClick={() => saveToLibrary(r)} style={{ padding: '4px 10px', fontSize: 11 }} title="Save to your team library so anyone can re-use it on another deal">★ Library</Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {editing && <ResourceEditor initial={editing} onClose={() => setEditing(null)} onSave={save} />}
      {showLibrary && <LibraryPicker orgId={org?.id} onClose={() => setShowLibrary(false)} onPick={addFromLibrary} />}
    </div>
  )
}

function ResourceCard({ resource, onEdit, onDelete, onSaveToLibrary }) {
  const meta = RESOURCE_TYPE_META[resource.resource_type] || RESOURCE_TYPE_META.misc
  return (
    <div style={{ padding: 12, border: `1px solid ${T.border}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 6, background: T.surface, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Badge color={meta.color}>{meta.label}</Badge>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1, lineHeight: 1.3 }}>{resource.title}</div>
      </div>
      {resource.notes && (
        <div style={{ fontSize: 11, color: T.textSecondary, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{resource.notes}</div>
      )}
      {resource.storage_path && resource.file_size != null && (
        <div style={{ fontSize: 10, color: T.textMuted }}>
          {Math.round(resource.file_size / 1024)} KB · {resource.mime_type || 'file'}
        </div>
      )}
      {!resource.storage_path && resource.url && (
        <div style={{ fontSize: 10, color: T.textMuted, wordBreak: 'break-all', fontFamily: T.mono }}>{resource.url}</div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
        {resource.url && (
          <a href={resource.url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, fontWeight: 600, color: T.primary, padding: '4px 10px', border: `1px solid ${T.border}`, borderRadius: 4, textDecoration: 'none', cursor: 'pointer', flex: 1, textAlign: 'center', background: T.surface }}>
            {resource.storage_path ? 'Download' : 'Open'}
          </a>
        )}
        <Button onClick={onEdit} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
        {onSaveToLibrary && (
          <Button onClick={onSaveToLibrary} style={{ padding: '4px 10px', fontSize: 11 }} title="Save to your team library so anyone can re-use it on another deal">★ Library</Button>
        )}
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

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Description (shown to the customer in the Evaluation Room)</label>
            <textarea
              style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: T.font, fontSize: 13, lineHeight: 1.5 }}
              value={draft.notes || ''}
              onChange={e => setF('notes', e.target.value)}
              placeholder="e.g. 30-minute walkthrough of the AP automation flow — start with this if you've never seen Sage Intacct."
            />
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

function LibraryPicker({ orgId, onClose, onPick }) {
  const [items, setItems] = useState(null)
  const [filter, setFilter] = useState('')
  const [type, setType] = useState('all')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('org_resource_library')
        .select('*')
        .eq('org_id', orgId)
        .order('usage_count', { ascending: false })
        .order('updated_at', { ascending: false })
      if (cancelled) return
      if (error) { console.error('[LibraryPicker] load failed:', error); setItems([]); return }
      setItems(data || [])
    }
    if (orgId) load()
    return () => { cancelled = true }
  }, [orgId])

  async function deleteFromLibrary(item) {
    if (!confirm(`Remove "${item.title}" from your team library? This won't affect deals already using it.`)) return
    try {
      await supabase.from('org_resource_library').delete().eq('id', item.id)
      setItems(prev => prev.filter(x => x.id !== item.id))
    } catch (e) { console.error('[LibraryPicker] delete failed:', e); alert(e?.message || 'Delete failed') }
  }

  const visible = (items || []).filter(it => {
    if (type !== 'all' && it.resource_type !== type) return false
    if (filter.trim() && !`${it.title} ${it.notes || ''}`.toLowerCase().includes(filter.trim().toLowerCase())) return false
    return true
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 8, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: T.shadowMd }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Add from team library</h3>
            <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>Reusable resources saved across all deals in your org. Picking copies the resource into this deal — edits later are deal-specific.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: T.textMuted, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.borderLight}`, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search title or description…"
            style={{ ...inputStyle, padding: '6px 10px', fontSize: 12, flex: 1, minWidth: 200 }} />
          <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputStyle, padding: '6px 10px', fontSize: 12, width: 'auto', cursor: 'pointer' }}>
            <option value="all">All types</option>
            {Object.entries(RESOURCE_TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </div>

        <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
          {items === null ? (
            <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>Loading library…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
              Your team library is empty. Save resources to it from the Files & Links cards using the <strong>★ Library</strong> button.
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>No matches.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {visible.map(it => {
                const meta = RESOURCE_TYPE_META[it.resource_type] || RESOURCE_TYPE_META.misc
                return (
                  <div key={it.id} style={{ padding: 12, border: `1px solid ${T.border}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 6, background: T.surface, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Badge color={meta.color}>{meta.label}</Badge>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1, lineHeight: 1.3 }}>{it.title}</div>
                    </div>
                    {it.notes && <div style={{ fontSize: 11, color: T.textSecondary, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{it.notes}</div>}
                    {it.storage_path && it.file_size != null && (
                      <div style={{ fontSize: 10, color: T.textMuted }}>{Math.round(it.file_size / 1024)} KB · {it.mime_type || 'file'}</div>
                    )}
                    {!it.storage_path && it.url && (
                      <div style={{ fontSize: 10, color: T.textMuted, wordBreak: 'break-all', fontFamily: T.mono }}>{it.url}</div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', gap: 6 }}>
                      <span style={{ fontSize: 10, color: T.textMuted }}>Used {it.usage_count || 0}×</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button danger onClick={() => deleteFromLibrary(it)} style={{ padding: '3px 8px', fontSize: 10 }}>Remove</Button>
                        <Button primary onClick={() => onPick(it)} style={{ padding: '3px 10px', fontSize: 11 }}>Add to deal</Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Close</Button>
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

// ══════════════════════════════════════════════════════════
// MODELS TAB — wraps ROI, Payment Schedule, and TCO under a sub-tab bar
// ══════════════════════════════════════════════════════════
function ModelsTab({ quote, pains, schedule, contractTerms, partnerBlocks, partnerLines, onRegenerate, onChanged }) {
  const [sub, setSub] = useState('roi')
  const subTabs = [
    { key: 'roi', label: 'ROI' },
    { key: 'schedule', label: `Payment Schedule${schedule.length ? ` (${schedule.length})` : ''}` },
    { key: 'tco', label: 'TCO' },
  ]
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <TabBar tabs={subTabs} active={sub} onChange={setSub} />
      </div>
      {sub === 'roi' && <RoiTab quote={quote} pains={pains} />}
      {sub === 'schedule' && <ScheduleTab quote={quote} schedule={schedule} onRegenerate={onRegenerate} onChanged={onChanged} />}
      {sub === 'tco' && <TcoTab quote={quote} contractTerms={contractTerms} partnerBlocks={partnerBlocks} partnerLines={partnerLines} />}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// TCO TAB — multi-year cost breakdown (subscription + impl + adjustments)
// ──────────────────────────────────────────────────────────
function TcoTab({ quote, contractTerms, partnerBlocks, partnerLines }) {
  const term = contractTerms.find(ct => ct.id === quote.contract_term_id)
  const sageYears = term?.term_years || 1
  const yoyCaps = Array.isArray(term?.yoy_caps) ? term.yoy_caps : [0]

  const sageY1 = Number(quote.sage_subscription_total) || 0
  const sageImpl = Number(quote.sage_implementation_total) || 0
  const sageMonthly = sageY1 / 12
  const signingBonus = Number(quote.signing_bonus_amount) > 0
    ? Number(quote.signing_bonus_amount)
    : sageMonthly * (Number(quote.signing_bonus_months) || 0)
  const freeMonthsValue = sageMonthly * (Number(quote.free_months) || 0)
  const partnerImplTotal = Number(quote.partner_implementation_total) || 0

  const maxPartnerYears = partnerBlocks.reduce((m, b) => Math.max(m, Number(b.term_years) || 0), 0)
  const horizon = Math.max(sageYears, maxPartnerYears, 1)

  // Per-year subscription Sage with YoY escalation; zero past sageYears
  const sageSubByYear = []
  let runningSage = sageY1
  for (let y = 1; y <= horizon; y++) {
    if (y === 1) {
      sageSubByYear.push(runningSage)
    } else if (y <= sageYears) {
      const cap = Number(yoyCaps[y - 1]) || 0
      runningSage = runningSage * (1 + cap / 100)
      sageSubByYear.push(runningSage)
    } else {
      sageSubByYear.push(0)
    }
  }

  // Per-year partner subscription = sum of block annuals while year <= block.term_years
  const partnerSubByYear = []
  for (let y = 1; y <= horizon; y++) {
    let sum = 0
    for (const block of partnerBlocks) {
      if (y <= (Number(block.term_years) || 0)) {
        const blockAnnual = partnerLines
          .filter(l => l.block_id === block.id)
          .reduce((s, l) => s + (Number(l.extended) || 0), 0)
        sum += blockAnnual
      }
    }
    partnerSubByYear.push(sum)
  }

  let cumulative = 0
  const rows = []
  for (let y = 1; y <= horizon; y++) {
    const ss = sageSubByYear[y - 1] || 0
    const si = y === 1 ? sageImpl : 0
    const ps = partnerSubByYear[y - 1] || 0
    const pi = y === 1 ? partnerImplTotal : 0
    const adj = y === 1 ? -(signingBonus + freeMonthsValue) : 0
    const yearTotal = ss + si + ps + pi + adj
    cumulative += yearTotal
    rows.push({ y, ss, si, ps, pi, adj, yearTotal, cumulative })
  }

  const grandTotal = rows.reduce((s, r) => s + r.yearTotal, 0)

  if (sageY1 === 0 && partnerBlocks.length === 0) {
    return <EmptyState title="Nothing to model yet" message="Add subscription lines, partner blocks, or implementation items first. The TCO model derives entirely from what's on the quote." />
  }

  return (
    <div>
      <Card title={`TCO — ${horizon}-year Total Cost of Ownership`}>
        <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 10 }}>
          Sage subscription escalates Y2+ per the contract template's YoY caps. Partners run flat for their term length. Implementation, signing bonus, and free months hit Year 1.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${T.primary}` }}>
              <th style={thStyle}>Year</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Sage Subscription</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Sage Impl</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Partner Subscription</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Partner Impl</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Adjustments</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Year Total</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.y} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ padding: '8px 10px', fontWeight: 700 }}>Y{r.y}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{dollars(r.ss)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: r.si === 0 ? T.textMuted : T.text }}>{r.si === 0 ? '—' : dollars(r.si)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: r.ps === 0 ? T.textMuted : T.text }}>{r.ps === 0 ? '—' : dollars(r.ps)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: r.pi === 0 ? T.textMuted : T.text }}>{r.pi === 0 ? '—' : dollars(r.pi)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: r.adj < 0 ? T.success : T.textMuted }}>{r.adj === 0 ? '—' : dollars(r.adj)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 700 }}>{dollars(r.yearTotal)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 700, color: T.primary }}>{dollars(r.cumulative)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${T.primary}`, background: T.primaryLight }}>
              <td colSpan={6} style={{ padding: '10px', fontWeight: 800, fontSize: 13 }}>Total Cost of Ownership ({horizon} years)</td>
              <td colSpan={2} style={{ padding: '10px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: T.primary, fontFeatureSettings: '"tnum"' }}>{dollars(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Mini-summary cards under the table */}
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <Metric label="Sage TCV" value={dollars(rows.reduce((s, r) => s + r.ss + r.si, 0))} />
          <Metric label="Partner TCV" value={dollars(rows.reduce((s, r) => s + r.ps + r.pi, 0))} />
          <Metric label="Adjustments" value={dollars(rows.reduce((s, r) => s + r.adj, 0))} />
          <Metric label="Average / year" value={dollars(grandTotal / horizon)} />
        </div>
      </Card>
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
    <Card title="Project Plan">
      <div style={{ padding: '12px 8px', fontSize: 13, color: T.textSecondary, lineHeight: 1.6 }}>
        <p style={{ margin: '0 0 12px' }}>The Project Plan lives on its own page. Open it to edit stages, milestones, and resources.</p>
        <Button primary onClick={() => nav(`/deal/${dealId}/msp`)}>Open Project Plan</Button>
        <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted }}>Inline embedding in this tab is on the followup list.</div>
      </div>
    </Card>
  )
}
