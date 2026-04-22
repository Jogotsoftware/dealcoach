import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Spinner } from './Shared'

export default function ModuleAccessPicker({ value, onChange, orgId }) {
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const isInherit = value === null

  useEffect(() => { loadModules() }, [orgId])

  async function loadModules() {
    setLoading(true)
    let query = supabase.from('modules').select('module_key, module_name, description, is_premium').eq('active', true).order('sort_order')
    if (orgId) {
      const { data: orgKeys } = await supabase.rpc('resolve_org_modules', { p_org_id: orgId })
      if (orgKeys?.length) query = query.in('module_key', orgKeys)
    }
    const { data } = await query
    setModules(data || [])
    setLoading(false)
  }

  function toggleModule(key) {
    if (isInherit) return
    const current = value || []
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    onChange(next)
  }

  function setMode(inherit) {
    if (inherit) onChange(null)
    else onChange(modules.map(m => m.module_key))
  }

  if (loading) return <Spinner />

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 2, marginBottom: 10, background: T.surfaceAlt, borderRadius: 6, padding: 2, border: `1px solid ${T.border}` }}>
        <button onClick={() => setMode(true)} style={{
          flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font,
          background: isInherit ? T.primary : 'transparent', color: isInherit ? '#fff' : T.textMuted,
        }}>Inherit org defaults</button>
        <button onClick={() => setMode(false)} style={{
          flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font,
          background: !isInherit ? T.primary : 'transparent', color: !isInherit ? '#fff' : T.textMuted,
        }}>Choose specific modules</button>
      </div>

      {!isInherit && (
        <>
          <div style={{ display: 'grid', gap: 4 }}>
            {modules.map(m => {
              const checked = (value || []).includes(m.module_key)
              return (
                <label key={m.module_key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, cursor: 'pointer', background: checked ? T.primaryLight : 'transparent', border: `1px solid ${checked ? T.primaryBorder : 'transparent'}` }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleModule(m.module_key)} style={{ accentColor: T.primary }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{m.module_name}</span>
                    {m.is_premium && <span style={{ fontSize: 9, fontWeight: 700, color: T.warning, marginLeft: 4 }}>PREMIUM</span>}
                    {m.description && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1 }}>{m.description}</div>}
                  </div>
                </label>
              )
            })}
          </div>
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6 }}>Unselected modules will be invisible to this user.</div>
        </>
      )}
    </div>
  )
}
