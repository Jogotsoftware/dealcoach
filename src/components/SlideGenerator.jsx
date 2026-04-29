import { useState } from 'react'
import { theme as T } from '../lib/theme'
import { Button, Spinner } from './Shared'
import { callGenerateSlides } from '../lib/webhooks'

const SLIDE_TYPES = [
  { id: 'team_introductions', label: 'Team Introductions', desc: 'Client team + your team side by side' },
  { id: 'company_overview', label: 'Company Overview', desc: 'Revenue, org structure, goals, KPIs' },
  { id: 'why_we_are_here', label: 'Why We Are Here', desc: 'Key pains and drivers — the hook slide' },
  { id: 'solution_priorities', label: 'Solution Priorities', desc: 'Detailed pain areas with bold headers' },
  { id: 'solution_map', label: 'Solution Map', desc: 'Your product at center with integrations' },
  { id: 'agenda', label: 'Agenda', desc: 'Meeting agenda items' },
]

const SAGE_GREEN = '00D639'
const TEXT_BLACK = '000000'
const TEXT_MUTED = '666666'
const SUBTITLE_GOLD = '997700'
const BG_LIGHT = 'F5F5F5'
const BORDER_LIGHT = 'E0E0E0'

export default function SlideGenerator({ dealId, companyName, orgName = 'Our Company', onClose }) {
  const [selected, setSelected] = useState(['team_introductions', 'company_overview', 'why_we_are_here', 'solution_priorities'])
  const [generating, setGenerating] = useState(false)
  const [slides, setSlides] = useState(null)
  const [error, setError] = useState(null)

  function toggleSlide(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  async function generate() {
    if (!selected.length) return
    setGenerating(true)
    setError(null)
    try {
      const res = await callGenerateSlides(dealId, selected)
      if (res.error) { setError(res.error); return }
      setSlides(res.slides)
    } catch (err) { setError(err.message) }
    finally { setGenerating(false) }
  }

  async function downloadPptx() {
    if (!slides?.length) return
    const pptxgen = (await import('pptxgenjs')).default
    const pres = new pptxgen()
    pres.layout = 'LAYOUT_WIDE'
    pres.author = orgName || 'Revenue Instruments'
    pres.title = `${companyName} + ${orgName}`

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i]
      const s = pres.addSlide()

      // Common footer on every slide
      s.addText(orgName, { x: 0.3, y: 6.8, w: 2, h: 0.5, fontSize: 22, fontFace: 'Arial', bold: true, color: SAGE_GREEN })
      s.addText(`\u00A9 ${new Date().getFullYear()} ${orgName}. All rights reserved.`, { x: 3.5, y: 7.0, w: 6, h: 0.35, fontSize: 9, fontFace: 'Calibri', color: TEXT_MUTED, align: 'center' })
      s.addText(`Page ${i + 1}`, { x: 12.0, y: 7.0, w: 1, h: 0.35, fontSize: 9, fontFace: 'Calibri', color: TEXT_MUTED, align: 'right' })

      switch (slide.slide_type) {
        case 'team_introductions': renderTeamSlide(s, slide); break
        case 'company_overview': renderOverviewSlide(s, slide); break
        case 'why_we_are_here': renderWhySlide(s, slide); break
        case 'solution_priorities': renderPrioritiesSlide(s, slide); break
        case 'solution_map': renderMapSlide(s, slide); break
        case 'agenda': renderAgendaSlide(s, slide); break
      }
      if (slide.speaker_notes) s.addNotes(slide.speaker_notes)
    }

    await pres.writeFile({ fileName: `${companyName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}_${orgName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}.pptx` })
  }

  function renderTeamSlide(s, slide) {
    s.addText(slide.title || 'Team Introductions', { x: 0.45, y: 0.33, w: 6, h: 0.77, fontSize: 32, fontFace: 'Calibri', bold: true, color: TEXT_BLACK })
    const content = slide.content || {}
    // Client box (gray bg)
    s.addShape('roundRect', { x: 0.2, y: 1.28, w: 8, h: 5.56, rectRadius: 0.1, fill: { color: BG_LIGHT }, line: { color: BORDER_LIGHT, width: 1 } })
    const ct = (content.client_team || []).flatMap((c, i, arr) => [
      { text: c.name, options: { bold: true, fontSize: 16, fontFace: 'Calibri', color: TEXT_BLACK, breakLine: true } },
      { text: c.title, options: { italic: true, fontSize: 16, fontFace: 'Calibri', color: SUBTITLE_GOLD, breakLine: i < arr.length - 1, paraSpaceAfter: i < arr.length - 1 ? 10 : 0 } },
    ])
    if (ct.length) s.addText(ct, { x: 0.5, y: 1.6, w: 7, h: 4.5 })
    // Our team box (white, green border)
    s.addShape('roundRect', { x: 8.52, y: 1.28, w: 4.62, h: 5.56, rectRadius: 0.1, fill: { color: 'FFFFFF' }, line: { color: SAGE_GREEN, width: 2 } })
    s.addText(orgName, { x: 8.84, y: 1.5, w: 3, h: 0.6, fontSize: 22, fontFace: 'Arial', bold: true, color: SAGE_GREEN })
    const st = (content.sage_team || []).flatMap((c, i, arr) => [
      { text: c.name, options: { bold: true, fontSize: 16, fontFace: 'Calibri', color: TEXT_BLACK, breakLine: true } },
      { text: c.title, options: { italic: true, fontSize: 14, fontFace: 'Calibri', color: SAGE_GREEN, breakLine: i < arr.length - 1, paraSpaceAfter: i < arr.length - 1 ? 10 : 0 } },
    ])
    if (st.length) s.addText(st, { x: 8.8, y: 2.2, w: 4, h: 4 })
  }

  function renderOverviewSlide(s, slide) {
    s.addText(slide.title || 'Company Overview', { x: 0.45, y: 0.33, w: 7, h: 0.65, fontSize: 32, fontFace: 'Calibri', bold: true, color: TEXT_BLACK })
    let y = 1.2
    for (const sec of (slide.content?.sections || [])) {
      s.addText(sec.heading, { x: 1.0, y, w: 11, h: 0.4, fontSize: 18, fontFace: 'Arial', bold: true, underline: true, color: TEXT_BLACK })
      y += 0.4
      const bullets = (sec.bullets || []).map(b => ({ text: b, options: { bullet: true, fontSize: 15, fontFace: 'Arial', color: TEXT_BLACK, breakLine: true } }))
      if (bullets.length) { const h = Math.max(0.4, bullets.length * 0.32); s.addText(bullets, { x: 1.0, y, w: 11, h }); y += h + 0.15 }
    }
  }

  function renderWhySlide(s, slide) {
    s.addText(slide.title || 'Why We Are Here', { x: 0.45, y: 0.33, w: 6, h: 0.65, fontSize: 32, fontFace: 'Calibri', bold: true, color: TEXT_BLACK })
    const content = slide.content || {}
    let y = 1.2
    if (content.lead_in) { s.addText(content.lead_in, { x: 0.35, y, w: 12.6, h: 0.5, fontSize: 16, fontFace: 'Arial', italic: true, color: TEXT_BLACK }); y += 0.6 }
    const bullets = (content.bullets || []).map(b => ({ text: b, options: { bullet: true, fontSize: 16, fontFace: 'Arial', color: TEXT_BLACK, breakLine: true, paraSpaceAfter: 10 } }))
    if (bullets.length) s.addText(bullets, { x: 0.35, y, w: 12.6, h: 5.5 - y })
  }

  function renderPrioritiesSlide(s, slide) {
    s.addText(slide.title || 'Solution Priorities', { x: 0.27, y: 0.12, w: 6, h: 0.65, fontSize: 32, fontFace: 'Calibri', bold: true, color: TEXT_BLACK })
    const bullets = (slide.content?.priorities || []).map(p => ({
      text: [
        { text: p.category + ' ', options: { bold: true, fontSize: 16, fontFace: 'Arial', color: TEXT_BLACK } },
        { text: p.description, options: { bold: false, fontSize: 16, fontFace: 'Arial', color: TEXT_BLACK } },
      ],
      options: { bullet: true, breakLine: true, paraSpaceAfter: 10 }
    }))
    if (bullets.length) s.addText(bullets, { x: 0.34, y: 0.91, w: 12.64, h: 5.8 })
  }

  function renderMapSlide(s, slide) {
    s.background = { color: BG_LIGHT }
    s.addText(slide.title || 'Solution Map', { x: 0.58, y: 0.37, w: 5, h: 0.65, fontSize: 32, fontFace: 'Calibri', bold: true, color: TEXT_BLACK })
    // Center oval with org name
    s.addShape('ellipse', { x: 5.0, y: 2.5, w: 3.5, h: 2.3, fill: { color: 'FFFFFF' }, line: { color: SAGE_GREEN, width: 2, dashType: 'dash' } })
    s.addText(orgName, { x: 5.0, y: 3.0, w: 3.5, h: 1.2, fontSize: 28, fontFace: 'Arial', bold: true, color: SAGE_GREEN, align: 'center', valign: 'middle' })
    // Integration nodes around the oval
    const positions = [{ x: 0.5, y: 2.5, w: 3 }, { x: 10.0, y: 1.8, w: 3 }, { x: 10.0, y: 3.8, w: 3 }, { x: 0.5, y: 4.5, w: 3 }, { x: 4.5, y: 5.5, w: 4 }, { x: 0.5, y: 0.8, w: 3 }]
    ;(slide.content?.integrations || []).slice(0, 6).forEach((intg, i) => {
      const pos = positions[i]
      s.addText([
        { text: intg.system, options: { bold: true, fontSize: 14, fontFace: 'Arial', color: TEXT_BLACK, breakLine: true } },
        { text: intg.purpose || '', options: { fontSize: 11, fontFace: 'Arial', color: TEXT_MUTED } },
      ], { x: pos.x, y: pos.y, w: pos.w, h: 0.8 })
    })
  }

  function renderAgendaSlide(s, slide) {
    s.addText(slide.title || 'Agenda', { x: 0.45, y: 0.33, w: 5.2, h: 0.65, fontSize: 32, fontFace: 'Calibri', bold: true, color: TEXT_BLACK })
    const items = (slide.content?.items || []).map(item => ({ text: item, options: { bullet: true, fontSize: 24, fontFace: 'Arial', bold: true, color: TEXT_BLACK, breakLine: true, paraSpaceAfter: 14 } }))
    if (items.length) s.addText(items, { x: 1.25, y: 1.5, w: 8.5, h: 5 })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{ position: 'relative', zIndex: 2001, background: T.surface, border: '1px solid ' + T.border, borderRadius: 12, width: 640, maxHeight: '85vh', overflow: 'auto', padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Generate Slides</h2>
          <span style={{ cursor: 'pointer', fontSize: 20, color: T.textMuted, lineHeight: 1 }} onClick={onClose}>&times;</span>
        </div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>
          Opus 4.6 will use all deal data and transcripts to create customer-facing slides for <strong>{companyName}</strong>.
        </div>

        {!slides ? (
          <>
            {SLIDE_TYPES.map(st => (
              <label key={st.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
                background: selected.includes(st.id) ? 'rgba(0,214,57,0.06)' : 'transparent',
                border: '1px solid ' + (selected.includes(st.id) ? 'rgba(0,214,57,0.3)' : 'transparent'),
              }}>
                <input type="checkbox" checked={selected.includes(st.id)} onChange={() => toggleSlide(st.id)} style={{ marginTop: 3, accentColor: '#00D639' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{st.label}</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>{st.desc}</div>
                </div>
              </label>
            ))}
            {error && <div style={{ color: '#e74c3c', fontSize: 12, marginTop: 8, padding: 8, background: 'rgba(231,76,60,0.08)', borderRadius: 6 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <Button onClick={onClose}>Cancel</Button>
              <Button primary onClick={generate} disabled={generating || !selected.length}>
                {generating ? 'Generating...' : `Generate ${selected.length} Slide${selected.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
            {generating && (
              <div style={{ textAlign: 'center', padding: 24, marginTop: 8 }}>
                <Spinner />
                <div style={{ fontSize: 13, color: T.textMuted, marginTop: 10 }}>Opus 4.6 is writing your slides...</div>
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Analyzing all deal data and transcripts. This takes 30-60 seconds.</div>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#00D639', fontWeight: 700, marginBottom: 12 }}>{slides.length} slide{slides.length !== 1 ? 's' : ''} generated</div>
            {slides.map((slide, i) => (
              <div key={i} style={{ marginBottom: 10, padding: 14, background: T.surfaceAlt, borderRadius: 8, border: '1px solid ' + T.border }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{slide.title}</div>
                  <span style={{ fontSize: 10, color: T.textMuted, background: T.surface, padding: '2px 8px', borderRadius: 4, border: '1px solid ' + T.border }}>{slide.slide_type.replace(/_/g, ' ')}</span>
                </div>
                {slide.content?.lead_in && <div style={{ fontSize: 12, fontStyle: 'italic', color: T.text, marginBottom: 6 }}>{slide.content.lead_in}</div>}
                {slide.content?.bullets && (
                  <div style={{ marginTop: 4 }}>
                    {slide.content.bullets.slice(0, 3).map((b, j) => <div key={j} style={{ fontSize: 11, color: T.text, padding: '2px 0', paddingLeft: 10, borderLeft: '2px solid ' + T.border }}>{typeof b === 'string' ? b.substring(0, 120) : b}{typeof b === 'string' && b.length > 120 ? '...' : ''}</div>)}
                    {slide.content.bullets.length > 3 && <div style={{ fontSize: 10, color: T.textMuted, paddingLeft: 10 }}>+{slide.content.bullets.length - 3} more</div>}
                  </div>
                )}
                {slide.content?.priorities && (
                  <div style={{ marginTop: 4 }}>
                    {slide.content.priorities.slice(0, 3).map((p, j) => <div key={j} style={{ fontSize: 11, padding: '3px 0' }}><strong>{p.category}</strong> {'\u2014'} {p.description?.substring(0, 100)}{p.description?.length > 100 ? '...' : ''}</div>)}
                    {slide.content.priorities.length > 3 && <div style={{ fontSize: 10, color: T.textMuted }}>+{slide.content.priorities.length - 3} more</div>}
                  </div>
                )}
                {slide.content?.client_team && (
                  <div style={{ display: 'flex', gap: 20, marginTop: 4, fontSize: 11 }}>
                    <div><div style={{ fontWeight: 700, marginBottom: 2 }}>Client ({slide.content.client_team.length})</div>{slide.content.client_team.slice(0, 3).map((c, j) => <div key={j}>{c.name} {'\u2014'} {c.title}</div>)}</div>
                    <div><div style={{ fontWeight: 700, marginBottom: 2 }}>Our Team ({(slide.content.sage_team || []).length})</div>{(slide.content.sage_team || []).slice(0, 3).map((c, j) => <div key={j}>{c.name} {'\u2014'} {c.title}</div>)}</div>
                  </div>
                )}
                {slide.content?.sections && (
                  <div style={{ marginTop: 4 }}>{slide.content.sections.map((sec, j) => <div key={j} style={{ fontSize: 11, padding: '2px 0' }}><strong>{sec.heading}</strong>: {sec.bullets?.slice(0, 2).join(', ')}{sec.bullets?.length > 2 ? '...' : ''}</div>)}</div>
                )}
                {slide.speaker_notes && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6, fontStyle: 'italic', borderTop: '1px solid ' + T.borderLight, paddingTop: 4 }}>Speaker notes: {slide.speaker_notes.substring(0, 120)}...</div>}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <Button onClick={() => { setSlides(null); setError(null) }}>Regenerate</Button>
              <Button primary onClick={downloadPptx}>Download .pptx</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
