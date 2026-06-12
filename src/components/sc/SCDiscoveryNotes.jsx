import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'
import { Spinner, Card, Button } from '../Shared'
import CoverageRail from '../CoverageRail'
import FieldRow from '../FieldRow'
import SuggestionsTray from '../SuggestionsTray'

// SC Discovery Notes — the catalog workspace: CoverageRail (display_section
// groups) + readiness gate banner with named blockers + one section of
// FieldRows at a time + the generated Business Drivers summary. Both AE and
// SC edit (FieldRow attributes the write).
const GRADE = {
  ready: { label: 'Ready', color: T.success }, nearly_ready: { label: 'Nearly ready', color: '#84cc16' },
  gaps: { label: 'Gaps', color: T.warning }, blocked: { label: 'Blocked', color: T.error },
}

export default function SCDiscoveryNotes({ deal, readiness, onReadinessChange }) {
  const [loading, setLoading] = useState(true)
  const [defs, setDefs] = useState([])
  const [flat, setFlat] = useState(new Map())
  const [blockers, setBlockers] = useState([])
  const [drivers, setDrivers] = useState(null)
  const [suggestions, setSuggestions] = useState(new Set())
  const [active, setActive] = useState(null)

  useEffect(() => { load() }, [deal?.id])

  async function load() {
    setLoading(true)
    try {
      const [defRes, flatRes, riskRes, daRes, sugRes] = await Promise.all([
        supabase.from('custom_field_definitions')
          .select('id, org_id, field_key, field_label, field_type, display_section, ai_context, extraction_instructions, storage_target, sort_order')
          .eq('entity_type', 'deal').eq('is_active', true).or(`org_id.eq.${deal.org_id},org_id.is.null`).order('sort_order'),
        supabase.from('deal_field_values_flat').select('*').eq('deal_id', deal.id),
        supabase.from('deal_risks').select('risk_key, risk_description, severity, status').eq('deal_id', deal.id).eq('status', 'open'),
        supabase.from('deal_analysis').select('driving_factors').eq('deal_id', deal.id).maybeSingle(),
        supabase.from('field_suggestions').select('field_key').eq('deal_id', deal.id).eq('suggestion_kind', 'value_update').eq('status', 'open'),
      ])
      // Org definitions override template rows on the same field_key.
      const byKey = new Map()
      for (const d of (defRes.data || [])) {
        const prior = byKey.get(d.field_key)
        if (!prior || (prior.org_id === null && d.org_id !== null)) byKey.set(d.field_key, d)
      }
      setDefs(Array.from(byKey.values()))
      setFlat(new Map((flatRes.data || []).map(r => [r.field_key, r])))
      setDrivers(daRes.data?.driving_factors || null)
      setSuggestions(new Set((sugRes.data || []).map(s => s.field_key)))

      // Named blockers: open risks resolved to plain names from the taxonomy.
      const risks = riskRes.data || []
      if (risks.length) {
        const keys = [...new Set(risks.map(r => r.risk_key).filter(Boolean))]
        let names = {}
        if (keys.length) {
          const { data: rd } = await supabase.from('risk_definitions').select('risk_key, plain_name').in('risk_key', keys)
          names = Object.fromEntries((rd || []).map(r => [r.risk_key, r.plain_name]))
        }
        setBlockers(risks.filter(r => r.severity === 'critical' || r.severity === 'high')
          .map(r => ({ severity: r.severity, name: (r.risk_key && names[r.risk_key]) || r.risk_description })))
      } else setBlockers([])
    } catch (e) { console.error('[SCDiscoveryNotes] load', e) } finally { setLoading(false) }
  }

  const sections = useMemo(() => {
    const by = new Map()
    for (const d of defs) {
      const sec = d.display_section || 'Other'
      const arr = by.get(sec) || []
      arr.push(d); by.set(sec, arr)
    }
    return Array.from(by.entries()).map(([key, list]) => {
      const answered = list.filter(d => {
        const v = flat.get(d.field_key)?.value_text
        return v !== null && v !== undefined && String(v).trim() !== ''
      }).length
      return { key, label: key, total: list.length, answered, gated: false, defs: list }
    })
  }, [defs, flat])

  useEffect(() => {
    if (!active && sections.length) {
      // Open the first section that has gaps, else the first.
      const firstGap = sections.find(s => s.answered < s.total)
      setActive((firstGap || sections[0]).key)
    }
  }, [sections, active])

  if (loading) return <Spinner />
  const activeSection = sections.find(s => s.key === active) || sections[0]
  const gm = readiness ? (GRADE[readiness.readiness_grade] || { label: readiness.readiness_grade ? String(readiness.readiness_grade).replace(/_/g, ' ') : 'In progress', color: T.textMuted }) : null

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <CoverageRail sections={sections} activeSection={active} onJump={setActive} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Readiness gate */}
        {readiness && (
          <div style={{ background: T.surface, border: `1px solid ${gm.color}50`, borderLeft: `4px solid ${gm.color}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: gm.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Demo readiness: {gm.label}</span>
              <span style={{ fontSize: 12, color: T.textSecondary }}>Coverage {readiness.coverage_pct ?? 0}%</span>
            </div>
            {blockers.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {blockers.map((b, i) => (
                  <li key={i} style={{ fontSize: 12, color: T.text }}>
                    <span style={{ fontWeight: 600, color: b.severity === 'critical' ? T.error : T.warning }}>{b.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <SuggestionsTray dealId={deal.id} onChanged={() => { load(); onReadinessChange?.() }} />

        {/* Business Drivers */}
        {drivers && drivers.toLowerCase() !== 'unknown' && (
          <Card title="Business Drivers" style={{ marginBottom: 16 }}
            action={<Button onClick={load} style={{ padding: '3px 10px', fontSize: 11 }}>Refresh</Button>}>
            <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{drivers}</div>
          </Card>
        )}

        {/* Active section's fields */}
        {activeSection && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.borderLight}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{activeSection.label}</span>
              <span style={{ fontSize: 12, color: T.textMuted }}>{activeSection.answered}/{activeSection.total} answered</span>
            </div>
            <div>
              {activeSection.defs.map(def => (
                <FieldRow key={def.field_key}
                  field={flat.get(def.field_key) || { field_key: def.field_key, label: def.field_label }}
                  definition={def} dealId={deal.id} orgId={deal.org_id}
                  hasSuggestion={suggestions.has(def.field_key)}
                  onSaved={() => { load(); onReadinessChange?.() }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
