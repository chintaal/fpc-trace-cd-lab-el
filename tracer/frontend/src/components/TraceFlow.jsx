/**
 * TraceFlow — vertical lowering chain visualization.
 *
 * Shows the full Parse Tree → Semantics → FIR → HLFIR → LLVM IR chain
 * for a selected source line as an animated card stack with transformation
 * annotations between each level.  Replaces the flat AnalysisPanel on click.
 */
import React, { useState, useEffect, useRef } from 'react'

const STAGES = [
  { key: 'parse_tree', label: 'Parse Tree', color: '#bc8cff',
    icon: '🌳', role: 'AST nodes from parser' },
  { key: 'semantics',  label: 'Semantics',  color: '#388bfd',
    icon: '🔍', role: 'type resolution · aliasing · conformance' },
  { key: 'hlfir',      label: 'HLFIR',      color: '#e3b341',
    icon: '🔷', role: 'array semantics as values · shape preserved' },
  { key: 'fir',        label: 'FIR',        color: '#3fb950',
    icon: '🔹', role: 'loops materialised · memory model applied' },
  { key: 'llvm_ir',    label: 'LLVM IR',    color: '#f85149',
    icon: '🔴', role: 'target instructions · vectoriser input' },
]

const ARROWS = [
  'semantic analysis',
  'HLFIR lowering',
  'FIR materialization',
  'LLVM lowering',
]

