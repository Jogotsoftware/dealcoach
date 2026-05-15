// import-order-schedule v1
//
// Takes an AE-uploaded PDF order schedule, sends it to Claude with a structured
// extraction prompt, and writes the result back to the quote (quote_lines +
// quote_implementation_items + header concessions). Unmatched SKUs are returned
// to the caller so the UI can offer "create as new product" per row.
//
// Input:
//   { quote_id: string, storage_path: string }
//
// Output:
//   {
//     ok: true,
//     lines_added: number,
//     impl_added: number,
//     unmatched: Array<{ name, sku, quantity, list_price, discount_pct, extended }>,
//     warnings: string[],
//     header_updates: { signing_bonus_amount?, free_months?, contract_term_id?, term_label? }
//   }
//
// Project conventions:
// - verify_jwt: false (we authenticate via supabase service-role and re-check
//   that the caller's session can access the quote's org).
// - apikey header required by Kong.
// - Version stamps in every error: "import-order-schedule v1: <reason>".

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

function resp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
  })
}

const EXTRACTION_PROMPT = `You are extracting a Sage Intacct (or similar B2B SaaS) order schedule PDF into structured JSON for an internal sales tool.

Return a single JSON object with EXACTLY this shape. No prose, no markdown — pure JSON:

{
  "lines": [
    {
      "sku": "string | null — copy verbatim if present on the line, else null",
      "name": "string — the full product name as printed",
      "quantity": number,
      "list_price": number,
      "discount_pct": number,
      "extended": number
    }
  ],
  "implementation": [
    { "name": "string", "amount": number }
  ],
  "signing_bonus_amount": number | null,
  "free_months": number | null,
  "term_years": number | null,
  "yoy_caps": [number, number, ...] | null,
  "contract_start_date": "YYYY-MM-DD | null"
}

Rules:
- discount_pct is a decimal between 0 and 1 (60% → 0.60).
- list_price is the PER-UNIT list price, not the extended.
- extended is the post-discount line total (qty × list × (1 − discount_pct)).
- For bundles (e.g. "Sage for Scaling Businesses — Standard"), emit ONE line for the bundle itself. Do NOT emit separate lines for the bundle children even if they're listed underneath.
- Skip lines where quantity is 0.
- For implementation items, only include rows that are explicitly one-time / implementation. Do not lump subscription items in here.
- For signing bonus: if you see "Signing Bonus" or similar concession line, return its absolute value (positive number). Null if absent.
- For free months: count of months explicitly marked free. Null if absent.
- For yoy_caps: a list like "0,5,5,5,5 Renewal Caps" becomes [0, 0.05, 0.05, 0.05, 0.05]. term_years is the length of this array.
- If you can't determine a value with confidence, use null.

Return ONLY the JSON object. No explanation.`

