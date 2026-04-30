// AE-side preview of the customer-facing Evaluation Room.
//
// This route used to render its own copy of the customer UI, which drifted
// from what the actual customer saw. Now it just finds (or creates) a
// synthetic `is_ae_preview=true` viewer for the AE, then redirects to the
// real customer URL `/room/:shareToken?t=:magic`. Whatever the customer
// sees, the AE sees — guaranteed identical.
//
// The dealroom-access edge function (v8+) recognizes is_ae_preview viewers
// and skips view logging, view-counter increments, and first-view
// notifications, so AE previews don't pollute analytics.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Spinner } from '../components/Shared'

// Constant sentinel email used for the AE-preview viewer row. Keeps the
// (deal_room_id, email) unique constraint working without colliding with a
// real customer for the same deal.
const AE_PREVIEW_EMAIL = '__ae_preview__@dealcoach.local'

export default function DealRoomPreview() {
  const { dealId } = useParams()
  const { profile } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function go() {
      try {
        const { data: room, error: roomErr } = await supabase
          .from('deal_rooms')
          .select('id, share_token, enabled')
          .eq('deal_id', dealId)
          .single()
        if (roomErr || !room) throw roomErr || new Error('No deal room found for this deal.')
        if (!room.enabled) throw new Error('This room is disabled. Enable it in the Deal Room config to preview.')

        // Find existing AE preview viewer for this room.
        let viewer = null
        const existing = await supabase
          .from('deal_room_viewers')
          .select('magic_token')
          .eq('deal_room_id', room.id)
          .eq('email', AE_PREVIEW_EMAIL)
          .eq('is_ae_preview', true)
          .maybeSingle()
        if (existing.error && existing.error.code !== 'PGRST116') throw existing.error
        viewer = existing.data

        if (!viewer) {
          const { data: created, error: insErr } = await supabase
            .from('deal_room_viewers')
            .insert({
              deal_room_id: room.id,
              email: AE_PREVIEW_EMAIL,
              name: 'AE preview',
              added_by: profile?.email || 'rep',
              is_ae_preview: true,
            })
            .select('magic_token')
            .single()
          if (insErr) throw insErr
          viewer = created
        }

        if (cancelled) return
        // Replace the preview URL with the real customer URL so the AE's
        // back-button doesn't bounce them through this redirect again.
        window.location.replace(`/room/${room.share_token}?t=${viewer.magic_token}`)
      } catch (e) {
        if (cancelled) return
        console.error('[DealRoomPreview] redirect failed:', e)
        setError(e?.message || 'Failed to open preview')
      }
    }
    go()
    return () => { cancelled = true }
  }, [dealId, profile?.email])

  if (error) {
    return (
      <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: T.font }}>
        <div style={{ maxWidth: 480, padding: 32, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 10 }}>Preview unavailable</div>
          <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.6 }}>{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, fontFamily: T.font }}>
      <Spinner />
      <div style={{ fontSize: 12, color: T.textMuted }}>Opening customer preview…</div>
    </div>
  )
}
