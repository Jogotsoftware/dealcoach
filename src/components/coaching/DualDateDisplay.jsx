// DualDateDisplay — shows Close + MSP target dates side-by-side when they differ.
// If they match exactly, shows only one. If no MSP target_close_date, shows only the deal close.
// Pure information density: no interaction, no warning color, no nudge.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T, formatDate } from '../../lib/theme'

export default function DualDateDisplay({ dealId, dealCloseDate }) {
  const [mspDate, setMspDate] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await supabase
          .from('msp_customer_portals')
          .select('target_close_date')
          .eq('deal_id', dealId)
          .maybeSingle()
        if (!cancelled) {
          setMspDate(data?.target_close_date || null)
          setLoaded(true)
        }
      } catch (e) {
        console.error('DualDateDisplay load', e)
        if (!cancelled) setLoaded(true)
      }
    }
    if (dealId) load()
    return () => { cancelled = true }
  }, [dealId])

  if (!loaded) return null
  if (!dealCloseDate && !mspDate) return null

  const same = mspDate && dealCloseDate && String(mspDate).slice(0, 10) === String(dealCloseDate).slice(0, 10)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, fontSize: 12, color: T.textSecondary }}>
      <span style={{ color: T.textMuted, fontWeight: 600 }}>Close:</span>
      <span style={{ color: T.text, fontWeight: 600 }}>{formatDate(dealCloseDate)}</span>
      {mspDate && !same && (
        <span style={{ color: T.textMuted }}>{` (MSP target: ${formatDate(mspDate)})`}</span>
      )}
    </span>
  )
}
