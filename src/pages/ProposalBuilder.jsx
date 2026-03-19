import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, formatDateLong } from '../lib/theme'
import { Card, Badge, Button, TabBar, Field, EmptyState, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function ProposalBuilder() {
  const { dealId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deal, setDeal] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [insights, setInsights] = useState([])
  const [quotes, setQuotes] = useState([])
  const [tab, setTab] = useState('builder')

  // Builder form
  const [execSummary, setExecSummary] = useState('')
  const [problems, setProblems] = useState([])
  const [solutions, setSolutions] = useState([])
  const [totalImpact, setTotalImpact] = useState('')
  const [investment, setInvestment] = useState('')
  const [expectedRoi, setExpectedRoi] = useState('')

  useEffect(() => { loadData() }, [dealId])

  async function loadData() {
    setLoading(true)
    try {
      const [dealRes, propRes, insRes, quotesRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', dealId).single(),
        supabase.from('proposal_documents').select('*').eq('deal_id', dealId).eq('is_current', true).limit(1),
        supabase.from('proposal_insights').select('*').eq('deal_id', dealId).order('created_at'),
        supabase.from('quotes').select('id, version, net_price, arr, status, is_primary').eq('deal_id', dealId).order('version', { ascending: false }),
      ])

      setDeal(dealRes.data)
      setInsights(insRes.data || [])
      setQuotes(quotesRes.data || [])

      const prop = propRes.data?.[0]
      if (prop) {
        setProposal(prop)
        setExecSummary(prop.executive_summary || '')
        setProblems(Array.isArray(prop.problems_challenges) ? prop.problems_challenges : [])
        setSolutions(Array.isArray(prop.solutions_benefits) ? prop.solutions_benefits : [])
        setTotalImpact(prop.total_annual_impact || '')
        setInvestment(prop.implementation_investment || '')
        setExpectedRoi(prop.expected_roi || '')
      }
    } catch (err) {
      console.error('Error loading proposal:', err)
    } finally {
      setLoading(false)
    }
  }

  function addProblem() {
    setProblems(prev => [...prev, { problem: '', impact: '' }])
  }

  function updateProblem(idx, field, value) {
    setProblems(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }

  function removeProblem(idx) {
    setProblems(prev => prev.filter((_, i) => i !== idx))
  }

  function addSolution() {
    setSolutions(prev => [...prev, { solution: '', benefit: '' }])
  }

  function updateSolution(idx, field, value) {
    setSolutions(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  function removeSolution(idx) {
    setSolutions(prev => prev.filter((_, i) => i !== idx))
  }

  function importInsight(insight) {
    if (insight.insight_type === 'pain' || insight.insight_type === 'risk' || insight.insight_type === 'objection') {
      setProblems(prev => [...prev, { problem: insight.primary_text, impact: insight.impact_text }])
    } else {
      setSolutions(prev => [...prev, { solution: insight.primary_text, benefit: insight.impact_text }])
    }
  }

  async function saveProposal() {
    setSaving(true)
    try {
      const data = {
        deal_id: dealId,
        executive_summary: execSummary,
        problems_challenges: problems,
        solutions_benefits: solutions,
        total_annual_impact: totalImpact,
        implementation_investment: investment || formatCurrency(deal?.deal_value),
        expected_roi: expectedRoi,
        is_current: true,
        created_by: profile?.id,
      }

      if (proposal) {
        await supabase.from('proposal_documents').update(data).eq('id', proposal.id)
      } else {
        data.version = 1
        const { data: newProp } = await supabase.from('proposal_documents').insert(data).select().single()
        setProposal(newProp)
      }
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
  }

  async function createShareLink() {
    const primaryQuote = quotes.find(q => q.is_primary)
    const { error } = await supabase.from('proposal_shares').insert({
      deal_id: dealId,
      quote_id: primaryQuote?.id || null,
      created_by: profile?.id,
    })
    if (!error) alert('Share link created! Check the Proposal tab on the deal page.')
  }

  if (loading) return <Spinner />
  if (!deal) return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>Deal not found</div>

  const painInsights = insights.filter(i => ['pain', 'risk', 'objection'].includes(i.insight_type))
  const valueInsights = insights.filter(i => ['value_driver', 'requirement', 'impact'].includes(i.insight_type))

  const tabs = [
    { key: 'builder', label: 'Builder' },
    { key: 'insights', label: `Insights (${insights.length})` },
    { key: 'preview', label: 'Preview' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button onClick={() => navigate(`/deal/${dealId}`)} style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}>&larr; {deal.company_name}</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Proposal Builder</div>
            <div style={{ fontSize: 13, color: T.textSecondary }}>{deal.company_name}</div>
          </div>
          <Button onClick={createShareLink}>Share</Button>
          <Button primary onClick={saveProposal} disabled={saving}>{saving ? 'Saving...' : 'Save Proposal'}</Button>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: 24, maxWidth: 1100 }}>

        {/* BUILDER TAB */}
        {tab === 'builder' && (
          <div>
            <Card title="Executive Summary">
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                value={execSummary}
                onChange={e => setExecSummary(e.target.value)}
                placeholder={`${deal.company_name} requires a modern financial platform to...`}
              />
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Problems */}
              <Card
                title="Problems / Challenges"
                action={<Button style={{ padding: '4px 12px', fontSize: 11 }} onClick={addProblem}>+ Add</Button>}
              >
                {problems.length === 0 ? (
                  <div style={{ color: T.textMuted, fontSize: 13, padding: '8px 0' }}>
                    No problems added. Click '+ Add' or import from Insights tab.
                  </div>
                ) : problems.map((p, i) => (
                  <div key={i} style={{
                    padding: 12, background: T.errorLight, borderRadius: 6,
                    marginBottom: 8, border: `1px solid ${T.error}15`, position: 'relative',
                  }}>
                    <button onClick={() => removeProblem(i)} style={{
                      position: 'absolute', top: 8, right: 8, background: 'none',
                      border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14,
                    }}>&#10005;</button>
                    <input
                      style={{ ...inputStyle, marginBottom: 6, background: 'white', fontSize: 13, fontWeight: 600 }}
                      value={p.problem} onChange={e => updateProblem(i, 'problem', e.target.value)}
                      placeholder="Problem description"
                    />
                    <input
                      style={{ ...inputStyle, background: 'white', fontSize: 12 }}
                      value={p.impact} onChange={e => updateProblem(i, 'impact', e.target.value)}
                      placeholder="Business impact"
                    />
                  </div>
                ))}
              </Card>

              {/* Solutions */}
              <Card
                title="Solutions / Benefits"
                action={<Button style={{ padding: '4px 12px', fontSize: 11 }} onClick={addSolution}>+ Add</Button>}
              >
                {solutions.length === 0 ? (
                  <div style={{ color: T.textMuted, fontSize: 13, padding: '8px 0' }}>
                    No solutions added yet.
                  </div>
                ) : solutions.map((s, i) => (
                  <div key={i} style={{
                    padding: 12, background: T.successLight, borderRadius: 6,
                    marginBottom: 8, border: `1px solid ${T.success}15`, position: 'relative',
                  }}>
                    <button onClick={() => removeSolution(i)} style={{
                      position: 'absolute', top: 8, right: 8, background: 'none',
                      border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14,
                    }}>&#10005;</button>
                    <input
                      style={{ ...inputStyle, marginBottom: 6, background: 'white', fontSize: 13, fontWeight: 600 }}
                      value={s.solution} onChange={e => updateSolution(i, 'solution', e.target.value)}
                      placeholder="Solution"
                    />
                    <input
                      style={{ ...inputStyle, background: 'white', fontSize: 12 }}
                      value={s.benefit} onChange={e => updateSolution(i, 'benefit', e.target.value)}
                      placeholder="Benefit"
                    />
                  </div>
                ))}
              </Card>
            </div>

            <Card title="Financial Summary">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Total Annual Impact</label>
                  <input style={inputStyle} value={totalImpact} onChange={e => setTotalImpact(e.target.value)} placeholder="e.g. $500K+" />
                </div>
                <div>
                  <label style={labelStyle}>Implementation Investment</label>
                  <input style={inputStyle} value={investment} onChange={e => setInvestment(e.target.value)} placeholder={formatCurrency(deal.deal_value)} />
                </div>
                <div>
                  <label style={labelStyle}>Expected ROI</label>
                  <input style={inputStyle} value={expectedRoi} onChange={e => setExpectedRoi(e.target.value)} placeholder="e.g. 130% Year 1" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* INSIGHTS TAB */}
        {tab === 'insights' && (
          <div>
            <div style={{ marginBottom: 12, fontSize: 13, color: T.textSecondary }}>
              Click an insight to import it into the proposal as a problem or solution.
            </div>
            {insights.length === 0 ? (
              <EmptyState message="No insights yet. Upload transcripts to auto-extract pain points and value drivers." />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.error, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Pain Points ({painInsights.length})
                  </div>
                  {painInsights.map(ins => (
                    <div key={ins.id} onClick={() => importInsight(ins)} style={{
                      padding: 12, background: T.errorLight, borderRadius: 6, marginBottom: 8,
                      cursor: 'pointer', border: `1px solid ${T.error}15`, transition: 'all 0.15s',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.error }}>{ins.primary_text}</div>
                        {ins.source_type === 'ai_extracted' && <Badge color={T.primary}>AI</Badge>}
                      </div>
                      <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>{ins.impact_text}</div>
                      {ins.speaker_name && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>- {ins.speaker_name}</div>}
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.success, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Value Drivers ({valueInsights.length})
                  </div>
                  {valueInsights.map(ins => (
                    <div key={ins.id} onClick={() => importInsight(ins)} style={{
                      padding: 12, background: T.successLight, borderRadius: 6, marginBottom: 8,
                      cursor: 'pointer', border: `1px solid ${T.success}15`, transition: 'all 0.15s',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.success }}>{ins.primary_text}</div>
                        {ins.source_type === 'ai_extracted' && <Badge color={T.primary}>AI</Badge>}
                      </div>
                      <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>{ins.impact_text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PREVIEW TAB */}
        {tab === 'preview' && (
          <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 8, padding: '40px 48px', maxWidth: 900, margin: '0 auto', boxShadow: T.shadow }}>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <div style={{ fontSize: 12, color: T.primary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Proposal
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: T.text }}>{deal.company_name}</div>
              <div style={{ fontSize: 13, color: T.textSecondary, marginTop: 4 }}>
                Prepared {formatDateLong(new Date().toISOString().split('T')[0])}
              </div>
            </div>

            {execSummary && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Executive Summary
                </div>
                <div style={{ fontSize: 14, color: T.text, lineHeight: 1.7 }}>{execSummary}</div>
              </div>
            )}

            {problems.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Challenges Identified
                </div>
                {problems.map((p, i) => (
                  <div key={i} style={{ padding: '14px 18px', background: '#fef2f2', borderRadius: 6, marginBottom: 8, borderLeft: `3px solid ${T.error}` }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#991b1b' }}>{p.problem}</div>
                    {p.impact && <div style={{ fontSize: 13, color: '#7f1d1d', marginTop: 4 }}>Impact: {p.impact}</div>}
                  </div>
                ))}
              </div>
            )}

            {solutions.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Proposed Solutions
                </div>
                {solutions.map((s, i) => (
                  <div key={i} style={{ padding: '14px 18px', background: '#f0fdf4', borderRadius: 6, marginBottom: 8, borderLeft: `3px solid ${T.success}` }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>{s.solution}</div>
                    {s.benefit && <div style={{ fontSize: 13, color: '#15803d', marginTop: 4 }}>{s.benefit}</div>}
                  </div>
                ))}
              </div>
            )}

            {(totalImpact || investment || expectedRoi) && (
              <div style={{ marginBottom: 32, padding: 24, background: T.surfaceAlt, borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Financial Summary
                </div>
                <div style={{ display: 'flex', gap: 32 }}>
                  {totalImpact && <div><div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Annual Impact</div><div style={{ fontSize: 24, fontWeight: 700, color: T.success }}>{totalImpact}</div></div>}
                  {investment && <div><div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Investment</div><div style={{ fontSize: 24, fontWeight: 700, color: T.text }}>{investment}</div></div>}
                  {expectedRoi && <div><div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Expected ROI</div><div style={{ fontSize: 24, fontWeight: 700, color: T.primary }}>{expectedRoi}</div></div>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
