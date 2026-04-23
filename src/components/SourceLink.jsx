import { useNavigate } from 'react-router-dom'
import { theme as T } from '../lib/theme'

export default function SourceLink({ source, sourceConversationId, sourceUrl, transcriptExcerpt, timestampInCall, speaker, quote, dealId }) {
  const nav = useNavigate()

  if (source === 'transcript' || source === 'ai_transcript') {
    if (!sourceConversationId || !dealId) {
      return <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: T.warningLight, color: T.warning, fontWeight: 600 }}>Unverified</span>
    }
    const label = [speaker, timestampInCall].filter(Boolean).join(' \u00B7 ') || 'Transcript'
    const excerpt = transcriptExcerpt || quote || ''
    return (
      <span
        onClick={e => { e.stopPropagation(); nav(`/deal/${dealId}/call/${sourceConversationId}${excerpt ? `?excerpt=${encodeURIComponent(excerpt.substring(0, 100))}` : ''}`) }}
        title={quote || transcriptExcerpt || 'View in transcript'}
        style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', color: '#8b5cf6', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        [{label}]
      </span>
    )
  }

  if (source === 'ai_research' || source === 'research') {
    if (!sourceUrl) {
      return <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: T.primaryLight, color: T.primary, fontWeight: 600 }}>Research</span>
    }
    const hostname = (() => { try { return new URL(sourceUrl).hostname.replace('www.', '') } catch { return 'Source' } })()
    return (
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
        style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: T.primaryLight, border: '1px solid ' + T.primaryBorder, color: T.primary, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
        [{hostname}]
      </a>
    )
  }

  if (source === 'manual') {
    return <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: T.surfaceAlt, color: T.textMuted, fontWeight: 600 }}>Manual</span>
  }

  return <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: T.warningLight, color: T.warning, fontWeight: 600 }}>Unverified</span>
}
