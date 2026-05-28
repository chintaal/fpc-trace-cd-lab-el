# Contributing to fpc-trace

*The Flang Pipeline Construct Tracer — Compiler Design Lab · Assignment 33 · HPE Flang*

Thank you for contributing. This document covers setup, conventions, how to run the test suite, and how to add a new Fortran construct.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Project Layout](#project-layout)
- [Running the Tests](#running-the-tests)
- [Code Conventions](#code-conventions)
- [Adding a New Construct](#adding-a-new-construct)
- [Commit Style](#commit-style)

---

## Prerequisites

| Tool | Version | Required for |
|------|---------|-------------|
| Python | 3.10+ | Backend, CLI, tests |
| Node.js | 18+ | Frontend dashboard |
| `flang-new` | 18+ | Live compilation mode (optional) |
| `pytest` | any | Test suite |
| `jsonschema` | any | Schema validation (optional) |

---

## Development Setup

```bash
# 1. Clone
git clone <repo-url> && cd cd-el-repo

# 2. Backend
cd tracer/backend
python3 -m venv .venv && source .venv/bin/activate
pip install fastapi uvicorn pydantic python-dotenv httpx sse-starlette aiofiles pytest

# 3. Frontend
cd ../frontend
npm install

# 4. Start everything
cd ../..
./scripts/start.sh
```

**Verify:**
```bash
curl http://localhost:8001/api/health    # → {"status":"ok","construct_count":10,...}
curl http://localhost:5173              # → HTML
pytest tests/ -v                        # → 111 passed
./scripts/validate_trace_json.sh        # → PASS: 10
```

---

## Project Layout

```
tracer/backend/
├── main.py           API routes — all endpoints here
├── engine/
│   ├── compiler_runner.py  subprocess hooks
│   ├── stage_parser.py     ParsedStage per stage
│   └── correlation.py      source_line ↔ IR ops
├── llm/
│   ├── analyst.py          Claude streaming
│   └── prompts/            system + user prompt templates
├── models/schemas.py       Pydantic v2 models
└── samples/
    ├── *.f90               Fortran sources
    └── pregenerated/*.json Full traces

tracer/frontend/src/
├── App.jsx                 Root + mode routing
└── components/             React UI components

tracer/cli.py               Terminal tracer
tests/test_parsers.py       111 pytest tests
schemas/                    JSON Schema
scripts/                    Automation scripts
docs/                       Documentation
```

---

## Running the Tests

```bash
# Full test suite (from repo root)
source tracer/backend/.venv/bin/activate
pytest tests/ -v

# Run one test class
pytest tests/ -v -k TestFIR

# Run one test
pytest tests/ -v -k test_loc_map_populated

# With coverage
pytest tests/ --cov=tracer/backend --cov-report=term-missing
```

**Test structure** (`tests/test_parsers.py`):

| Class | What it tests |
|-------|--------------|
| `TestParseTree` | Parse tree parser: key nodes, loc_map, empty input |
| `TestSemantics` | Semantics parser: symbol extraction |
| `TestFIR` | FIR parser: key ops, `#loc` → loc_map, named-loc definitions |
| `TestHLFIR` | HLFIR parser: ops, loc_map, last-dump segment selection |
| `TestLLVMIR` | LLVM parser: instruction keywords, `!DILocation` → loc_map |
| `TestDispatcher` | `parse_stage()` routes correctly |
| `TestConstructClassifier` | All 10 construct type patterns |
| `TestExtractOps` | IR op name extraction from single lines |
| `TestCorrelate` | `correlate()` end-to-end; no raw line numbers in output |
| `TestPregenerated` | Auto-discovers all 10 JSON files; structural + type checks |

---

## Code Conventions

### Python

- **No line limit** except for clarity; use `black` formatting
- Type hints on all function signatures
- Docstrings on public functions
- No top-level mutable state in modules
- `sys.path.insert(0, ...)` only in entry points (`main.py`, `cli.py`); engine modules use relative imports

### Frontend (React / JSX)

- Functional components only
- Styles as inline `const s = { ... }` objects at the bottom of each file
- `API = ''` — always relative URLs via Vite proxy; never hardcode a port
- No TypeScript — JSX only for simplicity
- No external UI libraries — all styling hand-written with CSS variables from `index.css`

### Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Python modules | `snake_case` | `stage_parser.py` |
| Python classes | `PascalCase` | `ParsedStage` |
| React components | `PascalCase.jsx` | `TraceFlow.jsx` |
| API routes | `/api/snake_case` | `/api/trace/{id}/line/{n}` |
| Construct IDs | `NN_snake_case` | `02_do_concurrent` |

---

## Adding a New Construct

### Option A — Manual JSON (recommended for demo quality)

1. Write a minimal, focused `.f90` file in `tracer/backend/samples/`:
   ```fortran
   ! Construct 11: <Name>
   ! Demonstrates: <key lowering patterns>
   subroutine <name>(...)
     ...
   end subroutine
   ```

2. Create `tracer/backend/samples/pregenerated/11_name.json` following the schema:
   ```json
   {
     "id": "11_name",
     "name": "Human Readable Name",
     "description": "One-line description of the key insight",
     "category": "array_operations | concurrency | data_structures | polymorphism | distributed | intrinsics | procedures",
     "complexity": "LOW | MEDIUM | HIGH | VERY_HIGH",
     "fortran_standard": "F90 | F95 | F2003 | F2008 | F2018",
     "key_patterns": ["key.op1", "key.op2"],
     "source": "full fortran source as a string",
     "stages": {
       "parse_tree": { "stage": "parse_tree", "content": "...", "line_count": N, "key_ops": [], "loc_map": {} },
       "semantics":  { "stage": "semantics",  "content": "...", "line_count": N, "key_ops": [], "loc_map": {} },
       "fir":        { "stage": "fir",        "content": "...", "line_count": N, "key_ops": [], "loc_map": {} },
       "hlfir":      { "stage": "hlfir",      "content": "...", "line_count": N, "key_ops": [], "loc_map": {} },
       "llvm_ir":    { "stage": "llvm_ir",    "content": "...", "line_count": N, "key_ops": [], "loc_map": {} }
     },
     "correlations": [...],
     "lowering_patterns": [...],
     "compilation_mode": "simulation"
   }
   ```

3. Validate: `./scripts/validate_trace_json.sh 11_name`

4. Run tests: `pytest tests/ -v -k TestPregenerated` — new file auto-discovered

5. Add the construct to `docs/CONSTRUCTS.md`

### Option B — Live compilation (requires `flang-new`)

```bash
# Collect 5 stage dumps
./scripts/collect_pipeline_dumps.sh tracer/backend/samples/11_name.f90

# Run parsers + correlation engine → write JSON
FLANG_BINARY=flang-new python3 scripts/regenerate_pregenerated.py --construct 11_name
```

The `compilation_mode` field will be set to `"real"` and `flang_version` will be populated.

---

## Commit Style

```
<type>(<scope>): <description>

type:  feat | fix | docs | test | refactor | chore
scope: backend | frontend | cli | engine | tests | docs | scripts
```

Examples:
```
feat(engine): add named-loc definition parsing to stage_parser
fix(frontend): use relative API base to avoid port collisions
docs(constructs): add lowering chain for FORALL 2-D elemental
test(parsers): add TestHLFIR.test_picks_last_dump_segment
```

---

*Questions? Open an issue or check [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.*
