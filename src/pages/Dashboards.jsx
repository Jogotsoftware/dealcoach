import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatDateLong } from '../lib/theme'
import { Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'
import WidgetRenderer from '../components/WidgetRenderer'
import { executeSavedReport } from '../lib/reportQuery'
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

const BUILTIN_VIEWS = [
  { key: 'recent', label: 'Recent' },
  { key: 'mine', label: 'Created by Me' },
  { key: 'all', label: 'All Dashboards' },
]

const COLUMNS = [
  { key: 'name', label: 'Dashboard Name', width: '2fr' },
  { key: 'description', label: 'Description', width: '2fr' },
  { key: 'folder', label: 'Folder', width: '1fr' },
  { key: 'creator', label: 'Created By', width: '1fr' },
  { key: 'created_at', label: 'Created On', width: '1.2fr' },
  { key: 'fav', label: '', width: '48px' },
  { key: 'actions', label: '', width: '48px' },
]

const HATCH_BG = `repeating-linear-gradient(45deg, transparent 0, transparent 7px, rgba(93,173,226,0.12) 7px, rgba(93,173,226,0.12) 8px)`

function favKey(userId) { return `dealcoach:dash-favs:${userId || 'anon'}` }
function readFavs(userId) {
  try { return new Set(JSON.parse(localStorage.getItem(favKey(userId)) || '[]')) }
  catch { return new Set() }
}
function writeFavs(userId, set) {
  try { localStorage.setItem(favKey(userId), JSON.stringify([...set])) } catch {}
}

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

  // view is one of: 'recent' | 'mine' | 'all' | 'favorites' | 'unfiled' | `folder:<id>`
  const [view, setView] = useState('recent')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' })
  const [favs, setFavs] = useState(() => readFavs(profile?.id))
  const [menuFor, setMenuFor] = useState(null) // dashboard id
  const [folders, setFolders] = useState([])
  const [newFolderName, setNewFolderName] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderMenuFor, setFolderMenuFor] = useState(null)

  useEffect(() => { load() }, [profile?.org_id])
  useEffect(() => { setFavs(readFavs(profile?.id)) }, [profile?.id])

  async function load() {
    if (!profile?.org_id) return
    setLoading(true)
    const [dbRes, defRes, fldRes] = await Promise.all([
      supabase
        .from('org_widget_layouts')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false }),
      supabase.from('custom_widget_definitions').select('*').eq('org_id', profile.org_id).eq('active', true).order('name'),
      supabase.from('dashboard_folders').select('*').eq('org_id', profile.org_id).order('name'),
    ])
    setFolders(fldRes.data || [])
    const rows = dbRes.data || []
    const creatorIds = [...new Set(rows.map(r => r.created_by).filter(Boolean))]
    let creatorsById = {}
    if (creatorIds.length) {
      const { data: pros } = await supabase.from('profiles').select('id, full_name').in('id', creatorIds)
      creatorsById = Object.fromEntries((pros || []).map(p => [p.id, p]))
    }
    const hydrated = rows.map(r => ({ ...r, creator: creatorsById[r.created_by] || null }))
    setDashboards(hydrated)
    setWidgetDefs(defRes.data || [])
    setLoading(false)

    if (dashboardId && hydrated.length) {
      const d = hydrated.find(x => x.id === dashboardId)
      if (d) setEditing(d)
    }
  }

  async function attachCreator(row) {
    if (!row?.created_by) return { ...row, creator: null }
    const { data } = await supabase.from('profiles').select('id, full_name').eq('id', row.created_by).maybeSingle()
    return { ...row, creator: data || null }
  }

  function showToast(msg, isError = false) {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3000)
  }

  function toggleFav(id) {
    const next = new Set(favs)
    if (next.has(id)) next.delete(id); else next.add(id)
    setFavs(next)
    writeFavs(profile?.id, next)
  }

  async function createFolder() {
    const name = newFolderName.trim()
    if (!name) return
    const { data, error } = await supabase.from('dashboard_folders').insert({
      org_id: profile.org_id, created_by: profile.id, name,
    }).select().single()
    if (error) return showToast('Create folder failed: ' + error.message, true)
    setFolders(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setAddingFolder(false)
    setNewFolderName('')
    setView(`folder:${data.id}`)
    showToast('Folder created')
  }

  async function renameFolder(folder) {
    const name = window.prompt('Rename folder', folder.name)
    if (!name || name.trim() === folder.name) return
    const { data, error } = await supabase.from('dashboard_folders').update({ name: name.trim() }).eq('id', folder.id).select().single()
    if (error) return showToast('Rename failed: ' + error.message, true)
    setFolders(prev => prev.map(f => f.id === data.id ? data : f).sort((a, b) => a.name.localeCompare(b.name)))
    showToast('Folder renamed')
  }

  async function deleteFolder(folder) {
    if (!window.confirm(`Delete folder "${folder.name}"? Dashboards inside will become unfiled.`)) return
    const { error } = await supabase.from('dashboard_folders').delete().eq('id', folder.id)
    if (error) return showToast('Delete failed: ' + error.message, true)
    setFolders(prev => prev.filter(f => f.id !== folder.id))
    // ON DELETE SET NULL handles dashboards server-side; sync local state
    setDashboards(prev => prev.map(d => d.folder_id === folder.id ? { ...d, folder_id: null } : d))
    if (view === `folder:${folder.id}`) setView('all')
    showToast('Folder deleted')
  }

  async function moveToFolder(dashboard, folderId) {
    const { data, error } = await supabase.from('org_widget_layouts')
      .update({ folder_id: folderId }).eq('id', dashboard.id).select().single()
    if (error) return showToast('Move failed: ' + error.message, true)
    setDashboards(prev => prev.map(d => d.id === dashboard.id ? { ...d, ...data, creator: d.creator } : d))
    const label = folderId ? (folders.find(f => f.id === folderId)?.name || 'folder') : 'Unfiled'
    showToast(`Moved to ${label}`)
  }

  async function createDashboard() {
    if (!newDash.name.trim()) return
    const defaultFolder = view.startsWith('folder:') ? view.slice('folder:'.length) : null
    const { data, error } = await supabase.from('org_widget_layouts').insert({
      org_id: profile.org_id, created_by: profile.id,
      name: newDash.name, dashboard_title: newDash.name,
      description: newDash.description, scope: newDash.scope,
      page: newDash.scope === 'deal' ? 'deal' : 'pipeline',
      folder_id: defaultFolder,
      widgets: [], layout: [], is_default: false,
    }).select('*').single()
    if (error) return showToast('Create failed: ' + error.message, true)
    const hydrated = await attachCreator(data)
    setDashboards(prev => [hydrated, ...prev])
    setShowNew(false)
    setNewDash({ name: '', scope: 'org', description: '' })
    setEditing(hydrated)
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
    const { data, error } = await supabase
      .from('org_widget_layouts').insert(copy)
      .select('*').single()
    if (error) return showToast('Clone failed: ' + error.message, true)
    const hydrated = await attachCreator(data)
    setDashboards(prev => [hydrated, ...prev])
    showToast('Cloned')
  }

  const folderNameById = useMemo(() => Object.fromEntries(folders.map(f => [f.id, f.name])), [folders])

  const filtered = useMemo(() => {
    let rows = dashboards
    if (view === 'mine') rows = rows.filter(d => d.created_by === profile?.id)
    else if (view === 'favorites') rows = rows.filter(d => favs.has(d.id))
    else if (view === 'unfiled') rows = rows.filter(d => !d.folder_id)
    else if (view.startsWith('folder:')) {
      const fid = view.slice('folder:'.length)
      rows = rows.filter(d => d.folder_id === fid)
    }
    // 'recent' and 'all' share the same set; 'recent' caps to 10 after sort
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q) ||
        (folderNameById[d.folder_id] || '').toLowerCase().includes(q) ||
        (d.creator?.full_name || '').toLowerCase().includes(q)
      )
    }
    const { key, dir } = sort
    const mult = dir === 'asc' ? 1 : -1
    const get = (d) => {
      if (key === 'creator') return d.creator?.full_name || ''
      if (key === 'name') return d.name || ''
      if (key === 'description') return d.description || ''
      if (key === 'folder') return folderNameById[d.folder_id] || ''
      if (key === 'created_at') return d.created_at || ''
      return ''
    }
    rows = [...rows].sort((a, b) => {
      const av = get(a), bv = get(b)
      if (av < bv) return -1 * mult
      if (av > bv) return 1 * mult
      return 0
    })
    if (view === 'recent') rows = rows.slice(0, 10)
    return rows
  }, [dashboards, view, search, sort, favs, profile?.id, folderNameById])

  if (loading) return <Spinner />

  if (editing) {
    const isOwner = editing.created_by === profile?.id
    return <DashboardEditor
      dashboard={editing}
      widgetDefs={widgetDefs}
      isOwner={isOwner}
      onBack={() => setEditing(null)}
      onClone={async () => {
        await cloneDashboard(editing)
        setEditing(null)
      }}
      onSaved={(updated) => {
        setDashboards(prev => prev.map(d => d.id === updated.id ? { ...d, ...updated, creator: d.creator } : d))
        setEditing(prev => ({ ...prev, ...updated }))
      }}
      showToast={showToast}
      toast={toast}
      profile={profile}
    />
  }

  const currentViewLabel = (() => {
    if (view === 'favorites') return 'All Favorites'
    if (view === 'unfiled') return 'Unfiled'
    if (view.startsWith('folder:')) {
      const f = folders.find(x => x.id === view.slice('folder:'.length))
      return f?.name || 'Folder'
    }
    return BUILTIN_VIEWS.find(v => v.key === view)?.label || 'Dashboards'
  })()

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 0px)', background: T.bg }}>
      {/* Sidebar */}
      <div style={{ width: 240, borderRight: `1px solid ${T.border}`, background: T.surface, padding: '14px 0', flexShrink: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <SidebarSection title="DASHBOARDS">
          {BUILTIN_VIEWS.map(v => (
            <SidebarItem key={v.key} active={view === v.key} onClick={() => setView(v.key)}>{v.label}</SidebarItem>
          ))}
        </SidebarSection>

        <SidebarSection
          title="FOLDERS"
          action={
            <button
              onClick={() => setAddingFolder(true)}
              title="New folder"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.primary, fontSize: 14, padding: 0, lineHeight: 1 }}
            >+</button>
          }
        >
          {addingFolder && (
            <div style={{ padding: '4px 16px 8px' }}>
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createFolder()
                  else if (e.key === 'Escape') { setAddingFolder(false); setNewFolderName('') }
                }}
                placeholder="Folder name"
                style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, height: 26 }}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button onClick={createFolder} disabled={!newFolderName.trim()} style={{ fontSize: 11, padding: '3px 8px', background: T.primary, color: '#fff', border: 'none', borderRadius: 4, cursor: newFolderName.trim() ? 'pointer' : 'not-allowed', opacity: newFolderName.trim() ? 1 : 0.5, fontFamily: T.font }}>Add</button>
                <button onClick={() => { setAddingFolder(false); setNewFolderName('') }} style={{ fontSize: 11, padding: '3px 8px', background: T.surface, color: T.textSecondary, border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>Cancel</button>
              </div>
            </div>
          )}
          <SidebarItem active={view === 'unfiled'} onClick={() => setView('unfiled')}>
            <span style={{ color: T.textMuted, fontStyle: 'italic' }}>Unfiled</span>
          </SidebarItem>
          {folders.length === 0 && !addingFolder && (
            <div style={{ padding: '4px 16px 8px', fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>No folders yet</div>
          )}
          {folders.map(f => {
            const active = view === `folder:${f.id}`
            const isOwner = f.created_by === profile?.id
            const menuOpen = folderMenuFor === f.id
            return (
              <div key={f.id} style={{ position: 'relative' }}>
                <SidebarItem active={active} onClick={() => setView(`folder:${f.id}`)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    {isOwner && (
                      <span
                        onClick={(e) => { e.stopPropagation(); setFolderMenuFor(menuOpen ? null : f.id) }}
                        style={{ color: T.textMuted, fontSize: 14, padding: '0 4px', lineHeight: 1, cursor: 'pointer' }}
                        title="Folder actions"
                      >⋯</span>
                    )}
                  </div>
                </SidebarItem>
                {menuOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 500 }} onClick={() => setFolderMenuFor(null)} />
                    <div style={{ position: 'absolute', top: '100%', right: 8, zIndex: 501, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 140, overflow: 'hidden' }}>
                      <RowMenuItem onClick={() => { renameFolder(f); setFolderMenuFor(null) }}>Rename</RowMenuItem>
                      <RowMenuItem danger onClick={() => { deleteFolder(f); setFolderMenuFor(null) }}>Delete</RowMenuItem>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </SidebarSection>

        <SidebarSection title="FAVORITES">
          <SidebarItem active={view === 'favorites'} onClick={() => setView('favorites')}>All Favorites</SidebarItem>
        </SidebarSection>
      </div>

      {/* Main pane */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Dashboards</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: '2px 0 0' }}>{currentViewLabel}</h2>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{filtered.length} item{filtered.length === 1 ? '' : 's'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search dashboards..."
                style={{ ...inputStyle, width: 260, paddingLeft: 30 }}
              />
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 13, pointerEvents: 'none' }}>⌕</span>
            </div>
            <Button onClick={() => setAddingFolder(true)}>+ New Folder</Button>
            <Button primary onClick={() => setShowNew(true)}>+ New Dashboard</Button>
          </div>
        </div>

        {toast && (
          <div style={{ padding: '8px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 12, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
            {toast.msg}
          </div>
        )}

        {showNew && (
          <div style={{ padding: '12px 24px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: 10, alignItems: 'end', maxWidth: 900 }}>
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
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
          <DashboardTable
            rows={filtered}
            sort={sort}
            setSort={setSort}
            favs={favs}
            toggleFav={toggleFav}
            folders={folders}
            folderNameById={folderNameById}
            onOpen={(d) => setEditing(d)}
            onClone={cloneDashboard}
            onDelete={deleteDashboard}
            onMove={moveToFolder}
            menuFor={menuFor}
            setMenuFor={setMenuFor}
            currentUserId={profile?.id}
          />
        </div>
      </div>
    </div>
  )
}

function SidebarSection({ title, action, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ padding: '0 16px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

function SidebarItem({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '7px 16px', background: active ? T.primaryLight : 'transparent',
        border: 'none', borderLeft: active ? `3px solid ${T.primary}` : '3px solid transparent',
        cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500,
        color: active ? T.primary : T.text, fontFamily: T.font,
      }}
    >
      {children}
    </button>
  )
}

function DashboardTable({ rows, sort, setSort, favs, toggleFav, folders, folderNameById, onOpen, onClone, onDelete, onMove, menuFor, setMenuFor, currentUserId }) {
  const gridTemplate = COLUMNS.map(c => c.width).join(' ')
  const [moveMenuFor, setMoveMenuFor] = useState(null)

  const SORTABLE = ['name', 'description', 'folder', 'creator', 'created_at']

  function clickSort(key) {
    if (!SORTABLE.includes(key)) return
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'visible' }}>
      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: T.surfaceAlt, borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {COLUMNS.map(c => {
          const sortable = SORTABLE.includes(c.key)
          const isSorted = sort.key === c.key
          return (
            <div
              key={c.key}
              onClick={() => clickSort(c.key)}
              style={{ padding: '10px 12px', cursor: sortable ? 'pointer' : 'default', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4, borderRight: `1px solid ${T.border}` }}
            >
              <span>{c.label}</span>
              {sortable && (
                <span style={{ color: isSorted ? T.primary : T.borderLight, fontSize: 9 }}>
                  {isSorted ? (sort.dir === 'asc' ? '▲' : '▼') : '▾'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: T.textMuted }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>No dashboards</div>
          <div style={{ fontSize: 12 }}>Adjust filters or click "+ New Dashboard" to create one.</div>
        </div>
      ) : rows.map(d => {
        const isFav = favs.has(d.id)
        const isMenuOpen = menuFor === d.id
        const isMoveOpen = moveMenuFor === d.id
        const isOwner = d.created_by === currentUserId
        const folderName = folderNameById[d.folder_id]
        return (
          <div
            key={d.id}
            style={{ display: 'grid', gridTemplateColumns: gridTemplate, borderBottom: `1px solid ${T.borderLight}`, fontSize: 13, color: T.text, alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{ padding: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <button onClick={() => onOpen(d)} style={{ background: 'none', border: 'none', padding: 0, color: T.primary, fontWeight: 600, cursor: 'pointer', fontFamily: T.font, fontSize: 13, textAlign: 'left' }}>
                {d.name || '(untitled)'}
              </button>
              {!isOwner && (
                <span title="Read-only — clone to customize" style={{ marginLeft: 8, fontSize: 10, color: T.textMuted, fontWeight: 500 }}>read-only</span>
              )}
            </div>
            <div style={{ padding: '12px', color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.description || <span style={{ color: T.textMuted }}>—</span>}
            </div>
            <div style={{ padding: '12px', color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {folderName || <span style={{ color: T.textMuted, fontStyle: 'italic' }}>Unfiled</span>}
            </div>
            <div style={{ padding: '12px', color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.creator?.full_name || <span style={{ color: T.textMuted }}>—</span>}
            </div>
            <div style={{ padding: '12px', color: T.textSecondary }}>
              {formatDateLong(d.created_at)}
            </div>
            <div style={{ padding: '12px', textAlign: 'center' }}>
              <button
                onClick={() => toggleFav(d.id)}
                title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: isFav ? T.warning : T.borderLight, padding: 0, lineHeight: 1 }}
              >
                {isFav ? '★' : '☆'}
              </button>
            </div>
            <div style={{ padding: '12px', textAlign: 'center', position: 'relative' }}>
              <button
                onClick={() => setMenuFor(isMenuOpen ? null : d.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: T.textMuted, padding: '0 4px', lineHeight: 1 }}
                title="Actions"
              >⋯</button>
              {isMenuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 500 }} onClick={() => { setMenuFor(null); setMoveMenuFor(null) }} />
                  <div style={{ position: 'absolute', top: '100%', right: 8, zIndex: 501, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 180, overflow: 'hidden', textAlign: 'left' }}>
                    <RowMenuItem onClick={() => { onOpen(d); setMenuFor(null) }}>{isOwner ? 'Open' : 'View'}</RowMenuItem>
                    <RowMenuItem onClick={() => { onClone(d); setMenuFor(null) }}>Clone</RowMenuItem>
                    {isOwner && (
                      <div style={{ position: 'relative' }}>
                        <RowMenuItem onClick={() => setMoveMenuFor(isMoveOpen ? null : d.id)}>
                          Move to folder ▸
                        </RowMenuItem>
                        {isMoveOpen && (
                          <div style={{ position: 'absolute', top: 0, right: '100%', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 160, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
                            <RowMenuItem onClick={() => { onMove(d, null); setMenuFor(null); setMoveMenuFor(null) }}>
                              <span style={{ fontStyle: 'italic', color: T.textMuted }}>Unfiled</span>
                            </RowMenuItem>
                            {folders.map(f => (
                              <RowMenuItem key={f.id} onClick={() => { onMove(d, f.id); setMenuFor(null); setMoveMenuFor(null) }}>
                                {f.name}{d.folder_id === f.id ? ' ✓' : ''}
                              </RowMenuItem>
                            ))}
                            {folders.length === 0 && (
                              <div style={{ padding: '8px 12px', fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>No folders</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {isOwner && (
                      <RowMenuItem danger onClick={() => { onDelete(d.id); setMenuFor(null) }}>Delete</RowMenuItem>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RowMenuItem({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 12, color: danger ? T.error : T.text, fontFamily: T.font,
      }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? T.errorLight : T.surfaceAlt}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      {children}
    </button>
  )
}

function DashboardEditor({ dashboard, widgetDefs: initialDefs, isOwner, onBack, onClone, onSaved, showToast, toast, profile }) {
  const [widgetDefs, setWidgetDefs] = useState(initialDefs)
  const [widgets, setWidgets] = useState(Array.isArray(dashboard.widgets) ? dashboard.widgets : [])
  const [layout, setLayout] = useState(Array.isArray(dashboard.layout) ? dashboard.layout : [])
  const [scope, setScope] = useState(dashboard.scope || 'org')
  const [scopeValue, setScopeValue] = useState(dashboard.scope_value || '')
  const [description, setDescription] = useState(dashboard.description || '')
  const [title, setTitle] = useState(dashboard.dashboard_title || dashboard.name || '')
  const [titleEditing, setTitleEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showFromReport, setShowFromReport] = useState(false)
  const [savedReports, setSavedReports] = useState([])
  const [previewDealId, setPreviewDealId] = useState(null)
  const [previewDeals, setPreviewDeals] = useState([])
  const [menuOpenFor, setMenuOpenFor] = useState(null)

  // Undo/redo: history of { widgets, layout } snapshots; present = history[pointer]
  const [history, setHistory] = useState(() => ([{
    widgets: Array.isArray(dashboard.widgets) ? dashboard.widgets : [],
    layout: Array.isArray(dashboard.layout) ? dashboard.layout : [],
  }]))
  const [pointer, setPointer] = useState(0)
  const skipHistoryRef = useRef(false)

  function pushHistory(nextWidgets, nextLayout) {
    setHistory(prev => {
      const base = prev.slice(0, pointer + 1)
      const last = base[base.length - 1]
      // Avoid pushing identical snapshots
      if (last && JSON.stringify(last.widgets) === JSON.stringify(nextWidgets) && JSON.stringify(last.layout) === JSON.stringify(nextLayout)) {
        return prev
      }
      const next = [...base, { widgets: nextWidgets, layout: nextLayout }]
      // Cap history at 30 entries
      const capped = next.length > 30 ? next.slice(next.length - 30) : next
      setPointer(capped.length - 1)
      return capped
    })
  }

  function undo() {
    if (pointer <= 0) return
    const snap = history[pointer - 1]
    skipHistoryRef.current = true
    setWidgets(snap.widgets)
    setLayout(snap.layout)
    setPointer(pointer - 1)
    setDirty(true)
  }
  function redo() {
    if (pointer >= history.length - 1) return
    const snap = history[pointer + 1]
    skipHistoryRef.current = true
    setWidgets(snap.widgets)
    setLayout(snap.layout)
    setPointer(pointer + 1)
    setDirty(true)
  }
  const canUndo = pointer > 0
  const canRedo = pointer < history.length - 1

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
    const next = [...widgets, { id, widget_definition_id: cloned.id, title: `${w.title || def.name} (copy)` }]
    setWidgets(next)
    pushHistory(next, layout)
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

  useEffect(() => {
    supabase.from('saved_reports').select('id, name, description, base_entity, query_config, category, is_prebuilt')
      .order('created_at', { ascending: false })
      .then(({ data }) => setSavedReports(data || []))
  }, [])

  async function addReportBackedWidget({ report, visualization, columns, group_by, value_field, aggregate, metric_label, widgetName }) {
    const name = widgetName || report.name
    const widget_type = scope === 'deal' ? 'deal' : 'pipeline'
    const defaultW = visualization === 'metric' ? 3 : visualization === 'pie' ? 5 : 6
    const defaultH = visualization === 'metric' ? 3 : 5
    const payload = {
      org_id: profile.org_id, created_by: profile.id,
      name, description: `From report: ${report.name}`,
      widget_type,
      default_w: defaultW, default_h: defaultH, min_w: 2, min_h: 2,
      saved_report_id: report.id,
      visualization_override: visualization,
      config: {
        source: 'saved_report',
        saved_report_id: report.id,
        visualization,
        columns: columns || null,
        group_by: group_by || null,
        value_field: value_field || null,
        aggregate: aggregate || 'count',
        metric_label: metric_label || null,
        limit: 500,
      },
      active: true,
    }
    const { data: def, error } = await supabase.from('custom_widget_definitions').insert(payload).select().single()
    if (error) { showToast('Create widget failed: ' + error.message, true); return }
    setWidgetDefs(prev => [...prev, def])
    const id = `${def.id}_${Math.random().toString(36).slice(2, 6)}`
    const next = [...widgets, { id, widget_definition_id: def.id, title: name }]
    setWidgets(next)
    pushHistory(next, layout)
    setDirty(true)
    setShowFromReport(false)
    showToast(`Added "${name}"`)
  }

  const effectiveLayout = useMemo(() => {
    return widgets.map((w, i) => {
      const existing = layout.find(l => l.i === w.id)
      if (existing) return existing
      return { i: w.id, x: (i * 4) % 12, y: Infinity, w: 4, h: 4 }
    })
  }, [widgets, layout])

  function addWidget(def) {
    const id = `${def.id}_${Math.random().toString(36).slice(2, 6)}`
    const next = [...widgets, { id, widget_definition_id: def.id, title: def.name }]
    setWidgets(next)
    pushHistory(next, layout)
    setDirty(true)
    setShowLibrary(false)
  }

  function removeWidget(id) {
    const nextW = widgets.filter(w => w.id !== id)
    const nextL = layout.filter(l => l.i !== id)
    setWidgets(nextW)
    setLayout(nextL)
    pushHistory(nextW, nextL)
    setDirty(true)
  }

  function onLayoutChange(l) {
    setLayout(l)
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false
      return
    }
    // Drag/resize ends fire this; compare serialized to avoid noisy pushes
    if (JSON.stringify(l) !== JSON.stringify(layout)) {
      pushHistory(widgets, l)
      setDirty(true)
    }
  }

  async function save() {
    setSaving(true)
    const payload = {
      name: title, dashboard_title: title, description,
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
      {/* Header */}
      <div style={{ padding: '10px 20px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          {titleEditing && isOwner ? (
            <input
              value={title}
              onChange={e => { setTitle(e.target.value); setDirty(true) }}
              onBlur={() => setTitleEditing(false)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setTitleEditing(false) }}
              autoFocus
              style={{ ...inputStyle, fontSize: 17, fontWeight: 700, padding: '4px 8px', maxWidth: 420, height: 32 }}
              placeholder="Dashboard name"
            />
          ) : (
            <button
              onClick={() => isOwner && setTitleEditing(true)}
              title={isOwner ? 'Rename' : 'Read-only'}
              style={{ background: 'none', border: 'none', cursor: isOwner ? 'pointer' : 'default', fontSize: 17, fontWeight: 700, color: T.text, padding: '4px 8px', fontFamily: T.font, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {title || '(untitled)'}
              {isOwner && <span style={{ fontSize: 12, color: T.textMuted, fontWeight: 400 }}>✎</span>}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isOwner ? (
            <>
              <Button primary onClick={() => setShowFromReport(true)} style={{ padding: '6px 12px', fontSize: 12 }}>+ New from report</Button>
              <Button onClick={() => setShowLibrary(s => !s)} style={{ padding: '6px 12px', fontSize: 12 }}>+ Widget</Button>
              <IconBtn title="Undo" disabled={!canUndo} onClick={undo}>↶</IconBtn>
              <IconBtn title="Redo" disabled={!canRedo} onClick={redo}>↷</IconBtn>
              <IconBtn title="Settings" onClick={() => setShowSettings(s => !s)} active={showSettings}>⚙</IconBtn>
              <Button primary onClick={save} disabled={saving || !dirty} style={{ padding: '6px 14px' }}>{saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}</Button>
              <Button onClick={onBack} style={{ padding: '6px 14px' }}>Done</Button>
            </>
          ) : (
            <>
              <Button primary onClick={onClone} style={{ padding: '6px 14px' }}>Clone to customize</Button>
              <Button onClick={onBack} style={{ padding: '6px 14px' }}>Done</Button>
            </>
          )}
        </div>
      </div>

      {!isOwner && (
        <div style={{ padding: '8px 24px', background: T.warningLight, borderBottom: `1px solid ${T.warning}25`, fontSize: 12, color: T.text }}>
          <strong style={{ color: T.warning, marginRight: 6 }}>Read-only.</strong>
          This dashboard belongs to another user. Clone it to make your own editable copy.
        </div>
      )}

      {toast && (
        <div style={{ padding: '8px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 12, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 0 }}>
        {showLibrary && (
          <div style={{ width: 280, borderRight: `1px solid ${T.border}`, background: T.surface, padding: 14, height: 'calc(100vh - 55px)', overflow: 'auto', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Widget Library</div>
            {widgetDefs.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>
                No custom widgets yet. Build one in <a href="/admin/widgets" style={{ color: T.primary }}>/admin/widgets</a>.
              </div>
            ) : (
              widgetDefs.map(def => (
                <div key={def.id}
                  onClick={() => addWidget(def)}
                  style={{ padding: 10, border: `1px solid ${T.border}`, borderRadius: 6, marginBottom: 8, cursor: 'pointer', background: T.surfaceAlt, transition: 'all 0.1s' }}
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

        <div style={{
          flex: 1, padding: 14, minHeight: 'calc(100vh - 55px)',
          background: isOwner
            ? `${HATCH_BG}, ${T.bg}`
            : T.bg,
          backgroundBlendMode: 'normal',
        }}>
          {widgets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: T.textMuted, border: `2px dashed ${T.border}`, borderRadius: 10, background: T.surface }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Empty dashboard</div>
              <div style={{ fontSize: 12, marginBottom: 12 }}>{isOwner ? 'Click "+ Widget" above to add widgets from your library.' : 'This dashboard has no widgets yet.'}</div>
              {isOwner && <Button primary onClick={() => setShowLibrary(true)}>Open library</Button>}
            </div>
          ) : (
            <ResponsiveGridLayout
              className="layout"
              layouts={{ lg: effectiveLayout, md: effectiveLayout, sm: effectiveLayout }}
              breakpoints={{ lg: 1200, md: 900, sm: 600 }}
              cols={{ lg: 12, md: 10, sm: 6 }}
              rowHeight={60}
              onLayoutChange={onLayoutChange}
              draggableHandle=".dash-widget-handle"
              isDraggable={isOwner}
              isResizable={isOwner}
              margin={[10, 10]}
            >
              {widgets.map(w => {
                const def = widgetDefs.find(d => d.id === w.widget_definition_id)
                const isMenuOpen = menuOpenFor === w.id
                return (
                  <div key={w.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden', boxShadow: T.shadow, display: 'flex', flexDirection: 'column' }}>
                    <div className="dash-widget-handle" style={{ padding: '6px 10px', background: def?.config?.header_color || T.surfaceAlt, color: def?.config?.header_color ? '#fff' : T.text, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: isOwner ? 'move' : 'default', flexShrink: 0, position: 'relative' }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{w.title || def?.name || 'Widget'}</span>
                      {isOwner && (
                        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }} onMouseDown={e => e.stopPropagation()}>
                          {def && (
                            <WidgetIcon
                              title="Edit widget definition"
                              onClick={(e) => { e.stopPropagation(); openInBuilder(w) }}
                            >✎</WidgetIcon>
                          )}
                          <WidgetIcon
                            title="More"
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(isMenuOpen ? null : w.id) }}
                          >⋯</WidgetIcon>
                          <WidgetIcon
                            title="Remove from dashboard"
                            onClick={(e) => { e.stopPropagation(); removeWidget(w.id) }}
                          >×</WidgetIcon>
                        </div>
                      )}
                      {isOwner && isMenuOpen && (
                        <>
                          <div style={{ position: 'fixed', inset: 0, zIndex: 500 }} onClick={() => setMenuOpenFor(null)} />
                          <div style={{ position: 'absolute', top: '100%', right: 4, zIndex: 501, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 200, overflow: 'hidden' }}>
                            {def && (
                              <button onClick={() => cloneInPlace(w)} style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: T.text, fontFamily: T.font }}
                                onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}>Clone (creates new editable copy)</button>
                            )}
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

        {showSettings && (
          <SettingsPanel
            title={title}
            setTitle={(v) => { setTitle(v); setDirty(true) }}
            description={description}
            setDescription={(v) => { setDescription(v); setDirty(true) }}
            scope={scope}
            setScope={(v) => { setScope(v); setDirty(true) }}
            scopeValue={scopeValue}
            setScopeValue={(v) => { setScopeValue(v); setDirty(true) }}
            previewDeals={previewDeals}
            previewDealId={previewDealId}
            setPreviewDealId={setPreviewDealId}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showFromReport && (
          <NewFromReportModal
            reports={savedReports}
            onClose={() => setShowFromReport(false)}
            onAdd={addReportBackedWidget}
          />
        )}
      </div>
    </div>
  )
}

function IconBtn({ children, onClick, disabled, title, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 30, height: 30, borderRadius: 6,
        background: active ? T.primaryLight : T.surface,
        border: `1px solid ${active ? T.primary : T.border}`,
        color: active ? T.primary : disabled ? T.borderLight : T.textSecondary,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 14, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: T.font, opacity: disabled ? 0.5 : 1,
      }}
    >{children}</button>
  )
}

function WidgetIcon({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: 14, padding: '0 4px', lineHeight: 1, fontFamily: T.font }}
      onMouseEnter={e => e.currentTarget.style.opacity = 1}
      onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
    >{children}</button>
  )
}

function SettingsPanel({ title, setTitle, description, setDescription, scope, setScope, scopeValue, setScopeValue, previewDeals, previewDealId, setPreviewDealId, onClose }) {
  return (
    <div style={{ width: 320, borderLeft: `1px solid ${T.border}`, background: T.surface, padding: 16, height: 'calc(100vh - 55px)', overflow: 'auto', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Settings</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: T.textMuted, lineHeight: 1 }} title="Close">×</button>
      </div>

      <label style={labelStyle}>Name</label>
      <input style={{ ...inputStyle, marginBottom: 12 }} value={title} onChange={e => setTitle(e.target.value)} />

      <label style={labelStyle}>Description</label>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={3}
        style={{ ...inputStyle, marginBottom: 12, resize: 'vertical', fontFamily: T.font }}
        placeholder="What this dashboard shows..."
      />

      <label style={labelStyle}>Scope</label>
      <select
        value={scope}
        onChange={e => setScope(e.target.value)}
        style={{ ...inputStyle, cursor: 'pointer', marginBottom: 12 }}
      >
        {SCOPES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>

      {scope === 'deal' && previewDeals.length > 0 && (
        <>
          <label style={labelStyle}>Preview deal</label>
          <select
            value={previewDealId || ''}
            onChange={e => setPreviewDealId(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer', marginBottom: 12 }}
          >
            {previewDeals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
          </select>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: -6, marginBottom: 12 }}>
            Preview only — not persisted.
          </div>
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// NEW FROM REPORT MODAL — Salesforce-Lightning-style widget builder
// Pick a saved report → pick display type → configure columns/groupings →
// see live preview → click Save to materialise as a custom_widget_definition
// and drop onto the current dashboard.
// ────────────────────────────────────────────────────────────────

const REPORT_VISUALIZATIONS = [
  { key: 'table', label: 'Table', icon: '▤', desc: 'Rows & columns' },
  { key: 'bar', label: 'Bar chart', icon: '▯', desc: 'Vertical bars' },
  { key: 'hbar', label: 'Horizontal bar', icon: '▭', desc: 'Horizontal bars' },
  { key: 'pie', label: 'Pie chart', icon: '◐', desc: 'Proportions' },
  { key: 'metric', label: 'Metric', icon: '#', desc: 'Single number' },
]

function NewFromReportModal({ reports, onClose, onAdd }) {
  const [selected, setSelected] = useState(reports?.[0] || null)
  const [viz, setViz] = useState('table')
  const [columns, setColumns] = useState([])
  const [groupBy, setGroupBy] = useState('')
  const [valueField, setValueField] = useState('')
  const [aggregate, setAggregate] = useState('count')
  const [metricLabel, setMetricLabel] = useState('')
  const [widgetName, setWidgetName] = useState('')
  const [search, setSearch] = useState('')
  const [previewRows, setPreviewRows] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)

  // Available column names on the selected report (best-effort — peek at config + first row)
  const availableColumns = useMemo(() => {
    if (!selected) return []
    const fromCfg = Array.isArray(selected.query_config?.fields)
      ? selected.query_config.fields.filter(f => typeof f === 'string')
      : []
    if (fromCfg.length) return fromCfg
    if (previewRows?.length) return Object.keys(previewRows[0]).filter(k => k !== 'id')
    return []
  }, [selected, previewRows])

  // When the selected report changes: default columns, default group/value, fetch preview
  useEffect(() => {
    if (!selected) return
    const fromCfg = Array.isArray(selected.query_config?.fields)
      ? selected.query_config.fields.filter(f => typeof f === 'string')
      : []
    setColumns(fromCfg)
    setWidgetName(selected.name || '')
    setGroupBy('')
    setValueField('')
    setAggregate('count')
    setMetricLabel(selected.name || '')
    // Preview fetch
    let cancelled = false
    setPreviewLoading(true); setPreviewError(null)
    executeSavedReport(selected, { limit: 200 })
      .then(({ rows }) => { if (!cancelled) setPreviewRows(rows) })
      .catch(err => { if (!cancelled) setPreviewError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [selected?.id])

  const filtered = useMemo(() => {
    if (!search) return reports
    const q = search.toLowerCase()
    return reports.filter(r => r.name?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q) || r.category?.toLowerCase().includes(q))
  }, [reports, search])

  // Column list for group/value selectors — include fields from preview rows even if not in cfg
  const categoricalColumns = useMemo(() => {
    const set = new Set(availableColumns)
    if (previewRows?.[0]) for (const k of Object.keys(previewRows[0])) if (k !== 'id') set.add(k)
    return [...set]
  }, [availableColumns, previewRows])

  const numericColumns = useMemo(() => {
    if (!previewRows?.length) return []
    const keys = Object.keys(previewRows[0]).filter(k => k !== 'id')
    return keys.filter(k => previewRows.some(r => typeof r[k] === 'number' || (!isNaN(parseFloat(r[k])) && isFinite(r[k]))))
  }, [previewRows])

  // Build the transient config the preview pane uses (same shape the widget eventually persists)
  const previewConfig = useMemo(() => ({
    source: 'saved_report',
    saved_report_id: selected?.id,
    visualization: viz,
    columns: columns.length ? columns : null,
    group_by: groupBy || null,
    value_field: valueField || null,
    aggregate,
    metric_label: metricLabel || null,
    limit: 200,
  }), [selected?.id, viz, columns, groupBy, valueField, aggregate, metricLabel])

  function toggleColumn(c) {
    setColumns(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }

  function canSave() {
    if (!selected) return false
    if (viz === 'bar' || viz === 'hbar' || viz === 'pie') return !!groupBy
    if (viz === 'metric') return true
    if (viz === 'table') return columns.length > 0
    return false
  }

  function save() {
    if (!canSave()) return
    onAdd({
      report: selected,
      visualization: viz,
      columns: viz === 'table' ? columns : null,
      group_by: (viz === 'bar' || viz === 'hbar' || viz === 'pie') ? groupBy : null,
      value_field: valueField || null,
      aggregate,
      metric_label: viz === 'metric' ? (metricLabel || selected.name) : null,
      widgetName: widgetName || selected.name,
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1100px, 95vw)', height: 'min(720px, 90vh)', background: T.surface, borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>New widget from report</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: T.textMuted, padding: 0, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr', minHeight: 0 }}>
          {/* LEFT — report picker + config */}
          <div style={{ borderRight: `1px solid ${T.border}`, background: T.surfaceAlt, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: 10, borderBottom: `1px solid ${T.border}` }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search reports..."
                style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }}
              />
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
              {filtered.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12, color: T.textMuted, fontStyle: 'italic', textAlign: 'center' }}>
                  No reports found. Build one in /reports first.
                </div>
              ) : filtered.map(r => {
                const active = selected?.id === r.id
                return (
                  <div key={r.id}
                    onClick={() => setSelected(r)}
                    style={{
                      padding: '8px 12px', cursor: 'pointer',
                      background: active ? T.primaryLight : 'transparent',
                      borderLeft: `3px solid ${active ? T.primary : 'transparent'}`,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f4f6f8' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      {r.is_prebuilt && <Badge color={T.textMuted}>Prebuilt</Badge>}
                    </div>
                    {r.description && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</div>}
                    <div style={{ fontSize: 9, color: T.textMuted, marginTop: 2, fontFamily: T.mono }}>{r.base_entity || 'deals'}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* RIGHT — config + live preview */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
            {!selected ? (
              <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
                Pick a report on the left to start.
              </div>
            ) : (
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Widget name */}
                <div>
                  <label style={labelStyle}>Widget title</label>
                  <input style={inputStyle} value={widgetName} onChange={e => setWidgetName(e.target.value)} placeholder={selected.name} />
                </div>

                {/* Display type */}
                <div>
                  <label style={labelStyle}>Display as</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                    {REPORT_VISUALIZATIONS.map(v => {
                      const active = viz === v.key
                      return (
                        <button key={v.key} onClick={() => setViz(v.key)}
                          style={{
                            padding: '8px 6px', border: `1px solid ${active ? T.primary : T.border}`,
                            background: active ? T.primaryLight : T.surface,
                            borderRadius: 6, cursor: 'pointer', fontFamily: T.font,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                          }}>
                          <span style={{ fontSize: 18, color: active ? T.primary : T.textMuted }}>{v.icon}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: active ? T.primary : T.text }}>{v.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Per-viz config */}
                {viz === 'table' && (
                  <div>
                    <label style={labelStyle}>Columns ({columns.length} selected)</label>
                    {availableColumns.length === 0 ? (
                      <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic', padding: 6 }}>No fields declared on this report. Build one in /reports with explicit columns, or this widget will fall back to whatever the query returns.</div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 120, overflow: 'auto', padding: 2 }}>
                        {availableColumns.map(c => {
                          const on = columns.includes(c)
                          return (
                            <button key={c} onClick={() => toggleColumn(c)}
                              style={{
                                fontSize: 11, padding: '3px 8px', borderRadius: 10, cursor: 'pointer', fontFamily: T.font,
                                border: `1px solid ${on ? T.primary : T.border}`,
                                background: on ? T.primary : 'transparent',
                                color: on ? '#fff' : T.textSecondary,
                              }}>{c.replace(/_/g, ' ')}</button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {(viz === 'bar' || viz === 'hbar' || viz === 'pie') && (
                  <>
                    <div>
                      <label style={labelStyle}>Group by (categorical)</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                        <option value="">— pick a field —</option>
                        {categoricalColumns.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={labelStyle}>Aggregate</label>
                        <select style={{ ...inputStyle, cursor: 'pointer' }} value={aggregate} onChange={e => setAggregate(e.target.value)}>
                          <option value="count">Count rows</option>
                          <option value="sum">Sum</option>
                          <option value="avg">Average</option>
                          <option value="min">Min</option>
                          <option value="max">Max</option>
                        </select>
                      </div>
                      {aggregate !== 'count' && (
                        <div>
                          <label style={labelStyle}>Value field</label>
                          <select style={{ ...inputStyle, cursor: 'pointer' }} value={valueField} onChange={e => setValueField(e.target.value)}>
                            <option value="">— pick —</option>
                            {numericColumns.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {viz === 'metric' && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={labelStyle}>Aggregate</label>
                        <select style={{ ...inputStyle, cursor: 'pointer' }} value={aggregate} onChange={e => setAggregate(e.target.value)}>
                          <option value="count">Count rows</option>
                          <option value="sum">Sum</option>
                          <option value="avg">Average</option>
                          <option value="min">Min</option>
                          <option value="max">Max</option>
                        </select>
                      </div>
                      {aggregate !== 'count' && (
                        <div>
                          <label style={labelStyle}>Value field</label>
                          <select style={{ ...inputStyle, cursor: 'pointer' }} value={valueField} onChange={e => setValueField(e.target.value)}>
                            <option value="">— pick —</option>
                            {numericColumns.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={labelStyle}>Metric label</label>
                      <input style={inputStyle} value={metricLabel} onChange={e => setMetricLabel(e.target.value)} placeholder="e.g. Open deals" />
                    </div>
                  </>
                )}

                {/* Live preview */}
                <div>
                  <label style={labelStyle}>Preview</label>
                  <div style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 8, minHeight: 200, overflow: 'hidden' }}>
                    {previewLoading ? (
                      <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>Loading preview...</div>
                    ) : previewError ? (
                      <div style={{ padding: 20, color: T.error, fontSize: 12, fontFamily: T.mono }}>{previewError}</div>
                    ) : (
                      <div style={{ height: 260 }}>
                        <WidgetRenderer
                          config={previewConfig}
                          context={{ user_id: null }}
                          onColumnsChange={viz === 'table' ? (next) => setColumns(next) : undefined}
                        />
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>
                    {previewRows?.length ?? 0} rows from <code style={{ fontFamily: T.mono }}>{selected.base_entity || selected.query_config?.base_entity || 'deals'}</code>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button primary onClick={save} disabled={!canSave()}>Add to dashboard</Button>
        </div>
      </div>
    </div>
  )
}
