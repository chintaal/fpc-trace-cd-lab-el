#!/usr/bin/env bash
# fpc-trace — one-command local demo
#
# Starts FastAPI (default :8001) and Vite (default :5173).
# Creates Python venv and installs npm deps on first run.
#
# Usage:
#   ./scripts/start.sh
#   PORT_BACKEND=9000 PORT_FRONTEND=3000 ./scripts/start.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_ROOT/tracer/backend"
FRONTEND="$REPO_ROOT/tracer/frontend"

PORT_BACKEND=${PORT_BACKEND:-8001}
PORT_FRONTEND=${PORT_FRONTEND:-5173}

# ── Colors ──────────────────────────────────────────────────────────────────
GRN='\033[0;32m'; YEL='\033[0;33m'; BLU='\033[0;34m'
MAG='\033[0;35m'; CYN='\033[0;36m'; RST='\033[0m'; BLD='\033[1m'

banner() {
  echo -e "\n${BLD}${CYN}  ⬡ fpc-trace — Flang Pipeline Construct Tracer${RST}"
  echo -e "  ${YEL}Parse Tree → Semantics → FIR → HLFIR → LLVM IR${RST}\n"
}

# ── Cleanup on exit ──────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo -e "\n${YEL}  Stopping servers…${RST}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

banner

# ── Backend ──────────────────────────────────────────────────────────────────
echo -e "${BLU}  [1/3] Setting up Python virtualenv…${RST}"
cd "$BACKEND"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q fastapi uvicorn pydantic python-dotenv httpx sse-starlette aiofiles 2>&1 | tail -1

echo -e "${BLU}  [2/3] Starting FastAPI backend on :${PORT_BACKEND}…${RST}"
uvicorn main:app --host 0.0.0.0 --port "$PORT_BACKEND" --log-level warning &
PIDS+=($!)
sleep 1

# Verify backend
if curl -s "http://localhost:${PORT_BACKEND}/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  {d[\"construct_count\"]} constructs loaded ({d[\"mode\"]})')" 2>/dev/null; then
  echo -e "${GRN}  ✓ Backend ready${RST}"
else
  echo -e "${YEL}  ⚠ Backend may still be starting…${RST}"
fi

# ── Frontend ─────────────────────────────────────────────────────────────────
echo -e "${BLU}  [3/3] Starting Vite frontend on :${PORT_FRONTEND}…${RST}"
cd "$FRONTEND"
if [ ! -d node_modules ]; then
  npm install -q
fi

# Set proxy port in vite config
sed -i.bak "s|'http://localhost:[0-9]*'|'http://localhost:${PORT_BACKEND}'|g" vite.config.js

npm run dev -- --port "$PORT_FRONTEND" --host 0.0.0.0 &
PIDS+=($!)
sleep 2

echo
echo -e "${BLD}  ══════════════════════════════════════════════════${RST}"
echo -e "  ${GRN}${BLD}✓ fpc-trace is running${RST}"
echo -e ""
echo -e "  ${BLD}Dashboard${RST}  → ${CYN}http://localhost:${PORT_FRONTEND}${RST}"
echo -e "  ${BLD}API docs${RST}   → ${CYN}http://localhost:${PORT_BACKEND}/docs${RST}"
echo -e "  ${BLD}CLI demo${RST}   → ${MAG}python3 tracer/cli.py --list${RST}"
echo -e ""
echo -e "  Set ${YEL}ANTHROPIC_API_KEY${RST} for live AI analysis."
echo -e "${BLD}  ══════════════════════════════════════════════════${RST}\n"

# Wait for any background process to exit
wait
