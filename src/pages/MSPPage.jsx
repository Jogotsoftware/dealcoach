import { useParams } from 'react-router-dom'
import MSPEditor, { displayMspDate, displayMspColor } from '../components/MSPEditor'

// Re-export the display helpers so existing import sites
// (e.g. QuoteBuilder, DealDetail) keep working without churn.
export { displayMspDate, displayMspColor }

export default function MSPPage() {
  const { dealId } = useParams()
  return <MSPEditor dealId={dealId} mode="standalone" />
}
