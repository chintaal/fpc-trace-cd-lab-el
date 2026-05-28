import React, { useRef, useEffect } from 'react'

const STAGE_COLOR = {
  parse_tree: 'var(--stage-parse)',
  fir:        'var(--stage-fir)',
  hlfir:      'var(--stage-hlfir)',
  llvm_ir:    'var(--stage-llvm)',
}

export default function AnalysisPanel({ correlation, analysis, streaming, pipeline }) {
  const textRef = useRef(null)

  useEffect(() => {
    if (textRef.current && streaming) {
      textRef.current.scrollTop = textRef.current.scrollHeight
    }
  }, [analysis, streaming])

  if (!correlation && !analysis) {
    const patterns = pipeline?.lowering_patterns || []
    const corrs = pipeline?.correlations || []
    return (
      <div style={s.panel}>
        <div style={s.header}>
          <span style={s.title}>Correlation &amp; Analysis</span>
          {pipeline && <span style={s.hint}>↑ click a highlighted source line to trace</span>}
          <span style={s.powered}>Claude · LLVM Systems Engineer</span>
        </div>
        <div style={s.idleContent}>
          {/* Correlation summary for this construct */}
          {corrs.length > 0 && (
            <div style={s.corrPreview}>
              <div style={s.corrPreviewLabel}>Correlated lines in this construct</div>
              <div style={s.corrRow}>
                {corrs.map(c => (
                  <div key={c.source_line} style={s.corrPill}>
                    <span style={s.corrLineNo}>L{c.source_line}</span>
                    <span style={s.corrType}>{c.construct_type.replace(/_/g,' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Lowering patterns preview */}
          {patterns.length > 0 && (
            <div style={s.patternsPreview}>
              <div style={s.corrPreviewLabel}>Lowering patterns in this construct</div>
              <div style={s.patternsList}>
                {patterns.map((p, i) => (
                  <div key={i} style={s.patternRow}>
                    <span style={s.patternBullet}>▸</span>
                    <div>
                      <div style={s.patternName}>{p.name}</div>
                      <div style={s.patternDesc}>{p.description.slice(0, 100)}{p.description.length > 100 ? '…' : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!pipeline && (
            <div style={s.empty}>
              <span style={{ fontSize: 24, marginBottom: 8, display: 'block' }}>🧠</span>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
                Click any highlighted line in the source viewer
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                AI will explain the lowering chain for that construct
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>AI Analysis</span>
        {streaming && (
          <span style={s.live}>
            <span style={s.dot} />
            Streaming…
          </span>
        )}
        <span style={s.powered}>Claude · LLVM Systems Engineer</span>
      </div>

      <div style={s.scroll}>
        {/* Correlation summary */}
        {correlation && (
          <div style={s.corrSection}>
            <div style={s.corrHeader}>
              <code style={s.srcLine}>{correlation.source_text?.trim()}</code>
              <span style={s.lineTag}>line {correlation.source_line}</span>
              <span style={{ ...s.ctTag }}>
                {correlation.construct_type?.replace(/_/g,' ')}
              </span>
            </div>

            <div style={s.stageGrid}>
              {[
                { key:'parse_tree', label:'Parse Tree', ops: correlation.parse_tree_nodes },
                { key:'fir',        label:'FIR',        ops: correlation.fir_ops },
                { key:'hlfir',      label:'HLFIR',      ops: correlation.hlfir_ops },
                { key:'llvm_ir',    label:'LLVM IR',    ops: correlation.llvm_ir_lines },
              ].map(({ key, label, ops }) => (
                <div key={key} style={s.stageBox}>
                  <div style={{ ...s.stageBoxLabel, color: STAGE_COLOR[key] }}>
                    {label}
                  </div>
                  <div style={s.opList}>
                    {ops?.length > 0 ? ops.map(op => (
                      <code key={op} style={{ ...s.opTag, color: STAGE_COLOR[key],
                        background: `${STAGE_COLOR[key]}12`,
                        border: `1px solid ${STAGE_COLOR[key]}30`
                      }}>
                        {op}
                      </code>
                    )) : (
                      <span style={{ fontSize:10, color:'var(--text-muted)' }}>—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lowering patterns */}
        {pipeline?.lowering_patterns?.length > 0 && (
          <div style={s.patternsSection}>
            <div style={s.sectionTitle}>Lowering Patterns</div>
            {pipeline.lowering_patterns.map((p, i) => (
              <div key={i} style={s.patternItem}>
                <div style={s.patternName}>{p.name}</div>
                <div style={s.patternDesc}>{p.description}</div>
              </div>
            ))}
          </div>
        )}

        {/* AI explanation */}
        {(analysis || streaming) && (
          <div style={s.aiSection}>
            <div style={s.sectionTitle}>
              <span style={{ color:'var(--accent-purple)' }}>◈</span> Lowering Explanation
            </div>
            <div
              ref={textRef}
              style={s.aiText}
            >
              {analysis || ''}
              {streaming && <span style={s.cursor}>▊</span>}
            </div>
          </div>
        )}

        {/* Static lowering notes */}
        {correlation?.lowering_notes && !analysis && !streaming && (
          <div style={s.aiSection}>
            <div style={s.sectionTitle}>Lowering Notes</div>
            <div style={s.aiText}>{correlation.lowering_notes}</div>
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  panel: {
    flexShrink: 0, height: 240,
    display:'flex', flexDirection:'column',
    background:'var(--bg-elevated)',
    borderTop:'1px solid var(--border)'
  },
  header: {
    display:'flex', alignItems:'center', gap:10,
    padding:'7px 16px', borderBottom:'1px solid var(--border)',
    flexShrink:0
  },
  title: { fontSize:11, fontWeight:700, textTransform:'uppercase',
           letterSpacing:'.8px', color:'var(--text-secondary)' },
  hint: { fontSize:10, color:'var(--accent-blue)', opacity:.7 },
  powered: { marginLeft:'auto', fontSize:10, color:'var(--text-muted)' },
  idleContent: { flex:1, overflowY:'auto', display:'flex', gap:0 },
  corrPreview: { flex:1, padding:'8px 14px', borderRight:'1px solid var(--border-subtle)', overflowY:'auto' },
  corrPreviewLabel: { fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', color:'var(--text-muted)', marginBottom:6 },
  corrRow: { display:'flex', flexWrap:'wrap', gap:5 },
  corrPill: { display:'flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:6, background:'var(--bg-surface)', border:'1px solid var(--border)' },
  corrLineNo: { fontSize:9, fontFamily:'var(--font-mono)', color:'var(--accent-blue)', fontWeight:700 },
  corrType: { fontSize:9, color:'var(--text-secondary)' },
  patternsPreview: { flex:1.5, padding:'8px 14px', overflowY:'auto' },
  patternsList: { display:'flex', flexDirection:'column', gap:6 },
  patternRow: { display:'flex', gap:7, alignItems:'flex-start' },
  patternBullet: { color:'var(--accent-yellow)', fontSize:10, flexShrink:0, marginTop:1 },
  patternName: { fontSize:10, fontWeight:700, color:'var(--accent-yellow)', marginBottom:2 },
  patternDesc: { fontSize:10, color:'var(--text-secondary)', lineHeight:1.5 },
  live: { display:'flex', alignItems:'center', gap:5, fontSize:10,
          color:'var(--accent-green)' },
  dot: {
    width:6, height:6, borderRadius:'50%', background:'var(--accent-green)',
    animation:'pulse 1s ease-in-out infinite',
  },
  scroll: { flex:1, overflowY:'auto', padding:'10px 16px', display:'flex',
            flexDirection:'column', gap:10 },
  empty: { flex:1, display:'flex', flexDirection:'column', alignItems:'center',
           justifyContent:'center', color:'var(--text-muted)', textAlign:'center',
           padding:20 },
  corrSection: {
    background:'var(--bg-surface)', borderRadius:8,
    border:'1px solid var(--border)', overflow:'hidden'
  },
  corrHeader: {
    display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
    padding:'8px 12px', borderBottom:'1px solid var(--border-subtle)',
    background:'var(--bg-elevated)'
  },
  srcLine: {
    flex:1, fontSize:11, color:'var(--text-primary)',
    fontFamily:'var(--font-mono)', background:'var(--bg-base)',
    padding:'2px 8px', borderRadius:4, minWidth:0, overflow:'hidden',
    textOverflow:'ellipsis', whiteSpace:'nowrap'
  },
  lineTag: { fontSize:10, color:'var(--text-muted)', flexShrink:0 },
  ctTag: { fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10,
           background:'rgba(56,139,253,.15)', color:'var(--accent-blue)',
           border:'1px solid rgba(56,139,253,.3)', textTransform:'uppercase',
           letterSpacing:'.4px', flexShrink:0 },
  stageGrid: {
    display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:0
  },
  stageBox: {
    padding:'8px 10px', borderRight:'1px solid var(--border-subtle)',
  },
  stageBoxLabel: {
    fontSize:9, fontWeight:700, textTransform:'uppercase',
    letterSpacing:'.6px', marginBottom:4
  },
  opList: { display:'flex', flexWrap:'wrap', gap:3 },
  opTag: {
    fontSize:9, padding:'1px 5px', borderRadius:4,
    fontFamily:'var(--font-mono)', fontWeight:600
  },
  patternsSection: {
    background:'var(--bg-surface)', borderRadius:8,
    border:'1px solid var(--border)', padding:'10px 12px'
  },
  sectionTitle: {
    fontSize:10, fontWeight:700, textTransform:'uppercase',
    letterSpacing:'.6px', color:'var(--text-secondary)', marginBottom:6
  },
  patternItem: { marginBottom:6 },
  patternName: { fontSize:11, fontWeight:700, color:'var(--accent-yellow)', marginBottom:2 },
  patternDesc: { fontSize:11, color:'var(--text-secondary)', lineHeight:1.5 },
  aiSection: {
    background:'var(--bg-surface)', borderRadius:8,
    border:'1px solid rgba(188,140,255,.2)', padding:'10px 12px'
  },
  aiText: {
    fontSize:12, color:'var(--text-primary)', lineHeight:1.7,
    fontFamily:'var(--font-sans)', whiteSpace:'pre-wrap',
    maxHeight:120, overflowY:'auto'
  },
  cursor: { color:'var(--accent-purple)', animation:'blink 0.8s step-end infinite' }
}
