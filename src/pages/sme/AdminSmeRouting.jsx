import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Card, Spinner, Button } from '../../components/Shared'
import { SME_TAXONOMY_GROUPS, STARTER_TAGS, taxonomyCategory } from '../../lib/sme-taxonomy'

// Org-level "first visit" detection = zero rows in sme_routing_rules for that
// org. We seed once when that's true, render a dismissible banner, and persist
// the dismissal in localStorage keyed by org_id so it doesn't keep appearing
// across visits / users.

export default function AdminSmeRouting() {
  const { profile } = useAuth()
  const orgId = profile?.org_id
  const [rules, setRules] = useState([])
  const [orgUsers, setOrgUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [bannerVisible, setBannerVisible] = useState(false)
  const [newTag, setNewTag] = useState('')

  useEffect(() => { if (orgId) load() }, [orgId])

  async function load() {
    setLoading(true)
    try {
      const [rulesRes, usersRes] = await Promise.all([
        supabase.from('sme_routing_rules').select('*').eq('org_id', orgId).order('topic_tag'),
        supabase.from('profiles').select('id, full_name, email').eq('org_id', orgId).order('full_name'),
      ])
      const rows = rulesRes.data || []
      setRules(rows)
      setOrgUsers(usersRes.data || [])

      // First visit detection: zero rows. Auto-seed.
      if (rows.length === 0) {
        await autoSeed()
        if (!localStorage.getItem(`sme.routing.banner.dismissed.${orgId}`)) setBannerVisible(true)
      } else if (!localStorage.getItem(`sme.routing.banner.dismissed.${orgId}`)) {
        // Still show the banner the first time the user sees this page if any starter tag is missing.
        const missing = STARTER_TAGS.filter(t => !rows.some(r => r.topic_tag === t))
        if (missing.length === STARTER_TAGS.length) setBannerVisible(true)
      }
    } catch (e) { console.error('AdminSmeRouting load:', e) } finally { setLoading(false) }
  }

  async function autoSeed() {
    setSeeding(true)
    try {
      const inserts = STARTER_TAGS.map(t => ({ org_id: orgId, topic_tag: t, primary_sme_id: null, fallback_sme_ids: [], active: true }))
      await supabase.from('sme_routing_rules').insert(inserts)
      const { data } = await supabase.from('sme_routing_rules').select('*').eq('org_id', orgId).order('topic_tag')
      setRules(data || [])
    } catch (e) { console.error('autoSeed error:', e) } finally { setSeeding(false) }
  }

  async function resetToRecommended() {
    setSeeding(true)
    try {
      const existing = new Set(rules.map(r => r.topic_tag))
      const missing = STARTER_TAGS.filter(t => !existing.has(t))
      if (missing.length === 0) { setSeeding(false); return }
      const inserts = missing.map(t => ({ org_id: orgId, topic_tag: t, primary_sme_id: null, fallback_sme_ids: [], active: true }))
      await supabase.from('sme_routing_rules').insert(inserts)
      const { data } = await supabase.from('sme_routing_rules').select('*').eq('org_id', orgId).order('topic_tag')
      setRules(data || [])
    } catch (e) { console.error('resetToRecommended error:', e) } finally { setSeeding(false) }
  }

  function dismissBanner() {
    localStorage.setItem(`sme.routing.banner.dismissed.${orgId}`, '1')
    setBannerVisible(false)
  }

  async function updateRule(id, patch) {
    await supabase.from('sme_routing_rules').update(patch).eq('id', id)
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  async function deleteRule(id) {
    if (!confirm('Delete this routing rule?')) return
    await supabase.from('sme_routing_rules').delete().eq('id', id)
    setRules(prev => prev.filter(r => r.id !== id))
  }

  async function addRule() {
    const t = newTag.trim().toLowerCase().replace(/\s+/g, '-')
    if (!t) return
    const { data } = await supabase.from('sme_routing_rules').insert({ org_id: orgId, topic_tag: t, primary_sme_id: null, fallback_sme_ids: [], active: true }).select('*').single()
    if (data) setRules(prev => [...prev, data].sort((a, b) => a.topic_tag.localeCompare(b.topic_tag)))
    setNewTag('')
  }

  const grouped = useMemo(() => {
    const buckets = {}
    rules.forEach(r => {
      const cat = taxonomyCategory(r.topic_tag)
      if (!buckets[cat]) buckets[cat] = []
      buckets[cat].push(r)
    })
    return buckets
  }, [rules])

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spinner /></div>

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto', fontFamily: T.font }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: '0 0 6px' }}>SME Routing</h1>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14 }}>Map each topic to a primary SME (plus optional fallbacks). Tags are how questions get auto-routed.</div>

      {bannerVisible && (
        <Card style={{ padding: 12, marginBottom: 14, background: T.primaryLight || 'rgba(93,173,226,0.10)', border: `1px solid ${T.primary}40` }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, fontSize: 12, color: T.text, lineHeight: 1.5 }}>
              <strong>Loaded the recommended Sage Intacct taxonomy.</strong> Edit, remove, or add tags freely — these are just a starting point.
            </div>
            <button onClick={dismissBanner} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>Dismiss</button>
          </div>
        </Card>
      )}

      <Card style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Add a new topic tag (e.g. demo-techniques)…"
          onKeyDown={e => { if (e.key === 'Enter') addRule() }}
          style={{ flex: 1, padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font }} />
        <Button onClick={addRule} primary disabled={!newTag.trim()} style={{ padding: '6px 14px', fontSize: 11 }}>Add tag</Button>
        <Button onClick={resetToRecommended} disabled={seeding} style={{ padding: '6px 14px', fontSize: 11 }}>{seeding ? '…' : 'Reset to recommended'}</Button>
      </Card>

      {SME_TAXONOMY_GROUPS.map(group => {
        const groupRules = grouped[group.label] || []
        if (groupRules.length === 0) return null
        return <RoutingGroup key={group.label} label={group.label} rules={groupRules} orgUsers={orgUsers} onUpdate={updateRule} onDelete={deleteRule} />
      })}

      {/* Catch-all for partner-named tags + custom tags that don't fall into a starter group. */}
      {Object.entries(grouped).filter(([cat]) => !SME_TAXONOMY_GROUPS.some(g => g.label === cat)).map(([cat, rs]) => (
        <RoutingGroup key={cat} label={cat} rules={rs} orgUsers={orgUsers} onUpdate={updateRule} onDelete={deleteRule} />
      ))}
    </div>
  )
}

