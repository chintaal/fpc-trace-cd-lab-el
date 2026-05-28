import React, { useRef, useEffect } from 'react'

const STAGES = [
  { key: 'parse_tree', label: 'Parse Tree', color: 'var(--stage-parse)' },
  { key: 'semantics',  label: 'Semantics',  color: 'var(--stage-sem)'   },
  { key: 'fir',        label: 'FIR',        color: 'var(--stage-fir)'   },
  { key: 'hlfir',      label: 'HLFIR',      color: 'var(--stage-hlfir)' },
  { key: 'llvm_ir',    label: 'LLVM IR',    color: 'var(--stage-llvm)'  },
]

function highlightIR(text, stageKey) {
  if (!text) return ''
  const esc = s => s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

  const raw = esc(text)

  if (stageKey === 'parse_tree') {
    return raw
      .replace(/(SubroutineSubprogram|FunctionSubprogram|ExecutionPart|SpecificationPart)/g,
        m => `<span style="color:#ff7b72;font-weight:600">${m}</span>`)
      .replace(/(\b(?:AssignmentStmt|DoConstruct|ConcurrentControl|WhereConstruct|ForallConstruct|SelectTypeConstruct|IfConstruct)\b)/g,
        m => `<span style="color:#d2a8ff;font-weight:600">${m}</span>`)
      .replace(/(Name\s*=\s*'[^']*')/g,
        m => `<span style="color:#79c0ff">${m}</span>`)
      .replace(/([|])/g, m => `<span style="color:#30363d">${m}</span>`)
  }

  if (stageKey === 'semantics') {
    return raw
      .replace(/(rank=\d+|REAL\(\d+\)|INTEGER\(\d+\)|LOGICAL\(\d+\))/g,
        m => `<span style="color:#79c0ff">${m}</span>`)
      .replace(/(intent\w+|IntentIn|IntentOut|IntentInout)/gi,
        m => `<span style="color:#3fb950">${m}</span>`)
      .replace(/(shape=.*)/g,
        m => `<span style="color:#e3b341">${m}</span>`)
  }

  // FIR / HLFIR
  if (stageKey === 'fir' || stageKey === 'hlfir') {
    return raw
      .replace(/(\/\/.*)/g, m => `<span style="color:#8b949e;font-style:italic">${m}</span>`)
      .replace(/(hlfir\.\w+)/g, m => `<span style="color:#e3b341;font-weight:700">${m}</span>`)
      .replace(/(fir\.\w+)/g, m => `<span style="color:#3fb950;font-weight:700">${m}</span>`)
      .replace(/(omp\.\w+)/g, m => `<span style="color:#d29922;font-weight:700">${m}</span>`)
      .replace(/(arith\.\w+|math\.\w+)/g, m => `<span style="color:#39c5cf">${m}</span>`)
      .replace(/(func\.func\b)/g, m => `<span style="color:#ff7b72;font-weight:600">${m}</span>`)
      .replace(/(!fir\.[^,\s)>]+)/g, m => `<span style="color:#bc8cff">${m}</span>`)
      .replace(/(!hlfir\.[^,\s)>]+)/g, m => `<span style="color:#e3b341">${m}</span>`)
      .replace(/(#loc\d*\s*=.*)/g, m => `<span style="color:#484f58">${m}</span>`)
      .replace(/(%[a-zA-Z_]\w*)/g, m => `<span style="color:#a5d6ff">${m}</span>`)
  }

  // LLVM IR
  if (stageKey === 'llvm_ir') {
    return raw
      .replace(/(;.*)/g, m => `<span style="color:#8b949e;font-style:italic">${m}</span>`)
      .replace(/\b(define|declare|call|ret|br|load|store|getelementptr|alloca|phi|select|icmp|fcmp|sext|zext|trunc|bitcast|ptrtoint|inttoptr|fadd|fsub|fmul|fdiv|add|sub|mul|or|and|xor|lshr|ashr|shl|extractelement|insertelement|tail|musttail)\b/g,
        m => `<span style="color:#f85149;font-weight:600">${m}</span>`)
      .replace(/\b(i1|i8|i16|i32|i64|i128|f32|f64|ptr|void)\b/g,
        m => `<span style="color:#79c0ff">${m}</span>`)
      .replace(/(@[a-zA-Z_][a-zA-Z0-9_$]*)/g,
        m => `<span style="color:#d2a8ff">${m}</span>`)
      .replace(/(![a-zA-Z0-9_]+)/g,
        m => `<span style="color:#484f58">${m}</span>`)
      .replace(/(%[a-zA-Z_][a-zA-Z0-9_.]*)/g,
        m => `<span style="color:#a5d6ff">${m}</span>`)
      .replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g,
        m => `<span style="color:#79c0ff">${m}</span>`)
  }

  return raw
}

