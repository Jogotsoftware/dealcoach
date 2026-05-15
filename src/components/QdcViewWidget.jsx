import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency } from '../lib/theme'
import { Button, Spinner, inputStyle, labelStyle } from './Shared'
import CompanyLogo from './CompanyLogo'

// QdcViewWidget — qualify-stage-only sibling of PipelineViewWidget. Same
// kanban/table shape, but cards surface QDC-relevant fields (Sourced By,
// Revenue, FTE, Industry, Primary Contact, Website) and offer an inline
// Disposition panel: status (pending_approval / approved / not_approved /
// cancelled) + reason (required when not_approved/cancelled) + always-on
// QDC feedback textbox.
//
// Stage transitions on submit:
//   approved      -> stage='discovery'        (qdc_status='approved')
//   not_approved  -> disqualify_deal_with_feedback RPC (stage='disqualified')
//   cancelled     -> disqualify_deal_with_feedback RPC (stage='disqualified')
//   pending       -> no stage change, just persists qdc_status + feedback
//
// The widget owns its own fetch — qualify-stage deals only — so it doesn't
// depend on the Pipeline page's `deals` prop or filter rules.

const QDC_STATUS_OPTIONS = [
  { value: 'pending_approval', label: 'Pending approval',         color: T.warning, needsReason: false },
  { value: 'approved',         label: 'Completed — Approved',     color: T.success, needsReason: false },
  { value: 'not_approved',     label: 'Completed — Not approved', color: T.error,   needsReason: true },
  { value: 'cancelled',        label: 'Cancelled',                color: T.textMuted, needsReason: true },
]

function ageLabel(createdAt) {
  if (!createdAt) return null
  const hrs = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 3_600_000))
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 14) return `${days}d ago`
  return `${Math.round(days / 7)}w ago`
}

// Best-available "Sourced By" name. BDR-sourced deals -> the BDR's name;
// AE-self-sourced -> the deal's rep (assigned AE).
function sourcedByName(deal) {
  if (deal.bdr_lead?.bdr?.full_name) return deal.bdr_lead.bdr.full_name
  if (deal.rep?.full_name) return deal.rep.full_name
  return '—'
}

// Pick "primary contact" with a sensible preference order.
function primaryContact(deal) {
  const cs = deal.contacts || []
  if (cs.length === 0) {
    // BDR-sourced deals embed the first contact on the lead itself, before
    // the contacts table is populated by AI extraction.
    if (deal.bdr_lead?.primary_contact_name) {
      return { name: deal.bdr_lead.primary_contact_name, title: deal.bdr_lead.primary_contact_title }
    }
    return null
  }
  return cs.find(c => c.is_champion)
      || cs.find(c => c.is_economic_buyer)
      || cs.find(c => c.is_signer)
      || cs[0]
}

// Revenue/FTE/industry/website — prefer the structured bdr_leads values when
// the deal was BDR-sourced (they're numeric); fall back to company_profile
// (text) for AE-self-sourced deals.
function dealRevenue(deal) {
  const lead = deal.bdr_lead
  if (lead?.annual_revenue) return formatCurrency(Number(lead.annual_revenue))
  const cp = deal.company_profile?.revenue
  return cp || null
}
function dealFte(deal) {
  const lead = deal.bdr_lead
  if (lead?.employee_count != null) return Number(lead.employee_count).toLocaleString()
  return deal.company_profile?.employee_count || null
}
function dealIndustry(deal) {
  return deal.bdr_lead?.industry || deal.bdr_lead?.vertical || deal.company_profile?.industry || null
}
function dealWebsite(deal) {
  // Only BDR-sourced deals carry a website today. AE-self-sourced will be
  // blank until we add a deal-level website field — see TODO in CLAUDE.md.
  return deal.bdr_lead?.website || null
}

