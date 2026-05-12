// Stub: full barrier list for this deal.

import { useParams, Link } from 'react-router-dom'
import { theme as T } from '../../lib/theme'

export default function BarriersListPage() {
  const { id } = useParams()
  return (
    <div style={{ padding: 32, fontFamily: T.font }}>
      <Link to={`/deal/${id}`} style={{ fontSize: 12, color: T.primary, textDecoration: 'none' }}>{'← Back to deal'}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginTop: 14 }}>Barriers</h1>
      <p style={{ fontSize: 13, color: T.textSecondary, marginTop: 10 }}>Coming soon — full list of open barriers for this deal.</p>
    </div>
  )
}
