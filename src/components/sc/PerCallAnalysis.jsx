import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'
import { Spinner, EmptyState, Card, Badge } from '../Shared'
import ProvenanceChip from '../ProvenanceChip'
import SourceCallLink from '../SourceCallLink'
import ExecutionAnalytics from '../ExecutionAnalytics'

// Per-call analysis — a dropdown of the deal's calls (newest first), then for
// the selected call: the AI summary, the facts/entities it captured (with
// provenance chips), and the execution analytics (coaching, in a labeled
// area distinct from deal facts). Built once; reused on the AE deal view.
export default function PerCallAnalysis({ dealId, conversationId: pinnedId }) {
  const [convs, setConvs] = useState(null)
  const [selectedId, setSelectedId] = useState(pinnedId || null)
  const [conv, setConv] = useState(null)
  const [facts, setFacts] = useState([])
  const [loadingCall, setLoadingCall] = useState(false)

  useEffect(() => {
    if (!dealId) return
    supabase.from('conversations')
      .select('id, call_type, call_date, title, ai_summary, processed, granola_share_url, deal_id')
      .eq('deal_id', dealId).order('call_date', { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        const list = data || []
        setConvs(list)
        if (!pinnedId && list.length) setSelectedId(list[0].id)
      })
  }, [dealId, pinnedId])

  useEffect(() => {
    if (!selectedId) { setConv(null); return }
    setLoadingCall(true)
    Promise.all([
      supabase.from('conversations').select('id, call_type, call_date, title, ai_summary, granola_share_url, deal_id').eq('id', selectedId).maybeSingle(),
      supabase.from('deal_pain_points').select('pain_description, quote, speaker, observed_at').eq('source_conversation_id', selectedId),
      supabase.from('business_catalysts').select('catalyst, quote, speaker, observed_at').eq('source_conversation_id', selectedId),
      supabase.from('compelling_events').select('event_description, event_date, quote, speaker, observed_at').eq('source_conversation_id', selectedId),
      supabase.from('company_systems').select('system_name, system_category, source_excerpt, speaker').eq('source_conversation_id', selectedId),
      supabase.from('deal_metrics').select('label, value, unit, quote, speaker, observed_at').eq('conversation_id', selectedId),
    ]).then(([c, pains, cats, ces, sys, metrics]) => {
      setConv(c.data || null)
      const f = []
      ;(pains.data || []).forEach(p => f.push({ kind: 'Pain', text: p.pain_description, prov: prov(p, selectedId) }))
      ;(cats.data || []).forEach(p => f.push({ kind: 'Catalyst', text: p.catalyst, prov: prov(p, selectedId) }))
      ;(ces.data || []).forEach(p => f.push({ kind: 'Event', text: p.event_description + (p.event_date ? ` (${p.event_date})` : ''), prov: prov(p, selectedId) }))
      ;(sys.data || []).forEach(p => f.push({ kind: 'System', text: `${p.system_name}${p.system_category ? ` · ${p.system_category}` : ''}`, prov: { source: 'transcript', quote: p.source_excerpt, speaker: p.speaker, conversation_id: selectedId } }))
      ;(metrics.data || []).forEach(p => f.push({ kind: 'Metric', text: `${p.label}: ${p.value}${p.unit ? ` ${p.unit}` : ''}`, prov: prov(p, selectedId) }))
      setFacts(f)
      setLoadingCall(false)
    }).catch(e => { console.error('[PerCallAnalysis]', e); setLoadingCall(false) })
  }, [selectedId])

  if (convs === null) return <Spinner />
  if (convs.length === 0) return <EmptyState icon="▶" title="No calls analyzed yet" message="Upload a transcript to start." />

  return (
    <div>
      {!pinnedId && (
        <div style={{ marginBottom: 16 }}>
          <select value={selectedId || ''} onChange={e => setSelectedId(e.target.value)}
            style={{ fontFamily: T.font, fontSize: 13, fontWeight: 600, color: T.text, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, cursor: 'pointer', minWidth: 320 }}>
            {convs.map(c => (
              <option key={c.id} value={c.id}>
                {String(c.call_type || 'call').replace(/_/g, ' ')} · {c.call_date ? new Date(c.call_date).toLocaleDateString() : '—'} · {c.title || 'Untitled'}{!c.processed ? ' (processing…)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {loadingCall ? <Spinner /> : conv && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Summary" action={<SourceCallLink conversation={conv} dealId={dealId} />}>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {conv.ai_summary || <span style={{ color: T.textMuted, fontStyle: 'italic' }}>No summary yet.</span>}
            </div>
          </Card>

          {facts.length > 0 && (
            <Card title={`Facts captured on this call (${facts.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {facts.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < facts.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                    <Badge color={T.primary}>{f.kind}</Badge>
                    <span style={{ flex: 1, fontSize: 13, color: T.text }}>{f.text}</span>
                    {f.prov && <ProvenanceChip dealId={dealId} provenance={f.prov} />}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Coaching — execution analytics, labeled distinct from deal facts. */}
          <ExecutionAnalytics conversationId={selectedId} />
        </div>
      )}
    </div>
  )
}

function prov(row, convId) {
  if (!row?.quote) return null
  return { source: 'transcript', quote: row.quote, speaker: row.speaker, conversation_id: convId, observed_at: row.observed_at }
}
