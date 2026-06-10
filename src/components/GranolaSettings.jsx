import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Badge, Button, inputStyle, labelStyle } from './Shared'

// Granola integration management — lives on the Settings page. Owns the
// connect / disconnect lifecycle and the default-folder preference; the
// Upload Transcript dialog only consumes the connection (its meeting list
// scopes to the default folder automatically, server-side).
async function callGranolaFn(name, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body || {}),
  })
  return await r.json()
}

export default function GranolaSettings() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(true)
  const [status, setStatus] = useState(null)       // null = loading
  const [folders, setFolders] = useState(null)
  const [defaultFolder, setDefaultFolder] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(null)
  const [savedFlash, setSavedFlash] = useState(false)

  async function refreshStatus() {
    try {
      const s = await callGranolaFn('granola-auth', { action: 'status' })
      setStatus(s)
      if (s.connected && profile?.id) {
        // Default folder preference lives on the connection row (owner RLS).
        const { data } = await supabase
          .from('user_granola_connections')
          .select('default_folder_id')
          .eq('user_id', profile.id)
          .maybeSingle()
        setDefaultFolder(data?.default_folder_id || '')
      }
    } catch {
      setStatus({ connected: false })
    }
  }
  useEffect(() => { if (profile?.id) refreshStatus() }, [profile?.id])

  // OAuth popup posts back from the Supabase functions origin only.
  useEffect(() => {
    const trustedOrigin = new URL(import.meta.env.VITE_SUPABASE_URL).origin
    function onMsg(e) {
      if (e.origin !== trustedOrigin) return
      if (e.data?.type === 'granola-connected') { setConnecting(false); refreshStatus() }
      if (e.data?.type === 'granola-connect-error') { setConnecting(false); setError(`Granola: ${e.data.message}`) }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [profile?.id])

  // Load the folder list once connected.
  useEffect(() => {
    if (!status?.connected) { setFolders(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await callGranolaFn('granola-meetings', { list: 'folders' })
        if (!cancelled) setFolders(res.folders || [])
      } catch {
        if (!cancelled) setFolders([])
      }
    })()
    return () => { cancelled = true }
  }, [status?.connected])

  async function connect() {
    setConnecting(true); setError(null)
    try {
      const res = await callGranolaFn('granola-auth', { action: 'start' })
      if (res.error) throw new Error(res.error)
      const popup = window.open(res.authorize_url, 'granola-connect', 'width=480,height=720,noopener=no')
      if (!popup) {
        setConnecting(false)
        setError('Popup blocked. Allow popups for this site and try again.')
        return
      }
      const poll = setInterval(() => {
        if (popup.closed) { clearInterval(poll); setConnecting(false); refreshStatus() }
      }, 800)
    } catch (e) {
      setConnecting(false)
      setError(`Connect failed: ${e.message}`)
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Granola? Your imported transcripts stay; you just won\'t be able to import new calls until you reconnect.')) return
    try {
      await callGranolaFn('granola-auth', { action: 'disconnect' })
      setFolders(null); setDefaultFolder('')
      refreshStatus()
    } catch (e) { setError(`Disconnect failed: ${e.message}`) }
  }

  async function saveDefaultFolder(folderId) {
    setDefaultFolder(folderId)
    const folder = (folders || []).find(f => f.id === folderId) || null
    try {
      const { error: e } = await supabase
        .from('user_granola_connections')
        .update({ default_folder_id: folderId || null, default_folder_name: folder?.title || null })
        .eq('user_id', profile.id)
      if (e) throw e
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setError(`Could not save folder preference: ${e.message}`)
    }
  }

  return (
    <div id="granola" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Granola</span>
        {status?.connected && <Badge color={T.success}>Connected</Badge>}
        {savedFlash && <span style={{ fontSize: 12, color: T.success, fontWeight: 600 }}>Saved</span>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.textMuted }}>{open ? 'Hide' : 'Show'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {status === null ? (
            <div style={{ fontSize: 12, color: T.textMuted }}>Checking connection...</div>
          ) : !status.connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: T.textSecondary, lineHeight: 1.5 }}>
                Connect your Granola account to import call transcripts into deals directly from the
                Upload Transcript dialog — no copy-paste.
              </div>
              <Button primary onClick={connect} disabled={connecting} style={{ padding: '8px 14px', fontSize: 12 }}>
                {connecting ? 'Waiting for Granola...' : 'Connect Granola'}
              </Button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, color: T.text }}>
                  Connected as <strong>{status.granola_email || 'your Granola account'}</strong>
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={disconnect}
                  style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: T.font, padding: '5px 10px' }}>
                  Disconnect
                </button>
              </div>

              <div>
                <label style={labelStyle}>Default folder</label>
                {folders === null ? (
                  <div style={{ fontSize: 12, color: T.textMuted }}>Loading folders...</div>
                ) : (
                  <select
                    value={defaultFolder}
                    onChange={e => saveDefaultFolder(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer', maxWidth: 420 }}>
                    <option value="">All meetings (no folder filter)</option>
                    {folders.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.title}{f.note_count ? ` (${f.note_count})` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                  The Upload Transcript dialog lists meetings from this folder by default. Pick
                  "All meetings" to see everything.
                </div>
              </div>
            </>
          )}

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, background: T.errorLight, color: T.error, border: `1px solid ${T.error}25` }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
