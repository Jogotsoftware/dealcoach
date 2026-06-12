import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'
import { Spinner, EmptyState, Card, Badge } from '../Shared'
import ProvenanceChip from '../ProvenanceChip'
import HypothesesPanel from '../HypothesesPanel'

// Pre-call research notes — the full pre-QDC research picture: company
// snapshot (scalars + goals/priorities/growth/revenue streams), contacts,
// competitors, recent news, research-sourced pains + current systems, dated
// events, and the research AI hypotheses in their own quarantined card.
// Every fact carries an R chip with its source URL/date. Facts and
// hypotheses never mix.
const SCALARS = [
  ['overview', 'Overview'], ['industry', 'Industry'], ['revenue', 'Revenue'],
  ['employee_count', 'Employees'], ['headquarters', 'Headquarters'], ['founded', 'Founded'],
  ['international_operations', 'International'],
]
const LISTS = [
  ['business_goals_list', 'business_goals', 'Business goals'],
  ['business_priorities_list', 'business_priorities', 'Priorities'],
  ['growth_plans_list', 'growth_plans', 'Growth plans'],
  ['revenue_streams_list', 'revenue_streams', 'Revenue streams'],
]
const asList = (profile, listKey, textKey) => {
  const v = profile?.[listKey]
  if (Array.isArray(v) && v.length) return v
  const t = profile?.[textKey]
  if (typeof t === 'string' && t.trim()) return t.split(/;|\n/).map(s => s.trim()).filter(Boolean)
  return []
}

