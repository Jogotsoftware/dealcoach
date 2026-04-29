import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T, formatCurrency, formatDate } from '../lib/theme'
import { Card, Badge, Button, Spinner, EmptyState, inputStyle } from '../components/Shared'

const STATUS_COLORS = {
  draft: T.textMuted,
  sent: T.primary,
  accepted: T.success,
  rejected: T.error,
  superseded: T.textMuted,
}

export default function QuotesList() {
  const { dealId } = useParams()
  const nav = useNavigate()
  const { profile } = useAuth()
  const { org } = useOrg()

  const [loading, setLoading] = useState(true)
  const [deal, setDeal] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [dealId])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [dealRes, quotesRes] = await Promise.all([
        supabase.from('deals').select('id, company_name, customer_logo_url').eq('id', dealId).single(),
        supabase.from('quotes').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
      ])
      if (dealRes.error) throw dealRes.error
      setDeal(dealRes.data)
      setQuotes(quotesRes.data || [])
    } catch (e) {
      console.error('[QuotesList] load failed:', e)
      setError(e?.message || 'Failed to load quotes')
    } finally {
      setLoading(false)
    }
  }

  async function createQuote() {
    if (!org?.id) { setError('No org'); return }
    setBusy(true)
    setError('')
    try {
      const today = new Date().toISOString().slice(0, 10)
      const nextNum = (quotes.length || 0) + 1
      const { data, error: insErr } = await supabase.from('quotes').insert({
        org_id: org.id,
        deal_id: dealId,
        name: `Quote ${nextNum}`,
        version: 1,
        status: 'draft',
        is_primary: quotes.length === 0,
        contract_start_date: today,
        billing_cadence: 'annual',
        free_months: 0,
        free_months_placement: 'back',
        global_discount_pct: 0,
        signing_bonus_amount: 0,
        signing_bonus_months: 0,
        created_by: profile?.id,
      }).select('id').single()
      if (insErr) throw insErr
      nav(`/deal/${dealId}/quote/${data.id}`)
    } catch (e) {
      console.error('[QuotesList] createQuote failed:', e)
      setError(e?.message || 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function setPrimary(quote) {
    setBusy(true)
    try {
      // Unique partial index enforces one primary per deal — clear others first
      await supabase.from('quotes').update({ is_primary: false }).eq('deal_id', dealId).neq('id', quote.id)
      await supabase.from('quotes').update({ is_primary: true }).eq('id', quote.id)
      await load()
    } catch (e) {
      console.error('[QuotesList] setPrimary failed:', e)
      setError(e?.message || 'Set primary failed')
    } finally {
      setBusy(false)
    }
  }

  async function duplicateQuote(quote) {
    if (!confirm(`Duplicate "${quote.name}"?`)) return
    setBusy(true)
    try {
      // 1) Create new quote with copied header fields
      const { data: newQuote, error: qErr } = await supabase.from('quotes').insert({
        org_id: quote.org_id,
        deal_id: quote.deal_id,
        name: `${quote.name} (copy)`,
        version: (quote.version || 1) + 1,
        is_primary: false,
        status: 'draft',
        notes: quote.notes,
        contract_term_id: quote.contract_term_id,
        contract_start_date: quote.contract_start_date,
        free_months: quote.free_months,
        free_months_placement: quote.free_months_placement,
        billing_cadence: quote.billing_cadence,
        global_discount_pct: quote.global_discount_pct,
        signing_bonus_amount: quote.signing_bonus_amount,
        signing_bonus_months: quote.signing_bonus_months,
        created_by: profile?.id,
      }).select('id').single()
      if (qErr) throw qErr

      // 2) Copy subscription lines
      const { data: srcLines } = await supabase.from('quote_lines').select('*').eq('quote_id', quote.id).order('line_order')
      // Re-key parent_line_id from old to new — first pass insert without parent links, then patch
      if (srcLines?.length) {
        const idMap = new Map()
        for (const ln of srcLines) {
          const { data: insLine } = await supabase.from('quote_lines').insert({
            quote_id: newQuote.id,
            product_id: ln.product_id,
            parent_line_id: null,
            line_order: ln.line_order,
            quantity: ln.quantity,
            unit_price: ln.unit_price,
            discount_pct: ln.discount_pct,
            extended: ln.extended,
            notes: ln.notes,
            custom_fields: ln.custom_fields || {},
            apply_global_discount: ln.apply_global_discount,
          }).select('id').single()
          if (insLine?.id) idMap.set(ln.id, insLine.id)
        }
        // Second pass: re-link parents
        for (const ln of srcLines) {
          if (!ln.parent_line_id) continue
          const newId = idMap.get(ln.id)
          const newParentId = idMap.get(ln.parent_line_id)
          if (newId && newParentId) {
            await supabase.from('quote_lines').update({ parent_line_id: newParentId }).eq('id', newId)
          }
        }
      }

      // 3) Copy implementation items
      const { data: srcImpl } = await supabase.from('quote_implementation_items').select('*').eq('quote_id', quote.id)
      if (srcImpl?.length) {
        await supabase.from('quote_implementation_items').insert(srcImpl.map(i => ({
          quote_id: newQuote.id,
          source: i.source,
          implementor_name: i.implementor_name,
          name: i.name,
          description: i.description,
          total_amount: i.total_amount,
          billing_type: i.billing_type,
          tm_weeks: i.tm_weeks,
          estimated_start_date: i.estimated_start_date,
          estimated_completion_date: i.estimated_completion_date,
          sort_order: i.sort_order,
          notes: i.notes,
        })))
      }

      // 4) Copy partner blocks + lines
      const { data: srcBlocks } = await supabase.from('quote_partner_blocks').select('*').eq('quote_id', quote.id)
      if (srcBlocks?.length) {
        for (const b of srcBlocks) {
          const { data: newBlock } = await supabase.from('quote_partner_blocks').insert({
            quote_id: newQuote.id,
            partner_name: b.partner_name,
            term_years: b.term_years,
            billing_cadence: b.billing_cadence,
            partner_global_discount_pct: b.partner_global_discount_pct,
            notes: b.notes,
            sort_order: b.sort_order,
          }).select('id').single()
          if (!newBlock?.id) continue
          const { data: srcPartnerLines } = await supabase.from('quote_partner_lines').select('*').eq('block_id', b.id)
          if (srcPartnerLines?.length) {
            await supabase.from('quote_partner_lines').insert(srcPartnerLines.map(l => ({
              quote_id: newQuote.id,
              block_id: newBlock.id,
              sku: l.sku,
              name: l.name,
              description: l.description,
              quantity: l.quantity,
              unit_price: l.unit_price,
              discount_pct: l.discount_pct,
              extended: l.extended,
              sort_order: l.sort_order,
              notes: l.notes,
            })))
          }
        }
      }

      // 5) Recompute totals on the new quote
      try { await supabase.rpc('compute_quote', { p_quote_id: newQuote.id }) } catch (e) { console.warn('compute_quote on dup failed (non-fatal):', e) }
      try { await supabase.rpc('compute_partner_lines', { p_quote_id: newQuote.id }) } catch (e) { console.warn('compute_partner_lines on dup failed (non-fatal):', e) }
      try { await supabase.rpc('recompute_quote_totals', { p_quote_id: newQuote.id }) } catch (e) { console.warn('recompute on dup failed (non-fatal):', e) }

      nav(`/deal/${dealId}/quote/${newQuote.id}`)
    } catch (e) {
      console.error('[QuotesList] duplicate failed:', e)
      setError(e?.message || 'Duplicate failed')
    } finally {
      setBusy(false)
    }
  }

  async function deleteQuote(quote) {
    if (!confirm(`Delete "${quote.name}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      const { error: delErr } = await supabase.from('quotes').delete().eq('id', quote.id)
      if (delErr) throw delErr
      await load()
    } catch (e) {
      console.error('[QuotesList] delete failed:', e)
      setError(e?.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => nav(`/deal/${dealId}`)} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; {deal?.company_name}</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Quotes</h2>
          <div style={{ fontSize: 12, color: T.textSecondary }}>{deal?.company_name}</div>
        </div>
        <Button primary disabled={busy} onClick={createQuote}>+ New Quote</Button>
      </div>

      <div style={{ padding: '16px 24px' }}>
        {error && (
          <div style={{ padding: '8px 12px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, marginBottom: 10, border: `1px solid ${T.error}30` }}>{error}</div>
        )}

        {quotes.length === 0 ? (
          <EmptyState
            title="No quotes yet"
            message="Create your first quote for this deal. Add subscription lines from the price book, set contract terms, and shape the proposal."
            action={<Button primary disabled={busy} onClick={createQuote}>+ New Quote</Button>}
          />
        ) : (
          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Sage</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Partner</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Solution Total</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Updated</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => (
                  <tr key={q.id} style={{ borderBottom: `1px solid ${T.borderLight}`, background: q.is_primary ? T.primaryLight : 'transparent' }}>
                    <td style={{ padding: '10px', cursor: 'pointer' }} onClick={() => nav(`/deal/${dealId}/quote/${q.id}`)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, color: T.primary }}>{q.name}</span>
                        <Badge color={T.textMuted}>v{q.version}</Badge>
                        {q.is_primary && <Badge color={T.primary}>Primary</Badge>}
                      </div>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <Badge color={STATUS_COLORS[q.status] || T.textMuted}>{q.status}</Badge>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.textSecondary }}>{formatCurrency(q.sage_total || 0)}</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.textSecondary }}>{formatCurrency(q.partner_total || 0)}</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 700, color: T.text }}>{formatCurrency(q.solution_total || 0)}</td>
                    <td style={{ padding: '10px', fontSize: 11, color: T.textMuted }}>{formatDate(q.updated_at)}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {!q.is_primary && (
                          <Button onClick={() => setPrimary(q)} disabled={busy} style={{ padding: '4px 8px', fontSize: 10 }}>Set Primary</Button>
                        )}
                        <Button onClick={() => duplicateQuote(q)} disabled={busy} style={{ padding: '4px 8px', fontSize: 10 }}>Duplicate</Button>
                        <Button danger onClick={() => deleteQuote(q)} disabled={busy} style={{ padding: '4px 8px', fontSize: 10 }}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}
