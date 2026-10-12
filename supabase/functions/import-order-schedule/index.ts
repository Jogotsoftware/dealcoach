// Authorization: a verified user must share the target's org and have a non-BDR profile before any write.
// import-order-schedule v2
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
// - Gateway JWT configuration is managed at deployment; user authorization is checked here.
// - apikey header required by Kong.
// - Version stamps in every error: "import-order-schedule v2: <reason>".

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CLAUDE_MODEL = 'claude-opus-5'

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
    max_tokens: 16000,
    output_config: { effort: 'medium' },
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
  if (data?.stop_reason === 'refusal') {
    throw new Error(`v2: claude refused (${data?.stop_details?.category ?? 'unknown'})`)
  }
  // Thinking is on by default on Opus 5, so content[0] is a thinking block.
  // Take the last text block, which is the model's final answer.
  const blocks = Array.isArray(data?.content) ? data.content : []
  const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
  // Claude sometimes wraps JSON in fences despite "no markdown" — be tolerant.
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    return JSON.parse(stripped)
  } catch (e: any) {
    throw new Error(`v2: claude returned non-JSON: ${stripped.slice(0, 400)}`)
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
    const authorization = req.headers.get('Authorization')
    if (!authorization) return resp({ error: 'Authorization required' }, 401)
    const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: authError } = await asUser.auth.getUser()
    if (authError || !userData?.user) return resp({ error: 'Not signed in' }, 401)
    const body = await req.json()
    const quoteId = String(body.quote_id || '')
    const storagePath = String(body.storage_path || '')
    if (!quoteId) return resp({ error: 'v2: quote_id required' }, 400)
    if (!storagePath) return resp({ error: 'v2: storage_path required' }, 400)
    if (!ANTHROPIC_API_KEY) return resp({ error: 'v2: ANTHROPIC_API_KEY not configured' }, 500)

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // 1. Load the quote + its org. We use the org_id to scope the product lookup.
    const { data: quote, error: qErr } = await sb
      .from('quotes')
      .select('id, org_id, deal_id, contract_term_id, price_book_id')
      .eq('id', quoteId)
      .single()
    if (qErr || !quote) return resp({ error: `v2: quote not found: ${qErr?.message}` }, 404)

    const { data: profile, error: profileError } = await sb.from('profiles')
      .select('org_id, role').eq('id', userData.user.id).maybeSingle()
    if (profileError || !profile?.org_id || !profile.role || profile.role === 'bdr' || profile.org_id !== quote.org_id) {
      return resp({ error: 'Not authorized' }, 403)
    }
    // The service client must not download another org's input file.
    if (storagePath.split('/')[0] !== profile.org_id) return resp({ error: 'Not authorized' }, 403)

    // 2. Download the PDF from storage.
    const { data: file, error: fErr } = await sb.storage
      .from('order-schedule-uploads')
      .download(storagePath)
    if (fErr || !file) return resp({ error: `v2: pdf download failed: ${fErr?.message}` }, 404)

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

    // 4. Load the quote's price book once (the same SKU exists once per
    //    book since 2026-09-24, so matching across the whole org would pick
    //    whichever year's row came first). is_implementation is the
    //    authoritative classifier — products flagged true (professional
    //    services, training, activation fees, etc.) get routed to one-time
    //    costs even if the PDF listed them in the subscription section.
    let productQuery = sb
      .from('products')
      .select('id, sku, name, list_price, is_bundle, is_implementation')
      .eq('org_id', quote.org_id)
      .eq('active', true)
    if (quote.price_book_id) productQuery = productQuery.eq('price_book_id', quote.price_book_id)
    const { data: products } = await productQuery

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
      const { data: insertedLines, error: insErr } = await sb.from('quote_lines').insert(linesToInsert).select('id, product_id')
      if (insErr) return resp({ error: `v2: insert quote_lines: ${insErr.message}` }, 500)

      // Expand bundles (e.g. Sage for Scaling Businesses) into $0 child lines
      // so every surface can list what the bundle includes. Matches the shape
      // the product picker writes: parent_line_id set, unit_price 0.
      const bundleProductIds = new Set((products || []).filter((p: any) => p.is_bundle).map((p: any) => p.id))
      const bundleParents = (insertedLines || []).filter((l: any) => bundleProductIds.has(l.product_id))
      if (bundleParents.length) {
        const { data: bundleItems } = await sb
          .from('product_bundle_items')
          .select('bundle_product_id, child_product_id, included_quantity, sort_order')
          .in('bundle_product_id', bundleParents.map((l: any) => l.product_id))
        let childOrder = linesToInsert.length + 1
        const childLines: any[] = []
        for (const parent of bundleParents) {
          const items = (bundleItems || [])
            .filter((i: any) => i.bundle_product_id === parent.product_id)
            .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
          for (const it of items) {
            childLines.push({
              quote_id: quoteId, product_id: it.child_product_id, parent_line_id: parent.id,
              line_order: childOrder++, quantity: Number(it.included_quantity) || 1,
              unit_price: 0, discount_pct: 0, extended: 0,
            })
          }
        }
        if (childLines.length) {
          const { error: childErr } = await sb.from('quote_lines').insert(childLines)
          if (childErr) return resp({ error: `v3: insert bundle child lines: ${childErr.message}` }, 500)
        }
      }
    }
    if (implToInsert.length) {
      const { error: insErr } = await sb.from('quote_implementation_items').insert(implToInsert)
      if (insErr) return resp({ error: `v2: insert impl items: ${insErr.message}` }, 500)
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
      if (upErr) return resp({ error: `v2: update quote header: ${upErr.message}` }, 500)
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
    return resp({ error: `v2: ${e?.message || String(e)}` }, 500)
  }
})