export default function QdcViewWidget() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('lumen.qdc.view') || 'kanban' } catch { return 'kanban' }
  })
  const setViewPersist = (v) => { setView(v); try { localStorage.setItem('lumen.qdc.view', v) } catch {} }

  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openDispositionId, setOpenDispositionId] = useState(null)

  const isManager = !!profile && (
    ['head_of_sales','avp','rvp'].includes(profile.role_level) ||
    ['admin','system_admin','manager'].includes(profile.role)
  )

  async function loadDeals() {
    if (!profile?.id) return
    setLoading(true)
    setError(null)
    try {
      let q = supabase.from('deals').select(`
        id, company_name, stage, created_at, customer_logo_url,
        bdr_lead_id, qdc_status, qdc_disposition_reason_id, qdc_feedback,
        rep:profiles!rep_id(id, full_name, initials),
        company_profile(logo_url, revenue, employee_count, industry),
        contacts(id, name, title, is_champion, is_economic_buyer, is_signer, created_at),
        bdr_lead:bdr_leads!bdr_lead_id(
          id, website, annual_revenue, employee_count, industry, vertical,
          primary_contact_name, primary_contact_title,
          bdr:profiles!bdr_id(id, full_name)
        )
      `).eq('stage', 'qualify')
      // Reps see their own qualify deals; managers/admins see their org's.
      if (isManager && profile.org_id) q = q.eq('org_id', profile.org_id)
      else q = q.eq('rep_id', profile.id)
      const { data, error: e } = await q
      if (e) throw e
      setDeals(data || [])
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDeals() /* eslint-disable-next-line */ }, [profile?.id])

  function onDispositioned(dealId, { stageChanged }) {
    setOpenDispositionId(null)
    if (stageChanged) {
      // Card leaves the qualify list immediately — no re-fetch needed.
      setDeals(prev => prev.filter(d => d.id !== dealId))
    } else {
      // Pending: refetch so qdc_status pill reflects the new state.
      loadDeals()
    }
  }

  if (loading) return <div style={{ padding: 16 }}><Spinner /></div>
  if (error) return <div style={{ padding: 12, fontSize: 12, color: T.error }}>Couldn't load QDC deals: {error}</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
        {['kanban', 'table'].map(v => (
          <button key={v} onClick={() => setViewPersist(v)} style={{
            padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: view === v ? T.primary : T.surfaceAlt, color: view === v ? '#fff' : T.textMuted,
          }}>{v === 'kanban' ? 'Kanban' : 'Table'}</button>
        ))}
        <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 8 }}>{deals.length} deal{deals.length === 1 ? '' : 's'} awaiting QDC</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {deals.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>
            No deals waiting on QDC.
          </div>
        ) : view === 'kanban' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {deals.map(deal => (
              <QdcCard
                key={deal.id}
                deal={deal}
                profile={profile}
                onOpen={() => navigate(`/deal/${deal.id}`)}
                expanded={openDispositionId === deal.id}
                onToggleDisposition={() => setOpenDispositionId(p => p === deal.id ? null : deal.id)}
                onDispositioned={(res) => onDispositioned(deal.id, res)}
              />
            ))}
          </div>
        ) : (
          <QdcTable
            deals={deals}
            onOpen={(id) => navigate(`/deal/${id}`)}
            openDispositionId={openDispositionId}
            setOpenDispositionId={setOpenDispositionId}
            profile={profile}
            onDispositioned={onDispositioned}
          />
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  if (!status) return null
  const opt = QDC_STATUS_OPTIONS.find(o => o.value === status)
  if (!opt) return null
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color: opt.color,
      background: T.surfaceAlt, border: `1px solid ${opt.color}33`,
      padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap',
    }}>{opt.label}</span>
  )
}

