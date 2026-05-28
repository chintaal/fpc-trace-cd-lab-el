# fpc-trace Documentation

*Navigate the full technical reference for the Flang Pipeline Construct Tracer.*

---

## For evaluators (HPE / Assignment 33)

| Document | Purpose |
|----------|---------|
| [**PROBLEM.md**](PROBLEM.md) | The problem fpc-trace solves; gap analysis vs Godbolt/opt-viewer; original brief objectives |
| [**FEATURES.md**](FEATURES.md) | Every feature explained; HPE demo script (8-10 min walkthrough) |
| [**CONSTRUCTS.md**](CONSTRUCTS.md) | All 10 constructs with complete 5-stage lowering chains |
| [**lowering-patterns.md**](lowering-patterns.md) | 14 Flang lowering patterns — Flang developer reference |

## For developers

| Document | Purpose |
|----------|---------|
| [**ARCHITECTURE.md**](ARCHITECTURE.md) | System design, data flow, layer breakdown, design decisions |
| [**TRACK_B_HOOKS.md**](TRACK_B_HOOKS.md) | In-process MLIR hook design (Track B / production path) |
| [**BUILD.md**](BUILD.md) | How to build or install `flang-new` for live compilation mode |
| [**../CONTRIBUTING.md**](../CONTRIBUTING.md) | Setup, conventions, PR process, how to add constructs |
| [**../schemas/correlated_construct.schema.json**](../schemas/correlated_construct.schema.json) | JSON Schema (Draft-07) for trace validation |

## Original assignment documents

| Document | Purpose |
|----------|---------|
| [**reference/ASSIGNMENT_33_BRIEF.md**](reference/ASSIGNMENT_33_BRIEF.md) | Original problem statement |
| [**design/ENGINEERING_DESIGN.md**](design/ENGINEERING_DESIGN.md) | Full engineering design specification |

---

## Quick links

- **Run the tool:** `./scripts/start.sh` → [http://localhost:5173](http://localhost:5173)
- **Interactive API docs:** [http://localhost:8001/docs](http://localhost:8001/docs)
- **Run 111 tests:** `pytest tests/ -v`
- **Validate 10 traces:** `./scripts/validate_trace_json.sh`
- **CLI help:** `python3 tracer/cli.py --help`
