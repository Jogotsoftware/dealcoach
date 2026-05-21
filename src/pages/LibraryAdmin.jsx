// LibraryAdmin — org-wide demo/resource library, admin-managed.
//
// What this is: a single searchable surface for every reusable asset the
// org wants AEs to grab into deal rooms — primarily demo videos from
// gqconsensus, but also docs/decks/links. Admins curate; AEs pull via the
// Deal Room → Library tab's "Add from team library" picker.
//
// What's on the page:
//   • Search bar — fuzzy match on title + notes + category
//   • Type chips — All / Demo / Link / Document / PowerPoint / Other
//   • Category chips — auto-derived from the data (AI, Add-Ons, SIP, etc.)
//   • Sort: favorited (this user) → usage_count desc → last_used_at desc → created_at desc
//   • Per-user star/favorite (writes to org_resource_library_favorites)
//   • CSV import — drag-drop or file picker. Columns: Title, Folder/Category, URL
//   • Add / Edit / Delete (admin-gated at route level)
//
// Why no separate "demos" page: the data shape is the same as docs/links —
// just resource_type='demo'. One library, filterable by type.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { useOrg } from '../contexts/OrgContext'
import { useAuth } from '../hooks/useAuth'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

const RESOURCE_TYPE_META = {
  demo:       { label: 'Demo',       color: '#a855f7' },
  link:       { label: 'Link',       color: T.primary },
  powerpoint: { label: 'PowerPoint', color: '#dc6b2f' },
  document:   { label: 'Document',   color: T.sageGreen || '#22c55e' },
  misc:       { label: 'Other',      color: T.textMuted },
}