export default function StagePanel({ stages, activeStage, onStageChange, activeLine, correlation }) {
  const codeRef = useRef(null)
  const stage = stages?.[activeStage]
  const stageInfo = STAGES.find(s => s.key === activeStage) || STAGES[0]

  // Highlight matching ops in correlation
  const highlightedOps = correlation
    ? (activeStage === 'parse_tree' ? correlation.parse_tree_nodes
      : activeStage === 'fir'       ? correlation.fir_ops
      : activeStage === 'hlfir'     ? correlation.hlfir_ops
      : activeStage === 'llvm_ir'   ? correlation.llvm_ir_lines
      : []) || []
    : []

  return (
    <div style={s.wrap}>
      {/* Tabs */}
      <div style={s.tabs}>
        {STAGES.map(st => (
          <button
            key={st.key}
            style={{
              ...s.tab,
              color: activeStage === st.key ? st.color : 'var(--text-secondary)',
              borderBottom: activeStage === st.key
                ? `2px solid ${st.color}` : '2px solid transparent',
              background: activeStage === st.key ? `${st.color}0d` : 'transparent'
            }}
            onClick={() => onStageChange(st.key)}
          >
            {st.label}
          </button>
        ))}
      </div>

      {/* Stage info bar */}
      <div style={s.infoBar}>
        <span style={{ ...s.stageTag, color: stageInfo.color,
          background: `${stageInfo.color}18`, border: `1px solid ${stageInfo.color}40` }}>
          {stageInfo.label}
        </span>
        {stage && (
          <>
            <span style={s.meta}>{stage.line_count} lines</span>
            {stage.key_ops?.length > 0 && (
              <span style={s.meta}>
                {stage.key_ops.slice(0,4).map(op => (
                  <code key={op} style={s.opChip}>{op}</code>
                ))}
                {stage.key_ops.length > 4 && (
                  <span style={{ color:'var(--text-muted)' }}>+{stage.key_ops.length-4}</span>
                )}
              </span>
            )}
          </>
        )}
      </div>

      {/* Correlation highlight bar */}
      {activeLine && highlightedOps.length > 0 && (
        <div style={s.corrBar}>
          <span style={{ fontSize:10, color:'var(--text-muted)', marginRight:6 }}>
            Line {activeLine} →
          </span>
          {highlightedOps.map(op => (
            <code key={op} style={{ ...s.corrOp, color: stageInfo.color,
              background: `${stageInfo.color}18`,
              border: `1px solid ${stageInfo.color}35`
            }}>
              {op}
            </code>
          ))}
        </div>
      )}

      {/* Code content */}
      <div style={s.codeWrap} ref={codeRef}>
        {stage ? (
          <pre
            style={s.pre}
            dangerouslySetInnerHTML={{
              __html: highlightIR(stage.content, activeStage)
            }}
          />
        ) : (
          <div style={s.noData}>No data for this stage</div>
        )}
      </div>
    </div>
  )
}

const s = {
  wrap: { display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' },
  tabs: {
    display:'flex', borderBottom:'1px solid var(--border)',
    background:'var(--bg-elevated)', flexShrink:0, overflowX:'auto'
  },
  tab: {
    padding:'8px 14px', fontSize:11, fontWeight:700,
    cursor:'pointer', whiteSpace:'nowrap', transition:'all .15s',
    fontFamily:'var(--font-mono)'
  },
  infoBar: {
    display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
    padding:'6px 12px', background:'var(--bg-elevated)',
    borderBottom:'1px solid var(--border-subtle)', flexShrink:0
  },
  stageTag: { fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10 },
  meta: { display:'flex', alignItems:'center', gap:4, fontSize:10,
          color:'var(--text-secondary)' },
  opChip: {
    fontSize:9, padding:'1px 5px', borderRadius:4,
    background:'var(--bg-hover)', border:'1px solid var(--border)',
    color:'var(--text-secondary)'
  },
  corrBar: {
    display:'flex', alignItems:'center', flexWrap:'wrap', gap:4,
    padding:'5px 12px', background:'rgba(56,139,253,.07)',
    borderBottom:'1px solid rgba(56,139,253,.2)', flexShrink:0
  },
  corrOp: {
    fontSize:9, padding:'2px 6px', borderRadius:4,
    fontWeight:700, fontFamily:'var(--font-mono)'
  },
  codeWrap: { flex:1, overflow:'auto' },
  pre: {
    margin:0, padding:'10px 16px',
    fontFamily:'var(--font-mono)', fontSize:11.5, lineHeight:'18px',
    tabSize:2, whiteSpace:'pre', color:'var(--text-primary)'
  },
  noData: {
    padding:24, color:'var(--text-muted)',
    textAlign:'center', fontFamily:'var(--font-mono)'
  }
}
