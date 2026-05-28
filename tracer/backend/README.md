# fpc-trace — Backend

FastAPI server, compilation pipeline engine, optional LLM analyst, and pre-generated construct traces.

## Run locally

```bash
cd tracer/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

Open **http://localhost:8001/docs** for interactive OpenAPI documentation.

## Package structure

| Module | Role |
|--------|------|
| `main.py` | REST routes: health, constructs, patterns, explain (SSE), analyze |
| `engine/compiler_runner.py` | Invokes `flang-new` with per-stage dump flags |
| `engine/stage_parser.py` | Parses raw dump text → `ParsedStage` (content, key_ops, loc_map) |
| `engine/correlation.py` | Maps source lines → cross-stage IR via `#loc` and `!DILocation` |
| `models/schemas.py` | Pydantic models (`PipelineResult`, `SourceCorrelation`, …) |
| `llm/analyst.py` | Optional Claude streaming for `/api/explain` |
| `samples/*.f90` | Minimal Fortran programs (one construct each) |
| `samples/pregenerated/*.json` | Full 5-stage correlated traces (simulation mode) |

## API endpoints

| Route | Description |
|-------|-------------|
| `GET /api/health` | Mode, construct count, Flang availability |
| `GET /api/constructs` | List construct summaries |
| `GET /api/constructs/{id}` | Full pipeline result |
| `GET /api/patterns` | Lowering patterns keyed by construct |
| `POST /api/explain` | SSE stream — AI or cached lowering notes |
| `POST /api/analyze` | Compile custom Fortran (when Flang available) |

## Correlation keys

Flang embeds source locations in MLIR as `#loc("file":line:col)` and in LLVM as `!DILocation`. The correlation engine normalizes these to match Fortran source lines, with fallbacks for `UnknownLoc`, `FusedLoc`, and continuation lines (see `CLAUDE.md` at repo root).

## Dependencies

See `requirements.txt`. Core stack: FastAPI, Uvicorn, Pydantic, Anthropic (optional), SSE-Starlette.
