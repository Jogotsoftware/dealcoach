import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Button, Card, TabBar, inputStyle, labelStyle } from '../../components/Shared'

// US states + DC, 2-letter codes
const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],
  ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],
  ['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],
  ['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],
  ['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
  ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
  ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],
  ['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],
  ['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],
  ['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
]

// Canonical Sage vertical list (locked — used wherever a BDR/AE picks a vertical).
// The bdr_submission_fields options column will override this if an admin configures it,
// but the default is this canonical list.
const FALLBACK_VERTICALS = [
  'General Business',
  'Hospitality',
  'Healthcare',
  'Not For Profit',
  'Software & Professional Services',
  'Financial Services',
]

// Field keys whose values map to dedicated bdr_leads columns (vs custom_fields JSONB).
const BUILTIN_LEAD_COLUMNS = new Set([
  'company_name', 'website', 'employee_count', 'tech_stack', 'annual_revenue',
  'num_entities', 'accounting_team_size', 'industry', 'vertical', 'hq_state',
])

const MIN_TRANSCRIPT_CHARS = 200
const MIN_BANT_CHARS = 50

function normalizeWebsite(s) {
  const v = (s || '').trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  return `https://${v}`
}
function isValidUrl(s) {
  if (!s) return false
  try { new URL(s); return true } catch { return false }
}
function formatCurrencyDisplay(intDollars) {
  if (intDollars == null || intDollars === '') return ''
  return '$' + Number(intDollars).toLocaleString('en-US')
}
function parseCurrencyInput(s) {
  const digits = String(s ?? '').replace(/[^\d]/g, '')
  return digits === '' ? '' : String(parseInt(digits, 10))
}
function extractFromVttOrSrt(text) {
  const lines = text.split(/\r?\n/), out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^WEBVTT/i.test(line)) continue
    if (/^\d+$/.test(line)) continue
    if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(line)) continue
    if (/^\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}[.,]\d{3}/.test(line)) continue
    if (/^NOTE\b/i.test(line)) continue
    out.push(line)
  }
  return out.join('\n')
}

