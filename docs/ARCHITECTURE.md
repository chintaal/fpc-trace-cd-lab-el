# fpc-trace — Technical Architecture

*System design, data flows, and engineering decisions.*

---

## Table of Contents

- [System Overview](#system-overview)
- [Layer 1: Ingress Engine](#layer-1-ingress-engine)
- [Layer 2: Parsing + Correlation](#layer-2-parsing--correlation)
- [Layer 3: Presentation](#layer-3-presentation)
- [Data Model](#data-model)
- [Key Design Decisions](#key-design-decisions)
- [Adding a New Construct](#adding-a-new-construct)
- [Track B: In-Process Hooks](#track-b-in-process-hooks)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         fpc-trace System                                │
│                                                                         │
│  ┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌────────────┐ │
│  │ Fortran │    │    Ingress    │    │   Parsing   │    │Correlation │ │
│  │  Source ├───►│    Engine    ├───►│    Layer    ├───►│  Engine    │ │
│  │  .f90   │    │compiler_     │    │stage_parser │    │correlation │ │
│  │         │    │runner.py     │    │.py          │    │.py         │ │
│  └─────────┘    └──────────────┘    └─────────────┘    └─────┬──────┘ │
│                                                               │        │
│  ┌─────────────────────────────────────────────────────┐     │        │
│  │  pregenerated/*.json  (simulation mode)             │─────┘        │
│  │  10 pre-built PipelineResult objects                │              │
│  └─────────────────────────────────────────────────────┘              │
│                                                               │        │
│         ┌─────────────────┬───────────────────┬─────────────┘        │
│         ▼                 ▼                   ▼                        │
│    ┌─────────┐    ┌──────────────┐    ┌──────────────┐                │
│    │FastAPI  │    │ React UI     │    │ Claude API   │                │
│    │:8001    │    │ :5173        │    │ (optional)   │                │
│    │10 routes│    │3 modes       │    │SSE stream    │                │
│    └─────────┘    └──────────────┘    └──────────────┘                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Ingress Engine

**File:** `tracer/backend/engine/compiler_runner.py`

The ingress engine is the boundary between the tool and the Flang compiler. It uses subprocess invocations (Track A) to extract raw text dumps from each pipeline stage.

### Stage flags

| Stage | Flang flags | Output capture |
|-------|-------------|----------------|
| `parse_tree` | `-fdebug-dump-parse-tree -fsyntax-only -O0` | stderr |
| `semantics` | `-fdebug-dump-symbols -fsyntax-only -O0` | stderr |
| `hlfir` | `-emit-fir -S -mmlir --mlir-print-ir-after-all -O0 -g` | stderr |
| `fir` | `-emit-fir -S -mmlir --mlir-print-ir-before-all -O0 -g` | stderr |
| `llvm_ir` | `-emit-llvm -S -O0 -g` | output file |

All invocations use `-O0 -g` to:
- Prevent optimisations from removing debug location metadata
- Preserve `!DILocation` nodes for LLVM IR correlation
- Keep `#loc` attributes in FIR/HLFIR

### Execution model

```python
async def compile_all_stages(source_text, filename="input.f90"):
    # Writes source to a temp file
    # Runs 5 subprocess invocations in sequence
    # Returns {stage_name: CompileStageResult}
```

Each invocation runs with a 30-second timeout. The tool falls back to simulation mode (pregenerated JSON) if `FLANG_BINARY` is not found.

### Simulation mode

When no Flang binary is present, `main.py` bypasses the ingress engine and serves directly from `samples/pregenerated/*.json`. This allows the full demo experience without a Flang install.

---

## Layer 2: Parsing + Correlation

### Stage Parser

**File:** `tracer/backend/engine/stage_parser.py`

Each stage parser converts raw text output into a `ParsedStage` dataclass:

```python
@dataclass
class ParsedStage:
    content:    str                     # raw text (for display)
    key_ops:    list[str]               # dominant IR operations
    loc_map:    dict[str, list[int]]    # "file:line" → [ir_line_numbers]
    line_count: int
```

#### Parse Tree parser
- Scans for known node type names (`AssignmentStmt`, `DoConstruct`, `ConcurrentControl`, etc.)
- Extracts source refs from `"file.f90:line:col"` patterns

#### Semantics parser
- Extracts symbol table entries matching `TYPE` markers
- No `loc_map` (symbol table format varies per construct)

#### HLFIR parser
- Calls `_parse_mlir_stage` (shared with FIR)
- Selects the last "*** IR Dump ***" segment (captures final HLFIR form)

#### FIR parser
- Calls `_parse_mlir_stage`
- Selects the first dump (before HLFIR lowering passes run)

#### MLIR stage parser (shared)
Two-pass algorithm:

```
Pass 1: collect named-loc definitions
  #loc1 = loc("file.f90":9:3)
  → named_locs["1"] = "file.f90:9"

Pass 2: scan each line
  For each line:
    Extract key ops via _FIR_KEY_OPS regex
    Map inline #loc("file.f90":9:3) to line number
    Map named loc references loc(#loc1) via named_locs lookup
```

#### LLVM IR parser
- Builds `!N → DILocation(line, col)` map from `!DILocation` nodes
- Scans each instruction for `!dbg !N` references
- Maps `input.f90:line` → LLVM IR line numbers

### Correlation Engine

**File:** `tracer/backend/engine/correlation.py`

Takes the five `ParsedStage` objects and the source text; returns a list of `SourceCorrelation` objects.

```
For each source line:
  1. Strip whitespace, skip blank/comment lines
  2. Classify construct type via _CONSTRUCT_PATTERNS regex list
  3. Build loc keys: "filename:lineno" and "input.f90:lineno"
  4. Call _ops_at(stage, key) for each stage
  5. Look up stage.loc_map[key] → IR line numbers
  6. Extract actual op names from content at those line numbers
  7. Return SourceCorrelation with op names (not line numbers)
```

#### `_ops_at` implementation

The critical function — returns real IR op names, not raw line numbers:

```python
def _ops_at(stage, *keys):
    for key in keys:
        ir_lines = stage.loc_map.get(key, [])
        if not ir_lines:
            continue
        content_lines = stage.content.splitlines()
        found = []
        for ln in ir_lines[:12]:
            ops = _extract_ops(content_lines[ln - 1])
            found.extend(ops)
        if found:
            return found[:8]
    return stage.key_ops[:6]  # fallback
```

`_extract_ops` uses three regex patterns covering MLIR ops (`hlfir.*`, `fir.*`), LLVM keywords (`load`, `store`, `getelementptr`), and Parse Tree node names.

---

## Layer 3: Presentation

### FastAPI Backend

**File:** `tracer/backend/main.py`

10 REST endpoints serving:
1. `GET /api/health` — status + mode
2. `GET /api/constructs` — summaries
3. `GET /api/constructs/{id}` — full `PipelineResult`
4. `GET /api/patterns` — lowering patterns
5. `GET /api/search?q=` — full-text search across all 50 IR dumps
6. `GET /api/compare/{a}/{b}?stage=` — side-by-side with diff + unique ops
7. `GET /api/metrics/{id}` — LLVM IR performance analysis + badges
8. `GET /api/metrics` — all constructs' metrics
9. `GET /api/trace/{id}/line/{n}` — vertical lowering chain for one source line
10. `POST /api/pattern-analyze` — detect constructs in arbitrary Fortran source
11. `POST /api/explain` — SSE stream AI or cached lowering notes
12. `POST /api/analyze` — live compile (requires `FLANG_BINARY`)

### React Frontend

**File structure:**

```
src/
├── App.jsx              Root: state, mode routing, keyboard shortcuts
├── index.css            CSS variables, typography, scrollbar theme
└── components/
    ├── Header.jsx        Brand, pipeline bar, Explore/Compare/Analyze switcher
    ├── Sidebar.jsx       Construct library with perf badges
    ├── PipelineFlow.jsx  Stage selector bar
    ├── SourceViewer.jsx  Fortran syntax highlight + line click handlers
    ├── StagePanel.jsx    IR viewer with syntax highlight + correlation bar
    ├── AnalysisPanel.jsx Bottom panel: correlation table + lowering notes
    ├── TraceFlow.jsx     Vertical animated lowering chain (on line click)
    ├── SearchModal.jsx   ⌘K global search across 50 IR dumps
    ├── CompareView.jsx   Side-by-side construct diff
    ├── PatternAnalyzer.jsx Live Fortran editor with detection
    └── PatternsModal.jsx  Lowering patterns reference
```

**API routing:** All `fetch` calls use relative URLs (`/api/...`). Vite dev server proxies these to `:8001`. Production build outputs to `tracer/backend/static/` which FastAPI serves as static files.

```javascript
// vite.config.js
server: { proxy: { '/api': 'http://localhost:8001' } }
```

### Claude LLM Layer

**File:** `tracer/backend/llm/analyst.py`

Optional layer, activated when `ANTHROPIC_API_KEY` is set.

```
Client (browser)
    │  POST /api/explain
    ▼
FastAPI SSE endpoint
    │  stream_analysis(req: ExplainRequest)
    ▼
anthropic.AsyncAnthropic.messages.stream(
    model="claude-sonnet-4-6",
    system=SYSTEM_PROMPT,   ← LLVM Systems Engineer persona
    messages=[{role:"user", content: build_analysis_prompt(...)}]
)
    │  yields text chunks
    ▼
Client receives: data: {"text": "chunk..."}\n\n
```

The system prompt establishes Claude as an LLVM Systems Engineer with deep Flang knowledge, instructed to explain WHY decisions were made — not just WHAT is visible.

---

## Data Model

All data is typed via Pydantic v2 models in `tracer/backend/models/schemas.py`.

```
PipelineResult
├── id, name, description, category, complexity, fortran_standard
├── source: str                         ← Fortran source text
├── stages: dict[str, StageOutput]      ← one per stage
│   └── StageOutput
│       ├── stage, content, line_count
│       ├── key_ops: list[str]          ← dominant IR ops
│       └── loc_map: dict[str, list[int]]
├── correlations: list[SourceCorrelation]
│   └── SourceCorrelation
│       ├── source_line, source_col, source_text
│       ├── construct_type
│       ├── parse_tree_nodes: list[str]
│       ├── fir_ops: list[str]
│       ├── hlfir_ops: list[str]
│       ├── llvm_ir_lines: list[str]
│       └── lowering_notes: str
├── lowering_patterns: list[dict]
└── compilation_mode: "simulation" | "real"
```

The JSON Schema in `schemas/correlated_construct.schema.json` formally documents this structure (Draft-07), suitable for validation in CI or external tooling.

---

## Key Design Decisions

### 1. Simulation-first architecture

Pre-generated JSON ships with the repository so the tool runs without a Flang install. Live compilation is additive — when `FLANG_BINARY` is available, real traces replace simulated ones. This separates the demo experience from the compiler dependency.

### 2. `_ops_at` returns op names, not line numbers

Early versions returned raw IR line numbers from `loc_map`. This was changed to extract actual op names (`hlfir.elemental`, `fir.do_loop`) from the content at those lines. The UI now shows semantically meaningful information rather than `["16", "17", "18"]`.

### 3. Named-loc definition parsing

Flang's MLIR output uses both inline (`#loc("file":line:col)`) and named (`#loc1 = loc("file":line:col)` + `loc(#loc1)`) location formats. The parser handles both, building a `named_locs` dictionary in the first pass for reference in the second.

### 4. Vite dev proxy — `API = ''` always

The frontend uses empty string as API base, relying on Vite's `/api` proxy to the backend. This avoids the class of bugs where a hardcoded port (e.g., `:8000`) silently fails if the backend moves. The Vite proxy config (`vite.config.js`) is the single source of truth for the port.

### 5. Fallback on `lowering_notes`

All `SourceCorrelation` objects carry a `lowering_notes` string derived from `_LOWERING_NOTES` in `correlation.py`. The SSE `/api/explain` endpoint returns this as its fallback when no Claude API key is configured. Zero degradation in content quality for offline/unauthenticated use.

---

## Adding a New Construct

1. Write the `.f90` sample in `tracer/backend/samples/`

2. Create the pregenerated JSON in `tracer/backend/samples/pregenerated/`:
   ```json
   {
     "id": "11_new_construct",
     "name": "...",
     "category": "array_operations|concurrency|...",
     "complexity": "LOW|MEDIUM|HIGH|VERY_HIGH",
     "fortran_standard": "F90|F95|F2003|F2008|F2018",
     "source": "...",
     "stages": { "parse_tree": {...}, "semantics": {...}, "fir": {...}, "hlfir": {...}, "llvm_ir": {...} },
     "correlations": [...],
     "lowering_patterns": [...]
   }
   ```
   Validate against `schemas/correlated_construct.schema.json`.

3. Or, with flang-new installed:
   ```bash
   # Collect dumps
   ./scripts/collect_pipeline_dumps.sh tracer/backend/samples/11_new_construct.f90
   # Regenerate the JSON
   FLANG_BINARY=flang-new python3 scripts/regenerate_pregenerated.py --construct 11_new_construct
   ```

4. Run tests: `pytest tests/` — the `TestPregenerated` class auto-discovers new JSON files.

---

## Track B: In-Process Hooks

See [`TRACK_B_HOOKS.md`](TRACK_B_HOOKS.md) for the full design.

Track A (current) uses subprocess invocations. Track B would register `mlir::PassInstrumentation` callbacks inside a modified `llvm-project/flang`, capturing IR at each MLIR pass boundary with exact `FileLineColLoc` source attribution — no text parsing required.

Track A is correct for the assignment scope. Track B is documented for production-grade Flang tooling.