function RoutingGroup({ label, rules, orgUsers, onUpdate, onDelete }) {
  const [open, setOpen] = useState(true)
  return (
    <Card style={{ padding: 0, marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: '10px 14px', background: T.surfaceAlt, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▸</span>
        <strong style={{ fontSize: 12, color: T.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</strong>
        <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 'auto' }}>{rules.length} tag{rules.length === 1 ? '' : 's'}</span>
      </div>
      {open && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.surface }}>
              <th style={{ ...thStyle, width: '40%' }}>Topic tag</th>
              <th style={thStyle}>Primary SME</th>
              <th style={{ ...thStyle, width: 80 }}>Active</th>
              <th style={{ ...thStyle, width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} style={{ borderTop: `1px solid ${T.borderLight}` }}>
                <td style={tdStyle}><code style={{ fontFamily: T.mono, fontSize: 11, color: T.text }}>{r.topic_tag}</code></td>
                <td style={tdStyle}>
                  <select value={r.primary_sme_id || ''} onChange={e => onUpdate(r.id, { primary_sme_id: e.target.value || null })}
                    style={{ width: '100%', padding: '4px 8px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font }}>
                    <option value="">— unassigned —</option>
                    {orgUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                  </select>
                </td>
                <td style={tdStyle}>
                  <div onClick={() => onUpdate(r.id, { active: !r.active })} style={{ width: 32, height: 18, borderRadius: 9, background: r.active ? T.success : T.borderLight, cursor: 'pointer', position: 'relative' }}>
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: r.active ? 16 : 2, transition: 'left 0.15s' }} />
                  </div>
                </td>
                <td style={tdStyle}>
                  <button onClick={() => onDelete(r.id)} style={{ background: 'none', border: 'none', color: T.error, fontSize: 10, cursor: 'pointer', fontFamily: T.font }}>delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

const thStyle = { textAlign: 'left', padding: '8px 12px', fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }
const tdStyle = { padding: '8px 12px', color: T.text }
