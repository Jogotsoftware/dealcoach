// Stub: barrier detail page (history, evidence, suggested coaching).

import { useParams, Link } from 'react-router-dom'
import { theme as T } from '../../lib/theme'

export default function BarrierDetailPage() {
  const { id, barrierId } = useParams()
  return (
    <div style={{ padding: 32, fontFamily: T.font }}>
      <Link to={`/deal/${id}`} style={{ fontSize: 12, color: T.primary, textDecoration: 'none' }}>{'← Back to deal'}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginTop: 14 }}>Barrier detail</h1>
      <p style={{ fontSize: 13, color: T.textSecondary, marginTop: 10 }}>Coming soon — full barrier detail (history, evidence, AI-suggested coaching).</p>
      <p style={{ fontSize: 11, color: T.textMuted, marginTop: 4, fontFamily: T.mono }}>state_id: {barrierId}</p>
    </div>
  )
}
