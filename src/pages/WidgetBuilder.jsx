import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'
import { TABLES, SECTION_TYPES, FORMAT_TYPES, OPERATORS, CLICK_ACTIONS, AGGREGATES } from '../lib/widgetSchema'
import WidgetFieldPicker from '../components/WidgetFieldPicker'
import WidgetRenderer from '../components/WidgetRenderer'

function genId() { return 'f_' + Math.random().toString(36).slice(2, 10) }

const PRESETS = [
  {
    name: 'Contact List', description: 'Key contacts for the deal', widget_type: 'deal',
    sections: [{ type: 'table', layout: 'vertical', data_source: { base_table: 'contacts', fields: [
      { id: genId(), table: 'contacts', field: 'name', label: 'Name', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'contacts', field: 'title', label: 'Title', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'contacts', field: 'role_in_deal', label: 'Role', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'contacts', field: 'influence_level', label: 'Influence', type: 'badge', format: { type: 'badge' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
    ], filters: [], ordering: [] }, conditional_rules: [] }],
  },
  {
    name: 'Pain Points', description: 'Discovered pain points with dollar impact', widget_type: 'deal',
    sections: [{ type: 'table', layout: 'vertical', data_source: { base_table: 'deal_pain_points', fields: [
      { id: genId(), table: 'deal_pain_points', field: 'pain_description', label: 'Pain', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_pain_points', field: 'category', label: 'Category', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_pain_points', field: 'annual_cost', label: 'Annual Cost', type: 'currency', format: { type: 'currency' }, sortable: true, aggregate: 'sum', click_action: { type: 'none' } },
    ], filters: [], ordering: [] }, conditional_rules: [] }],
  },
  {
    name: 'Risk Tracker', description: 'Deal risks with severity and status', widget_type: 'deal',
    sections: [{ type: 'list', layout: 'vertical', data_source: { base_table: 'deal_risks', fields: [
      { id: genId(), table: 'deal_risks', field: 'risk_description', label: 'Risk', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_risks', field: 'severity', label: 'Severity', type: 'badge', format: { type: 'badge' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_risks', field: 'status', label: 'Status', type: 'badge', format: { type: 'badge' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
    ], filters: [], ordering: [] }, conditional_rules: [] }],
  },
  {
    name: 'Competitor Grid', description: 'Competitive landscape comparison', widget_type: 'deal',
    sections: [{ type: 'grid', layout: { columns: 2 }, data_source: { base_table: 'deal_competitors', fields: [
      { id: genId(), table: 'deal_competitors', field: 'competitor_name', label: 'Competitor', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_competitors', field: 'strengths', label: 'Strengths', type: 'text', format: { type: 'text' }, sortable: false, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_competitors', field: 'weaknesses', label: 'Weaknesses', type: 'text', format: { type: 'text' }, sortable: false, aggregate: 'none', click_action: { type: 'none' } },
    ], filters: [], ordering: [] }, conditional_rules: [] }],
  },
]

export default function WidgetBuilder() {
  const { profile } = useAuth()
  const [widgets, setWidgets] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // widget id or 'new'
  const [showFieldPicker, setShowFieldPicker] = useState(null) // section index
  const [showJson, setShowJson] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [previewDealId, setPreviewDealId] = useState(null)
  const [previewDeals, setPreviewDeals] = useState([])

  // Builder form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [widgetType, setWidgetType] = useState('deal')
  const [defaultW, setDefaultW] = useState(6)
  const [defaultH, setDefaultH] = useState(4)
  const [sections, setSections] = useState([])

  useEffect(() => { loadWidgets() }, [])

  async function loadWidgets() {
    setLoading(true)
    const [{ data }, { data: deals }] = await Promise.all([
      supabase.from('custom_widget_definitions').select('*').eq('org_id', profile.org_id).order('sort_order'),
      supabase.from('deals').select('id, company_name').order('created_at', { ascending: false }).limit(10),
    ])
    setWidgets(data || [])
    setPreviewDeals(deals || [])
    if (deals?.length) setPreviewDealId(deals[0].id)
    setLoading(false)
  }

  function startNew() {
    setShowPresets(true)
  }

  function startFromPreset(preset) {
    setShowPresets(false)
    setEditing('new')
    setName(preset ? preset.name : '')
    setDescription(preset ? preset.description : '')
    setWidgetType(preset ? preset.widget_type : 'deal')
    setDefaultW(6)
    setDefaultH(4)
    setSections(preset ? JSON.parse(JSON.stringify(preset.sections)) : [{ type: 'table', layout: 'vertical', data_source: { base_table: 'deals', fields: [], filters: [], ordering: [] }, conditional_rules: [] }])
  }

  function startEdit(w) {
    setEditing(w.id)
    setName(w.name)
    setDescription(w.description || '')
    setWidgetType(w.widget_type)
    setDefaultW(w.default_w || 6)
    setDefaultH(w.default_h || 4)
    setSections(w.config?.sections || [])
  }

  async function save() {
    const config = { name, widget_type: widgetType, sections }
    const record = {
      org_id: profile.org_id, created_by: profile.id, name, description,
      widget_type: widgetType, default_w: defaultW, default_h: defaultH,
      min_w: 2, min_h: 1, config, active: true,
    }
    if (editing === 'new') {
      await supabase.from('custom_widget_definitions').insert(record)
    } else {
      await supabase.from('custom_widget_definitions').update(record).eq('id', editing)
    }
    setEditing(null)
    loadWidgets()
  }

  async function deleteWidget(id) {
    if (!window.confirm('Delete this custom widget?')) return
    await supabase.from('custom_widget_definitions').delete().eq('id', id)
    loadWidgets()
  }

  function addSection() {
    setSections(prev => [...prev, { type: 'table', layout: 'vertical', data_source: { base_table: 'deals', fields: [], filters: [], ordering: [] }, conditional_rules: [] }])
  }

  function updateSection(idx, updates) {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s))
  }

  function removeSection(idx) {
    setSections(prev => prev.filter((_, i) => i !== idx))
  }

  function addField(sectionIdx, fieldInfo) {
    setSections(prev => prev.map((s, i) => {
      if (i !== sectionIdx) return s
      const newField = { id: genId(), table: fieldInfo.table, field: fieldInfo.field, label: fieldInfo.label, type: fieldInfo.type, format: { type: fieldInfo.type }, sortable: true, aggregate: 'none', click_action: { type: 'none' } }
      return { ...s, data_source: { ...s.data_source, fields: [...s.data_source.fields, newField] } }
    }))
    setShowFieldPicker(null)
  }

  function updateField(sectionIdx, fieldIdx, updates) {
    setSections(prev => prev.map((s, i) => {
      if (i !== sectionIdx) return s
      const fields = s.data_source.fields.map((f, j) => j === fieldIdx ? { ...f, ...updates } : f)
      return { ...s, data_source: { ...s.data_source, fields } }
    }))
  }

  function removeField(sectionIdx, fieldIdx) {
    setSections(prev => prev.map((s, i) => {
      if (i !== sectionIdx) return s
      return { ...s, data_source: { ...s.data_source, fields: s.data_source.fields.filter((_, j) => j !== fieldIdx) } }
    }))
  }

  function moveField(sectionIdx, fieldIdx, dir) {
    setSections(prev => prev.map((s, i) => {
      if (i !== sectionIdx) return s
      const f = [...s.data_source.fields]
      const j = fieldIdx + dir
      if (j < 0 || j >= f.length) return s;
      [f[fieldIdx], f[j]] = [f[j], f[fieldIdx]]
      return { ...s, data_source: { ...s.data_source, fields: f } }
    }))
  }

  function addFilter(sectionIdx) {
    setSections(prev => prev.map((s, i) => {
      if (i !== sectionIdx) return s
      return { ...s, data_source: { ...s.data_source, filters: [...(s.data_source.filters || []), { field: '', operator: 'equals', value: '' }] } }
    }))
  }

  function updateFilter(sectionIdx, filterIdx, updates) {
    setSections(prev => prev.map((s, i) => {
      if (i !== sectionIdx) return s
      const filters = (s.data_source.filters || []).map((f, j) => j === filterIdx ? { ...f, ...updates } : f)
      return { ...s, data_source: { ...s.data_source, filters } }
    }))
  }

  function removeFilter(sectionIdx, filterIdx) {
    setSections(prev => prev.map((s, i) => {
      if (i !== sectionIdx) return s
      return { ...s, data_source: { ...s.data_source, filters: s.data_source.filters.filter((_, j) => j !== filterIdx) } }
    }))
  }

  function addConditionalRule(sectionIdx) {
    setSections(prev => prev.map((s, i) => {
      if (i !== sectionIdx) return s
      return { ...s, conditional_rules: [...(s.conditional_rules || []), { scope: 'cell', target_field: '', conditions: [{ field: '', operator: 'is_unknown', value: '' }], style: { color: '#dc3545' } }] }
    }))
  }

  const buildConfig = () => ({ name, widget_type: widgetType, sections })

  if (loading) return <Spinner />

  // === PRESET PICKER MODAL ===
  if (showPresets) return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setShowPresets(false)} style={{ background: T.surfaceAlt, border: '1px solid ' + T.border, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Back</button>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Choose a Starting Point</h2>
        </div>
      </div>
      <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        <div onClick={() => startFromPreset(null)} style={{ padding: 20, background: T.surface, border: '2px dashed ' + T.border, borderRadius: T.radius, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 20, color: T.textMuted, marginBottom: 8 }}>+</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Blank Widget</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Start from scratch</div>
        </div>
        {PRESETS.map((p, i) => (
          <div key={i} onClick={() => startFromPreset(p)} style={{ padding: 20, background: T.surface, border: '1px solid ' + T.border, borderRadius: T.radius, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{p.name}</div>
              <Badge color={T.primary}>{p.sections[0].type}</Badge>
            </div>
            <div style={{ fontSize: 11, color: T.textMuted }}>{p.description}</div>
            <div style={{ fontSize: 10, color: T.textSecondary, marginTop: 6 }}>{p.sections[0].data_source.fields.length} fields from {TABLES[p.sections[0].data_source.base_table]?.label || p.sections[0].data_source.base_table}</div>
          </div>
        ))}
      </div>
    </div>
  )

  // === LIST VIEW ===
  if (!editing) return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Custom Widgets</h2>
        <Button primary onClick={startNew}>+ New Widget</Button>
      </div>
      <div style={{ padding: '16px 24px' }}>
        {widgets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: T.textMuted }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>No custom widgets yet</div>
            <div style={{ fontSize: 12 }}>Create widgets that pull data from any table and display it however you want.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {widgets.map(w => (
              <Card key={w.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{w.name}</div>
                    {w.description && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{w.description}</div>}
                  </div>
                  <Badge color={w.widget_type === 'pipeline' ? T.primary : T.success}>{w.widget_type}</Badge>
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 10, color: T.textMuted, marginBottom: 8 }}>
                  <span>{w.config?.sections?.length || 0} section{(w.config?.sections?.length || 0) !== 1 ? 's' : ''}</span>
                  <span>{'\u2022'}</span>
                  <span>{w.default_w}x{w.default_h} grid</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button onClick={() => startEdit(w)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
                  <Button onClick={() => deleteWidget(w.id)} style={{ padding: '4px 10px', fontSize: 11, color: T.error }}>Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  // === BUILDER VIEW ===
  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setEditing(null)} style={{ background: T.surfaceAlt, border: '1px solid ' + T.border, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Back</button>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>{editing === 'new' ? 'New Widget' : 'Edit Widget'}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => setShowJson(!showJson)} style={{ padding: '6px 12px', fontSize: 11 }}>{showJson ? 'Hide JSON' : 'Show JSON'}</Button>
          <Button primary onClick={save} disabled={!name.trim()}>Save Widget</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, padding: '16px 24px', alignItems: 'flex-start' }}>
        {/* LEFT: Builder form */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Basics */}
          <Card title="Widget Basics">
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
              <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="My Widget" /></div>
              <div><label style={labelStyle}>Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={widgetType} onChange={e => setWidgetType(e.target.value)}><option value="deal">Deal</option><option value="pipeline">Pipeline</option></select></div>
              <div><label style={labelStyle}>Width</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={defaultW} onChange={e => setDefaultW(Number(e.target.value))}>{[3,4,5,6,7,8,9,10,11,12].map(n => <option key={n} value={n}>{n} cols</option>)}</select></div>
              <div><label style={labelStyle}>Height</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={defaultH} onChange={e => setDefaultH(Number(e.target.value))}>{[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} rows</option>)}</select></div>
            </div>
            <div style={{ marginTop: 8 }}><label style={labelStyle}>Description</label><input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="What this widget shows..." /></div>
          </Card>

          {/* Sections */}
          {sections.map((section, si) => (
            <Card key={si} title={`Section ${si + 1}: ${section.type}`} action={
              <div style={{ display: 'flex', gap: 4 }}>
                <Button onClick={() => removeSection(si)} style={{ padding: '3px 8px', fontSize: 10, color: T.error }}>Remove</Button>
              </div>
            }>
              {/* Section type + layout */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <div><label style={labelStyle}>Section Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={section.type} onChange={e => updateSection(si, { type: e.target.value })}>{SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><label style={labelStyle}>Base Table</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={section.data_source.base_table} onChange={e => updateSection(si, { data_source: { ...section.data_source, base_table: e.target.value } })}>{Object.entries(TABLES).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}</select></div>
                {(section.type === 'grid' || section.type === 'card') && (
                  <div><label style={labelStyle}>Columns</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={section.layout?.columns || 2} onChange={e => updateSection(si, { layout: { ...section.layout, columns: Number(e.target.value) } })}>{[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                )}
              </div>

              {/* Fields */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={labelStyle}>Fields ({section.data_source.fields.length})</label>
                  <Button onClick={() => setShowFieldPicker(si)} style={{ padding: '3px 10px', fontSize: 10 }}>+ Add Field</Button>
                </div>
                {section.data_source.fields.map((f, fi) => (
                  <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', background: T.surfaceAlt, borderRadius: 4, marginBottom: 3, border: '1px solid ' + T.borderLight }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ cursor: 'pointer', fontSize: 10, color: T.textMuted, lineHeight: 1 }} onClick={() => moveField(si, fi, -1)}>{'\u25B2'}</span>
                      <span style={{ cursor: 'pointer', fontSize: 10, color: T.textMuted, lineHeight: 1 }} onClick={() => moveField(si, fi, 1)}>{'\u25BC'}</span>
                    </div>
                    <input style={{ ...inputStyle, padding: '3px 6px', fontSize: 11, width: 100 }} value={f.label} onChange={e => updateField(si, fi, { label: e.target.value })} />
                    <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono }}>{f.table}.{f.field}</span>
                    <select style={{ ...inputStyle, padding: '2px 4px', fontSize: 10, width: 80, cursor: 'pointer' }} value={f.format?.type || f.type} onChange={e => updateField(si, fi, { format: { type: e.target.value } })}>{FORMAT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
                    {section.type === 'metric' && (
                      <select style={{ ...inputStyle, padding: '2px 4px', fontSize: 10, width: 60, cursor: 'pointer' }} value={f.aggregate || 'none'} onChange={e => updateField(si, fi, { aggregate: e.target.value })}>{AGGREGATES.map(a => <option key={a} value={a}>{a}</option>)}</select>
                    )}
                    <select style={{ ...inputStyle, padding: '2px 4px', fontSize: 10, width: 90, cursor: 'pointer' }} value={f.click_action?.type || 'none'} onChange={e => updateField(si, fi, { click_action: { type: e.target.value } })}>{CLICK_ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</select>
                    <span style={{ cursor: 'pointer', color: T.textMuted, fontSize: 14 }} onClick={() => removeField(si, fi)}>&times;</span>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={labelStyle}>Filters</label>
                  <Button onClick={() => addFilter(si)} style={{ padding: '2px 8px', fontSize: 10 }}>+ Filter</Button>
                </div>
                {(section.data_source.filters || []).map((filter, fi) => (
                  <div key={fi} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                    <input style={{ ...inputStyle, padding: '3px 6px', fontSize: 10, flex: 1 }} value={filter.field} onChange={e => updateFilter(si, fi, { field: e.target.value })} placeholder="table.field" />
                    <select style={{ ...inputStyle, padding: '2px 4px', fontSize: 10, width: 100, cursor: 'pointer' }} value={filter.operator} onChange={e => updateFilter(si, fi, { operator: e.target.value })}>{OPERATORS.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</select>
                    <input style={{ ...inputStyle, padding: '3px 6px', fontSize: 10, flex: 1 }} value={filter.value || ''} onChange={e => updateFilter(si, fi, { value: e.target.value })} placeholder="value" />
                    <span style={{ cursor: 'pointer', color: T.textMuted, fontSize: 14 }} onClick={() => removeFilter(si, fi)}>&times;</span>
                  </div>
                ))}
              </div>

              {/* Conditional formatting */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={labelStyle}>Conditional Formatting</label>
                  <Button onClick={() => addConditionalRule(si)} style={{ padding: '2px 8px', fontSize: 10 }}>+ Rule</Button>
                </div>
                {(section.conditional_rules || []).map((rule, ri) => (
                  <div key={ri} style={{ padding: 6, background: T.surfaceAlt, borderRadius: 4, marginBottom: 3, fontSize: 10 }}>
                    <span style={{ color: T.textMuted }}>If </span>
                    <span style={{ fontFamily: T.mono }}>{rule.conditions?.[0]?.field || '?'} {rule.conditions?.[0]?.operator || '?'}</span>
                    <span style={{ color: T.textMuted }}> then </span>
                    <span style={{ fontWeight: 700, color: rule.style?.color || T.text }}>color: {rule.style?.color}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}

          <Button onClick={addSection} style={{ width: '100%', justifyContent: 'center', padding: '10px', marginBottom: 16 }}>+ Add Section</Button>
        </div>

        {/* RIGHT: Preview + JSON */}
        <div style={{ width: 400, flexShrink: 0 }}>
          <Card title="Live Preview">
            {widgetType === 'deal' && previewDeals.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Preview Deal</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={previewDealId || ''} onChange={e => setPreviewDealId(e.target.value)}>
                  {previewDeals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
                </select>
              </div>
            )}
            <div style={{ minHeight: 100 }}>
              {sections.length > 0 && sections[0].data_source.fields.length > 0 ? (
                <WidgetRenderer config={buildConfig()} context={{ deal_id: previewDealId, user_id: profile.id }} />
              ) : (
                <div style={{ textAlign: 'center', padding: 20, color: T.textMuted, fontSize: 12 }}>Add fields to see a preview</div>
              )}
            </div>
          </Card>
          {showJson && (
            <Card title="Config JSON">
              <pre style={{ fontSize: 10, fontFamily: T.mono, background: T.surfaceAlt, padding: 10, borderRadius: 6, overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(buildConfig(), null, 2)}
              </pre>
              <Button onClick={() => navigator.clipboard.writeText(JSON.stringify(buildConfig(), null, 2))} style={{ marginTop: 6, padding: '4px 10px', fontSize: 10 }}>Copy JSON</Button>
            </Card>
          )}
        </div>
      </div>

      {showFieldPicker != null && <WidgetFieldPicker onSelect={f => addField(showFieldPicker, f)} onClose={() => setShowFieldPicker(null)} />}
    </div>
  )
}
