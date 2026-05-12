// Stub: gate dimension drill-in (Power, Budget, etc.).

import { useParams, Link } from 'react-router-dom'
import { theme as T } from '../../lib/theme'

const LABELS = {
  need_fit: 'Need',
  power: 'Power',
  timeline: 'Timeline',
  budget: 'Budget',
  hygiene: 'Hygiene',
}

export default function GateDimensionPage() {
  const { id, dimension } = useParams()
  const label = LABELS[dimension] || dimension
  return (
    <div style={{ padding: 32, fontFamily: T.font }}>
      <Link to={`/deal/${id}`} style={{ fontSize: 12, color: T.primary, textDecoration: 'none' }}>{'← Back to deal'}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginTop: 14 }}>Gate · {label}</h1>
      <p style={{ fontSize: 13, color: T.textSecondary, marginTop: 10 }}>Coming soon — full drill-in of the {label} dimension's criteria.</p>
    </div>
  )
}
