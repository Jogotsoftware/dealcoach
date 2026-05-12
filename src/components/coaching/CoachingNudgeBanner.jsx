// CoachingNudgeBanner — renders active non-dismissed coaching_nudges for a deal.
// Used on DealDetail below the deal header. Compacts to a "N nudges open" dropdown when > 2.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'

function severityStyles(severity) {
  switch (severity) {
    case 'urgent':    return { border: T.error,   bg: 'rgba(220, 53, 69, 0.06)',  dot: T.error }
    case 'attention': return { border: T.warning, bg: T.warningLight,             dot: T.warning }
    case 'info':
    default:          return { border: T.border,  bg: T.surfaceAlt,                dot: T.textMuted }
  }
}

function NudgeRow({ nudge, onDismiss, onAction }) {
  const s = severityStyles(nudge.severity)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: s.bg, border: `1px solid ${s.border}`, borderRadius: T.radius, marginBottom: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot, flex: '0 0 8px' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{nudge.title}</div>
        <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{nudge.message}</div>
      </div>
      {nudge.action_label && nudge.action_target && (
        <button onClick={() => onAction(nudge)}
          style={{ background: T.surface, color: T.primary, border: `1px solid ${T.primaryBorder}`, borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: T.font, fontWeight: 600 }}>
          {nudge.action_label}
        </button>
      )}
      <button onClick={() => onDismiss(nudge.id)}
        title="Dismiss"
        style={{ background: 'transparent', color: T.textMuted, border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>
        {'×'}
      </button>
    </div>
  )
}

export default function CoachingNudgeBanner({ dealId, userId }) {
  const [nudges, setNudges] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const nowIso = new Date().toISOString()
        const { data, error } = await supabase
          .from('coaching_nudges')
          .select('id, nudge_type, severity, title, message, action_label, action_target, created_at, expires_at')
          .eq('deal_id', dealId)
          .eq('dismissed', false)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order('created_at', { ascending: false })
        if (!cancelled) {
          if (error) console.error('CoachingNudgeBanner load', error)
          setNudges(data || [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (dealId) load()
    return () => { cancelled = true }
  }, [dealId])

  async function handleDismiss(id) {
    setNudges((n) => n.filter((x) => x.id !== id))
    try {
      await supabase.from('coaching_nudges').update({
        dismissed: true,
        dismissed_at: new Date().toISOString(),
        dismissed_by: userId || null,
      }).eq('id', id)
    } catch (e) {
      console.error('handleDismiss threw', e)
    }
  }

  function handleAction(nudge) {
    // action_target is a URL path with optional query params; just navigate.
    if (!nudge.action_target) return
    if (nudge.action_target.startsWith('http')) {
      window.open(nudge.action_target, '_blank', 'noopener')
    } else {
      window.location.assign(nudge.action_target)
    }
  }

  if (loading || nudges.length === 0) return null

  // <= 2 nudges: render all inline. > 2: compact to expandable summary.
  if (nudges.length <= 2) {
    return (
      <div style={{ padding: '8px 24px 0 24px' }}>
        {nudges.map((n) => <NudgeRow key={n.id} nudge={n} onDismiss={handleDismiss} onAction={handleAction} />)}
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 24px 0 24px' }}>
      <div onClick={() => setExpanded((x) => !x)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: T.text, fontWeight: 600, background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 16, padding: '4px 12px' }}>
        {nudges.length} nudges open
        <span style={{ fontSize: 10, color: T.textMuted }}>{expanded ? '▴' : '▾'}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          {nudges.map((n) => <NudgeRow key={n.id} nudge={n} onDismiss={handleDismiss} onAction={handleAction} />)}
        </div>
      )}
    </div>
  )
}
