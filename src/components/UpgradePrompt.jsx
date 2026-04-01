import { theme as T } from '../lib/theme'

export default function UpgradePrompt({ moduleName, description, currentPlan }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ textAlign: 'center', maxWidth: 420, background: T.surface, border: '1px solid ' + T.border, borderRadius: 12, padding: 32 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: T.primaryLight, border: '1px solid ' + T.primaryBorder, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 22, color: T.primary }}>+</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: '0 0 8px' }}>{moduleName}</h3>
        <p style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.5, marginBottom: 16 }}>{description}</p>
        <div style={{ fontSize: 12, color: T.textMuted, padding: '8px 16px', background: T.surfaceAlt, borderRadius: 6, marginBottom: 16 }}>
          Your <strong>{currentPlan || 'current'}</strong> plan doesn't include this feature.
        </div>
        <div style={{ fontSize: 13, color: T.primary, fontWeight: 600 }}>Contact your admin to upgrade</div>
      </div>
    </div>
  )
}
