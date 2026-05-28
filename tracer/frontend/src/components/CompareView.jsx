/**
 * CompareView — side-by-side construct comparison at any pipeline stage.
 *
 * Shows two constructs' IR content with unique ops highlighted on each side
 * and a visual diff of what changes between them.
 */
import React, { useState, useEffect } from 'react'

const STAGES = ['parse_tree','semantics','fir','hlfir','llvm_ir']
const STAGE_LABEL = { parse_tree:'Parse Tree', semantics:'Semantics',
                       fir:'FIR', hlfir:'HLFIR', llvm_ir:'LLVM IR' }
const STAGE_COL = { parse_tree:'#bc8cff', semantics:'#388bfd',
                     fir:'#3fb950', hlfir:'#e3b341', llvm_ir:'#f85149' }

function highlightIR(text, stage, uniqueOps) {
  if (!text) return ''
  const esc = t => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  let out = esc(text)

  if (stage === 'hlfir' || stage === 'fir') {
    out = out.replace(/(hlfir\.\w+)/g, m =>
      uniqueOps.includes(m)
        ? `<mark style="background:rgba(227,179,65,.25);border-radius:2px">${m}</mark>`
        : `<span style="color:#e3b341;font-weight:700">${m}</span>`)
    out = out.replace(/(fir\.\w+)/g, m =>
      uniqueOps.includes(m)
        ? `<mark style="background:rgba(63,185,80,.25);border-radius:2px">${m}</mark>`
        : `<span style="color:#3fb950;font-weight:700">${m}</span>`)
    out = out.replace(/(arith\.\w+|math\.\w+)/g, m => `<span style="color:#39c5cf">${m}</span>`)
    out = out.replace(/(\/\/[^\n]*)/g, m => `<span style="color:#8b949e;font-style:italic">${m}</span>`)
  } else if (stage === 'llvm_ir') {
    const kw = 'load|store|getelementptr|fadd|fmul|call|br|ret|alloca|phi|select|icmp|fcmp'
    out = out.replace(new RegExp(`\\b(${kw})\\b`, 'g'), m =>
      uniqueOps.includes(m)
        ? `<mark style="background:rgba(248,81,73,.25);border-radius:2px">${m}</mark>`
        : `<span style="color:#f85149;font-weight:600">${m}</span>`)
    out = out.replace(/(;[^\n]*)/g, m => `<span style="color:#8b949e;font-style:italic">${m}</span>`)
  }
  return out
}