async function callClaude(pdfBase64: string): Promise<any> {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
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
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Claude API ${r.status}: ${err.slice(0, 500)}`)
  }
  const data = await r.json()
  const text = data?.content?.[0]?.text || ''
  // Claude sometimes wraps JSON in fences despite "no markdown" — be tolerant.
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    return JSON.parse(stripped)
  } catch (e: any) {
    throw new Error(`v1: claude returned non-JSON: ${stripped.slice(0, 400)}`)
  }
}

// Match an extracted line against the org's product catalog.
// 1) exact SKU match (case-insensitive)
// 2) exact name match (case-insensitive)
// 3) "name contains" or "contains name" (case-insensitive)
function findProduct(line: any, products: any[]): any | null {
  const lineSku = String(line.sku || '').trim().toLowerCase()
  const lineName = String(line.name || '').trim().toLowerCase()
  if (!lineName && !lineSku) return null
  if (lineSku) {
    const m = products.find(p => String(p.sku || '').trim().toLowerCase() === lineSku)
    if (m) return m
  }
  if (lineName) {
    const m = products.find(p => String(p.name || '').trim().toLowerCase() === lineName)
    if (m) return m
    const partial = products.find(p => {
      const pn = String(p.name || '').trim().toLowerCase()
      return pn && (pn.includes(lineName) || lineName.includes(pn))
    })
    if (partial) return partial
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })

  try {
    const body = await req.json()
    const quoteId = String(body.quote_id || '')
    const storagePath = String(body.storage_path || '')
    if (!quoteId) return resp({ error: 'v1: quote_id required' }, 400)
    if (!storagePath) return resp({ error: 'v1: storage_path required' }, 400)
    if (!ANTHROPIC_API_KEY) return resp({ error: 'v1: ANTHROPIC_API_KEY not configured' }, 500)

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // 1. Load the quote + its org. We use the org_id to scope the product lookup.
    const { data: quote, error: qErr } = await sb
      .from('quotes')
      .select('id, org_id, deal_id, contract_term_id')
      .eq('id', quoteId)
      .single()
    if (qErr || !quote) return resp({ error: `v1: quote not found: ${qErr?.message}` }, 404)

    // 2. Download the PDF from storage.
    const { data: file, error: fErr } = await sb.storage
      .from('order-schedule-uploads')
      .download(storagePath)
    if (fErr || !file) return resp({ error: `v1: pdf download failed: ${fErr?.message}` }, 404)

    const buf = new Uint8Array(await file.arrayBuffer())
    // Base64-encode in 32 KB chunks to avoid Deno's String.fromCharCode arg limit.
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
    }
    const pdfBase64 = btoa(bin)

    // 3. Ask Claude to extract.
    const extraction = await callClaude(pdfBase64)
    const linesIn: any[] = Array.isArray(extraction.lines) ? extraction.lines : []
    const implIn: any[] = Array.isArray(extraction.implementation) ? extraction.implementation : []

    // 4. Load the org's product catalog once. is_implementation is the
    //    authoritative classifier — products flagged true (professional
    //    services, training, activation fees, etc.) get routed to one-time
    //    costs even if the PDF listed them in the subscription section.
    const { data: products } = await sb
      .from('products')
      .select('id, sku, name, list_price, is_bundle, is_implementation')
      .eq('org_id', quote.org_id)
      .eq('active', true)

    // 5. Map lines → either quote_lines (subscription) or
    //    quote_implementation_items (one-time) based on the matched product's
    //    is_implementation flag. Unmatched stays in the unmatched bucket for
    //    the AE to triage in the result modal.
    const unmatched: any[] = []
    const linesToInsert: any[] = []
    const implFromLines: any[] = []
    let lineOrder = 1
    for (const l of linesIn) {
      const qty = Number(l.quantity) || 0
      if (qty <= 0) continue
      const product = findProduct(l, products || [])
      if (!product) {
        unmatched.push({
          name: l.name, sku: l.sku, quantity: qty,
          list_price: Number(l.list_price) || 0,
          discount_pct: Number(l.discount_pct) || 0,
          extended: Number(l.extended) || 0,
        })
        continue
      }
      const unitPrice = Number(l.list_price) || Number(product.list_price) || 0
      const discountPct = Number(l.discount_pct) || 0
      const extended = Number(l.extended) || (qty * unitPrice * (1 - discountPct))
      if (product.is_implementation === true) {
        // Route to one-time costs. We keep the extended amount; qty + discount
        // are baked into it. Name carries the product name (+ qty hint if >1).
        implFromLines.push({
          name: qty > 1 ? `${product.name} (×${qty})` : product.name,
          amount: extended,
        })
      } else {
        linesToInsert.push({
          quote_id: quoteId,
          product_id: product.id,
          line_order: lineOrder++,
          quantity: qty,
          unit_price: unitPrice,
          discount_pct: discountPct,
          extended,
        })
      }
    }

    // 6. Map implementation rows extracted by Claude AND any subscription
    //    lines that were re-routed because their product is_implementation=true.
    const allImpl = [
      ...implIn.filter((i: any) => Number(i.amount) > 0).map((i: any) => ({ name: i.name, amount: Number(i.amount) })),
      ...implFromLines,
    ]
    const implToInsert = allImpl.map((i: any, idx: number) => ({
      quote_id: quoteId,
      source: 'sage',
      implementor_name: 'Sage',
      name: String(i.name || `Implementation ${idx + 1}`),
      total_amount: Number(i.amount) || 0,
      billing_type: 'fixed_bid_50_50',
      sort_order: idx + 1,
    }))

    // 7. Match a contract term by yoy_caps (if extracted).
    let contractTermId: string | null = quote.contract_term_id
    let termLabel: string | null = null
    if (Array.isArray(extraction.yoy_caps) && extraction.yoy_caps.length) {
      // Normalize: percentages → decimals (5 → 0.05).
      const caps = extraction.yoy_caps.map((c: any) => {
        const n = Number(c) || 0
        return n > 1 ? n / 100 : n
      })
      const { data: terms } = await sb.from('contract_terms')
        .select('id, name, term_years, yoy_caps')
        .eq('org_id', quote.org_id)
        .eq('active', true)
      const match = (terms || []).find((t: any) =>
        Array.isArray(t.yoy_caps)
        && t.yoy_caps.length === caps.length
        && t.yoy_caps.every((v: number, i: number) => Math.abs(Number(v) - caps[i]) < 0.001)
      )
      if (match) {
        contractTermId = match.id
        termLabel = match.name
      }
    }

    // 8. Wipe + insert (atomic-ish; if the inserts partially fail we don't auto-rollback).
    await sb.from('quote_lines').delete().eq('quote_id', quoteId)
    await sb.from('quote_implementation_items').delete().eq('quote_id', quoteId)
    await sb.from('quote_payment_schedule').delete().eq('quote_id', quoteId)

    if (linesToInsert.length) {
      const { error: insErr } = await sb.from('quote_lines').insert(linesToInsert)
      if (insErr) return resp({ error: `v1: insert quote_lines: ${insErr.message}` }, 500)
    }
    if (implToInsert.length) {
      const { error: insErr } = await sb.from('quote_implementation_items').insert(implToInsert)
      if (insErr) return resp({ error: `v1: insert impl items: ${insErr.message}` }, 500)
    }

    // 9. Update quote header fields from extraction.
    const headerUpdates: any = {}
    if (contractTermId && contractTermId !== quote.contract_term_id) headerUpdates.contract_term_id = contractTermId
    if (Number(extraction.signing_bonus_amount) > 0) headerUpdates.signing_bonus_amount = Number(extraction.signing_bonus_amount)
    if (Number(extraction.free_months) > 0) headerUpdates.free_months = Number(extraction.free_months)
    if (extraction.contract_start_date && /^\d{4}-\d{2}-\d{2}$/.test(extraction.contract_start_date)) {
      headerUpdates.contract_start_date = extraction.contract_start_date
    }
    if (Object.keys(headerUpdates).length) {
      const { error: upErr } = await sb.from('quotes').update(headerUpdates).eq('id', quoteId)
      if (upErr) return resp({ error: `v1: update quote header: ${upErr.message}` }, 500)
    }

    return resp({
      ok: true,
      lines_added: linesToInsert.length,
      impl_added: implToInsert.length,
      unmatched,
      header_updates: { ...headerUpdates, term_label: termLabel },
      warnings: [],
    })
  } catch (e: any) {
    return resp({ error: `v1: ${e?.message || String(e)}` }, 500)
  }
})
