import { Component } from 'react'
import { theme as T } from '../lib/theme'

// Generic error boundary. Wrap any route or widget so one bad render doesn't crash the app.
// Use: <ErrorBoundary label="Pipeline"><Pipeline /></ErrorBoundary>
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Ship to Sentry if initialised
    try {
      // eslint-disable-next-line global-require
      const Sentry = window.Sentry
      if (Sentry?.captureException) Sentry.captureException(error, { extra: { label: this.props.label, info } })
    } catch { /* no-op */ }
    // Dev console
    console.error(`[ErrorBoundary ${this.props.label || ''}]`, error, info)
  }

  reset = () => this.setState({ error: null, info: null })

  render() {
    if (!this.state.error) return this.props.children
    const label = this.props.label || 'this page'
    const msg = this.state.error?.message || String(this.state.error)
    return (
      <div style={{ padding: 40, fontFamily: T.font }}>
        <div style={{
          background: T.surface, border: `1px solid ${T.error}40`, borderLeft: `4px solid ${T.error}`,
          borderRadius: 8, padding: 24, maxWidth: 640, margin: '40px auto', boxShadow: T.shadow,
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.error, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Something broke</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>Sorry, {label} hit an unexpected error.</div>
          <div style={{ fontSize: 13, color: T.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
            Your data is safe. We've logged the error. You can try again, reload the page, or head back to the pipeline.
          </div>
          <details style={{ fontSize: 11, color: T.textMuted, marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer', marginBottom: 6 }}>Technical details</summary>
            <pre style={{ fontFamily: T.mono, fontSize: 10, background: T.surfaceAlt, padding: 10, borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{msg}</pre>
          </details>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={this.reset} style={{ padding: '8px 16px', background: T.primary, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
              Try again
            </button>
            <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
              Reload page
            </button>
            <button onClick={() => { window.location.href = '/' }} style={{ padding: '8px 16px', background: 'transparent', color: T.textMuted, border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
              Back to pipeline
            </button>
          </div>
        </div>
      </div>
    )
  }
}
