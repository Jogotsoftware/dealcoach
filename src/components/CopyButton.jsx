import { useState } from 'react'
import { theme as T } from '../lib/theme'

// Compact icon-only "copy to clipboard" button with a brief checkmark
// confirmation. Single source of truth so the affordance stays identical
// across the app.
export default function CopyButton({ text, title = 'Copy', size = 14, style }) {
  const [copied, setCopied] = useState(false)

  async function copy(e) {
    e.stopPropagation()
    if (!text) return
    try {
      await navigator.clipboard.writeText(String(text))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch (err) {
      console.warn('clipboard write failed:', err)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied' : title}
      aria-label={title}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: copied ? T.success : T.textMuted, lineHeight: 0, flexShrink: 0,
        borderRadius: 4,
        ...style,
      }}
      onMouseEnter={e => { if (!copied) e.currentTarget.style.color = T.text }}
      onMouseLeave={e => { if (!copied) e.currentTarget.style.color = T.textMuted }}
    >
      {copied ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}
