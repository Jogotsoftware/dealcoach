import { theme as T, FORECAST_CATEGORIES, STAGES } from '../lib/theme'

// === BUTTON ===
export function Button({ children, primary, danger, onClick, disabled, style, ...rest }) {
  const bg = danger ? T.error : primary ? T.primary : T.surface
  const color = primary || danger ? '#fff' : T.textSecondary
  const border = primary || danger ? 'none' : `1px solid ${T.border}`

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bg, border, borderRadius: 6, padding: '8px 16px',
        color, fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: T.font, opacity: disabled ? 0.5 : 1, transition: 'all 0.15s',
        display: 'inline-flex', alignItems: 'center', gap: 6, ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

// === CARD ===
export function Card({ children, title, action, style: s, className }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflow: 'hidden', marginBottom: 16, ...s,
    }}>
      {title && (
        <div style={{
          padding: '12px 18px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: T.surfaceAlt,
        }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {title}
          </span>
          {action}
        </div>
      )}
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  )
}

// === BADGE ===
export function Badge({ children, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
      color, background: color + '12', border: `1px solid ${color}25`,
      padding: '2px 7px', borderRadius: 4, lineHeight: 1, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

// === FORECAST BADGE ===
export function ForecastBadge({ category }) {
  const fc = FORECAST_CATEGORIES.find(f => f.key === category) || FORECAST_CATEGORIES[0]
  return <Badge color={fc.color}>{fc.label}</Badge>
}

// === STAGE BADGE ===
export function StageBadge({ stage }) {
  const st = STAGES.find(s => s.key === stage)
  if (!st) return <Badge color={T.textMuted}>{stage}</Badge>
  return <Badge color={st.color}>{st.label}</Badge>
}

// === SCORE BAR ===
export function ScoreBar({ score, max = 10, label }) {
  const color = score >= 7 ? T.success : score >= 4 ? T.warning : score > 0 ? T.error : T.textMuted
  const pct = max > 0 ? (score / max) * 100 : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4 }}>
      {label && <span style={{ color: T.textSecondary, width: 55, fontSize: 11 }}>{label}</span>}
      <div style={{ flex: 1, height: 5, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color, borderRadius: 3,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ color: T.text, fontWeight: 600, width: 20, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
        {score}
      </span>
    </div>
  )
}

// === FIELD (label + value) ===
export function Field({ label, value, mono }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13, color: T.text, lineHeight: 1.5,
        fontFamily: mono ? T.mono : T.font,
        whiteSpace: mono ? 'pre-wrap' : undefined,
      }}>
        {value || <span style={{ color: T.textMuted, fontStyle: 'italic' }}>Unknown</span>}
      </div>
    </div>
  )
}

// === STATUS DOT (parses next_steps for RED/GREEN) ===
export function StatusDot({ text }) {
  if (!text) return null
  const hasRed = text.includes('RED')
  const hasGreen = text.includes('GREEN')
  const color = hasRed && !hasGreen ? T.error : !hasRed && hasGreen ? T.success : T.warning

  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, flexShrink: 0,
    }} />
  )
}

// === MILESTONE STATUS BADGE ===
export function MilestoneStatus({ status }) {
  const colors = {
    completed: T.success, in_progress: T.primary,
    pending: T.textMuted, blocked: T.error,
  }
  const c = colors[status] || T.textMuted

  return (
    <span style={{
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
      color: c, background: c + '12', padding: '2px 6px', borderRadius: 3,
    }}>
      {(status || '').replace('_', ' ')}
    </span>
  )
}

// === TAB BAR ===
export function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${T.border}` }}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: '10px 18px', fontSize: 12, fontWeight: 600,
            border: 'none', cursor: 'pointer', fontFamily: T.font,
            background: 'transparent',
            color: active === t.key ? T.primary : T.textMuted,
            borderBottom: active === t.key ? `2px solid ${T.primary}` : '2px solid transparent',
            transition: 'all 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// === INPUT STYLES (reusable object) ===
export const inputStyle = {
  width: '100%', background: T.surface, border: `1px solid ${T.border}`,
  borderRadius: 6, padding: '10px 12px', color: T.text, fontSize: 13,
  outline: 'none', fontFamily: T.font, transition: 'border-color 0.15s, box-shadow 0.15s',
}

export const labelStyle = {
  fontSize: 11, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase',
  letterSpacing: '0.05em', marginBottom: 4, display: 'block',
}

// === EMPTY STATE ===
export function EmptyState({ message, action }) {
  return (
    <Card>
      <div style={{ textAlign: 'center', padding: 32, color: T.textMuted }}>
        <div style={{ fontSize: 13, marginBottom: action ? 12 : 0 }}>{message}</div>
        {action}
      </div>
    </Card>
  )
}

// === LOADING SPINNER ===
export function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{
        width: 32, height: 32, border: `3px solid ${T.borderLight}`,
        borderTop: `3px solid ${T.primary}`, borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
