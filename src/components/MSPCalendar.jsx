import { useMemo, useState } from 'react'
import { Calendar, momentLocalizer, Views } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import { theme as T } from '../lib/theme'

const localizer = momentLocalizer(moment)
// Wrap once per module rather than per render — keeps the HOC instance stable
// so react-big-calendar internals don't tear down drop targets between renders.
const DnDCalendar = withDragAndDrop(Calendar)

const RANGE_OPTIONS = [
  { key: '1mo', label: '1 month',  months: 1, gridCols: 1 },
  { key: '3mo', label: '3 months', months: 3, gridCols: 3 },
  { key: '6mo', label: '6 months', months: 6, gridCols: 3 },
]

// Hides the per-mini-calendar toolbar — navigation lives in the parent
// range pills instead.
function NoToolbar() { return null }

// Patterns used to detect the kickoff and go-live stages by name. Stages
// in between (chronologically) form the "implementation band" that gets
// shaded on the month grid. Patterns are case-insensitive substring matches.
const KICKOFF_PATTERNS = ['kick off', 'kick-off', 'kickoff', 'project kick', 'project start']
const GOLIVE_PATTERNS  = ['go live', 'go-live', 'golive', 'launch', 'cutover', 'production cutover']

function matchesAny(name, patterns) {
  const n = String(name || '').toLowerCase()
  return patterns.some(p => n.includes(p))
}

function stageDateRange(s) {
  const start = s.start_date ? new Date(s.start_date) : (s.due_date ? new Date(s.due_date) : null)
  const end = s.end_date ? new Date(s.end_date) : start
  return { start, end }
}

/**
 * MSPCalendar — rolling N-month calendar view of MSP stages and milestones.
 *
 * Props:
 *   stages: array of msp_stages rows (id, stage_name, color, start_date, end_date,
 *           due_date, date_label, status, ...)
 *   milestones: array of msp_milestones rows (id, msp_stage_id, milestone_name,
 *               color, due_date, date_label, status, ...)
 *   onSelectEvent(event): called when an event is clicked. event.resource holds
 *                         { kind, stage|milestone, parentStage }
 *   readOnly: boolean — disable drag/resize/slot-select when true (customer view)
 *   onMoveStage(stage, newStart, newEnd): optional, drag-to-reschedule (AE-only)
 *   onResizeStage(stage, newStart, newEnd): optional, resize-to-extend (AE-only)
 *   themeColor: optional hex used to tint the implementation band (the days
 *               between project kickoff and go-live)
 */
