// EOMHeaderStrip — thin amber accent strip at the top of the deal page during the
// month-end close window for deals closing in the current month.
//
// Activates when is_eom_window() returns true AND the deal's target_close_date is in
// the current month. is_eom_window() is queried once per page load via supabase.rpc().

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'

// Module-level cache: is_eom_window() result for the current session.
// Frontend caches client-side so we don't query 50 times per page.
let _eomCache = null

async function getEomWindow() {
  if (_eomCache !== null) return _eomCache
  try {
    const { data, error } = await supabase.rpc('is_eom_window')
    if (error) {
      console.error('is_eom_window rpc', error)
      _eomCache = false
    } else {
      _eomCache = data === true
    }
  } catch (e) {
    console.error('is_eom_window threw', e)
    _eomCache = false
  }
  return _eomCache
}

function isCurrentMonth(dateStr) {
  if (!dateStr) return false
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export default function EOMHeaderStrip({ dealCloseDate }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      const inWindow = await getEomWindow()
      if (cancelled) return
      setVisible(Boolean(inWindow) && isCurrentMonth(dealCloseDate))
    }
    check()
    return () => { cancelled = true }
  }, [dealCloseDate])

  if (!visible) return null

  return (
    <div style={{
      background: T.warningLight,
      borderTop: `2px solid ${T.warning}`,
      borderBottom: `1px solid ${T.border}`,
      padding: '6px 24px',
      fontSize: 12,
      fontWeight: 600,
      color: T.text,
      textAlign: 'center',
      letterSpacing: '0.02em',
    }}>
      Month-end close window — EOD update expected daily
    </div>
  )
}
