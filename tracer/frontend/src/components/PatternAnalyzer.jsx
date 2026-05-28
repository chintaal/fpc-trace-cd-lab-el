/**
 * PatternAnalyzer — live Fortran editor with instant construct detection.
 *
 * Type or paste any Fortran source; the tool identifies constructs line-by-line,
 * matches each against the best pre-generated trace, and previews the predicted
 * lowering chain — without needing a real Flang install.
 */
import React, { useState, useCallback, useRef } from 'react'

const STAGE_COL = { parse_tree:'#bc8cff', hlfir:'#e3b341', fir:'#3fb950', llvm_ir:'#f85149' }

const FORTRAN_KEYWORDS = /\b(subroutine|function|end|do|if|then|else|endif|enddo|where|forall|concurrent|select|type|class|intent|implicit|none|real|integer|logical|complex|return|call|allocate|deallocate|recursive|pure|elemental|in|out|inout|contains|module|use|result|extends|procedure|interface|abstract)\b/gi
const FORTRAN_INTRINSICS = /\b(sqrt|matmul|transpose|sum|product|maxval|minval|merge|shape|size|reshape|spread|this_image|num_images|sync)\b/gi
const FORTRAN_NUMBERS  = /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi

function syntaxHighlight(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/(![^\n]*)/g, '<span style="color:#8b949e;font-style:italic">$1</span>')
    .replace(new RegExp(FORTRAN_INTRINSICS.source,'gi'), '<span style="color:#39c5cf;font-weight:600">$1</span>')
    .replace(new RegExp(FORTRAN_KEYWORDS.source,'gi'), '<span style="color:#ff7b72">$1</span>')
    .replace(new RegExp(FORTRAN_NUMBERS.source,'g'), '<span style="color:#79c0ff">$1</span>')
}

const SAMPLE_PROGRAMS = [
  {
    label: 'DO CONCURRENT + MATMUL',
    code: `subroutine demo(a, b, c, n)
  implicit none
  integer, intent(in)  :: n
  real, intent(in)     :: b(n), c(n)
  real, intent(out)    :: a(n)
  real                 :: mat_a(n,n), mat_b(n,n), mat_c(n,n)
  integer :: i

  ! DO CONCURRENT: independence guarantee
  DO CONCURRENT (i = 1:n)
    a(i) = b(i) * c(i)
  END DO

  ! MATMUL: runtime library call
  mat_c = MATMUL(mat_a, mat_b)

end subroutine demo`
  },
  {
    label: 'WHERE + Polymorphism',
    code: `subroutine masked_dispatch(s, values, n)
  class(Shape), intent(in) :: s
  real, intent(inout)      :: values(n)
  integer, intent(in)      :: n

  ! WHERE: branchless mask
  WHERE (values > 0.0)
    values = SQRT(values)
  ELSEWHERE
    values = 0.0
  END WHERE

  ! Virtual dispatch through vtable
  print *, s%area()

end subroutine masked_dispatch`
  },
  {
    label: 'Coarray halo exchange',
    code: `subroutine halo(a, n)
  implicit none
  integer, intent(in) :: n
  real, intent(inout) :: a(n)[*]
  integer :: me
  me = THIS_IMAGE()

  ! Remote read: _caf_get runtime call
  if (me > 1) then
    a(1) = a(n)[me - 1]
  end if

  SYNC ALL

end subroutine halo`
  },
]