// ─── Tag input (built-in fields only — coupled UX) ────────────────────────────
function TagInput({ value, onChange, placeholder, idSuffix }) {
  const [input, setInput] = useState('')
  const inputId = `tag-input-${idSuffix || 'main'}`
  const addChip = (raw) => {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) return
    if ((value || []).some(v => v.toLowerCase() === trimmed.toLowerCase())) { setInput(''); return }
    onChange([...(value || []), trimmed])
    setInput('')
  }
  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
        minHeight: 36, padding: '6px 8px',
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
        fontFamily: T.font,
      }}
      onClick={() => { const el = document.getElementById(inputId); if (el) el.focus() }}
    >
      {(value || []).map((chip, i) => (
        <span key={`${chip}-${i}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: T.primaryLight, color: T.primary,
          border: `1px solid ${T.primaryBorder}`, borderRadius: 4,
          padding: '2px 6px', fontSize: 12, fontWeight: 600,
        }}>
          {chip}
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, j) => j !== i)) }}
            aria-label={`Remove ${chip}`}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.primary, fontSize: 14, padding: 0, lineHeight: 1, fontWeight: 700 }}>×</button>
        </span>
      ))}
      <input
        id={inputId}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip(input) }
          else if (e.key === 'Backspace' && !input && (value || []).length > 0) onChange(value.slice(0, -1))
        }}
        onBlur={() => { if (input.trim()) addChip(input) }}
        placeholder={(value || []).length === 0 ? (placeholder || 'Type and press Enter') : 'Add another…'}
        style={{ flex: 1, minWidth: 160, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontFamily: T.font, color: T.text }}
      />
    </div>
  )
}

// ─── Generic field renderer ───────────────────────────────────────────────────
// Renders ONE field based on its input_type. Returns null for tag_input / textarea
// where field_key='bant_notes' / 'transcript' — those have dedicated sections.
function FieldRenderer({ field, value, onChange, verticals }) {
  const it = field.input_type
  const ph = field.placeholder || undefined
  const common = {
    style: inputStyle,
    value: value ?? '',
    onChange: (e) => onChange(e.target.value),
    placeholder: ph,
  }
  if (it === 'text') return <input {...common} />
  if (it === 'url')  return <input {...common} onBlur={(e) => onChange(normalizeWebsite(e.target.value))} />
  if (it === 'number') return <input {...common} type="number" min="0" value={value ?? ''} onChange={e => onChange(e.target.value.replace(/[^\d]/g, ''))} />
  if (it === 'date')   return <input {...common} type="date" />
  if (it === 'currency') return <input {...common} type="text" inputMode="numeric" value={formatCurrencyDisplay(value)} onChange={e => onChange(parseCurrencyInput(e.target.value))} placeholder={ph || '$1,000,000'} />
  if (it === 'state') return (
    <select style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)}>
      <option value="">Select…</option>
      {US_STATES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
    </select>
  )
  if (it === 'vertical') return (
    <select style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)}>
      <option value="">Select…</option>
      {(verticals || []).map(v => <option key={v} value={v}>{v}</option>)}
    </select>
  )
  if (it === 'dropdown') return (
    <select style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)}>
      <option value="">Select…</option>
      {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  )
  if (it === 'textarea') return (
    <textarea
      style={{ ...inputStyle, minHeight: 100, fontFamily: T.font, lineHeight: 1.5, resize: 'vertical' }}
      rows={4}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={ph}
    />
  )
  // tag_input is handled inline in its dedicated section, not here
  return <div style={{ fontSize: 11, color: T.error }}>(unsupported input_type: {it})</div>
}

export default function BdrSubmit() {
  const { profile } = useAuth()
  const { org } = useOrg()
  const navigate = useNavigate()

  const [fields, setFields] = useState([])
  const [form, setForm] = useState({})
  const [verticals, setVerticals] = useState(FALLBACK_VERTICALS)
  const [transcriptMode, setTranscriptMode] = useState('paste')
  const [transcriptText, setTranscriptText] = useState('')
  const [fileName, setFileName] = useState('')
  const [submitState, setSubmitState] = useState('idle') // idle | inserting | reviewing | error
  const [reviewingExpanded, setReviewingExpanded] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const fileInputRef = useRef(null)

  // Load org's field config + verticals on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!org?.id) return
      setLoadingConfig(true)
      try {
        const { data: cfg, error: cfgErr } = await supabase
          .from('bdr_submission_fields').select('*')
          .eq('org_id', org.id).eq('active', true)
          .order('priority', { ascending: true })
        if (cfgErr) throw cfgErr
        if (cancelled) return
        setFields(cfg || [])

        // Initialize form state with type-appropriate defaults
        const initial = {}
        for (const f of (cfg || [])) {
          if (f.input_type === 'tag_input') initial[f.field_key] = []
          else initial[f.field_key] = ''
        }
        setForm(initial)

        // Vertical options from active coach
        const { data: coach } = await supabase.from('coaches')
          .select('id').eq('org_id', org.id).eq('name', 'BDR Submission Coach').eq('active', true).maybeSingle()
        if (coach?.id && !cancelled) {
          const { data: rc } = await supabase.from('coach_research_config').select('verticals').eq('coach_id', coach.id).maybeSingle()
          if (Array.isArray(rc?.verticals) && rc.verticals.length > 0) setVerticals(rc.verticals)
        }
      } catch (err) {
        if (!cancelled) setErrorMsg(`Could not load form config: ${err.message}`)
      } finally {
        if (!cancelled) setLoadingConfig(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [org?.id])

  const setFieldValue = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  // Split fields by where they render
  const transcriptField = useMemo(() => fields.find(f => f.field_key === 'transcript'), [fields])
  const bantField = useMemo(() => fields.find(f => f.field_key === 'bant_notes'), [fields])
  const tagFields = useMemo(() => fields.filter(f => f.input_type === 'tag_input'), [fields])
  const inlineFields = useMemo(() =>
    fields.filter(f =>
      f.input_type !== 'tag_input' &&
      f.input_type !== 'textarea'
    ), [fields])
  const otherTextareaFields = useMemo(() =>
    fields.filter(f =>
      f.input_type === 'textarea' &&
      f.field_key !== 'bant_notes' &&
      f.field_key !== 'transcript'
    ), [fields])

  const errors = useMemo(() => {
    const errs = {}
    for (const f of fields) {
      if (!f.required) continue
      const v = form[f.field_key]
      if (f.input_type === 'tag_input') {
        if (!Array.isArray(v) || v.length === 0) errs[f.field_key] = `Add at least one ${f.label.toLowerCase()}`
      } else if (f.field_key === 'transcript') {
        if (!transcriptText.trim() || transcriptText.trim().length < MIN_TRANSCRIPT_CHARS) {
          errs.transcript = `At least ${MIN_TRANSCRIPT_CHARS} characters required`
        }
      } else if (f.input_type === 'textarea') {
        const min = f.field_key === 'bant_notes' ? MIN_BANT_CHARS : 1
        if (!String(v ?? '').trim() || String(v).trim().length < min) {
          errs[f.field_key] = `At least ${min} character${min === 1 ? '' : 's'} required`
        }
      } else if (f.input_type === 'url') {
        const norm = normalizeWebsite(v)
        if (!norm) errs[f.field_key] = 'Required'
        else if (!isValidUrl(norm)) errs[f.field_key] = 'Invalid URL'
      } else if (f.input_type === 'number' || f.input_type === 'currency') {
        if (v === '' || v == null || Number(v) < 1) errs[f.field_key] = 'Required (min 1)'
      } else {
        if (v === '' || v == null) errs[f.field_key] = 'Required'
      }
    }
    return errs
  }, [fields, form, transcriptText])

  const canSubmit = Object.keys(errors).length === 0 &&
    submitState !== 'inserting' && submitState !== 'reviewing' && !loadingConfig

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const ext = file.name.toLowerCase().split('.').pop()
    try {
      const text = await file.text()
      if (ext === 'vtt' || ext === 'srt') setTranscriptText(extractFromVttOrSrt(text))
      else if (ext === 'txt') setTranscriptText(text)
      else if (ext === 'docx') {
        setErrorMsg('.docx parsing is not yet supported. Copy the content into the Paste tab.')
        setFileName('')
      } else setTranscriptText(text)
    } catch (err) { setErrorMsg(`Could not read file: ${err.message}`); setFileName('') }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    if (!profile?.id || !org?.id) { setErrorMsg('Profile or org not loaded. Refresh the page.'); return }
    setErrorMsg(null); setSubmitState('inserting'); setReviewingExpanded(false)

    try {
      // Build the bdr_leads INSERT payload. Built-in field_keys → dedicated columns;
      // everything else → custom_fields JSONB.
      const leadPayload = {
        org_id: org.id,
        bdr_id: profile.id,
        stage: 'ai_reviewing',
        ai_decision: 'pending',
        lead_source: 'bdr',
        custom_fields: {},
      }
      // Transcript always lives on bdr_leads.transcript (the special UI controls it).
      leadPayload.transcript = transcriptText.trim()
      // BANT goes to bdr_notes separately (handled after the lead insert).

      for (const f of fields) {
        if (!f.active) continue
        if (f.field_key === 'transcript' || f.field_key === 'bant_notes') continue
        const v = form[f.field_key]
        if (f.is_builtin && BUILTIN_LEAD_COLUMNS.has(f.field_key)) {
          if (f.input_type === 'number') leadPayload[f.field_key] = v === '' ? null : parseInt(v, 10)
          else if (f.input_type === 'currency') leadPayload[f.field_key] = v === '' ? null : parseInt(v, 10)
          else if (f.input_type === 'tag_input') leadPayload[f.field_key] = v || []
          else if (f.input_type === 'url') leadPayload[f.field_key] = normalizeWebsite(v)
          else if (typeof v === 'string') leadPayload[f.field_key] = v.trim() || null
          else leadPayload[f.field_key] = v ?? null
        } else {
          // Custom field → custom_fields JSONB. Preserve type-friendly representation.
          if (f.input_type === 'number' || f.input_type === 'currency') {
            leadPayload.custom_fields[f.field_key] = v === '' ? null : Number(v)
          } else if (f.input_type === 'tag_input') {
            leadPayload.custom_fields[f.field_key] = v || []
          } else if (f.input_type === 'url') {
            leadPayload.custom_fields[f.field_key] = normalizeWebsite(v) || null
          } else if (typeof v === 'string') {
            leadPayload.custom_fields[f.field_key] = v.trim() || null
          } else {
            leadPayload.custom_fields[f.field_key] = v ?? null
          }
        }
      }

      const { data: lead, error: insErr } = await supabase
        .from('bdr_leads').insert(leadPayload).select('id').single()
      if (insErr) throw new Error(`Lead insert failed: ${insErr.message}`)

      // BANT note (only if the bant_notes field is active and has content)
      const bantContent = String(form['bant_notes'] ?? '').trim()
      if (bantField && bantField.active && bantContent) {
        try {
          await supabase.from('bdr_notes').insert({
            lead_id: lead.id, org_id: org.id, created_by: profile.id,
            note_type: 'bant', content: bantContent,
          })
        } catch (err) { console.warn('bdr_notes insert failed (non-fatal):', err) }
      }

      // Fire pre-qdc-decision
      setSubmitState('reviewing')
      const expandTimer = setTimeout(() => setReviewingExpanded(true), 3000)
      const { data: decision, error: fnErr } = await supabase.functions.invoke(
        'pre-qdc-decision', { body: { lead_id: lead.id } },
      )
      clearTimeout(expandTimer)
      if (fnErr) throw new Error(`AI review failed: ${fnErr.message}. Lead saved (id ${lead.id}).`)
      if (decision?.error) throw new Error(`AI review error: ${decision.error}. Lead saved (id ${lead.id}).`)

      navigate(`/bdr/leads/${lead.id}`)
    } catch (err) {
      console.error('Submission failed:', err)
      setErrorMsg(err.message || String(err))
      setSubmitState('error')
    }
  }

  const showErr = (k) => submitState === 'error' ? errors[k] : null

  return (
    <div>
      <div style={{
        padding: '14px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12, background: T.surface,
      }}>
        <button type="button" onClick={() => navigate('/')} style={{
          background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
          padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
          fontWeight: 600, fontFamily: T.font,
        }}>&larr; Back</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Submit a New Lead</h2>
      </div>

      <div style={{ padding: 24, maxWidth: 820 }}>
        {loadingConfig && <Card><div style={{ padding: 16, color: T.textMuted }}>Loading form…</div></Card>}

        {!loadingConfig && (
          <form onSubmit={handleSubmit}>
            {/* Inline fields in a 2-col grid */}
            {inlineFields.length > 0 && (
              <Card title="Submission">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {inlineFields.map(f => (
                    <div key={f.field_key}>
                      <label style={labelStyle}>{f.label}{f.required ? ' *' : ''}</label>
                      <FieldRenderer
                        field={f}
                        value={form[f.field_key]}
                        onChange={(v) => setFieldValue(f.field_key, v)}
                        verticals={verticals}
                      />
                      {f.help_text && (
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{f.help_text}</div>
                      )}
                      {showErr(f.field_key) && <ErrLine msg={showErr(f.field_key)} />}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Tag inputs (one card per tag_input field — usually just tech_stack) */}
            {tagFields.map(f => (
              <Card key={f.field_key} title={f.label}>
                <label style={labelStyle}>{f.label}{f.required ? ' *' : ''}</label>
                <TagInput
                  value={form[f.field_key]}
                  onChange={(v) => setFieldValue(f.field_key, v)}
                  placeholder={f.placeholder}
                  idSuffix={f.field_key}
                />
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                  {f.help_text || 'Press Enter or comma to add. Backspace on empty input removes the last chip.'}
                </div>
                {showErr(f.field_key) && <ErrLine msg={showErr(f.field_key)} />}
              </Card>
            ))}

            {/* BANT notes (if active) */}
            {bantField && bantField.active && (
              <Card title={bantField.label}>
                <label style={labelStyle}>{bantField.label}{bantField.required ? ' *' : ''}</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 140, fontFamily: T.font, lineHeight: 1.5, resize: 'vertical' }}
                  rows={6}
                  value={form['bant_notes'] ?? ''}
                  onChange={(e) => setFieldValue('bant_notes', e.target.value)}
                  placeholder={bantField.placeholder || 'Budget...\nAuthority...\nNeed...\nTimeline...\n\nCompelling event:'}
                />
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                  {String(form['bant_notes'] ?? '').trim().length} / {MIN_BANT_CHARS} characters minimum
                  {bantField.help_text && <> — {bantField.help_text}</>}
                </div>
                {showErr('bant_notes') && <ErrLine msg={showErr('bant_notes')} />}
              </Card>
            )}

            {/* Other textarea fields (custom notes beyond BANT) */}
            {otherTextareaFields.length > 0 && (
              <Card title="Additional Notes">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {otherTextareaFields.map(f => (
                    <div key={f.field_key}>
                      <label style={labelStyle}>{f.label}{f.required ? ' *' : ''}</label>
                      <FieldRenderer
                        field={f}
                        value={form[f.field_key]}
                        onChange={(v) => setFieldValue(f.field_key, v)}
                        verticals={verticals}
                      />
                      {f.help_text && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{f.help_text}</div>}
                      {showErr(f.field_key) && <ErrLine msg={showErr(f.field_key)} />}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Transcript section (special 3-tab UI) */}
            {transcriptField && transcriptField.active && (
              <Card title={transcriptField.label || 'Call Recording / Transcript'}>
                <TabBar
                  tabs={[
                    { key: 'audio', label: 'Audio (coming soon)' },
                    { key: 'paste', label: 'Paste Transcript' },
                    { key: 'file',  label: 'Upload Text File' },
                  ]}
                  active={transcriptMode}
                  onChange={setTranscriptMode}
                />

                {transcriptMode === 'audio' && (
                  <AudioComingSoonPanel onSwitchToPaste={() => setTranscriptMode('paste')} />
                )}

                {transcriptMode === 'paste' && (
                  <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>Paste transcript text{transcriptField.required ? ' *' : ''}</label>
                    <textarea
                      style={{ ...inputStyle, minHeight: 220, fontFamily: T.mono, fontSize: 12, lineHeight: 1.5, resize: 'vertical' }}
                      rows={12}
                      value={transcriptText}
                      onChange={(e) => setTranscriptText(e.target.value)}
                      placeholder="BDR: Thanks for taking the call...&#10;Prospect: Sure...&#10;..."
                    />
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                      {transcriptText.trim().length} / {MIN_TRANSCRIPT_CHARS} characters minimum. Capture in Fathom / Gong / Chorus and paste here.
                    </div>
                    {showErr('transcript') && <ErrLine msg={showErr('transcript')} />}
                  </div>
                )}

                {transcriptMode === 'file' && (
                  <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>Upload transcript text file{transcriptField.required ? ' *' : ''}</label>
                    <input ref={fileInputRef} type="file" accept=".txt,.vtt,.srt"
                      onChange={handleFileChange} style={{ display: 'block', fontFamily: T.font, fontSize: 12 }} />
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
                      Accepts .txt, .vtt, .srt. For .docx, paste the content into the Paste tab.
                    </div>
                    {fileName && (
                      <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 8 }}>
                        Loaded: <strong>{fileName}</strong> — {transcriptText.length.toLocaleString()} characters
                      </div>
                    )}
                    {transcriptText && (
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600 }}>
                          Preview extracted text
                        </summary>
                        <pre style={{
                          marginTop: 8, padding: 10, background: T.surfaceAlt,
                          border: `1px solid ${T.border}`, borderRadius: 6,
                          fontSize: 11, fontFamily: T.mono, color: T.text,
                          maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap',
                        }}>{transcriptText.substring(0, 4000)}{transcriptText.length > 4000 ? '\n…(truncated for preview)' : ''}</pre>
                      </details>
                    )}
                    {showErr('transcript') && <ErrLine msg={showErr('transcript')} />}
                  </div>
                )}
              </Card>
            )}

            {errorMsg && (
              <div style={{
                background: T.errorLight, border: `1px solid ${T.error}33`,
                borderRadius: 6, padding: '10px 12px', marginBottom: 12,
                fontSize: 12, color: T.error, lineHeight: 1.5,
              }}>{errorMsg}</div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <Button type="submit" primary disabled={!canSubmit} style={{ padding: '10px 24px', fontSize: 13 }}>
                {submitState === 'inserting' ? 'Submitting…' :
                 submitState === 'reviewing'
                   ? (reviewingExpanded ? 'AI is reviewing — this usually takes 5–10 seconds.' : 'AI is reviewing your submission…')
                   : 'Submit Lead'}
              </Button>
              {!canSubmit && submitState === 'idle' && Object.keys(errors).length > 0 && (
                <span style={{ fontSize: 12, color: T.textMuted }}>
                  {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? '' : 's'} still need attention
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function ErrLine({ msg }) {
  return <div style={{ fontSize: 11, color: T.error, marginTop: 4, fontWeight: 600 }}>{msg}</div>
}

function AudioComingSoonPanel({ onSwitchToPaste }) {
  return (
    <div style={{
      marginTop: 12, padding: 16,
      background: T.surfaceAlt, border: `1px dashed ${T.border}`, borderRadius: 6,
      fontSize: 13, color: T.textSecondary, lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>Audio transcription is coming soon.</div>
      For now, capture the transcript in Fathom, Gong, or Chorus and paste the text into the Paste tab.
      <div style={{ marginTop: 10 }}>
        <Button type="button" onClick={onSwitchToPaste}>Switch to Paste tab</Button>
      </div>
    </div>
  )
}
