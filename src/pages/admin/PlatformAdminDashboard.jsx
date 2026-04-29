import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { theme as T, formatDate } from '../../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle } from '../../components/Shared'

function timeAgo(d) {
  if (!d) return '--'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const statusColors = { active: T.success, trial: T.warning, paused: T.textMuted, suspended: T.error, cancelled: T.error }

export default function PlatformAdminDashboard() {
  const nav = useNavigate()
  const [orgs, setOrgs] = useState([])
  const [plans, setPlans] = useState([])
  const [stats, setStats] = useState({ orgs: 0, users: 0, deals: 0, creditsUsed: 0 })
  const [orgStats, setOrgStats] = useState({}) // orgId -> { users, deals }
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState([])
  const [planFilter, setPlanFilter] = useState([])
  const [sortCol, setSortCol] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [orgsRes, plansRes, profilesRes, dealsRes, creditsRes] = await Promise.all([
      supabase.from('organizations').select('*, plans(name), org_credits(balance, total_used, total_granted)').order('created_at', { ascending: false }),
      supabase.from('plans').select('*').eq('active', true).order('sort_order'),
      supabase.from('profiles').select('id, org_id', { count: 'exact' }).not('org_id', 'is', null),
      supabase.from('deals').select('id, org_id, stage'),
      supabase.from('credit_ledger').select('amount').eq('transaction_type', 'usage').gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    ])

    const orgList = orgsRes.data || []
    setOrgs(orgList)
    setPlans(plansRes.data || [])

    // Build per-org stats
    const profiles = profilesRes.data || []
    const deals = dealsRes.data || []
    const perOrg = {}
    orgList.forEach(o => { perOrg[o.id] = { users: 0, deals: 0 } })
    profiles.forEach(p => { if (perOrg[p.org_id]) perOrg[p.org_id].users++ })
    deals.forEach(d => { if (perOrg[d.org_id]) perOrg[d.org_id].deals++ })
    setOrgStats(perOrg)

    const activeDeals = deals.filter(d => !['closed_won', 'closed_lost', 'disqualified'].includes(d.stage)).length
    const creditsUsed = Math.abs((creditsRes.data || []).reduce((s, r) => s + (r.amount || 0), 0))

    setStats({ orgs: orgList.length, users: profilesRes.count || profiles.length, deals: activeDeals, creditsUsed })
    setLoading(false)
  }

  function toggleFilter(arr, setArr, val) { setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]) }

  const filtered = orgs.filter(o => {
    if (statusFilter.length && !statusFilter.includes(o.status)) return false
    if (planFilter.length && !planFilter.includes(o.plan_id)) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(o.name || '').toLowerCase().includes(q) && !(o.slug || '').toLowerCase().includes(q)) return false
    }
    return true
  }).sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortCol === 'name') return dir * (a.name || '').localeCompare(b.name || '')
    if (sortCol === 'users') return dir * ((orgStats[a.id]?.users || 0) - (orgStats[b.id]?.users || 0))
    if (sortCol === 'deals') return dir * ((orgStats[a.id]?.deals || 0) - (orgStats[b.id]?.deals || 0))
    return dir * (new Date(a.created_at) - new Date(b.created_at))
  })

  function sortBy(col) { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc') } }
  const thStyle = { textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }
  const chipStyle = (active, color) => ({ padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none', background: active ? (color || T.primary) + '20' : T.surfaceAlt, color: active ? (color || T.primary) : T.textMuted, fontFamily: T.font })

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Platform Admin</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => nav('/admin/invitations')} style={{ padding: '6px 14px', fontSize: 12 }}>Invitations</Button>
          <Button onClick={() => nav('/admin/feedback')} style={{ padding: '6px 14px', fontSize: 12 }}>Beta Feedback</Button>
        </div>
      </div>

      <div style={{ padding: '16px 24px' }}>
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Organizations', value: stats.orgs, color: T.primary },
            { label: 'Total Users', value: stats.users, color: T.success },
            { label: 'Active Deals', value: stats.deals, color: T.warning },
            { label: 'Credits Used (month)', value: stats.creditsUsed, color: T.error },
          ].map(s => (
            <div key={s.label} style={{ padding: 16, background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value.toLocaleString()}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orgs..." style={{ ...inputStyle, width: 200 }} />
          <div style={{ display: 'flex', gap: 3 }}>
            <span style={{ fontSize: 10, color: T.textMuted, padding: '4px 0', fontWeight: 600 }}>Status:</span>
            {['active', 'trial', 'paused'].map(s => <button key={s} onClick={() => toggleFilter(statusFilter, setStatusFilter, s)} style={chipStyle(statusFilter.includes(s), statusColors[s])}>{s}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            <span style={{ fontSize: 10, color: T.textMuted, padding: '4px 0', fontWeight: 600 }}>Plan:</span>
            {plans.map(p => <button key={p.id} onClick={() => toggleFilter(planFilter, setPlanFilter, p.id)} style={chipStyle(planFilter.includes(p.id))}>{p.name}</button>)}
          </div>
        </div>

        {/* Orgs table */}
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th style={thStyle} onClick={() => sortBy('name')}>Org {sortCol === 'name' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}</th>
                <th style={thStyle}>Plan</th>
                <th style={thStyle} onClick={() => sortBy('users')}>Members {sortCol === 'users' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}</th>
                <th style={thStyle} onClick={() => sortBy('deals')}>Deals {sortCol === 'deals' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}</th>
                <th style={thStyle}>Credits</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle} onClick={() => sortBy('created_at')}>Created {sortCol === 'created_at' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => {
                const creds = Array.isArray(o.org_credits) ? o.org_credits[0] : o.org_credits
                return (
                  <tr key={o.id} style={{ borderBottom: `1px solid ${T.borderLight}`, cursor: 'pointer' }} onClick={() => nav(`/admin/orgs/${o.id}`)}>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ fontWeight: 700, color: T.text }}>{o.name}</div>
                      <div style={{ fontSize: 10, color: T.textMuted }}>{o.slug}</div>
                    </td>
                    <td style={{ padding: '10px 8px' }}><Badge color={T.primary}>{o.plans?.name || '--'}</Badge></td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{orgStats[o.id]?.users || 0}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{orgStats[o.id]?.deals || 0}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{creds?.balance ?? 0}</td>
                    <td style={{ padding: '10px 8px' }}><Badge color={statusColors[o.status] || T.textMuted}>{o.status}</Badge></td>
                    <td style={{ padding: '10px 8px', color: T.textMuted, whiteSpace: 'nowrap' }}>{timeAgo(o.created_at)}</td>
                    <td style={{ padding: '10px 8px' }}><Button onClick={e => { e.stopPropagation(); nav(`/admin/orgs/${o.id}`) }} style={{ padding: '3px 10px', fontSize: 10 }}>Open</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>No organizations match filters</div>}
        </Card>
      </div>
    </div>
  )
}
