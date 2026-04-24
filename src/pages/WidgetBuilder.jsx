import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'
import { TABLES, SECTION_TYPES, FORMAT_TYPES, OPERATORS, CLICK_ACTIONS, AGGREGATES } from '../lib/widgetSchema'
import WidgetRenderer from '../components/WidgetRenderer'

const genId = () => 'f_' + Math.random().toString(36).slice(2, 10)

const SCOPES = [
  { key: 'deal', label: 'Deal' },
  { key: 'rep', label: 'Rep' },
  { key: 'team', label: 'Team' },
  { key: 'territory', label: 'Territory' },
  { key: 'industry', label: 'Industry / Vertical' },
  { key: 'org', label: 'Org' },
]

const DRAG_MIME = 'application/x-dealcoach-widget-field'

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
    name: 'Pipeline Table', description: 'All active deals with score', widget_type: 'pipeline',
    sections: [{ type: 'table', layout: 'vertical', data_source: { base_table: 'deals', fields: [
      { id: genId(), table: 'deals', field: 'company_name', label: 'Company', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'navigate_deal' } },
      { id: genId(), table: 'deals', field: 'stage', label: 'Stage', type: 'badge', format: { type: 'badge' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deals', field: 'deal_value', label: 'Value', type: 'currency', format: { type: 'currency' }, sortable: true, aggregate: 'sum', click_action: { type: 'none' } },
      { id: genId(), table: 'deals', field: 'deal_health_score', label: 'Score', type: 'score', format: { type: 'score' }, sortable: true, aggregate: 'avg', click_action: { type: 'none' } },
      { id: genId(), table: 'deals', field: 'target_close_date', label: 'Close', type: 'date', format: { type: 'date' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
    ], filters: [], ordering: [{ field: 'deal_health_score', direction: 'desc' }] }, conditional_rules: [] }],
  },
  {
    name: 'Risk Tracker', description: 'Deal risks with severity', widget_type: 'deal',
    sections: [{ type: 'list', layout: 'vertical', data_source: { base_table: 'deal_risks', fields: [
      { id: genId(), table: 'deal_risks', field: 'risk_description', label: 'Risk', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_risks', field: 'severity', label: 'Severity', type: 'badge', format: { type: 'badge' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_risks', field: 'status', label: 'Status', type: 'badge', format: { type: 'badge' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
    ], filters: [], ordering: [] }, conditional_rules: [] }],
  },
  {
    name: 'Competitor Grid', description: 'Competitive landscape', widget_type: 'deal',
    sections: [{ type: 'grid', layout: { columns: 2 }, data_source: { base_table: 'deal_competitors', fields: [
      { id: genId(), table: 'deal_competitors', field: 'competitor_name', label: 'Competitor', type: 'text', format: { type: 'text' }, sortable: true, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_competitors', field: 'strengths', label: 'Strengths', type: 'text', format: { type: 'text' }, sortable: false, aggregate: 'none', click_action: { type: 'none' } },
      { id: genId(), table: 'deal_competitors', field: 'weaknesses', label: 'Weaknesses', type: 'text', format: { type: 'text' }, sortable: false, aggregate: 'none', click_action: { type: 'none' } },
    ], filters: [], ordering: [] }, conditional_rules: [] }],
  },
]

function newSection(baseTable = 'deals') {
  return { type: 'table', layout: 'vertical', data_source: { base_table: baseTable, fields: [], filters: [], ordering: [] }, conditional_rules: [] }
}

function makeField({ table, field, label, type }) {
  return { id: genId(), table, field, label, type, format: { type }, sortable: true, aggregate: 'none', click_action: { type: 'none' } }
}

export default function WidgetBuilder() {
  const { profile } = useAuth()
  const [widgets, setWidgets] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [showPresets, setShowPresets] = useState(false)
  const [previewDealId, setPreviewDealId] = useState(null)
  const [previewDeals, setPreviewDeals] = useState([])
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [widgetType, setWidgetType] = useState('deal')
  const [sections, setSections] = useState([])
  const [headerColor, setHeaderColor] = useState('')
  const [scope, setScope] = useState('org')
  const [selected, setSelected] = useState(null) // { kind: 'field'|'section', sectionIdx, fieldIdx? }
  const [showJson, setShowJson] = useState(false)
  const [fieldSearch, setFieldSearch] = useState('')
  const [expandedTables, setExpandedTables] = useState(new Set())

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

  function showToast(msg, isError = false) {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3500)
  }

  function startNew() { setShowPresets(true) }

  function startFromPreset(preset) {
    setShowPresets(false)
    setEditing('new')
    setName(preset ? preset.name : '')
    setDescription(preset ? preset.description : '')
    setWidgetType(preset ? preset.widget_type : 'deal')
    setHeaderColor('')
    setScope('org')
    setSections(preset ? JSON.parse(JSON.stringify(preset.sections)) : [newSection()])
    setSelected(null)
  }

  function startEdit(w) {
    setShowPresets(false)
    setEditing(w.id)
    setName(w.name)
    setDescription(w.description || '')
    setWidgetType(w.widget_type)
    setHeaderColor(w.config?.header_color || '')
    setScope(w.config?.scope || 'org')
    setSections(w.config?.sections || [])
    setSelected(null)
  }

  async function save() {
    if (!name.trim()) return showToast('Name is required', true)
    setSaving(true)
    const config = { name, widget_type: widgetType, sections, header_color: headerColor || null, scope }
    const record = {
      org_id: profile.org_id, created_by: profile.id, name, description,
      widget_type: widgetType, default_w: 6, default_h: 4, min_w: 2, min_h: 1,
      config, active: true,
    }
    const { error } = editing === 'new'
      ? await supabase.from('custom_widget_definitions').insert(record)
      : await supabase.from('custom_widget_definitions').update(record).eq('id', editing)
    setSaving(false)
    if (error) return showToast('Save failed: ' + error.message, true)
    showToast('Widget saved')
    setEditing(null)
    loadWidgets()
  }

  async function deleteWidget(id) {
    if (!window.confirm('Delete this custom widget?')) return
    const { error } = await supabase.from('custom_widget_definitions').delete().eq('id', id)
    if (error) return showToast('Delete failed: ' + error.message, true)
    showToast('Deleted')
    loadWidgets()
  }

  function cloneWidget(widget) {
    const cloned = {
      org_id: profile.org_id, created_by: profile.id,
      name: widget.name + ' (Copy)', description: widget.description || '',
      widget_type: widget.widget_type,
      default_w: widget.default_w || 6, default_h: widget.default_h || 4,
      min_w: widget.min_w || 2, min_h: widget.min_h || 1,
      config: JSON.parse(JSON.stringify(widget.config)),
      active: true,
    }
    supabase.from('custom_widget_definitions').insert(cloned).select().single()
      .then(({ data, error }) => {
        if (error) return showToast('Clone failed: ' + error.message, true)
        showToast('Cloned')
        loadWidgets()
        if (data) startEdit(data)
      })
  }

  // ── Section mutations ──
  function addSection(base = 'deals') { setSections(prev => [...prev, newSection(base)]) }
  function removeSection(si) {
    if (!window.confirm('Remove this section? Its fields will be lost.')) return
    setSections(prev => prev.filter((_, i) => i !== si))
    setSelected(null)
  }
  function updateSection(si, updates) {
    setSections(prev => prev.map((s, i) => i === si ? { ...s, ...updates } : s))
  }
  function moveSection(si, dir) {
    setSections(prev => {
      const arr = [...prev]; const j = si + dir
      if (j < 0 || j >= arr.length) return prev
      ;[arr[si], arr[j]] = [arr[j], arr[si]]
      return arr
    })
  }

  // ── Field mutations ──
  function addFieldToSection(si, fieldInfo, insertAt = null) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      const f = makeField(fieldInfo)
      const arr = [...s.data_source.fields]
      if (insertAt == null || insertAt > arr.length) arr.push(f)
      else arr.splice(insertAt, 0, f)
      return { ...s, data_source: { ...s.data_source, fields: arr } }
    }))
  }

  function moveField(fromSi, fromFi, toSi, toFi) {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, data_source: { ...s.data_source, fields: [...s.data_source.fields] } }))
      const [moved] = next[fromSi].data_source.fields.splice(fromFi, 1)
      if (!moved) return prev
      const targetArr = next[toSi].data_source.fields
      const insertIdx = Math.min(toFi, targetArr.length)
      targetArr.splice(insertIdx, 0, moved)
      return next
    })
  }

  function updateField(si, fi, updates) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      const fields = s.data_source.fields.map((f, j) => j === fi ? { ...f, ...updates } : f)
      return { ...s, data_source: { ...s.data_source, fields } }
    }))
  }

  function removeField(si, fi) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      return { ...s, data_source: { ...s.data_source, fields: s.data_source.fields.filter((_, j) => j !== fi) } }
    }))
    if (selected?.kind === 'field' && selected.sectionIdx === si && selected.fieldIdx === fi) setSelected(null)
  }

  // ── Filter + conditional mutations ──
  function addFilter(si, fieldInfo = null) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      const filter = fieldInfo
        ? { field: `${fieldInfo.table}.${fieldInfo.field}`, field_type: fieldInfo.type, operator: 'equals', value: '' }
        : { field: '', field_type: 'text', operator: 'equals', value: '' }
      return { ...s, data_source: { ...s.data_source, filters: [...(s.data_source.filters || []), filter] } }
    }))
  }
  function updateFilter(si, fi, updates) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      const filters = (s.data_source.filters || []).map((f, j) => j === fi ? { ...f, ...updates } : f)
      return { ...s, data_source: { ...s.data_source, filters } }
    }))
  }
  function removeFilter(si, fi) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      return { ...s, data_source: { ...s.data_source, filters: s.data_source.filters.filter((_, j) => j !== fi) } }
    }))
  }

  function addConditionalRule(si) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      const firstField = s.data_source.fields[0]
      return {
        ...s,
        conditional_rules: [...(s.conditional_rules || []), {
          scope: 'cell',
          target_field: firstField?.id || '',
          conditions: [{ field: firstField ? `${firstField.table}.${firstField.field}` : '', operator: 'is_unknown', value: '' }],
          style: { color: '#dc3545', fontWeight: 700 },
        }],
      }
    }))
  }
  function updateConditionalRule(si, ri, updates) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      const rules = s.conditional_rules.map((r, j) => j === ri ? { ...r, ...updates } : r)
      return { ...s, conditional_rules: rules }
    }))
  }
  function updateConditionalCond(si, ri, ci, updates) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      const rules = s.conditional_rules.map((r, j) => {
        if (j !== ri) return r
        const conds = (r.conditions || []).map((c, k) => k === ci ? { ...c, ...updates } : c)
        return { ...r, conditions: conds }
      })
      return { ...s, conditional_rules: rules }
    }))
  }
  function removeConditionalRule(si, ri) {
    setSections(prev => prev.map((s, i) => {
      if (i !== si) return s
      return { ...s, conditional_rules: s.conditional_rules.filter((_, j) => j !== ri) }
    }))
  }

  const buildConfig = () => ({ name, widget_type: widgetType, sections, header_color: headerColor || null, scope })

  if (loading) return <Spinner />

  if (showPresets) return (
    <PresetPicker onBack={() => setShowPresets(false)} onPick={startFromPreset} />
  )

  if (!editing) return (
    <ListView
      widgets={widgets}
      onNew={startNew}
      onEdit={startEdit}
      onClone={cloneWidget}
      onDelete={deleteWidget}
      toast={toast}
    />
  )

  // ═══════════════════ BUILDER VIEW ═══════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top bar */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <button onClick={() => setEditing(null)} style={{ background: T.surfaceAlt, border: '1px solid ' + T.border, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font, flexShrink: 0 }}>&larr; Back</button>
          <input style={{ ...inputStyle, fontSize: 16, fontWeight: 700, padding: '6px 10px', maxWidth: 400 }} value={name} onChange={e => setName(e.target.value)} placeholder="Widget name" />
          <input style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', flex: 1, maxWidth: 400 }} value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <Button onClick={() => setShowJson(s => !s)} style={{ padding: '6px 10px', fontSize: 11 }}>{showJson ? 'Hide JSON' : 'JSON'}</Button>
          <Button primary onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>

      {toast && (
        <div style={{ padding: '8px 20px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 12, fontWeight: 600, color: toast.isError ? T.error : T.success, flexShrink: 0 }}>
          {toast.msg}
        </div>
      )}

      {/* 3-pane: field tree | canvas | properties */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 320px', flex: 1, minHeight: 0 }}>
        {/* LEFT: FIELD TREE */}
        <FieldTree search={fieldSearch} onSearch={setFieldSearch} expanded={expandedTables} onToggle={k => setExpandedTables(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })} />

        {/* CENTER: CANVAS */}
        <div style={{ overflow: 'auto', padding: 20, background: T.bg }}>
          {/* Widget meta bar */}
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
              <div>
                <label style={labelStyle}>Widget Type</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={widgetType} onChange={e => setWidgetType(e.target.value)}>
                  <option value="deal">Deal</option><option value="pipeline">Pipeline</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Scope</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={scope} onChange={e => setScope(e.target.value)}>
                  {SCOPES.map(s => <option key={s.key} value={s.key}>{s.label}-specific</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Header Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="color" value={headerColor || '#5DADE2'} onChange={e => setHeaderColor(e.target.value)}
                    style={{ width: 36, height: 30, border: '1px solid ' + T.border, borderRadius: 4, cursor: 'pointer', padding: 0 }} />
                  <input style={{ ...inputStyle, flex: 1, fontFamily: T.mono, fontSize: 12 }} value={headerColor} onChange={e => setHeaderColor(e.target.value)} placeholder="#5DADE2" />
                  {headerColor && <button onClick={() => setHeaderColor('')} style={{ fontSize: 10, padding: '4px 8px', border: '1px solid ' + T.border, background: T.surface, borderRadius: 4, cursor: 'pointer', color: T.textMuted, fontFamily: T.font }}>Clear</button>}
                </div>
              </div>
              {widgetType === 'deal' && previewDeals.length > 0 && (
                <div>
                  <label style={labelStyle}>Preview with</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={previewDealId || ''} onChange={e => setPreviewDealId(e.target.value)}>
                    {previewDeals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </Card>

          {sections.map((section, si) => (
            <SectionCanvas
              key={si}
              section={section}
              sectionIndex={si}
              isLast={si === sections.length - 1}
              selected={selected}
              onSelect={setSelected}
              onUpdate={u => updateSection(si, u)}
              onRemove={() => removeSection(si)}
              onMove={d => moveSection(si, d)}
              onAddField={(fi, insertAt) => addFieldToSection(si, fi, insertAt)}
              onMoveField={(fromSi, fromFi, toSi, toFi) => moveField(fromSi, fromFi, toSi, toFi)}
              onUpdateField={(fi, u) => updateField(si, fi, u)}
              onRemoveField={fi => removeField(si, fi)}
              onAddFilter={(fieldInfo) => addFilter(si, fieldInfo)}
              onUpdateFilter={(fi, u) => updateFilter(si, fi, u)}
              onRemoveFilter={fi => removeFilter(si, fi)}
              onAddConditionalRule={() => addConditionalRule(si)}
              onUpdateConditionalRule={(ri, u) => updateConditionalRule(si, ri, u)}
              onUpdateConditionalCond={(ri, ci, u) => updateConditionalCond(si, ri, ci, u)}
              onRemoveConditionalRule={ri => removeConditionalRule(si, ri)}
              previewContext={{ deal_id: previewDealId, user_id: profile.id }}
              widgetType={widgetType}
              headerColor={headerColor}
            />
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button onClick={() => addSection()} style={{ padding: '10px 16px', fontSize: 12 }}>+ Add Section</Button>
            {showJson && (
              <Button onClick={() => navigator.clipboard.writeText(JSON.stringify(buildConfig(), null, 2))} style={{ padding: '10px 16px', fontSize: 12 }}>Copy config JSON</Button>
            )}
          </div>

          {showJson && (
            <Card title="Config JSON" style={{ marginTop: 12 }}>
              <pre style={{ fontSize: 10, fontFamily: T.mono, background: T.surfaceAlt, padding: 10, borderRadius: 6, overflow: 'auto', maxHeight: 400, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(buildConfig(), null, 2)}
              </pre>
            </Card>
          )}
        </div>

        {/* RIGHT: PROPERTIES */}
        <PropertiesPanel
          selected={selected}
          sections={sections}
          onUpdateField={(si, fi, u) => updateField(si, fi, u)}
          onUpdateSection={(si, u) => updateSection(si, u)}
          onClose={() => setSelected(null)}
        />
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────
// FieldTree — draggable source (native HTML5 dnd)
// ───────────────────────────────────────────────────────
function FieldTree({ search, onSearch, expanded, onToggle }) {
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return Object.entries(TABLES).map(([tableKey, table]) => {
      const matchTable = !q || table.label.toLowerCase().includes(q) || tableKey.includes(q)
      const fields = Object.entries(table.fields).filter(([fk, f]) =>
        !q || matchTable || f.label.toLowerCase().includes(q) || fk.includes(q))
      return { tableKey, table, fields }
    }).filter(({ fields }) => !q || fields.length > 0)
  }, [search])

  function handleDragStart(e, payload) {
    const data = JSON.stringify({ kind: 'new-field', payload })
    e.dataTransfer.setData(DRAG_MIME, data)
    e.dataTransfer.setData('text/plain', data)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div style={{ background: T.surface, borderRight: '1px solid ' + T.border, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid ' + T.borderLight }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Database Fields</div>
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Search tables, fields..."
          style={{ width: '100%', padding: '6px 10px', border: '1px solid ' + T.border, borderRadius: 6, fontSize: 12, outline: 'none', fontFamily: T.font, color: T.text, background: T.bg }} />
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6 }}>Drag fields onto the canvas sections →</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {filtered.map(({ tableKey, table, fields }) => (
          <div key={tableKey}>
            <div onClick={() => onToggle(tableKey)}
              style={{ padding: '6px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: expanded.has(tableKey) ? T.primaryLight : 'transparent', borderBottom: '1px solid ' + T.borderLight }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: expanded.has(tableKey) ? T.primary : T.text }}>{table.label}</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {table.multi && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: T.warningLight, color: T.warning, fontWeight: 700 }}>multi</span>}
                <span style={{ fontSize: 10, color: T.textMuted }}>{expanded.has(tableKey) ? '▾' : '▸'}</span>
              </div>
            </div>
            {expanded.has(tableKey) && (
              <div style={{ padding: '2px 0 6px' }}>
                {fields.map(([fk, f]) => (
                  <div key={fk}
                    draggable
                    onDragStart={e => handleDragStart(e, { table: tableKey, field: fk, label: f.label, type: f.type })}
                    style={{ padding: '5px 10px 5px 20px', cursor: 'grab', fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>⋮⋮ {f.label}</span>
                    <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono, flexShrink: 0 }}>{f.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────
// SectionCanvas — drop target + field chip row + live preview
// ───────────────────────────────────────────────────────
function SectionCanvas({
  section, sectionIndex: si, isLast, selected, onSelect,
  onUpdate, onRemove, onMove,
  onAddField, onMoveField, onUpdateField, onRemoveField,
  onAddFilter, onUpdateFilter, onRemoveFilter,
  onAddConditionalRule, onUpdateConditionalRule, onUpdateConditionalCond, onRemoveConditionalRule,
  previewContext, widgetType, headerColor,
}) {
  const [dropHover, setDropHover] = useState(false)
  const [filterPickerOpen, setFilterPickerOpen] = useState(false)

  function parseDrag(e) {
    try {
      const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  function onDropOnSection(e) {
    e.preventDefault()
    setDropHover(false)
    const d = parseDrag(e)
    if (!d) return
    if (d.kind === 'new-field') {
      onAddField(d.payload, null)
    } else if (d.kind === 'field') {
      if (d.payload.sectionIdx !== si) onMoveField(d.payload.sectionIdx, d.payload.fieldIdx, si, section.data_source.fields.length)
    }
  }

  function onDropBeforeField(e, fi) {
    e.preventDefault()
    e.stopPropagation()
    setDropHover(false)
    const d = parseDrag(e)
    if (!d) return
    if (d.kind === 'new-field') {
      onAddField(d.payload, fi)
    } else if (d.kind === 'field') {
      const adjusted = d.payload.sectionIdx === si && d.payload.fieldIdx < fi ? fi - 1 : fi
      onMoveField(d.payload.sectionIdx, d.payload.fieldIdx, si, adjusted)
    }
  }

  const selectedSectionHeader = selected?.kind === 'section' && selected.sectionIdx === si
  const config = { name: 'preview', widget_type: widgetType, sections: [section] }

  return (
    <div style={{
      background: T.surface, border: `2px solid ${dropHover ? T.primary : (selectedSectionHeader ? T.primary : T.border)}`,
      borderRadius: 10, marginBottom: 16, overflow: 'hidden',
      boxShadow: dropHover ? `0 0 0 4px ${T.primary}22` : T.shadow,
      transition: 'all 0.12s',
    }}>
      {/* Section header */}
      <div style={{
        padding: '10px 14px', background: headerColor || T.surfaceAlt,
        color: headerColor ? '#fff' : T.text,
        borderBottom: '1px solid ' + T.border,
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
      }} onClick={() => onSelect({ kind: 'section', sectionIdx: si })}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7 }}>Section {si + 1}</span>
        <select onClick={e => e.stopPropagation()} value={section.type} onChange={e => onUpdate({ type: e.target.value })}
          style={{ padding: '4px 8px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font }}>
          {SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select onClick={e => e.stopPropagation()} value={section.data_source.base_table} onChange={e => onUpdate({ data_source: { ...section.data_source, base_table: e.target.value } })}
          style={{ padding: '4px 8px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font, maxWidth: 200 }}>
          {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {(section.type === 'grid' || section.type === 'card') && (
          <select onClick={e => e.stopPropagation()} value={section.layout?.columns || 2} onChange={e => onUpdate({ layout: { ...section.layout, columns: Number(e.target.value) } })}
            style={{ padding: '4px 8px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font }}>
            {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} cols</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={e => { e.stopPropagation(); onMove(-1) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: headerColor ? '#fff' : T.textMuted, fontSize: 13 }} title="Move up">▲</button>
        <button onClick={e => { e.stopPropagation(); onMove(1) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: headerColor ? '#fff' : T.textMuted, fontSize: 13 }} title="Move down">▼</button>
        <button onClick={e => { e.stopPropagation(); onRemove() }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', color: headerColor ? '#fff' : T.error, fontSize: 11, fontWeight: 700 }}>Remove</button>
      </div>

      {/* Field chip row — drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDropHover(true); e.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={() => setDropHover(false)}
        onDrop={onDropOnSection}
        style={{ padding: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 50, borderBottom: '1px solid ' + T.borderLight, background: T.bg }}
      >
        {section.data_source.fields.length === 0 && (
          <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', padding: 6 }}>
            Drag fields from the left panel onto this section
          </div>
        )}
        {section.data_source.fields.map((f, fi) => (
          <FieldChip
            key={f.id}
            field={f}
            sectionIdx={si}
            fieldIdx={fi}
            selected={selected?.kind === 'field' && selected.sectionIdx === si && selected.fieldIdx === fi}
            onSelect={() => onSelect({ kind: 'field', sectionIdx: si, fieldIdx: fi })}
            onRemove={() => onRemoveField(fi)}
            onDropBefore={e => onDropBeforeField(e, fi)}
          />
        ))}
        {/* Trailing drop zone */}
        {section.data_source.fields.length > 0 && (
          <TrailingDropZone onDrop={e => onDropBeforeField(e, section.data_source.fields.length)} />
        )}
      </div>

      {/* Live preview */}
      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Live Preview</div>
        <div style={{ background: T.bg, borderRadius: 6, padding: 10, border: '1px solid ' + T.borderLight, minHeight: 60 }}>
          {section.data_source.fields.length > 0
            ? <WidgetRenderer config={config} context={previewContext} />
            : <div style={{ textAlign: 'center', color: T.textMuted, fontSize: 11, padding: 16 }}>Add fields to see preview</div>}
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid ' + T.borderLight }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filters</span>
          <Button onClick={() => setFilterPickerOpen(true)} style={{ padding: '2px 8px', fontSize: 10 }}>+ Filter</Button>
        </div>
        {(section.data_source.filters || []).length === 0 && <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>No filters</div>}
        {(section.data_source.filters || []).map((filter, fi) => (
          <FilterRow
            key={fi}
            filter={filter}
            sectionFields={section.data_source.fields}
            onUpdate={u => onUpdateFilter(fi, u)}
            onRemove={() => onRemoveFilter(fi)}
          />
        ))}
        {filterPickerOpen && (
          <FilterFieldPicker onClose={() => setFilterPickerOpen(false)} onPick={fieldInfo => { onAddFilter(fieldInfo); setFilterPickerOpen(false) }} />
        )}
      </div>

      {/* Conditional formatting */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid ' + T.borderLight, background: T.surfaceAlt + '88' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Conditional Formatting</span>
          <Button onClick={onAddConditionalRule} style={{ padding: '2px 8px', fontSize: 10 }} disabled={section.data_source.fields.length === 0}>+ Rule</Button>
        </div>
        {(section.conditional_rules || []).length === 0 && <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>No rules</div>}
        {(section.conditional_rules || []).map((rule, ri) => (
          <ConditionalRuleEditor
            key={ri}
            rule={rule}
            fields={section.data_source.fields}
            onUpdateRule={u => onUpdateConditionalRule(ri, u)}
            onUpdateCond={(ci, u) => onUpdateConditionalCond(ri, ci, u)}
            onRemove={() => onRemoveConditionalRule(ri)}
          />
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────
// FieldChip — draggable field pill inside a section
// ───────────────────────────────────────────────────────
function FieldChip({ field, sectionIdx, fieldIdx, selected, onSelect, onRemove, onDropBefore }) {
  const [dragOver, setDragOver] = useState(false)

  function onDragStart(e) {
    const data = JSON.stringify({ kind: 'field', payload: { sectionIdx, fieldIdx } })
    e.dataTransfer.setData(DRAG_MIME, data)
    e.dataTransfer.setData('text/plain', data)
    e.dataTransfer.effectAllowed = 'move'
  }

  const typeColor = {
    text: T.textMuted, number: '#0ea5e9', currency: '#2ecc71', date: '#f59e0b',
    badge: '#8b5cf6', boolean: '#6c757d', score: '#10b981', percentage: '#f97316',
  }[field.type] || T.textMuted

  return (
    <>
      {/* Pre-chip drop indicator */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); e.dataTransfer.dropEffect = 'move' }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { setDragOver(false); onDropBefore(e) }}
        style={{ width: dragOver ? 3 : 0, alignSelf: 'stretch', background: T.primary, borderRadius: 2, flexShrink: 0, transition: 'width 0.12s' }}
      />
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 8px', borderRadius: 16,
          background: selected ? T.primaryLight : T.surface,
          border: `1px solid ${selected ? T.primary : T.border}`,
          cursor: 'grab', fontSize: 11, color: T.text,
          boxShadow: selected ? `0 0 0 2px ${T.primary}22` : 'none',
          transition: 'all 0.1s',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: typeColor, flexShrink: 0 }} />
        <span style={{ fontWeight: 600 }}>{field.label}</span>
        <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono }}>{field.table}.{field.field}</span>
        <span onClick={e => { e.stopPropagation(); onRemove() }} style={{ cursor: 'pointer', color: T.textMuted, fontSize: 13, padding: '0 2px' }}>×</span>
      </div>
    </>
  )
}

function TrailingDropZone({ onDrop }) {
  const [dragOver, setDragOver] = useState(false)
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); e.dataTransfer.dropEffect = 'move' }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { setDragOver(false); onDrop(e) }}
      style={{ flex: 1, minWidth: 20, alignSelf: 'stretch', borderRadius: 4, background: dragOver ? T.primaryLight : 'transparent', border: dragOver ? `1px dashed ${T.primary}` : '1px dashed transparent', transition: 'all 0.1s' }}
    />
  )
}

// ───────────────────────────────────────────────────────
// FilterRow
// ───────────────────────────────────────────────────────
function FilterRow({ filter, sectionFields, onUpdate, onRemove }) {
  const fieldType = filter.field_type || 'text'
  const isNumeric = fieldType === 'number' || fieldType === 'currency' || fieldType === 'percentage' || fieldType === 'score'
  const isBool = fieldType === 'boolean'
  const tablePart = filter.field?.split('.')[0]
  const fieldPart = filter.field?.split('.')[1]
  const fieldMeta = tablePart && fieldPart ? TABLES[tablePart]?.fields?.[fieldPart] : null
  const options = fieldMeta?.options

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: T.text, fontFamily: T.mono, padding: '3px 8px', background: T.surfaceAlt, borderRadius: 4, border: '1px solid ' + T.borderLight }}>{filter.field || 'no field'}</span>
      <select value={filter.operator} onChange={e => onUpdate({ operator: e.target.value })}
        style={{ padding: '3px 6px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font }}>
        {OPERATORS.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
      {!['is_empty', 'is_not_empty', 'is_unknown'].includes(filter.operator) && (
        options ? (
          <select value={filter.value || ''} onChange={e => onUpdate({ value: e.target.value })}
            style={{ padding: '3px 6px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font, flex: 1, minWidth: 100 }}>
            <option value="">— select —</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : isBool ? (
          <select value={String(filter.value ?? 'true')} onChange={e => onUpdate({ value: e.target.value === 'true' })}
            style={{ padding: '3px 6px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer' }}>
            <option value="true">true</option><option value="false">false</option>
          </select>
        ) : (
          <input value={filter.value ?? ''} onChange={e => onUpdate({ value: isNumeric ? Number(e.target.value) || 0 : e.target.value })}
            type={isNumeric ? 'number' : 'text'}
            placeholder="value"
            style={{ padding: '3px 8px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, flex: 1, minWidth: 100 }} />
        )
      )}
      <span onClick={onRemove} style={{ cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: '0 4px' }}>×</span>
    </div>
  )
}

// ───────────────────────────────────────────────────────
// FilterFieldPicker — mini picker for filter fields
// ───────────────────────────────────────────────────────
function FilterFieldPicker({ onClose, onPick }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{ position: 'relative', zIndex: 3001, background: T.surface, border: '1px solid ' + T.border, borderRadius: 10, width: 460, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + T.border, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Pick field for filter</span>
          <span style={{ cursor: 'pointer', color: T.textMuted, fontSize: 16 }} onClick={onClose}>×</span>
        </div>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid ' + T.borderLight }}>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            style={{ width: '100%', padding: '6px 10px', border: '1px solid ' + T.border, borderRadius: 6, fontSize: 12, outline: 'none', fontFamily: T.font, color: T.text, background: T.bg }} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {Object.entries(TABLES).filter(([tk, t]) => {
            const q = search.toLowerCase()
            return !q || t.label.toLowerCase().includes(q) || Object.keys(t.fields).some(fk => fk.includes(q) || t.fields[fk].label.toLowerCase().includes(q))
          }).map(([tk, t]) => (
            <div key={tk}>
              <div onClick={() => setExpanded(expanded === tk ? null : tk)} style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', background: expanded === tk ? T.primaryLight : 'transparent', borderBottom: '1px solid ' + T.borderLight }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: expanded === tk ? T.primary : T.text }}>{t.label}</span>
                <span style={{ fontSize: 10, color: T.textMuted }}>{expanded === tk ? '▾' : '▸'}</span>
              </div>
              {expanded === tk && Object.entries(t.fields).filter(([fk, f]) => {
                const q = search.toLowerCase(); return !q || f.label.toLowerCase().includes(q) || fk.includes(q)
              }).map(([fk, f]) => (
                <div key={fk} onClick={() => onPick({ table: tk, field: fk, label: f.label, type: f.type })}
                  style={{ padding: '5px 24px', cursor: 'pointer', fontSize: 11, display: 'flex', justifyContent: 'space-between' }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span>{f.label}</span>
                  <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono }}>{f.type}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────
// ConditionalRuleEditor — real editor, not display-only
// ───────────────────────────────────────────────────────
function ConditionalRuleEditor({ rule, fields, onUpdateRule, onUpdateCond, onRemove }) {
  const cond = rule.conditions?.[0] || {}
  return (
    <div style={{ padding: 8, background: T.surface, borderRadius: 6, marginBottom: 4, border: '1px solid ' + T.borderLight, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 700 }}>IF</span>
      <select value={cond.field || ''} onChange={e => onUpdateCond(0, { field: e.target.value })}
        style={{ padding: '3px 6px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: T.surface, color: T.text }}>
        <option value="">— field —</option>
        {fields.map(f => <option key={f.id} value={`${f.table}.${f.field}`}>{f.label}</option>)}
      </select>
      <select value={cond.operator || 'equals'} onChange={e => onUpdateCond(0, { operator: e.target.value })}
        style={{ padding: '3px 6px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: T.surface, color: T.text }}>
        {OPERATORS.filter(o => !['in_list'].includes(o)).map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
      {!['is_empty', 'is_not_empty', 'is_unknown'].includes(cond.operator) && (
        <input value={cond.value || ''} onChange={e => onUpdateCond(0, { value: e.target.value })} placeholder="value"
          style={{ padding: '3px 8px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, width: 110 }} />
      )}
      <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 700 }}>THEN</span>
      <select value={rule.scope || 'cell'} onChange={e => onUpdateRule({ scope: e.target.value })}
        style={{ padding: '3px 6px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: T.surface, color: T.text }}>
        <option value="cell">color cell</option>
        <option value="row">color row</option>
      </select>
      {rule.scope === 'cell' && (
        <select value={rule.target_field || ''} onChange={e => onUpdateRule({ target_field: e.target.value })}
          style={{ padding: '3px 6px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: T.surface, color: T.text }}>
          {fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      )}
      <input type="color" value={rule.style?.color || '#dc3545'} onChange={e => onUpdateRule({ style: { ...rule.style, color: e.target.value } })}
        style={{ width: 28, height: 22, border: '1px solid ' + T.border, borderRadius: 4, cursor: 'pointer', padding: 0 }} />
      <label style={{ fontSize: 10, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!rule.style?.fontWeight} onChange={e => onUpdateRule({ style: { ...rule.style, fontWeight: e.target.checked ? 700 : undefined } })} />
        bold
      </label>
      <span onClick={onRemove} style={{ cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: '0 4px', marginLeft: 'auto' }}>×</span>
    </div>
  )
}

// ───────────────────────────────────────────────────────
// PropertiesPanel — right-side contextual editor
// ───────────────────────────────────────────────────────
function PropertiesPanel({ selected, sections, onUpdateField, onUpdateSection, onClose }) {
  let body = null
  let title = 'Properties'

  if (selected?.kind === 'field') {
    const section = sections[selected.sectionIdx]
    const f = section?.data_source.fields[selected.fieldIdx]
    if (f) {
      title = `Field: ${f.label}`
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle}>Label</label>
            <input style={inputStyle} value={f.label} onChange={e => onUpdateField(selected.sectionIdx, selected.fieldIdx, { label: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>Display Format</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={f.format?.type || f.type} onChange={e => onUpdateField(selected.sectionIdx, selected.fieldIdx, { format: { type: e.target.value } })}>
              {FORMAT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {section.type === 'metric' && (
            <div>
              <label style={labelStyle}>Aggregate</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={f.aggregate || 'none'} onChange={e => onUpdateField(selected.sectionIdx, selected.fieldIdx, { aggregate: e.target.value })}>
                {AGGREGATES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          {section.type === 'table' && (
            <div>
              <label style={labelStyle}>Column Aggregate (footer)</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={f.aggregate || 'none'} onChange={e => onUpdateField(selected.sectionIdx, selected.fieldIdx, { aggregate: e.target.value })}>
                {AGGREGATES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>Adds a totals row. Use "none" to hide.</div>
            </div>
          )}
          <div>
            <label style={labelStyle}>Click Action</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={f.click_action?.type || 'none'} onChange={e => onUpdateField(selected.sectionIdx, selected.fieldIdx, { click_action: { type: e.target.value } })}>
              {CLICK_ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.sortable !== false} onChange={e => onUpdateField(selected.sectionIdx, selected.fieldIdx, { sortable: e.target.checked })} />
              Sortable
            </label>
          </div>
          <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, padding: 8, background: T.surfaceAlt, borderRadius: 4 }}>
            Source: {f.table}.{f.field} ({f.type})
          </div>
        </div>
      )
    }
  } else if (selected?.kind === 'section') {
    const section = sections[selected.sectionIdx]
    if (section) {
      title = `Section ${selected.sectionIdx + 1}`
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle}>Layout Type</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={section.type} onChange={e => onUpdateSection(selected.sectionIdx, { type: e.target.value })}>
              {SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Base Table</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={section.data_source.base_table} onChange={e => onUpdateSection(selected.sectionIdx, { data_source: { ...section.data_source, base_table: e.target.value } })}>
              {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          {(section.type === 'grid' || section.type === 'card') && (
            <div>
              <label style={labelStyle}>Grid Columns</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={section.layout?.columns || 2} onChange={e => onUpdateSection(selected.sectionIdx, { layout: { ...section.layout, columns: Number(e.target.value) } })}>
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={labelStyle}>Row Limit</label>
            <input type="number" style={inputStyle} value={section.data_source.limit || ''} onChange={e => onUpdateSection(selected.sectionIdx, { data_source: { ...section.data_source, limit: e.target.value ? Number(e.target.value) : null } })} placeholder="All" />
          </div>
        </div>
      )
    }
  } else {
    body = (
      <div style={{ fontSize: 12, color: T.textMuted, padding: 12, textAlign: 'center' }}>
        Click any field or section header to edit its properties here.
      </div>
    )
  }

  return (
    <div style={{ background: T.surface, borderLeft: '1px solid ' + T.border, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + T.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: T.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
        {selected && <span onClick={onClose} style={{ cursor: 'pointer', color: T.textMuted, fontSize: 14 }}>×</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>{body}</div>
    </div>
  )
}

// ───────────────────────────────────────────────────────
// ListView + PresetPicker
// ───────────────────────────────────────────────────────
function ListView({ widgets, onNew, onEdit, onClone, onDelete, toast }) {
  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Widget Library</h2>
        <Button primary onClick={onNew}>+ New Widget</Button>
      </div>
      {toast && (
        <div style={{ padding: '8px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 12, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
          {toast.msg}
        </div>
      )}
      <div style={{ padding: '16px 24px' }}>
        {widgets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: T.textMuted }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>No custom widgets yet</div>
            <div style={{ fontSize: 12 }}>Click "+ New Widget" to drag-and-drop one from database fields.</div>
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
                  <span>•</span>
                  <span>scope: {w.config?.scope || 'org'}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button onClick={() => onEdit(w)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
                  <Button onClick={() => onClone(w)} style={{ padding: '4px 10px', fontSize: 11 }}>Clone</Button>
                  <Button onClick={() => onDelete(w.id)} style={{ padding: '4px 10px', fontSize: 11, color: T.error }}>Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PresetPicker({ onBack, onPick }) {
  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: T.surfaceAlt, border: '1px solid ' + T.border, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Back</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Choose a Starting Point</h2>
      </div>
      <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        <div onClick={() => onPick(null)} style={{ padding: 20, background: T.surface, border: '2px dashed ' + T.border, borderRadius: T.radius, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 20, color: T.textMuted, marginBottom: 8 }}>+</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Blank Widget</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Start from scratch</div>
        </div>
        {PRESETS.map((p, i) => (
          <div key={i} onClick={() => onPick(p)} style={{ padding: 20, background: T.surface, border: '1px solid ' + T.border, borderRadius: T.radius, cursor: 'pointer' }}>
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
}
