import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../../components/Shared'

export default function OrgSettings() {
  const { org, plan, credits, isSystemAdmin, refreshOrg } = useOrg()
  const [memberCount, setMemberCount] = useState(0)
  const [dealCount, setDealCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadCounts() }, [org?.id])

  async function loadCounts() {
    if (!org?.id) return
    setLoading(true)
    const [membersRes, dealsRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
      supabase.from('deals').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
    ])
    setMemberCount(membersRes.count || 0)
    setDealCount(dealsRes.count || 0)
    setLoading(false)
  }

  async function saveOrgField(field, value) {
    await supabase.from('organizations').update({ [field]: value }).eq('id', org.id)
    refreshOrg()
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Organization Settings</h2>
      </div>
      <div style={{ padding: '16px 24px' }}>
        <Card title="Organization Info">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Organization Name</label>
              <input style={inputStyle} defaultValue={org?.name || ''} onBlur={e => saveOrgField('name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Logo URL</label>
              <input style={inputStyle} defaultValue={org?.logo_url || ''} onBlur={e => saveOrgField('logo_url', e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label style={labelStyle}>Primary Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={org?.primary_color || '#5DADE2'} onChange={e => saveOrgField('primary_color', e.target.value)} style={{ width: 40, height: 30, border: 'none', cursor: 'pointer' }} />
                <span style={{ fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>{org?.primary_color || '#5DADE2'}</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <Badge color={org?.status === 'active' ? T.success : org?.status === 'trial' ? T.warning : T.error}>{org?.status}</Badge>
              {org?.trial_ends_at && <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 8 }}>Trial ends {org.trial_ends_at.split('T')[0]}</span>}
            </div>
          </div>
        </Card>

        <Card title="Plan & Usage">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'Plan', value: plan?.name || 'Free', color: T.primary },
              { label: 'Users', value: `${memberCount} / ${plan?.max_users || '\u221E'}`, color: memberCount >= (plan?.max_users || 999) ? T.error : T.text },
              { label: 'Deals', value: `${dealCount} / ${plan?.max_deals || '\u221E'}`, color: dealCount >= (plan?.max_deals || 999) ? T.error : T.text },
              { label: 'Credits', value: `${credits?.balance || 0} remaining`, color: (credits?.balance || 0) < 10 ? T.error : T.success },
            ].map(item => (
              <div key={item.label} style={{ padding: 14, background: T.surfaceAlt, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
          {plan?.modules && (
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Included Modules</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {plan.modules.map(m => <Badge key={m} color={T.primary}>{m.replace(/_/g, ' ')}</Badge>)}
              </div>
            </div>
          )}
        </Card>

        {isSystemAdmin && (
          <Card title="Danger Zone" style={{ border: '1px solid ' + T.error + '30' }}>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>Transfer ownership to another system admin in your organization.</div>
            <Button danger style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => alert('Contact support to transfer ownership.')}>Transfer Ownership</Button>
          </Card>
        )}
      </div>
    </div>
  )
}
