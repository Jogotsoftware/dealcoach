import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Badge, Button, inputStyle, labelStyle } from './Shared'
import { callGranolaSync } from '../lib/webhooks'

// Links ONE Granola folder to this deal and runs the auto-sync on demand. Joe
// keeps a Granola folder per deal and labels calls (QDC / FDC / Demo / Sync /
// Proposal…); granola-sync pulls new labeled calls from the mapped folder into
// this deal with the right call type. The same mapping is swept every 2h by the
// granola-sync-every-2h cron — this control is the manual "do it now" + setup.
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

function fmt(ts) {
  if (!ts) return null
  try { return new Date(ts).toLocaleString() } catch { return ts }
}

export default function GranolaFolderLink({ dealId, orgId, userId, onSynced }) {
  const [mapping, setMapping] = useState(undefined)   // undefined = loading, null = none
  const [connected, setConnected] = useState(null)    // null = loading
  const [folders, setFolders] = useState(null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function loadMapping() {
    const { data } = await supabase
      .from('deal_granola_folders')
      .select('*')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: true })
      .limit(1)
    setMapping(data && data.length ? data[0] : null)
  }

  useEffect(() => { if (dealId) loadMapping() }, [dealId])

  // Connection check + folder list share one call to granola-meetings.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await callGranolaFn('granola-meetings', { list: 'folders' })
        if (cancelled) return
        if (res.reconnect || res.error) { setConnected(false); setFolders(null) }
        else { setConnected(true); setFolders(res.folders || []) }
      } catch {
        if (!cancelled) { setConnected(false); setFolders(null) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function selectFolder(folderId) {
    setError(null); setResult(null)
    setSaving(true)
    try {
      // Enforce one folder per deal: clear any existing mapping for this deal first.
      await supabase.from('deal_granola_folders').delete().eq('deal_id', dealId)
      if (!folderId) { setMapping(null); setSaving(false); return }
      const folder = (folders || []).find(f => f.id === folderId) || null
      const { data, error: e } = await supabase
        .from('deal_granola_folders')
        .insert({
          org_id: orgId,
          deal_id: dealId,
          user_id: userId,
          created_by: userId,
          granola_folder_id: folderId,
          granola_folder_name: folder?.title || null,
        })
        .select('*')
        .single()
      if (e) {
        // Unique(granola_folder_id) — folder already feeds another deal.
        if (e.code === '23505') throw new Error('That folder is already linked to another deal.')
        throw e
      }
      setMapping(data)
    } catch (e) {
      setError(e.message || 'Could not link folder')
      loadMapping()
    } finally { setSaving(false) }
  }

  async function syncNow() {
    setSyncing(true); setError(null); setResult(null)
    try {
      const res = await callGranolaSync(dealId)
      if (res.error) throw new Error(res.error)
      const r = (res.results || [])[0] || { imported: 0, skipped_existing: 0, new: [], errors: [] }
      setResult(r)
      if (r.errors?.length) setError(r.errors.join('; '))
      loadMapping()
      if (onSynced) onSynced()
    } catch (e) {
      setError(e.message || 'Sync failed')
    } finally { setSyncing(false) }
  }

  // Don't render the box at all while we don't yet know the connection state and
  // there's no existing mapping — avoids a flash of empty UI on every deal.
  if (connected === null && mapping === undefined) return null

  const box = {
    background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 8,
    padding: '12px 14px', marginBottom: 16,
  }

  if (connected === false) {
    // Only nudge if not already linked; otherwise stay quiet.
    if (mapping) {
      return (
        <div style={box}>
          <div style={{ fontSize: 13, color: T.text }}>
            Granola folder <strong>{mapping.granola_folder_name || mapping.granola_folder_id}</strong> is linked,
            but Granola isn’t connected. Reconnect in Settings to resume auto-sync.
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Granola folder</span>
        {mapping && <Badge color={T.success}>Auto-sync on</Badge>}
        <div style={{ flex: 1 }} />
        {mapping && (
          <Button primary onClick={syncNow} disabled={syncing} style={{ padding: '6px 12px', fontSize: 12 }}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <label style={labelStyle}>Folder feeding this deal</label>
        {folders === null ? (
          <div style={{ fontSize: 12, color: T.textMuted }}>Loading folders…</div>
        ) : (
          <select
            value={mapping?.granola_folder_id || ''}
            disabled={saving}
            onChange={e => selectFolder(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer', maxWidth: 420 }}>
            <option value="">Not linked</option>
            {folders.map(f => (
              <option key={f.id} value={f.id}>
                {f.title}{f.note_count ? ` (${f.note_count})` : ''}
              </option>
            ))}
          </select>
        )}
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
          New calls in this folder auto-import into this deal every 2 hours. Label calls
          (e.g. “Acme — QDC”, “FDC”, “Demo”) to set the call type; unlabeled calls import as a light Sync.
        </div>
      </div>

      {mapping?.last_synced_at && (
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>
          Last synced {fmt(mapping.last_synced_at)}
        </div>
      )}

      {result && (
        <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 8 }}>
          {result.imported > 0
            ? `Imported ${result.imported} new call${result.imported === 1 ? '' : 's'}.`
            : 'No new calls to import.'}
          {result.skipped_existing > 0 && ` ${result.skipped_existing} already up to date.`}
        </div>
      )}

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 8, background: T.errorLight, color: T.error, border: `1px solid ${T.error}25` }}>
          {error}
        </div>
      )}
    </div>
  )
}
