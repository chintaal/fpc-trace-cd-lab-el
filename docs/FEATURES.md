# fpc-trace Feature Guide

*Complete walkthrough of every capability — with demo choreography for HPE evaluators.*

---

## Table of Contents

- [Explore Mode](#-explore-mode)
- [Compare Mode](#-compare-mode)
- [Analyze Mode](#-analyze-mode)
- [Global IR Search](#-global-ir-search-k)
- [Performance Intelligence](#-performance-intelligence)
- [AI Analysis](#-ai-analysis)
- [CLI](#-cli-tool)
- [API](#-rest-api)
- [HPE Demo Script](#-hpe-demo-script)

---

## 🔬 Explore Mode

The default mode. Browse all 10 pre-traced Fortran constructs from the left sidebar.

### Sidebar
- Constructs are grouped by category: **Array Ops**, **Concurrency**, **Data Structures**, **Polymorphism**, **Distributed (CAF)**, **Intrinsics**, **Procedures**
- Each card shows: complexity (`MEDIUM` / `HIGH` / `VERY_HIGH`), Fortran standard, description
- **Performance intelligence badges** appear on each card — small emoji icons indicating the construct's runtime characteristics (see [Performance Intelligence](#-performance-intelligence))
- Filter by name or category using the search box at the top

### Source Viewer
- Fortran source displayed with syntax highlighting
- Lines with detected constructs are highlighted with a coloured left border and a construct-type tag
- **Click any highlighted line** to activate the vertical Trace Flow

### Pipeline Flow Bar
- Shows all five stages with line counts
- Click any stage button to switch the right panel to that stage's IR content
- Active stage is highlighted with the stage's colour

### Stage Panel (right side)
- Syntax-highlighted IR content:
  - **Parse Tree**: node names in purple
  - **HLFIR**: `hlfir.*` ops in amber, `fir.*` ops in green, `arith.*` in cyan
  - **FIR**: same colour scheme as HLFIR
  - **LLVM IR**: keywords (`load`, `store`, `call`) in red, globals in purple, registers in blue
- When a source line is active, a **Correlation Bar** appears showing which ops on this stage map to that line
- Key ops extracted from the stage content are shown as chips below the stage header

### Trace Flow (when a line is clicked)
The right panel switches to a vertical lowering chain:

```
Line 8: DO CONCURRENT (i = 1:n)          ← source text
  ⚡ SIMD eligible  🔀 OpenMP parallel   ← performance badges

  🌳 Parse Tree         Parse Tree (36 lines)
     DoConstruct · ConcurrentControl · ConcurrentHeader
              ↓  semantic analysis
  🔍 Semantics          Semantics (15 lines)
     a · b · scale
              ↓  HLFIR lowering
  🔷 HLFIR              HLFIR (40 lines)
     hlfir.elemental unordered · hlfir.apply · hlfir.yield_element
              ↓  FIR materialization
  🔹 FIR                FIR (42 lines)
     fir.do_loop unordered · fir.array_load · fir.array_fetch
              ↓  LLVM lowering
  🔴 LLVM IR            LLVM IR (52 lines)
     phi · getelementptr · load · fmul · store
```

Each card fades in with a 80ms stagger. Below the chain:
- **Lowering explanation** (from `lowering_notes` in the JSON, or streamed from Claude if API key set)
- **LLVM instruction mix bar**: memory / compute / control / calls percentages

---

## ⟷ Compare Mode

Click **Compare** in the header mode switcher to enter side-by-side comparison.

### Controls
- **Left selector**: pick construct A (default: currently selected)
- **vs**
- **Right selector**: pick construct B
- **Stage tabs**: choose which pipeline stage to compare

### Diff Stats Bar
Shows at a glance: `+21 lines added  −35 lines removed  Ops only in A: 2  Ops only in B: 1  Shared: 5`

### Side Panels
Each side shows:
- Construct name with accent colour
- Line count
- **Unique ops** — operations that appear in this construct but not the other, highlighted inline in the IR text
- Full syntax-highlighted IR content

### Demo use case: DO CONCURRENT vs DO loop

1. Select `02_do_concurrent` as A
2. Select `01_array_assignment` as B (closest plain-array equivalent)
3. Switch to **HLFIR** stage
4. See: A has `hlfir.elemental (unordered)`, B has `hlfir.elemental` (no unordered)
5. Switch to **FIR** stage
6. See: A has `fir.do_loop unordered`, B does not
7. Read the ops-only-in-A list: `['hlfir.elemental unordered', 'arith.mulf']`

This shows exactly what the `DO CONCURRENT` independence guarantee adds: one MLIR attribute that survives all passes to LLVM and enables auto-vectorisation.

---

## ⚡ Analyze Mode

Click **Analyze** in the header to open the live Fortran editor.

### Editor
- Syntax-highlighted textarea (Fortran keywords, intrinsics, numbers coloured)
- Line numbers with blue highlighting on detected lines
- Three sample programs pre-loaded: "DO CONCURRENT + MATMUL", "WHERE + Polymorphism", "Coarray halo exchange"

### Detection Results (right panel)
As you type (400ms debounce), each detected construct shows:
- Source line and text
- Construct type badge
- **Mini lowering chain** — four-stage miniature showing predicted ops at Parse Tree, HLFIR, FIR, LLVM IR
- Lowering note preview
- **"Best match in library"** button — click to navigate to the closest pre-generated trace

### What it detects

| Fortran construct | Detected type |
|-------------------|---------------|
| `DO CONCURRENT` | `do_concurrent` |
| `DO` loop | `do_loop` |
| `WHERE` / `ELSEWHERE` | `where_block` |
| `FORALL` | `forall` |
| `CLASS(T)` | `polymorphism` |
| `SELECT TYPE` | `select_type` |
| `a(n)[img]` or `a[*]` | `coarray_access` |
| `MATMUL(...)` | `matmul_intrinsic` |
| `SUM` / `MAXVAL` / `PRODUCT` | `reduction_intrinsic` |
| `RECURSIVE FUNCTION` | `recursive_proc` |
| `CALL xxx(...)` | `procedure_call` |
| `a = b + c` (array expression) | `array_assignment` |
| `IF (...)` | `if_stmt` |

---

## 🔍 Global IR Search `⌘K`

Press `⌘K` (macOS) or `Ctrl+K` (Linux/Windows) anywhere in the app to open the search modal.

### Search behaviour
- Searches all **50 IR dumps** (10 constructs × 5 stages) simultaneously
- Returns matches with 2 lines of context above and below
- Results deduplicated: one entry per (construct, stage) pair
- Results show: stage colour badge, construct name, line number, highlighted match

### Stage filter
Toggle stage buttons (`Parse Tree`, `Semantics`, `FIR`, `HLFIR`, `LLVM IR`) to restrict search to one level.

### Quick searches
The empty state shows 8 pre-configured search buttons for the most useful queries:
- `hlfir.elemental` — find all array operations using the elemental model
- `unordered` — find all DO CONCURRENT and FORALL constructs
- `fir.dispatch` — find all virtual dispatch sites (polymorphism)
- `_caf_get` — find all coarray remote reads
- `_FortranAMatmul` — find all MATMUL runtime ABI calls
- `arith.select` — find all WHERE branchless masks
- `alloca` — find all stack-frame allocations (recursion)
- `fir.field_index` — find all struct field navigations

### Keyboard navigation
- `↑` / `↓` — navigate results
- `↵` — jump to construct + stage
- `Esc` — close

---

## 📊 Performance Intelligence

Every construct is automatically profiled when the app loads (`GET /api/metrics`).

### Badges

| Icon | Badge | Meaning |
|------|-------|---------|
| ⚡ | SIMD eligible | `unordered` attribute present in FIR/HLFIR → LLVM vectoriser can apply SIMD |
| 🔀 | OpenMP parallel | `omp.parallel` / `omp.wsloop` emitted (with `-fopenmp`) |
| 🔗 | Virtual dispatch | `fir.dispatch` in FIR or indirect `call %fptr` in LLVM IR |
| 📦 | Heap allocated | `@_FortranAMatmul`, `@_FortranACopy`, or `@_FortranAAllocatableAllocate` present |
| 🌐 | CAF distributed | `@_caf_get`, `@_caf_put`, or `@_caf_sync_all` present |
| 🔄 | Recursive / alloca | `RECURSIVE` keyword + `alloca` in LLVM IR (no TCO) |
| 📚 | Runtime library | `@_FortranA*` calls without heap allocation |
| 🚧 | Sync barrier | `@_caf_sync_all` present (cross-image synchronisation) |
| 📐 | Scalar / inline | No special patterns detected |

### LLVM Metrics (from `/api/metrics/{id}`)

```json
{
  "metrics": {
    "loads": 9,       "stores": 4,
    "calls": 8,       "fp_ops": 6,
    "gep": 5,         "phi_nodes": 2,
    "branches": 5,    "alloca": 0,
    "intrinsics": 2,  "runtime_calls": 3,
    "indirect_calls": 2
  },
  "mix": {
    "memory": 42,   "compute": 18,
    "control": 12,  "calls": 28
  }
}
```

---

## 🤖 AI Analysis

When `ANTHROPIC_API_KEY` is set, clicking a highlighted source line streams a real-time technical explanation from Claude (`claude-sonnet-4-6`).

### Prompt engineering
Claude is given the persona of an **LLVM Systems Engineer** with deep Flang expertise. The system prompt instructs it to:
- Write in dense technical prose (no bullet padding)
- Use MLIR dialect notation verbatim (`hlfir.elemental`, `fir.do_loop`)
- Cite specific line patterns from the IR excerpts
- Explain **WHY** the compiler chose this representation
- Cover exactly 4 paragraphs: one per stage transition
- Never summarise what the user can already see

### Without API key
Pre-generated `lowering_notes` from the JSON traces are shown instead. These cover the same content and are available for all 10 constructs. No degradation in functionality — just no real-time streaming.

---

## 📟 CLI Tool

```
tracer/cli.py — Flang Pipeline Construct Tracer
```

### Output formats

**Text (default)** — coloured terminal output:
```bash
python3 tracer/cli.py 02_do_concurrent
```
Shows: pipeline summary bar, source with construct markers, each stage with key ops and truncated content, correlations, lowering patterns.

**JSON** — full machine-readable trace:
```bash
python3 tracer/cli.py --json 02_do_concurrent > trace.json
# Identical structure to GET /api/constructs/02_do_concurrent
```

**HTML** — self-contained offline report:
```bash
python3 tracer/cli.py --output report.html 06_polymorphism
# Opens in any browser; no server; embeds all IR content
# ~30KB per construct
```

### Flags

| Flag | Description |
|------|-------------|
| `--list` / `-l` | Browse all constructs |
| `--patterns` / `-p` | Show lowering patterns reference |
| `--stage STAGE` / `-s` | Show only one IR stage |
| `--line N` / `-n` | Focus on one source line number |
| `--json` / `-j` | Raw JSON output |
| `--output FILE` / `-o` | Write HTML report to FILE |
| `--full` / `-f` | No IR truncation |

### Live compile

```bash
FLANG_BINARY=flang-new python3 tracer/cli.py my_construct.f90
FLANG_BINARY=flang-new python3 tracer/cli.py --stage hlfir --line 8 my_construct.f90
```

---

## 🌐 REST API

All features are accessible as a REST API. See [`API.md`](API.md) for complete reference.

**Try it live:** [http://localhost:8001/docs](http://localhost:8001/docs)

Quick examples:

```bash
# Get all construct summaries
curl http://localhost:8001/api/constructs | jq '.[] | .name'

# Full pipeline trace for DO CONCURRENT
curl http://localhost:8001/api/constructs/02_do_concurrent | jq '.correlations[0]'

# Search all IR for "hlfir.elemental"
curl "http://localhost:8001/api/search?q=hlfir.elemental" | jq '.total'

# Compare DO CONCURRENT vs array assignment at HLFIR
curl "http://localhost:8001/api/compare/02_do_concurrent/01_array_assignment?stage=hlfir" \
  | jq '{ops_only_a: .ops_only_in_a, ops_only_b: .ops_only_in_b}'

# Performance badges for polymorphism
curl http://localhost:8001/api/metrics/06_polymorphism | jq '.badges[].label'

# Detect constructs in Fortran source
curl -X POST http://localhost:8001/api/pattern-analyze \
  -H "Content-Type: application/json" \
  -d '{"source": "DO CONCURRENT (i=1:n)\n  a(i) = SQRT(b(i))\nEND DO"}' \
  | jq '.detections[].construct_type'
```

---

## 🎬 HPE Demo Script

**Duration:** 8-10 minutes  
**Setup:** `./scripts/start.sh`, browser open to `http://localhost:5173`

### Act 1: The Terminal (2 min)
*"Let me start in the terminal to show the classical engineering substrate."*

```bash
python3 tracer/cli.py --list
```
Show: 10 constructs, organized by category, with Fortran standard and complexity.

```bash
python3 tracer/cli.py --stage hlfir 02_do_concurrent
```
Show: HLFIR output for DO CONCURRENT. Point out `hlfir.elemental ... unordered`.

```bash
python3 tracer/cli.py --line 8 02_do_concurrent
```
Show: focused output for line 8. The `DO CONCURRENT` statement maps to specific HLFIR, FIR, and LLVM IR operations.

### Act 2: The Dashboard — Explore (3 min)
*"Now let me show you the visual telemetry layer."*

1. Click **DO CONCURRENT** in the sidebar. Point out the ⚡ badge.
2. Navigate through the pipeline flow bar: Parse Tree → Semantics → HLFIR → FIR → LLVM IR
3. Click line 8 (`DO CONCURRENT (i = 1:n)`) in the source viewer
4. **Trace Flow appears**: animated card stack from Parse Tree down to LLVM IR
   - *"Notice the `unordered` attribute persists from HLFIR through FIR to LLVM IR — that's what tells the vectoriser this loop is safe to SIMD."*

### Act 3: The Compare (2 min)
*"Here's something unique — let me compare DO CONCURRENT against a plain DO loop."*

1. Click **Compare** in the header
2. Select `02_do_concurrent` vs `01_array_assignment`
3. Switch to **HLFIR** tab
4. Point out: **Ops only in A**: `['arith.mulf']` vs **Ops only in B**: `['arith.addf', 'hlfir.destroy']`
5. *"The only semantic difference at HLFIR level is the operation and the `unordered` attribute. Everything else — `hlfir.elemental`, `hlfir.apply`, `hlfir.assign` — is shared infrastructure."*

### Act 4: The Search (1 min)
*"And here's the killer feature for any Flang developer."*

1. Press `⌘K` to open the global search
2. Type `_caf_get`
3. *"One search, 50 IR dumps. Found the OpenCoarrays runtime call site in construct 07 immediately — with context lines."*
4. Click the result. Navigate to coarray construct.

### Act 5: Live Pattern Analysis (1 min)
*"Finally, the tool works without a Flang install."*

1. Click **Analyze** in the header
2. Type or paste a short WHERE block
3. *"Construct detected in real time. Predicted lowering: `arith.select` not a branch — branchless for SIMD. Matched to construct 03."*
4. Click "Best match" to navigate.

**Closing line:** *"This is what cross-level IR transparency looks like — five stages, ten constructs, full correlation, no manual grepping."*
