# fpc-trace — Tracer package

This directory contains the **complete tracer application**: terminal CLI, FastAPI backend, and React dashboard.

## Layout

```
tracer/
├── cli.py              # Terminal interface (text / JSON / HTML)
├── backend/            # FastAPI + parsing engine + samples
│   ├── main.py
│   ├── engine/
│   ├── llm/
│   ├── models/
│   └── samples/
└── frontend/           # Vite + React UI
    └── src/components/
```

## Usage

```bash
# From repository root
python3 tracer/cli.py --list
python3 tracer/cli.py 02_do_concurrent
python3 tracer/cli.py --stage hlfir 06_polymorphism --line 9

# Full stack (backend + frontend)
../scripts/start.sh
```

## Modes of operation

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Simulation** | Default | Loads pre-generated JSON from `backend/samples/pregenerated/` |
| **Live compile** | `FLANG_BINARY=flang-new` | Runs `flang-new` per stage, parses output, correlates |
| **AI analysis** | `ANTHROPIC_API_KEY` set | Streams Claude explanations; otherwise uses `lowering_notes` in JSON |

## Further reading

- [backend/README.md](backend/README.md) — API and engine details
- [frontend/README.md](frontend/README.md) — UI components
- [backend/samples/README.md](backend/samples/README.md) — Fortran constructs catalog
- [../docs/README.md](../docs/README.md) — Full documentation index
