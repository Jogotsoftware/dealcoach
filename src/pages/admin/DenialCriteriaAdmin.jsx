import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Button, Card, Badge, inputStyle, labelStyle } from '../../components/Shared'

// AE Manager admin UI for ae_denial_criteria. Numeric priority (manual management
// per M6 directive — no drag-and-drop for pilot scale). Live reads from the table
// each session; pre-qdc-decision queries the same table at runtime so changes propagate
// without restart.

const blankForm = () => ({
  description: '',
  ai_guidance: '',
  priority: 100,
  active: true,
})

export default function DenialCriteriaAdmin() {
  const { profile } = useAuth()
  const { org } = useOrg()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)         // 'new' | uuid | null
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // criterion id pending delete

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: e } = await supabase
        .from('ae_denial_criteria')
        .select('*')
        .eq('org_id', org.id)
        .order('priority', { ascending: true })
      if (e) throw e
      setRows(data || [])
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (org?.id) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id])

  const startCreate = () => {
    const maxPriority = rows.reduce((m, r) => Math.max(m, r.priority || 0), 0)
    setEditingId('new')
    setForm({ ...blankForm(), priority: maxPriority + 10 })
  }

  const startEdit = (r) => {
    setEditingId(r.id)
    setForm({
      description: r.description ?? '',
      ai_guidance: r.ai_guidance ?? '',
      priority: r.priority ?? 100,
      active: r.active ?? true,
    })
  }

  const cancel = () => { setEditingId(null); setForm(blankForm()) }

  const save = async () => {
    if (!form.description.trim()) { setError('Description is required.'); return }
    if (!form.ai_guidance.trim()) { setError('AI guidance is required (helps the model decide when to fire).'); return }
    setSaving(true)
    setError(null)
    try {
      if (editingId === 'new') {
        const { error: insErr } = await supabase.from('ae_denial_criteria').insert({
          org_id: org.id,
          created_by: profile.id,
          description: form.description.trim(),
          ai_guidance: form.ai_guidance.trim(),
          priority: Number(form.priority) || 100,
          active: !!form.active,
        })
        if (insErr) throw insErr
      } else {
        const { error: updErr } = await supabase
          .from('ae_denial_criteria')
          .update({
            description: form.description.trim(),
            ai_guidance: form.ai_guidance.trim(),
            priority: Number(form.priority) || 100,
            active: !!form.active,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingId)
        if (updErr) throw updErr
      }
      cancel()
      await load()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (r) => {
    try {
      const { error: e } = await supabase
        .from('ae_denial_criteria')
        .update({ active: !r.active, updated_at: new Date().toISOString() })
        .eq('id', r.id)
      if (e) throw e
      await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const doDelete = async (id) => {
    try {
      const { error: e } = await supabase.from('ae_denial_criteria').delete().eq('id', id)
      if (e) throw e
      setConfirmDelete(null)
      await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0, flex: 1 }}>Denial Criteria</h2>
        {editingId == null && (
          <Button primary onClick={startCreate}>+ New criterion</Button>
        )}
      </div>

      <div style={{ padding: 24, maxWidth: 920 }}>
        <Card>
          <div style={{
            padding: 12, background: T.surfaceAlt, borderRadius: 6,
            fontSize: 12, color: T.textSecondary, lineHeight: 1.5, marginBottom: 12,
          }}>
            <strong style={{ color: T.text }}>How this works:</strong> the AI first-glance reviewer applies
            these criteria in priority order (low number = high priority). A lead is denied if any
            criterion fires. <em>Description</em> is shown to the BDR if the criterion is triggered;
            <em> AI guidance</em> tells the model exactly when to fire and is internal-only.
          </div>

          {editingId === 'new' && (
            <EditForm form={form} setF={setF} onSave={save} onCancel={cancel} saving={saving} isNew />
          )}

          {error && (
            <div style={{
              background: T.errorLight, border: `1px solid ${T.error}33`,
              borderRadius: 6, padding: '8px 12px', marginBottom: 12,
              fontSize: 12, color: T.error,
            }}>{error}</div>
          )}

          {loading && <div style={{ padding: 16, color: T.textMuted }}>Loading…</div>}

          {!loading && rows.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
              No denial criteria configured. Create one to start screening BDR submissions.
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map(r => editingId === r.id ? (
                <EditForm key={r.id} form={form} setF={setF} onSave={save} onCancel={cancel} saving={saving} />
              ) : (
                <div key={r.id} style={{
                  border: `1px solid ${T.border}`, borderRadius: 6, padding: 12,
                  background: r.active ? T.surface : T.surfaceAlt,
                  opacity: r.active ? 1 : 0.7,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{
                      minWidth: 36, height: 24, borderRadius: 4,
                      background: T.primaryLight, color: T.primary,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                    }}>{r.priority}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{r.description}</span>
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
        </Card>

        <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted }}>
          <Button disabled title="Coming soon — runs a sample lead through the current criteria set">Test criteria (coming soon)</Button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDeleteModal
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => doDelete(confirmDelete)}
          title="Delete denial criterion?"
          body="The AI will no longer apply this criterion to new submissions. Existing decisions are not affected."
        />
      )}
    </div>
  )
}

function EditForm({ form, setF, onSave, onCancel, saving, isNew }) {
  return (
    <div style={{
      border: `1px solid ${T.primary}40`, borderRadius: 6,
      background: T.primaryLight, padding: 14, marginBottom: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {isNew ? 'New criterion' : 'Edit criterion'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Description (shown to BDR when triggered) *</label>
          <input
            style={inputStyle}
            value={form.description}
            onChange={e => setF('description', e.target.value)}
            placeholder="Lead is outside ICP: under 50 employees AND under $10M annual revenue."
          />
        </div>
        <div>
          <label style={labelStyle}>Priority *</label>
          <input
            type="number"
            style={inputStyle}
            value={form.priority}
            onChange={e => setF('priority', e.target.value.replace(/[^\d]/g, ''))}
            placeholder="100"
          />
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>AI guidance (internal — tells the model when to fire) *</label>
        <textarea
          style={{ ...inputStyle, minHeight: 80, fontFamily: T.font, lineHeight: 1.5, resize: 'vertical' }}
          rows={4}
          value={form.ai_guidance}
          onChange={e => setF('ai_guidance', e.target.value)}
          placeholder="Trigger ONLY when BOTH conditions are met (under 50 emp AND under $10M revenue). If revenue is unknown but employees fit, do not trigger."
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textSecondary }}>
          <input type="checkbox" checked={!!form.active} onChange={e => setF('active', e.target.checked)} />
          Active
        </label>
        <div style={{ flex: 1 }} />
        <Button onClick={onCancel}>Cancel</Button>
        <Button primary onClick={onSave} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create' : 'Save changes'}</Button>
      </div>
    </div>
  )
}

function ConfirmDeleteModal({ onCancel, onConfirm, title, body }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, borderRadius: 8, padding: 20, maxWidth: 440, width: '90%',
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
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
