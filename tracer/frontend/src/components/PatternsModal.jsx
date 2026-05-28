import React, { useState, useEffect } from 'react'

const STAGE_ORDER = ['parse_tree','semantics','fir','hlfir','llvm_ir']
const STAGE_LABELS = { parse_tree:'Parse Tree', semantics:'Semantics',
                        fir:'FIR', hlfir:'HLFIR', llvm_ir:'LLVM IR' }
const STAGE_COLORS = { parse_tree:'var(--stage-parse)', semantics:'var(--stage-sem)',
                        fir:'var(--stage-fir)', hlfir:'var(--stage-hlfir)',
                        llvm_ir:'var(--stage-llvm)' }

export default function PatternsModal({ constructs, onClose, apiBase }) {
  const [patterns, setPatterns] = useState([])
  const [search, setSearch]     = useState('')

  useEffect(() => {
    fetch(`http://localhost:8001/api/patterns`)
      .then(r => r.json())
      .then(d => setPatterns(d.patterns || []))
      .catch(() => {})
  }, [apiBase])

  const filtered = patterns.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase()) ||
    p.construct_name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={s.title}>Lowering Patterns Reference</div>
            <div style={s.subtitle}>
              {patterns.length} patterns across {constructs.length} constructs — Flang developer reference
            </div>
          </div>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>

        <div style={s.search}>
          <input
            autoFocus
            style={s.searchInput}
            placeholder="Search patterns, constructs, ops…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span style={s.searchCount}>{filtered.length} results</span>
        </div>

        <div style={s.body}>
          {/* Pipeline stages legend */}
          <div style={s.stageLegend}>
            {STAGE_ORDER.map(k => (
              <span key={k} style={{ ...s.stageChip,
                color: STAGE_COLORS[k], background: `${STAGE_COLORS[k]}15`,
                border: `1px solid ${STAGE_COLORS[k]}35`
              }}>
                {STAGE_LABELS[k]}
              </span>
            ))}
            <span style={{ marginLeft:'auto', fontSize:10, color:'var(--text-muted)' }}>
              Fortran → Parse Tree → Semantics → FIR → HLFIR → LLVM IR
            </span>
          </div>

          {/* Patterns grid */}
          <div style={s.grid}>
            {filtered.map((p, i) => (
              <PatternCard key={i} pattern={p} />
            ))}
            {filtered.length === 0 && (
              <div style={s.noResults}>No matching patterns</div>
            )}
          </div>

          {/* Construct summaries */}
          <div style={s.section}>
            <div style={s.sectionTitle}>Construct Library</div>
            <div style={s.constructGrid}>
              {constructs.map(c => (
                <div key={c.id} style={s.constructCard}>
                  <div style={s.constructName}>{c.name}</div>
                  <div style={s.constructMeta}>
                    <span style={{ ...s.complexChip,
                      color: complexColor(c.complexity),
                      background: `${complexColor(c.complexity)}15`,
                      border: `1px solid ${complexColor(c.complexity)}30`
                    }}>
                      {c.complexity}
                    </span>
                    <span style={{ fontSize:10, color:'var(--text-muted)' }}>
                      {c.fortran_standard}
                    </span>
                  </div>
                  <div style={s.constructDesc}>{c.description}</div>
                  <div style={s.keyPatterns}>
                    {c.key_patterns?.slice(0,3).map(kp => (
                      <code key={kp} style={s.kpChip}>{kp}</code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PatternCard({ pattern }) {
  return (
    <div style={s.patternCard}>
      <div style={s.patternName}>{pattern.name}</div>
      <div style={s.patternDesc}>{pattern.description}</div>
      <div style={s.patternMeta}>
        <span style={s.constructLink}>{pattern.construct_name}</span>
      </div>
    </div>
  )
}

function complexColor(c) {
  return { LOW:'#3fb950', MEDIUM:'#e3b341', HIGH:'#d29922',
           VERY_HIGH:'#f85149', UNKNOWN:'#8b949e' }[c] || '#8b949e'
}

const s = {
  overlay: {
    position:'fixed', inset:0, background:'rgba(0,0,0,.7)',
    display:'flex', alignItems:'center', justifyContent:'center',
    zIndex:100, backdropFilter:'blur(4px)'
  },
  modal: {
    width:'min(900px,95vw)', height:'min(700px,90vh)',
    background:'var(--bg-surface)', borderRadius:12,
    border:'1px solid var(--border)', display:'flex',
    flexDirection:'column', overflow:'hidden',
    boxShadow:'var(--shadow)'
  },
  header: {
    display:'flex', alignItems:'flex-start', justifyContent:'space-between',
    padding:'20px 24px 16px', borderBottom:'1px solid var(--border)'
  },
  title: { fontSize:18, fontWeight:700, color:'var(--text-primary)', marginBottom:4 },
  subtitle: { fontSize:12, color:'var(--text-muted)' },
  close: {
    fontSize:16, color:'var(--text-secondary)', cursor:'pointer',
    padding:4, borderRadius:4, background:'none', border:'none',
    lineHeight:1
  },
  search: {
    display:'flex', alignItems:'center', gap:12, padding:'12px 24px',
    borderBottom:'1px solid var(--border)', background:'var(--bg-elevated)'
  },
  searchInput: {
    flex:1, padding:'7px 12px', borderRadius:6,
    background:'var(--bg-base)', border:'1px solid var(--border)',
    color:'var(--text-primary)', fontSize:13, outline:'none',
    fontFamily:'inherit'
  },
  searchCount: { fontSize:11, color:'var(--text-muted)', minWidth:80 },
  body: { flex:1, overflowY:'auto', padding:'16px 24px', display:'flex',
          flexDirection:'column', gap:16 },
  stageLegend: {
    display:'flex', gap:8, alignItems:'center', flexWrap:'wrap',
    padding:'10px 14px', background:'var(--bg-elevated)',
    borderRadius:8, border:'1px solid var(--border)'
  },
  stageChip: { fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:20 },
  grid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 },
  patternCard: {
    padding:'12px 14px', borderRadius:8,
    background:'var(--bg-elevated)', border:'1px solid var(--border)'
  },
  patternName: {
    fontSize:12, fontWeight:700, color:'var(--accent-yellow)',
    marginBottom:5, fontFamily:'var(--font-mono)'
  },
  patternDesc: { fontSize:11, color:'var(--text-secondary)', lineHeight:1.6, marginBottom:6 },
  patternMeta: { display:'flex', gap:6 },
  constructLink: {
    fontSize:9, fontWeight:600, padding:'1px 6px', borderRadius:8,
    background:'rgba(56,139,253,.12)', color:'var(--accent-blue)',
    border:'1px solid rgba(56,139,253,.25)'
  },
  noResults: { gridColumn:'1/-1', textAlign:'center', color:'var(--text-muted)',
               padding:24 },
  section: { marginTop:8 },
  sectionTitle: {
    fontSize:11, fontWeight:700, textTransform:'uppercase',
    letterSpacing:'.8px', color:'var(--text-secondary)', marginBottom:10
  },
  constructGrid: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 },
  constructCard: {
    padding:'12px', borderRadius:8,
    background:'var(--bg-elevated)', border:'1px solid var(--border)'
  },
  constructName: { fontSize:11, fontWeight:700, color:'var(--text-primary)', marginBottom:4 },
  constructMeta: { display:'flex', gap:6, alignItems:'center', marginBottom:4 },
  complexChip: {
    fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:10,
    textTransform:'uppercase', letterSpacing:'.4px'
  },
  constructDesc: { fontSize:10, color:'var(--text-secondary)', lineHeight:1.4, marginBottom:6 },
  keyPatterns: { display:'flex', flexWrap:'wrap', gap:3 },
  kpChip: {
    fontSize:9, padding:'1px 5px', borderRadius:4,
    background:'var(--bg-hover)', border:'1px solid var(--border)',
    color:'var(--accent-cyan)', fontFamily:'var(--font-mono)'
  }
}
