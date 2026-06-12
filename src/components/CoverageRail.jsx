import { theme as T } from '../lib/theme'

// The SC notes workspace's left nav and at-a-glance completeness map: the
// display_section groups, each with a coverage fraction + thin progress bar.
// Sticky, jump-to-section. Gated sections collapse to a muted N/A.
// Presentational — the parent computes `sections`.
//
// props.sections: [{ key, label, answered, total, gated }]
// props.activeSection, props.onJump(key)
export default function CoverageRail({ sections, activeSection, onJump, headerRight }) {
  const live = sections.filter(s => !s.gated)
  const answered = live.reduce((n, s) => n + s.answered, 0)
  const total = live.reduce((n, s) => n + s.total, 0)
  const pct = total ? Math.round((answered / total) * 100) : 0

  return (
    <nav aria-label="Discovery sections" style={{ position: 'sticky', top: 16, alignSelf: 'flex-start', width: 240, flexShrink: 0 }}>
      <div style={{ padding: '12px 14px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Coverage</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: pct >= 70 ? T.success : pct >= 30 ? T.warning : T.error, fontFeatureSettings: '"tnum"' }}>{pct}%</span>
        </div>
        <div style={{ height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct >= 70 ? T.success : pct >= 30 ? T.warning : T.error, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>{answered} of {total} fields answered</div>
        {headerRight}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sections.map(s => {
          const active = s.key === activeSection
          const sPct = s.total ? Math.round((s.answered / s.total) * 100) : 0
          const barColor = sPct >= 70 ? T.success : sPct >= 30 ? T.warning : T.border
          return (
            <button key={s.key} onClick={() => onJump?.(s.key)}
              aria-current={active ? 'true' : undefined}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: T.font,
                padding: '7px 10px', borderRadius: 7, border: 'none',
                background: active ? T.primaryLight : 'transparent',
                borderLeft: active ? `3px solid ${T.primary}` : '3px solid transparent',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surfaceAlt }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: s.gated ? T.textMuted : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                <span style={{ fontSize: 10, color: T.textMuted, fontFeatureSettings: '"tnum"', flexShrink: 0 }}>
                  {s.gated ? 'N/A' : `${s.answered}/${s.total}`}
                </span>
              </span>
              {!s.gated && (
                <span style={{ display: 'block', height: 3, background: T.borderLight, borderRadius: 2, marginTop: 5, overflow: 'hidden' }}>
                  <span style={{ display: 'block', width: `${sPct}%`, height: '100%', background: barColor, borderRadius: 2 }} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
