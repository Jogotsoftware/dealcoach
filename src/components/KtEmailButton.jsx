import { useState } from 'react'
import { theme as T } from '../lib/theme'
import { Button, inputStyle } from './Shared'
import { callGenerateKtEmail } from '../lib/webhooks'

// Generate a knowledge-transfer email from the deal's structured data and
// open it in an editable composer (subject + body, copy, open in mail). The
// draft is also saved to generated_emails, so it appears in the deal's
// Emails tab. Reusable from the AE deal view and the SC workspace.
export default function KtEmailButton({ dealId, label = 'KT email', style }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setOpen(true); setLoading(true); setError(null)
    const res = await callGenerateKtEmail(dealId)
    setLoading(false)
    if (res?.error) { setError(res.error); return }
    setSubject(res.subject || ''); setBody(res.body || '')
  }

  return (
    <>
      <Button onClick={generate} style={{ padding: '6px 12px', fontSize: 12, ...style }}>{label}</Button>
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: T.surface, borderRadius: 12, padding: 24, width: 640, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: `1px solid ${T.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text, flex: 1 }}>Knowledge-transfer email</h3>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: T.textMuted, cursor: 'pointer' }}>×</button>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>Assembling from the deal's facts…</div>
            ) : error ? (
              <div style={{ padding: 16, background: T.errorLight, color: T.error, borderRadius: 8, fontSize: 13 }}>{error}</div>
            ) : (
              <>
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject"
                  style={{ ...inputStyle, fontWeight: 700, marginBottom: 10 }} />
                <textarea value={body} onChange={e => setBody(e.target.value)}
                  style={{ ...inputStyle, flex: 1, minHeight: 320, resize: 'vertical', fontFamily: T.font, lineHeight: 1.6, whiteSpace: 'pre-wrap' }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <Button onClick={() => { navigator.clipboard?.writeText(`${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                  <Button onClick={() => window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank')}>Open in mail</Button>
                  <Button primary onClick={() => setOpen(false)}>Done</Button>
                </div>
                <div style={{ fontSize: 10, color: T.textMuted, marginTop: 8 }}>Saved as a draft on this deal.</div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
