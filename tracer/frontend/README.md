# fpc-trace — Frontend

React 18 + Vite dashboard for exploring Fortran constructs across all five Flang pipeline stages.

## Run locally

```bash
cd tracer/frontend
npm install
npm run dev -- --port 5173
```

Ensure the backend is running on **port 8001** (or update `vite.config.js` proxy target).

Production build (served by FastAPI when `dist/` exists):

```bash
npm run build
```

## Architecture

- **`App.jsx`** — Root state: selected construct, active stage, line focus, API calls (`API = ''` uses Vite proxy).
- **`components/Header.jsx`** — Title, mode indicator, patterns shortcut.
- **`components/Sidebar.jsx`** — Construct list with complexity badges.
- **`components/PipelineFlow.jsx`** — Stage selector (Parse Tree → LLVM IR).
- **`components/SourceViewer.jsx`** — Fortran source with clickable correlated lines.
- **`components/StagePanel.jsx`** — IR dump for the active stage, highlighted ops.
- **`components/AnalysisPanel.jsx`** — Lowering notes / streaming AI explanation.
- **`components/PatternsModal.jsx`** — Lowering patterns reference overlay.

## API proxy

During development, Vite proxies `/api/*` to `http://localhost:8001`. `scripts/start.sh` patches the port in `vite.config.js` if you override `PORT_BACKEND`.

## Styling

Global styles live in `src/index.css` (dark theme, monospace IR panels, stage color coding aligned with the CLI).
