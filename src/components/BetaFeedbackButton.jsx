import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { theme as T } from '../lib/theme'
import BetaFeedbackModal from './BetaFeedbackModal'

const HIDDEN_ROUTES = ['/login', '/onboarding']
const HIDDEN_PREFIXES = ['/msp/shared/', '/partner']

export default function BetaFeedbackButton({ dealContext }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const location = useLocation()

  const path = location.pathname
  if (HIDDEN_ROUTES.includes(path) || HIDDEN_PREFIXES.some(p => path.startsWith(p))) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: hover ? '8px 16px' : '8px 10px',
          borderRadius: 24,
          background: T.primary,
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(93, 173, 226, 0.35)',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: T.font,
          transition: 'all 0.2s ease',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
        title="Send beta feedback"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <path d="M2 2h12a1 1 0 011 1v8a1 1 0 01-1 1H5l-3 3V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
          <circle cx="5" cy="7" r="1" fill="currentColor"/>
          <circle cx="8" cy="7" r="1" fill="currentColor"/>
          <circle cx="11" cy="7" r="1" fill="currentColor"/>
        </svg>
        {hover && <span>Beta Feedback</span>}
      </button>
      {open && <BetaFeedbackModal onClose={() => setOpen(false)} dealContext={dealContext} />}
    </>
  )
}
