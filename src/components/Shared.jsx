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
      boxShadow: T.shadow, overflow: 'hidden', marginBottom: 10, ...s,
    }}>
      {title && (
        <div style={{
          padding: '6px 12px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: T.surfaceAlt,
        }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {title}
          </span>
          {action}
        </div>
      )}
      <div style={{ padding: 10 }}>{children}</div>
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
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13, color: T.text, lineHeight: 1.45,
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
  borderRadius: 6, padding: '8px 10px', color: T.text, fontSize: 13,
  outline: 'none', fontFamily: T.font, transition: 'border-color 0.15s, box-shadow 0.15s',
}

export const labelStyle = {
  fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase',
  letterSpacing: '0.05em', marginBottom: 3, display: 'block',
}

// === EMPTY STATE ===
export function EmptyState({ icon, title, message, action, compact }) {
  // Back-compat: if title is missing, treat `message` as the top line.
  const heading = title ?? message
  const body = title ? message : null
  return (
    <Card>
      <div style={{ textAlign: 'center', padding: compact ? 18 : 32, color: T.textMuted }}>
        {icon && <div style={{ fontSize: compact ? 22 : 30, marginBottom: 6, color: T.textMuted, opacity: 0.6 }}>{icon}</div>}
        {heading && <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: body || action ? 6 : 0 }}>{heading}</div>}
        {body && <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: action ? 12 : 0, maxWidth: 360, margin: '0 auto' }}>{body}</div>}
        {action && <div style={{ marginTop: 10 }}>{action}</div>}
      </div>
    </Card>
  )
}

// === INLINE EMPTY (in-card, no wrapper) ===
export function InlineEmpty({ text }) {
  return <div style={{ color: T.textMuted, fontSize: 12, fontStyle: 'italic', padding: 10, textAlign: 'center' }}>{text}</div>
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

// === SKELETON (shimmer placeholder) ===
export function Skeleton({ h = 14, w = '100%', r = 4, style: s }) {
  return (
    <>
      <div style={{
        height: h, width: w, borderRadius: r,
        background: `linear-gradient(90deg, ${T.borderLight} 0%, ${T.surfaceAlt} 50%, ${T.borderLight} 100%)`,
        backgroundSize: '200% 100%', animation: 'ri-shimmer 1.3s ease-in-out infinite',
        ...s,
      }} />
      <style>{`@keyframes ri-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
    </>
  )
}

// === SKELETON TABLE (N rows x M cols) ===
export function SkeletonTable({ rows = 4, cols = 3 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} h={12} />
          ))}
        </div>
      ))}
    </div>
  )
}

// === SKELETON CARDS (N stacked cards) ===
export function SkeletonCards({ count = 3 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ padding: 12, border: `1px solid ${T.borderLight}`, borderRadius: 6, background: T.surface }}>
          <Skeleton h={12} w="60%" style={{ marginBottom: 8 }} />
          <Skeleton h={10} w="90%" style={{ marginBottom: 6 }} />
          <Skeleton h={10} w="75%" />
        </div>
      ))}
    </div>
  )
}
