import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Spinner, Card } from '../Shared'
import { notify } from '../../lib/notifications'

// Modules — every module_reference entry with Recommended / Demoed toggles.
// AI suggestions (suggested_by_ai) render as pending-confirmation with the
// reason. Mapped SKUs are read-only. Toggling notifies the AE
// (sc_selected_demo_modules).
export default function ModulesSurface({ deal }) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [refs, setRefs] = useState([])
  const [byKey, setByKey] = useState({})
  const [saving, setSaving] = useState(null)

  useEffect(() => { load() }, [deal?.id])

  async function load() {
    setLoading(true)
    try {
      const [ref, dm] = await Promise.all([
        supabase.from('module_reference').select('module_key, name, description, maps_to_skus, sort_order').eq('active', true).order('sort_order'),
        supabase.from('deal_modules').select('*').eq('deal_id', deal.id),
      ])
      setRefs(ref.data || [])
      setByKey(Object.fromEntries((dm.data || []).map(m => [m.module_key, m])))
    } catch (e) { console.error('[ModulesSurface] load', e) } finally { setLoading(false) }
  }

  async function toggle(ref, patch) {
    setSaving(ref.module_key)
    try {
      const existing = byKey[ref.module_key]
      if (existing) {
        await supabase.from('deal_modules').update(patch).eq('id', existing.id)
      } else {
        await supabase.from('deal_modules').insert({ org_id: deal.org_id, deal_id: deal.id, module_key: ref.module_key, created_by: profile?.id, ...patch })
      }
      await notify({ recipientId: deal.rep_id, actorId: profile?.id, dealId: deal.id, orgId: deal.org_id,
        kind: 'sc_selected_demo_modules', payload: { actor_name: profile?.full_name, deal_company: deal.company_name, module: ref.name } })
      await load()
    } catch (e) { console.error('[ModulesSurface] toggle', e) } finally { setSaving(null) }
  }

  if (loading) return <Spinner />

  return (
    <Card title="Modules">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
        {refs.map(ref => {
          const m = byKey[ref.module_key]
          const aiPending = m?.suggested_by_ai && !m?.is_recommended
          return (
            <div key={ref.module_key} style={{ padding: '10px 12px', border: `1px solid ${m?.is_recommended ? T.primaryBorder : T.borderLight}`, borderRadius: 8, background: m?.is_recommended ? T.primaryLight : T.surface }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{ref.name}</div>
                  {ref.description && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1, lineHeight: 1.4 }}>{ref.description}</div>}
                  {aiPending && (
                    <div style={{ fontSize: 10, color: T.warning, marginTop: 4, fontWeight: 600 }}>
                      AI suggested{m?.recommended_reason ? ` — ${m.recommended_reason}` : ''} · confirm
                    </div>
                  )}
                  {Array.isArray(ref.maps_to_skus) && ref.maps_to_skus.length > 0 && (
                    <div style={{ fontSize: 9, color: T.textMuted, marginTop: 4, fontFamily: T.mono }}>{ref.maps_to_skus.slice(0, 4).join(', ')}{ref.maps_to_skus.length > 4 ? ` +${ref.maps_to_skus.length - 4}` : ''}</div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textSecondary, cursor: saving === ref.module_key ? 'wait' : 'pointer' }}>
                  <input type="checkbox" checked={!!m?.is_recommended} disabled={saving === ref.module_key}
                    onChange={e => toggle(ref, { is_recommended: e.target.checked, suggested_by_ai: m?.suggested_by_ai || false })} />
                  Recommended
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textSecondary, cursor: saving === ref.module_key ? 'wait' : 'pointer' }}>
                  <input type="checkbox" checked={!!m?.is_demoed} disabled={saving === ref.module_key}
                    onChange={e => toggle(ref, { is_demoed: e.target.checked })} />
                  Demoed
                </label>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
