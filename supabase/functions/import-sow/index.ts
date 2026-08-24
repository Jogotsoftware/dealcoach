// import-sow v1
//
// Takes an AE-uploaded Statement of Work PDF, sends it to Claude with a
// structured extraction prompt, and writes the result to sow_documents. When
// `apply` is set (the default) it also rebuilds the deal's implementation
// schedule from the extracted timeline.
//
// Input:  { sow_document_id: string, apply?: boolean }
// Output: { ok: true, extraction, items_written, warnings[] }
//
// The timeline is the point of this function. Both reference SOWs state their
// schedule as a phase table over numbered weeks (W1..W20) plus Go-Live and
// Project Complete markers, so weeks are what we extract; the calendar is
// resolved app-side against the MSP kickoff. Pricing fields are extracted too
// because sow_documents already carries them, but the customer-facing payload
// in dealroom-access deliberately serves only the two durations.
//
// Project conventions:
// - verify_jwt false, so this function does its own caller check: it resolves
//   the bearer token to a user and requires that user's profile.org_id to match
//   the SOW's org before doing anything. Worth stating plainly because the
//   sibling import-order-schedule claims this in its header comment but does
//   not actually implement it, and this endpoint both spends money on a Claude
//   call and rewrites a deal's schedule.
// - Version stamps in every error: "import-sow v1: <reason>".

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const CLAUDE_MODEL = 'claude-opus-5'

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}
function resp(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(), 'Content-Type': 'application/json' } })
}

const EXTRACTION_PROMPT = `You are reading a Statement of Work (SOW) for a software implementation.

Extract the following as a single JSON object.

HEADER
- vendor_name: the firm delivering the services (the "PS"/partner/vendor), not the client.
- client_name: the customer the work is for.
- item_code: the service SKU or item code if one appears in the pricing table (e.g. "PS-IFM-FB", "PS-IFM-TANDE"). Null if absent.
- billing_type: "fixed_fee" if the SOW is a fixed-fee/fixed-bid engagement, "time_and_materials" if billed on actual time, else null.
- estimated_total: the final total cost the client pays, as a number. If the pricing table shows a gross figure and a discount, use the NET total after discounts.
- estimated_hours: total estimated hours if stated, else null.
- rate_per_hour: the hourly rate if the engagement is time & materials, else null.
- estimate_valid_through: the date the estimate expires, as YYYY-MM-DD. Null if absent.
- scope_summary: two or three sentences describing what is being implemented. Plain prose, no markdown.

TIMELINE — this is the most important part.
SOWs state the schedule as a table of project phases across numbered weeks, usually
grouped under "Month 1..Month N" headers, with bars spanning week ranges, plus
milestone markers such as Go-Live and Project Complete.

- duration_to_live_weeks: the stated "Estimated Duration to Live" in weeks.
- duration_to_complete_weeks: the stated "Estimated Duration to Complete" in weeks.
- phases: an array, in order, of the rows of that timeline table. For each:
    - phase_name: the row label in the leftmost column (e.g. "Define", "Configure",
      "System Readiness", "Success Assurance").
    - label: the text written inside the bar (e.g. "Design", "Configure Core
      Functionality", "Historical Data & UAT"). If the bar has no text of its own,
      repeat the phase_name.
    - start_week: the FIRST week column the bar covers, counting the whole table
      from 1. Week 1 is the first week of Month 1, week 5 is the first week of
      Month 2, and so on.
    - end_week: the LAST week column the bar covers, same numbering. If the bar
      covers a single week, end_week equals start_week.
- milestones: an array of the point-in-time markers under the table. For each:
    - label: e.g. "Go-Live", "Live", "Project Complete".
    - week: the week column the marker sits at, using the same numbering.
    - date: the calendar date printed next to the marker as YYYY-MM-DD, or null
      if the SOW shows no date.

Counting rules:
- Week numbers are absolute across the whole table, never restarted per month.
- If a month band shows 4 week columns, it consumes 4 week numbers even when some
  are blank.
- If the table has explicit week numbers printed in a header row (W1, W2, ...),
  use those numbers directly.

If a value cannot be determined with confidence, use null. Never invent a number.
Return ONLY the JSON object. No explanation, no markdown fences.`

async function callClaude(pdfBase64: string): Promise<any> {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`import-sow v1: Claude API ${r.status}: ${(await r.text()).slice(0, 500)}`)
  const data = await r.json()
  if (data?.stop_reason === 'refusal') throw new Error(`import-sow v1: claude refused (${data?.stop_details?.category ?? 'unknown'})`)
  // Thinking is on by default on Opus 5, so take the last text block.
  const blocks = Array.isArray(data?.content) ? data.content : []
  const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    return JSON.parse(stripped)
  } catch {
    throw new Error(`import-sow v1: could not parse extraction JSON: ${stripped.slice(0, 300)}`)
  }
}

