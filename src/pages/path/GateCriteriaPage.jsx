// Stub: full Sage gate criteria page.

import { useParams, Link } from 'react-router-dom'
import { theme as T } from '../../lib/theme'

export default function GateCriteriaPage() {
  const { id } = useParams()
  return (
    <div style={{ padding: 32, fontFamily: T.font }}>
      <Link to={`/deal/${id}`} style={{ fontSize: 12, color: T.primary, textDecoration: 'none' }}>{'← Back to deal'}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginTop: 14 }}>Gate criteria</h1>
      <p style={{ fontSize: 13, color: T.textSecondary, marginTop: 10 }}>Coming soon — full Sage canon gate criteria for this deal.</p>
    </div>
  )
}
