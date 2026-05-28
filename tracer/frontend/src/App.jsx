/**
 * fpc-trace — Root application component
 *
 * API_BASE: tries Vite proxy first (/api) then falls back to direct backend URL.
 * CORS is fully open on the backend so direct fetch always works.
 */
import React, { useState, useEffect, useCallback } from 'react'
import Header from './components/Header.jsx'
import Sidebar from './components/Sidebar.jsx'
import PipelineFlow from './components/PipelineFlow.jsx'
import SourceViewer from './components/SourceViewer.jsx'
import StagePanel from './components/StagePanel.jsx'
import AnalysisPanel from './components/AnalysisPanel.jsx'
import PatternsModal from './components/PatternsModal.jsx'
import SearchModal from './components/SearchModal.jsx'
import TraceFlow from './components/TraceFlow.jsx'
import CompareView from './components/CompareView.jsx'
import PatternAnalyzer from './components/PatternAnalyzer.jsx'

// Backend URL — direct (CORS is open) so the proxy isn't required
const API = 'http://localhost:8001'

async function apiFetch(path, opts) {
  const r = await fetch(API + path, opts)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

export default function App() {
  const [constructs, setConstructs]   = useState([])
  const [selected, setSelected]       = useState(null)
  const [pipeline, setPipeline]       = useState(null)
  const [activeStage, setActiveStage] = useState('hlfir')
  const [activeLine, setActiveLine]   = useState(null)
  const [analysis, setAnalysis]       = useState('')
  const [streaming, setStreaming]     = useState(false)
  const [health, setHealth]           = useState(null)
  const [loadingPipeline, setLoadingPipeline] = useState(false)
  const [bootLoading, setBootLoading] = useState(true)

  const [mode, setMode]               = useState('explore')
  const [showSearch, setShowSearch]   = useState(false)
  const [showPatterns, setShowPatterns] = useState(false)
  const [showTraceFlow, setShowTraceFlow] = useState(false)
  const [metrics, setMetrics]         = useState({})

  // ── boot: load all data on mount ──────────────────────────────────────────
  useEffect(() => {
    async function boot() {
      try {
        const [healthData, constructsData, metricsData] = await Promise.all([
          apiFetch('/api/health').catch(() => null),
          apiFetch('/api/constructs'),
          apiFetch('/api/metrics').catch(() => []),
        ])

        if (healthData) setHealth(healthData)

        if (Array.isArray(constructsData) && constructsData.length > 0) {
          setConstructs(constructsData)
          // Auto-load first construct
          loadPipeline(constructsData[0].id)
        }

        if (Array.isArray(metricsData)) {
          const m = {}
          metricsData.forEach(item => { m[item.construct_id] = item })
          setMetrics(m)
        }
      } catch (err) {
        console.error('Boot failed:', err)
      } finally {
        setBootLoading(false)
      }
    }
    boot()
  }, [])

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(s => !s) }
      if (e.key === 'Escape') { setShowSearch(false); setShowPatterns(false) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── load pipeline for a construct ─────────────────────────────────────────
  const loadPipeline = useCallback((id) => {
    setSelected(id)
    setActiveLine(null)
    setAnalysis('')
    setShowTraceFlow(false)
    setLoadingPipeline(true)
    apiFetch(`/api/constructs/${id}`)
      .then(data => { setPipeline(data); setLoadingPipeline(false) })
      .catch(() => setLoadingPipeline(false))
  }, [])

  const selectConstruct = useCallback((id) => {
    loadPipeline(id)
    setMode('explore')
  }, [loadPipeline])

  // ── line click ────────────────────────────────────────────────────────────
  const explain = useCallback((line, text) => {
    if (!pipeline) return
    setActiveLine(line)
    setAnalysis('')
    setShowTraceFlow(true)
    setStreaming(true)

    const corr = pipeline.correlations?.find(c => c.source_line === line)
    const stageOutputs = {}
    if (pipeline.stages) {
      Object.entries(pipeline.stages).forEach(([k, v]) => { stageOutputs[k] = v.content || '' })
    }

    fetch(`${API}/api/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        construct_id: pipeline.id,
        source_line: line,
        source_text: text,
        stage_outputs: stageOutputs,
        lowering_context: corr?.lowering_notes || ''
      })
    }).then(async (res) => {
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const l of lines) {
          if (!l.startsWith('data: ')) continue
          const raw = l.slice(6).trim()
          if (raw === '[DONE]') { setStreaming(false); return }
          try { const obj = JSON.parse(raw); if (obj.text) setAnalysis(a => a + obj.text) } catch {}
        }
      }
      setStreaming(false)
    }).catch(() => setStreaming(false))
  }, [pipeline])

  const activeCorrelation = activeLine != null
    ? pipeline?.correlations?.find(c => c.source_line === activeLine)
    : null

  const handleSearchNavigate = useCallback((constructId, stage) => {
    selectConstruct(constructId)
    if (stage) setActiveStage(stage)
    setMode('explore')
  }, [selectConstruct])

  // ── boot screen ───────────────────────────────────────────────────────────
  if (bootLoading) return <BootScreen />

  return (
    <div style={S.shell}>
      <Header
        health={health}
        mode={mode}
        onModeChange={setMode}
        onSearch={() => setShowSearch(true)}
        onPatternsClick={() => setShowPatterns(true)}
        constructCount={constructs.length}
      />

      <div style={S.body}>
        {mode !== 'analyze' && (
          <Sidebar
            constructs={constructs}
            selected={selected}
            onSelect={selectConstruct}
            metrics={metrics}
          />
        )}

        <main style={S.main}>
          {/* ── EXPLORE ── */}
          {mode === 'explore' && (
            pipeline ? (
              <>
                <PipelineFlow
                  stages={pipeline.stages}
                  activeStage={activeStage}
                  onStageClick={setActiveStage}
                  mode={pipeline.compilation_mode}
                />
                <div style={S.workspace}>
                  <div style={S.left}>
                    <SourceViewer
                      source={pipeline.source}
                      correlations={pipeline.correlations}
                      activeLine={activeLine}
                      onLineClick={explain}
                    />
                  </div>
                  <div style={S.right}>
                    {showTraceFlow && activeLine ? (
                      <TraceFlow
                        constructId={selected}
                        sourceLine={activeLine}
                        onClose={() => setShowTraceFlow(false)}
                      />
                    ) : (
                      <StagePanel
                        stages={pipeline.stages}
                        activeStage={activeStage}
                        onStageChange={setActiveStage}
                        activeLine={activeLine}
                        correlation={activeCorrelation}
                      />
                    )}
                  </div>
                </div>
                {!showTraceFlow && (
                  <AnalysisPanel
                    correlation={activeCorrelation}
                    analysis={analysis}
                    streaming={streaming}
                    pipeline={pipeline}
                  />
                )}
              </>
            ) : (
              <div style={S.empty}>
                {loadingPipeline ? <PipelineSpinner /> : <WelcomePanel onSearch={() => setShowSearch(true)} />}
              </div>
            )
          )}

          {/* ── COMPARE ── */}
          {mode === 'compare' && (
            <CompareView
              constructs={constructs}
              initialA={selected}
              initialB={constructs.find(c => c.id !== selected)?.id}
              onClose={() => setMode('explore')}
            />
          )}

          {/* ── ANALYZE ── */}
          {mode === 'analyze' && (
            <PatternAnalyzer
              constructs={constructs}
              onNavigate={id => { selectConstruct(id); setMode('explore') }}
            />
          )}
        </main>
      </div>

      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onNavigate={handleSearchNavigate}
        />
      )}
      {showPatterns && (
        <PatternsModal
          constructs={constructs}
          onClose={() => setShowPatterns(false)}
          apiBase={API}
        />
      )}
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────

function BootScreen() {
  return (
    <div style={{ ...S.shell, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)', fontWeight: 800 }}>
          ⬡ fpc-trace
        </div>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 13 }}>
          Flang Pipeline Construct Tracer
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          {['Parse Tree','Semantics','FIR','HLFIR','LLVM IR'].map((s, i) => (
            <React.Fragment key={s}>
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: ['var(--stage-parse)','var(--stage-sem)','var(--stage-fir)','var(--stage-hlfir)','var(--stage-llvm)'][i],
                opacity: 0.7, animation: `fadePulse 2s ease-in-out ${i*0.2}s infinite`,
              }}>{s}</span>
              {i < 4 && <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>→</span>}
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginTop: 28 }}>
          <Spinner size={28} />
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>
          Loading 10 construct traces…
        </div>
      </div>
      <style>{`
        @keyframes fadePulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}

function PipelineSpinner() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <Spinner size={28} />
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Loading pipeline trace…</span>
    </div>
  )
}

function Spinner({ size = 24 }) {
  return (
    <>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        border: `${size/10}px solid var(--border)`,
        borderTopColor: 'var(--accent-blue)',
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}

function WelcomePanel({ onSearch }) {
  return (
    <div style={{ textAlign: 'center', color: 'var(--text-muted)', maxWidth: 420 }}>
      <div style={{ fontSize: 42, marginBottom: 12 }}>🔬</div>
      <div style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
        Select a construct to trace
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 20 }}>
        Choose any of the 10 Fortran constructs from the sidebar to see the full lowering chain
        from Parse Tree through HLFIR, FIR, to LLVM IR.
      </div>
      <button
        onClick={onSearch}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 8,
          background: 'rgba(56,139,253,.12)', border: '1px solid rgba(56,139,253,.3)',
          color: 'var(--accent-blue)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
        }}
      >
        <span>🔍</span> Search all IR dumps
        <kbd style={{ padding: '1px 5px', borderRadius: 3, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 9, color: 'var(--text-muted)' }}>⌘K</kbd>
      </button>
    </div>
  )
}

const S = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' },
  body:  { display: 'flex', flex: 1, overflow: 'hidden' },
  main:  { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  workspace: { display: 'flex', flex: 1, overflow: 'hidden', gap: 1, background: 'var(--border-subtle)' },
  left:  { width: '38%', minWidth: 280, overflow: 'hidden', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' },
  right: { flex: 1, overflow: 'hidden', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' },
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' },
}