export default function CompareView({ constructs, initialA, initialB, onClose }) {
  const [idA, setIdA]     = useState(initialA || constructs[0]?.id || '')
  const [idB, setIdB]     = useState(initialB || constructs[1]?.id || '')
  const [stage, setStage] = useState('hlfir')
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!idA || !idB || idA === idB) { setData(null); return }
    setLoading(true)
    fetch(`http://localhost:8001/api/compare/${idA}/${idB}?stage=${stage}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [idA, idB, stage])

  return (
    <div style={s.wrap}>
      {/* Controls bar */}
      <div style={s.controls}>
        <span style={s.controlLabel}>Compare</span>

        <select style={s.sel} value={idA} onChange={e => setIdA(e.target.value)}>
          {constructs.map(c => (
            <option key={c.id} value={c.id}>{c.id.replace(/_/g,' ')}: {c.name}</option>
          ))}
        </select>

        <span style={{ color:'#8b949e', fontWeight:700, fontSize:12 }}>vs</span>

        <select style={s.sel} value={idB} onChange={e => setIdB(e.target.value)}>
          {constructs.map(c => (
            <option key={c.id} value={c.id}>{c.id.replace(/_/g,' ')}: {c.name}</option>
          ))}
        </select>

        <span style={s.controlLabel}>at stage</span>
        <div style={s.stageTabs}>
          {STAGES.map(st => (
            <button key={st}
              style={{ ...s.stageTab,
                color: stage === st ? STAGE_COL[st] : '#8b949e',
                borderBottom: stage === st ? `2px solid ${STAGE_COL[st]}` : '2px solid transparent',
                background: stage === st ? `${STAGE_COL[st]}0d` : 'transparent',
              }}
              onClick={() => setStage(st)}>
              {STAGE_LABEL[st]}
            </button>
          ))}
        </div>
        <button style={s.closeBtn} onClick={onClose}>✕ Close</button>
      </div>

      {/* Diff stats */}
      {data && !loading && (
        <div style={s.statsBar}>
          <span style={{ color:'#3fb950' }}>
            +{data.diff_stats.added} lines added
          </span>
          <span style={{ color:'#f85149', marginLeft:12 }}>
            −{data.diff_stats.removed} lines removed
          </span>
          <span style={{ color:'#8b949e', marginLeft:16 }}>
            Ops only in A: {data.ops_only_in_a.length || 'none'}
          </span>
          <span style={{ color:'#8b949e', marginLeft:12 }}>
            Ops only in B: {data.ops_only_in_b.length || 'none'}
          </span>
          <span style={{ color:'#484f58', marginLeft:12 }}>
            Shared: {data.ops_shared.length}
          </span>
        </div>
      )}

      {/* Side by side panels */}
      <div style={s.panels}>
        {loading && (
          <div style={s.loadingMsg}>Comparing…</div>
        )}

        {!loading && !data && (
          <div style={s.emptyMsg}>
            {idA === idB
              ? 'Select two different constructs to compare'
              : 'Select two constructs to see side-by-side comparison'}
          </div>
        )}

        {!loading && data && (
          <>
            <SidePanel
              side="A"
              data={data.a}
              stage={stage}
              uniqueOps={data.ops_only_in_a}
              accentColor="#388bfd"
            />
            <div style={s.divider} />
            <SidePanel
              side="B"
              data={data.b}
              stage={stage}
              uniqueOps={data.ops_only_in_b}
              accentColor="#e3b341"
            />
          </>
        )}
      </div>
    </div>
  )
}

function SidePanel({ side, data, stage, uniqueOps, accentColor }) {
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>
      {/* Panel header */}
      <div style={{ ...s.panelHeader, borderBottom:`2px solid ${accentColor}` }}>
        <span style={{ ...s.sideLabel, color: accentColor }}>{side}</span>
        <span style={s.panelName}>{data.name}</span>
        <span style={s.panelLines}>{data.line_count} lines</span>
      </div>

      {/* Unique ops */}
      {uniqueOps.length > 0 && (
        <div style={s.uniqueOps}>
          <span style={{ fontSize:9, color:'#8b949e', marginRight:6 }}>
            Unique to {side}:
          </span>
          {uniqueOps.map(op => (
            <code key={op} style={{ ...s.uniqueOp, color: accentColor,
              background: `${accentColor}18`, border: `1px solid ${accentColor}35` }}>
              {op}
            </code>
          ))}
        </div>
      )}

      {/* IR content */}
      <div style={s.irScroll}>
        <pre style={s.ir}
          dangerouslySetInnerHTML={{
            __html: highlightIR(data.content, stage, uniqueOps)
          }} />
      </div>
    </div>
  )
}

const s = {
  wrap: { display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'#0d1117' },
  controls: {
    display:'flex', alignItems:'center', gap:10, padding:'8px 16px',
    background:'#161b22', borderBottom:'1px solid #30363d',
    flexShrink:0, flexWrap:'wrap',
  },
  controlLabel: { fontSize:10, color:'#8b949e', whiteSpace:'nowrap' },
  sel: {
    padding:'4px 8px', background:'#1c2128', border:'1px solid #30363d',
    color:'#e6edf3', borderRadius:6, fontSize:11, cursor:'pointer',
    maxWidth:220, fontFamily:'inherit',
  },
  stageTabs: { display:'flex', gap:2 },
  stageTab: {
    padding:'4px 10px', fontSize:10, fontWeight:700, cursor:'pointer',
    fontFamily:'var(--font-mono)', border:'none', borderBottom:'2px solid transparent',
    transition:'all .1s',
  },
  closeBtn: {
    marginLeft:'auto', padding:'4px 10px', borderRadius:6,
    background:'#21262d', border:'1px solid #30363d',
    color:'#8b949e', fontSize:11, cursor:'pointer',
  },
  statsBar: {
    padding:'5px 16px', background:'#1c2128',
    borderBottom:'1px solid #21262d', fontSize:11,
  },
  panels: {
    flex:1, display:'flex', overflow:'hidden',
  },
  loadingMsg: { flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#8b949e' },
  emptyMsg: {
    flex:1, display:'flex', alignItems:'center', justifyContent:'center',
    color:'#484f58', fontSize:13,
  },
  divider: { width:2, background:'#21262d', flexShrink:0 },
  panelHeader: {
    display:'flex', alignItems:'center', gap:8, padding:'7px 14px',
    background:'#1c2128', flexShrink:0,
  },
  sideLabel: { fontSize:12, fontWeight:900, minWidth:16 },
  panelName: { fontSize:12, fontWeight:700, color:'#e6edf3', flex:1 },
  panelLines: { fontSize:10, color:'#484f58' },
  uniqueOps: {
    display:'flex', alignItems:'center', flexWrap:'wrap', gap:4,
    padding:'5px 14px', background:'rgba(56,139,253,.04)',
    borderBottom:'1px solid #21262d', flexShrink:0,
  },
  uniqueOp: { fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:4, fontFamily:'var(--font-mono)' },
  irScroll: { flex:1, overflow:'auto' },
  ir: {
    margin:0, padding:'10px 14px',
    fontFamily:'var(--font-mono)', fontSize:11, lineHeight:'17px',
    color:'#e6edf3', tabSize:2, whiteSpace:'pre',
  },
}
