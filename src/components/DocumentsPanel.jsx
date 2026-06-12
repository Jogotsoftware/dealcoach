import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Button, Spinner, EmptyState, inputStyle } from './Shared'
import { callExtractFromDocument } from '../lib/webhooks'

// Shared deal documents (deal_documents + the deal-documents bucket, both
// org-scoped, so the SC sees what the AE uploaded and vice-versa). Uploading
// a text-readable doc — or pasting text — runs autofill: catalog fields the
// document answers become inline suggestions in the discovery notes.
const TEXT_RE = /\.(txt|md|markdown|csv|json|html?)$/i
const isText = (f) => /^text\//.test(f.type || '') || TEXT_RE.test(f.name || '')

export default function DocumentsPanel({ deal, title = 'Documents' }) {
  const { profile } = useAuth()
  const [docs, setDocs] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [autofilling, setAutofilling] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { load() }, [deal?.id])
  async function load() {
    try {
      const { data } = await supabase.from('deal_documents').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false })
      // Sign URLs for the private bucket.
      const withUrls = await Promise.all((data || []).map(async d => {
        if (!d.storage_path) return d
        const { data: s } = await supabase.storage.from('deal-documents').createSignedUrl(d.storage_path, 3600)
        return { ...d, signedUrl: s?.signedUrl || null }
      }))
      setDocs(withUrls)
    } catch (e) { console.error('[DocumentsPanel] load', e); setDocs([]) }
  }

  async function upload(file) {
    if (!file) return
    setUploading(true); setMsg(null)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${deal.id}/${Date.now()}-${safe}`
      const { error: upErr } = await supabase.storage.from('deal-documents').upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw upErr
      const { data: row, error: insErr } = await supabase.from('deal_documents').insert({
        deal_id: deal.id, name: file.name, storage_path: path, mime_type: file.type, file_size: file.size, uploaded_by: profile?.id, doc_type: 'document',
      }).select('id').single()
      if (insErr) throw insErr
      if (fileRef.current) fileRef.current.value = ''
      await load()
      // Autofill from text-readable docs.
      if (isText(file)) {
        setMsg('Reading document for autofill…')
        const res = await callExtractFromDocument(deal.id, { documentId: row.id })
        setMsg(res?.autofill === 'needs_text' ? 'Stored. Paste its text to autofill.' : `Stored. ${res?.suggested || 0} field suggestion(s) added.`)
      } else {
        setMsg('Stored. For autofill from a PDF/Word doc, use “Autofill from text”.')
      }
    } catch (e) { console.error('[DocumentsPanel] upload', e); setMsg(`Upload failed: ${e?.message || e}`) }
    finally { setUploading(false) }
  }

  async function autofillFromText() {
    if (pasteText.trim().length < 40) return
    setAutofilling(true); setMsg(null)
    try {
      const res = await callExtractFromDocument(deal.id, { text: pasteText })
      setMsg(res?.error ? `Failed: ${res.error}` : `${res?.suggested || 0} field suggestion(s) added — see the discovery notes.`)
      if (!res?.error) { setPasteText(''); setPasteOpen(false) }
    } catch (e) { setMsg(`Failed: ${e?.message || e}`) }
    finally { setAutofilling(false) }
  }

  async function remove(d) {
    try {
      if (d.storage_path) await supabase.storage.from('deal-documents').remove([d.storage_path])
      await supabase.from('deal_documents').delete().eq('id', d.id)
      await load()
    } catch (e) { console.error('[DocumentsPanel] remove', e) }
  }

  if (docs === null) return <Spinner />

  return (
    <Card title={title} style={{ marginBottom: 16 }}
      action={<div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => setPasteOpen(o => !o)} style={{ padding: '6px 12px', fontSize: 12 }}>Autofill from text</Button>
        <label style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${T.primaryBorder}`, background: T.primaryLight, color: T.primary, cursor: uploading ? 'wait' : 'pointer', fontFamily: T.font }}>
          {uploading ? 'Uploading…' : 'Upload'}
          <input ref={fileRef} type="file" disabled={uploading} onChange={e => upload(e.target.files?.[0])} style={{ display: 'none' }} />
        </label>
      </div>}>
      {pasteOpen && (
        <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${T.borderLight}` }}>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5} placeholder="Paste a company snapshot, notes, or any document text. We'll propose discovery field values from it."
            style={{ ...inputStyle, fontSize: 13, resize: 'vertical', fontFamily: T.font, marginBottom: 6 }} />
          <Button primary disabled={pasteText.trim().length < 40 || autofilling} onClick={autofillFromText} style={{ padding: '5px 12px', fontSize: 12 }}>{autofilling ? 'Reading…' : 'Autofill notes'}</Button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 10 }}>{msg}</div>}
      {docs.length === 0 ? (
        <EmptyState compact icon="▦" title="No documents yet" message="Upload contracts, notes, or a company snapshot. The SC sees everything you add here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${T.borderLight}`, borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                <div style={{ fontSize: 10, color: T.textMuted }}>{d.file_size ? `${Math.round(d.file_size / 1024)} KB · ` : ''}{new Date(d.created_at).toLocaleDateString()}</div>
              </div>
              {isText({ name: d.name, type: d.mime_type }) && (
                <button onClick={async () => { setMsg('Reading…'); const r = await callExtractFromDocument(deal.id, { documentId: d.id }); setMsg(`${r?.suggested || 0} suggestion(s) added.`) }}
                  title="Autofill notes from this document" style={{ fontSize: 11, color: T.primary, background: 'none', border: 'none', cursor: 'pointer', fontFamily: T.font, fontWeight: 600 }}>Autofill</button>
              )}
              {d.signedUrl && <a href={d.signedUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: T.primary }}>Open ↗</a>}
              <button onClick={() => remove(d)} title="Delete" style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 15 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
