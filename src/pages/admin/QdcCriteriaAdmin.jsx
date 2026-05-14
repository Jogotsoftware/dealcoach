import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Button, Card, Badge, TabBar, inputStyle, labelStyle } from '../../components/Shared'

// QDC Criteria — tabbed admin surface combining:
//   1. Denial Criteria — what the AI uses to deny/approve BDR-submitted leads
//      (the previous DenialCriteriaAdmin content, unchanged)
//   2. Submission Criteria — which fields the BDR form collects, required-ness,
//      and AE-manager-defined custom fields beyond the built-in 12.

export default function QdcCriteriaAdmin() {
  const navigate = useNavigate()
  const { org } = useOrg()
  const [tab, setTab] = useState('denial')

  return (
    <div>
      <div style={{
        padding: '14px 24px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12, background: T.surface,
      }}>
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}
        >&larr; Back</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0, flex: 1 }}>QDC Criteria</h2>
      </div>

      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        <TabBar
          tabs={[
            { key: 'denial',     label: 'Denial Criteria' },
            { key: 'submission', label: 'Submission Criteria' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      <div style={{ padding: 24, maxWidth: 1000 }}>
        {tab === 'denial'     && org?.id && <DenialPanel     orgId={org.id} />}
        {tab === 'submission' && org?.id && <SubmissionPanel orgId={org.id} />}
      </div>
    </div>
  )
}

// ============================================================================
// DENIAL CRITERIA — preserves the M6 DenialCriteriaAdmin behavior
// ============================================================================

const blankDenial = () => ({
  description: '',
  ai_guidance: '',
  priority: 100,
  active: true,
  field_id: null,
})

function DenialPanel({ orgId }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankDenial())
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const [{ data: rData, error: rErr }, { data: fData, error: fErr }] = await Promise.all([
        supabase.from('ae_denial_criteria').select('*').eq('org_id', orgId).order('priority', { ascending: true }),
        supabase.from('bdr_submission_fields').select('id, label, field_key').eq('org_id', orgId).order('priority', { ascending: true }),
      ])
      if (rErr) throw rErr
      if (fErr) throw fErr
      setRows(rData || [])
      setFields(fData || [])
    } catch (err) { setError(err.message || String(err)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [orgId])

  const fieldsById = useMemo(() => {
    const m = {}
    for (const f of fields) m[f.id] = f
    return m
  }, [fields])

  const startCreate = () => {
    const maxPriority = rows.reduce((m, r) => Math.max(m, r.priority || 0), 0)
    setEditingId('new')
    setForm({ ...blankDenial(), priority: maxPriority + 10 })
  }
  const startEdit = (r) => {
    setEditingId(r.id)
    setForm({
      description: r.description ?? '',
      ai_guidance: r.ai_guidance ?? '',
      priority: r.priority ?? 100,
      active: r.active ?? true,
      field_id: r.field_id ?? null,
    })
  }
  const cancel = () => { setEditingId(null); setForm(blankDenial()); setError(null) }

  const save = async () => {
    if (!form.description.trim()) { setError('Description is required.'); return }
    if (!form.ai_guidance.trim()) { setError('AI guidance is required.'); return }
    setSaving(true); setError(null)
    try {
      const payload = {
        description: form.description.trim(),
        ai_guidance: form.ai_guidance.trim(),
        priority: Number(form.priority) || 100,
        active: !!form.active,
        field_id: form.field_id || null,
      }
      if (editingId === 'new') {
        const { error: e } = await supabase.from('ae_denial_criteria').insert({ ...payload, org_id: orgId, created_by: profile.id })
        if (e) throw e
      } else {
        const { error: e } = await supabase.from('ae_denial_criteria').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingId)
        if (e) throw e
      }
      cancel(); await load()
    } catch (err) { setError(err.message || String(err)) }
    finally { setSaving(false) }
  }

  const toggleActive = async (r) => {
    try {
      const { error: e } = await supabase.from('ae_denial_criteria').update({ active: !r.active, updated_at: new Date().toISOString() }).eq('id', r.id)
      if (e) throw e; await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const doDelete = async (id) => {
    try {
      const { error: e } = await supabase.from('ae_denial_criteria').delete().eq('id', id)
      if (e) throw e
      setConfirmDelete(null); await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <Card>
      <div style={{
        padding: 12, background: T.surfaceAlt, borderRadius: 6,
        fontSize: 12, color: T.textSecondary, lineHeight: 1.5, marginBottom: 12,
      }}>
        <strong style={{ color: T.text }}>How this works:</strong> the AI first-glance reviewer applies these in priority order (low number = high priority). A lead is denied if any criterion fires. <em>Description</em> is shown to the BDR; <em>AI guidance</em> is internal-only.
      </div>

      {editingId === 'new' && (
        <DenialEditForm form={form} setF={setF} fields={fields} onSave={save} onCancel={cancel} saving={saving} isNew />
      )}

      {error && (
        <div style={{ background: T.errorLight, border: `1px solid ${T.error}33`, borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: T.error }}>{error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        {editingId == null && <Button primary onClick={startCreate}>+ New criterion</Button>}
      </div>

      {loading && <div style={{ padding: 16, color: T.textMuted }}>Loading…</div>}

      {!loading && rows.length === 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
          No denial criteria configured. Create one to start screening BDR submissions.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => editingId === r.id ? (
            <DenialEditForm key={r.id} form={form} setF={setF} fields={fields} onSave={save} onCancel={cancel} saving={saving} />
          ) : (
            <div key={r.id} style={{
              border: `1px solid ${T.border}`, borderRadius: 6, padding: 12,
              background: r.active ? T.surface : T.surfaceAlt, opacity: r.active ? 1 : 0.7,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  minWidth: 36, height: 24, borderRadius: 4,
                  background: T.primaryLight, color: T.primary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>{r.priority}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{r.description}</span>
                    {r.field_id && fieldsById[r.field_id]
                      ? <Badge color={T.primary}>Scoped: {fieldsById[r.field_id].label}</Badge>
                      : <Badge color={T.textMuted}>Global</Badge>}
                    {!r.active && <Badge color={T.textMuted}>Inactive</Badge>}
                  </div>
                  {r.ai_guidance && (
                    <div style={{ fontSize: 11, color: T.textSecondary, lineHeight: 1.5, fontStyle: 'italic' }}>
                      AI guidance: {r.ai_guidance}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button onClick={() => toggleActive(r)}>{r.active ? 'Deactivate' : 'Activate'}</Button>
                  <Button onClick={() => startEdit(r)}>Edit</Button>
                  <Button danger onClick={() => setConfirmDelete(r.id)}>Delete</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete denial criterion?"
          body="The AI will no longer apply this criterion to new submissions. Existing decisions are not affected."
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => doDelete(confirmDelete)}
        />
      )}
    </Card>
  )
}

function DenialEditForm({ form, setF, fields = [], onSave, onCancel, saving, isNew }) {
  return (
    <div style={{ border: `1px solid ${T.primary}40`, borderRadius: 6, background: T.primaryLight, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{isNew ? 'New criterion' : 'Edit criterion'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 120px', gap: 12, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Description (shown to BDR when triggered) *</label>
          <input style={inputStyle} value={form.description} onChange={e => setF('description', e.target.value)} placeholder="Lead is outside ICP: under 50 employees AND under $10M annual revenue." />
        </div>
        <div>
          <label style={labelStyle}>Scope</label>
          <select style={inputStyle} value={form.field_id ?? ''} onChange={e => setF('field_id', e.target.value || null)}>
            <option value="">Global (any field)</option>
            {fields.map(f => <option key={f.id} value={f.id}>Field: {f.label}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Priority *</label>
          <input type="number" style={inputStyle} value={form.priority} onChange={e => setF('priority', e.target.value.replace(/[^\d]/g, ''))} />
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>AI guidance (internal — tells the model when to fire) *</label>
        <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: T.font, lineHeight: 1.5, resize: 'vertical' }} rows={4} value={form.ai_guidance} onChange={e => setF('ai_guidance', e.target.value)} placeholder="Trigger ONLY when BOTH conditions are met. If revenue is unknown but employees fit, do not trigger." />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textSecondary }}>
          <input type="checkbox" checked={!!form.active} onChange={e => setF('active', e.target.checked)} /> Active
        </label>
        <div style={{ flex: 1 }} />
        <Button onClick={onCancel}>Cancel</Button>
        <Button primary onClick={onSave} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create' : 'Save changes'}</Button>
      </div>
    </div>
  )
}

// ============================================================================
// SUBMISSION CRITERIA — config-driven BDR form fields (M11)
// ============================================================================

const CUSTOM_INPUT_TYPES = [
  { key: 'text',     label: 'Single-line text' },
  { key: 'number',   label: 'Number' },
  { key: 'currency', label: 'Currency ($)' },
  { key: 'dropdown', label: 'Dropdown' },
  { key: 'textarea', label: 'Multi-line text' },
  { key: 'date',     label: 'Date' },
  { key: 'url',      label: 'URL' },
]

// Built-in fields can use additional types (tag_input, state, vertical) that have coupled UX.
const ALL_INPUT_TYPE_LABELS = {
  text:     'Text',
  number:   'Number',
  currency: 'Currency',
  tag_input:'Tag input',
  dropdown: 'Dropdown',
  textarea: 'Multi-line',
  state:    'US State',
  vertical: 'Vertical',
  url:      'URL',
  date:     'Date',
}

const blankCustom = () => ({
  field_key: '',
  label: '',
  input_type: 'text',
  required: true,
  active: true,
  priority: 200,
  help_text: '',
  placeholder: '',
  options_text: '',  // comma-separated, only for dropdown
})

function snakeCase(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

function SubmissionPanel({ orgId }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [denialRules, setDenialRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankCustom())
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [expandedDenialFor, setExpandedDenialFor] = useState(null)
  // Drag-and-drop state. dragId = the row currently being dragged; dragOverId =
  // the row the cursor is hovering over. We only render the row order from local
  // `rows` state during the drag; on drop we persist new priorities.
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const [{ data: rData, error: rErr }, { data: dData, error: dErr }] = await Promise.all([
        supabase.from('bdr_submission_fields').select('*').eq('org_id', orgId).order('priority', { ascending: true }),
        supabase.from('ae_denial_criteria').select('*').eq('org_id', orgId).order('priority', { ascending: true }),
      ])
      if (rErr) throw rErr
      if (dErr) throw dErr
      setRows(rData || [])
      setDenialRules(dData || [])
    } catch (err) { setError(err.message || String(err)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [orgId])

  // Denial rules grouped by field_id for the per-row inline panel + count badge.
  const scopedByField = useMemo(() => {
    const m = {}
    for (const r of denialRules) {
      if (!r.field_id) continue
      if (!m[r.field_id]) m[r.field_id] = []
      m[r.field_id].push(r)
    }
    return m
  }, [denialRules])

  const startCreate = () => {
    setEditingId('new')
    setForm({ ...blankCustom(), priority: 0 })  // priority set on save based on row count
  }

  const startEdit = (r) => {
    setEditingId(r.id)
    setForm({
      field_key: r.field_key ?? '',
      label: r.label ?? '',
      input_type: r.input_type ?? 'text',
      required: r.required ?? true,
      active: r.active ?? true,
      priority: r.priority ?? 100,
      help_text: r.help_text ?? '',
      placeholder: r.placeholder ?? '',
      options_text: Array.isArray(r.options) ? r.options.join(', ') : '',
    })
  }
  const cancel = () => { setEditingId(null); setForm(blankCustom()); setError(null) }

  const save = async (isBuiltin) => {
    if (!form.label.trim()) { setError('Label is required.'); return }
    const field_key = isBuiltin ? (rows.find(r => r.id === editingId)?.field_key) : snakeCase(form.field_key || form.label)
    if (!isBuiltin && !field_key) { setError('Field key is required (and must contain letters or digits).'); return }
    setSaving(true); setError(null)
    try {
      const payload = {
        label: form.label.trim(),
        required: !!form.required,
        active: !!form.active,
        help_text: form.help_text.trim() || null,
        placeholder: form.placeholder.trim() || null,
        options: form.input_type === 'dropdown'
          ? form.options_text.split(',').map(s => s.trim()).filter(Boolean)
          : null,
      }
      if (editingId === 'new') {
        payload.org_id = orgId
        payload.field_key = field_key
        payload.input_type = form.input_type
        payload.is_builtin = false
        payload.created_by = profile.id
        payload.priority = (rows.reduce((m, r) => Math.max(m, r.priority || 0), 0) || 0) + 10
        const { error: e } = await supabase.from('bdr_submission_fields').insert(payload)
        if (e) throw e
      } else {
        if (!isBuiltin) payload.input_type = form.input_type
        payload.updated_at = new Date().toISOString()
        const { error: e } = await supabase.from('bdr_submission_fields').update(payload).eq('id', editingId)
        if (e) throw e
      }
      cancel(); await load()
    } catch (err) { setError(err.message || String(err)) }
    finally { setSaving(false) }
  }

  const toggle = async (r, key) => {
    try {
      const { error: e } = await supabase
        .from('bdr_submission_fields')
        .update({ [key]: !r[key], updated_at: new Date().toISOString() })
        .eq('id', r.id)
      if (e) throw e
      await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const doDelete = async (id) => {
    try {
      const { error: e } = await supabase.from('bdr_submission_fields').delete().eq('id', id)
      if (e) throw e
      setConfirmDelete(null); await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  // Drag-and-drop reorder. On drop we splice rows locally, re-number priorities
  // (10, 20, 30...), and push individual updates in parallel. Re-load at the end
  // to confirm what's in the DB matches what we showed optimistically.
  const onDrop = async () => {
    if (!dragId || !dragOverId || dragId === dragOverId) {
      setDragId(null); setDragOverId(null); return
    }
    const fromIdx = rows.findIndex(r => r.id === dragId)
    const toIdx = rows.findIndex(r => r.id === dragOverId)
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); setDragOverId(null); return }
    const next = rows.slice()
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    // Optimistic local renumber so the UI doesn't snap back during the await.
    const renumbered = next.map((r, i) => ({ ...r, priority: (i + 1) * 10 }))
    setRows(renumbered)
    setDragId(null); setDragOverId(null)
    try {
      const updates = renumbered.map(r =>
        supabase.from('bdr_submission_fields')
          .update({ priority: r.priority, updated_at: new Date().toISOString() })
          .eq('id', r.id)
      )
      const results = await Promise.all(updates)
      const firstError = results.find(x => x.error)
      if (firstError?.error) throw firstError.error
      await load()
    } catch (err) {
      setError(err.message || String(err))
      await load()
    }
  }

  const addScopedDenial = async (fieldId, description, ai_guidance) => {
    if (!description.trim() || !ai_guidance.trim()) {
      setError('Description and AI guidance are required.')
      return
    }
    try {
      const maxPriority = denialRules.reduce((m, r) => Math.max(m, r.priority || 0), 0)
      const { error: e } = await supabase.from('ae_denial_criteria').insert({
        org_id: orgId,
        created_by: profile.id,
        description: description.trim(),
        ai_guidance: ai_guidance.trim(),
        priority: maxPriority + 10,
        active: true,
        field_id: fieldId,
      })
      if (e) throw e
      await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const deleteScopedDenial = async (id) => {
    try {
      const { error: e } = await supabase.from('ae_denial_criteria').delete().eq('id', id)
      if (e) throw e
      await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const toggleScopedDenial = async (rule) => {
    try {
      const { error: e } = await supabase
        .from('ae_denial_criteria')
        .update({ active: !rule.active, updated_at: new Date().toISOString() })
        .eq('id', rule.id)
      if (e) throw e
      await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <Card>
      <div style={{
        padding: 12, background: T.surfaceAlt, borderRadius: 6,
        fontSize: 12, color: T.textSecondary, lineHeight: 1.5, marginBottom: 12,
      }}>
        <strong style={{ color: T.text }}>How this works:</strong> drag rows to reorder — the visual order is what the BDR sees and how the AI receives them. Toggle <em>Required</em> to enforce on submit; toggle <em>Active</em> to hide a field. Click the chevron on any row to add denial rules scoped to that specific field — those rules fire only against that field's value during AI first-glance review.
      </div>

      {editingId === 'new' && (
        <FieldEditForm form={form} setF={setF} isNew onSave={() => save(false)} onCancel={cancel} saving={saving} allowFieldKeyEdit allowInputTypeEdit />
      )}

      {error && (
        <div style={{ background: T.errorLight, border: `1px solid ${T.error}33`, borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: T.error }}>{error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        {editingId == null && <Button primary onClick={startCreate}>+ New custom field</Button>}
      </div>

      {loading && <div style={{ padding: 16, color: T.textMuted }}>Loading…</div>}

      {!loading && rows.length > 0 && (
        <div style={{ overflow: 'hidden', borderRadius: 6, border: `1px solid ${T.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <Th></Th>
                <Th>Label</Th>
                <Th>Field key</Th>
                <Th>Type</Th>
                <Th>Required</Th>
                <Th>Active</Th>
                <Th>Denial rules</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap(r => editingId === r.id
                ? [(
                  <tr key={r.id}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <FieldEditForm
                        form={form}
                        setF={setF}
                        onSave={() => save(r.is_builtin)}
                        onCancel={cancel}
                        saving={saving}
                        allowFieldKeyEdit={!r.is_builtin}
                        allowInputTypeEdit={!r.is_builtin}
                        isBuiltin={r.is_builtin}
                      />
                    </td>
                  </tr>
                )]
                : (() => {
                  const scoped = scopedByField[r.id] || []
                  const isOverTarget = dragOverId === r.id && dragId !== r.id
                  const isDragging = dragId === r.id
                  const isExpanded = expandedDenialFor === r.id
                  const baseRow = (
                    <tr key={r.id}
                      draggable
                      onDragStart={e => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move' }}
                      onDragOver={e => { e.preventDefault(); if (dragOverId !== r.id) setDragOverId(r.id); e.dataTransfer.dropEffect = 'move' }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                      onDrop={e => { e.preventDefault(); onDrop() }}
                      style={{
                        borderBottom: `1px solid ${T.borderLight}`,
                        opacity: r.active ? (isDragging ? 0.4 : 1) : 0.55,
                        background: isOverTarget ? T.primaryLight : 'transparent',
                        cursor: 'grab',
                      }}>
                      <Td>
                        <span title="Drag to reorder" style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 22, height: 22, color: T.textMuted, cursor: 'grab',
                          fontSize: 14, userSelect: 'none',
                        }}>⋮⋮</span>
                      </Td>
                      <Td><span style={{ fontWeight: 600 }}>{r.label}</span></Td>
                      <Td><code style={{ fontSize: 11, color: T.textSecondary }}>{r.field_key}</code></Td>
                      <Td>{ALL_INPUT_TYPE_LABELS[r.input_type] || r.input_type}</Td>
                      <Td>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11 }}>
                          <input type="checkbox" checked={!!r.required} onChange={() => toggle(r, 'required')} />
                          {r.required ? 'yes' : 'no'}
                        </label>
                      </Td>
                      <Td>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11 }}>
                          <input type="checkbox" checked={!!r.active} onChange={() => toggle(r, 'active')} />
                          {r.active ? 'on' : 'off'}
                        </label>
                      </Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => setExpandedDenialFor(isExpanded ? null : r.id)}
                          title={isExpanded ? 'Hide denial rules' : 'Show / add denial rules for this field'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            background: scoped.length ? T.primaryLight : 'transparent',
                            border: `1px solid ${scoped.length ? T.primary : T.border}`,
                            borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                            fontSize: 11, color: scoped.length ? T.primary : T.textSecondary,
                            fontFamily: T.font, fontWeight: 600,
                          }}
                        >
                          {scoped.length === 0 ? '+ Add' : `${scoped.length} rule${scoped.length === 1 ? '' : 's'}`}
                          <span style={{
                            display: 'inline-block', transition: 'transform 0.15s',
                            transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                          }}>▾</span>
                        </button>
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Button onClick={() => startEdit(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
                          <Button danger onClick={() => setConfirmDelete(r.id)} style={{ padding: '4px 10px', fontSize: 11 }}>Delete</Button>
                        </div>
                      </Td>
                    </tr>
                  )
                  const expandedRow = isExpanded ? (
                    <tr key={r.id + '_denial'}>
                      <td colSpan={8} style={{ padding: 0, background: '#fafbfc', borderBottom: `1px solid ${T.borderLight}` }}>
                        <ScopedDenialPanel
                          field={r}
                          rules={scoped}
                          onAdd={(desc, guide) => addScopedDenial(r.id, desc, guide)}
                          onDelete={deleteScopedDenial}
                          onToggle={toggleScopedDenial}
                        />
                      </td>
                    </tr>
                  ) : null
                  return expandedRow ? [baseRow, expandedRow] : [baseRow]
                })())}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete this field?"
          body="Historical leads keep their captured values (custom fields under custom_fields JSONB; built-ins on their dedicated lead columns). New submissions won't collect this field anymore, and any denial rules scoped to it will be promoted to global criteria you can re-scope or delete from the Denial Criteria tab."
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => doDelete(confirmDelete)}
        />
      )}
    </Card>
  )
}

function ScopedDenialPanel({ field, rules, onAdd, onDelete, onToggle }) {
  const [description, setDescription] = useState('')
  const [aiGuidance, setAiGuidance] = useState('')
  const [adding, setAdding] = useState(false)
  return (
    <div style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Denial rules scoped to "{field.label}"
      </div>
      {rules.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>
          No scoped rules yet. The AI will still apply your global denial criteria — these add field-specific checks on top.
        </div>
      )}
      {rules.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {rules.map(rule => (
            <div key={rule.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: '#fff', border: `1px solid ${T.borderLight}`, borderRadius: 4, padding: 8,
              opacity: rule.active ? 1 : 0.6,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{rule.description}</div>
                <div style={{ fontSize: 11, color: T.textSecondary, fontStyle: 'italic', marginTop: 2 }}>AI guidance: {rule.ai_guidance}</div>
              </div>
              <button
                type="button" onClick={() => onToggle(rule)}
                style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: T.textSecondary, fontFamily: T.font }}
              >{rule.active ? 'Deactivate' : 'Activate'}</button>
              <button
                type="button" onClick={() => onDelete(rule.id)}
                style={{ background: 'none', border: `1px solid ${T.error}50`, borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: T.error, fontFamily: T.font }}
              >Delete</button>
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <div style={{ background: '#fff', border: `1px solid ${T.primary}40`, borderRadius: 4, padding: 10 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Description (shown to BDR when triggered)</label>
            <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder={`e.g. "${field.label}" not aligned with target ICP`} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>AI guidance (internal — when to fire)</label>
            <textarea style={{ ...inputStyle, minHeight: 60, fontFamily: T.font, resize: 'vertical' }} rows={3} value={aiGuidance} onChange={e => setAiGuidance(e.target.value)} placeholder={`e.g. Trigger if the value for ${field.label} is empty or "Other".`} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <Button onClick={() => { setAdding(false); setDescription(''); setAiGuidance('') }}>Cancel</Button>
            <Button primary onClick={async () => {
              await onAdd(description, aiGuidance)
              setDescription(''); setAiGuidance(''); setAdding(false)
            }}>Add rule</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setAdding(true)} style={{ fontSize: 11, padding: '4px 10px' }}>+ Add denial rule for this field</Button>
      )}
    </div>
  )
}

function FieldEditForm({ form, setF, isNew, isBuiltin, onSave, onCancel, saving, allowFieldKeyEdit, allowInputTypeEdit }) {
  return (
    <div style={{ border: `1px solid ${T.primary}40`, borderRadius: 6, background: T.primaryLight, padding: 14, margin: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {isNew ? 'New custom field' : isBuiltin ? 'Edit built-in field' : 'Edit custom field'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 100px', gap: 12, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Label (shown to BDR) *</label>
          <input style={inputStyle} value={form.label} onChange={e => setF('label', e.target.value)} placeholder="e.g. Funding Stage" />
        </div>
        <div>
          <label style={labelStyle}>Field key {allowFieldKeyEdit ? '' : '(locked)'}</label>
          <input
            style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12 }}
            value={allowFieldKeyEdit ? form.field_key : (form.field_key || snakeCase(form.label))}
            onChange={e => setF('field_key', snakeCase(e.target.value))}
            disabled={!allowFieldKeyEdit}
            placeholder="auto from label"
          />
        </div>
        <div>
          <label style={labelStyle}>Priority *</label>
          <input type="number" style={inputStyle} value={form.priority} onChange={e => setF('priority', e.target.value.replace(/[^\d]/g, ''))} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Input type {allowInputTypeEdit ? '' : '(locked for built-in)'}</label>
          <select
            style={inputStyle}
            value={form.input_type}
            onChange={e => setF('input_type', e.target.value)}
            disabled={!allowInputTypeEdit}
          >
            {(allowInputTypeEdit ? CUSTOM_INPUT_TYPES : Object.entries(ALL_INPUT_TYPE_LABELS).map(([k, l]) => ({ key: k, label: l })))
              .map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Placeholder (optional)</label>
          <input style={inputStyle} value={form.placeholder} onChange={e => setF('placeholder', e.target.value)} />
        </div>
      </div>

      {form.input_type === 'dropdown' && (
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Dropdown options (comma-separated) *</label>
          <input style={inputStyle} value={form.options_text} onChange={e => setF('options_text', e.target.value)} placeholder="Seed, Series A, Series B, Series C, Bootstrapped, PE-backed" />
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Help text (shown under the field, optional)</label>
        <input style={inputStyle} value={form.help_text} onChange={e => setF('help_text', e.target.value)} placeholder="e.g. Confirm from their last funding round announcement" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textSecondary }}>
          <input type="checkbox" checked={!!form.required} onChange={e => setF('required', e.target.checked)} /> Required
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textSecondary }}>
          <input type="checkbox" checked={!!form.active} onChange={e => setF('active', e.target.checked)} /> Active
        </label>
        <div style={{ flex: 1 }} />
        <Button onClick={onCancel}>Cancel</Button>
        <Button primary onClick={onSave} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create' : 'Save changes'}</Button>
      </div>
    </div>
  )
}

// ============================================================================
// SHARED
// ============================================================================

function Th({ children }) {
  return <th style={{
    padding: '10px 14px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, color: '#8899aa',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }}>{children}</th>
}

function Td({ children }) {
  return <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>{children}</td>
}

function ConfirmModal({ title, body, onCancel, onConfirm }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, borderRadius: 8, padding: 20, maxWidth: 460, width: '90%',
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)', fontFamily: T.font,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.5, marginBottom: 16 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button danger onClick={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  )
}
