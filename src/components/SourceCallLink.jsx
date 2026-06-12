import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'

// Link to a call's analysis view, with the Granola share link when present.
// Pass `conversation` to skip the fetch, or `conversationId` to resolve it.
// `to` overrides the route base (SC workspace vs AE deal view).
export default function SourceCallLink({ conversationId, conversation, dealId, label, to }) {
  const [conv, setConv] = useState(conversation || null)
  useEffect(() => {
    if (conversation || !conversationId) return
    let live = true
    supabase.from('conversations')
      .select('id, deal_id, call_type, call_date, title, granola_share_url')
      .eq('id', conversationId).maybeSingle()
      .then(({ data }) => { if (live) setConv(data) })
    return () => { live = false }
  }, [conversationId, conversation])

  if (!conv) return null
  const d = dealId || conv.deal_id
  const dateStr = conv.call_date ? new Date(conv.call_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const text = label || `${String(conv.call_type || 'call').replace(/_/g, ' ')}${dateStr ? ` · ${dateStr}` : ''}`
  const href = to || `/deal/${d}/call/${conv.id}`

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Link to={href} style={{ fontSize: 11, color: T.primary, fontWeight: 600, textDecoration: 'none' }}>
        {text} {'↗'}
      </Link>
      {conv.granola_share_url && (
        <a href={conv.granola_share_url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 10, color: T.textMuted, textDecoration: 'underline' }}>Granola</a>
      )}
    </span>
  )
}
