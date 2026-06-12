import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Spinner, Card, inputStyle } from '../Shared'
import { notify } from '../../lib/notifications'

// Modules to demo — type a module, pick from the FULL pricebook (name + SKU,
// no pricing), it's added to the deal's demo list. The whole pricebook is
// loaded once and searched in-memory with tokenized matching, so partial /
// out-of-order / SKU-fragment queries all hit (e.g. "scaling standard" or
// "GB" both find IFM-GB-STAN "Sage for Scaling Businesses - Standard").
// AI-suggested modules show as one-click chips. Changes notify the AE.
export default function ModulesSurface({ deal }) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])          // deal_modules rows
  const [refByKey, setRefByKey] = useState({})  // module_reference name lookup
  const [suggestions, setSuggestions] = useState([]) // AI-suggested, not yet demoed
  const [products, setProducts] = useState([])  // full pricebook (sku, name)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)

  useEffect(() => { load() }, [deal?.id])

  async function load() {
    setLoading(true)
    try {
      const [dm, ref, prod] = await Promise.all([
        supabase.from('deal_modules').select('*').eq('deal_id', deal.id),
        supabase.from('module_reference').select('module_key, name, maps_to_skus').eq('active', true),
        // Full active pricebook, paged past PostgREST's 1000-row cap just in case.
        supabase.from('products').select('sku, name').eq('active', true).order('name').limit(2000),
      ])
      setRows(dm.data || [])
      setRefByKey(Object.fromEntries((ref.data || []).map(m => [m.module_key, m])))
      setProducts(prod.data || [])
      const demoedKeys = new Set((dm.data || []).filter(m => m.is_demoed).map(m => m.module_key))
      setSuggestions((dm.data || []).filter(m => m.suggested_by_ai && !m.is_demoed && !demoedKeys.has(m.module_key)))
    } catch (e) { console.error('[ModulesSurface] load', e) } finally { setLoading(false) }
  }

  // Tokenized in-memory search: every token must appear in name+sku. Ranks
  // SKU-exact and name-prefix hits first. Shows up to 40.
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 1) return []
    const tokens = s.split(/\s+/).filter(Boolean)
    const scored = []
    for (const p of products) {
      const sku = (p.sku || '').toLowerCase()
      const name = (p.name || '').toLowerCase()
      const hay = name + ' ' + sku
      if (!tokens.every(t => hay.includes(t))) continue
      let rank = 3
      if (sku === s) rank = 0
      else if (name.startsWith(s) || sku.startsWith(s)) rank = 1
      else if (name.includes(s) || sku.includes(s)) rank = 2
      scored.push({ p, rank })
    }
    return scored.sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name)).slice(0, 40).map(x => x.p)
  }, [q, products])

  const demoModules = rows.filter(m => m.is_demoed)
  const nameFor = (m) => m.notes?.replace(/^Shows: /, '') || refByKey[m.module_key]?.name || m.module_key

  async function addModule(sku, name) {
    setBusy(sku)
    try {
      const existing = rows.find(m => m.module_key === sku)
      if (existing) {
        await supabase.from('deal_modules').update({ is_demoed: true }).eq('id', existing.id)
      } else {
        await supabase.from('deal_modules').insert({ org_id: deal.org_id, deal_id: deal.id, module_key: sku, is_demoed: true, notes: name, created_by: profile?.id })
      }
      await notify({ recipientId: deal.rep_id, actorId: profile?.id, dealId: deal.id, orgId: deal.org_id,
        kind: 'sc_selected_demo_modules', payload: { actor_name: profile?.full_name, deal_company: deal.company_name, module: name } })
      setQ(''); setMatches([])
      await load()
    } catch (e) { console.error('[ModulesSurface] add', e) } finally { setBusy(null) }
  }

  async function removeModule(m) {
    setBusy(m.module_key)
    try {
      // Keep AI-suggested rows (just un-demo them); delete user-added ones.
      if (m.suggested_by_ai || m.is_recommended) await supabase.from('deal_modules').update({ is_demoed: false }).eq('id', m.id)
      else await supabase.from('deal_modules').delete().eq('id', m.id)
      await load()
    } catch (e) { console.error('[ModulesSurface] remove', e) } finally { setBusy(null) }
  }

  if (loading) return <Spinner />

  return (
    <Card title="Modules to demo">
      {/* Typeahead over the pricebook */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type a module name or SKU to add…"
          style={{ ...inputStyle }} />
        {q.trim().length >= 1 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 320, overflowY: 'auto' }}>
            {matches.length === 0 ? (
              <div style={{ padding: 10, fontSize: 12, color: T.textMuted }}>No matching modules in the pricebook.</div>
            ) : matches.map(p => (
              <button key={p.sku} disabled={busy === p.sku} onClick={() => addModule(p.sku, p.name)}
                style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 8, padding: '8px 12px', border: 'none', borderBottom: `1px solid ${T.borderLight}`, background: 'transparent', cursor: 'pointer', fontFamily: T.font }}
                onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ flex: 1, fontSize: 13, color: T.text }}>{p.name}</span>
                <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI suggestions — one-click add */}
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Suggested</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map(m => (
              <button key={m.module_key} disabled={busy === m.module_key}
                onClick={() => addModule(m.module_key, refByKey[m.module_key]?.name || m.module_key)}
                title={m.recommended_reason || ''}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 16, border: `1px dashed ${T.warning}`, background: T.warning + '12', color: T.text, fontSize: 12, fontFamily: T.font, cursor: 'pointer' }}>
                + {refByKey[m.module_key]?.name || m.module_key}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The demo list */}
      {demoModules.length === 0 ? (
        <div style={{ fontSize: 13, color: T.textMuted, fontStyle: 'italic' }}>No modules selected to demo yet. Type above to add.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {demoModules.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: `1px solid ${T.borderLight}`, borderRadius: 8, background: T.surfaceAlt }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>{nameFor(m)}</span>
              {!refByKey[m.module_key] && <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{m.module_key}</span>}
              {m.suggested_by_ai && <span style={{ fontSize: 9, fontWeight: 700, color: T.warning }}>AI</span>}
              <button disabled={busy === m.module_key} onClick={() => removeModule(m)} title="Remove"
                style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