export default function MSPCalendar({
  stages = [],
  milestones = [],
  onSelectEvent,
  readOnly = false,
  onMoveStage,
  onResizeStage,
  themeColor,
}) {
  const [range, setRange] = useState(() => {
    try { return localStorage.getItem('msp.calendar.range') || '6mo' } catch { return '6mo' }
  })
  const rangeMeta = RANGE_OPTIONS.find(r => r.key === range) || RANGE_OPTIONS[2]
  const [date, setDate] = useState(new Date())
  const accent = themeColor || T.primary

  function setRangePersist(next) {
    setRange(next)
    try { localStorage.setItem('msp.calendar.range', next) } catch { /* ignore */ }
  }

  // Derive the implementation band (kickoff start → go-live end) so we can
  // shade the day cells underneath. NULL when either end is missing.
  const implRange = useMemo(() => {
    const kickoff = stages.find(s => matchesAny(s.stage_name, KICKOFF_PATTERNS))
    const golive  = stages.find(s => matchesAny(s.stage_name, GOLIVE_PATTERNS))
    if (!kickoff || !golive) return null
    const { start: kStart } = stageDateRange(kickoff)
    const { end: gEnd }     = stageDateRange(golive)
    if (!kStart || !gEnd) return null
    if (gEnd < kStart) return null
    return { start: new Date(kStart.getFullYear(), kStart.getMonth(), kStart.getDate()),
             end:   new Date(gEnd.getFullYear(),   gEnd.getMonth(),   gEnd.getDate()),
             kickoffName: kickoff.stage_name,
             goliveName:  golive.stage_name }
  }, [stages])

  // Build events list. Stages with start+end render as bars; due_date-only stages
  // render as single-day. Milestones render on their due_date.
  const { events, floating } = useMemo(() => {
    const evs = []
    const float = []

    for (const s of stages) {
      const start = s.start_date ? new Date(s.start_date) : (s.due_date ? new Date(s.due_date) : null)
      const end = s.end_date ? new Date(s.end_date) : start
      if (!start) {
        // Date label only — goes into floating sidebar
        if (s.date_label) float.push({ kind: 'stage', item: s })
        continue
      }
      evs.push({
        id: `stage-${s.id}`,
        title: s.stage_name || 'Stage',
        start,
        end: end || start,
        allDay: true,
        resource: { kind: 'stage', stage: s, color: s.color || T.primary, status: s.status },
      })
    }

    for (const m of milestones) {
      const parent = stages.find(s => s.id === m.msp_stage_id) || null
      if (!m.due_date) {
        if (m.date_label) float.push({ kind: 'milestone', item: m, parent })
        continue
      }
      const d = new Date(m.due_date)
      evs.push({
        id: `milestone-${m.id}`,
        title: m.milestone_name || 'Milestone',
        start: d,
        end: d,
        allDay: true,
        resource: { kind: 'milestone', milestone: m, parentStage: parent, color: m.color || parent?.color || T.primary, status: m.status },
      })
    }

    return { events: evs, floating: float }
  }, [stages, milestones])

  function eventPropGetter(event) {
    const isMilestone = event.resource?.kind === 'milestone'
    const color = event.resource?.color || T.primary
    return {
      style: {
        backgroundColor: isMilestone ? color : color + 'CC',
        border: `1px solid ${color}`,
        color: '#fff',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: '1px 4px',
        // Milestones render as smaller markers
        ...(isMilestone ? { borderRadius: 8, padding: '0 6px' } : {}),
      },
    }
  }

  function MyEvent({ event }) {
    const isMilestone = event.resource?.kind === 'milestone'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: 1.2, overflow: 'hidden' }} title={event.title}>
        {isMilestone && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.title}</span>
      </div>
    )
  }

  function handleEventDrop({ event, start, end }) {
    if (readOnly || event.resource?.kind !== 'stage') return
    if (onMoveStage) onMoveStage(event.resource.stage, start, end)
  }
  function handleEventResize({ event, start, end }) {
    if (readOnly || event.resource?.kind !== 'stage') return
    if (onResizeStage) onResizeStage(event.resource.stage, start, end)
  }

  if (events.length === 0 && floating.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 8 }}>
        No scheduled events yet. Add stages and milestones with dates to see them on the calendar.
      </div>
    )
  }

  // Tint days that fall between kickoff and go-live so the customer sees
  // the implementation window at a glance. Only applies in MONTH view —
  // AGENDA is a list and doesn't have day cells.
  function dayPropGetter(d) {
    if (!implRange) return {}
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    if (day >= implRange.start && day <= implRange.end) {
      return {
        style: {
          background: accent + '14',
          boxShadow: `inset 0 0 0 1px ${accent}30`,
        },
      }
    }
    return {}
  }

  // Build the list of month-start dates anchored at `date`. The first
  // calendar starts at the current month, then advances forward by 1
  // month for each subsequent slot.
  const monthStarts = useMemo(() => {
    const base = new Date(date.getFullYear(), date.getMonth(), 1)
    const out = []
    for (let i = 0; i < rangeMeta.months; i++) {
      out.push(new Date(base.getFullYear(), base.getMonth() + i, 1))
    }
    return out
  }, [date, rangeMeta.months])

  function shiftDate(delta) {
    setDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
  }
  function goToday() {
    setDate(new Date())
  }

  const headerLabel = rangeMeta.months === 1
    ? moment(monthStarts[0]).format('MMMM YYYY')
    : `${moment(monthStarts[0]).format('MMM YYYY')} – ${moment(monthStarts[monthStarts.length - 1]).format('MMM YYYY')}`

  const isMulti = rangeMeta.months > 1

  return (
    <div style={{ display: 'grid', gridTemplateColumns: floating.length > 0 ? 'minmax(0, 1fr) 220px' : '1fr', gap: 12 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
        {/* Range toggle + navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 8px', flexWrap: 'wrap' }}>
          {RANGE_OPTIONS.map(o => (
            <button key={o.key} onClick={() => setRangePersist(o.key)}
              style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 600, fontFamily: T.font,
                border: `1px solid ${range === o.key ? accent : T.border}`,
                borderRadius: 4,
                background: range === o.key ? accent : T.surface,
                color: range === o.key ? '#fff' : T.text,
                cursor: 'pointer',
              }}>
              {o.label}
            </button>
          ))}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
            <button onClick={() => shiftDate(-1)} title="Previous month"
              style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font }}>‹</button>
            <button onClick={goToday} title="Jump to current month"
              style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font }}>Today</button>
            <button onClick={() => shiftDate(1)} title="Next month"
              style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font }}>›</button>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, marginLeft: 6 }}>{headerLabel}</span>
          {implRange && (
            <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 4, background: accent + '18', border: `1px solid ${accent}40`, fontSize: 11, color: accent, fontWeight: 600 }}>
              <span style={{ width: 10, height: 10, background: accent, opacity: 0.6, borderRadius: 2 }} />
              Implementation window: {implRange.kickoffName} → {implRange.goliveName}
            </div>
          )}
        </div>
        <style>{`
          .rbc-calendar { font-family: ${T.font}; }
          .rbc-month-view, .rbc-time-view, .rbc-agenda-view { border: 1px solid ${T.borderLight}; border-radius: 6px; }
          .rbc-header { padding: 4px 4px; font-size: 10px; font-weight: 600; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.04em; }
          .rbc-today { background: ${accent}10; }
          .rbc-event { cursor: pointer; }
          .rbc-event-content { font-size: 10px; }
          .rbc-show-more { font-size: 10px; color: ${accent}; }
          .rbc-month-row { min-height: 0; }
          .rbc-date-cell { font-size: 10px; padding: 2px 4px; }
        `}</style>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${rangeMeta.gridCols}, minmax(0, 1fr))`,
          gap: 10,
        }}>
          {monthStarts.map((monthStart) => {
            const monthLabel = moment(monthStart).format('MMMM YYYY')
            // Each mini-calendar: smaller height when multi, full when single.
            const miniHeight = isMulti ? (rangeMeta.months <= 3 ? 360 : 320) : 600
            return (
              <div key={monthStart.toISOString()} style={{ minWidth: 0 }}>
                {isMulti && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.text, padding: '2px 4px 6px', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {monthLabel}
                  </div>
                )}
                <DnDCalendar
                  localizer={localizer}
                  events={events}
                  view={Views.MONTH}
                  onView={() => { /* locked to month view */ }}
                  date={monthStart}
                  onNavigate={() => { /* navigation handled by parent toolbar */ }}
                  views={{ month: true }}
                  startAccessor="start"
                  endAccessor="end"
                  components={{ event: MyEvent, toolbar: NoToolbar }}
                  eventPropGetter={eventPropGetter}
                  dayPropGetter={dayPropGetter}
                  onSelectEvent={onSelectEvent}
                  selectable={!readOnly}
                  draggableAccessor={(event) => !readOnly && event.resource?.kind === 'stage'}
                  resizableAccessor={(event) => !readOnly && event.resource?.kind === 'stage'}
                  onEventDrop={handleEventDrop}
                  onEventResize={handleEventResize}
                  style={{ height: miniHeight }}
                  popup
                />
              </div>
            )
          })}
        </div>
      </div>

      {floating.length > 0 && (
        <aside style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, fontSize: 12, alignSelf: 'flex-start' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Floating items
          </div>
          <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 10 }}>
            Items with a date label but no real date. Pin them to a specific date to see them on the calendar.
          </div>
          {floating.map((f, i) => {
            const item = f.item
            const color = item.color || f.parent?.color || T.primary
            return (
              <button
                key={`float-${i}`}
                onClick={() => onSelectEvent && onSelectEvent({ id: `${f.kind}-${item.id}`, title: item.stage_name || item.milestone_name, resource: { kind: f.kind, stage: f.kind === 'stage' ? item : null, milestone: f.kind === 'milestone' ? item : null, parentStage: f.parent, color } })}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 6, border: `1px solid ${T.borderLight}`, borderLeft: `4px solid ${color}`, borderRadius: 4, background: T.surface, cursor: 'pointer', fontFamily: T.font }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{item.stage_name || item.milestone_name}</div>
                <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>{item.date_label}</div>
                {f.kind === 'milestone' && f.parent && (
                  <div style={{ fontSize: 10, color: T.textSecondary, marginTop: 2 }}>under {f.parent.stage_name}</div>
                )}
              </button>
            )
          })}
        </aside>
      )}
    </div>
  )
}
