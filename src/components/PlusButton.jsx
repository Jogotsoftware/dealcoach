import { theme as T } from '../lib/theme'

// Compact + icon-only "add" button. Use this whenever the action sits in a
// row/card header with a clear nearby title — the label "+ Add Foo" is
// redundant when the section title already says "Foo". Single source of
// truth so the affordance stays identical app-wide.
export default function PlusButton({ onClick, title = 'Add', disabled = false, danger = false, style }) {
  const bg = disabled ? T.border : (danger ? T.error : T.primary)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        background: bg, color: '#fff', border: 'none', borderRadius: 6,
        width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 18, fontWeight: 600, lineHeight: 1, fontFamily: T.font,
        flexShrink: 0,
        ...style,
      }}
    >+</button>
  )
}
