import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle } from '../components/Shared'
import ProvenanceChip from '../components/ProvenanceChip'
import SuggestionsTray from '../components/SuggestionsTray'

// SC / Opportunity Discovery page (extraction overhaul Phase 7).
// The shared work surface for the 94-field catalog: sections in workbook
// order, per-section coverage, per-field question + value + provenance +
// inline edit (manual edits lock the field), Business Drivers summary,
// module recommendations, and the demo-readiness gate with named blockers.
// NO hypotheses here — this surface feeds handoffs and must stay facts-only.

const SIZING_COL = {
  entity_count: 'entity_count', total_users: 'full_users',
  reporting_readonly_users: 'view_only_users', bills_per_period: 'ap_invoices_monthly',
  fixed_asset_count: 'fixed_assets', warehouse_count: 'warehouse_count',
}

export default function DiscoveryPage() {
  const { dealId } = useParams()
  const { profile } = useAuth()
  const [deal, setDeal] = useState(null)
  const [defs, setDefs] = useState([])
  const [values, setValues] = useState(new Map())
  const [sizing, setSizing] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [modules, setModules] = useState([])
  const [moduleRef, setModuleRef] = useState([])
  const [loading, setLoading] = useState(true)
  const [savedFlash, setSavedFlash] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [{ data: d }, defsR, valsR, sizR, anaR, readyR, modR, mrefR] = await Promise.all([
        supabase.from('deals').select('id, org_id, company_name, stage').eq('id', dealId).single(),
        supabase.from('custom_field_definitions')
          .select('id, org_id, field_key, field_label, field_type, display_section, ai_context, storage_target, sort_order')
          .eq('entity_type', 'deal').eq('is_active', true).order('sort_order'),
        supabase.from('custom_field_values').select('*').eq('entity_type', 'deal').eq('entity_id', dealId),
        supabase.from('deal_sizing').select('*').eq('deal_id', dealId).maybeSingle(),
        supabase.from('deal_analysis').select('id, driving_factors, ideal_solution').eq('deal_id', dealId).maybeSingle(),
        supabase.rpc('get_handoff_readiness', { p_deal_id: dealId }),
        supabase.from('deal_modules').select('*').eq('deal_id', dealId),
        supabase.from('module_reference').select('*').eq('active', true).order('sort_order'),
      ])
      setDeal(d)
      // Org definitions override template rows on the same key.
      const byKey = new Map()
      for (const def of (defsR.data || [])) {
        const prior = byKey.get(def.field_key)
        if (!prior || (prior.org_id === null && def.org_id !== null)) byKey.set(def.field_key, def)
      }
      setDefs(Array.from(byKey.values()))
      setValues(new Map((valsR.data || []).map(v => [v.field_key, v])))
      setSizing(sizR.data || null)
      setAnalysis(anaR.data || null)
      setReadiness(readyR.data || null)
      setModules(modR.data || [])
      setModuleRef(mrefR.data || [])
    } catch (e) { console.error('[Discovery] load:', e) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [dealId])

  const readField = (def) => {
    if (def.storage_target?.startsWith('deal_sizing.')) {
      const col = def.storage_target.split('.')[1]
      const meta = sizing?.sources?.[col] || {}
      return { value: sizing?.[col] ?? null, prov: meta.source ? { source: meta.source, quote: meta.quote, speaker: meta.speaker, conversation_id: meta.conversation_id, source_url: meta.source_url, observed_at: meta.observed_at } : null, locked: meta.source === 'manual' }
    }
    const v = values.get(def.field_key)
    if (!v) return { value: null, prov: null, locked: false }
    const value = v.value_number ?? v.value_boolean ?? v.value_json ?? v.value_text
    return {
      value,
      prov: { source: v.source, quote: v.extraction_quote, speaker: v.extraction_speaker, conversation_id: v.source_conversation_id, observed_at: v.observed_at },
      locked: !!v.is_manual_locked || v.source === 'manual',
    }
  }

  // Inline manual edit: writes the value as manual + locked (the permanent tier).
  async function saveField(def, rawInput) {
    try {
      if (def.storage_target?.startsWith('deal_sizing.')) {
        const col = def.storage_target.split('.')[1]
        const num = Number(rawInput)
        if (!isFinite(num)) return
        let row = sizing
        if (!row) {
          const { data } = await supabase.from('deal_sizing').insert({ deal_id: dealId }).select('*').single()
          row = data
        }
        const sources = { ...(row.sources || {}), [col]: { source: 'manual', observed_at: new Date().toISOString(), changed_by: profile?.id } }
        await supabase.from('deal_sizing').update({ [col]: num, sources }).eq('id', row.id)
      } else {
        const existing = values.get(def.field_key)
        const cols = def.field_type === 'number'
          ? { value_number: Number(rawInput), value_text: null }
          : def.field_type === 'boolean'
            ? { value_boolean: rawInput === 'true' || rawInput === true, value_text: null }
            : def.field_type === 'multiselect'
              ? { value_json: String(rawInput).split(',').map(s => s.trim()).filter(Boolean), value_text: null }
              : { value_text: String(rawInput) }
        if (existing) {
          await supabase.from('custom_field_values').update({
            ...cols, source: 'manual', is_manual_locked: true, changed_by: profile?.id, observed_at: new Date().toISOString(),
          }).eq('id', existing.id)
        } else {
          await supabase.from('custom_field_values').insert({
            org_id: deal.org_id, field_definition_id: def.id, entity_type: 'deal', entity_id: dealId,
            field_key: def.field_key, ...cols, source: 'manual', is_manual_locked: true,
            changed_by: profile?.id, observed_at: new Date().toISOString(),
          })
        }
      }
      setSavedFlash(def.field_key)
      setTimeout(() => setSavedFlash(null), 1200)
      await load()
    } catch (e) {
      console.error('[Discovery] save:', e)
      alert(`Save failed: ${e?.message || e}`)
    }
  }

  async function toggleModule(ref, patch) {
    try {
      const existing = modules.find(m => m.module_key === ref.module_key)
      if (existing) {
        await supabase.from('deal_modules').update(patch).eq('id', existing.id)
      } else {
        await supabase.from('deal_modules').insert({
          org_id: deal.org_id, deal_id: dealId, module_key: ref.module_key,
          created_by: profile?.id, ...patch,
        })
      }
      await load()
    } catch (e) { console.error('[Discovery] module toggle:', e) }
  }

  const sections = useMemo(() => {
    const by = new Map()
    for (const def of defs) {
      const arr = by.get(def.display_section) || []
      arr.push(def)
      by.set(def.display_section, arr)
    }
    return Array.from(by.entries())
  }, [defs])

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, color: T.textMuted }}>Deal not found</div>

  const READY_COLORS = { ready: T.success, nearly_ready: '#84cc16', gaps: T.warning, blocked: T.error }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.text }}>Discovery — {deal.company_name}</h1>
        <Badge color={T.primary}>{deal.stage}</Badge>
        <div style={{ flex: 1 }} />
        <Link to={`/deal/${dealId}`} style={{ fontSize: 12, color: T.primary, fontWeight: 600 }}>Back to deal</Link>
      </div>
      <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 16 }}>
        Shared AE / SC surface. Every value carries its evidence; typing a value here marks it manual and locks it against automated overwrites.
      </div>

      {/* Readiness gate */}
      {readiness && (
        <div style={{ background: T.surface, border: `1px solid ${(READY_COLORS[readiness.grade] || T.border)}50`, borderLeft: `4px solid ${READY_COLORS[readiness.grade] || T.border}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: READY_COLORS[readiness.grade] || T.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Demo readiness: {String(readiness.grade || '').replace('_', ' ')}
            </span>
            <span style={{ fontSize: 12, color: T.textSecondary }}>Catalog coverage {readiness.coverage_pct}%</span>
          </div>
          {Array.isArray(readiness.blockers) && readiness.blockers.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {readiness.blockers.map((b, i) => <li key={i} style={{ fontSize: 12, color: T.text }}>{b}</li>)}
            </ul>
          )}
        </div>
      )}

      <SuggestionsTray dealId={dealId} onChanged={load} />

      {/* Business Drivers — generated summary over verified facts */}
      {analysis?.driving_factors && analysis.driving_factors.toLowerCase() !== 'unknown' && (
        <Card title="Business Drivers" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{analysis.driving_factors}</div>
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6 }}>
            Synthesized from verified catalysts and compelling events. Refresh suggestions appear in the tray above after new discovery calls.
          </div>
        </Card>
      )}

      {/* Modules */}
      <Card title="Modules" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
          {moduleRef.map(ref => {
            const m = modules.find(x => x.module_key === ref.module_key)
            return (
              <div key={ref.module_key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1px solid ${T.borderLight}`, borderRadius: 6, background: m?.is_recommended ? T.primaryLight : T.surface }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{ref.name}</div>
                  {m?.suggested_by_ai && !m?.is_recommended && <div style={{ fontSize: 10, color: T.warning }}>AI suggested — confirm</div>}
                </div>
                <label style={{ fontSize: 10, color: T.textSecondary, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!m?.is_recommended} onChange={e => toggleModule(ref, { is_recommended: e.target.checked, suggested_by_ai: m?.suggested_by_ai || false })} />
                  Rec
                </label>
                <label style={{ fontSize: 10, color: T.textSecondary, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!m?.is_demoed} onChange={e => toggleModule(ref, { is_demoed: e.target.checked })} />
                  Demoed
                </label>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Catalog sections */}
      {sections.map(([section, sectionDefs]) => {
        const answered = sectionDefs.filter(d => {
          const { value } = readField(d)
          return value !== null && value !== undefined && value !== ''
        }).length
        return (
          <SectionBlock key={section} title={section} answered={answered} total={sectionDefs.length}>
            {sectionDefs.map(def => {
              const { value, prov, locked } = readField(def)
              const has = value !== null && value !== undefined && value !== ''
              return (
                <div key={def.field_key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.borderLight}` }}>
                  <div style={{ flex: '0 0 44%', minWidth: 260 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{def.field_label}</div>
                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1 }}>{def.field_key}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <InlineValue def={def} value={value} onSave={(v) => saveField(def, v)} />
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                      {has ? (
                        <>
                          {prov && <ProvenanceChip dealId={dealId} provenance={prov} />}
                          {locked && <span style={{ fontSize: 9, color: '#7c3aed', fontWeight: 700 }}>LOCKED</span>}
                          {savedFlash === def.field_key && <span style={{ fontSize: 10, color: T.success, fontWeight: 700 }}>Saved</span>}
                        </>
                      ) : (
                        <span style={{ fontSize: 10, color: T.textMuted }}>Unknown{savedFlash === def.field_key ? ' · Saved' : ''}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </SectionBlock>
        )
      })}
    </div>
  )
}

function SectionBlock({ title, answered, total, children }) {
  const [open, setOpen] = useState(answered > 0)
  const pct = total ? Math.round((answered / total) * 100) : 0
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{title}</span>
        <span style={{ fontSize: 11, color: T.textSecondary }}>{answered}/{total}</span>
        <div style={{ flex: 1, height: 4, background: T.borderLight, borderRadius: 2, maxWidth: 160 }}>
          <div style={{ width: `${pct}%`, height: 4, background: pct >= 70 ? T.success : pct >= 30 ? T.warning : T.error, borderRadius: 2 }} />
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: T.textMuted }}>{open ? 'Hide' : 'Show'}</span>
      </div>
      {open && <div style={{ padding: '0 16px 10px' }}>{children}</div>}
    </div>
  )
}

function InlineValue({ def, value, onSave }) {
  const display = value === null || value === undefined || value === ''
    ? ''
    : Array.isArray(value) ? value.join(', ') : String(value)
  if (def.field_type === 'boolean') {
    return (
      <select defaultValue={display} onChange={e => e.target.value !== display && onSave(e.target.value)}
        style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, width: 120, cursor: 'pointer' }}>
        <option value="">Unknown</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  return (
    <input
      type={def.field_type === 'number' ? 'number' : 'text'}
      defaultValue={display}
      placeholder="Unknown — type to set manually"
      onBlur={e => { const v = e.target.value.trim(); if (v !== display && v !== '') onSave(v) }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }}
    />
  )
}
