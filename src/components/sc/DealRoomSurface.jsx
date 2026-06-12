import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Spinner, Card, Button, EmptyState, inputStyle, labelStyle } from '../Shared'
import { notify } from '../../lib/notifications'

// SC deal-room surface — upload demo videos (deal-room-videos bucket ->
// deal_resources row, type 'demo_video') so they appear in the client-facing
// DealRoom, plus a link to open the full room. Reuses the existing DealRoom
// UI; does not rebuild it. Upload fires sc_uploaded_demo_video.
export default function DealRoomSurface({ deal }) {
  const { profile } = useAuth()
  const [videos, setVideos] = useState(null)
  const [modules, setModules] = useState([])
  const [title, setTitle] = useState('')
  const [moduleKey, setModuleKey] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => { load() }, [deal?.id])

  async function load() {
    try {
      const [vid, mods] = await Promise.all([
        supabase.from('deal_resources').select('*').eq('deal_id', deal.id).eq('resource_type', 'demo_video').order('created_at', { ascending: false }),
        supabase.from('deal_modules').select('module_key').eq('deal_id', deal.id),
      ])
      setVideos(vid.data || [])
      if ((mods.data || []).length) {
        const keys = mods.data.map(m => m.module_key)
        const { data: ref } = await supabase.from('module_reference').select('module_key, name').in('module_key', keys)
        setModules(ref || [])
      } else setModules([])
    } catch (e) { console.error('[DealRoomSurface] load', e) }
  }

  async function upload() {
    if (!file) return
    setUploading(true); setErr(null)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${deal.id}/${Date.now()}-${safe}`
      const { error: upErr } = await supabase.storage.from('deal-room-videos').upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('deal-room-videos').getPublicUrl(path)
      const { error: insErr } = await supabase.from('deal_resources').insert({
        org_id: deal.org_id, deal_id: deal.id, resource_type: 'demo_video',
        title: title || file.name, storage_path: path, url: pub?.publicUrl || null,
        mime_type: file.type, file_size: file.size, created_by: profile?.id,
        notes: moduleKey ? `Shows: ${modules.find(m => m.module_key === moduleKey)?.name || moduleKey}` : null,
      })
      if (insErr) throw insErr
      await notify({ recipientId: deal.rep_id, actorId: profile?.id, dealId: deal.id, orgId: deal.org_id,
        kind: 'sc_uploaded_demo_video', payload: { actor_name: profile?.full_name, deal_company: deal.company_name, title: title || file.name } })
      setTitle(''); setModuleKey(''); setFile(null); if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (e) { console.error('[DealRoomSurface] upload', e); setErr(e?.message || 'Upload failed') }
    finally { setUploading(false) }
  }

  if (videos === null) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Demo videos" action={<Button onClick={() => window.open(`/deal/${deal.id}/room`, '_blank')} style={{ padding: '6px 12px', fontSize: 12 }}>Open deal room</Button>}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${T.borderLight}` }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Multi-entity consolidation walkthrough" />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={labelStyle}>Shows module</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={moduleKey} onChange={e => setModuleKey(e.target.value)}>
              <option value="">—</option>
              {modules.map(m => <option key={m.module_key} value={m.module_key}>{m.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={labelStyle}>Video file</label>
            <input ref={fileRef} type="file" accept="video/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 12, fontFamily: T.font }} />
          </div>
          <Button primary disabled={!file || uploading} onClick={upload}>{uploading ? 'Uploading…' : 'Upload'}</Button>
        </div>
        {err && <div style={{ fontSize: 12, color: T.error, marginBottom: 10 }}>{err}</div>}
        {videos.length === 0 ? (
          <EmptyState compact icon="▷" title="No demo videos yet" message="Upload a recorded demo. It shows up in the client's deal room." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {videos.map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: `1px solid ${T.borderLight}`, borderRadius: 8 }}>
                <span style={{ fontSize: 18 }}>▷</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{v.title}</div>
                  {v.notes && <div style={{ fontSize: 11, color: T.textMuted }}>{v.notes}</div>}
                </div>
                {v.url && <a href={v.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.primary, fontWeight: 600 }}>View ↗</a>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
