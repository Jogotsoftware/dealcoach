import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'
import WidgetRenderer from '../components/WidgetRenderer'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

const ResponsiveGridLayout = WidthProvider(Responsive)

const SCOPES = [
  { key: 'deal', label: 'Deal' },
  { key: 'rep', label: 'Rep' },
  { key: 'team', label: 'Team' },
  { key: 'territory', label: 'Territory' },
  { key: 'industry', label: 'Industry' },
  { key: 'org', label: 'Org' },
]

export default function Dashboards() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { dashboardId } = useParams()
  const [dashboards, setDashboards] = useState([])
  const [widgetDefs, setWidgetDefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // dashboard obj or 'new'
  const [showNew, setShowNew] = useState(false)
  const [newDash, setNewDash] = useState({ name: '', scope: 'org', description: '' })
  const [toast, setToast] = useState(null)

  useEffect(() => { load() }, [profile?.org_id])

  async function load() {
    if (!profile?.org_id) return
    setLoading(true)
    const [dbRes, defRes] = await Promise.all([
      supabase.from('org_widget_layouts').select('*').eq('org_id', profile.org_id).order('created_at', { ascending: false }),
      supabase.from('custom_widget_definitions').select('*').eq('org_id', profile.org_id).eq('active', true).order('name'),
    ])
    setDashboards(dbRes.data || [])
    setWidgetDefs(defRes.data || [])
    setLoading(false)

    if (dashboardId && dbRes.data) {
      const d = dbRes.data.find(x => x.id === dashboardId)
      if (d) setEditing(d)
    }
  }

  function showToast(msg, isError = false) {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3000)
  }

  async function createDashboard() {
    if (!newDash.name.trim()) return
    const { data, error } = await supabase.from('org_widget_layouts').insert({
      org_id: profile.org_id, created_by: profile.id,
      name: newDash.name, dashboard_title: newDash.name,
      description: newDash.description, scope: newDash.scope,
      page: newDash.scope === 'deal' ? 'deal' : 'pipeline',
      widgets: [], layout: [], is_default: false,
    }).select().single()
    if (error) return showToast('Create failed: ' + error.message, true)
    setDashboards(prev => [data, ...prev])
    setShowNew(false)
    setNewDash({ name: '', scope: 'org', description: '' })
    setEditing(data)
    showToast('Dashboard created')
  }

  async function deleteDashboard(id) {
    if (!window.confirm('Delete this dashboard?')) return
    const { error } = await supabase.from('org_widget_layouts').delete().eq('id', id)
    if (error) return showToast('Delete failed: ' + error.message, true)
    setDashboards(prev => prev.filter(d => d.id !== id))
    if (editing?.id === id) setEditing(null)
    showToast('Deleted')
  }

  async function cloneDashboard(dash) {
    const copy = {
      org_id: profile.org_id, created_by: profile.id,
      name: `${dash.name} (copy)`, dashboard_title: `${dash.dashboard_title || dash.name} (copy)`,
      description: dash.description, scope: dash.scope, scope_value: dash.scope_value,
      page: dash.page, widgets: dash.widgets || [], layout: dash.layout || [], is_default: false,
    }
    const { data, error } = await supabase.from('org_widget_layouts').insert(copy).select().single()
    if (error) return showToast('Clone failed: ' + error.message, true)
    setDashboards(prev => [data, ...prev])
    showToast('Cloned')
  }

  if (loading) return <Spinner />

  if (editing) {
    return <DashboardEditor
      dashboard={editing}
      widgetDefs={widgetDefs}
      onBack={() => setEditing(null)}
      onSaved={(updated) => {
        setDashboards(prev => prev.map(d => d.id === updated.id ? updated : d))
        setEditing(updated)
      }}
      showToast={showToast}
      toast={toast}
      profile={profile}
    />
  }

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Dashboards</h2>
        <Button primary onClick={() => setShowNew(true)}>+ New Dashboard</Button>
      </div>
      {toast && (
        <div style={{ padding: '8px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 12, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
          {toast.msg}
        </div>
      )}

      {showNew && (
        <Card style={{ margin: '16px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input style={inputStyle} value={newDash.name} onChange={e => setNewDash(p => ({ ...p, name: e.target.value }))} placeholder="My Pipeline Dashboard" autoFocus />
            </div>
            <div>
              <label style={labelStyle}>Scope</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={newDash.scope} onChange={e => setNewDash(p => ({ ...p, scope: e.target.value }))}>
                {SCOPES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <Button primary onClick={createDashboard} disabled={!newDash.name.trim()}>Create</Button>
            <Button onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div style={{ padding: '16px 24px' }}>
        {dashboards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: T.textMuted }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>No dashboards yet</div>
            <div style={{ fontSize: 12 }}>Click "+ New Dashboard" to build one. Drag widgets from the library into the grid and arrange to taste.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {dashboards.map(d => {
              const widgetCount = Array.isArray(d.widgets) ? d.widgets.length : 0
              return (
                <Card key={d.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{d.name}</div>
                      {d.description && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{d.description}</div>}
                    </div>
                    <Badge color={T.primary}>{d.scope || 'org'}</Badge>
                  </div>
                  <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 8 }}>{widgetCount} widget{widgetCount === 1 ? '' : 's'}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button onClick={() => setEditing(d)} style={{ padding: '4px 10px', fontSize: 11 }}>Open</Button>
                    <Button onClick={() => cloneDashboard(d)} style={{ padding: '4px 10px', fontSize: 11 }}>Clone</Button>
                    <Button onClick={() => deleteDashboard(d.id)} style={{ padding: '4px 10px', fontSize: 11, color: T.error }}>Delete</Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardEditor({ dashboard, widgetDefs: initialDefs, onBack, onSaved, showToast, toast, profile }) {
  const [widgetDefs, setWidgetDefs] = useState(initialDefs)
  const [widgets, setWidgets] = useState(Array.isArray(dashboard.widgets) ? dashboard.widgets : [])
  const [layout, setLayout] = useState(Array.isArray(dashboard.layout) ? dashboard.layout : [])
  const [scope, setScope] = useState(dashboard.scope || 'org')
  const [scopeValue, setScopeValue] = useState(dashboard.scope_value || '')
  const [title, setTitle] = useState(dashboard.dashboard_title || dashboard.name || '')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [previewDealId, setPreviewDealId] = useState(null)
  const [previewDeals, setPreviewDeals] = useState([])
  const [menuOpenFor, setMenuOpenFor] = useState(null)

  async function cloneWidgetDef(def) {
    const copy = {
      org_id: profile.org_id, created_by: profile.id,
      name: `${def.name} (copy)`, description: def.description, widget_type: def.widget_type,
      default_w: def.default_w, default_h: def.default_h, min_w: def.min_w, min_h: def.min_h,
      config: JSON.parse(JSON.stringify(def.config || {})), active: true,
    }
    const { data, error } = await supabase.from('custom_widget_definitions').insert(copy).select().single()
    if (error) { showToast('Clone failed: ' + error.message, true); return null }
    setWidgetDefs(prev => [...prev, data])
    showToast(`Cloned "${def.name}" — edit via /admin/widgets`)
    return data
  }

  async function cloneInPlace(w) {
    const def = widgetDefs.find(d => d.id === w.widget_definition_id)
    if (!def) return
    const cloned = await cloneWidgetDef(def)
    if (!cloned) return
    const id = `${cloned.id}_${Math.random().toString(36).slice(2, 6)}`
    setWidgets(prev => [...prev, { id, widget_definition_id: cloned.id, title: `${w.title || def.name} (copy)` }])
    setDirty(true)
    setMenuOpenFor(null)
  }

  function openInBuilder(w) {
    window.open(`/admin/widgets#${w.widget_definition_id}`, '_blank')
    setMenuOpenFor(null)
  }

  useEffect(() => {
    if (scope === 'deal') {
      supabase.from('deals').select('id, company_name').eq('org_id', profile.org_id).order('updated_at', { ascending: false }).limit(20)
        .then(({ data }) => {
          setPreviewDeals(data || [])
          if (data?.length) setPreviewDealId(data[0].id)
        })
    }
  }, [scope, profile?.org_id])

  // Build grid layout from widget list (normalise any missing positions).
  const effectiveLayout = useMemo(() => {
    return widgets.map((w, i) => {
      const existing = layout.find(l => l.i === w.id)
      if (existing) return existing
      return { i: w.id, x: (i * 4) % 12, y: Infinity, w: 4, h: 4 }
    })
  }, [widgets, layout])

  function addWidget(def) {
    const id = `${def.id}_${Math.random().toString(36).slice(2, 6)}`
    setWidgets(prev => [...prev, { id, widget_definition_id: def.id, title: def.name }])
    setDirty(true)
    setShowLibrary(false)
  }

  function removeWidget(id) {
    setWidgets(prev => prev.filter(w => w.id !== id))
    setLayout(prev => prev.filter(l => l.i !== id))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    const payload = {
      name: title, dashboard_title: title,
      scope, scope_value: scopeValue || null,
      page: scope === 'deal' ? 'deal' : 'pipeline',
      widgets, layout,
    }
    const { data, error } = await supabase.from('org_widget_layouts').update(payload).eq('id', dashboard.id).select().single()
    setSaving(false)
    if (error) return showToast('Save failed: ' + error.message, true)
    setDirty(false)
    onSaved?.(data)
    showToast('Saved')
  }

  return (
    <div>
      <div style={{ padding: '12px 24px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <button onClick={onBack} style={{ background: T.surfaceAlt, border: '1px solid ' + T.border, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Back</button>
          <input value={title} onChange={e => { setTitle(e.target.value); setDirty(true) }}
            style={{ ...inputStyle, fontSize: 16, fontWeight: 700, padding: '6px 10px', maxWidth: 400 }} placeholder="Dashboard name" />
          <select value={scope} onChange={e => { setScope(e.target.value); setDirty(true) }}
            style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer', background: T.surface, color: T.text }}>
            {SCOPES.map(s => <option key={s.key} value={s.key}>{s.label} scope</option>)}
          </select>
          {scope === 'deal' && previewDeals.length > 0 && (
            <select value={previewDealId || ''} onChange={e => setPreviewDealId(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer' }}>
              {previewDeals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={() => setShowLibrary(s => !s)} style={{ padding: '6px 12px', fontSize: 11 }}>{showLibrary ? 'Hide library' : '+ Widget'}</Button>
          <Button primary onClick={save} disabled={saving || !dirty}>{saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}</Button>
        </div>
      </div>

      {toast && (
        <div style={{ padding: '8px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 12, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 0 }}>
        {showLibrary && (
          <div style={{ width: 280, borderRight: '1px solid ' + T.border, background: T.surface, padding: 14, height: 'calc(100vh - 55px)', overflow: 'auto', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Widget Library</div>
            {widgetDefs.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>
                No custom widgets yet. Build one in <a href="/admin/widgets" style={{ color: T.primary }}>/admin/widgets</a>.
              </div>
            ) : (
              widgetDefs.map(def => (
                <div key={def.id}
                  onClick={() => addWidget(def)}
                  style={{ padding: 10, border: '1px solid ' + T.border, borderRadius: 6, marginBottom: 8, cursor: 'pointer', background: T.surfaceAlt, transition: 'all 0.1s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.background = T.primaryLight }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surfaceAlt }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{def.name}</span>
                    <Badge color={def.widget_type === 'pipeline' ? T.primary : T.success}>{def.widget_type}</Badge>
                  </div>
                  {def.description && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 3 }}>{def.description}</div>}
                  <div style={{ fontSize: 9, color: T.primary, marginTop: 6, fontWeight: 600 }}>Click to add →</div>
                </div>
              ))
            )}
          </div>
        )}

        <div style={{ flex: 1, padding: 14, background: T.bg, minHeight: 'calc(100vh - 55px)' }}>
          {widgets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: T.textMuted, border: `2px dashed ${T.border}`, borderRadius: 10, background: T.surface }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Empty dashboard</div>
              <div style={{ fontSize: 12, marginBottom: 12 }}>Click "+ Widget" above to add widgets from your library.</div>
              <Button primary onClick={() => setShowLibrary(true)}>Open library</Button>
            </div>
          ) : (
            <ResponsiveGridLayout
              className="layout"
              layouts={{ lg: effectiveLayout, md: effectiveLayout, sm: effectiveLayout }}
              breakpoints={{ lg: 1200, md: 900, sm: 600 }}
              cols={{ lg: 12, md: 10, sm: 6 }}
              rowHeight={60}
              onLayoutChange={(l) => { setLayout(l); setDirty(true) }}
              draggableHandle=".dash-widget-handle"
              margin={[10, 10]}
            >
              {widgets.map(w => {
                const def = widgetDefs.find(d => d.id === w.widget_definition_id)
                const isMenuOpen = menuOpenFor === w.id
                return (
                  <div key={w.id} style={{ background: T.surface, border: '1px solid ' + T.border, borderRadius: 8, overflow: 'hidden', boxShadow: T.shadow, display: 'flex', flexDirection: 'column' }}>
                    <div className="dash-widget-handle" style={{ padding: '6px 10px', background: def?.config?.header_color || T.surfaceAlt, color: def?.config?.header_color ? '#fff' : T.text, borderBottom: '1px solid ' + T.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'move', flexShrink: 0, position: 'relative' }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{w.title || def?.name || 'Widget'}</span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onMouseDown={e => e.stopPropagation()}>
                        <button onClick={(e) => { e.stopPropagation(); setMenuOpenFor(isMenuOpen ? null : w.id) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: 14, padding: '0 4px' }} title="Widget menu">⋯</button>
                        <button onClick={(e) => { e.stopPropagation(); removeWidget(w.id) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: 14, padding: 0 }} title="Remove from dashboard">×</button>
                      </div>
                      {isMenuOpen && (
                        <>
                          <div style={{ position: 'fixed', inset: 0, zIndex: 500 }} onClick={() => setMenuOpenFor(null)} />
                          <div style={{ position: 'absolute', top: '100%', right: 4, zIndex: 501, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 180, overflow: 'hidden' }}>
                            {def && (
                              <>
                                <button onClick={() => openInBuilder(w)} style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', borderBottom: `1px solid ${T.borderLight}`, cursor: 'pointer', fontSize: 12, color: T.text, fontFamily: T.font }}
                                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>Edit definition</button>
                                <button onClick={() => cloneInPlace(w)} style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', borderBottom: `1px solid ${T.borderLight}`, cursor: 'pointer', fontSize: 12, color: T.text, fontFamily: T.font }}
                                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>Clone (creates new editable copy)</button>
                              </>
                            )}
                            <button onClick={() => { removeWidget(w.id); setMenuOpenFor(null) }} style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: T.error, fontFamily: T.font }}
                              onMouseEnter={e => e.currentTarget.style.background = T.errorLight}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}>Remove from dashboard</button>
                          </div>
                        </>
                      )}
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
                      {def ? (
                        <WidgetRenderer config={def.config} context={{ deal_id: previewDealId, user_id: profile.id }} />
                      ) : (
                        <div style={{ color: T.textMuted, fontSize: 11, fontStyle: 'italic' }}>Widget definition not found</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </ResponsiveGridLayout>
          )}
        </div>
      </div>
    </div>
  )
}
