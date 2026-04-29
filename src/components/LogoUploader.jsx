import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Button } from './Shared'

/**
 * LogoUploader — drag-and-drop logo with bucket upload + orphan cleanup.
 *
 * Renders the current logo via the same <img src={url}> pattern the proposal uses,
 * so if it doesn't show here it won't show on the proposal either.
 *
 * Props:
 *   bucket       — storage bucket name (e.g. 'proposal-logos')
 *   pathPrefix   — prefix for the storage path (e.g. `${orgId}` or `${dealId}`)
 *   filename     — base filename without extension (e.g. 'org-logo' or 'customer-logo')
 *   currentUrl   — public URL of existing logo (if any)
 *   currentPath  — storage path of existing logo (deleted before upload to prevent orphans)
 *   onSaved      — async (url, path) called after successful upload + DB update
 *   onRemoved    — async () called after successful remove + DB clear
 *   label        — heading for the card body (e.g. 'Logo')
 *   helpText     — small caption under the heading
 *   maxBytes     — max file size (default 2 MB)
 */
export default function LogoUploader({
  bucket,
  pathPrefix,
  filename,
  currentUrl,
  currentPath,
  onSaved,
  onRemoved,
  label = 'Logo',
  helpText = 'SVG preferred (scales cleanly on print). PNG/JPG also accepted. Max 2 MB.',
  maxBytes = 2 * 1024 * 1024,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [cacheBust, setCacheBust] = useState(Date.now())
  const inputRef = useRef(null)

  const ALLOWED = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
  const EXT_BY_TYPE = {
    'image/svg+xml': 'svg',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
  }

  async function handleFile(file) {
    setError('')
    if (!file) return
    if (!ALLOWED.includes(file.type)) {
      setError(`Unsupported file type: ${file.type || 'unknown'}. Use SVG, PNG, JPG, or WebP.`)
      return
    }
    if (file.size > maxBytes) {
      setError(`File too large (${Math.round(file.size / 1024)} KB). Max ${Math.round(maxBytes / 1024)} KB.`)
      return
    }
    setBusy(true)
    try {
      // 1) Orphan cleanup — delete previous object before uploading new one.
      if (currentPath) {
        try {
          await supabase.storage.from(bucket).remove([currentPath])
        } catch (e) {
          console.warn('[LogoUploader] previous object cleanup failed (non-fatal):', e)
        }
      }

      // 2) Upload new file. Path includes extension; upsert handles same-extension replacement.
      const ext = EXT_BY_TYPE[file.type] || file.name.split('.').pop().toLowerCase()
      const newPath = `${pathPrefix}/${filename}.${ext}`
      const { error: upErr } = await supabase.storage.from(bucket).upload(newPath, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: '3600',
      })
      if (upErr) throw upErr

      // 3) Get public URL.
      const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(newPath)
      if (!publicUrl) throw new Error('Could not resolve public URL after upload')

      // 4) Hand off to caller to persist URL + path on the parent row.
      await onSaved(publicUrl, newPath)
      setCacheBust(Date.now())
    } catch (e) {
      console.error('[LogoUploader] upload failed:', e)
      setError(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!currentPath && !currentUrl) return
    if (!confirm('Remove this logo?')) return
    setBusy(true)
    setError('')
    try {
      if (currentPath) {
        try {
          await supabase.storage.from(bucket).remove([currentPath])
        } catch (e) {
          console.warn('[LogoUploader] storage remove failed (non-fatal):', e)
        }
      }
      await onRemoved()
      setCacheBust(Date.now())
    } catch (e) {
      console.error('[LogoUploader] remove failed:', e)
      setError(e?.message || 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  // Cache-bust the rendered img so a replaced logo at the same URL refreshes immediately.
  const renderedUrl = currentUrl ? `${currentUrl}${currentUrl.includes('?') ? '&' : '?'}t=${cacheBust}` : null

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10 }}>{helpText}</div>

      {/* Render the actual logo using the same <img> pattern the proposal uses */}
      {renderedUrl ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 12, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`, marginBottom: 10 }}>
          <div style={{ width: 120, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.surface, borderRadius: 4, border: `1px solid ${T.borderLight}`, overflow: 'hidden' }}>
            <img
              src={renderedUrl}
              alt={label}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onError={() => setError('Image failed to load — check the URL is publicly accessible')}
            />
          </div>
          <div style={{ flex: 1, fontSize: 11, color: T.textSecondary, wordBreak: 'break-all', fontFamily: T.mono }}>{currentUrl}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button onClick={() => inputRef.current?.click()} disabled={busy} style={{ padding: '6px 12px', fontSize: 11 }}>Replace</Button>
            <Button danger onClick={handleRemove} disabled={busy} style={{ padding: '6px 12px', fontSize: 11 }}>Remove</Button>
          </div>
        </div>
      ) : null}

      {/* Drag-and-drop / picker zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => !busy && inputRef.current?.click()}
        style={{
          padding: '20px 16px',
          border: `2px dashed ${dragOver ? T.primary : T.border}`,
          borderRadius: 8,
          background: dragOver ? T.primaryLight : T.surfaceAlt,
          textAlign: 'center',
          cursor: busy ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 4 }}>
          {busy ? 'Uploading…' : currentUrl ? 'Drop a new file to replace' : 'Drop a file here, or click to pick'}
        </div>
        <div style={{ fontSize: 10, color: T.textMuted }}>SVG, PNG, JPG, WebP · up to {Math.round(maxBytes / 1024 / 1024)} MB</div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED.join(',')}
        style={{ display: 'none' }}
        onChange={e => handleFile(e.target.files?.[0])}
      />

      {error && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, border: `1px solid ${T.error}30` }}>
          {error}
        </div>
      )}
    </div>
  )
}
