import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Spinner, EmptyState, Button, Card, inputStyle, labelStyle } from '../../components/Shared'
import { notify } from '../../lib/notifications'

// Upcoming demos across the SC's deals. Creating one writes a demo stage to
// the deal's project plan and notifies the AE (sc_scheduled_demo).
export default function SCSchedule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [deals, setDeals] = useState([])
  const [demos, setDemos] = useState([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ deal_id: '', date: '', title: 'Product demo' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    setLoading(true)
    try {
      const { data: dl } = await supabase.from('deals').select('id, company_name, org_id, rep_id').eq('sc_user_id', profile.id)
      const list = dl || []
      setDeals(list)
      const ids = list.map(d => d.id)
      if (ids.length) {
        const { data: st } = await supabase.from('msp_stages')
          .select('id, deal_id, stage_name, call_type, start_date, due_date, is_completed')
          .in('deal_id', ids).or('call_type.eq.demo,stage_name.ilike.%demo%')
        const byId = Object.fromEntries(list.map(d => [d.id, d.company_name]))
        const rows = (st || []).map(s => ({ ...s, company: byId[s.deal_id], date: s.due_date || (s.start_date ? String(s.start_date).slice(0, 10) : null) }))
          .filter(s => s.date)
          .sort((a, b) => a.date.localeCompare(b.date))
        setDemos(rows)
      } else setDemos([])
    } catch (e) { console.error('[SCSchedule] load', e) } finally { setLoading(false) }
  }

  async function schedule() {
    if (!form.deal_id || !form.date) return
    setSaving(true)
    try {
      const deal = deals.find(d => d.id === form.deal_id)
      const { data: maxRow } = await supabase.from('msp_stages').select('stage_order').eq('deal_id', form.deal_id).order('stage_order', { ascending: false }).limit(1).maybeSingle()
      const { error } = await supabase.from('msp_stages').insert({
        deal_id: form.deal_id, stage_name: form.title || 'Product demo', call_type: 'demo',
        due_date: form.date, is_custom: true, stage_order: (maxRow?.stage_order || 0) + 1, status: 'upcoming',
      })
      if (error) throw error
      await notify({ recipientId: deal?.rep_id, actorId: profile.id, dealId: form.deal_id, orgId: deal?.org_id,
        kind: 'sc_scheduled_demo', payload: { actor_name: profile.full_name, deal_company: deal?.company_name, date: form.date } })
      setShow(false); setForm({ deal_id: '', date: '', title: 'Product demo' })
      await load()
    } catch (e) { console.error('[SCSchedule] schedule', e); alert(`Could not schedule: ${e?.message || e}`) }
    finally { setSaving(false) }
  }

  if (loading) return <Spinner />
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = demos.filter(d => d.date >= today)
  const past = demos.filter(d => d.date < today)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text }}>Demo schedule</h1>
        <div style={{ flex: 1 }} />
        <Button primary onClick={() => setShow(s => !s)}>Schedule demo</Button>
      </div>

      {show && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={labelStyle}>Deal</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.deal_id} onChange={e => setForm(p => ({ ...p, deal_id: e.target.value }))}>
                <option value="">Select…</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" style={inputStyle} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
            </div>
            <Button primary disabled={!form.deal_id || !form.date || saving} onClick={schedule}>{saving ? 'Scheduling…' : 'Add'}</Button>
          </div>
        </Card>
      )}

      {demos.length === 0 ? (
        <EmptyState icon="▷" title="No demos scheduled" message="Schedule a demo and it lands on the deal's project plan, and the AE gets notified." />
      ) : (
        <>
          <SectionList title="Upcoming" rows={upcoming} navigate={navigate} emptyText="Nothing upcoming." />
          {past.length > 0 && <SectionList title="Past" rows={past} navigate={navigate} muted />}
        </>
      )}
    </div>
  )
}

function SectionList({ title, rows, navigate, muted, emptyText }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{title}</div>
      {rows.length === 0 ? <div style={{ fontSize: 12, color: T.textMuted }}>{emptyText}</div> : rows.map(d => (
        <button key={d.id} onClick={() => navigate(`/sc/deals/${d.deal_id}`)}
          style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 14, cursor: 'pointer', fontFamily: T.font, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 6, opacity: muted ? 0.6 : 1 }}>
          <div style={{ textAlign: 'center', minWidth: 48 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.primary, fontFeatureSettings: '"tnum"' }}>{new Date(d.date).toLocaleDateString('en-US', { day: 'numeric' })}</div>
            <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase' }}>{new Date(d.date).toLocaleDateString('en-US', { month: 'short' })}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{d.company}</div>
            <div style={{ fontSize: 12, color: T.textSecondary }}>{d.stage_name}{d.is_completed ? ' · done' : ''}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
