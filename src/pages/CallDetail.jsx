import { useParams, useNavigate } from 'react-router-dom'
import CallAnalysisBody from '../components/CallAnalysisBody'

export default function CallDetail() {
  const { dealId, conversationId } = useParams()
  const navigate = useNavigate()
  return (
    <CallAnalysisBody
      dealId={dealId}
      conversationId={conversationId}
      onBack={() => navigate(`/deal/${dealId}`)}
    />
  )
}