export default function PatternAnalyzer({ constructs, onNavigate }) {
  const [source, setSource] = useState(SAMPLE_PROGRAMS[0].code)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)

  const analyze = useCallback(async (src) => {
    if (!src.trim()) { setResult(null); return }
    setLoading(true)
    try {
      const r = await fetch('http://localhost:8001/api/pattern-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src }),
      })
      setResult(await r.json())
    } catch { setResult(null) }
    finally { setLoading(false) }
  }, [])

  const onInput = (val) => {
    setSource(val)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => analyze(val), 400)
  }

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.title}>Live Pattern Analyzer</span>
        <span style={s.subtitle}>
          Paste any Fortran — detect constructs and preview their lowering path instantly
        </span>
        <div style={s.samples}>
          {SAMPLE_PROGRAMS.map(p => (
            <button key={p.label} style={s.sampleBtn}
                    onClick={() => { setSource(p.code); analyze(p.code) }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={s.body}>
        {/* Editor pane */}
        <div style={s.editorPane}>
          <div style={s.editorLabel}>
            Fortran Source
            {loading && <span style={s.analyzing}> ⏳ analyzing…</span>}
            {result && !loading && (
              <span style={{ color:'#3fb950', marginLeft:8, fontSize:10 }}>
                ✓ {result.unique_constructs} construct{result.unique_constructs !== 1 ? 's' : ''} detected
              </span>
            )}
          </div>
          <div style={s.editorWrap}>
            <textarea
              style={s.textarea}
              value={source}
              onChange={e => onInput(e.target.value)}
              spellCheck={false}
              wrap="off"
            />
            {/* Overlay with line numbers and highlights */}
            <div style={s.lineNums} aria-hidden>
              {source.split('\n').map((_, i) => (
                <span key={i} style={{
                  ...s.lineNum,
                  color: result?.detections?.some(d => d.line === i+1) ? '#388bfd' : '#484f58'
                }}>
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Results pane */}
        <div style={s.resultsPane}>
          {result && result.detections.length > 0 ? (
            <>
              <div style={s.resultsLabel}>
                Detected constructs — {result.source_lines} lines analysed
              </div>
              <div style={s.detectionList}>
                {result.detections.map((det, i) => (
                  <DetectionCard
                    key={i}
                    detection={det}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </>
          ) : result && result.detections.length === 0 ? (
            <div style={s.noDetections}>
              <div style={{ fontSize:24, marginBottom:8 }}>🤔</div>
              <div>No constructs detected yet.</div>
              <div style={{ color:'#484f58', fontSize:11, marginTop:4 }}>
                Add loops, array ops, or procedure calls.
              </div>
            </div>
          ) : (
            <div style={s.placeholder}>
              <div style={{ fontSize:32, marginBottom:12 }}>⚡</div>
              <div style={{ fontWeight:700, marginBottom:6 }}>Live Pattern Detection</div>
              <div style={{ color:'#8b949e', fontSize:11, lineHeight:1.7 }}>
                Type Fortran on the left. Constructs are identified in real-time
                and matched to the closest pre-generated trace in the library.
              </div>
              <div style={{ color:'#484f58', fontSize:10, marginTop:12 }}>
                Try: DO CONCURRENT · WHERE · MATMUL · CLASS() · a[:][*]
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetectionCard({ detection, onNavigate }) {
  const match = detection.best_match
  const STAGE_STAGES = ['parse_tree','hlfir','fir','llvm_ir']
  const LOWERING_ICONS = {
    do_concurrent: ['DoConstruct', 'hlfir.elemental (unordered)', 'fir.do_loop unordered', 'phi + fmul (SIMD)'],
    array_assignment: ['AssignmentStmt', 'hlfir.elemental', 'fir.do_loop', 'phi + GEP + fadd'],
    where_block: ['WhereConstruct', 'hlfir.elemental (masked)', 'fir.if branch', 'fcmp + select'],
    matmul_intrinsic: ['FunctionReference', 'hlfir.matmul', 'fir.call @_FortranAMatmul', 'call @_FortranAMatmul'],
    polymorphism: ['FunctionReference', 'fir.dispatch', 'fir.dispatch', 'call %fptr (indirect)'],
    coarray_access: ['ImageSelector', 'hlfir.declare [coarray]', 'fir.call @_caf_get', 'call @_caf_get'],
    forall: ['ForallConstruct', 'hlfir.elemental (2-D)', 'fir.do_loop × 2', 'phi(i) + phi(j) + GEP'],
    recursive_proc: ['FunctionSubprogram', 'hlfir.declare (result)', 'fir.alloca + fir.call', 'alloca + call (no TCO)'],
  }

  const steps = LOWERING_ICONS[detection.construct_type] || ['→', '→', '→', '→']

  return (
    <div style={s.detCard}>
      <div style={s.detHeader}>
        <span style={s.detLine}>line {detection.line}</span>
        <code style={s.detCode}>{detection.text.trim()}</code>
        <span style={s.detType}>{detection.construct_type.replace(/_/g,' ')}</span>
      </div>

      {/* Mini lowering chain */}
      <div style={s.miniChain}>
        {STAGE_STAGES.map((stage, i) => (
          <React.Fragment key={stage}>
            <div style={{ ...s.miniStage, borderColor: `${STAGE_COL[stage]}40` }}>
              <span style={{ ...s.miniStageLabel, color: STAGE_COL[stage] }}>
                {stage === 'parse_tree' ? 'PT' : stage.toUpperCase()}
              </span>
              <code style={{ fontSize:9, color:'#e6edf3', fontFamily:'var(--font-mono)',
                             overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {steps[i]}
              </code>
            </div>
            {i < STAGE_STAGES.length - 1 && (
              <span style={{ color:`${STAGE_COL[stage]}80`, fontSize:8 }}>→</span>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Lowering note preview */}
      {detection.lowering_note && (
        <div style={s.detNote}>
          {detection.lowering_note.slice(0, 140)}
          {detection.lowering_note.length > 140 ? '…' : ''}
        </div>
      )}

      {match && (
        <div style={s.detMatch}>
          <span style={{ color:'#8b949e', fontSize:9 }}>Best match in library →</span>
          <button style={s.matchBtn} onClick={() => onNavigate(match.id)}>
            🔬 {match.name}
          </button>
        </div>
      )}
    </div>
  )
}

const s = {
  wrap: { display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' },
  header: {
    padding:'10px 16px', background:'#1c2128', borderBottom:'1px solid #30363d',
    flexShrink:0, display:'flex', flexDirection:'column', gap:6,
  },
  title: { fontSize:13, fontWeight:700, color:'#e6edf3' },
  subtitle: { fontSize:10, color:'#8b949e' },
  samples: { display:'flex', gap:6, flexWrap:'wrap' },
  sampleBtn: {
    padding:'3px 10px', borderRadius:6, fontSize:10, cursor:'pointer',
    background:'#21262d', border:'1px solid #30363d', color:'#8b949e',
    transition:'border-color .1s',
  },
  body: { flex:1, display:'flex', overflow:'hidden' },
  editorPane: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', borderRight:'1px solid #21262d' },
  editorLabel: { padding:'6px 14px', background:'#161b22', fontSize:10, color:'#8b949e', borderBottom:'1px solid #21262d', flexShrink:0 },
  analyzing: { color:'#e3b341', marginLeft:8 },
  editorWrap: { flex:1, display:'flex', overflow:'auto', position:'relative' },
  lineNums: {
    display:'flex', flexDirection:'column', padding:'8px 4px 8px 8px',
    background:'#161b22', flexShrink:0, userSelect:'none',
  },
  lineNum: { fontSize:11, fontFamily:'var(--font-mono)', lineHeight:'19px', textAlign:'right', minWidth:24 },
  textarea: {
    flex:1, padding:'8px 12px', resize:'none', background:'#161b22',
    border:'none', outline:'none', color:'#e6edf3',
    fontFamily:'var(--font-mono)', fontSize:11.5, lineHeight:'19px',
    tabSize:2, whiteSpace:'pre',
  },
  resultsPane: { width:'38%', minWidth:280, display:'flex', flexDirection:'column', overflow:'hidden' },
  resultsLabel: { padding:'6px 14px', background:'#161b22', fontSize:10, color:'#8b949e', borderBottom:'1px solid #21262d', flexShrink:0 },
  detectionList: { flex:1, overflowY:'auto', padding:'8px' },
  noDetections: { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#8b949e', textAlign:'center', padding:24, fontSize:12 },
  placeholder: { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#8b949e', textAlign:'center', padding:24 },
  detCard: {
    background:'#161b22', border:'1px solid #30363d', borderRadius:8,
    marginBottom:8, overflow:'hidden',
  },
  detHeader: {
    display:'flex', alignItems:'center', gap:6, padding:'7px 10px',
    background:'#1c2128', flexWrap:'wrap',
  },
  detLine: { fontSize:9, color:'#484f58', flexShrink:0 },
  detCode: {
    fontFamily:'var(--font-mono)', fontSize:10, color:'#e6edf3', flex:1,
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  },
  detType: {
    fontSize:8, fontWeight:700, padding:'1px 5px', borderRadius:8,
    background:'rgba(56,139,253,.15)', color:'#388bfd', border:'1px solid rgba(56,139,253,.3)',
    textTransform:'uppercase', letterSpacing:'.4px', flexShrink:0,
  },
  miniChain: { display:'flex', alignItems:'center', gap:4, padding:'6px 10px', overflow:'hidden' },
  miniStage: {
    display:'flex', flexDirection:'column', gap:2, padding:'4px 6px',
    border:'1px solid', borderRadius:4, minWidth:0, flex:1,
  },
  miniStageLabel: { fontSize:8, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px' },
  detNote: { padding:'6px 10px', fontSize:10, color:'#8b949e', lineHeight:1.6, borderTop:'1px solid #21262d' },
  detMatch: {
    display:'flex', alignItems:'center', gap:8, padding:'5px 10px',
    borderTop:'1px solid #21262d', background:'#0d1117',
  },
  matchBtn: {
    fontSize:10, padding:'2px 8px', borderRadius:6, cursor:'pointer',
    background:'rgba(56,139,253,.12)', border:'1px solid rgba(56,139,253,.3)',
    color:'#388bfd', fontWeight:600,
  },
}