export default function TraceFlow({ constructId, sourceLine, onClose }) {
  const [trace, setTrace]   = useState(null)
  const [visible, setVisible] = useState([])
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!constructId || !sourceLine) return
    setTrace(null); setVisible([]); setError(null)

    fetch(`http://localhost:8001/api/trace/${constructId}/line/${sourceLine}`)
      .then(r => r.json())
      .then(d => {
        setTrace(d)
        // Stagger card appearances
        d.chain.forEach((_, i) => {
          setTimeout(() => setVisible(v => [...v, i]), i * 80)
        })
      })
      .catch(() => setError('Could not load trace'))
  }, [constructId, sourceLine])

  if (error) return <div style={s.error}>{error}</div>
  if (!trace) return <div style={s.loading}><Spinner/> Loading trace…</div>

  const { source_text, construct_type, lowering_notes, chain, metrics } = trace

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.lineLabel}>Line {sourceLine}</span>
          <code style={s.srcText}>{source_text.trim()}</code>
          <span style={s.ctBadge}>{construct_type}</span>
        </div>
        <div style={s.badges}>
          {metrics?.badges?.map(b => (
            <span key={b.id} style={{ ...s.badge, color: b.color,
              background: `${b.color}18`, border: `1px solid ${b.color}35` }}>
              {b.icon} {b.label}
            </span>
          ))}
        </div>
        <button style={s.closeBtn} onClick={onClose} title="Close trace">✕</button>
      </div>

      {/* Flow chain */}
      <div style={s.flow}>
        {chain.map((step, i) => {
          const meta = STAGES.find(st => st.key === step.stage) || STAGES[0]
          const isVisible = visible.includes(i)
          return (
            <React.Fragment key={step.stage}>
              <div style={{
                ...s.card,
                borderColor: meta.color + '55',
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
                transition: 'opacity .25s, transform .25s',
              }}>
                <div style={{ ...s.cardHeader, borderBottomColor: meta.color + '33' }}>
                  <span style={{ fontSize: 14 }}>{meta.icon}</span>
                  <span style={{ color: meta.color, fontWeight: 700,
                                  fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {meta.label}
                  </span>
                  <span style={s.linesTag}>{step.lines} lines</span>
                  <span style={{ color: '#484f58', fontSize: 9, marginLeft: 4 }}>
                    {meta.role}
                  </span>
                </div>
                <div style={s.opList}>
                  {step.ops.length > 0
                    ? step.ops.map(op => (
                        <code key={op} style={{ ...s.opChip,
                          color: meta.color,
                          background: `${meta.color}12`,
                          border: `1px solid ${meta.color}30` }}>
                          {op}
                        </code>
                      ))
                    : <span style={{ color: '#484f58', fontSize: 10 }}>
                        (no correlated ops for this line)
                      </span>
                  }
                </div>
              </div>

              {i < chain.length - 1 && (
                <div style={s.arrowRow}>
                  <div style={{ ...s.arrowLine, background: `linear-gradient(${meta.color}, ${STAGES[i+1]?.color || meta.color})` }} />
                  <span style={{ ...s.arrowLabel, color: meta.color }}>
                    {ARROWS[i]}
                  </span>
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Lowering notes */}
      {lowering_notes && (
        <div style={s.notes}>
          <div style={s.notesLabel}>Lowering explanation</div>
          <p style={s.notesText}>{lowering_notes}</p>
        </div>
      )}

      {/* Instruction mix */}
      {metrics?.mix && (
        <div style={s.mix}>
          <div style={s.notesLabel}>LLVM instruction mix</div>
          <div style={s.mixBars}>
            {Object.entries(metrics.mix).map(([k, v]) => (
              <div key={k} style={s.mixRow}>
                <span style={s.mixKey}>{k}</span>
                <div style={s.mixTrack}>
                  <div style={{
                    ...s.mixFill,
                    width: `${v}%`,
                    background: { memory:'#388bfd', compute:'#3fb950',
                                  control:'#e3b341', calls:'#f85149' }[k] || '#8b949e',
                  }} />
                </div>
                <span style={s.mixPct}>{v}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <span style={{ display:'inline-block', width:12, height:12, border:'2px solid #30363d',
                   borderTopColor:'#388bfd', borderRadius:'50%',
                   animation:'spin .6s linear infinite', marginRight:8 }}>
      <style>{`@keyframes spin { to { transform:rotate(360deg) }}`}</style>
    </span>
  )
}

const s = {
  wrap: { display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' },
  header: {
    display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
    padding:'8px 16px', background:'#1c2128',
    borderBottom:'1px solid #30363d', flexShrink:0,
  },
  headerLeft: { display:'flex', alignItems:'center', gap:8, flex:1, minWidth:0 },
  lineLabel: { fontSize:10, color:'#8b949e', flexShrink:0 },
  srcText: {
    fontFamily:'var(--font-mono)', fontSize:11, color:'#e6edf3',
    background:'#0d1117', padding:'2px 8px', borderRadius:4,
    flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  },
  ctBadge: {
    fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10,
    background:'rgba(56,139,253,.15)', color:'#388bfd',
    border:'1px solid rgba(56,139,253,.3)', textTransform:'uppercase',
    letterSpacing:'.4px', flexShrink:0,
  },
  badges: { display:'flex', gap:5, flexShrink:0, flexWrap:'wrap' },
  badge: { fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10 },
  closeBtn: {
    fontSize:14, color:'#8b949e', cursor:'pointer',
    background:'none', border:'none', padding:4, borderRadius:4, flexShrink:0,
  },
  flow: { flex:1, overflowY:'auto', padding:'12px 16px', display:'flex', flexDirection:'column' },
  card: {
    borderRadius:8, border:'1px solid',
    background:'#161b22', overflow:'hidden', marginBottom:0,
  },
  cardHeader: {
    display:'flex', alignItems:'center', gap:8,
    padding:'7px 12px', borderBottom:'1px solid', background:'#1c2128',
  },
  linesTag: { fontSize:9, color:'#484f58', marginLeft:'auto' },
  opList: {
    display:'flex', flexWrap:'wrap', gap:4, padding:'8px 12px', minHeight:32,
  },
  opChip: {
    fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:4,
    fontFamily:'var(--font-mono)',
  },
  arrowRow: {
    display:'flex', flexDirection:'column', alignItems:'center',
    margin:'4px 0', gap:2,
  },
  arrowLine: { width:2, height:20, opacity:.6 },
  arrowLabel: { fontSize:8, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', opacity:.7 },
  notes: {
    padding:'10px 16px', background:'#1c2128',
    borderTop:'1px solid rgba(188,140,255,.2)',
    flexShrink:0,
  },
  notesLabel: {
    fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px',
    color:'#8b949e', marginBottom:5,
  },
  notesText: { fontSize:11, color:'#e6edf3', lineHeight:1.7 },
  mix: {
    padding:'10px 16px', background:'#0d1117',
    borderTop:'1px solid #21262d', flexShrink:0,
  },
  mixBars: { display:'flex', flexDirection:'column', gap:4, marginTop:4 },
  mixRow: { display:'flex', alignItems:'center', gap:8 },
  mixKey: { fontSize:9, color:'#8b949e', minWidth:52, textTransform:'uppercase', letterSpacing:'.4px' },
  mixTrack: { flex:1, height:4, background:'#21262d', borderRadius:2, overflow:'hidden' },
  mixFill: { height:'100%', borderRadius:2, transition:'width .4s' },
  mixPct: { fontSize:9, color:'#8b949e', minWidth:28, textAlign:'right' },
  loading: { padding:24, textAlign:'center', color:'#8b949e', display:'flex', alignItems:'center', justifyContent:'center' },
  error: { padding:24, textAlign:'center', color:'#f85149', fontSize:12 },
}