export default function PreCallResearch({ deal }) {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [contacts, setContacts] = useState([])
  const [competitors, setCompetitors] = useState([])
  const [news, setNews] = useState([])
  const [pains, setPains] = useState([])
  const [systems, setSystems] = useState([])
  const [events, setEvents] = useState([])
  const [sources, setSources] = useState({})
  const [website, setWebsite] = useState(null)
  const [drivers, setDrivers] = useState(null)

  useEffect(() => { load() }, [deal?.id])

  async function load() {
    setLoading(true)
    try {
      const [cp, ct, comp, nw, pn, sy, ce, src, dl, da] = await Promise.all([
        supabase.from('company_profile').select('*').eq('deal_id', deal.id).maybeSingle(),
        supabase.from('contacts').select('name, title, department, role_in_deal, linkedin, background, source_url').eq('deal_id', deal.id),
        supabase.from('deal_competitors').select('competitor_name, website, notes, source_url').eq('deal_id', deal.id),
        supabase.from('company_news').select('headline, date_text, source_url').eq('deal_id', deal.id),
        supabase.from('deal_pain_points').select('pain_description, annual_cost, source_url, observed_at, source').eq('deal_id', deal.id).order('annual_cost', { ascending: false, nullsFirst: false }),
        supabase.from('company_systems').select('system_name, system_category, source_url, source_type, observed_at, is_current').eq('deal_id', deal.id).eq('is_current', true),
        supabase.from('compelling_events').select('event_description, event_date, source_url, observed_at, source').eq('deal_id', deal.id),
        supabase.from('deal_sources').select('field_name, source_url, source_title').eq('deal_id', deal.id).eq('source_origin', 'research'),
        supabase.from('deals').select('website').eq('id', deal.id).maybeSingle(),
        supabase.from('deal_analysis').select('driving_factors').eq('deal_id', deal.id).maybeSingle(),
      ])
      setProfile(cp.data || null)
      setContacts(ct.data || [])
      setCompetitors(comp.data || [])
      setNews(nw.data || [])
      setPains(pn.data || [])
      setSystems(sy.data || [])
      setEvents(ce.data || [])
      setWebsite(dl.data?.website || null)
      setDrivers(da.data?.driving_factors && da.data.driving_factors.toLowerCase() !== 'unknown' ? da.data.driving_factors : null)
      const m = {}
      ;(src.data || []).forEach(s => { if (s.field_name && !m[s.field_name]) m[s.field_name] = s })
      setSources(m)
    } catch (e) { console.error('[PreCallResearch] load', e) } finally { setLoading(false) }
  }

  if (loading) return <Spinner />
  const ra = profile?.researched_at
  const scalarRows = SCALARS.filter(([k]) => profile && profile[k] != null && String(profile[k]).trim() !== '')
  const listRows = LISTS.map(([lk, tk, label]) => ({ label, items: asList(profile, lk, tk) })).filter(r => r.items.length)
  const hasAnything = scalarRows.length || listRows.length || contacts.length || competitors.length || news.length || pains.length || systems.length || events.length

  const rChip = (fieldName, observedAt, url) => (
    <ProvenanceChip dealId={deal.id} provenance={{ source: 'research', source_url: url || sources[fieldName]?.source_url, source_title: sources[fieldName]?.source_title, observed_at: observedAt || ra }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!hasAnything && (
        <EmptyState icon="◎" title="No research yet" message="Research runs automatically when the deal is created. The company snapshot, contacts, competitors, news, pains, and systems show up here once it completes." />
      )}

      {(scalarRows.length > 0 || listRows.length > 0 || website || drivers || pains.length > 0) && (
        <Card title="Company snapshot">
          {website && (
            <div style={{ marginBottom: 8 }}>
              <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 13, color: T.primary, fontWeight: 600 }}>{website.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗</a>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {scalarRows.map(([k, label]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.borderLight}` }}>
                <span style={{ flex: '0 0 130px', fontSize: 12, fontWeight: 600, color: T.textSecondary }}>{label}</span>
                <span style={{ flex: 1, fontSize: 13, color: T.text }}>{String(profile[k])}</span>
                {rChip(k)}
              </div>
            ))}
            {listRows.map(r => (
              <div key={r.label} style={{ padding: '8px 0', borderBottom: `1px solid ${T.borderLight}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 4 }}>{r.label}</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {r.items.map((it, i) => <li key={i} style={{ fontSize: 13, color: T.text, marginBottom: 2 }}>{it}</li>)}
                </ul>
              </div>
            ))}
            {drivers && (
              <div style={{ padding: '8px 0', borderBottom: pains.length ? `1px solid ${T.borderLight}` : 'none' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 4 }}>Drivers</div>
                <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{drivers}</div>
              </div>
            )}
            {pains.length > 0 && (
              <div style={{ padding: '8px 0' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 4 }}>Top pains</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {pains.slice(0, 8).map((p, i) => (
                    <li key={i} style={{ fontSize: 13, color: T.text, marginBottom: 3 }}>
                      {p.pain_description}{typeof p.annual_cost === 'number' && p.annual_cost > 0 ? <span style={{ color: T.textMuted }}> (${p.annual_cost.toLocaleString()}/yr)</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {contacts.length > 0 && (
        <Card title={`Contacts (${contacts.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {contacts.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < contacts.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c.name}</span>
                  {c.title && <span style={{ fontSize: 12, color: T.textSecondary }}> · {c.title}</span>}
                </div>
                {c.role_in_deal && c.role_in_deal !== 'Unknown' && <Badge color={T.primary}>{c.role_in_deal}</Badge>}
                {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: T.primary }}>in ↗</a>}
                {c.source_url && rChip(null, ra, c.source_url)}
              </div>
            ))}
          </div>
        </Card>
      )}

      {competitors.length > 0 && (
        <Card title={`Competitors (${competitors.length})`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {competitors.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, fontSize: 12 }}>
                <span style={{ color: T.text, fontWeight: 600 }}>{c.competitor_name}</span>
                {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: T.primary }}>↗</a>}
                {c.source_url && rChip(null, ra, c.source_url)}
              </span>
            ))}
          </div>
        </Card>
      )}

      {news.length > 0 && (
        <Card title={`Recent news (${news.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {news.map((n, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: i < news.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                {n.date_text && <span style={{ flex: '0 0 70px', fontSize: 11, color: T.textMuted }}>{n.date_text}</span>}
                {n.source_url
                  ? <a href={n.source_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 13, color: T.primary }}>{n.headline} ↗</a>
                  : <span style={{ flex: 1, fontSize: 13, color: T.text }}>{n.headline}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {systems.length > 0 && (
        <Card title={`Current systems (${systems.length})`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {systems.map((s, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, fontSize: 12 }}>
                <span style={{ color: T.text, fontWeight: 600 }}>{s.system_name}</span>
                {s.system_category && <span style={{ color: T.textMuted, fontSize: 10 }}>{s.system_category}</span>}
                <ProvenanceChip dealId={deal.id} provenance={{ source: s.source_type === 'transcript' ? 'transcript' : 'research', source_url: s.source_url, observed_at: s.observed_at || ra }} />
              </span>
            ))}
          </div>
        </Card>
      )}

      {events.length > 0 && (
        <Card title={`Events (${events.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...events].sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '')).map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: i < events.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                <span style={{ flex: '0 0 90px', fontSize: 11, fontWeight: 700, color: e.event_date ? T.primary : T.textMuted, fontFeatureSettings: '"tnum"' }}>
                  {e.event_date ? new Date(e.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Undated'}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: T.text }}>{e.event_description}</span>
                <ProvenanceChip dealId={deal.id} provenance={{ source: e.source === 'ai_research' ? 'research' : 'transcript', source_url: e.source_url, observed_at: e.observed_at || ra }} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Research hypotheses — quarantined, never mixed with facts. */}
      <HypothesesPanel dealId={deal.id} generatedBy="research" title="AI hypotheses (unverified)" />
    </div>
  )
}
