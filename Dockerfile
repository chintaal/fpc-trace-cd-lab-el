# ── Stage 1: build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY tracer/frontend/package*.json ./
RUN npm ci --silent
COPY tracer/frontend/ ./
# VITE_API_URL is empty: FastAPI serves /api directly from the same origin
RUN npm run build

# ── Stage 2: Python backend + static assets ───────────────────────────────────
FROM python:3.12-slim
WORKDIR /app/backend

COPY tracer/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY tracer/backend/ ./

# Place built frontend where main.py expects it:
#   STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"
#              = /app/frontend/dist
COPY --from=frontend-build /build/dist /app/frontend/dist

EXPOSE 8000
# Render (and most PaaS) injects $PORT; fall back to 8000 locally
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
