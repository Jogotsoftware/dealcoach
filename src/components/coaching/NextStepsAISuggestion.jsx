// NextStepsAISuggestion — displays Lumen's red/green suggestion below the AE's next-steps editor.
// Informational only. AE's choice is never overwritten. No friction if they diverge.

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'

function statusDot(status) {
  if (status === 'red')   return T.error
  if (status === 'green') return T.success
  return T.textMuted
}

export default function NextStepsAISuggestion({ dealId, aiStatus, aiReasoning, aiEvaluatedAt, onRefreshed }) {
  const [refreshing, setRefreshing] = useState(false)
  const [localStatus, setLocalStatus] = useState(aiStatus || null)
  const [localReasoning, setLocalReasoning] = useState(aiReasoning || null)

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      const { data, error } = await supabase.functions.invoke('suggest-next-steps-status', {
        body: { deal_id: dealId },
      })
      if (error) {
        console.error('suggest-next-steps-status invoke', error)
        return
      }
      if (data?.success) {
        setLocalStatus(data.ai_status)
        setLocalReasoning(data.ai_reasoning)
        if (typeof onRefreshed === 'function') onRefreshed(data)
      }
    } catch (e) {
      console.error('NextStepsAISuggestion refresh threw', e)
    } finally {
      setRefreshing(false)
    }
  }

  const dot = statusDot(localStatus)
  const statusText = localStatus ? localStatus.toUpperCase() : null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '8px 10px',
      background: T.surfaceAlt,
      border: `1px dashed ${T.border}`,
      borderRadius: 6,
      fontSize: 12,
      color: T.textSecondary,
      marginTop: 6,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flex: '0 0 8px', marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
        {localStatus ? (
          <>
            <span style={{ color: T.text, fontWeight: 700 }}>Lumen suggests: {statusText}</span>
            {localReasoning && <span style={{ color: T.textSecondary }}> {'— '} {localReasoning}</span>}
          </>
        ) : (
          <span style={{ fontStyle: 'italic' }}>Lumen analyzing…</span>
        )}
      </div>
      <button onClick={refresh} disabled={refreshing}
        style={{
          background: 'transparent',
          color: refreshing ? T.textMuted : T.primary,
          border: 'none',
          cursor: refreshing ? 'default' : 'pointer',
          fontFamily: T.font,
          fontSize: 12,
          fontWeight: 600,
          padding: 0,
          textDecoration: 'underline',
        }}>
        {refreshing ? 'Refreshing…' : 'Refresh suggestion'}
      </button>
    </div>
  )
}
