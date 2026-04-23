import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T, formatDate } from '../../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../../components/Shared'

export default function ExtractionDefinitions() {
  const { profile } = useAuth()
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadRules() }, [])

  async function loadRules() {
    setLoading(true)
    const { data } = await supabase.from('system_ai_rules').select('*').order('sort_order')
    setRules(data || [])
    setLoading(false)
  }

  function startEdit(rule) {
    setEditingId(rule.id)
    setEditContent(rule.rule_content)
    setOriginalContent(rule.rule_content)
  }

  async function saveEdit() {
    if (!editingId || editContent === originalContent) { setEditingId(null); return }
    setSaving(true)
    const rule = rules.find(r => r.id === editingId)

    // Audit log
    await supabase.from('system_ai_rules_audit').insert({
      rule_id: editingId,
      changed_by: profile.id,
      field_changed: 'rule_content',
      old_value: originalContent,
      new_value: editContent,
      change_reason: 'Manual edit via admin UI',
    }).catch(() => {})

    // Update rule + increment version
    await supabase.from('system_ai_rules').update({
      rule_content: editContent,
      rule_version: (rule?.rule_version || 1) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', editingId)

    setEditingId(null)
    setSaving(false)
    loadRules()
  }

  const layerColors = { platform_core: T.error, methodology_baseline: T.primary, methodology_addon: T.success, coach_context: T.warning }
  const layerLabels = { platform_core: 'Platform Core', methodology_baseline: 'Methodology Baseline', methodology_addon: 'Methodology Addon', coach_context: 'Coach Context' }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Extraction Definitions & AI Rules</h2>
        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>Locked platform rules that govern how the AI extracts and validates data. Changes are versioned and audited.</div>
      </div>

      <div style={{ padding: '16px 24px' }}>
        {rules.map(rule => {
          const isEditing = editingId === rule.id
          return (
            <div key={rule.id} style={{ marginBottom: 8, background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, borderLeft: `3px solid ${layerColors[rule.layer] || T.textMuted}`, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => isEditing ? null : startEdit(rule)}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{rule.rule_name || rule.rule_key}</span>
                    {rule.locked && <span style={{ fontSize: 8, fontWeight: 700, color: T.error, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Locked</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, fontSize: 10, color: T.textMuted }}>
                    <span style={{ fontFamily: T.mono }}>{rule.rule_key}</span>
                    <span>v{rule.rule_version || 1}</span>
                    {rule.applies_to_table && <span>table: {rule.applies_to_table}</span>}
                  </div>
                </div>
                <Badge color={layerColors[rule.layer] || T.textMuted}>{layerLabels[rule.layer] || rule.layer}</Badge>
                <Badge color={T.textMuted}>{rule.rule_type}</Badge>
                {!isEditing && <span style={{ fontSize: 11, color: T.primary, fontWeight: 600 }}>Edit</span>}
              </div>

              {isEditing && (
                <div style={{ padding: '0 16px 16px' }}>
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    style={{
                      width: '100%', minHeight: 200, padding: 12, fontSize: 12,
                      fontFamily: T.mono, lineHeight: 1.6, resize: 'vertical',
                      border: `1px solid ${T.border}`, borderRadius: 6,
                      background: T.surfaceAlt, color: T.text,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <Button primary onClick={saveEdit} disabled={saving || editContent === originalContent}>
                      {saving ? 'Saving...' : 'Save & Increment Version'}
                    </Button>
                    <Button onClick={() => setEditingId(null)}>Cancel</Button>
                    {editContent !== originalContent && (
                      <span style={{ fontSize: 11, color: T.warning, fontWeight: 600 }}>
                        {editContent.length - originalContent.length > 0 ? '+' : ''}{editContent.length - originalContent.length} chars changed
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
