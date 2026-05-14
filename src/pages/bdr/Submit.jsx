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

// Fallback vertical list if coach_research_config.verticals is empty (defensive)
const FALLBACK_VERTICALS = [
  'Manufacturing', 'Distribution', 'SaaS', 'Professional Services', 'Nonprofit', 'PE-backed Services',
]

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

// Strip everything but digits, return integer string (or '')
function parseCurrencyInput(s) {
  const digits = String(s ?? '').replace(/[^\d]/g, '')
  return digits === '' ? '' : String(parseInt(digits, 10))
}

// Strip VTT/SRT metadata lines, keep speech text only
function extractFromVttOrSrt(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^WEBVTT/i.test(line)) continue
    if (/^\d+$/.test(line)) continue                                          // SRT cue number
    if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(line)) continue
    if (/^\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}[.,]\d{3}/.test(line)) continue
    if (/^NOTE\b/i.test(line)) continue
    out.push(line)
  }
  return out.join('\n')
}

// --- Tag input for tech_stack (no external lib) ---
function TechStackInput({ value, onChange }) {
  const [input, setInput] = useState('')

  const addChip = (raw) => {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) return
    if (value.some(v => v.toLowerCase() === trimmed.toLowerCase())) {
      setInput('')
      return
    }
    onChange([...value, trimmed])
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
      onClick={() => {
        const el = document.getElementById('tech-stack-input')
        if (el) el.focus()
      }}
    >
      {value.map((chip, i) => (
        <span
          key={`${chip}-${i}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: T.primaryLight, color: T.primary,
            border: `1px solid ${T.primaryBorder}`, borderRadius: 4,
            padding: '2px 6px', fontSize: 12, fontWeight: 600,
          }}
        >
          {chip}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, j) => j !== i)) }}
            aria-label={`Remove ${chip}`}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.primary, fontSize: 14, padding: 0, lineHeight: 1,
              fontWeight: 700,
            }}
          >×</button>
        </span>
      ))}
      <input
        id="tech-stack-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip(input) }
          else if (e.key === 'Backspace' && !input && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => { if (input.trim()) addChip(input) }}
        placeholder={value.length === 0 ? 'Type a tool name and press Enter (e.g. QuickBooks, Salesforce)' : 'Add another…'}
        style={{
          flex: 1, minWidth: 160, border: 'none', outline: 'none',
          background: 'transparent', fontSize: 13, fontFamily: T.font, color: T.text,
        }}
      />
    </div>
  )
}

export default function BdrSubmit() {
  const { profile } = useAuth()
  const { org } = useOrg()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    company_name: '', website: '', employee_count: '',
    tech_stack: [],
    annual_revenue: '', num_entities: '', accounting_team_size: '',
    industry: '', vertical: '', hq_state: '',
    bant_notes: '',
  })
  const [transcriptMode, setTranscriptMode] = useState('paste')  // 'audio' | 'paste' | 'file'
  const [transcriptText, setTranscriptText] = useState('')
  const [fileName, setFileName] = useState('')
  const [verticals, setVerticals] = useState(FALLBACK_VERTICALS)
  const [submitState, setSubmitState] = useState('idle')         // 'idle' | 'inserting' | 'reviewing' | 'error'
  const [errorMsg, setErrorMsg] = useState(null)
  const [reviewingExpanded, setReviewingExpanded] = useState(false) // swap copy after ~3s on slow connections
  const fileInputRef = useRef(null)

  // Load verticals from active BDR Submission Coach's coach_research_config
  useEffect(() => {
    let cancelled = false
    async function loadVerticals() {
      if (!org?.id) return
      try {
        const { data: coach } = await supabase
          .from('coaches')
          .select('id')
          .eq('org_id', org.id)
          .eq('name', 'BDR Submission Coach')
          .eq('active', true)
          .maybeSingle()
        if (!coach) return
        const { data: cfg } = await supabase
          .from('coach_research_config')
          .select('verticals')
          .eq('coach_id', coach.id)
          .maybeSingle()
        if (cancelled) return
        if (Array.isArray(cfg?.verticals) && cfg.verticals.length > 0) {
          setVerticals(cfg.verticals)
        }
      } catch (e) {
        console.warn('Vertical load failed (using fallback):', e?.message)
      }
    }
    loadVerticals()
    return () => { cancelled = true }
  }, [org?.id])

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  // Validation
  const errors = useMemo(() => {
    const errs = {}
    if (!form.company_name.trim()) errs.company_name = 'Required'
    const normalized = normalizeWebsite(form.website)
    if (!normalized) errs.website = 'Required'
    else if (!isValidUrl(normalized)) errs.website = 'Invalid URL'
    if (!form.employee_count || Number(form.employee_count) < 1) errs.employee_count = 'Must be at least 1'
    if (form.tech_stack.length < 1) errs.tech_stack = 'Add at least one tool'
    if (!form.annual_revenue || Number(form.annual_revenue) < 1) errs.annual_revenue = 'Required'
    if (!form.num_entities || Number(form.num_entities) < 1) errs.num_entities = 'Must be at least 1'
    if (!form.accounting_team_size || Number(form.accounting_team_size) < 1) errs.accounting_team_size = 'Must be at least 1'
    if (!form.industry.trim()) errs.industry = 'Required'
    if (!form.vertical) errs.vertical = 'Required'
    if (!form.hq_state) errs.hq_state = 'Required'
    if (!form.bant_notes.trim() || form.bant_notes.trim().length < MIN_BANT_CHARS) {
      errs.bant_notes = `At least ${MIN_BANT_CHARS} characters required`
    }
    if (!transcriptText.trim() || transcriptText.trim().length < MIN_TRANSCRIPT_CHARS) {
      errs.transcript = `At least ${MIN_TRANSCRIPT_CHARS} characters required`
    }
    return errs
  }, [form, transcriptText])

  // Allow re-submit after an error (submitState='error') once the form is valid again.
  // Block submit only while in-flight (inserting/reviewing).
  const canSubmit = Object.keys(errors).length === 0 &&
    submitState !== 'inserting' && submitState !== 'reviewing'

  // Transcript file handler — Mode C
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const ext = file.name.toLowerCase().split('.').pop()
    try {
      const text = await file.text()
      if (ext === 'vtt' || ext === 'srt') {
        setTranscriptText(extractFromVttOrSrt(text))
      } else if (ext === 'txt') {
        setTranscriptText(text)
      } else if (ext === 'docx') {
        setErrorMsg(
          '.docx parsing is not yet supported. Open the file, copy the transcript text, and use the Paste tab instead.',
        )
        setFileName('')
      } else {
        // Best effort — try as plain text
        setTranscriptText(text)
      }
    } catch (err) {
      setErrorMsg(`Could not read file: ${err.message}`)
      setFileName('')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    if (!profile?.id || !org?.id) {
      setErrorMsg('Profile or org not loaded. Please refresh.')
      return
    }
    setErrorMsg(null)
    setSubmitState('inserting')
    setReviewingExpanded(false)

    try {
      // 1. Insert bdr_leads
      const { data: lead, error: insErr } = await supabase
        .from('bdr_leads')
        .insert({
          org_id: org.id,
          bdr_id: profile.id,
          company_name: form.company_name.trim(),
          website: normalizeWebsite(form.website),
          employee_count: parseInt(form.employee_count, 10),
          tech_stack: form.tech_stack,
          annual_revenue: parseInt(form.annual_revenue, 10),
          num_entities: parseInt(form.num_entities, 10),
          accounting_team_size: parseInt(form.accounting_team_size, 10),
          industry: form.industry.trim(),
          vertical: form.vertical,
          hq_state: form.hq_state,
          transcript: transcriptText.trim(),
          stage: 'ai_reviewing',
          ai_decision: 'pending',
          lead_source: 'bdr',
        })
        .select('id')
        .single()
      if (insErr) throw new Error(`Lead insert failed: ${insErr.message}`)

      // 2. Insert bdr_notes (BANT). Non-fatal — log if it fails but proceed.
      try {
        const { error: noteErr } = await supabase
          .from('bdr_notes')
          .insert({
            lead_id: lead.id,
            org_id: org.id,
            created_by: profile.id,
            note_type: 'bant',
            content: form.bant_notes.trim(),
          })
        if (noteErr) console.warn('bdr_notes insert failed (non-fatal):', noteErr.message)
      } catch (e) {
        console.warn('bdr_notes insert threw (non-fatal):', e)
      }

      // 3. AWAIT pre-qdc-decision so the redirect target shows the real decision
      setSubmitState('reviewing')
      // After 3s, swap "AI is reviewing your submission…" → "AI is reviewing — this usually
      // takes 5–10 seconds." Sets expectation on slow connections without adding visual noise.
      const expandTimer = setTimeout(() => setReviewingExpanded(true), 3000)
      const { data: decision, error: fnErr } = await supabase.functions.invoke(
        'pre-qdc-decision',
        { body: { lead_id: lead.id } },
      )
      clearTimeout(expandTimer)
      if (fnErr) {
        throw new Error(`AI review failed: ${fnErr.message}. The lead was saved (id ${lead.id}) but the decision did not complete — an AE manager can re-run the review.`)
      }
      if (decision?.error) {
        throw new Error(`AI review error: ${decision.error}. Lead saved (id ${lead.id}).`)
      }

      // 4. Redirect — by now bdr_leads.stage is 'denied' or 'routed'
      navigate(`/bdr/leads/${lead.id}`)
    } catch (err) {
      console.error('Submission failed:', err)
      setErrorMsg(err.message || String(err))
      setSubmitState('error')
    }
  }

  const fieldErr = (k) => errors[k]
  const showErr = (k) => submitState === 'error' ? fieldErr(k) : null

  // Header bar — back link + title
  return (
    <div>
      <div style={{
        padding: '14px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12, background: T.surface,
      }}>
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}
        >&larr; Back</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Submit a New Lead</h2>
      </div>

      <div style={{ padding: 24, maxWidth: 820 }}>
        <form onSubmit={handleSubmit}>
          <Card title="Company">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>Company Name *</label>
                <input
                  style={inputStyle}
                  value={form.company_name}
                  onChange={(e) => set('company_name', e.target.value)}
                  placeholder="Acme Corp"
                  required
                  autoFocus
                />
                {showErr('company_name') && <ErrLine msg={showErr('company_name')} />}
              </div>
              <div>
                <label style={labelStyle}>Website *</label>
                <input
                  style={inputStyle}
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                  onBlur={(e) => set('website', normalizeWebsite(e.target.value))}
                  placeholder="acme.com"
                  required
                />
                {showErr('website') && <ErrLine msg={showErr('website')} />}
              </div>
              <div>
                <label style={labelStyle}>Employees *</label>
                <input
                  style={inputStyle} type="number" min="1"
                  value={form.employee_count}
                  onChange={(e) => set('employee_count', e.target.value.replace(/[^\d]/g, ''))}
                  required
                />
                {showErr('employee_count') && <ErrLine msg={showErr('employee_count')} />}
              </div>
              <div>
                <label style={labelStyle}>Annual Revenue *</label>
                <input
                  style={inputStyle} type="text" inputMode="numeric"
                  value={formatCurrencyDisplay(form.annual_revenue)}
                  onChange={(e) => set('annual_revenue', parseCurrencyInput(e.target.value))}
                  placeholder="$50,000,000"
                  required
                />
                {showErr('annual_revenue') && <ErrLine msg={showErr('annual_revenue')} />}
              </div>
              <div>
                <label style={labelStyle}>Number of Entities *</label>
                <input
                  style={inputStyle} type="number" min="1"
                  value={form.num_entities}
                  onChange={(e) => set('num_entities', e.target.value.replace(/[^\d]/g, ''))}
                  required
                />
                {showErr('num_entities') && <ErrLine msg={showErr('num_entities')} />}
              </div>
              <div>
                <label style={labelStyle}>Accounting Team Size *</label>
                <input
                  style={inputStyle} type="number" min="1"
                  value={form.accounting_team_size}
                  onChange={(e) => set('accounting_team_size', e.target.value.replace(/[^\d]/g, ''))}
                  required
                />
                {showErr('accounting_team_size') && <ErrLine msg={showErr('accounting_team_size')} />}
              </div>
              <div>
                <label style={labelStyle}>Industry *</label>
                <input
                  style={inputStyle}
                  value={form.industry}
                  onChange={(e) => set('industry', e.target.value)}
                  placeholder="Third-party logistics"
                  required
                />
                {showErr('industry') && <ErrLine msg={showErr('industry')} />}
              </div>
              <div>
                <label style={labelStyle}>Vertical *</label>
                <select
                  style={inputStyle}
                  value={form.vertical}
                  onChange={(e) => set('vertical', e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {verticals.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                {showErr('vertical') && <ErrLine msg={showErr('vertical')} />}
              </div>
              <div>
                <label style={labelStyle}>HQ State *</label>
                <select
                  style={inputStyle}
                  value={form.hq_state}
                  onChange={(e) => set('hq_state', e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
                </select>
                {showErr('hq_state') && <ErrLine msg={showErr('hq_state')} />}
              </div>
            </div>
          </Card>

          <Card title="Tech Stack / Integrations Needed">
            <label style={labelStyle}>Tools they use today or need to integrate *</label>
            <TechStackInput value={form.tech_stack} onChange={v => set('tech_stack', v)} />
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
              Press Enter or comma to add. Backspace on empty input removes the last chip. Minimum one.
            </div>
            {showErr('tech_stack') && <ErrLine msg={showErr('tech_stack')} />}
          </Card>

          <Card title="BANT Notes">
            <label style={labelStyle}>Budget, Authority, Need, Timeline notes *</label>
            <textarea
              style={{
                ...inputStyle, minHeight: 140, fontFamily: T.font, lineHeight: 1.5, resize: 'vertical',
              }}
              rows={6}
              value={form.bant_notes}
              onChange={(e) => set('bant_notes', e.target.value)}
              placeholder={`Budget: ...\nAuthority: ...\nNeed: ...\nTimeline: ...\n\nCompelling event:`}
              required
            />
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
              {form.bant_notes.trim().length} / {MIN_BANT_CHARS} characters minimum
            </div>
            {showErr('bant_notes') && <ErrLine msg={showErr('bant_notes')} />}
          </Card>

          <Card title="Call Recording / Transcript">
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
                <label style={labelStyle}>Paste transcript text *</label>
                <textarea
                  style={{
                    ...inputStyle, minHeight: 220, fontFamily: T.mono, fontSize: 12,
                    lineHeight: 1.5, resize: 'vertical',
                  }}
                  rows={12}
                  value={transcriptText}
                  onChange={(e) => setTranscriptText(e.target.value)}
                  placeholder="BDR: Thanks for taking the call...&#10;Prospect: Sure...&#10;..."
                />
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                  {transcriptText.trim().length} / {MIN_TRANSCRIPT_CHARS} characters minimum.
                  Use Fathom, Gong, or Chorus to capture transcripts and paste here.
                </div>
                {showErr('transcript') && <ErrLine msg={showErr('transcript')} />}
              </div>
            )}

            {transcriptMode === 'file' && (
              <div style={{ marginTop: 12 }}>
                <label style={labelStyle}>Upload transcript text file *</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.vtt,.srt"
                  onChange={handleFileChange}
                  style={{ display: 'block', fontFamily: T.font, fontSize: 12 }}
                />
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
                  Accepts .txt, .vtt, .srt. For .docx, open the file and paste the content into the Paste tab.
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

          {errorMsg && (
            <div style={{
              background: T.errorLight, border: `1px solid ${T.error}33`,
              borderRadius: 6, padding: '10px 12px', marginBottom: 12,
              fontSize: 12, color: T.error, lineHeight: 1.5,
            }}>
              {errorMsg}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <Button
              type="submit"
              primary
              disabled={!canSubmit}
              style={{ padding: '10px 24px', fontSize: 13 }}
            >
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
      </div>
    </div>
  )
}

function ErrLine({ msg }) {
  return (
    <div style={{ fontSize: 11, color: T.error, marginTop: 4, fontWeight: 600 }}>
      {msg}
    </div>
  )
}

// Coming-soon panel rendered when transcriptMode === 'audio'. Clicking the audio tab
// switches the mode, the panel displays, the form's transcript validation prevents
// submit until the user switches to Paste or Upload. Audio pipeline lands post-pilot.
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

