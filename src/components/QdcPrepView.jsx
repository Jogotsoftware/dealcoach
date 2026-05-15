import { useState } from 'react'
import { theme as T } from '../lib/theme'
import { Card, Badge, Spinner } from './Shared'

const OWNERSHIP_LABELS = {
  private: 'Private',
  pe_backed: 'PE-backed',
  public: 'Public',
  nonprofit: 'Nonprofit',
  unknown: 'Unknown',
}

const SOURCE_LABELS = {
  research: { label: 'Research', color: T.primary },
  sdr_notes: { label: 'SDR notes', color: T.warning },
  ae_notes: { label: 'AE notes', color: T.warning },
  transcript: { label: 'Transcript', color: T.success },
  rep_entry: { label: 'Rep entry', color: T.textMuted },
}

function formatTenure(months) {
  if (months == null) return null
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / 12)
  const remMonths = months % 12
  if (remMonths === 0) return `${years} year${years === 1 ? '' : 's'}`
  return `${years}y ${remMonths}mo`
}

function formatDateMaybe(input) {
  if (!input) return null
  const d = new Date(input)
  if (isNaN(d.getTime())) return typeof input === 'string' ? input : null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function renderListMaybe(jsonbVal, textFallback) {
  if (Array.isArray(jsonbVal) && jsonbVal.length > 0) {
    return jsonbVal.map(item =>
      typeof item === 'string' ? item : (item?.name || item?.label || JSON.stringify(item))
    )
  }
  if (textFallback && typeof textFallback === 'string' && textFallback.trim() && textFallback !== 'Unknown') {
    return [textFallback]
  }
  return null
}

function Unknown() {
  return <span style={{ color: T.textMuted, fontStyle: 'italic' }}>Unknown</span>
}

function FieldRow({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 2,
      }}>{label}</div>
      <div style={{ fontSize: 13, color: T.text, lineHeight: 1.45, fontFamily: T.font }}>
        {children}
      </div>
    </div>
  )
}

function BulletList({ items }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}
    </ul>
  )
}

function SourcePill({ sourceType, sourceUrl, sourceExcerpt }) {
  let key = sourceType
  if (!key && sourceUrl) key = 'research'
  if (!key) return null
  const meta = SOURCE_LABELS[key] || SOURCE_LABELS.research
  const tip = sourceExcerpt || sourceUrl || ''
  return (
    <span
      title={tip}
      style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: meta.color, background: meta.color + '12', border: `1px solid ${meta.color}25`,
        padding: '2px 7px', borderRadius: 4, lineHeight: 1, whiteSpace: 'nowrap', cursor: tip ? 'help' : 'default',
      }}
    >
      {meta.label}
    </span>
  )
}

