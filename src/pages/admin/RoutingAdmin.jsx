import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Button, Card, Badge, TabBar, inputStyle, labelStyle } from '../../components/Shared'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

const FALLBACK_VERTICALS = [
  'General Business',
  'Hospitality',
  'Healthcare',
  'Not For Profit',
  'Software & Professional Services',
  'Financial Services',
]

function describeEmployeeBand(min, max) {
  if (min == null && max == null) return 'any'
  if (min != null && max != null) return `${min}–${max}`
  if (min != null) return `≥ ${min}`
  return `≤ ${max}`
}

export default function RoutingAdmin() {
  const { org } = useOrg()
  const navigate = useNavigate()
  const [tab, setTab] = useState('rules')

  return (
    <div>
      <div style={{
        padding: '14px 24px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12, background: T.surface,
      }}>
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}
        >&larr; Back</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0, flex: 1 }}>Lead Routing</h2>
      </div>

      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        <TabBar
          tabs={[
            { key: 'rules', label: 'Rules' },
            { key: 'pools', label: 'Pools' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      <div style={{ padding: 24, maxWidth: 1100 }}>
        {tab === 'rules' && org?.id && <RulesPanel orgId={org.id} />}
        {tab === 'pools' && org?.id && <PoolsPanel orgId={org.id} />}
      </div>
    </div>
  )
}

// ============================================================================
// RULES PANEL
// ============================================================================

const blankRule = () => ({
  name: '',
  priority: 100,
  active: true,
  match_state: '',
  match_vertical: '',
  match_employee_min: '',
  match_employee_max: '',
  destination_type: 'ae',
  destination_ae_id: '',
  destination_pool_id: '',
})

function RulesPanel({ orgId }) {
  const [rules, setRules] = useState([])
  const [pools, setPools] = useState([])
  const [aes, setAes] = useState([])
  const [verticals, setVerticals] = useState(FALLBACK_VERTICALS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankRule())
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [filter, setFilter] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [rulesRes, poolsRes, aesRes, coachRes] = await Promise.all([
        supabase.from('routing_rules').select('*').eq('org_id', orgId).order('priority', { ascending: true }),
        supabase.from('routing_pools').select('id, name, active').eq('org_id', orgId).order('name'),
        supabase.from('profiles').select('id, full_name, email, role').eq('org_id', orgId).neq('role', 'bdr').order('full_name'),
        supabase.from('coaches').select('id').eq('org_id', orgId).eq('name', 'BDR Submission Coach').eq('active', true).maybeSingle(),
      ])
      if (rulesRes.error) throw rulesRes.error
      setRules(rulesRes.data || [])
      setPools(poolsRes.data || [])
      setAes(aesRes.data || [])

      if (coachRes.data?.id) {
        const { data: cfg } = await supabase
          .from('coach_research_config')
          .select('verticals')
          .eq('coach_id', coachRes.data.id)
          .maybeSingle()
        if (Array.isArray(cfg?.verticals) && cfg.verticals.length > 0) setVerticals(cfg.verticals)
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [orgId])

  const aeName = (id) => aes.find(a => a.id === id)?.full_name ?? '(unknown AE)'
  const poolName = (id) => pools.find(p => p.id === id)?.name ?? '(unknown pool)'

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rules
    return rules.filter(r => {
      const dest = r.destination_type === 'ae' ? aeName(r.destination_ae_id) : poolName(r.destination_pool_id)
      return [
        r.name, r.match_state, r.match_vertical, dest,
      ].some(v => (v || '').toString().toLowerCase().includes(q))
    })
  }, [rules, filter, aes, pools])

  const startCreate = () => {
    const maxPriority = rules.reduce((m, r) => Math.max(m, r.priority || 0), 0)
    setEditingId('new')
    setForm({ ...blankRule(), priority: maxPriority + 10 })
  }

  const startEdit = (r) => {
    setEditingId(r.id)
    setForm({
      name: r.name ?? '',
      priority: r.priority ?? 100,
      active: r.active ?? true,
      match_state: r.match_state ?? '',
      match_vertical: r.match_vertical ?? '',
      match_employee_min: r.match_employee_min ?? '',
      match_employee_max: r.match_employee_max ?? '',
      destination_type: r.destination_type ?? 'ae',
      destination_ae_id: r.destination_ae_id ?? '',
      destination_pool_id: r.destination_pool_id ?? '',
    })
  }

  const cancel = () => { setEditingId(null); setForm(blankRule()); setError(null) }

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (form.destination_type === 'ae' && !form.destination_ae_id) { setError('Pick an AE for AE-destination rules.'); return }
    if (form.destination_type === 'pool' && !form.destination_pool_id) { setError('Pick a pool for pool-destination rules.'); return }
    setSaving(true); setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        priority: Number(form.priority) || 100,
        active: !!form.active,
        match_state: form.match_state || null,
        match_vertical: form.match_vertical || null,
        match_employee_min: form.match_employee_min === '' ? null : Number(form.match_employee_min),
        match_employee_max: form.match_employee_max === '' ? null : Number(form.match_employee_max),
        destination_type: form.destination_type,
        destination_ae_id: form.destination_type === 'ae' ? form.destination_ae_id : null,
        destination_pool_id: form.destination_type === 'pool' ? form.destination_pool_id : null,
      }
      if (editingId === 'new') {
        const { error: e } = await supabase.from('routing_rules').insert({ ...payload, org_id: orgId })
        if (e) throw e
      } else {
        const { error: e } = await supabase.from('routing_rules').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingId)
        if (e) throw e
      }
      cancel(); await load()
    } catch (err) { setError(err.message || String(err)) }
    finally { setSaving(false) }
  }

  const toggleActive = async (r) => {
    try {
      const { error: e } = await supabase.from('routing_rules').update({ active: !r.active, updated_at: new Date().toISOString() }).eq('id', r.id)
      if (e) throw e
      await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const doDelete = async (id) => {
    try {
      const { error: e } = await supabase.from('routing_rules').delete().eq('id', id)
      if (e) throw e
      setConfirmDelete(null); await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <Card>
      <div style={{ padding: '4px 4px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          style={{ ...inputStyle, maxWidth: 320, fontSize: 12 }}
          placeholder="Filter by state / vertical / destination / name…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <span style={{ fontSize: 11, color: T.textMuted }}>{filtered.length} of {rules.length}</span>
        <div style={{ flex: 1 }} />
        {editingId == null && <Button primary onClick={startCreate}>+ New rule</Button>}
      </div>

      <div style={{
        padding: 12, background: T.surfaceAlt, borderRadius: 6,
        fontSize: 12, color: T.textSecondary, lineHeight: 1.5, marginBottom: 12,
      }}>
        <strong style={{ color: T.text }}>How this works:</strong> route-lead picks the first matching active rule by priority (low number = high priority). A null match field is a wildcard. Catch-all "fallback" rules typically use priority 9999.
      </div>

      {editingId === 'new' && (
        <RuleEditForm form={form} setF={setF} onSave={save} onCancel={cancel} saving={saving} aes={aes} pools={pools} verticals={verticals} isNew />
      )}

      {error && (
        <div style={{
          background: T.errorLight, border: `1px solid ${T.error}33`,
          borderRadius: 6, padding: '8px 12px', marginBottom: 12,
          fontSize: 12, color: T.error,
        }}>{error}</div>
      )}

      {loading && <div style={{ padding: 16, color: T.textMuted }}>Loading…</div>}

      {!loading && filtered.length === 0 && rules.length === 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
          No routing rules. Approved leads will fall through to no destination (route-lead errors).
        </div>
      )}

      {!loading && filtered.length === 0 && rules.length > 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
          No rules match "{filter}".
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ overflow: 'hidden', borderRadius: 6, border: `1px solid ${T.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <Th>Priority</Th>
                <Th>Name</Th>
                <Th>State</Th>
                <Th>Vertical</Th>
                <Th>Employees</Th>
                <Th>Destination</Th>
                <Th>Active</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.flatMap(r => editingId === r.id
                ? [(
                  <tr key={r.id}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <RuleEditForm form={form} setF={setF} onSave={save} onCancel={cancel} saving={saving} aes={aes} pools={pools} verticals={verticals} />
                    </td>
                  </tr>
                )]
                : [(
                  <tr key={r.id} style={{ borderBottom: `1px solid ${T.borderLight}`, opacity: r.active ? 1 : 0.55 }}>
                    <Td><strong>{r.priority}</strong></Td>
                    <Td>{r.name}</Td>
                    <Td>{r.match_state ?? <span style={{ color: T.textMuted }}>any</span>}</Td>
                    <Td>{r.match_vertical ?? <span style={{ color: T.textMuted }}>any</span>}</Td>
                    <Td>{describeEmployeeBand(r.match_employee_min, r.match_employee_max)}</Td>
                    <Td>
                      {r.destination_type === 'ae'
                        ? <Badge color={T.primary}>AE: {aeName(r.destination_ae_id)}</Badge>
                        : <Badge color={T.success}>Pool: {poolName(r.destination_pool_id)}</Badge>}
                    </Td>
                    <Td>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11 }}>
                        <input type="checkbox" checked={!!r.active} onChange={() => toggleActive(r)} />
                        {r.active ? 'on' : 'off'}
                      </label>
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button onClick={() => startEdit(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
                        <Button danger onClick={() => setConfirmDelete(r.id)} style={{ padding: '4px 10px', fontSize: 11 }}>Delete</Button>
                      </div>
                    </Td>
                  </tr>
                )])}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete routing rule?"
          body="Approved leads matching only this rule will fall through to the next priority match (or the catch-all fallback)."
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => doDelete(confirmDelete)}
        />
      )}
    </Card>
  )
}

function RuleEditForm({ form, setF, onSave, onCancel, saving, aes, pools, verticals, isNew }) {
  return (
    <div style={{
      border: `1px solid ${T.primary}40`, borderRadius: 6,
      background: T.primaryLight, padding: 14, marginBottom: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {isNew ? 'New rule' : 'Edit rule'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 120px', gap: 12, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} value={form.name} onChange={e => setF('name', e.target.value)} placeholder="Manufacturing East Coast" />
        </div>
        <div>
          <label style={labelStyle}>Priority *</label>
          <input type="number" style={inputStyle} value={form.priority} onChange={e => setF('priority', e.target.value.replace(/[^\d]/g, ''))} />
        </div>
        <div>
          <label style={labelStyle}>Active</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textSecondary, paddingTop: 8 }}>
            <input type="checkbox" checked={!!form.active} onChange={e => setF('active', e.target.checked)} /> on
          </label>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Match HQ State</label>
          <select style={inputStyle} value={form.match_state} onChange={e => setF('match_state', e.target.value)}>
            <option value="">any</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Match Vertical</label>
          <select style={inputStyle} value={form.match_vertical} onChange={e => setF('match_vertical', e.target.value)}>
            <option value="">any</option>
            {verticals.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Employees min</label>
          <input type="number" style={inputStyle} value={form.match_employee_min} onChange={e => setF('match_employee_min', e.target.value.replace(/[^\d]/g, ''))} placeholder="any" />
        </div>
        <div>
          <label style={labelStyle}>Employees max</label>
          <input type="number" style={inputStyle} value={form.match_employee_max} onChange={e => setF('match_employee_max', e.target.value.replace(/[^\d]/g, ''))} placeholder="any" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Destination *</label>
          <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: T.text }}>
              <input type="radio" checked={form.destination_type === 'ae'} onChange={() => setF('destination_type', 'ae')} /> Specific AE
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: T.text }}>
              <input type="radio" checked={form.destination_type === 'pool'} onChange={() => setF('destination_type', 'pool')} /> Pool (round-robin)
            </label>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{form.destination_type === 'ae' ? 'AE' : 'Pool'}</label>
          {form.destination_type === 'ae' ? (
            <select style={inputStyle} value={form.destination_ae_id} onChange={e => setF('destination_ae_id', e.target.value)}>
              <option value="">— Select an AE —</option>
              {aes.map(a => <option key={a.id} value={a.id}>{a.full_name} ({a.email})</option>)}
            </select>
          ) : (
            <select style={inputStyle} value={form.destination_pool_id} onChange={e => setF('destination_pool_id', e.target.value)}>
              <option value="">— Select a pool —</option>
              {pools.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button primary onClick={onSave} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create' : 'Save changes'}</Button>
      </div>
    </div>
  )
}

// ============================================================================
// POOLS PANEL
// ============================================================================

const blankPool = () => ({ name: '', active: true, members: [] })

function PoolsPanel({ orgId }) {
  const [pools, setPools] = useState([])
  const [aes, setAes] = useState([])
  const [poolMembers, setPoolMembers] = useState({}) // pool_id → [ae_id]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankPool())
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [poolsRes, membersRes, aesRes] = await Promise.all([
        supabase.from('routing_pools').select('*').eq('org_id', orgId).order('name'),
        supabase.from('routing_pool_members').select('pool_id, ae_id, active'),
        supabase.from('profiles').select('id, full_name, email, role').eq('org_id', orgId).neq('role', 'bdr').order('full_name'),
      ])
      if (poolsRes.error) throw poolsRes.error
      setPools(poolsRes.data || [])
      setAes(aesRes.data || [])
      const map = {}
      ;(membersRes.data || []).forEach(m => {
        if (!m.active) return
        if (!map[m.pool_id]) map[m.pool_id] = []
        map[m.pool_id].push(m.ae_id)
      })
      setPoolMembers(map)
    } catch (err) { setError(err.message || String(err)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [orgId])

  const aeName = (id) => aes.find(a => a.id === id)?.full_name ?? '(unknown)'

  const startCreate = () => { setEditingId('new'); setForm(blankPool()) }
  const startEdit = (p) => {
    setEditingId(p.id)
    setForm({ name: p.name, active: p.active, members: poolMembers[p.id] || [] })
  }
  const cancel = () => { setEditingId(null); setForm(blankPool()); setError(null) }

  const save = async () => {
    if (!form.name.trim()) { setError('Pool name is required.'); return }
    setSaving(true); setError(null)
    try {
      let poolId = editingId
      if (editingId === 'new') {
        const { data, error: e } = await supabase
          .from('routing_pools')
          .insert({ org_id: orgId, name: form.name.trim(), active: !!form.active })
          .select('id').single()
        if (e) throw e
        poolId = data.id
      } else {
        const { error: e } = await supabase
          .from('routing_pools')
          .update({ name: form.name.trim(), active: !!form.active, updated_at: new Date().toISOString() })
          .eq('id', editingId)
        if (e) throw e
      }

      // Sync members: full replace strategy. Delete all existing, insert current set.
      // Idempotent + simple. Pool member count is small (<20 typical), so safe.
      await supabase.from('routing_pool_members').delete().eq('pool_id', poolId)
      if (form.members.length > 0) {
        await supabase.from('routing_pool_members').insert(
          form.members.map(ae_id => ({ pool_id: poolId, ae_id, active: true })),
        )
      }
      cancel(); await load()
    } catch (err) { setError(err.message || String(err)) }
    finally { setSaving(false) }
  }

  const doDelete = async (id) => {
    try {
      // routing_pool_members cascades on pool delete (ON DELETE CASCADE in M1.4 migration)
      const { error: e } = await supabase.from('routing_pools').delete().eq('id', id)
      if (e) throw e
      setConfirmDelete(null); await load()
    } catch (err) { setError(err.message || String(err)) }
  }

  const toggleMember = (aeId) => {
    setForm(prev => ({
      ...prev,
      members: prev.members.includes(aeId)
        ? prev.members.filter(x => x !== aeId)
        : [...prev.members, aeId],
    }))
  }

  const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <Card>
      <div style={{ padding: '4px 4px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, fontSize: 12, color: T.textMuted }}>{pools.length} pool{pools.length === 1 ? '' : 's'}</div>
        {editingId == null && <Button primary onClick={startCreate}>+ New pool</Button>}
      </div>

      <div style={{
        padding: 12, background: T.surfaceAlt, borderRadius: 6,
        fontSize: 12, color: T.textSecondary, lineHeight: 1.5, marginBottom: 12,
      }}>
        <strong style={{ color: T.text }}>How this works:</strong> a pool routes incoming approved leads to its members in round-robin order. <em>Last assigned</em> shows who got the most recent lead — the next match will go to the next member after them.
      </div>

      {editingId === 'new' && (
        <PoolEditForm form={form} setF={setF} aes={aes} onSave={save} onCancel={cancel} saving={saving} toggleMember={toggleMember} isNew />
      )}

      {error && (
        <div style={{
          background: T.errorLight, border: `1px solid ${T.error}33`,
          borderRadius: 6, padding: '8px 12px', marginBottom: 12,
          fontSize: 12, color: T.error,
        }}>{error}</div>
      )}

      {loading && <div style={{ padding: 16, color: T.textMuted }}>Loading…</div>}

      {!loading && pools.length === 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
          No pools yet. Create one to enable round-robin routing.
        </div>
      )}

      {!loading && pools.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pools.map(p => editingId === p.id ? (
            <PoolEditForm key={p.id} form={form} setF={setF} aes={aes} onSave={save} onCancel={cancel} saving={saving} toggleMember={toggleMember} />
          ) : (
            <div key={p.id} style={{
              border: `1px solid ${T.border}`, borderRadius: 6, padding: 14,
              background: p.active ? T.surface : T.surfaceAlt,
              opacity: p.active ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{p.name}</span>
                    {!p.active && <Badge color={T.textMuted}>Inactive</Badge>}
                    <span style={{ fontSize: 11, color: T.textMuted }}>·</span>
                    <span style={{ fontSize: 11, color: T.textMuted }}>
                      {(poolMembers[p.id] || []).length} member{(poolMembers[p.id] || []).length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>
                    Last assigned: <strong style={{ color: p.last_assigned_ae_id ? T.text : T.textMuted }}>{p.last_assigned_ae_id ? aeName(p.last_assigned_ae_id) : '— (no leads routed yet)'}</strong>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(poolMembers[p.id] || []).map(m => (
                      <Badge key={m} color={T.primary}>{aeName(m)}</Badge>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <Button onClick={() => startEdit(p)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>
                  <Button danger onClick={() => setConfirmDelete(p.id)} style={{ padding: '4px 10px', fontSize: 11 }}>Delete</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete pool?"
          body="Routing rules pointing at this pool will need to be reassigned. Members are dropped from the pool but their profiles remain unchanged."
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => doDelete(confirmDelete)}
        />
      )}
    </Card>
  )
}

function PoolEditForm({ form, setF, aes, onSave, onCancel, saving, toggleMember, isNew }) {
  return (
    <div style={{
      border: `1px solid ${T.primary}40`, borderRadius: 6,
      background: T.primaryLight, padding: 14, marginBottom: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {isNew ? 'New pool' : 'Edit pool'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Pool name *</label>
          <input style={inputStyle} value={form.name} onChange={e => setF('name', e.target.value)} placeholder="East Coast Mfg AEs" />
        </div>
        <div>
          <label style={labelStyle}>Active</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textSecondary, paddingTop: 8 }}>
            <input type="checkbox" checked={!!form.active} onChange={e => setF('active', e.target.checked)} /> on
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Members ({form.members.length} selected)</label>
        <div style={{
          border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface,
          maxHeight: 240, overflowY: 'auto', padding: 4,
        }}>
          {aes.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: T.textMuted, textAlign: 'center' }}>
              No AEs in this org. Add team members via Organization settings.
            </div>
          )}
          {aes.map(a => (
            <label key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', cursor: 'pointer', borderRadius: 4,
              background: form.members.includes(a.id) ? T.primaryLight : 'transparent',
            }}>
              <input
                type="checkbox"
                checked={form.members.includes(a.id)}
                onChange={() => toggleMember(a.id)}
              />
              <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{a.full_name}</span>
              <span style={{ fontSize: 11, color: T.textMuted }}>{a.email}</span>
              <span style={{ flex: 1 }} />
              <Badge color={T.textMuted}>{a.role}</Badge>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button primary onClick={onSave} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create' : 'Save changes'}</Button>
      </div>
    </div>
  )
}

// ============================================================================
// SHARED
// ============================================================================

function Th({ children }) {
  return <th style={{
    padding: '10px 14px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, color: '#8899aa',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }}>{children}</th>
}

function Td({ children }) {
  return <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>{children}</td>
}

function ConfirmModal({ title, body, onCancel, onConfirm }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, borderRadius: 8, padding: 20, maxWidth: 460, width: '90%',
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)', fontFamily: T.font,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.5, marginBottom: 16 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button danger onClick={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  )
}
