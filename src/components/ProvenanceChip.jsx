import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import SourceCallLink from './SourceCallLink'

// Provenance chip + evidence popover — the trust layer, reused identically
// everywhere an AI-touched value renders. Single-letter chip: M(anual) solid,
// T(ranscript) / R(esearch) / C(omputed) outline. Click opens the verbatim
// evidence — quote + speaker + source call, or URL + date for research —
// plus observed_at and on-demand value history.
//
// props.provenance: { source, quote, speaker, conversation_id, source_url,
//                     source_title, observed_at }
// props.historyKey (optional): { entityId, fieldKey } to enable history.
const META = {
  manual:        { letter: 'M', label: 'Manual',     color: '#7c3aed', solid: true },
  transcript:    { letter: 'T', label: 'Transcript', color: '#2563eb', solid: false },
  ai_transcript: { letter: 'T', label: 'Transcript', color: '#2563eb', solid: false },
  research:      { letter: 'R', label: 'Research',   color: '#0d9488', solid: false },
  ai_research:   { letter: 'R', label: 'Research',   color: '#0d9488', solid: false },
  computed:      { letter: 'C', label: 'Computed',   color: T.textMuted, solid: false },
}

function valueOf(j) {
  if (j == null) return '—'
  if (typeof j === 'object') return j.value != null ? String(j.value) : JSON.stringify(j)
  return String(j)
}

export default function ProvenanceChip({ provenance, dealId, historyKey }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  if (!provenance?.source) return null
  const m = META[provenance.source] || { letter: '?', label: provenance.source, color: T.textMuted, solid: false }

  async function loadHistory() {
    if (!historyKey?.entityId || !historyKey?.fieldKey) return
    setLoadingHistory(true)
    try {
      const { data } = await supabase.from('custom_field_value_history')
        .select('old_value_json, new_value_json, change_source, created_at')
        .eq('entity_id', historyKey.entityId).eq('field_key', historyKey.fieldKey)
        .order('created_at', { ascending: false }).limit(10)
      setHistory(data || [])
    } catch (e) { console.error('[ProvenanceChip] history', e); setHistory([]) }
    finally { setLoadingHistory(false) }
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen(o => !o)} title={m.label} aria-label={`Source: ${m.label}`}
        style={{
          width: 18, height: 18, borderRadius: 9, fontSize: 10, fontWeight: 800,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: m.solid ? m.color : m.color + '15',
          color: m.solid ? '#fff' : m.color,
          border: `1px solid ${m.color}${m.solid ? '' : '55'}`,
          cursor: 'pointer', fontFamily: T.font, lineHeight: 1, flexShrink: 0,
        }}>
        {m.letter}
      </button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <span role="dialog" style={{
            position: 'absolute', top: '130%', left: 0, zIndex: 601, width: 320,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)', padding: 12, display: 'block',
          }}>
            <span style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: m.color, marginBottom: 6 }}>{m.label}</span>
            {provenance.quote && (
              <span style={{ display: 'block', fontSize: 12, color: T.text, fontStyle: 'italic', lineHeight: 1.5, marginBottom: 6 }}>{'“'}{provenance.quote}{'”'}</span>
            )}
            {(provenance.speaker || provenance.observed_at) && (
              <span style={{ display: 'block', fontSize: 11, color: T.textSecondary }}>
                {provenance.speaker && <>Said by <strong>{provenance.speaker}</strong>{provenance.observed_at ? ' · ' : ''}</>}
                {provenance.observed_at && new Date(provenance.observed_at).toLocaleDateString()}
              </span>
            )}
            {provenance.source_url && (
              <a href={provenance.source_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', fontSize: 11, color: T.primary, marginTop: 4, wordBreak: 'break-all' }}>
                {provenance.source_title || provenance.source_url}
              </a>
            )}
            {provenance.conversation_id && (
              <span style={{ display: 'block', marginTop: 6 }}>
                <SourceCallLink conversationId={provenance.conversation_id} dealId={dealId} />
              </span>
            )}
            {historyKey?.entityId && historyKey?.fieldKey && (
              <span style={{ display: 'block', marginTop: 8, borderTop: `1px solid ${T.borderLight}`, paddingTop: 6 }}>
                {history === null ? (
                  <button onClick={loadHistory} disabled={loadingHistory}
                    style={{ background: 'none', border: 'none', color: T.primary, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: T.font, padding: 0 }}>
                    {loadingHistory ? 'Loading…' : 'View history'}
                  </button>
                ) : history.length === 0 ? (
                  <span style={{ fontSize: 11, color: T.textMuted }}>No prior values.</span>
                ) : (
                  <span style={{ display: 'block' }}>
                    {history.map((h, i) => (
                      <span key={i} style={{ display: 'block', fontSize: 10, color: T.textSecondary, marginBottom: 2 }}>
                        {valueOf(h.old_value_json)} → {valueOf(h.new_value_json)} · {h.change_source || '?'} · {new Date(h.created_at).toLocaleDateString()}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            )}
          </span>
        </>
      )}
    </span>
  )
}
