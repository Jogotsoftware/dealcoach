import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import ReactFlow, {
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Button, EmptyState, inputStyle, labelStyle } from './Shared'

const COLORS = {
  champion: '#10b981',
  adversary: '#ef4444',
  influencer: '#f59e0b',
  unknown: '#94a3b8',
  eb: '#5DADE2',
}

const ROLE_LABEL = { champion: 'Champion', adversary: 'Adversary', influencer: 'Influencer', unknown: 'Unknown' }

function roleOf(c) {
  if (c.is_champion) return 'champion'
  if (c.is_adversary) return 'adversary'
  if (c.influence_level === 'high') return 'influencer'
  return 'unknown'
}

function scaleFor(level) {
  if (level === 'high') return 1.0
  if (level === 'medium') return 0.85
  return 0.7
}

// === ICON BUTTONS ===
function IconBtn({ onClick, title, children, size = 32, style, bare = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: size, height: size,
        background: 'transparent',
        border: bare ? 'none' : `1px solid ${T.border}`,
        borderRadius: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        color: T.textSecondary,
        padding: 0,
        transition: 'border-color 0.15s, color 0.15s, background 0.15s',
        ...style,
      }}
      onMouseEnter={e => { if (!bare) e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.color = T.primary }}
      onMouseLeave={e => { if (!bare) e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSecondary }}
    >
      {children}
    </button>
  )
}

function MinusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function PlusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function PencilIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function ResetIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  )
}

// === NODE ===
function ContactNode({ data }) {
  const c = data.contact
  const role = roleOf(c)
  const color = COLORS[role]
  const scale = scaleFor(c.influence_level)
  return (
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
      <Handle
        type="source"
        position={Position.Top}
        style={{ background: T.primary, width: 14, height: 14, border: `2px solid ${T.surface}`, top: -7 }}
      />
      <div style={{
        width: 200,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 6,
        padding: '8px 36px 10px 10px',
        position: 'relative',
        boxShadow: data.selected ? `0 0 0 2px ${T.primary}` : T.shadow,
        fontFamily: T.font,
      }}>
        {c.is_economic_buyer && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, background: COLORS.eb, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
        )}
        {c.is_economic_buyer && (
          <span style={{ position: 'absolute', top: 8, right: 36, background: COLORS.eb, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, lineHeight: 1.2 }}>EB</span>
        )}
        <button
          type="button"
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); data.onEdit(c.id) }}
          title="Edit"
          aria-label="Edit"
          style={{
            position: 'absolute', top: 6, right: 6,
            width: 24, height: 24,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            color: T.textSecondary,
            padding: 0,
          }}
        >
          <PencilIcon size={12} />
        </button>
        <div style={{ marginTop: c.is_economic_buyer ? 4 : 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>{c.name}</div>
          {c.title && <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2, lineHeight: 1.2 }}>{c.title}</div>}
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <span style={{ display: 'inline-block', background: color, color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 3, padding: '2px 6px' }}>{ROLE_LABEL[role]}</span>
            {c.is_signer && <span style={{ display: 'inline-block', background: T.warning, color: '#fff', fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '2px 5px' }}>Signer</span>}
          </div>
        </div>
      </div>
      <Handle
        type="target"
        position={Position.Bottom}
        style={{ background: T.primary, width: 14, height: 14, border: `2px solid ${T.surface}`, bottom: -7 }}
      />
    </div>
  )
}

const nodeTypes = { contact: ContactNode }

// === LAYOUT ===
function dagreLayout(contacts) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 100 })
  contacts.forEach(c => g.setNode(c.id, { width: 220, height: 110 }))
  contacts.forEach(c => {
    if (c.reports_to_contact_id && contacts.some(p => p.id === c.reports_to_contact_id)) {
      g.setEdge(c.reports_to_contact_id, c.id)
    }
  })
  dagre.layout(g)
  const positions = {}
  contacts.forEach(c => {
    const n = g.node(c.id)
    if (n) positions[c.id] = { x: n.x - n.width / 2, y: n.y - n.height / 2 }
  })
  return positions
}

