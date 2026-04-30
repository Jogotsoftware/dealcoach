import { theme as T } from '../lib/theme'

// Compact eye-icon toggle for "is this surface visible to the customer?"
// Used everywhere: Deal Room section titles, Quote tab AE controls, etc.
// Single source of truth — keeps the affordance identical across the app.
export default function VisibilityToggleIcon({ visible, onChange, label = 'this section' }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!visible) }}
      title={visible ? `Visible to the customer — click to hide ${label}` : `Hidden from the customer — click to show ${label}`}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: '2px 4px', display: 'inline-flex', alignItems: 'center',
        color: visible ? T.success : T.textMuted,
      }}
      onMouseEnter={e => e.currentTarget.style.color = visible ? T.success : T.warning}
      onMouseLeave={e => e.currentTarget.style.color = visible ? T.success : T.textMuted}
    >
      {visible ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      )}
    </button>
  )
}
