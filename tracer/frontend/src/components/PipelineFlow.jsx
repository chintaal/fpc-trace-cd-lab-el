import React from 'react'

const STAGES = [
  { key: 'parse_tree', label: 'Parse Tree', short: 'PT',  color: '#bc8cff', desc: 'AST nodes' },
  { key: 'semantics',  label: 'Semantics',  short: 'SEM', color: '#388bfd', desc: 'types + aliasing' },
  { key: 'fir',        label: 'FIR',        short: 'FIR', color: '#3fb950', desc: 'MLIR Fortran IR' },
  { key: 'hlfir',      label: 'HLFIR',      short: 'HLF', color: '#e3b341', desc: 'high-level arrays' },
  { key: 'llvm_ir',    label: 'LLVM IR',    short: 'IR',  color: '#f85149', desc: 'target ISA' },
]

export default function PipelineFlow({ stages, activeStage, onStageClick, mode }) {
  const totalLines = Object.values(stages || {}).reduce((acc, s) => acc + (s.line_count || 0), 0)

  return (
    <div style={s.bar}>
      {/* Fortran source label */}
      <div style={s.srcLabel}>
        <span style={s.srcDot} />
        <span style={s.srcText}>Fortran</span>
      </div>

      {/* Stage flow */}
      <div style={s.flow}>
        {STAGES.map((stage, i) => {
          const info = stages?.[stage.key]
          const lineCount = info?.line_count || 0
          const isActive = activeStage === stage.key
          const hasData = lineCount > 0

          return (
            <React.Fragment key={stage.key}>
              {/* Arrow between stages */}
              {i > 0 && (
                <div style={s.arrowWrap}>
                  <svg width="20" height="10" viewBox="0 0 20 10">
                    <line x1="0" y1="5" x2="14" y2="5"
                      stroke={isActive ? stage.color : (activeStage === STAGES[i-1].key ? STAGES[i-1].color : '#30363d')}
                      strokeWidth="1.5" />
                    <polygon points="14,2 20,5 14,8"
                      fill={isActive ? stage.color : (activeStage === STAGES[i-1].key ? STAGES[i-1].color : '#30363d')} />
                  </svg>
                </div>
              )}

              {/* Stage button */}
              <button
                onClick={() => onStageClick(stage.key)}
                title={`${stage.label} · ${lineCount} lines · ${stage.desc}`}
                style={{
                  ...s.stageBtn,
                  background: isActive ? `${stage.color}18` : hasData ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                  border: `1px solid ${isActive ? stage.color : hasData ? stage.color + '40' : '#30363d'}`,
                  opacity: hasData ? 1 : 0.35,
                  boxShadow: isActive ? `0 0 0 1px ${stage.color}30, inset 0 1px 0 ${stage.color}20` : 'none',
                }}
              >
                <span style={{ ...s.stageLbl, color: isActive ? stage.color : 'var(--text-primary)' }}>
                  {stage.label}
                </span>
                {hasData && (
                  <span style={{ ...s.stageMeta, color: isActive ? stage.color + 'aa' : 'var(--text-muted)' }}>
                    {lineCount}L
                  </span>
                )}
              </button>
            </React.Fragment>
          )
        })}
      </div>

      {/* Right-side stats */}
      <div style={s.rightMeta}>
        <span style={s.totalLines}>{totalLines.toLocaleString()} total lines</span>
        <span style={{
          ...s.modeBadge,
          background: mode === 'real' ? 'rgba(63,185,80,.12)' : 'rgba(56,139,253,.1)',
          color: mode === 'real' ? '#3fb950' : '#388bfd',
          border: `1px solid ${mode === 'real' ? 'rgba(63,185,80,.3)' : 'rgba(56,139,253,.25)'}`,
        }}>
          {mode === 'real' ? '⚡ live' : '◈ sim'}
        </span>
      </div>
    </div>
  )
}

const s = {
  bar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
    background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)',
    flexShrink: 0, minHeight: 46, overflow: 'hidden',
  },
  srcLabel: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
  srcDot: { width: 6, height: 6, borderRadius: '50%', background: '#8b949e' },
  srcText: { fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px' },
  flow: { display: 'flex', alignItems: 'center', flex: 1, gap: 0, overflow: 'hidden' },
  arrowWrap: { display: 'flex', alignItems: 'center', flexShrink: 0, padding: '0 1px' },
  stageBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    transition: 'all .15s', flexShrink: 0, minWidth: 70,
  },
  stageLbl: { fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '.3px' },
  stageMeta: { fontSize: 8, marginTop: 1 },
  rightMeta: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 'auto' },
  totalLines: { fontSize: 9, color: 'var(--text-muted)' },
  modeBadge: {
    fontSize: 9, fontWeight: 700, padding: '2px 7px',
    borderRadius: 10, letterSpacing: '.3px',
  },
}
