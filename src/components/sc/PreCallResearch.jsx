import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'
import { Spinner, EmptyState, Card } from '../Shared'
import ProvenanceChip from '../ProvenanceChip'
import HypothesesPanel from '../HypothesesPanel'

// Pre-call research notes — research-sourced facts (company profile, pains,
// systems) each with an R chip + URL/date, compelling events as a dated list,
// and the research AI hypotheses in their own labeled, quarantined card.
// Facts and hypotheses never mix.
const PROFILE_FIELDS = [
  ['overview', 'Overview'], ['industry', 'Industry'], ['revenue', 'Revenue'],
  ['employee_count', 'Employees'], ['headquarters', 'Headquarters'], ['founded', 'Founded'],
  ['ownership', 'Ownership'], ['international_operations', 'International'],
]

export default function PreCallResearch({ deal }) {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [pains, setPains] = useState([])
  const [systems, setSystems] = useState([])
  const [events, setEvents] = useState([])
  const [sources, setSources] = useState({})

  useEffect(() => { load() }, [deal?.id])

  async function load() {
    setLoading(true)
    try {
      const [cp, pn, sy, ce, src] = await Promise.all([
        supabase.from('company_profile').select('*').eq('deal_id', deal.id).maybeSingle(),
        supabase.from('deal_pain_points').select('pain_description, source_url, notes, observed_at, source').eq('deal_id', deal.id).eq('source', 'ai_research'),
        supabase.from('company_systems').select('system_name, system_category, source_url, observed_at').eq('deal_id', deal.id).like('notes', '%AI research%'),
        supabase.from('compelling_events').select('event_description, event_date, source_url, observed_at, source').eq('deal_id', deal.id),
        supabase.from('deal_sources').select('field_name, source_url, source_title').eq('deal_id', deal.id).eq('source_origin', 'research'),
      ])
      setProfile(cp.data || null)
      setPains(pn.data || [])
      setSystems(sy.data || [])
      setEvents((ce.data || []))
      // Map deal_sources by field_name for per-field URLs on profile chips.
      const m = {}
      ;(src.data || []).forEach(s => { if (s.field_name && !m[s.field_name]) m[s.field_name] = s })
      setSources(m)
    } catch (e) { console.error('[PreCallResearch] load', e) } finally { setLoading(false) }
  }

  if (loading) return <Spinner />
  const researchedAt = profile?.researched_at
  const profRows = PROFILE_FIELDS.filter(([k]) => profile && profile[k] != null && String(profile[k]).trim() !== '')
  const hasAnything = profRows.length || pains.length || systems.length || events.length

  const rChip = (fieldName, observedAt) => {
    const s = sources[fieldName]
    return <ProvenanceChip dealId={deal.id} provenance={{ source: 'research', source_url: s?.source_url, source_title: s?.source_title, observed_at: observedAt || researchedAt }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!hasAnything && (
        <EmptyState icon="◎" title="No research yet" message="Research runs automatically when the deal is created. Once it completes, the company snapshot, pains, systems, and events show up here." />
      )}

      {profRows.length > 0 && (
        <Card title="Company snapshot">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {profRows.map(([k, label]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.borderLight}` }}>
                <span style={{ flex: '0 0 130px', fontSize: 12, fontWeight: 600, color: T.textSecondary }}>{label}</span>
                <span style={{ flex: 1, fontSize: 13, color: T.text }}>{String(profile[k])}</span>
                {rChip(k)}
              </div>
            ))}
          </div>
        </Card>
      )}

      {pains.length > 0 && (
        <Card title={`Pain points (${pains.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pains.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: i < pains.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                <span style={{ flex: 1, fontSize: 13, color: T.text }}>{p.pain_description}</span>
                <ProvenanceChip dealId={deal.id} provenance={{ source: 'research', source_url: p.source_url, observed_at: p.observed_at || researchedAt }} />
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
                <ProvenanceChip dealId={deal.id} provenance={{ source: 'research', source_url: s.source_url, observed_at: s.observed_at || researchedAt }} />
              </span>
            ))}
          </div>
        </Card>
      )}

      {events.length > 0 && (
        <Card title={`Events (${events.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {events.sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '')).map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: i < events.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                <span style={{ flex: '0 0 90px', fontSize: 11, fontWeight: 700, color: e.event_date ? T.primary : T.textMuted, fontFeatureSettings: '"tnum"' }}>
                  {e.event_date ? new Date(e.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Undated'}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: T.text }}>{e.event_description}</span>
                <ProvenanceChip dealId={deal.id} provenance={{ source: e.source === 'ai_research' ? 'research' : 'transcript', source_url: e.source_url, observed_at: e.observed_at || researchedAt }} />
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