function ScoreCard({ prepScore, dealQdcPrepScore }) {
  const [expanded, setExpanded] = useState(false)

  const cardStyle = {
    borderLeft: '4px solid ' + T.primary,
    padding: '18px 20px',
  }

  // Loading: RPC hasn't returned yet
  if (prepScore === undefined) {
    return (
      <Card title="QDC Prep Score" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <Spinner size={28} inline />
          <span style={{ fontSize: 13, color: T.textSecondary, fontFamily: T.font }}>Computing score...</span>
        </div>
      </Card>
    )
  }

  // RPC ran, no row, and no cached score on the deal
  if (!prepScore && dealQdcPrepScore == null) {
    return (
      <Card title="QDC Prep Score" style={cardStyle}>
        <div style={{ fontSize: 13, color: T.textMuted, fontStyle: 'italic', padding: '12px 0', fontFamily: T.font }}>
          Not scored yet — runs after research completes
        </div>
      </Card>
    )
  }

  const score = prepScore?.overall_score ?? dealQdcPrepScore
  const breakdownText = prepScore?.breakdown_text

  const components = prepScore ? [
    { label: 'ICP fit', value: prepScore.icp_component, weight: '25%' },
    { label: 'Contacts', value: prepScore.contact_component, weight: '25%' },
    { label: 'Research', value: prepScore.research_component, weight: '25%' },
    { label: 'Notes & news', value: prepScore.notes_news_component, weight: '15%' },
    { label: 'Systems', value: prepScore.systems_component, weight: '10%' },
  ] : []

  return (
    <Card title="QDC Prep Score" style={cardStyle}>
      <div style={{ padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: T.font }}>
          <span style={{ fontSize: 68, fontWeight: 800, color: T.primary, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>
            {score}
          </span>
          <span style={{ fontSize: 24, fontWeight: 600, color: T.textMuted }}>/ 10</span>
        </div>
        {breakdownText && (
          <div style={{ fontSize: 14, color: T.textSecondary, marginTop: 8, lineHeight: 1.5, fontFamily: T.font }}>
            {breakdownText}
          </div>
        )}
        {prepScore && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font,
            }}
          >
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: '50%', border: `1px solid ${T.primary}`,
              fontSize: 10, fontWeight: 700, color: T.primary,
            }}>i</span>
            Component breakdown {expanded ? '▴' : '▾'}
          </button>
        )}
        {expanded && prepScore && (
          <div style={{ marginTop: 12, padding: 12, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
            {components.map(c => (
              <div key={c.label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 0', borderBottom: `1px solid ${T.borderLight}`, fontSize: 13, fontFamily: T.font,
              }}>
                <span style={{ color: T.text, fontWeight: 600 }}>{c.label}</span>
                <span style={{ color: T.textSecondary }}>
                  <span style={{ color: T.text, fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{c.value ?? 0}/10</span>
                  <span style={{ color: T.textMuted, marginLeft: 8 }}>({c.weight})</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function CompanyFactsCard({ companyProfile }) {
  const cp = companyProfile || {}

  const locationsList = renderListMaybe(cp.entities_locations_list, cp.entities_locations)

  function renderLocations() {
    if (!locationsList) return <Unknown />
    if (locationsList.length === 1) return <span>{locationsList[0]}</span>
    return (
      <div>
        {locationsList.map((loc, i) => (
          <div key={i} style={{ lineHeight: 1.45 }}>{loc}</div>
        ))}
      </div>
    )
  }

  const ownershipKey = cp.ownership_structure
  const ownershipLabel = ownershipKey == null ? null : (OWNERSHIP_LABELS[ownershipKey] || OWNERSHIP_LABELS.unknown)

  const rows = [
    { label: 'HQ', value: cp.headquarters },
    { label: 'Other locations', value: null, custom: renderLocations() },
    { label: 'Employees', value: cp.employee_count },
    { label: 'Annual revenue', value: cp.revenue },
    { label: 'Entities', value: cp.entity_count },
    { label: 'Year founded', value: cp.founded },
    { label: 'Ownership', value: ownershipLabel },
    { label: 'Industry', value: cp.industry },
  ]

  return (
    <Card title="Company facts">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
        {rows.map(r => (
          <FieldRow key={r.label} label={r.label}>
            {r.custom ? r.custom : (r.value == null || r.value === '' ? <Unknown /> : <span>{r.value}</span>)}
          </FieldRow>
        ))}
      </div>
    </Card>
  )
}

function RevenueStreamsCard({ companyProfile }) {
  const cp = companyProfile || {}
  const streams = renderListMaybe(cp.revenue_streams_list, cp.revenue_streams)
  const offerings = renderListMaybe(cp.business_offerings_list, cp.business_offerings)
  const segments = cp.customer_segments_text

  return (
    <Card title="Revenue streams & service offerings">
      <FieldRow label="Revenue streams">
        {streams ? <BulletList items={streams} /> : <Unknown />}
      </FieldRow>
      <FieldRow label="Service offerings">
        {offerings ? <BulletList items={offerings} /> : <Unknown />}
      </FieldRow>
      <FieldRow label="Customer segments">
        {segments ? <span style={{ whiteSpace: 'pre-wrap' }}>{segments}</span> : <Unknown />}
      </FieldRow>
    </Card>
  )
}

function CompetitiveLandscapeCard({ companyProfile }) {
  const competitors = companyProfile?.industry_competitors
  const hasData = Array.isArray(competitors) && competitors.length > 0

  return (
    <Card title="Their competitive landscape">
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, fontStyle: 'italic' }}>
        Who <strong style={{ color: T.textSecondary }}>they</strong> compete against in their industry
      </div>
      {!hasData ? (
        <div style={{ color: T.textMuted, fontStyle: 'italic', fontSize: 13 }}>
          Unknown — their industry competitors will populate after research completes.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {competitors.map((comp, i) => {
            const name = typeof comp === 'string' ? comp : comp?.name
            const description = typeof comp === 'object' ? comp?.description : null
            const source = typeof comp === 'object' ? comp?.source : null
            return (
              <div key={i} style={{ padding: 10, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: description ? 4 : 0 }}>
                  {name || 'Unknown'}
                </div>
                {description && (
                  <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>{description}</div>
                )}
                {source && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: T.textMuted,
                      background: T.surface, border: `1px solid ${T.borderLight}`,
                      padding: '2px 6px', borderRadius: 3, letterSpacing: '0.03em',
                    }}>{typeof source === 'string' ? source : (source?.name || source?.url || JSON.stringify(source))}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function RecentNewsCard({ companyProfile, companyNews }) {
  const summary = companyProfile?.recent_news_summary
  const news = Array.isArray(companyNews) ? [...companyNews] : []
  news.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? news : news.slice(0, 5)

  return (
    <Card title="Recent news & activity">
      {summary && (
        <div style={{ fontSize: 15, fontStyle: 'italic', color: T.text, marginBottom: 14, lineHeight: 1.5, fontFamily: T.font }}>
          {summary}
        </div>
      )}
      {news.length === 0 ? (
        <div style={{ color: T.textMuted, fontStyle: 'italic', fontSize: 13 }}>No recent news found</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visible.map(item => {
              const sourceName = item.source_name || item.source
              const dateRaw = item.date_text || item.date || item.created_at
              const dateStr = formatDateMaybe(dateRaw)
              return (
                <div key={item.id} style={{ padding: 10, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>
                    {item.source_url ? (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: T.text, textDecoration: 'none' }}>
                        {item.headline}
                      </a>
                    ) : (item.headline || 'Untitled')}
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {sourceName && <span>{sourceName}</span>}
                    {sourceName && dateStr && <span>·</span>}
                    {dateStr && <span>{dateStr}</span>}
                    {item.source_url && (
                      <>
                        <span>·</span>
                        <a href={item.source_url} target="_blank" rel="noopener noreferrer"
                          style={{ color: T.primary, textDecoration: 'none' }}>
                          Open {'↗'}
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {news.length > 5 && (
            <button
              onClick={() => setShowAll(s => !s)}
              style={{
                marginTop: 10, background: 'transparent', border: 'none', cursor: 'pointer',
                color: T.primary, fontSize: 12, fontWeight: 600, padding: 0, fontFamily: T.font,
              }}
            >
              {showAll ? 'Show fewer' : `Show all (${news.length})`}
            </button>
          )}
        </>
      )}
    </Card>
  )
}

function RolePill({ contact }) {
  if (contact.is_champion) return <Badge color={T.success}>Champion</Badge>
  if (contact.is_economic_buyer) return <Badge color={T.primary}>EB</Badge>
  if (contact.is_signer) return <Badge color={T.primary}>Signer</Badge>
  if (contact.is_adversary) return <Badge color={T.error}>Adversary</Badge>
  return null
}

function ContactCard({ contact }) {
  const [expanded, setExpanded] = useState(false)

  const tenureStr = contact.tenure_months != null
    ? formatTenure(contact.tenure_months)
    : (contact.tenure || null)

  const history = Array.isArray(contact.career_history) ? [...contact.career_history] : null
  const sortedHistory = history
    ? history
        .sort((a, b) => {
          const at = new Date(a.start_date || 0).getTime()
          const bt = new Date(b.start_date || 0).getTime()
          return bt - at
        })
        .slice(0, 4)
    : null

  const priorErp = Array.isArray(contact.prior_erp_experience) && contact.prior_erp_experience.length > 0
    ? contact.prior_erp_experience
    : null
  const priorErpText = !priorErp && contact.previous_erp_experience ? contact.previous_erp_experience : null

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        padding: 12, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6,
        cursor: 'pointer', transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{contact.name || 'Unnamed contact'}</div>
          <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{contact.title || <Unknown />}</div>
        </div>
        <div style={{ fontSize: 11, color: T.textMuted }}>
          Tenure: {tenureStr || <Unknown />}
        </div>
        {contact.linkedin && (
          <a
            href={contact.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title="LinkedIn"
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.03em',
              color: T.primary, background: T.primaryLight, border: `1px solid ${T.primaryBorder}`,
              padding: '2px 6px', borderRadius: 3, textDecoration: 'none',
            }}
          >
            in
          </a>
        )}
        <RolePill contact={contact} />
        <span style={{ fontSize: 10, color: T.textMuted }}>{expanded ? '▴' : '▾'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.borderLight}` }}>
          <FieldRow label="Career history">
            {sortedHistory && sortedHistory.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sortedHistory.map((role, i) => {
                  const start = role.start_date ? new Date(role.start_date).getFullYear() : null
                  const end = role.is_current ? 'Present' : (role.end_date ? new Date(role.end_date).getFullYear() : null)
                  const range = start && end ? `${start} – ${end}` : (start || end || '')
                  return (
                    <div key={i} style={{ fontSize: 12, color: T.text, lineHeight: 1.45 }}>
                      <span style={{ fontWeight: 600 }}>{role.title || 'Role'}</span>
                      {role.company && <span style={{ color: T.textSecondary }}> @ {role.company}</span>}
                      {range && <span style={{ color: T.textMuted, marginLeft: 6 }}>{range}</span>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <span style={{ color: T.textMuted, fontStyle: 'italic', fontSize: 12 }}>Career history not available</span>
            )}
          </FieldRow>

          {(priorErp || priorErpText) && (
            <FieldRow label="Prior ERP experience">
              {priorErp ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {priorErp.map((erp, i) => {
                    const label = typeof erp === 'string' ? erp : (erp?.system || erp?.name || 'Unknown')
                    const ctx = typeof erp === 'object' ? erp?.role_context : null
                    return (
                      <span key={i} title={ctx || ''} style={{
                        fontSize: 11, fontWeight: 600, color: T.primary, background: T.primaryLight,
                        border: `1px solid ${T.primaryBorder}`, padding: '3px 8px', borderRadius: 4,
                      }}>{label}</span>
                    )
                  })}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: T.text }}>{priorErpText}</span>
              )}
            </FieldRow>
          )}

          {contact.background && (
            <FieldRow label="Background notes">
              <span style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{contact.background}</span>
            </FieldRow>
          )}
        </div>
      )}
    </div>
  )
}

function ContactsCard({ contacts }) {
  const list = contacts || []
  return (
    <Card title="Contacts">
      {list.length === 0 ? (
        <div style={{ color: T.textMuted, fontStyle: 'italic', fontSize: 13 }}>No contacts on this deal yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map(c => <ContactCard key={c.id} contact={c} />)}
        </div>
      )}
    </Card>
  )
}

function SystemsCard({ systems }) {
  const list = systems || []
  return (
    <Card title="Systems they run">
      {list.length === 0 ? (
        <div style={{ color: T.textMuted, fontStyle: 'italic', fontSize: 13 }}>No systems identified yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map(s => (
            <div key={s.id} style={{ padding: 10, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{s.system_name || s.name || 'Unknown system'}</span>
                {s.category && <span style={{ fontSize: 11, color: T.textMuted }}>({s.category})</span>}
                {s.is_current && <Badge color={T.success}>Current</Badge>}
                {s.is_needed && <Badge color={T.warning}>Needed</Badge>}
                <div style={{ flex: 1 }} />
                <SourcePill sourceType={s.source_type} sourceUrl={s.source_url} sourceExcerpt={s.source_excerpt} />
              </div>
              {s.notes && (
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {s.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function NotesCard({ deal, bdrLead }) {
  const hasSdr = !!(bdrLead && bdrLead.notes && bdrLead.notes.trim())
  const hasAe = !!(deal?.notes && deal.notes.trim())

  if (!hasSdr && !hasAe) {
    return (
      <Card title="SDR / AE notes">
        <div style={{ color: T.textMuted, fontStyle: 'italic', fontSize: 13 }}>No notes captured yet.</div>
      </Card>
    )
  }

  return (
    <Card title="SDR / AE notes">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {hasSdr && (
          <div style={{ padding: 10, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge color={T.warning}>SDR</Badge>
              {bdrLead.created_at && (
                <span style={{ fontSize: 11, color: T.textMuted }}>{formatDateMaybe(bdrLead.created_at)}</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {bdrLead.notes}
            </div>
          </div>
        )}
        {hasAe && (
          <div style={{ padding: 10, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge color={T.primary}>AE</Badge>
              {deal?.created_at && (
                <span style={{ fontSize: 11, color: T.textMuted }}>{formatDateMaybe(deal.created_at)}</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {deal.notes}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function IcpFitCard({ deal }) {
  const score = deal?.icp_fit_score
  const breakdown = deal?.icp_fit_breakdown
  const color = score == null ? T.textMuted : (score >= 70 ? T.success : score >= 40 ? T.warning : T.error)
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))

  return (
    <Card title="ICP fit score">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10, fontFamily: T.font }}>
        {score == null ? <Unknown /> : (
          <>
            <span style={{ fontSize: 32, fontWeight: 800, color, fontFeatureSettings: '"tnum"' }}>{score}</span>
            <span style={{ fontSize: 14, color: T.textMuted }}>/ 100</span>
          </>
        )}
      </div>
      <div style={{ height: 8, background: T.borderLight, borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ width: pct + '%', height: '100%', background: color, transition: 'width 0.4s ease' }} />
      </div>
      {breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown) && Object.keys(breakdown).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(breakdown).map(([criterion, raw]) => {
            let status = 'unknown'
            let statusLabel = 'Unknown'
            let statusColor = T.textMuted
            const v = raw
            if (typeof v === 'boolean') {
              status = v ? 'match' : 'no_match'
            } else if (typeof v === 'object' && v !== null) {
              if (typeof v.match === 'boolean') status = v.match ? 'match' : 'no_match'
              else if (v.status) status = String(v.status).toLowerCase()
            } else if (typeof v === 'string') {
              const lower = v.toLowerCase()
              if (lower === 'match' || lower === 'yes' || lower === 'true') status = 'match'
              else if (lower === 'no_match' || lower === 'no match' || lower === 'no' || lower === 'false') status = 'no_match'
            }
            if (status === 'match') { statusLabel = 'Match'; statusColor = T.success }
            else if (status === 'no_match') { statusLabel = 'No match'; statusColor = T.error }
            return (
              <div key={criterion} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 13, padding: '4px 0',
              }}>
                <span style={{ color: T.text }}>{criterion.replace(/_/g, ' ')}</span>
                <Badge color={statusColor}>{statusLabel}</Badge>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export default function QdcPrepView({
  dealId,
  deal,
  companyProfile,
  contacts,
  systems,
  companyNews,
  bdrLead,
  prepScore,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: T.font }}>
      <ScoreCard prepScore={prepScore} dealQdcPrepScore={deal?.qdc_prep_score} />
      <CompanyFactsCard companyProfile={companyProfile} />
      <RevenueStreamsCard companyProfile={companyProfile} />
      <CompetitiveLandscapeCard companyProfile={companyProfile} />
      <RecentNewsCard companyProfile={companyProfile} companyNews={companyNews} />
      <ContactsCard contacts={contacts} />
      <SystemsCard systems={systems} />
      <NotesCard deal={deal} bdrLead={bdrLead} />
      <IcpFitCard deal={deal} />
    </div>
  )
}
