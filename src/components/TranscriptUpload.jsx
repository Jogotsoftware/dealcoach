import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { callProcessTranscript } from '../lib/webhooks'
import { track } from '../lib/analytics'
import { theme as T, CALL_TYPES } from '../lib/theme'
import { Button, Badge, inputStyle, labelStyle } from './Shared'

export default function TranscriptUpload({ deals, onClose, onUploaded }) {
  const [form, setForm] = useState({
    deal_id: '', call_type: 'qdc', call_date: new Date().toISOString().split('T')[0],
    title: '', transcript: '',
  })
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [shareUrl, setShareUrl] = useState('')
  const [importing, setImporting] = useState(false)

  const activeDeals = (deals || []).filter(d =>
    !['closed_won', 'closed_lost', 'disqualified'].includes(d.stage)
  )

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!form.title) set('title', f.name.replace(/\.[^/.]+$/, ''))
    const reader = new FileReader()
    reader.onload = (ev) => set('transcript', ev.target.result)
    reader.readAsText(f)
  }

  const handleSubmit = async () => {
    if (!form.deal_id || !form.transcript.trim()) return
    setSaving(true)
    setError(null)
    setResult(null)

    try {
      // 1. Save conversation to Supabase
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          deal_id: form.deal_id,
          call_type: form.call_type,
          call_date: form.call_date,
          title: form.title || `${form.call_type.toUpperCase()} - ${form.call_date}`,
          transcript: form.transcript,
          source: file ? 'upload' : 'paste',
          filename: file?.name || null,
          processed: false,
          tasks_extracted: false,
        })
        .select()
        .single()

      if (convErr) throw convErr

      track('transcript_uploaded', { call_type: form.call_type, source: file ? 'upload' : 'paste', size_chars: form.transcript.length })

      if (onUploaded) onUploaded(conv)

      // 2. Show processing state and send to Edge Function
      setSaving(false)
      setProcessing(true)
      setResult({ saved: true, processing: true, message: 'Processing transcript with AI...' })

      const res = await callProcessTranscript(conv.id)
      setProcessing(false)

      if (!res.error) {
        track('transcript_processed', { call_type: form.call_type, commitments_created: res.commitments_created || 0, contacts_found: res.contacts_found || 0, icp_score: res.icp_score || null })
      }

      if (res.error) {
        setResult({
          saved: true,
          processing: false,
          error: true,
          message: `Transcript saved but processing failed: ${res.error}`,
        })
      } else {
        setResult({
          saved: true,
          processing: false,
          error: false,
          message: `Analysis complete.${res.tasks_created ? ` ${res.tasks_created} tasks created.` : ''}${res.contacts_found ? ` ${res.contacts_found} contacts found.` : ''} Close this dialog to see results.`,
        })
      }
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = form.deal_id && form.transcript.trim() && !saving

  async function importFromUrl() {
    if (!form.deal_id) { setError('Pick a deal first'); return }
    if (!shareUrl.trim()) { setError('Paste a transcript URL first'); return }
    setImporting(true); setError(null); setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-transcript-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': session ? `Bearer ${session.access_token}` : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ deal_id: form.deal_id, url: shareUrl.trim(), call_type: form.call_type, call_date: form.call_date, title: form.title || null }),
      })
      const body = await r.json()
      if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`)
      track('transcript_uploaded', { call_type: form.call_type, source: 'url_import', size_chars: body.transcript_length || 0 })
      setResult({ saved: true, processing: true, message: `Imported ${body.transcript_length?.toLocaleString() || ''} chars from URL. Processing with AI...` })
      if (onUploaded) onUploaded({ id: body.conversation_id })
    } catch (e) {
      setError(`Import failed: ${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
          width: 600, maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ padding: '24px 28px 0' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Upload Transcript</div>
          <div style={{ fontSize: 13, color: T.textSecondary, marginBottom: 20 }}>
            Paste or upload a call transcript for AI analysis
          </div>
        </div>

        <div style={{ padding: '0 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Deal + Call Type */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Deal *</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={form.deal_id}
                onChange={e => set('deal_id', e.target.value)}
              >
                <option value="">Select deal...</option>
                {activeDeals.map(d => (
                  <option key={d.id} value={d.id}>{d.company_name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Call Type *</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={form.call_type}
                onChange={e => set('call_type', e.target.value)}
              >
                {CALL_TYPES.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date + Title */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Call Date</label>
              <input type="date" style={inputStyle} value={form.call_date}
                onChange={e => set('call_date', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} value={form.title}
                onChange={e => set('title', e.target.value)}
                placeholder="e.g. QDC with CFO" />
            </div>
          </div>

          {/* Import from share URL (Chorus / Gong / Fathom / etc.) */}
          <div>
            <label style={labelStyle}>Import from share URL</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...inputStyle, flex: 1 }} value={shareUrl}
                onChange={e => setShareUrl(e.target.value)}
                placeholder="Paste a Chorus / Gong / Fathom / Zoom share link..." />
              <Button onClick={importFromUrl} disabled={importing || !shareUrl.trim() || !form.deal_id} style={{ padding: '8px 14px', fontSize: 12 }}>
                {importing ? 'Importing...' : 'Import'}
              </Button>
            </div>
            <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>Works with any publicly accessible transcript page. Server-side fetch + HTML scrape.</div>
          </div>

          {/* File Upload */}
          <div>
            <label style={labelStyle}>Upload File</label>
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
              border: `2px dashed ${file ? T.success : T.border}`, borderRadius: 8,
              cursor: 'pointer', background: file ? T.successLight : T.surfaceAlt,
            }}>
              <input type="file" accept=".txt,.vtt,.srt" style={{ display: 'none' }} onChange={handleFile} />
              <span style={{ fontSize: 13, color: file ? T.success : T.textSecondary, fontWeight: 500 }}>
                {file
                  ? `${file.name} (${(file.size / 1024).toFixed(1)}KB)`
                  : 'Click to upload .txt, .vtt, or .srt'}
              </span>
            </label>
          </div>

          {/* Paste Area */}
          <div>
            <label style={labelStyle}>Or Paste Transcript *</label>
            <textarea
              style={{ ...inputStyle, minHeight: 140, resize: 'vertical', fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.6 }}
              value={form.transcript}
              onChange={e => set('transcript', e.target.value)}
              placeholder="Paste your transcript here..."
            />
          </div>

          {/* Info */}
          <div style={{
            display: 'flex', gap: 10, padding: '10px 14px',
            background: T.primaryLight, border: `1px solid ${T.primaryBorder}`, borderRadius: 6,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>&#9432;</span>
            <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>
              Full deal context (company profile, analysis, contacts, competitors, previous calls,
              open tasks, MSP status, scores) is sent with the transcript.
              Claude receives the complete picture for coaching.
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 6, fontSize: 13,
              background: T.errorLight, color: T.error, border: `1px solid ${T.error}25`,
            }}>
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{
              padding: '12px 16px', borderRadius: 6, fontSize: 13,
              background: result.processing ? T.primaryLight : result.error ? T.errorLight : T.successLight,
              color: result.processing ? T.primary : result.error ? T.error : T.success,
              border: `1px solid ${result.processing ? T.primary : result.error ? T.error : T.success}25`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {result.processing && (
                <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${T.primary}`, borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              )}
              <span style={{ fontWeight: result.processing ? 400 : 600 }}>{result.message}</span>
              {result.processing && <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', gap: 10, padding: '16px 28px', justifyContent: 'flex-end',
          borderTop: `1px solid ${T.border}`, background: T.surfaceAlt,
          borderRadius: '0 0 12px 12px',
        }}>
          <Button onClick={onClose}>{result && !result.processing ? 'Close' : 'Cancel'}</Button>
          {!result?.saved && (
            <Button primary onClick={handleSubmit} disabled={!canSubmit}>
              {saving ? 'Saving...' : processing ? 'Processing...' : 'Upload & Process'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
