import { useMemo, useState } from 'react'
import { Calendar, momentLocalizer, Views } from 'react-big-calendar'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { theme as T } from '../lib/theme'

const localizer = momentLocalizer(moment)

/**
 * MSPCalendar — rolling 6-month calendar view of MSP stages and milestones.
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
 */
export default function MSPCalendar({
  stages = [],
  milestones = [],
  onSelectEvent,
  readOnly = false,
  onMoveStage,
  onResizeStage,
}) {
  const [view, setView] = useState(Views.MONTH)
  const [date, setDate] = useState(new Date())

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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: floating.length > 0 ? 'minmax(0, 1fr) 220px' : '1fr', gap: 12 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
        {/* react-big-calendar comes with its own toolbar. Inject style overrides. */}
        <style>{`
          .rbc-calendar { font-family: ${T.font}; }
          .rbc-toolbar { font-size: 12px; padding: 4px 0; }
          .rbc-toolbar button { font-family: ${T.font}; font-size: 12px; padding: 4px 10px; }
          .rbc-toolbar button.rbc-active { background: ${T.primary}; color: #fff; }
          .rbc-month-view, .rbc-time-view { border: 1px solid ${T.borderLight}; border-radius: 6px; }
          .rbc-header { padding: 6px 4px; font-size: 11px; font-weight: 600; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.04em; }
          .rbc-today { background: ${T.primary}10; }
          .rbc-event { cursor: pointer; }
          .rbc-event-content { font-size: 11px; }
          .rbc-show-more { font-size: 10px; color: ${T.primary}; }
        `}</style>
        <Calendar
          localizer={localizer}
          events={events}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={[Views.MONTH, Views.WEEK, Views.AGENDA]}
          defaultView={Views.MONTH}
          startAccessor="start"
          endAccessor="end"
          components={{ event: MyEvent }}
          eventPropGetter={eventPropGetter}
          onSelectEvent={onSelectEvent}
          selectable={!readOnly}
          draggableAccessor={() => !readOnly}
          resizable={!readOnly}
          onEventDrop={handleEventDrop}
          onEventResize={handleEventResize}
          style={{ height: 600 }}
          popup
        />
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
