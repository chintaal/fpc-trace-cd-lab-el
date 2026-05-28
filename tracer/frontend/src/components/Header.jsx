import React from 'react'

const STAGE_LABELS = ['Parse Tree', 'Semantics', 'FIR', 'HLFIR', 'LLVM IR']
const STAGE_COLORS = ['var(--stage-parse)','var(--stage-sem)','var(--stage-fir)','var(--stage-hlfir)','var(--stage-llvm)']

const MODES = [
  { id: 'explore', icon: '🔬', label: 'Explore' },
  { id: 'compare', icon: '⟷',  label: 'Compare' },
  { id: 'analyze', icon: '⚡', label: 'Analyze' },
]

export default function Header({ health, mode, onModeChange, onSearch, onPatternsClick }) {
  return (
    <header style={s.header}>
      {/* Brand */}
      <div style={s.brand}>
        <span style={s.logo}>⬡ fpc-trace</span>
        <div style={s.pipeline}>
          {STAGE_LABELS.map((label, i) => (
            <React.Fragment key={label}>
              <span style={{ ...s.stage, color: STAGE_COLORS[i] }}>{label}</span>
              {i < STAGE_LABELS.length - 1 && <span style={s.arrow}>→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Mode switcher */}
      <div style={s.modes}>
        {MODES.map(m => (
          <button
            key={m.id}
            style={{
              ...s.modeBtn,
              background: mode === m.id ? 'rgba(56,139,253,.15)' : 'var(--bg-elevated)',
              color: mode === m.id ? 'var(--accent-blue)' : 'var(--text-secondary)',
              border: `1px solid ${mode === m.id ? 'rgba(56,139,253,.4)' : 'var(--border)'}`,
            }}
            onClick={() => onModeChange(m.id)}
            title={m.id === 'explore' ? 'Browse 10 constructs, click lines to trace'
                 : m.id === 'compare' ? 'Side-by-side stage comparison'
                 : 'Live Fortran editor with pattern detection'}
          >
            <span style={{ marginRight: 5 }}>{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* Right controls */}
      <div style={s.right}>
        {/* Search shortcut */}
        <button style={s.searchBtn} onClick={onSearch} title="Global IR search (⌘K)">
          <span>🔍</span>
          <span style={{ marginLeft: 6 }}>Search IR</span>
          <kbd style={s.kbd}>⌘K</kbd>
        </button>

        {/* Status badge */}
        {health && (
          <span style={{
            ...s.badge,
            background: health.flang_available ? 'rgba(63,185,80,.15)' : 'rgba(56,139,253,.12)',
            color: health.flang_available ? 'var(--accent-green)' : 'var(--accent-blue)',
            border: `1px solid ${health.flang_available ? 'rgba(63,185,80,.3)' : 'rgba(56,139,253,.3)'}`
          }}>
            {health.flang_available ? '⚡ flang live' : '◈ simulation'}
            &nbsp;·&nbsp;{health.construct_count} constructs
          </span>
        )}

        <button style={s.btn} onClick={onPatternsClick} title="Lowering patterns reference">
          📖 Patterns
        </button>

        <a
          href="http://localhost:8001/docs"
          target="_blank" rel="noreferrer"
          style={{ ...s.btn, color: 'var(--text-secondary)', textDecoration:'none' }}
          title="FastAPI interactive docs"
        >
          API ↗
        </a>
      </div>
    </header>
  )
}

const s = {
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px', height: 50,
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0, gap: 16, zIndex: 10,
  },
  brand: { display: 'flex', alignItems: 'center', gap: 14 },
  logo: { fontSize: 14, fontWeight: 700, color: 'var(--accent-blue)',
          fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' },
  pipeline: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '2px 8px', background: 'var(--bg-elevated)',
    borderRadius: 20, border: '1px solid var(--border)',
  },
  stage: { fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)' },
  arrow: { color: 'var(--text-muted)', fontSize: 9 },
  modes: { display: 'flex', gap: 4 },
  modeBtn: {
    padding: '4px 12px', borderRadius: 6, fontSize: 11,
    fontWeight: 600, cursor: 'pointer', transition: 'all .12s',
    display: 'flex', alignItems: 'center',
  },
  right: { display: 'flex', alignItems: 'center', gap: 8 },
  searchBtn: {
    display: 'flex', alignItems: 'center', padding: '4px 10px',
    borderRadius: 6, background: 'var(--bg-elevated)',
    border: '1px solid var(--border)', color: 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 11, fontWeight: 500,
    gap: 4, transition: 'border-color .1s',
  },
  kbd: {
    marginLeft: 6, padding: '1px 4px', borderRadius: 3,
    background: 'var(--bg-hover)', border: '1px solid var(--border)',
    fontSize: 9, color: 'var(--text-muted)',
  },
  badge: { fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap' },
  btn: {
    padding: '4px 10px', borderRadius: 6, fontSize: 11,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', cursor: 'pointer',
  },
}
