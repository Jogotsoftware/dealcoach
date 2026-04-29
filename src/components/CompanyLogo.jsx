import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const SIZES = { sm: 24, md: 32, lg: 48, xl: 64 }
const ALLOWED = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024

/**
 * CompanyLogo — renders the customer logo for a deal.
 *
 * When editable=true, clicking the logo opens a file picker. The chosen file is
 * uploaded to the `proposal-logos` bucket at `<dealId>/customer-logo.<ext>`, the
 * deals row is updated with logo_url + storage_path, and onUploaded fires so the
 * caller can refresh local state.
 *
 * Source-of-truth chain: customer_logo_url (uploaded) → logoUrl prop (research /
 * fallback) → letter avatar.
 */
export default function CompanyLogo({
  logoUrl,                 // fallback URL (research / company_profile)
  customerLogoUrl,         // primary — uploaded by the AE
  companyName,
  size = 'md',
  bare = false,            // when true, render the logo image with no border/background frame
  editable = false,
  dealId,
  currentStoragePath,      // existing deals.customer_logo_storage_path (for orphan cleanup on replace)
  onUploaded,              // (publicUrl, path) => void  — called after a successful upload
}) {
  const [imgError, setImgError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hover, setHover] = useState(false)
  const inputRef = useRef(null)
  const px = SIZES[size] || SIZES.md
  const letter = (companyName || '?')[0].toUpperCase()

  const effectiveUrl = customerLogoUrl || logoUrl
  const showImage = !!effectiveUrl && !imgError

  async function handleFile(file) {
    if (!file || !editable || !dealId) return
    if (!ALLOWED.includes(file.type)) {
      alert(`Unsupported file type: ${file.type || 'unknown'}. Use SVG, PNG, JPG, or WebP.`)
      return
    }
    if (file.size > MAX_BYTES) {
      alert(`File too large (${Math.round(file.size / 1024)} KB). Max ${Math.round(MAX_BYTES / 1024)} KB.`)
      return
    }
    setBusy(true)
    try {
      // Orphan cleanup: delete previous object if it exists
      if (currentStoragePath) {
        try { await supabase.storage.from('proposal-logos').remove([currentStoragePath]) } catch (e) { console.warn('previous logo cleanup failed (non-fatal):', e) }
      }
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${dealId}/customer-logo.${ext}`
      const { error: upErr } = await supabase.storage.from('proposal-logos').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('proposal-logos').getPublicUrl(path)
      const { error: dbErr } = await supabase.from('deals').update({ customer_logo_url: publicUrl, customer_logo_storage_path: path }).eq('id', dealId)
      if (dbErr) throw dbErr
      setImgError(false)
      if (onUploaded) onUploaded(publicUrl, path)
    } catch (e) {
      console.error('[CompanyLogo] upload failed:', e)
      alert(e?.message || 'Upload failed')
    } finally { setBusy(false) }
  }

  const editableProps = editable ? {
    onClick: () => !busy && inputRef.current?.click(),
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: { cursor: busy ? 'wait' : 'pointer', position: 'relative' },
    title: 'Click to upload customer logo',
  } : {}

  // Cache-bust the rendered img after upload — append the storage path so React re-mounts after replace
  const renderedSrc = effectiveUrl
    ? `${effectiveUrl}${effectiveUrl.includes('?') ? '&' : '?'}v=${currentStoragePath ? encodeURIComponent(currentStoragePath) : 'x'}`
    : null

  if (showImage) {
    return (
      <div {...editableProps} style={{ width: px, height: px, position: 'relative', flexShrink: 0, ...(editable ? { cursor: busy ? 'wait' : 'pointer' } : {}) }}>
        <img
          src={renderedSrc}
          alt={companyName}
          onError={() => setImgError(true)}
          style={{
            width: px, height: px, borderRadius: bare ? 0 : 6, objectFit: 'contain',
            border: bare ? 'none' : '1px solid #e1e4e8',
            background: bare ? 'transparent' : '#fff',
            display: 'block',
          }}
        />
        {editable && hover && !busy && (
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 6, background: 'rgba(0,0,0,0.45)', color: '#fff',
            fontSize: Math.max(8, px * 0.18), fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none', pointerEvents: 'none',
          }}>{busy ? '…' : 'Edit'}</div>
        )}
        {busy && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(9, px * 0.2), fontWeight: 700, color: '#5DADE2' }}>…</div>
        )}
        {editable && (
          <input ref={inputRef} type="file" accept={ALLOWED.join(',')} style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
        )}
      </div>
    )
  }

  return (
    <div {...editableProps} style={{
      width: px, height: px, borderRadius: 6, background: '#f5f5f5',
      border: editable && hover ? '1px dashed #5DADE2' : '1px solid #e1e4e8',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: px * 0.45, fontWeight: 700, color: '#666666', flexShrink: 0,
      cursor: editable ? (busy ? 'wait' : 'pointer') : 'default',
      position: 'relative',
    }}>
      {busy ? '…' : letter}
      {editable && hover && !busy && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 6, background: 'rgba(93, 173, 226, 0.85)', color: '#fff',
          fontSize: Math.max(8, px * 0.16), fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none', pointerEvents: 'none',
        }}>Upload</div>
      )}
      {editable && (
        <input ref={inputRef} type="file" accept={ALLOWED.join(',')} style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
      )}
    </div>
  )
}
