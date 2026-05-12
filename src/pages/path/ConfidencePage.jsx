// Stub: full glass-box confidence page (factor breakdown, calibration, "what would move this most").

import { useParams, Link } from 'react-router-dom'
import { theme as T } from '../../lib/theme'

export default function ConfidencePage() {
  const { id } = useParams()
  return (
    <div style={{ padding: 32, fontFamily: T.font }}>
      <Link to={`/deal/${id}`} style={{ fontSize: 12, color: T.primary, textDecoration: 'none' }}>{'← Back to deal'}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginTop: 14 }}>Confidence</h1>
      <p style={{ fontSize: 13, color: T.textSecondary, marginTop: 10 }}>Coming soon — full glass-box view of confidence factors, org calibration, and the biggest levers.</p>
    </div>
  )
}
