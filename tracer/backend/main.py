"""
fpc-trace FastAPI backend.

Serves construct traces (simulation or live compile), lowering patterns,
and optional SSE explanations.

Run from tracer/backend:
  uvicorn main:app --reload --host 0.0.0.0 --port 8001

OpenAPI: http://localhost:8001/docs
"""
from __future__ import annotations

import difflib
import json
import os
import re
import sys
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── path setup so engine/llm/models imports resolve ─────────────────────────
sys.path.insert(0, str(Path(__file__).parent))

from engine.compiler_runner import detect_flang, compile_all_stages
from engine.stage_parser import parse_stage
from engine.correlation import correlate
from models.schemas import (
    PipelineResult,
    ConstructSummary,
    AnalyzeRequest,
    ExplainRequest,
    HealthResponse,
    CompilerMode,
    StageOutput,
)

# ── constants ────────────────────────────────────────────────────────────────
PREGENERATED_DIR = Path(__file__).parent / "samples" / "pregenerated"
STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"

app = FastAPI(
    title="fpc-trace — Flang Pipeline Construct Tracer",
    description=(
        "Traces Fortran source constructs through Flang's full compilation "
        "pipeline: Parse Tree → Semantics → FIR → HLFIR → LLVM IR."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _load_pregenerated(construct_id: str) -> dict:
    path = PREGENERATED_DIR / f"{construct_id}.json"
    if not path.exists():
        raise HTTPException(404, f"No pre-generated data for '{construct_id}'")
    with open(path) as f:
        return json.load(f)


def _all_pregenerated() -> list[dict]:
    results = []
    for p in sorted(PREGENERATED_DIR.glob("*.json")):
        with open(p) as f:
            results.append(json.load(f))
    return results


# ── routes ───────────────────────────────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse)
async def health():
    flang_ok, flang_ver = detect_flang()
    return HealthResponse(
        status="ok",
        flang_available=flang_ok,
        flang_version=flang_ver,
        mode=CompilerMode.REAL if flang_ok else CompilerMode.SIMULATION,
        construct_count=len(list(PREGENERATED_DIR.glob("*.json"))),
    )


@app.get("/api/constructs", response_model=list[ConstructSummary])
async def list_constructs():
    summaries = []
    for data in _all_pregenerated():
        summaries.append(
            ConstructSummary(
                id=data["id"],
                name=data["name"],
                description=data["description"],
                category=data["category"],
                complexity=data["complexity"],
                fortran_standard=data["fortran_standard"],
                key_patterns=data.get("key_patterns", []),
            )
        )
    return summaries


@app.get("/api/constructs/{construct_id}", response_model=PipelineResult)
async def get_construct(construct_id: str):
    data = _load_pregenerated(construct_id)
    return PipelineResult(**data)


@app.post("/api/analyze", response_model=PipelineResult)
async def analyze(req: AnalyzeRequest):
    """Compile user-supplied Fortran source and return pipeline result."""
    flang_ok, _ = detect_flang()
    if not flang_ok:
        raise HTTPException(
            503,
            "flang-new not available. Use /api/constructs for pre-generated demos.",
        )

    raw_stages = await compile_all_stages(req.source)
    parsed = {name: parse_stage(name, res.output) for name, res in raw_stages.items()}

    correlations = correlate(
        source=req.source,
        parse_tree=parsed["parse_tree"],
        semantics=parsed["semantics"],
        fir=parsed["fir"],
        hlfir=parsed["hlfir"],
        llvm_ir=parsed["llvm_ir"],
    )

    stages = {
        name: StageOutput(
            stage=name,
            content=ps.content,
            line_count=ps.line_count,
            key_ops=ps.key_ops,
            loc_map=ps.loc_map,
        )
        for name, ps in parsed.items()
    }

    return PipelineResult(
        id="custom",
        name="Custom Analysis",
        description="User-supplied Fortran source compiled by flang-new",
        category="array_operations",
        complexity="UNKNOWN",
        fortran_standard="F2018",
        source=req.source,
        stages=stages,
        correlations=correlations,
        compilation_mode=CompilerMode.REAL,
    )


@app.post("/api/explain")
async def explain(req: ExplainRequest):
    """Stream AI explanation for a construct's lowering chain (SSE)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        # Return a static explanation when no API key is configured
        async def _fallback() -> AsyncIterator[str]:
            data = _load_pregenerated(req.construct_id)
            corrs = data.get("correlations", [])
            for c in corrs:
                if c.get("source_line") == req.source_line:
                    yield f"data: {json.dumps({'text': c.get('lowering_notes', '')})}\n\n"
                    return
            yield f"data: {json.dumps({'text': 'Set ANTHROPIC_API_KEY for live AI analysis.'})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(_fallback(), media_type="text/event-stream")

    from llm.analyst import stream_analysis

    async def _sse() -> AsyncIterator[str]:
        try:
            async for chunk in stream_analysis(req):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(_sse(), media_type="text/event-stream")


@app.get("/api/patterns")
async def lowering_patterns():
    """Aggregate all lowering patterns across constructs."""
    patterns: list[dict] = []
    for data in _all_pregenerated():
        for p in data.get("lowering_patterns", []):
            p["construct_id"] = data["id"]
            p["construct_name"] = data["name"]
            patterns.append(p)
    return {"patterns": patterns, "count": len(patterns)}


@app.get("/api/constructs/{construct_id}/source")
async def get_source(construct_id: str):
    """Return the raw Fortran source for a construct."""
    src_path = Path(__file__).parent / "samples" / f"{construct_id}.f90"
    if not src_path.exists():
        data = _load_pregenerated(construct_id)
        return {"source": data.get("source", "")}
    return {"source": src_path.read_text()}


# ══════════════════════════════════════════════════════════════════════════════
# POWER FEATURES
# ══════════════════════════════════════════════════════════════════════════════

# ── 1. Global IR Search ───────────────────────────────────────────────────────

@app.get("/api/search")
async def search_ir(
    q: str = Query(..., min_length=2, description="Token or expression to find"),
    stage: Optional[str] = Query(None, description="Restrict to one stage"),
    context: int = Query(2, ge=0, le=5, description="Lines of context around each match"),
):
    """
    Full-text search across all pipeline stages of every construct.

    Returns up to 50 matches with surrounding context lines.
    Use stage= to narrow to parse_tree|semantics|fir|hlfir|llvm_ir.
    """
    q_lower = q.lower()
    results: list[dict] = []
    STAGES = ["parse_tree", "semantics", "fir", "hlfir", "llvm_ir"]

    for data in _all_pregenerated():
        for s_name in (STAGES if stage is None else [stage]):
            s_data = data.get("stages", {}).get(s_name, {})
            content = s_data.get("content", "")
            if not content:
                continue
            lines = content.splitlines()
            for i, line in enumerate(lines):
                if q_lower not in line.lower():
                    continue
                lo = max(0, i - context)
                hi = min(len(lines), i + context + 1)
                results.append({
                    "construct_id":   data["id"],
                    "construct_name": data["name"],
                    "category":       data["category"],
                    "stage":          s_name,
                    "match_line":     i + 1,
                    "match_text":     line,
                    "context": [
                        {"line_num": j + 1, "text": lines[j], "is_match": j == i}
                        for j in range(lo, hi)
                    ],
                })
                if len(results) >= 50:
                    break
            if len(results) >= 50:
                break

    # Deduplicate: one result per (construct, stage) pair, prefer earlier line
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in results:
        key = f"{r['construct_id']}::{r['stage']}"
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    return {"query": q, "total": len(results), "unique_locations": len(deduped), "results": deduped}


# ── 2. Side-by-side Construct Comparison ─────────────────────────────────────

@app.get("/api/compare/{id1}/{id2}")
async def compare_constructs(
    id1: str,
    id2: str,
    stage: str = Query("hlfir", description="Stage to compare"),
):
    """
    Compare two constructs at a given pipeline stage.

    Returns:
    - content of each construct's stage
    - key_ops unique to each side
    - ops shared by both
    - line-count unified diff (fromfile / tofile annotated)
    """
    a = _load_pregenerated(id1)
    b = _load_pregenerated(id2)

    a_s = a.get("stages", {}).get(stage, {})
    b_s = b.get("stages", {}).get(stage, {})

    a_ops = set(a_s.get("key_ops", []))
    b_ops = set(b_s.get("key_ops", []))

    a_lines = a_s.get("content", "").splitlines(keepends=True)
    b_lines = b_s.get("content", "").splitlines(keepends=True)
    unified = list(difflib.unified_diff(
        a_lines, b_lines,
        fromfile=f"{id1} / {stage}",
        tofile=f"{id2} / {stage}",
        n=3,
    ))

    # Count added/removed lines
    added   = sum(1 for l in unified if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in unified if l.startswith("-") and not l.startswith("---"))

    return {
        "stage": stage,
        "a": {"id": id1, "name": a["name"], "category": a["category"],
               "content": a_s.get("content", ""), "key_ops": a_s.get("key_ops", []),
               "line_count": a_s.get("line_count", 0)},
        "b": {"id": id2, "name": b["name"], "category": b["category"],
               "content": b_s.get("content", ""), "key_ops": b_s.get("key_ops", []),
               "line_count": b_s.get("line_count", 0)},
        "ops_only_in_a": sorted(a_ops - b_ops),
        "ops_only_in_b": sorted(b_ops - a_ops),
        "ops_shared":    sorted(a_ops & b_ops),
        "diff":          "".join(unified),
        "diff_stats":    {"added": added, "removed": removed, "changed_files": 1},
    }


# ── 3. Performance Intelligence Metrics ──────────────────────────────────────

def _compute_metrics(data: dict) -> dict:
    """Analyse a construct's IR for performance-relevant characteristics."""
    llvm = data.get("stages", {}).get("llvm_ir",    {}).get("content", "")
    hlfir= data.get("stages", {}).get("hlfir",      {}).get("content", "")
    fir  = data.get("stages", {}).get("fir",        {}).get("content", "")
    pt   = data.get("stages", {}).get("parse_tree", {}).get("content", "")

    def cnt(pat: str, txt: str) -> int:
        return len(re.findall(pat, txt, re.I | re.M))

    # ── LLVM IR counters ──────────────────────────────────────────────────
    metrics = {
        "loads":          cnt(r'\bload\b',             llvm),
        "stores":         cnt(r'\bstore\b',             llvm),
        "calls":          cnt(r'\bcall\b',              llvm),
        "fp_ops":         cnt(r'\b(fadd|fsub|fmul|fdiv|fcmp)\b', llvm),
        "integer_ops":    cnt(r'\b(add|sub|mul|sdiv|udiv|icmp)\b', llvm),
        "gep":            cnt(r'\bgetelementptr\b',     llvm),
        "phi_nodes":      cnt(r'\bphi\b',               llvm),
        "branches":       cnt(r'\bbr\b',                llvm),
        "alloca":         cnt(r'\balloca\b',            llvm),
        "intrinsics":     cnt(r'@llvm\.\w+',           llvm),
        "runtime_calls":  cnt(r'@_FortranA\w+',        llvm),
        "caf_calls":      cnt(r'@_caf_\w+',            llvm),
        "indirect_calls": cnt(r'call\s+\w+\s+%\w+\(',  llvm),
    }

    # ── Boolean flags ─────────────────────────────────────────────────────
    flags = {
        "vectorizable":     bool(re.search(r'unordered', hlfir + fir)),
        "openmp_parallel":  bool(re.search(r'omp\.parallel|omp\.wsloop', fir)),
        "virtual_dispatch": bool(re.search(r'fir\.dispatch\b', fir + hlfir) or
                                  metrics["indirect_calls"] > 0),
        "heap_alloc":       bool(re.search(r'@_FortranA(Matmul|Sum|Maxval|Copy|AllocatableAllocate)', llvm)),
        "caf_distributed":  metrics["caf_calls"] > 0,
        "recursive":        bool(re.search(r'RECURSIVE|recursive function|recursive subroutine', pt, re.I) or
                                  cnt(r'call\s+\w+\s+@_QP(\w+)\b.*\n.*call\s+\w+\s+@_QP\1', llvm) > 0),
        "has_runtime":      metrics["runtime_calls"] > 0,
        "has_sync_barrier": bool(re.search(r'@_caf_sync_all', llvm)),
        "loop_present":     metrics["phi_nodes"] > 0,
    }

    # ── Performance badges ────────────────────────────────────────────────
    badges: list[dict] = []
    if flags["vectorizable"]:
        badges.append({"id": "simd",      "icon": "⚡", "label": "SIMD eligible",       "color": "#3fb950"})
    if flags["openmp_parallel"]:
        badges.append({"id": "omp",       "icon": "🔀", "label": "OpenMP parallel",      "color": "#388bfd"})
    if flags["virtual_dispatch"]:
        badges.append({"id": "vtable",    "icon": "🔗", "label": "Virtual dispatch",     "color": "#d29922"})
    if flags["heap_alloc"]:
        badges.append({"id": "heap",      "icon": "📦", "label": "Heap allocated",       "color": "#f85149"})
    if flags["caf_distributed"]:
        badges.append({"id": "caf",       "icon": "🌐", "label": "CAF distributed",      "color": "#bc8cff"})
    if flags["recursive"]:
        badges.append({"id": "recursive", "icon": "🔄", "label": "Recursive / alloca",   "color": "#ff7b72"})
    if flags["has_runtime"] and not flags["heap_alloc"]:
        badges.append({"id": "runtime",   "icon": "📚", "label": "Runtime library",      "color": "#39c5cf"})
    if flags["has_sync_barrier"]:
        badges.append({"id": "barrier",   "icon": "🚧", "label": "Sync barrier",         "color": "#e3b341"})
    if not badges:
        badges.append({"id": "scalar",    "icon": "📐", "label": "Scalar / inline",      "color": "#8b949e"})

    # ── Instruction mix percentages ───────────────────────────────────────
    total_ops = max(1, metrics["loads"] + metrics["stores"] + metrics["calls"] +
                    metrics["fp_ops"] + metrics["gep"] + metrics["phi_nodes"])
    mix = {
        "memory":  round(100 * (metrics["loads"] + metrics["stores"]) / total_ops),
        "compute": round(100 *  metrics["fp_ops"]                     / total_ops),
        "control": round(100 * (metrics["branches"] + metrics["phi_nodes"]) / total_ops),
        "calls":   round(100 *  metrics["calls"]                      / total_ops),
    }

    return {
        "construct_id":   data["id"],
        "construct_name": data["name"],
        "badges":  badges,
        "metrics": metrics,
        "flags":   flags,
        "mix":     mix,
    }


@app.get("/api/metrics/{construct_id}")
async def get_metrics(construct_id: str):
    """
    Extract performance metrics from a construct's IR stages.

    Returns: badges (vectorizable / vtable / heap / CAF / recursive …),
    LLVM instruction counts, instruction-mix percentages, boolean flags.
    """
    data = _load_pregenerated(construct_id)
    return _compute_metrics(data)


@app.get("/api/metrics")
async def all_metrics():
    """Performance metrics for every construct — used to populate sidebar badges."""
    return [_compute_metrics(d) for d in _all_pregenerated()]


# ── 4. Lowering Path for a Specific Source Line ───────────────────────────────

@app.get("/api/trace/{construct_id}/line/{line_num}")
async def trace_line(construct_id: str, line_num: int):
    """
    Return a vertical lowering trace for a specific source line.

    Aggregates correlation data from every stage into a single ordered chain,
    enriched with the lowering_notes and key ops at each level.
    """
    data = _load_pregenerated(construct_id)
    corrs = data.get("correlations", [])
    corr = next((c for c in corrs if c["source_line"] == line_num), None)

    stages_info = []
    STAGE_META = [
        ("parse_tree", "Parse Tree",  "parse the source construct"),
        ("semantics",  "Semantics",   "type resolution, conformance, aliasing"),
        ("hlfir",      "HLFIR",       "high-level array semantics preserved as values"),
        ("fir",        "FIR",         "loops materialised, memory model applied"),
        ("llvm_ir",    "LLVM IR",     "target-independent machine instructions"),
    ]
    for s_key, s_label, s_role in STAGE_META:
        s_data = data.get("stages", {}).get(s_key, {})
        ops: list[str] = []
        if corr:
            field = {"parse_tree": "parse_tree_nodes", "fir": "fir_ops",
                     "hlfir": "hlfir_ops", "llvm_ir": "llvm_ir_lines"}.get(s_key, "")
            ops = corr.get(field, []) or s_data.get("key_ops", [])[:4]
        else:
            ops = s_data.get("key_ops", [])[:4]

        stages_info.append({
            "stage":   s_key,
            "label":   s_label,
            "role":    s_role,
            "ops":     ops[:6],
            "lines":   s_data.get("line_count", 0),
        })

    return {
        "construct_id":   construct_id,
        "construct_name": data["name"],
        "source_line":    line_num,
        "source_text":    corr["source_text"] if corr else "",
        "construct_type": corr["construct_type"].replace("_", " ") if corr else "unknown",
        "lowering_notes": corr.get("lowering_notes", "") if corr else "",
        "chain":          stages_info,
        "metrics":        _compute_metrics(data),
    }


# ── 5. Pattern Analyzer (for live Fortran source) ─────────────────────────────

class PatternAnalyzeRequest(BaseModel):
    source: str

@app.post("/api/pattern-analyze")
async def pattern_analyze(req: PatternAnalyzeRequest):
    """
    Given arbitrary Fortran source, identify constructs by pattern matching
    and recommend the closest pre-generated trace for each detected construct.
    """
    sys.path.insert(0, str(Path(__file__).parent))
    from engine.correlation import _classify_construct, _LOWERING_NOTES

    lines = req.source.splitlines()
    detections: list[dict] = []
    seen_types: set[str] = set()

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("!"):
            continue
        ct = _classify_construct(stripped)
        if ct and ct not in seen_types:
            seen_types.add(ct)
            # Find best matching pregenerated construct
            best_match = None
            for d in _all_pregenerated():
                for c in d.get("correlations", []):
                    if c.get("construct_type") == ct:
                        best_match = {"id": d["id"], "name": d["name"],
                                      "category": d["category"]}
                        break
                if best_match:
                    break
            detections.append({
                "line":           i,
                "text":           line.rstrip(),
                "construct_type": ct,
                "lowering_note":  _LOWERING_NOTES.get(ct, ""),
                "best_match":     best_match,
            })

    return {
        "source_lines": len(lines),
        "detections":   detections,
        "unique_constructs": len(seen_types),
        "construct_types":   sorted(seen_types),
    }


# ── serve frontend ────────────────────────────────────────────────────────────
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="frontend")