function QdcCard({ deal, profile, onOpen, expanded, onToggleDisposition, onDispositioned }) {
  const revenue = dealRevenue(deal)
  const fte = dealFte(deal)
  const industry = dealIndustry(deal)
  const website = dealWebsite(deal)
  const contact = primaryContact(deal)
  return (
    <div
      style={{
        flex: '1 1 320px', minWidth: 300, maxWidth: 420,
        background: T.surface, border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${T.primary}`,
        borderRadius: 8, boxShadow: T.shadow,
        display: 'flex', flexDirection: 'column',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = T.shadowMd}
      onMouseLeave={e => e.currentTarget.style.boxShadow = T.shadow}
    >
      <div onClick={onOpen} style={{ padding: '12px 14px 10px', cursor: 'pointer' }}>
        {/* Header: logo + name + From BDR tag + status pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <CompanyLogo
            logoUrl={deal.company_profile?.logo_url}
            customerLogoUrl={deal.customer_logo_url}
            companyName={deal.company_name}
            size="sm"
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deal.company_name || 'Untitled'}
          </span>
          {deal.bdr_lead_id && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: T.primary,
              background: T.primaryLight, border: `1px solid ${T.primaryBorder}`,
              padding: '2px 6px', borderRadius: 4, letterSpacing: '0.04em',
              textTransform: 'uppercase', whiteSpace: 'nowrap',
            }}>From BDR</span>
          )}
          <StatusPill status={deal.qdc_status} />
        </div>

        {/* Fields */}
        <FieldRow label="Sourced By" value={sourcedByName(deal)} />
        <FieldRow label="Revenue" value={revenue || '—'} />
        <FieldRow label="FTE" value={fte || '—'} />
        <FieldRow label="Industry" value={industry || '—'} />
        <FieldRow
          label="Primary Contact"
          value={contact
            ? <span>{contact.name}{contact.title ? <span style={{ color: T.textMuted }}> — {contact.title}</span> : null}</span>
            : '—'}
        />
        <FieldRow
          label="Website"
          value={website
            ? <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ color: T.primary, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: 200, verticalAlign: 'bottom' }}>
                {website.replace(/^https?:\/\//, '')}
              </a>
            : '—'}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11, color: T.textMuted }}>
          <span>{ageLabel(deal.created_at)}</span>
        </div>
      </div>

      {/* Disposition action — sits outside the clickable header so it doesn't navigate */}
      <div style={{
        borderTop: `1px solid ${T.borderLight}`,
        padding: '8px 12px', background: expanded ? T.surfaceAlt : 'transparent',
      }}>
        {expanded ? (
          <QdcDispositionPanel
            deal={deal}
            profile={profile}
            onCancel={onToggleDisposition}
            onDone={onDispositioned}
          />
        ) : (
          <Button onClick={onToggleDisposition} primary style={{ padding: '5px 14px', fontSize: 12, width: '100%' }}>
            Disposition
          </Button>
        )}
      </div>
    </div>
  )
}

function FieldRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 12, lineHeight: 1.4 }}>
      <span style={{ width: 110, fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0, paddingTop: 1 }}>
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0, color: T.text, overflow: 'hidden' }}>{value}</span>
    </div>
  )
}

function QdcTable({ deals, onOpen, openDispositionId, setOpenDispositionId, profile, onDispositioned }) {
  const th = (label) => (
    <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{label}</th>
  )
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr>
        {th('Company')}{th('Sourced By')}{th('Revenue')}{th('FTE')}{th('Industry')}{th('Contact')}{th('Website')}{th('Status')}{th('')}
      </tr></thead>
      <tbody>
        {deals.map(deal => {
          const contact = primaryContact(deal)
          const website = dealWebsite(deal)
          const expanded = openDispositionId === deal.id
          return (
            <>
              <tr key={deal.id} style={{ borderBottom: expanded ? 'none' : `1px solid ${T.borderLight}`, cursor: 'pointer' }}
                onClick={() => onOpen(deal.id)}>
                <td style={{ padding: '8px', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CompanyLogo logoUrl={deal.company_profile?.logo_url} customerLogoUrl={deal.customer_logo_url} companyName={deal.company_name} size="sm" />
                    <span>{deal.company_name}</span>
                    {deal.bdr_lead_id && <span style={{ fontSize: 9, fontWeight: 700, color: T.primary, background: T.primaryLight, border: `1px solid ${T.primaryBorder}`, padding: '1px 5px', borderRadius: 3, marginLeft: 4 }}>BDR</span>}
                  </div>
                </td>
                <td style={{ padding: '8px' }}>{sourcedByName(deal)}</td>
                <td style={{ padding: '8px', fontFeatureSettings: '"tnum"' }}>{dealRevenue(deal) || '—'}</td>
                <td style={{ padding: '8px', fontFeatureSettings: '"tnum"' }}>{dealFte(deal) || '—'}</td>
                <td style={{ padding: '8px' }}>{dealIndustry(deal) || '—'}</td>
                <td style={{ padding: '8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {contact ? `${contact.name}${contact.title ? ' — ' + contact.title : ''}` : '—'}
                </td>
                <td style={{ padding: '8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {website ? (
                    <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noopener noreferrer"
                       onClick={e => e.stopPropagation()} style={{ color: T.primary, textDecoration: 'none' }}>
                      {website.replace(/^https?:\/\//, '')}
                    </a>
                  ) : '—'}
                </td>
                <td style={{ padding: '8px' }}><StatusPill status={deal.qdc_status} /></td>
                <td style={{ padding: '8px' }} onClick={e => e.stopPropagation()}>
                  <Button onClick={() => setOpenDispositionId(expanded ? null : deal.id)} primary style={{ padding: '3px 10px', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {expanded ? 'Close' : 'Disposition'}
                  </Button>
                </td>
              </tr>
              {expanded && (
                <tr key={deal.id + ':disposition'}>
                  <td colSpan={9} style={{ padding: '0 8px 12px 8px', background: T.surfaceAlt, borderBottom: `1px solid ${T.borderLight}` }}>
                    <QdcDispositionPanel
                      deal={deal}
                      profile={profile}
                      onCancel={() => setOpenDispositionId(null)}
                      onDone={(res) => onDispositioned(deal.id, res)}
                    />
                  </td>
                </tr>
              )}
            </>
          )
        })}
      </tbody>
    </table>
  )
}

// Inline disposition form. Status dropdown, reason dropdown (required for
// not_approved + cancelled), QDC feedback textbox (always available). Submit
// routes by status; not_approved/cancelled fall through to the existing
// disqualify_deal_with_feedback RPC so the BDR notification + audit flows
// keep working unchanged.
function QdcDispositionPanel({ deal, profile, onCancel, onDone }) {
  const [status, setStatus] = useState(deal.qdc_status || 'pending_approval')
  const [reasonId, setReasonId] = useState(deal.qdc_disposition_reason_id || '')
  const [feedback, setFeedback] = useState(deal.qdc_feedback || '')
  const [reasons, setReasons] = useState([])
  const [loadingReasons, setLoadingReasons] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState(null)

  const opt = QDC_STATUS_OPTIONS.find(o => o.value === status)
  const needsReason = !!opt?.needsReason

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data, error } = await supabase
          .from('im_rejection_reasons')
          .select('id, code, label, applies_to')
          .eq('org_id', deal.org_id || profile.org_id)
          .in('applies_to', ['pre_qdc', 'both'])
          .eq('active', true)
          .order('sort_order', { ascending: true })
        if (cancelled) return
        if (error) throw error
        setReasons(data || [])
      } catch (e) {
        if (!cancelled) setErr('Could not load reasons: ' + e.message)
      } finally {
        if (!cancelled) setLoadingReasons(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [deal.org_id, profile.org_id])

  const canSubmit = !submitting && (!needsReason || !!reasonId)

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setErr(null)
    try {
      const now = new Date().toISOString()

      if (status === 'approved') {
        const { error } = await supabase.from('deals').update({
          stage: 'discovery',
          stage_changed_at: now,
          qdc_status: 'approved',
          qdc_disposition_reason_id: null,
          qdc_feedback: feedback || null,
          qdc_dispositioned_at: now,
          qdc_dispositioned_by: profile.id,
        }).eq('id', deal.id)
        if (error) throw error
        onDone({ stageChanged: true })
        return
      }

      if (status === 'pending_approval') {
        const { error } = await supabase.from('deals').update({
          qdc_status: 'pending_approval',
          qdc_disposition_reason_id: null,
          qdc_feedback: feedback || null,
          qdc_dispositioned_at: now,
          qdc_dispositioned_by: profile.id,
        }).eq('id', deal.id)
        if (error) throw error
        onDone({ stageChanged: false })
        return
      }

      // not_approved or cancelled → run the canonical disqualify flow so
      // BDR notification + audit log + retrospective queue all fire.
      const { error: rpcErr } = await supabase.rpc('disqualify_deal_with_feedback', {
        p_deal_id: deal.id,
        p_rejection_reason_id: reasonId,
        p_feedback: feedback || null,
        p_actor_user_id: profile.id,
        p_suppress_bdr_notification: false,
      })
      if (rpcErr) throw new Error(rpcErr.message)

      // Stamp qdc_* fields too so the disposition is visible on retro / reports.
      await supabase.from('deals').update({
        qdc_status: status,
        qdc_disposition_reason_id: reasonId,
        qdc_feedback: feedback || null,
        qdc_dispositioned_at: now,
        qdc_dispositioned_by: profile.id,
      }).eq('id', deal.id)

      onDone({ stageChanged: true })
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: '10px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: needsReason ? '1fr 1fr' : '1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>QDC Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
            {QDC_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {needsReason && (
          <div>
            <label style={labelStyle}>Reason *</label>
            <select value={reasonId} onChange={e => setReasonId(e.target.value)} style={inputStyle} disabled={loadingReasons}>
              <option value="">— Select reason —</option>
              {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <label style={labelStyle}>QDC feedback {needsReason ? '(what should improve next time?)' : '(optional notes)'}</label>
        <textarea
          rows={3}
          style={{ ...inputStyle, minHeight: 64, lineHeight: 1.5, resize: 'vertical' }}
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder={needsReason
            ? 'What was missed or unclear? Goes to the BDR if this was BDR-sourced.'
            : 'Optional notes about this QDC.'}
        />
      </div>
      {err && <div style={{ fontSize: 12, color: T.error }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button primary onClick={submit} disabled={!canSubmit}>
          {submitting ? 'Saving…' : 'Save disposition'}
        </Button>
      </div>
    </div>
  )
}