const num = (v: any) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const posInt = (v: any) => {
  const n = num(v)
  return n === null ? null : Math.max(1, Math.round(n))
}
const isoDate = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null)

// Palette for phase rows, in table order. Deliberately not read from the app's
// theme: this function has no access to it, and the app can recolor any row.
const PHASE_COLORS = ['#5DADE2', '#3d7ea6', '#0b3d5c', '#6bb644', '#B07908', '#8e6bb6']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  let sowId: string | null = null

  try {
    const { sow_document_id, apply = true } = await req.json()
    sowId = sow_document_id
    if (!sowId) return resp({ error: 'import-sow v1: sow_document_id required' }, 400)

    const { data: sow, error: sErr } = await sb.from('sow_documents')
      .select('id, org_id, deal_id, storage_path, filename').eq('id', sowId).single()
    if (sErr || !sow) return resp({ error: `import-sow v1: sow not found: ${sErr?.message}` }, 404)
    if (!sow.storage_path) return resp({ error: 'import-sow v1: sow has no stored file' }, 400)

    // Caller check. A service-role bearer is trusted (server-to-server); any
    // other token must resolve to a user in this SOW's org.
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!bearer) return resp({ error: 'import-sow v1: authorization required' }, 401)
    if (bearer !== SUPABASE_SERVICE_ROLE_KEY) {
      const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      })
      const { data: userRes, error: uErr } = await asUser.auth.getUser()
      const uid = userRes?.user?.id
      if (uErr || !uid) return resp({ error: 'import-sow v1: not signed in' }, 401)
      const { data: profile } = await sb.from('profiles').select('org_id').eq('id', uid).maybeSingle()
      if (!profile?.org_id || profile.org_id !== sow.org_id) {
        return resp({ error: 'import-sow v1: this SOW belongs to another organization' }, 403)
      }
    }

    await sb.from('sow_documents').update({ status: 'parsing', status_message: null }).eq('id', sowId)

    const { data: file, error: fErr } = await sb.storage.from('deal-documents').download(sow.storage_path)
    if (fErr || !file) throw new Error(`import-sow v1: pdf download failed: ${fErr?.message}`)

    const buf = new Uint8Array(await file.arrayBuffer())
    // Base64 in 32 KB chunks — String.fromCharCode has an argument limit.
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
    const pdfBase64 = btoa(bin)

    const ex = await callClaude(pdfBase64)
    const warnings: string[] = []

    const phases = (Array.isArray(ex.phases) ? ex.phases : [])
      .map((p: any, i: number) => ({
        phase_name: typeof p?.phase_name === 'string' ? p.phase_name.trim() : null,
        label: typeof p?.label === 'string' && p.label.trim() ? p.label.trim() : (p?.phase_name || 'Phase'),
        start_week: posInt(p?.start_week),
        end_week: posInt(p?.end_week) ?? posInt(p?.start_week),
        color: PHASE_COLORS[i % PHASE_COLORS.length],
      }))
      .filter((p: any) => {
        if (p.start_week === null) { warnings.push(`Dropped phase "${p.label}": no week number`); return false }
        return true
      })
      .map((p: any) => (p.end_week < p.start_week ? { ...p, end_week: p.start_week } : p))

    const milestones = (Array.isArray(ex.milestones) ? ex.milestones : [])
      .map((m: any) => ({
        label: typeof m?.label === 'string' && m.label.trim() ? m.label.trim() : 'Milestone',
        week: posInt(m?.week),
        date: isoDate(m?.date),
      }))
      .filter((m: any) => {
        if (m.week === null) { warnings.push(`Dropped milestone "${m.label}": no week number`); return false }
        return true
      })

    // Reconcile what was read off the timeline picture against what the SOW
    // states in words. Bar positions are inferred from an image of a Gantt and
    // are the least reliable signal here; "12 Weeks to Live" and the dates
    // printed under the milestones are written down. Where they disagree, the
    // written figure wins and the disagreement is reported rather than hidden.
    const liveWeeks = posInt(ex.duration_to_live_weeks)
    const completeWeeks = posInt(ex.duration_to_complete_weeks)

    for (const m of milestones) {
      const isLive = /go[\s-]*live|^live$/i.test(m.label)
      const isDone = /complete|completion/i.test(m.label)
      if (isLive && liveWeeks && m.week !== liveWeeks) {
        warnings.push(`Go-live read at week ${m.week} but the SOW states ${liveWeeks} weeks to live; used ${liveWeeks}.`)
        m.week = liveWeeks
      }
      if (isDone && completeWeeks && m.week !== completeWeeks) {
        warnings.push(`Project completion read at week ${m.week} but the SOW states ${completeWeeks} weeks to complete; used ${completeWeeks}.`)
        m.week = completeWeeks
      }
    }

    // The printed dates are an independent check on the spacing.
    const dated = milestones.filter((m: any) => m.date).sort((a: any, b: any) => a.week - b.week)
    if (dated.length >= 2) {
      const a = dated[0], b = dated[dated.length - 1]
      const byDate = Math.round((Date.parse(b.date) - Date.parse(a.date)) / (7 * 86400000))
      const byWeek = b.week - a.week
      if (Math.abs(byDate - byWeek) > 1) {
        warnings.push(`${a.label} and ${b.label} are ${byDate} weeks apart by their printed dates but ${byWeek} by their positions on the chart.`)
      }
    }

    // A gap between consecutive phases claims nobody works that week. In a
    // timeline read from an image that is far more likely to be a misread
    // edge than a genuine pause, so close it and say so.
    phases.sort((a: any, b: any) => a.start_week - b.start_week)
    for (let i = 1; i < phases.length; i++) {
      const gap = phases[i].start_week - phases[i - 1].end_week - 1
      if (gap > 0) {
        const from = phases[i - 1].end_week + 1
        const to = phases[i].start_week - 1
        warnings.push(`No work was scheduled in week${gap > 1 ? 's' : ''} ${from}${gap > 1 ? `-${to}` : ''}, between ${phases[i - 1].label} and ${phases[i].label}; closed the gap.`)
        phases[i].start_week = from
        if (phases[i].end_week < phases[i].start_week) phases[i].end_week = phases[i].start_week
      }
    }

    const lastPhaseEnd = phases.length ? Math.max(...phases.map((p: any) => p.end_week)) : 0
    if (completeWeeks && lastPhaseEnd && lastPhaseEnd > completeWeeks) {
      warnings.push(`Work runs to week ${lastPhaseEnd} but the SOW states ${completeWeeks} weeks to complete.`)
    }

    if (!phases.length) warnings.push('No timeline phases were found in this SOW')

    const header = {
      vendor_name: typeof ex.vendor_name === 'string' ? ex.vendor_name.trim() : null,
      client_name: typeof ex.client_name === 'string' ? ex.client_name.trim() : null,
      item_code: typeof ex.item_code === 'string' ? ex.item_code.trim() : null,
      billing_type: typeof ex.billing_type === 'string' ? ex.billing_type.trim() : null,
      estimated_total: num(ex.estimated_total),
      estimated_hours: num(ex.estimated_hours),
      rate_per_hour: num(ex.rate_per_hour),
      estimate_valid_through: isoDate(ex.estimate_valid_through),
      duration_to_live_weeks: posInt(ex.duration_to_live_weeks),
      duration_to_complete_weeks: posInt(ex.duration_to_complete_weeks),
      scope_summary: typeof ex.scope_summary === 'string' ? ex.scope_summary.trim() : null,
    }

    let itemsWritten = 0
    if (apply && (phases.length || milestones.length)) {
      // Replace only what a previous run of this SOW produced. Rows the AE
      // added by hand, or rows from a different SOW, are left alone.
      const { error: delErr } = await sb.from('implementation_items')
        .delete().eq('deal_id', sow.deal_id).eq('sow_document_id', sowId)
      if (delErr) throw new Error(`import-sow v1: could not clear previous rows: ${delErr.message}`)

      const rows = [
        ...phases.map((p: any, i: number) => ({
          org_id: sow.org_id, deal_id: sow.deal_id, sow_document_id: sowId,
          kind: 'bar', phase_name: p.phase_name, label: p.label,
          start_week: p.start_week, end_week: p.end_week,
          color: p.color, date_source: 'sow', sort_order: i,
        })),
        ...milestones.map((m: any, i: number) => ({
          org_id: sow.org_id, deal_id: sow.deal_id, sow_document_id: sowId,
          kind: 'milestone', phase_name: null, label: m.label,
          start_week: m.week, end_week: null,
          // Never pin a milestone to the date printed in the SOW. That date
          // assumes nothing disrupts the plan, so a pinned gate stays put while
          // the work around it shifts for holidays and client downtime -- go-live
          // ends up sitting in the middle of post-go-live support. The week is
          // what the schedule is built from, so the gate rides it.
          start_date: null, date_source: 'sow',
          sort_order: 100 + i,
        })),
      ]
      const { error: insErr } = await sb.from('implementation_items').insert(rows)
      if (insErr) throw new Error(`import-sow v1: could not write schedule: ${insErr.message}`)
      itemsWritten = rows.length
    }

    await sb.from('sow_documents').update({
      ...header,
      extraction_raw: { ...ex, phases, milestones, warnings, model: CLAUDE_MODEL },
      parsed_at: new Date().toISOString(),
      applied_at: itemsWritten ? new Date().toISOString() : null,
      status: itemsWritten ? 'applied' : 'parsed',
      status_message: warnings.length ? warnings.join('; ') : null,
    }).eq('id', sowId)

    return resp({ ok: true, extraction: { ...header, phases, milestones }, items_written: itemsWritten, warnings })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (sowId) {
      await sb.from('sow_documents').update({ status: 'error', status_message: message.slice(0, 500) }).eq('id', sowId)
    }
    return resp({ error: message }, 500)
  }
})
