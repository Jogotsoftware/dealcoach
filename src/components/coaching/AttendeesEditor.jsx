// AttendeesEditor — manual entry of internal team participants for a conversation.
// Lives on the conversation detail page. v1: manual entry only; calendar sync deferred.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'

const ROLE_OPTIONS = [
  { key: 'rep',         label: 'Rep / AE' },
  { key: 'sc',          label: 'SC' },
  { key: 'tsc',         label: 'TSC' },
  { key: 'rvp',         label: 'RVP' },
  { key: 'avp',         label: 'AVP' },
  { key: 'ps_partner',  label: 'PS Partner' },
  { key: 'ken_spelman', label: 'Ken Spelman' },
  { key: 'other',       label: 'Other' },
]

export default function AttendeesEditor({ conversationId, orgId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [roleLabel, setRoleLabel] = useState('rep')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('conversation_attendees')
          .select('id, display_name, role_label, source, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
        if (!cancelled) {
          if (error) console.error('AttendeesEditor load', error)
          setRows(data || [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (conversationId) load()
    return () => { cancelled = true }
  }, [conversationId])

  async function addAttendee() {
    const name = displayName.trim()
    if (!name || !orgId) return
    try {
      const { data, error } = await supabase
        .from('conversation_attendees')
        .insert({
          conversation_id: conversationId,
          org_id: orgId,
          display_name: name,
          role_label: roleLabel,
          source: 'manual',
        })
        .select()
        .single()
      if (error) { alert('Add attendee failed: ' + error.message); return }
      setRows((r) => [...r, data])
      setDisplayName('')
      setAdding(false)
    } catch (e) {
      console.error('addAttendee threw', e)
    }
  }

  async function removeAttendee(id) {
    try {
      const { error } = await supabase.from('conversation_attendees').delete().eq('id', id)
      if (error) { alert('Remove failed: ' + error.message); return }
      setRows((r) => r.filter((x) => x.id !== id))
    } catch (e) {
      console.error('removeAttendee threw', e)
    }
  }

  const headerStyle = { fontSize: 11, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }
  const chipStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 16, padding: '4px 10px', fontSize: 12, color: T.text }
  const xStyle = { cursor: 'pointer', color: T.textMuted, fontWeight: 700, fontSize: 14, lineHeight: 1 }

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 12 }}>
      <div style={headerStyle}>Internal team on this call</div>
      {loading ? (
        <div style={{ fontSize: 12, color: T.textMuted }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {rows.length === 0 && <div style={{ fontSize: 12, color: T.textMuted }}>No attendees recorded.</div>}
          {rows.map((r) => (
            <span key={r.id} style={chipStyle}>
              <span style={{ fontWeight: 600 }}>{r.display_name}</span>
              {r.role_label && <span style={{ color: T.textMuted }}>{`(${r.role_label})`}</span>}
              <span onClick={() => removeAttendee(r.id)} style={xStyle} title="Remove">{'×'}</span>
            </span>
          ))}
          {!adding && (
            <button onClick={() => setAdding(true)}
              style={{ background: T.surface, border: `1px dashed ${T.border}`, borderRadius: 16, padding: '4px 10px', fontSize: 12, color: T.primary, cursor: 'pointer', fontFamily: T.font }}>
              + Add attendee
            </button>
          )}
          {adding && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <input
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addAttendee(); if (e.key === 'Escape') { setAdding(false); setDisplayName('') } }}
                placeholder="Name"
                style={{ fontSize: 12, padding: '4px 8px', border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, outline: 'none', width: 140 }}
              />
              <select
                value={roleLabel}
                onChange={(e) => setRoleLabel(e.target.value)}
                style={{ fontSize: 12, padding: '4px 6px', border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, background: T.surface }}>
                {ROLE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button onClick={addAttendee} style={{ background: T.primary, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: T.font }}>Add</button>
              <button onClick={() => { setAdding(false); setDisplayName('') }} style={{ background: T.surface, color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 12, cursor: 'pointer', fontFamily: T.font }}>Cancel</button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
