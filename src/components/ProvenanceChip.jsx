import { useState } from 'react'
import { theme as T } from '../lib/theme'

// Source chip + expandable evidence for any provenance-carrying value.
// props.provenance: { source, quote, speaker, conversation_id, source_url,
//                     source_title, observed_at }
const SOURCE_META = {
  manual:     { label: 'Manual',     color: '#7c3aed' },
  transcript: { label: 'Transcript', color: '#2563eb' },
  ai_transcript: { label: 'Transcript', color: '#2563eb' },
  research:   { label: 'Research',   color: '#0d9488' },
  ai_research: { label: 'Research',  color: '#0d9488' },
  computed:   { label: 'Computed',   color: T.textMuted },
}

export default function ProvenanceChip({ provenance, dealId }) {
  const [open, setOpen] = useState(false)
  if (!provenance?.source) return null
  const meta = SOURCE_META[provenance.source] || { label: provenance.source, color: T.textMuted }
  const hasEvidence = provenance.quote || provenance.source_url

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => hasEvidence && setOpen(o => !o)}
        title={hasEvidence ? 'Show evidence' : meta.label}
        style={{
          padding: '1px 8px', borderRadius: 9, fontSize: 9, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.04em',
          background: meta.color + '15', color: meta.color,
          border: `1px solid ${meta.color}30`,
          cursor: hasEvidence ? 'pointer' : 'default', fontFamily: T.font,
        }}>
        {meta.label}
      </button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <span style={{
            position: 'absolute', top: '120%', left: 0, zIndex: 601, width: 340,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)', padding: 12, display: 'block',
          }}>
            {provenance.quote && (
              <span style={{ display: 'block', fontSize: 12, color: T.text, fontStyle: 'italic', lineHeight: 1.5, marginBottom: 6 }}>
                {'“'}{provenance.quote}{'”'}
              </span>
            )}
            <span style={{ display: 'block', fontSize: 11, color: T.textSecondary }}>
              {provenance.speaker && <>Said by <strong>{provenance.speaker}</strong>{' '}</>}
              {provenance.observed_at && <>on {new Date(provenance.observed_at).toLocaleDateString()}</>}
            </span>
            {provenance.source_url && (
              <a href={provenance.source_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', fontSize: 11, color: T.primary, marginTop: 4, wordBreak: 'break-all' }}>
                {provenance.source_title || provenance.source_url}
              </a>
            )}
            {provenance.conversation_id && dealId && (
              <a href={`/deal/${dealId}/call/${provenance.conversation_id}`}
                style={{ display: 'block', fontSize: 11, color: T.primary, marginTop: 4 }}>
                Open the call
              </a>
            )}
          </span>
        </>
      )}
    </span>
  )
}
