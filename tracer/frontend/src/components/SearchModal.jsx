/**
 * SearchModal — Cmd+K global IR search across all 50 stage dumps.
 *
 * Groups results by construct, shows matching lines with syntax-coloured context.
 * Clicking a result navigates the app to that construct + stage.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'

const STAGE_COL = {
  parse_tree: '#bc8cff', semantics: '#388bfd',
  fir: '#3fb950', hlfir: '#e3b341', llvm_ir: '#f85149'
}
const STAGE_LABEL = {
  parse_tree: 'Parse Tree', semantics: 'Semantics',
  fir: 'FIR', hlfir: 'HLFIR', llvm_ir: 'LLVM IR'
}
const STAGES = ['parse_tree', 'semantics', 'fir', 'hlfir', 'llvm_ir']

const QUICK_SEARCHES = [
  { label: 'hlfir.elemental',         q: 'hlfir.elemental' },
  { label: 'unordered (DO CONCURRENT)', q: 'unordered' },
  { label: 'fir.dispatch (vtable)',    q: 'fir.dispatch' },
  { label: '_caf_get (coarray)',       q: '_caf_get' },
  { label: '_FortranAMatmul',          q: '_FortranAMatmul' },
  { label: 'arith.select (WHERE)',     q: 'arith.select' },
  { label: 'alloca (recursion)',       q: 'alloca' },
  { label: 'fir.field_index (struct)', q: 'fir.field_index' },
]

const API = 'http://localhost:8001'

export default function SearchModal({ onClose, onNavigate }) {
  const [query, setQuery]         = useState('')
  const [stageFilter, setStage]   = useState('')
  const [results, setResults]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [selected, setSelected]   = useState(0)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') setSelected(s => Math.min(s + 1, (results?.results?.length ?? 1) - 1))
      if (e.key === 'ArrowUp')   setSelected(s => Math.max(s - 1, 0))
      if (e.key === 'Enter' && results?.results?.[selected]) {
        navigate(results.results[selected])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [results, selected, onClose])

  const search = useCallback(async (q, stage) => {
    if (!q || q.length < 2) { setResults(null); return }
    setLoading(true)
    try {
      const url = `${API}/api/search?q=${encodeURIComponent(q)}&context=2` +
                  (stage ? `&stage=${stage}` : '')
      const r = await fetch(url)
      const d = await r.json()
      setResults(d)
      setSelected(0)
    } catch { setResults(null) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => search(query, stageFilter), 200)
    return () => clearTimeout(id)
  }, [query, stageFilter, search])

  const navigate = (result) => {
    onNavigate(result.construct_id, result.stage)
    onClose()
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        {/* Search bar */}
        <div style={s.searchRow}>
          <span style={s.searchIcon}>🔍</span>
          <input
            ref={inputRef}
            style={s.input}
            placeholder='Search IR ops, mnemonics, patterns… (e.g. "hlfir.elemental", "_caf_get")'
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
          />
          <div style={s.stageFilter}>
            {STAGES.map(st => (
              <button
                key={st}
                style={{
                  ...s.stageBtn,
                  background: stageFilter === st ? `${STAGE_COL[st]}25` : 'transparent',
                  color: stageFilter === st ? STAGE_COL[st] : '#8b949e',
                  border: `1px solid ${stageFilter === st ? STAGE_COL[st] : 'transparent'}`,
                }}
                onClick={() => setStage(prev => prev === st ? '' : st)}
              >
                {STAGE_LABEL[st]}
              </button>
            ))}
          </div>
          <kbd style={s.esc} onClick={onClose}>Esc</kbd>
        </div>

        {/* Quick searches (shown when empty) */}
        {!query && !results && (
          <div style={s.quickSection}>
            <div style={s.sectionLabel}>QUICK SEARCHES</div>
            <div style={s.quickGrid}>
              {QUICK_SEARCHES.map(qs => (
                <button key={qs.q} style={s.quickBtn}
                        onClick={() => setQuery(qs.q)}>
                  <code style={s.quickCode}>{qs.q}</code>
                  <span style={s.quickLabel}>{qs.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {loading && (
          <div style={s.status}>Searching 50 IR dumps…</div>
        )}

        {results && !loading && (
          <>
            <div style={s.statsBar}>
              <span style={{ color: '#3fb950', fontWeight: 700 }}>
                {results.total} match{results.total !== 1 ? 'es' : ''}
              </span>
              <span style={{ color: '#8b949e', marginLeft: 8 }}>
                across {results.unique_locations} location{results.unique_locations !== 1 ? 's' : ''}
              </span>
              {results.total === 0 && (
                <span style={{ color: '#484f58', marginLeft: 16 }}>
                  Try a shorter token or remove the stage filter
                </span>
              )}
            </div>

            <div style={s.resultsList} ref={listRef}>
              {results.results.map((r, i) => (
                <ResultCard
                  key={`${r.construct_id}-${r.stage}-${r.match_line}`}
                  result={r}
                  query={query}
                  isSelected={i === selected}
                  onHover={() => setSelected(i)}
                  onClick={() => navigate(r)}
                />
              ))}
            </div>
          </>
        )}

        <div style={s.footer}>
          <span><kbd style={s.kbdKey}>↑↓</kbd> navigate</span>
          <span><kbd style={s.kbdKey}>↵</kbd> open</span>
          <span><kbd style={s.kbdKey}>Esc</kbd> close</span>
          <span style={{ marginLeft: 'auto', color: '#484f58' }}>
            Searching across Parse Tree · Semantics · FIR · HLFIR · LLVM IR
          </span>
        </div>
      </div>
    </div>
  )
}

function ResultCard({ result, query, isSelected, onHover, onClick }) {
  const stageColor = STAGE_COL[result.stage] || '#888'

  function highlight(text) {
    if (!query) return text
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx < 0) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: '#e3b34144', color: '#e3b341', borderRadius: 2 }}>
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  return (
    <div
      style={{
        ...s.resultCard,
        background: isSelected ? 'rgba(56,139,253,.08)' : 'transparent',
        borderLeft: `3px solid ${isSelected ? stageColor : 'transparent'}`,
      }}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      <div style={s.resultHeader}>
        <span style={{ ...s.stagePill, color: stageColor, background: `${stageColor}18`,
                       border: `1px solid ${stageColor}35` }}>
          {STAGE_LABEL[result.stage]}
        </span>
        <span style={s.constructName}>{result.construct_name}</span>
        <span style={s.lineNum}>line {result.match_line}</span>
      </div>
      <div style={s.contextBlock}>
        {result.context.map((cl, i) => (
          <div key={i} style={{
            ...s.contextLine,
            background: cl.is_match ? 'rgba(227,179,65,.06)' : 'transparent',
          }}>
            <span style={s.ctxLineNo}>{cl.line_num}</span>
            <code style={{ ...s.ctxCode, fontWeight: cl.is_match ? 600 : 400 }}>
              {cl.is_match ? highlight(cl.text) : cl.text}
            </code>
          </div>
        ))}
      </div>
    </div>
  )
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    zIndex: 200, paddingTop: '8vh', backdropFilter: 'blur(4px)',
  },
  modal: {
    width: 'min(740px, 96vw)', maxHeight: '82vh',
    background: '#161b22', borderRadius: 12,
    border: '1px solid #30363d', display: 'flex',
    flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(0,0,0,.6)',
  },
  searchRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 16px', borderBottom: '1px solid #21262d',
  },
  searchIcon: { fontSize: 16, flexShrink: 0 },
  input: {
    flex: 1, background: 'none', border: 'none', outline: 'none',
    color: '#e6edf3', fontSize: 15, fontFamily: 'inherit',
    '::placeholder': { color: '#484f58' },
  },
  stageFilter: { display: 'flex', gap: 4, flexShrink: 0 },
  stageBtn: {
    padding: '2px 7px', borderRadius: 10, fontSize: 9,
    fontWeight: 700, cursor: 'pointer', transition: 'all .1s',
    fontFamily: 'var(--font-mono)',
  },
  esc: {
    padding: '2px 6px', borderRadius: 4, background: '#21262d',
    border: '1px solid #30363d', fontSize: 10, color: '#8b949e',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  quickSection: { padding: '12px 16px' },
  sectionLabel: {
    fontSize: 9, fontWeight: 700, letterSpacing: '.8px',
    color: '#484f58', marginBottom: 8, textTransform: 'uppercase',
  },
  quickGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  quickBtn: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
    borderRadius: 6, background: '#1c2128', border: '1px solid #30363d',
    cursor: 'pointer', textAlign: 'left', transition: 'background .1s',
  },
  quickCode: { fontSize: 11, color: '#3fb950', fontFamily: 'var(--font-mono)', flexShrink: 0 },
  quickLabel: { fontSize: 10, color: '#8b949e' },
  statsBar: {
    padding: '6px 16px', background: '#1c2128',
    borderBottom: '1px solid #21262d', fontSize: 11,
  },
  status: { padding: 24, textAlign: 'center', color: '#8b949e', fontSize: 12 },
  resultsList: { flex: 1, overflowY: 'auto' },
  resultCard: {
    padding: '8px 16px', cursor: 'pointer',
    borderLeft: '3px solid transparent', transition: 'all .1s',
    borderBottom: '1px solid #21262d',
  },
  resultHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 },
  stagePill: { fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10 },
  constructName: { fontSize: 12, fontWeight: 600, color: '#e6edf3', flex: 1 },
  lineNum: { fontSize: 10, color: '#484f58' },
  contextBlock: { background: '#0d1117', borderRadius: 6, overflow: 'hidden' },
  contextLine: { display: 'flex', gap: 8 },
  ctxLineNo: {
    minWidth: 32, textAlign: 'right', padding: '1px 8px',
    color: '#484f58', fontSize: 10, fontFamily: 'var(--font-mono)',
    flexShrink: 0, userSelect: 'none',
  },
  ctxCode: {
    fontSize: 10.5, fontFamily: 'var(--font-mono)',
    color: '#e6edf3', padding: '1px 0', flex: 1, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '8px 16px', borderTop: '1px solid #21262d',
    background: '#1c2128', fontSize: 10, color: '#8b949e',
  },
  kbdKey: {
    padding: '1px 5px', borderRadius: 4, background: '#21262d',
    border: '1px solid #30363d', fontSize: 9, color: '#8b949e',
  },
}
