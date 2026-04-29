import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../../components/Shared'
import LogoUploader from '../../components/LogoUploader'

export default function OrgSettings() {
  const { org, plan, credits, isSystemAdmin, refreshOrg } = useOrg()
  const [memberCount, setMemberCount] = useState(0)
  const [dealCount, setDealCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [allPlans, setAllPlans] = useState([])

  useEffect(() => { loadCounts() }, [org?.id])
  useEffect(() => {
    supabase.from('plans').select('*').eq('active', true).eq('is_public', true).order('sort_order')
      .then(({ data }) => setAllPlans(data || []))
  }, [])

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

        <Card title="Brand & Logo">
          <LogoUploader
            bucket="proposal-logos"
            pathPrefix={org?.id}
            filename="org-logo"
            currentUrl={org?.logo_url}
            currentPath={org?.logo_storage_path}
            label="Your logo"
            helpText="Uploaded once here. Renders automatically on every customer-facing proposal. SVG strongly preferred — scales cleanly on print."
            onSaved={async (publicUrl, path) => {
              await supabase.from('organizations').update({ logo_url: publicUrl, logo_storage_path: path }).eq('id', org.id)
              await refreshOrg()
            }}
            onRemoved={async () => {
              await supabase.from('organizations').update({ logo_url: null, logo_storage_path: null }).eq('id', org.id)
              await refreshOrg()
            }}
          />

          <div style={{ height: 1, background: T.borderLight, margin: '18px 0' }} />

          <LogoUploader
            bucket="proposal-logos"
            pathPrefix={org?.id}
            filename="org-icon"
            currentUrl={org?.icon_url}
            currentPath={org?.icon_storage_path}
            label="Top-bar icon"
            helpText="Small square icon shown in the platform's top-left tile. PNG or SVG. SVG preferred for crisp rendering at any size."
            onSaved={async (publicUrl, path) => {
              await supabase.from('organizations').update({ icon_url: publicUrl, icon_storage_path: path }).eq('id', org.id)
              await refreshOrg()
            }}
            onRemoved={async () => {
              await supabase.from('organizations').update({ icon_url: null, icon_storage_path: null }).eq('id', org.id)
              await refreshOrg()
            }}
          />
        </Card>

        <Card title="Fiscal Year">
          <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>
            <strong>Current:</strong> {['January','February','March','April','May','June','July','August','September','October','November','December'][(org?.fiscal_year_end_month || 12) - 1]} {org?.fiscal_year_end_day || 31}
            {(org?.fiscal_year_end_month || 12) === 12 && (org?.fiscal_year_end_day || 31) === 31 && <span style={{ color: T.textMuted, marginLeft: 8 }}>(Calendar Year)</span>}
          </div>
          {isSystemAdmin && (
            <div>
              <div style={{ fontSize: 11, color: T.warning, marginBottom: 8 }}>Changing fiscal year end will recalculate all attainment displays. Historical data is unchanged.</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div>
                  <label style={labelStyle}>End Month</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={org?.fiscal_year_end_month || 12} onChange={e => saveOrgField('fiscal_year_end_month', Number(e.target.value))}>
                    {['January','February','March','April','May','June','July','August','September','October','November','December'].map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>End Day</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={org?.fiscal_year_end_day || 31} onChange={e => saveOrgField('fiscal_year_end_day', Number(e.target.value))}>
                    {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
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

        {plan && <UpgradeSection plan={plan} allPlans={allPlans} />}
        {false && (
          <Card title="Available Plans">
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(allPlans.length, 4)}, 1fr)`, gap: 12 }}>
              {allPlans.map(p => {
                const isCurrent = p.id === org?.plan_id
                return (
                  <div key={p.id} style={{
                    padding: 16, borderRadius: 8, textAlign: 'center',
                    background: isCurrent ? T.primaryLight : T.surfaceAlt,
                    border: isCurrent ? `2px solid ${T.primary}` : `1px solid ${T.border}`,
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 4 }}>{p.name}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: T.primary, marginBottom: 8 }}>
                      {p.monthly_price ? `$${p.monthly_price}/mo` : 'Free'}
                    </div>
                    <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.8 }}>
                      <div>{p.credits_monthly || 0} credits/month</div>
                      <div>{p.max_users || '\u221E'} users</div>
                      <div>{p.max_deals || '\u221E'} deals</div>
                      {p.modules?.length > 0 && <div style={{ marginTop: 4 }}>{p.modules.length} modules</div>}
                    </div>
                    {isCurrent ? (
                      <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: T.primary }}>Current Plan</div>
                    ) : (
                      <button style={{ marginTop: 10, padding: '5px 14px', fontSize: 11, fontWeight: 600, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}>Coming Soon</button>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        )}

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

function UpgradeSection({ plan, allPlans }) {
  const [showAllPlans, setShowAllPlans] = useState(false)
  return (
    <>
      <Card title="Your Plan">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.primary }}>{plan.name}</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
              {plan.credits_monthly || 0} credits/month · {plan.max_users || 'unlimited'} users · {plan.max_deals || 'unlimited'} deals
            </div>
          </div>
          <Button disabled onClick={() => alert('Contact us at hello@revenueinstruments.com to upgrade.')}
            style={{ padding: '8px 18px', fontSize: 12 }}>
            Upgrade Plan
          </Button>
        </div>
        <div style={{ marginTop: 10, fontSize: 11 }}>
          <a onClick={() => setShowAllPlans(s => !s)} style={{ color: T.primary, cursor: 'pointer', textDecoration: 'none', fontWeight: 600 }}>
            {showAllPlans ? 'Hide' : 'View'} all plans
          </a>
        </div>
      </Card>

      {showAllPlans && allPlans.length > 0 && (
        <Card title="Available Plans">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(allPlans.length, 4)}, 1fr)`, gap: 10 }}>
            {allPlans.map(p => {
              const isCurrent = p.id === plan.id
              return (
                <div key={p.id} style={{ padding: 12, borderRadius: 8, textAlign: 'center', background: isCurrent ? T.primaryLight : T.surfaceAlt, border: isCurrent ? `2px solid ${T.primary}` : `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{p.name}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: T.primary, marginTop: 4 }}>
                    {p.monthly_price ? `$${p.monthly_price}/mo` : 'Free'}
                  </div>
                  <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4, lineHeight: 1.6 }}>
                    {p.credits_monthly || 0} credits/mo<br />
                    {p.max_users || 'unlimited'} users<br />
                    {p.max_deals || 'unlimited'} deals
                  </div>
                  {isCurrent && <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700, color: T.primary }}>Current</div>}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </>
  )
}
