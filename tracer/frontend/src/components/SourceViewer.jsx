import React, { useRef, useEffect } from 'react'

const CONSTRUCT_COLORS = {
  do_concurrent:       '#3fb950',
  array_assignment:    '#388bfd',
  where_block:         '#bc8cff',
  forall:              '#e3b341',
  matmul_intrinsic:    '#39c5cf',
  reduction_intrinsic: '#39c5cf',
  transpose_intrinsic: '#39c5cf',
  polymorphism:        '#d29922',
  select_type:         '#d29922',
  procedure_call:      '#8b949e',
  recursive_proc:      '#f85149',
  coarray_access:      '#ff7b72',
  do_loop:             '#3fb950',
  assignment:          '#388bfd',
  if_stmt:             '#bc8cff',
}

function highlightFortran(line) {
  const keywords = /\b(subroutine|function|end|do|if|then|else|endif|enddo|where|forall|concurrent|select|type|class|intent|implicit|none|real|integer|logical|complex|return|call|allocate|deallocate|print|recursive|pure|elemental|in|out|inout|contains|module|use|result|extends|procedure|interface|abstract)\b/gi
  const intrinsics = /\b(sqrt|matmul|transpose|sum|product|maxval|minval|merge|shape|size|reshape|spread|pack|unpack|any|all|count|this_image|num_images|sync)\b/gi
  const comments  = /(![^\n]*)/
  const strings   = /(['"][^'"]*['"])/g
  const numbers   = /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi
  const ops       = /([=<>+\-*/])/g

  const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

  if (line.trim().startsWith('!')) {
    return `<span style="color:#8b949e;font-style:italic">${esc(line)}</span>`
  }

  let out = esc(line)
  out = out.replace(/(!.*)$/, m => `<span style="color:#8b949e;font-style:italic">${m}</span>`)
  out = out.replace(/('&lt;.*?&gt;'|'[^']*'|"[^"]*")/g,
    m => `<span style="color:#a5d6ff">${m}</span>`)
  out = out.replace(new RegExp(intrinsics.source, 'gi'),
    m => `<span style="color:#39c5cf;font-weight:600">${m}</span>`)
  out = out.replace(new RegExp(keywords.source, 'gi'),
    m => `<span style="color:#ff7b72">${m}</span>`)
  out = out.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g,
    m => `<span style="color:#79c0ff">${m}</span>`)
  out = out.replace(/(%\w+)/g,
    m => `<span style="color:#d2a8ff">${m}</span>`)

  return out
}

export default function SourceViewer({ source, correlations, activeLine, onLineClick }) {
  const lineRef = useRef({})

  const lines  = (source || '').split('\n')
  const lineSet = new Set(correlations?.map(c => c.source_line) || [])
  const corrMap = {}
  for (const c of correlations || []) corrMap[c.source_line] = c

  useEffect(() => {
    if (activeLine != null && lineRef.current[activeLine]) {
      lineRef.current[activeLine].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeLine])

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.title}>Fortran Source</span>
        <span style={s.hint}>Click a highlighted line to trace it</span>
      </div>

      <div style={s.codeWrap}>
        <pre style={s.pre}>
          {lines.map((line, i) => {
            const lineNo = i + 1
            const hasCons = lineSet.has(lineNo)
            const corr    = corrMap[lineNo]
            const isActive = activeLine === lineNo
            const color   = corr ? (CONSTRUCT_COLORS[corr.construct_type] || '#388bfd') : null

            return (
              <div
                key={lineNo}
                ref={el => lineRef.current[lineNo] = el}
                style={{
                  ...s.lineRow,
                  background: isActive
                    ? `${color}20`
                    : hasCons ? `${color}08` : 'transparent',
                  borderLeft: isActive
                    ? `3px solid ${color}`
                    : hasCons ? `3px solid ${color}50` : '3px solid transparent',
                  cursor: hasCons ? 'pointer' : 'default',
                }}
                onClick={() => hasCons && onLineClick(lineNo, line)}
                title={corr ? `${corr.construct_type.replace(/_/g,' ')} — click to trace` : ''}
              >
                <span style={s.lineNo}>{lineNo}</span>
                {corr && (
                  <span style={{ ...s.constructBadge, background: `${color}25`, color }}>
                    {corr.construct_type.replace(/_/g,' ')}
                  </span>
                )}
                <span
                  style={s.lineText}
                  dangerouslySetInnerHTML={{ __html: highlightFortran(line) }}
                />
                {isActive && <span style={{ ...s.activePip, color }}>◀ active</span>}
              </div>
            )
          })}
        </pre>
      </div>

      {correlations && correlations.length > 0 && (
        <div style={s.legend}>
          {[...new Set(correlations.map(c => c.construct_type))].map(ct => (
            <span key={ct} style={{ ...s.legendItem,
              color: CONSTRUCT_COLORS[ct] || '#8b949e',
              background: `${CONSTRUCT_COLORS[ct] || '#8b949e'}15`,
              border: `1px solid ${CONSTRUCT_COLORS[ct] || '#8b949e'}30`
            }}>
              {ct.replace(/_/g,' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const s = {
  wrap: { display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' },
  header: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'8px 14px', borderBottom:'1px solid var(--border)',
    background:'var(--bg-elevated)', flexShrink:0
  },
  title: { fontSize:11, fontWeight:700, textTransform:'uppercase',
           letterSpacing:'.8px', color:'var(--text-secondary)' },
  hint: { fontSize:10, color:'var(--text-muted)' },
  codeWrap: { flex:1, overflow:'auto' },
  pre: {
    margin:0, padding:'8px 0', fontFamily:'var(--font-mono)',
    fontSize:12, lineHeight:'20px', tabSize:2
  },
  lineRow: {
    display:'flex', alignItems:'baseline', gap:8,
    paddingRight:12, transition:'background .1s',
    position:'relative', minHeight:20
  },
  lineNo: {
    minWidth:36, textAlign:'right', paddingRight:12,
    color:'var(--text-muted)', userSelect:'none', fontSize:11,
    flexShrink:0
  },
  constructBadge: {
    fontSize:8, fontWeight:700, padding:'1px 5px', borderRadius:8,
    textTransform:'uppercase', letterSpacing:'.4px', flexShrink:0,
    whiteSpace:'nowrap'
  },
  lineText: { flex:1, whiteSpace:'pre', overflow:'hidden' },
  activePip: { fontSize:9, fontWeight:700, flexShrink:0, opacity:.7 },
  legend: {
    display:'flex', flexWrap:'wrap', gap:4, padding:'8px 12px',
    borderTop:'1px solid var(--border)', background:'var(--bg-elevated)',
    flexShrink:0
  },
  legendItem: {
    fontSize:9, padding:'2px 7px', borderRadius:10,
    fontWeight:600, textTransform:'uppercase', letterSpacing:'.4px'
  }
}
