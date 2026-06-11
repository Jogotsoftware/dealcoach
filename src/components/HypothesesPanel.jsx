import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Badge, Button } from './Shared'

// Quarantined AI-hypotheses surface — AE deal view ONLY. Visually distinct
// from facts; never rendered on the SC page, DealRoom, proposals, or any
// client-facing surface. Lifecycle: open -> confirmed / refuted / dismissed.
export default function HypothesesPanel({ dealId }) {
  const [hyps, setHyps] = useState(null)
  const [busy, setBusy] = useState(null)
  const [showResolved, setShowResolved] = useState(false)

  async function load() {
    try {
      const { data } = await supabase.from('deal_hypotheses')
        .select('*').eq('deal_id', dealId).order('created_at', { ascending: false })
      setHyps(data || [])
    } catch (e) { console.error('[HypothesesPanel] load:', e); setHyps([]) }
  }
  useEffect(() => { if (dealId) load() }, [dealId])

  async function setStatus(h, status) {
    setBusy(h.id)
    try {
      await supabase.from('deal_hypotheses').update({ status, resolved_at: new Date().toISOString() }).eq('id', h.id)
      await load()
    } catch (e) { console.error('[HypothesesPanel] update:', e) } finally { setBusy(null) }
  }

  if (!hyps) return null
  const open = hyps.filter(h => h.status === 'open')
  const resolved = hyps.filter(h => h.status !== 'open')
  if (!hyps.length) return null

  return (
    <div style={{
      background: 'repeating-linear-gradient(45deg, #faf8ff, #faf8ff 12px, #f5f1fd 12px, #f5f1fd 24px)',
      border: `1px dashed #7c3aed60`, borderRadius: 8, padding: 14, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#5b21b6' }}>AI hypotheses</span>
        <Badge color="#7c3aed">{open.length} open</Badge>
        <div style={{ flex: 1 }} />
        {resolved.length > 0 && (
          <button onClick={() => setShowResolved(s => !s)}
            style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: T.font, textDecoration: 'underline' }}>
            {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {(showResolved ? hyps : open).map(h => (
          <div key={h.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: '#ffffffcc', borderRadius: 6, alignItems: 'flex-start', flexWrap: 'wrap', opacity: h.status === 'open' ? 1 : 0.6 }}>
            <Badge color={h.hypothesis_type === 'green_flag' ? T.success : T.error}>
              {h.hypothesis_type === 'green_flag' ? 'Green' : 'Red'}
            </Badge>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{h.hypothesis}</div>
              {h.reasoning && <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>{h.reasoning}</div>}
              <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                {h.generated_by === 'research' ? 'From research' : 'From transcripts'}
                {h.confidence ? ` · ${h.confidence} confidence` : ''}
                {h.status !== 'open' ? ` · ${h.status}` : ''}
              </div>
            </div>
            {h.status === 'open' && (
              <div style={{ display: 'flex', gap: 6 }}>
                <Button disabled={busy === h.id} onClick={() => setStatus(h, 'confirmed')} style={{ padding: '3px 10px', fontSize: 10 }}>Confirmed</Button>
                <Button disabled={busy === h.id} onClick={() => setStatus(h, 'refuted')} style={{ padding: '3px 10px', fontSize: 10 }}>Refuted</Button>
                <Button disabled={busy === h.id} onClick={() => setStatus(h, 'dismissed')} style={{ padding: '3px 10px', fontSize: 10 }}>Dismiss</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