export default function LibraryAdmin() {
  const { org } = useOrg()
  const { profile } = useAuth()
  const [items, setItems] = useState(null)
  const [favorites, setFavorites] = useState(new Set())   // resource_ids the current user has starred
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const [editing, setEditing] = useState(null)            // null | { ...item } — open editor modal
  const [importing, setImporting] = useState(null)        // null | { rows: [...], errors: [...] }

  useEffect(() => {
    if (!org?.id || !profile?.id) return
    load()
  }, [org?.id, profile?.id])

  async function load() {
    setError('')
    try {
      const [{ data: rows, error: e1 }, { data: favs, error: e2 }] = await Promise.all([
        supabase.from('org_resource_library').select('*').eq('org_id', org.id),
        supabase.from('org_resource_library_favorites').select('resource_id').eq('profile_id', profile.id),
      ])
      if (e1) throw e1
      if (e2) throw e2
      setItems(rows || [])
      setFavorites(new Set((favs || []).map(f => f.resource_id)))
    } catch (e) {
      console.error('[LibraryAdmin] load failed:', e)
      setError(e?.message || 'Load failed')
      setItems([])
    }
  }

  // Toggle favorite on/off for the current user. Optimistic — flip the Set first,
  // write in the background. If the write fails we log but don't revert because
  // a single missing star is a tiny error budget vs. the UX cost of flicker.
  async function toggleFavorite(id) {
    const isFav = favorites.has(id)
    setFavorites(prev => {
      const next = new Set(prev)
      if (isFav) next.delete(id); else next.add(id)
      return next
    })
    try {
      if (isFav) {
        await supabase.from('org_resource_library_favorites').delete().eq('profile_id', profile.id).eq('resource_id', id)
      } else {
        await supabase.from('org_resource_library_favorites').insert({ profile_id: profile.id, resource_id: id })
      }
    } catch (e) {
      console.error('[LibraryAdmin] favorite toggle failed:', e?.message || e)
    }
  }

  async function saveItem(draft) {
    setError('')
    try {
      if (!draft.title?.trim()) throw new Error('Title is required')
      const payload = {
        org_id: org.id,
        title: draft.title.trim(),
        resource_type: draft.resource_type || 'demo',
        category: draft.category?.trim() || null,
        url: draft.url?.trim() || null,
        notes: draft.notes?.trim() || null,
      }
      if (draft.id) {
        const { error } = await supabase.from('org_resource_library').update(payload).eq('id', draft.id)
        if (error) throw error
      } else {
        payload.created_by = profile?.id
        const { error } = await supabase.from('org_resource_library').insert(payload)
        if (error) throw error
      }
      setEditing(null)
      await load()
    } catch (e) {
      console.error('[LibraryAdmin] save failed:', e)
      setError(e?.message || 'Save failed')
    }
  }

  async function deleteItem(item) {
    if (!confirm(`Delete "${item.title}" from the team library? AEs will no longer be able to add it to deals.`)) return
    try {
      await supabase.from('org_resource_library').delete().eq('id', item.id)
      await load()
    } catch (e) { setError(e?.message || 'Delete failed') }
  }

  // CSV import — parses Title, Folder/Category, URL columns. Header row is
  // optional; if the first row contains "title"/"url"/"folder" we skip it.
  async function importCsv(rows) {
    setError('')
    try {
      const payloads = rows.map(r => ({
        org_id: org.id,
        created_by: profile?.id,
        resource_type: 'demo',
        title: r.title.trim(),
        category: r.category?.trim() || null,
        url: r.url?.trim() || null,
      })).filter(p => p.title)
      if (!payloads.length) throw new Error('No valid rows in CSV')
      // Chunk to keep payload size reasonable even on huge imports.
      const CHUNK = 200
      for (let i = 0; i < payloads.length; i += CHUNK) {
        const { error } = await supabase.from('org_resource_library').insert(payloads.slice(i, i + CHUNK))
        if (error) throw error
      }
      setImporting(null)
      await load()
      alert(`Imported ${payloads.length} resources into the library.`)
    } catch (e) {
      console.error('[LibraryAdmin] CSV import failed:', e)
      setError(e?.message || 'Import failed')
    }
  }

  // Filter + sort. Pure derived state — runs every render but the working
  // set is small (org library, not deal-scoped).
  const filtered = useMemo(() => {
    if (!items) return null
    const q = search.trim().toLowerCase()
    return items.filter(it => {
      if (typeFilter !== 'all' && it.resource_type !== typeFilter) return false
      if (categoryFilter !== 'all' && (it.category || '') !== categoryFilter) return false
      if (q) {
        const hay = `${it.title || ''} ${it.notes || ''} ${it.category || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }).sort((a, b) => {
      // Favorites first
      const aFav = favorites.has(a.id) ? 1 : 0
      const bFav = favorites.has(b.id) ? 1 : 0
      if (aFav !== bFav) return bFav - aFav
      // Then usage_count desc
      const aUse = a.usage_count || 0
      const bUse = b.usage_count || 0
      if (aUse !== bUse) return bUse - aUse
      // Then last_used_at desc (nulls last)
      const aLast = a.last_used_at ? new Date(a.last_used_at).getTime() : 0
      const bLast = b.last_used_at ? new Date(b.last_used_at).getTime() : 0
      if (aLast !== bLast) return bLast - aLast
      // Finally created_at desc
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [items, search, typeFilter, categoryFilter, favorites])

  const categories = useMemo(() => {
    if (!items) return []
    const set = new Set()
    items.forEach(i => { if (i.category) set.add(i.category) })
    return Array.from(set).sort()
  }, [items])

  if (items === null) return <Spinner />

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text }}>Team Library</h1>
        <Badge color={T.textMuted}>{items.length} resources</Badge>
        <div style={{ flex: 1 }} />
        <Button onClick={() => setImporting({ rows: [], errors: [] })}>Import CSV</Button>
        <Button primary onClick={() => setEditing({ resource_type: 'demo', title: '', url: '', category: '', notes: '' })}>+ Add Resource</Button>
      </div>

      <div style={{ fontSize: 13, color: T.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
        Reusable demos, docs, and links available to every AE on the team. AEs pull these into a deal from the Deal Room → Library tab. Star the ones you reach for most — they'll always show up first.
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, color: '#7f1d1d', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Search + type chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search title, notes, or category…"
          style={{ ...inputStyle, flex: '1 1 280px', minWidth: 240 }}
        />
        <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All</FilterChip>
        {Object.entries(RESOURCE_TYPE_META).map(([k, m]) => (
          <FilterChip key={k} active={typeFilter === k} color={m.color} onClick={() => setTypeFilter(k)}>{m.label}</FilterChip>
        ))}
      </div>

      {/* Category chips (only if categories exist) */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: 4 }}>Folder</span>
          <FilterChip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>All</FilterChip>
          {categories.map(c => (
            <FilterChip key={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)}>{c}</FilterChip>
          ))}
        </div>
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
            {items.length === 0
              ? 'The team library is empty. Use "Import CSV" to bulk-load demos, or "+ Add Resource" for a single entry.'
              : 'No matches for the current filters.'}
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {filtered.map(it => (
            <ResourceCard
              key={it.id}
              item={it}
              favorited={favorites.has(it.id)}
              onToggleFav={() => toggleFavorite(it.id)}
              onEdit={() => setEditing(it)}
              onDelete={() => deleteItem(it)}
            />
          ))}
        </div>
      )}

      {editing && (
        <EditorModal
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={saveItem}
        />
      )}
      {importing && (
        <CsvImportModal
          onClose={() => setImporting(null)}
          onImport={importCsv}
        />
      )}
    </div>
  )
}

function FilterChip({ active, color, onClick, children }) {
  const accent = color || T.primary
  return (
    <button onClick={onClick}
      style={{
        padding: '6px 12px', fontSize: 11, fontWeight: 700,
        border: `1px solid ${active ? accent : T.border}`, borderRadius: 999,
        background: active ? accent + '15' : T.surface,
        color: active ? accent : T.text,
        cursor: 'pointer', fontFamily: T.font,
      }}>
      {children}
    </button>
  )
}

function ResourceCard({ item, favorited, onToggleFav, onEdit, onDelete }) {
  const meta = RESOURCE_TYPE_META[item.resource_type] || RESOURCE_TYPE_META.misc
  return (
    <div style={{
      padding: 14, border: `1px solid ${T.border}`, borderLeft: `4px solid ${meta.color}`,
      borderRadius: 8, background: T.surface, display: 'flex', flexDirection: 'column', gap: 8,
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button onClick={onToggleFav}
          title={favorited ? 'Remove from favorites' : 'Add to favorites'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: favorited ? '#f59e0b' : T.textMuted, fontSize: 18 }}>
          {favorited ? '★' : '☆'}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <Badge color={meta.color}>{meta.label}</Badge>
            {item.category && <Badge color={T.textMuted}>{item.category}</Badge>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{item.title}</div>
        </div>
      </div>

      {item.notes && (
        <div style={{ fontSize: 11, color: T.textSecondary, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{item.notes}</div>
      )}

      {item.url && (
        <a href={item.url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: T.primary, wordBreak: 'break-all', fontFamily: T.mono, textDecoration: 'none' }}
          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
          {item.url}
        </a>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 6, gap: 6 }}>
        <span style={{ fontSize: 10, color: T.textMuted }}>
          Used {item.usage_count || 0}×
          {item.last_used_at && ` · last ${relativeTime(item.last_used_at)}`}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onEdit} style={smallBtnStyle}>Edit</button>
          <button onClick={onDelete} style={{ ...smallBtnStyle, color: T.error, borderColor: T.error + '40' }}>Delete</button>
        </div>
      </div>
    </div>
  )
}

const smallBtnStyle = {
  padding: '3px 10px', fontSize: 11, fontWeight: 600,
  border: `1px solid ${T.border}`, borderRadius: 4,
  background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font,
}

function relativeTime(iso) {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function EditorModal({ draft, onClose, onSave }) {
  const [f, setF] = useState(draft)
  const isEdit = !!draft.id
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 8, width: '100%', maxWidth: 560, boxShadow: T.shadowMd, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}` }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>{isEdit ? 'Edit resource' : 'Add resource'}</h3>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={f.title || ''} onChange={e => set('title', e.target.value)} autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Type</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={f.resource_type || 'demo'} onChange={e => set('resource_type', e.target.value)}>
                {Object.entries(RESOURCE_TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Folder / Category</label>
              <input style={inputStyle} value={f.category || ''} onChange={e => set('category', e.target.value)} placeholder="e.g. AI, Add-Ons" />
            </div>
          </div>
          <div>
            <label style={labelStyle}>URL</label>
            <input style={inputStyle} value={f.url || ''} onChange={e => set('url', e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={f.notes || ''} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button primary onClick={() => onSave(f)}>{isEdit ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </div>
  )
}

function CsvImportModal({ onClose, onImport }) {
  const [rows, setRows] = useState([])
  const [parseError, setParseError] = useState('')
  const fileInputRef = useRef(null)

  function handleFile(file) {
    setParseError('')
    setRows([])
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = parseCsv(String(reader.result))
        setRows(parsed)
        if (!parsed.length) setParseError('No data rows found. Make sure the file has Title, Folder, and URL columns.')
      } catch (e) {
        setParseError(e?.message || 'Could not parse CSV')
      }
    }
    reader.onerror = () => setParseError('File read failed')
    reader.readAsText(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 8, width: '100%', maxWidth: 700, maxHeight: '90vh', boxShadow: T.shadowMd, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}` }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Import library from CSV</h3>
          <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 4 }}>
            Expected columns (in any order): <strong>Title</strong>, <strong>Folder</strong> (or Category), <strong>URL</strong> (or Preview). Header row optional. All rows import as <strong>Demo</strong> resources — edit individual entries afterward to change the type.
          </div>
        </div>

        <div style={{ padding: 18, flex: 1, overflowY: 'auto' }}>
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            style={{
              padding: 32, border: `2px dashed ${T.border}`, borderRadius: 8, textAlign: 'center',
              background: T.surfaceAlt || '#f9fafb', cursor: 'pointer', marginBottom: 12,
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div style={{ fontSize: 13, color: T.textSecondary, marginBottom: 6 }}>
              Drag a CSV here or click to select
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files?.[0])} />
          </div>

          {parseError && (
            <div style={{ padding: 10, background: '#fee2e2', color: '#7f1d1d', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{parseError}</div>
          )}

          {rows.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginBottom: 8 }}>
                Preview — {rows.length} row{rows.length === 1 ? '' : 's'} ready to import
              </div>
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead style={{ position: 'sticky', top: 0, background: T.surfaceAlt || '#f9fafb' }}>
                    <tr>
                      <th style={thStyle}>Title</th>
                      <th style={thStyle}>Folder</th>
                      <th style={thStyle}>URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${T.borderLight}` }}>
                        <td style={tdStyle}>{r.title || <span style={{ color: T.error }}>missing</span>}</td>
                        <td style={tdStyle}>{r.category || '—'}</td>
                        <td style={{ ...tdStyle, fontFamily: T.mono, fontSize: 10, wordBreak: 'break-all' }}>{r.url || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && (
                  <div style={{ padding: 8, textAlign: 'center', fontSize: 11, color: T.textMuted, background: T.surfaceAlt || '#f9fafb' }}>
                    …and {rows.length - 50} more
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button primary disabled={rows.length === 0} onClick={() => onImport(rows)}>
            Import {rows.length || ''} {rows.length === 1 ? 'row' : 'rows'}
          </Button>
        </div>
      </div>
    </div>
  )
}

const thStyle = { padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }
const tdStyle = { padding: '6px 10px', color: T.text, verticalAlign: 'top' }

// ─── CSV parser ──────────────────────────────────────────────────────────────
// Handles quoted values with embedded commas + newlines, the common
// gqconsensus / Excel export shape. Returns rows mapped to {title, category, url}.
// Header is optional — we infer column positions if a header row is present,
// otherwise assume the first three columns are title/category/url in that order.
function parseCsv(text) {
  const rows = []
  let cur = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else cell += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { cur.push(cell); cell = '' }
      else if (ch === '\n' || ch === '\r') {
        if (cell.length > 0 || cur.length > 0) { cur.push(cell); rows.push(cur); cur = []; cell = '' }
        if (ch === '\r' && text[i + 1] === '\n') i++
      } else cell += ch
    }
  }
  if (cell.length > 0 || cur.length > 0) { cur.push(cell); rows.push(cur) }
  if (!rows.length) return []

  // Detect header row: if any of the first row's cells contain "title" / "url" / "folder" / "category" / "preview".
  const first = rows[0].map(c => (c || '').toLowerCase().trim())
  const looksLikeHeader = first.some(c => /title|url|preview|folder|category/i.test(c))
  let titleIdx = 0, categoryIdx = 1, urlIdx = 2
  let dataRows = rows
  if (looksLikeHeader) {
    titleIdx = first.findIndex(c => /title|name|demo/i.test(c))
    categoryIdx = first.findIndex(c => /folder|category/i.test(c))
    urlIdx = first.findIndex(c => /url|preview|link/i.test(c))
    if (titleIdx < 0) titleIdx = 0
    if (categoryIdx < 0) categoryIdx = 1
    if (urlIdx < 0) urlIdx = 2
    dataRows = rows.slice(1)
  }
  return dataRows
    .filter(r => r.some(c => (c || '').trim().length > 0))
    .map(r => ({
      title: (r[titleIdx] || '').trim(),
      category: (r[categoryIdx] || '').trim(),
      url: (r[urlIdx] || '').trim(),
    }))
}