// === MAIN ===
export default function ContactsOrgTree({ dealId, contacts, setContacts }) {
  const [selectedId, setSelectedId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addParentId, setAddParentId] = useState(null)
  const [editId, setEditId] = useState(null)
  const [leftWidth, setLeftWidth] = useState(62)
  const draggingDividerRef = useRef(false)
  const containerRef = useRef(null)
  const dragSaveTimers = useRef({})

  const openEdit = useCallback((id) => setEditId(id), [])

  // Contacts on the tree are those with persisted positions. Adding a contact
  // to the tree is opt-in — the "+" button on each list row.
  const onTreeContacts = useMemo(
    () => contacts.filter(c => c.org_position_x != null && c.org_position_y != null),
    [contacts],
  )

  const nodes = useMemo(() => onTreeContacts.map(c => ({
    id: c.id,
    type: 'contact',
    position: { x: Number(c.org_position_x), y: Number(c.org_position_y) },
    data: { contact: c, selected: selectedId === c.id, onEdit: openEdit },
    selected: selectedId === c.id,
  })), [onTreeContacts, selectedId, openEdit])

  const edges = useMemo(() => {
    const onTreeIds = new Set(onTreeContacts.map(c => c.id))
    return onTreeContacts
      .filter(c => c.reports_to_contact_id && onTreeIds.has(c.reports_to_contact_id))
      .map(c => ({
        id: `e-${c.id}`,
        source: c.id,
        target: c.reports_to_contact_id,
        type: 'smoothstep',
        style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
      }))
  }, [onTreeContacts])

  const updateContact = useCallback(async (id, patch) => {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
    const { error } = await supabase.from('contacts').update(patch).eq('id', id)
    if (error) console.error('updateContact:', error)
  }, [setContacts])

  const onNodeClick = useCallback((_, node) => setSelectedId(node.id), [])
  const onPaneClick = useCallback(() => setSelectedId(null), [])

  const onNodeDragStop = useCallback((_, node) => {
    const pos = node.position
    setContacts(prev => prev.map(c => c.id === node.id ? { ...c, org_position_x: pos.x, org_position_y: pos.y } : c))
    clearTimeout(dragSaveTimers.current[node.id])
    dragSaveTimers.current[node.id] = setTimeout(async () => {
      const { error } = await supabase
        .from('contacts')
        .update({ org_position_x: pos.x, org_position_y: pos.y })
        .eq('id', node.id)
      if (error) console.error('persist drag:', error)
    }, 300)
  }, [setContacts])

  const onConnect = useCallback((conn) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return
    if (reportsToCycle(contacts, conn.source, conn.target)) return
    updateContact(conn.source, { reports_to_contact_id: conn.target })
  }, [updateContact, contacts])

  const onNodeContextMenu = useCallback((e, node) => {
    e.preventDefault()
    setAddParentId(node.id)
    setShowAddModal(true)
  }, [])

  const resetLayout = useCallback(async () => {
    if (onTreeContacts.length === 0) return
    if (!window.confirm('Reset layout? Manual positions will be re-arranged.')) return
    const positions = dagreLayout(onTreeContacts)
    setContacts(prev => prev.map(c => {
      const pos = positions[c.id]
      return pos ? { ...c, org_position_x: pos.x, org_position_y: pos.y } : c
    }))
    await Promise.all(onTreeContacts.map(async c => {
      const pos = positions[c.id]
      if (!pos) return
      const { error } = await supabase
        .from('contacts')
        .update({ org_position_x: pos.x, org_position_y: pos.y })
        .eq('id', c.id)
      if (error) console.error('reset persist:', error)
    }))
  }, [onTreeContacts, setContacts])

  // Add or remove a contact from the org tree. Adding assigns a position near
  // its parent (if on tree) or as a new root; removing clears positions.
  const toggleTree = useCallback(async (c) => {
    const onTree = c.org_position_x != null && c.org_position_y != null
    if (onTree) {
      const patch = { org_position_x: null, org_position_y: null }
      setContacts(prev => prev.map(x => x.id === c.id ? { ...x, ...patch } : x))
      if (selectedId === c.id) setSelectedId(null)
      const { error } = await supabase.from('contacts').update(patch).eq('id', c.id)
      if (error) console.error('toggleTree remove:', error)
      return
    }
    const positioned = contacts.filter(x => x.org_position_x != null && x.org_position_y != null)
    const parent = c.reports_to_contact_id
      ? positioned.find(x => x.id === c.reports_to_contact_id)
      : null
    let pos
    if (parent) {
      const siblings = positioned.filter(x => x.reports_to_contact_id === parent.id)
      pos = {
        x: Number(parent.org_position_x) + siblings.length * 240,
        y: Number(parent.org_position_y) + 180,
      }
    } else {
      const roots = positioned.filter(x => !x.reports_to_contact_id)
      const maxX = roots.reduce((m, x) => Math.max(m, Number(x.org_position_x)), -240)
      pos = { x: roots.length === 0 ? 50 : maxX + 240, y: 50 }
    }
    setContacts(prev => prev.map(x => x.id === c.id ? { ...x, org_position_x: pos.x, org_position_y: pos.y } : x))
    setSelectedId(c.id)
    const { error } = await supabase.from('contacts').update({ org_position_x: pos.x, org_position_y: pos.y }).eq('id', c.id)
    if (error) console.error('toggleTree add:', error)
  }, [contacts, setContacts, selectedId])

  const deleteContact = useCallback(async (id) => {
    const c = contacts.find(x => x.id === id)
    if (!c) return
    if (!window.confirm(`Delete ${c.name}?`)) return
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) { console.error('delete contact:', error); return }
    setContacts(prev => prev.filter(x => x.id !== id))
    if (selectedId === id) setSelectedId(null)
    if (editId === id) setEditId(null)
  }, [contacts, setContacts, selectedId, editId])

  // Resizable divider
  useEffect(() => {
    function onMove(e) {
      if (!draggingDividerRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftWidth(Math.max(35, Math.min(80, pct)))
    }
    function onUp() { draggingDividerRef.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startDivider = (e) => { draggingDividerRef.current = true; e.preventDefault() }

  // Empty state
  if (!contacts || contacts.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Stakeholder Org Tree</h3>
        </div>
        <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, background: T.surface, padding: 24 }}>
          <EmptyState
            title="No stakeholders mapped yet."
            message="Add contacts and set 'Reports to' on each to see the org structure form."
            action={<Button primary onClick={() => { setAddParentId(null); setShowAddModal(true) }}>+ Add first contact</Button>}
          />
        </div>
        {showAddModal && (
          <AddContactModal
            dealId={dealId}
            parentId={addParentId}
            contacts={contacts}
            onClose={() => setShowAddModal(false)}
            onCreated={(c) => { setContacts(prev => [...prev, c]); setShowAddModal(false); setSelectedId(c.id) }}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Stakeholder Org Tree</h3>
      </div>

      <div ref={containerRef} style={{
        display: 'flex',
        height: 640,
        border: `1px solid ${T.border}`,
        borderRadius: T.radius,
        background: T.surface,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* === CANVAS === */}
        <div style={{ width: `${leftWidth}%`, position: 'relative', background: T.surfaceAlt }}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              onNodeContextMenu={onNodeContextMenu}
              connectionRadius={60}
              connectionMode="loose"
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#e5e7eb" gap={16} />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(n) => COLORS[roleOf(n.data.contact)]}
                pannable
                zoomable
                style={{ background: T.surface, border: `1px solid ${T.borderLight}` }}
              />
            </ReactFlow>
          </ReactFlowProvider>

          {/* Floating reset icon — top-right of canvas */}
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 5 }}>
            <IconBtn onClick={resetLayout} title="Reset layout">
              <ResetIcon size={16} />
            </IconBtn>
          </div>

          {onTreeContacts.length < 3 && (
            <div style={{
              position: 'absolute', bottom: 12, left: 12, right: 12,
              background: T.primaryLight, border: `1px solid ${T.primaryBorder}`,
              color: T.text, padding: '8px 12px', borderRadius: 6, fontSize: 12,
              fontFamily: T.font, pointerEvents: 'none',
            }}>
              {onTreeContacts.length === 0
                ? 'Click the + on a contact to add them to the org tree.'
                : 'Add more contacts and set their reporting line to see the org structure form.'}
            </div>
          )}
        </div>

        <div onMouseDown={startDivider} style={{ width: 6, cursor: 'col-resize', background: T.borderLight }} />

        {/* === RIGHT: CONTACTS LIST === */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.surface, fontFamily: T.font }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: `1px solid ${T.borderLight}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Contacts <span style={{ color: T.textMuted, fontWeight: 600 }}>({contacts.length})</span>
            </div>
            <IconBtn onClick={() => { setAddParentId(null); setShowAddModal(true) }} title="Add contact">
              <PlusIcon size={16} />
            </IconBtn>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {contacts.map(c => {
              const role = roleOf(c)
              const isSel = selectedId === c.id
              const onTree = c.org_position_x != null && c.org_position_y != null
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    background: isSel ? T.primaryLight : 'transparent',
                    borderLeft: isSel ? `3px solid ${T.primary}` : `3px solid transparent`,
                    borderBottom: `1px solid ${T.borderLight}`,
                  }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = T.surfaceHover }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: COLORS[role], flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                      {c.is_economic_buyer && <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: COLORS.eb, padding: '1px 4px', borderRadius: 3 }}>EB</span>}
                      {c.is_signer && <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: T.warning, padding: '1px 4px', borderRadius: 3 }}>Signer</span>}
                    </div>
                    <div style={{ fontSize: 11, color: T.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.title || <span style={{ fontStyle: 'italic' }}>No title</span>}
                      {' · '}
                      <span style={{ color: COLORS[role], fontWeight: 600 }}>{ROLE_LABEL[role]}</span>
                    </div>
                  </div>
                  <IconBtn
                    bare
                    onClick={(e) => { e.stopPropagation(); toggleTree(c) }}
                    title={onTree ? 'Remove from org tree' : 'Add to org tree'}
                    size={28}
                    style={{ flexShrink: 0, color: onTree ? T.primary : T.textSecondary }}
                  >
                    {onTree ? <MinusIcon size={14} /> : <PlusIcon size={14} />}
                  </IconBtn>
                  <IconBtn
                    bare
                    onClick={(e) => { e.stopPropagation(); setEditId(c.id) }}
                    title="Edit"
                    size={28}
                    style={{ flexShrink: 0 }}
                  >
                    <PencilIcon size={13} />
                  </IconBtn>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddContactModal
          dealId={dealId}
          parentId={addParentId}
          contacts={contacts}
          onClose={() => setShowAddModal(false)}
          onCreated={(c) => { setContacts(prev => [...prev, c]); setShowAddModal(false); setSelectedId(c.id) }}
        />
      )}

      {editId && (
        <ContactEditModal
          contact={contacts.find(c => c.id === editId)}
          contacts={contacts}
          onClose={() => setEditId(null)}
          onChange={(patch) => updateContact(editId, patch)}
          onDelete={() => deleteContact(editId)}
        />
      )}
    </div>
  )
}

// === ADD CONTACT MODAL ===
function AddContactModal({ dealId, parentId, contacts, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', title: '', email: '',
    influence_level: 'Unknown',
    reports_to_contact_id: parentId || '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    const { data, error } = await supabase.from('contacts').insert({
      deal_id: dealId,
      name: form.name.trim(),
      title: form.title.trim() || null,
      email: form.email.trim() || null,
      influence_level: form.influence_level || 'Unknown',
      reports_to_contact_id: form.reports_to_contact_id || null,
    }).select().single()
    setSaving(false)
    if (error) { console.error('insert contact:', error); return }
    if (data) onCreated(data)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.surface, borderRadius: T.radius, padding: 20, width: 440,
        fontFamily: T.font, boxShadow: T.shadowMd,
      }}>
        <h4 style={{ margin: 0, marginBottom: 12, fontSize: 15, color: T.text, fontWeight: 700 }}>Add Contact</h4>
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={form.name} autoFocus onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelStyle}>Influence</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.influence_level} onChange={e => setForm(p => ({ ...p, influence_level: e.target.value }))}>
                <option value="Unknown">Unknown</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Reports to</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.reports_to_contact_id} onChange={e => setForm(p => ({ ...p, reports_to_contact_id: e.target.value }))}>
                <option value="">— None (top of org) —</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.title ? ` (${c.title})` : ''}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button primary onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Saving...' : 'Add'}</Button>
        </div>
      </div>
    </div>
  )
}

// === REPORTS-TO PICKER (searchable, cycle-safe) ===
function reportsToCycle(contacts, sourceId, candidateParentId) {
  if (sourceId === candidateParentId) return true
  const map = new Map(contacts.map(c => [c.id, c]))
  let cur = map.get(candidateParentId)
  let depth = 0
  while (cur && depth < 100) {
    if (cur.id === sourceId) return true
    cur = cur.reports_to_contact_id ? map.get(cur.reports_to_contact_id) : null
    depth++
  }
  return false
}

function ReportsToPicker({ contact, contacts, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = contacts.find(c => c.id === contact.reports_to_contact_id)
  const candidates = contacts
    .filter(c => c.id !== contact.id)
    .filter(c => !reportsToCycle(contacts, contact.id, c.id))
    .filter(c => (c.name || '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        value={open ? search : (current?.name || '')}
        placeholder={current ? '' : 'No one (top of org) — click to assign'}
        onFocus={() => { setSearch(''); setOpen(true) }}
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
          maxHeight: 220, overflowY: 'auto', boxShadow: T.shadowMd, marginTop: 2,
        }}>
          <div
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onChange(null); setOpen(false) }}
            style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, color: T.textMuted, borderBottom: `1px solid ${T.borderLight}` }}
          >
            — None (top of org) —
          </div>
          {candidates.map(c => (
            <div
              key={c.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(c.id); setOpen(false) }}
              onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
              onMouseLeave={e => e.currentTarget.style.background = T.surface}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, color: T.text, borderBottom: `1px solid ${T.borderLight}` }}
            >
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              {c.title && <div style={{ fontSize: 11, color: T.textMuted }}>{c.title}</div>}
            </div>
          ))}
          {candidates.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>No matches</div>
          )}
        </div>
      )}
    </div>
  )
}

// === EDIT CONTACT MODAL ===
function ContactEditModal({ contact, contacts, onClose, onChange, onDelete }) {
  const [draft, setDraft] = useState(contact)
  useEffect(() => { setDraft(contact) }, [contact?.id])

  if (!contact) return null

  const commitNow = (patch) => {
    setDraft(d => ({ ...d, ...patch }))
    onChange(patch)
  }
  const commitOnBlur = (field) => {
    const v = (draft[field] ?? '') === '' ? null : draft[field]
    if (v !== (contact[field] ?? null)) onChange({ [field]: v })
  }

  const flagToggle = (key, label) => (
    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textSecondary, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!draft[key]} onChange={e => commitNow({ [key]: e.target.checked })} />
      {label}
    </label>
  )

  const textArea = (field, label, rows = 2) => (
    <div style={{ marginBottom: 8 }}>
      <label style={labelStyle}>{label}</label>
      <textarea
        style={{ ...inputStyle, minHeight: rows * 22, resize: 'vertical', fontFamily: T.font, lineHeight: 1.4 }}
        value={draft[field] || ''}
        onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
        onBlur={() => commitOnBlur(field)}
      />
    </div>
  )

  const textInput = (field, label) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        style={inputStyle}
        value={draft[field] || ''}
        onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
        onBlur={() => commitOnBlur(field)}
      />
    </div>
  )

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.surface, borderRadius: T.radius, padding: 20, width: 560, maxHeight: '90vh', overflowY: 'auto',
        fontFamily: T.font, boxShadow: T.shadowMd,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Name</label>
            <input
              style={{ ...inputStyle, fontSize: 16, fontWeight: 700 }}
              value={draft.name || ''}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onBlur={() => commitOnBlur('name')}
            />
          </div>
          <Button danger style={{ marginTop: 14, padding: '6px 10px', fontSize: 11 }} onClick={onDelete}>Delete</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {textInput('title', 'Title')}
          {textInput('email', 'Email')}
          {textInput('phone', 'Phone')}
          {textInput('linkedin', 'LinkedIn')}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Role</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '10px 12px', background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}` }}>
            {flagToggle('is_champion', 'Champion')}
            {flagToggle('is_adversary', 'Adversary')}
            {flagToggle('is_economic_buyer', 'Economic Buyer')}
            {flagToggle('is_signer', 'Signer')}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Influence</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={draft.influence_level || 'Unknown'}
              onChange={e => commitNow({ influence_level: e.target.value })}
            >
              <option value="Unknown">Unknown</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Reports to</label>
            <ReportsToPicker
              contact={draft}
              contacts={contacts}
              onChange={(id) => commitNow({ reports_to_contact_id: id })}
            />
          </div>
        </div>

        {textArea('pain_points', 'Pain Points')}
        {textArea('decision_criteria', 'Decision Criteria')}
        {textArea('priorities', 'Priorities')}
        {textArea('personality_notes', 'Personality Notes')}
        {textArea('notes', 'Notes', 3)}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <Button primary onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
