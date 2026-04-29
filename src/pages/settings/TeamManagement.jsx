import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Card, Button, Spinner, inputStyle, labelStyle } from '../../components/Shared'

const WORKING_TEAM_TYPES = [
  { key: 'internal_sc', label: 'Internal SC' },
  { key: 'external_sc', label: 'External SC' },
  { key: 'technical_sc', label: 'Technical SC' },
  { key: 'partner', label: 'Partner' },
  { key: 'manager', label: 'Manager' },
  { key: 'other', label: 'Other' },
]

function initialsOf(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function TeamManagement() {
  const { user, org } = useOrg()
  const [workingTeam, setWorkingTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [newMember, setNewMember] = useState({ name: '', email: '', member_type: 'internal_sc', title: '' })
  const [showAddMember, setShowAddMember] = useState(false)

  useEffect(() => { loadTeam() }, [])

  function flash(msg, isError = false) {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3000)
  }

  async function loadTeam() {
    setLoading(true)
    const { data } = await supabase.from('user_team_members')
      .select('*').eq('user_id', user.id).order('name')
    setWorkingTeam(data || [])
    setLoading(false)
  }

  async function addWorkingMember() {
    if (!newMember.name.trim()) return
    const { data, error } = await supabase.from('user_team_members').insert({
      user_id: user.id, org_id: org.id,
      name: newMember.name.trim(), email: newMember.email.trim() || null,
      member_type: newMember.member_type, title: newMember.title.trim() || null,
    }).select().single()
    if (error) { flash(error.message, true); return }
    setWorkingTeam(prev => [...prev, data].sort((a, b) => (a.name || '').localeCompare(b.name || '')))
    setShowAddMember(false)
    setNewMember({ name: '', email: '', member_type: 'internal_sc', title: '' })
  }

  async function updateWorkingMember(id, field, value) {
    const { error } = await supabase.from('user_team_members').update({ [field]: value }).eq('id', id)
    if (error) { flash(error.message, true); return }
    setWorkingTeam(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  async function deleteWorkingMember(id) {
    if (!window.confirm('Remove this teammate from your working team?')) return
    await supabase.from('user_team_members').delete().eq('id', id)
    setWorkingTeam(prev => prev.filter(m => m.id !== id))
  }

  // Upload a headshot image for a member. Path is `<user_id>/<member_id>-<timestamp>.<ext>` so
  // the storage RLS policy (auth.uid() = first folder) lets the owner manage their own.
  async function uploadAvatar(member, file) {
    if (!file) return
    if (!file.type.startsWith('image/')) { flash('Please select an image file', true); return }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `${user.id}/${member.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('team-avatars').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { flash(upErr.message, true); return }
    const { data: pub } = supabase.storage.from('team-avatars').getPublicUrl(path)
    if (pub?.publicUrl) await updateWorkingMember(member.id, 'avatar_url', pub.publicUrl)
  }

  async function removeAvatar(member) {
    await updateWorkingMember(member.id, 'avatar_url', null)
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', paddingRight: 72, borderBottom: '1px solid ' + T.border, background: T.surface }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>My Team</h2>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
              Solutions consultants, partners, managers, and collaborators you work with on deals.
            </div>
          </div>
          <Button primary onClick={() => setShowAddMember(true)}>+ New</Button>
        </div>
      </div>

      {toast && (
        <div style={{ padding: '10px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 13, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
          {toast.msg}
        </div>
      )}

      <div style={{ padding: '16px 24px' }}>
        {showAddMember && (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.5fr 1.5fr auto auto', gap: 8, alignItems: 'end' }}>
              <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={newMember.name} onChange={e => setNewMember(p => ({ ...p, name: e.target.value }))} autoFocus onKeyDown={e => e.key === 'Enter' && addWorkingMember()} /></div>
              <div><label style={labelStyle}>Email</label><input style={inputStyle} value={newMember.email} onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))} placeholder="optional" /></div>
              <div><label style={labelStyle}>Role</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newMember.member_type} onChange={e => setNewMember(p => ({ ...p, member_type: e.target.value }))}>{WORKING_TEAM_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
              <div><label style={labelStyle}>Title</label><input style={inputStyle} value={newMember.title} onChange={e => setNewMember(p => ({ ...p, title: e.target.value }))} placeholder="optional" /></div>
              <Button primary onClick={addWorkingMember} style={{ padding: '6px 14px' }}>Add</Button>
              <Button onClick={() => { setShowAddMember(false); setNewMember({ name: '', email: '', member_type: 'internal_sc', title: '' }) }}>Cancel</Button>
            </div>
          </Card>
        )}

        {workingTeam.length === 0 ? (
          <Card>
            <div style={{ padding: 28, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
              <div style={{ marginBottom: 12, fontWeight: 600, color: T.text }}>No teammates yet</div>
              <div style={{ marginBottom: 16 }}>Add solutions consultants, partners, or managers you work with. They don't need a platform account.</div>
              <Button primary onClick={() => setShowAddMember(true)}>+ Add your first teammate</Button>
            </div>
          </Card>
        ) : (
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {workingTeam.map(m => (
                <MemberCard key={m.id} member={m}
                  onUpdate={(field, val) => updateWorkingMember(m.id, field, val)}
                  onUploadAvatar={(file) => uploadAvatar(m, file)}
                  onRemoveAvatar={() => removeAvatar(m)}
                  onDelete={() => deleteWorkingMember(m.id)} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function MemberCard({ member, onUpdate, onUploadAvatar, onRemoveAvatar, onDelete }) {
  const fileInputRef = useRef(null)
  const isDefault = !!member.is_default_team

  return (
    <div style={{
      padding: 14, background: T.surface, borderRadius: 8,
      border: `1px solid ${isDefault ? T.primary + '55' : T.borderLight}`,
      boxShadow: isDefault ? `0 0 0 1px ${T.primary}22` : 'none',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Avatar — click to upload */}
        <button onClick={() => fileInputRef.current?.click()}
          title="Upload headshot"
          style={{
            position: 'relative', width: 56, height: 56, borderRadius: '50%',
            border: `2px solid ${isDefault ? T.primary : T.borderLight}`, padding: 0,
            background: member.avatar_url ? `url(${member.avatar_url}) center/cover` : T.primary + '20',
            color: T.primary, cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700, fontFamily: T.font,
          }}>
          {!member.avatar_url && initialsOf(member.name)}
          <span style={{
            position: 'absolute', right: -2, bottom: -2,
            width: 20, height: 20, borderRadius: '50%', background: T.primary, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
            border: `2px solid ${T.surface}`,
          }}>+</span>
        </button>
        <input ref={fileInputRef} type="file" accept="image/*"
          onChange={e => { if (e.target.files?.[0]) onUploadAvatar(e.target.files[0]); e.target.value = '' }}
          style={{ display: 'none' }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <input style={{ ...inputStyle, padding: '5px 8px', fontSize: 14, fontWeight: 600, border: `1px solid transparent`, background: 'transparent' }}
            defaultValue={member.name || ''} onBlur={e => onUpdate('name', e.target.value)}
            placeholder="Name"
            onFocus={e => e.currentTarget.style.border = `1px solid ${T.border}`}
            onMouseEnter={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = `1px solid ${T.borderLight}` }}
            onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = `1px solid transparent` }} />
          <input style={{ ...inputStyle, padding: '3px 8px', fontSize: 11, color: T.textMuted, border: `1px solid transparent`, background: 'transparent' }}
            defaultValue={member.title || ''} onBlur={e => onUpdate('title', e.target.value)}
            placeholder="Role / title"
            onFocus={e => e.currentTarget.style.border = `1px solid ${T.border}`}
            onMouseEnter={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = `1px solid ${T.borderLight}` }}
            onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = `1px solid transparent` }} />
        </div>

        <button onClick={onDelete} title="Remove teammate"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 13, padding: 4, fontFamily: T.font }}
          onMouseEnter={e => e.currentTarget.style.color = T.error}
          onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>×</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <input style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
          defaultValue={member.email || ''} onBlur={e => onUpdate('email', e.target.value)}
          placeholder="Email" type="email" />
        <input style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
          defaultValue={member.phone || ''} onBlur={e => onUpdate('phone', e.target.value)}
          placeholder="Phone" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select style={{ ...inputStyle, padding: '4px 8px', fontSize: 11, cursor: 'pointer', flex: 1 }}
          value={member.member_type || 'internal_sc'} onChange={e => onUpdate('member_type', e.target.value)}>
          {WORKING_TEAM_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>

      {/* Default for every deal toggle */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        background: isDefault ? T.primaryLight : T.surfaceAlt,
        border: `1px solid ${isDefault ? T.primary + '40' : T.borderLight}`,
        borderRadius: 6, cursor: 'pointer', userSelect: 'none',
      }}>
        <span onClick={() => onUpdate('is_default_team', !isDefault)}
          style={{
            width: 32, height: 18, borderRadius: 9, position: 'relative',
            background: isDefault ? T.primary : T.borderLight,
            transition: 'background 0.15s', flexShrink: 0,
          }}>
          <span style={{
            position: 'absolute', top: 2, left: isDefault ? 16 : 2,
            width: 14, height: 14, borderRadius: '50%', background: '#fff',
            transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </span>
        <div style={{ flex: 1, fontSize: 11 }}>
          <div style={{ fontWeight: 600, color: T.text }}>Default for every deal</div>
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1 }}>
            Auto-include on every project plan stage when a template is applied.
          </div>
        </div>
      </label>

      {member.avatar_url && (
        <button onClick={onRemoveAvatar}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 10, fontFamily: T.font, alignSelf: 'flex-start', padding: 0 }}
          onMouseEnter={e => e.currentTarget.style.color = T.error}
          onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
          Remove headshot
        </button>
      )}
    </div>
  )
}
