import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Card, Badge, Button, Spinner } from '../../components/Shared'
import { humanizePagePath } from '../../lib/feedbackContext'

const STATUS_OPTIONS = ['new', 'open', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate']
const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical']
const TYPE_OPTIONS = ['bug', 'feature_request', 'confusion', 'love_it', 'hate_it', 'ai_quality', 'performance', 'design', 'general']

const severityColors = { low: T.textMuted, medium: T.warning, high: '#e67e22', critical: T.error }
const statusColors = { new: T.primary, open: T.primary, triaged: T.warning, in_progress: '#8b5cf6', resolved: T.success, wont_fix: T.textMuted, duplicate: T.textMuted }
const typeColors = { bug: T.error, feature_request: T.primary, confusion: T.warning, love_it: T.success, hate_it: T.error, ai_quality: '#8b5cf6', performance: '#e67e22', design: '#0ea5e9', general: T.textMuted }

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function BetaFeedback() {
  const { profile } = useAuth()
  const [feedback, setFeedback] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(['new', 'open', 'triaged', 'in_progress'])
  const [severityFilter, setSeverityFilter] = useState([])
  const [typeFilter, setTypeFilter] = useState([])
  const [selected, setSelected] = useState(new Set())

  useEffect(() => { loadFeedback() }, [])

  async function loadFeedback() {
    setLoading(true)
    const { data } = await supabase.from('beta_feedback').select('*').order('created_at', { ascending: false }).limit(500)
    setFeedback(data || [])
    setLoading(false)
  }

  async function updateField(id, field, value) {
    await supabase.from('beta_feedback').update({ [field]: value }).eq('id', id)
    setFeedback(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f))
  }

  async function markResolved(id) {
    const updates = { status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: profile.id }
    await supabase.from('beta_feedback').update(updates).eq('id', id)
    setFeedback(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  async function bulkAction(action) {
    const ids = [...selected]
    if (!ids.length) return
    let updates = {}
    if (action === 'triaged') updates = { status: 'triaged' }
    else if (action === 'wont_fix') updates = { status: 'wont_fix' }
    for (const id of ids) {
      await supabase.from('beta_feedback').update(updates).eq('id', id)
    }
    setFeedback(prev => prev.map(f => ids.includes(f.id) ? { ...f, ...updates } : f))
    setSelected(new Set())
  }

  function toggleFilter(arr, setArr, val) {
    setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val])
  }

  const filtered = feedback.filter(f => {
    if (statusFilter.length && !statusFilter.includes(f.status)) return false
    if (severityFilter.length && !severityFilter.includes(f.severity)) return false
    if (typeFilter.length && !typeFilter.includes(f.feedback_type)) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(f.title || '').toLowerCase().includes(q) && !(f.description || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const chipStyle = (active, color) => ({
    padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none',
    background: active ? (color || T.primary) + '20' : T.surfaceAlt,
    color: active ? (color || T.primary) : T.textMuted, fontFamily: T.font,
  })

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Beta Feedback ({filtered.length})</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {selected.size > 0 && (
            <>
              <Button onClick={() => bulkAction('triaged')} style={{ padding: '4px 10px', fontSize: 11 }}>Mark Triaged ({selected.size})</Button>
              <Button onClick={() => bulkAction('wont_fix')} style={{ padding: '4px 10px', fontSize: 11 }}>Won't Fix ({selected.size})</Button>
            </>
          )}
        </div>
      </div>

      <div style={{ padding: '12px 24px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title or description..."
            style={{ padding: '6px 12px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, width: 240, background: T.surface, color: T.text, fontFamily: T.font }} />
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: T.textMuted, padding: '4px 0', fontWeight: 600 }}>Status:</span>
            {STATUS_OPTIONS.map(s => <button key={s} onClick={() => toggleFilter(statusFilter, setStatusFilter, s)} style={chipStyle(statusFilter.includes(s), statusColors[s])}>{s.replace(/_/g, ' ')}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: T.textMuted, padding: '4px 0', fontWeight: 600 }}>Severity:</span>
            {SEVERITY_OPTIONS.map(s => <button key={s} onClick={() => toggleFilter(severityFilter, setSeverityFilter, s)} style={chipStyle(severityFilter.includes(s), severityColors[s])}>{s}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: T.textMuted, padding: '4px 0', fontWeight: 600 }}>Type:</span>
            {TYPE_OPTIONS.map(t => <button key={t} onClick={() => toggleFilter(typeFilter, setTypeFilter, t)} style={chipStyle(typeFilter.includes(t), typeColors[t])}>{t.replace(/_/g, ' ')}</button>)}
          </div>
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: T.textMuted, fontSize: 13 }}>No feedback matching filters</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th style={{ width: 28, padding: '6px 4px' }}><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={e => setSelected(e.target.checked ? new Set(filtered.map(f => f.id)) : new Set())} /></th>
                {['Created', 'User', 'Page', 'Type', 'Severity', 'Title', 'Status'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: '8px 4px' }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(f.id)} onChange={() => setSelected(prev => { const n = new Set(prev); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })} /></td>
                  <td style={{ padding: '8px', color: T.textMuted, whiteSpace: 'nowrap' }} onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}>{timeAgo(f.created_at)}</td>
                  <td style={{ padding: '8px' }} onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}>{f.user_name || 'Unknown'}</td>
                  <td style={{ padding: '8px', color: T.textMuted }} onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}>{humanizePagePath(f.page_route || '/')}</td>
                  <td style={{ padding: '8px' }} onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}><Badge color={typeColors[f.feedback_type] || T.textMuted}>{(f.feedback_type || '').replace(/_/g, ' ')}</Badge></td>
                  <td style={{ padding: '8px' }} onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}><Badge color={severityColors[f.severity] || T.textMuted}>{f.severity}</Badge></td>
                  <td style={{ padding: '8px', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }} onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}>{f.title}</td>
                  <td style={{ padding: '8px' }} onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}><Badge color={statusColors[f.status] || T.textMuted}>{(f.status || '').replace(/_/g, ' ')}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Expanded detail */}
        {expandedId && (() => {
          const f = feedback.find(fb => fb.id === expandedId)
          if (!f) return null
          return (
            <Card style={{ marginTop: 8, borderLeft: `3px solid ${typeColors[f.feedback_type] || T.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>{f.title}</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>{f.user_name} ({f.user_email}) -- {new Date(f.created_at).toLocaleString()}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <select value={f.status} onChange={e => updateField(f.id, 'status', e.target.value)} style={{ padding: '4px 8px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, cursor: 'pointer' }}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                  <Button onClick={() => markResolved(f.id)} style={{ padding: '4px 10px', fontSize: 11 }}>Resolve</Button>
                </div>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: T.text, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{f.description}</div>

              {f.expected_behavior && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>Expected</div><div style={{ fontSize: 12, color: T.text, whiteSpace: 'pre-wrap' }}>{f.expected_behavior}</div></div>}
              {f.actual_behavior && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>Actual</div><div style={{ fontSize: 12, color: T.text, whiteSpace: 'pre-wrap' }}>{f.actual_behavior}</div></div>}
              {f.reproduction_steps && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>Steps to Reproduce</div><div style={{ fontSize: 12, color: T.text, whiteSpace: 'pre-wrap' }}>{f.reproduction_steps}</div></div>}

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, fontSize: 11 }}>
                {f.deal_id && <a href={`/deal/${f.deal_id}`} style={{ color: T.primary, textDecoration: 'none' }}>View Deal</a>}
                {f.conversation_id && f.deal_id && <a href={`/deal/${f.deal_id}/call/${f.conversation_id}`} style={{ color: T.primary, textDecoration: 'none' }}>View Call</a>}
                {f.page_url && <a href={f.page_url} style={{ color: T.primary, textDecoration: 'none', fontSize: 10 }}>{f.page_url}</a>}
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Priority (0-100)</label>
                  <input type="number" min="0" max="100" value={f.priority || 0} onChange={e => updateField(f.id, 'priority', Number(e.target.value))}
                    style={{ padding: '4px 8px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, width: 70, fontFamily: T.font }} />
                </div>
                <div style={{ flex: 3, minWidth: 200 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Admin Notes</label>
                  <textarea defaultValue={f.admin_notes || ''} onBlur={e => updateField(f.id, 'admin_notes', e.target.value)} placeholder="Internal notes..."
                    style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, minHeight: 50, resize: 'vertical', fontFamily: T.font, color: T.text }} />
                </div>
              </div>

              {f.browser_info && typeof f.browser_info === 'object' && Object.keys(f.browser_info).length > 0 && (
                <details style={{ marginTop: 8, fontSize: 11, color: T.textMuted }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Browser Info</summary>
                  <pre style={{ fontSize: 10, fontFamily: T.mono, background: T.surfaceAlt, padding: 8, borderRadius: 4, overflow: 'auto', marginTop: 4 }}>{JSON.stringify(f.browser_info, null, 2)}</pre>
                </details>
              )}
            </Card>
          )
        })()}
      </div>
    </div>
  )
}
