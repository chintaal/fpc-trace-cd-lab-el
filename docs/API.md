# fpc-trace REST API Reference

**Base URL:** `http://localhost:8001`  
**Interactive docs:** [http://localhost:8001/docs](http://localhost:8001/docs) (Swagger UI)  
**OpenAPI spec:** [http://localhost:8001/openapi.json](http://localhost:8001/openapi.json)

All responses are JSON. CORS is unrestricted for local development.

---

## Core Endpoints

### `GET /api/health`

Server status and capability report.

```json
{
  "status": "ok",
  "flang_available": false,
  "flang_version": null,
  "mode": "simulation",
  "construct_count": 10
}
```

`mode` is `"real"` when `FLANG_BINARY` is set and the binary is found.

---

### `GET /api/constructs`

All 10 construct summaries.

```json
[
  {
    "id": "02_do_concurrent",
    "name": "DO CONCURRENT Loop",
    "description": "Parallel loop with independence guarantee...",
    "category": "concurrency",
    "complexity": "HIGH",
    "fortran_standard": "F2008",
    "key_patterns": ["omp.parallel", "fir.do_loop unordered", "LLVM vectorized loop"]
  },
  ...
]
```

---

### `GET /api/constructs/{construct_id}`

Full pipeline trace. `construct_id` examples: `01_array_assignment`, `06_polymorphism`.

```json
{
  "id": "02_do_concurrent",
  "name": "DO CONCURRENT Loop",
  "source": "subroutine do_concurrent_scale(a, b, scale, n)\n...",
  "stages": {
    "parse_tree": {
      "stage": "parse_tree",
      "content": "  SubroutineSubprogram\n  ...",
      "line_count": 36,
      "key_ops": ["DoConstruct", "ConcurrentControl"],
      "loc_map": {}
    },
    "hlfir": { ... },
    "fir":   { ... },
    "llvm_ir": {
      "stage": "llvm_ir",
      "content": "; ModuleID = '02_do_concurrent.f90'\n...",
      "line_count": 52,
      "key_ops": ["getelementptr", "load", "fmul", "store", "phi"],
      "loc_map": { "02_do_concurrent.f90:8": [23, 24, 25, 26, ...] }
    }
  },
  "correlations": [
    {
      "source_line": 8,
      "source_text": "  DO CONCURRENT (i = 1:n)",
      "construct_type": "do_concurrent",
      "parse_tree_nodes": ["DoConstruct", "ConcurrentControl"],
      "fir_ops": ["fir.do_loop unordered", "fir.array_fetch"],
      "hlfir_ops": ["hlfir.elemental unordered", "hlfir.apply"],
      "llvm_ir_lines": ["phi", "getelementptr", "fmul"],
      "lowering_notes": "DO CONCURRENT's independence guarantee is encoded as..."
    }
  ],
  "lowering_patterns": [
    { "name": "DO CONCURRENT → Unordered Loop", "description": "..." }
  ],
  "compilation_mode": "simulation"
}
```

---

### `GET /api/patterns`

All 23 lowering patterns across all constructs.

```json
{
  "count": 23,
  "patterns": [
    {
      "name": "Elemental Array Operation",
      "description": "Source-level array operator → hlfir.elemental...",
      "construct_id": "01_array_assignment",
      "construct_name": "Array Element-wise Assignment"
    },
    ...
  ]
}
```

---

## Power Endpoints

### `GET /api/search`

Full-text search across all 50 IR dumps (10 constructs × 5 stages).

**Query parameters:**
- `q` (required, min 2 chars) — search term
- `stage` (optional) — restrict to: `parse_tree | semantics | fir | hlfir | llvm_ir`
- `context` (optional, 0–5, default 2) — lines of context around each match

```bash
curl "http://localhost:8001/api/search?q=hlfir.elemental&stage=hlfir&context=1"
```

```json
{
  "query": "hlfir.elemental",
  "total": 11,
  "unique_locations": 6,
  "results": [
    {
      "construct_id": "01_array_assignment",
      "construct_name": "Array Element-wise Assignment",
      "category": "array_operations",
      "stage": "hlfir",
      "match_line": 32,
      "match_text": "    %expr = hlfir.elemental %shape unordered",
      "context": [
        { "line_num": 31, "text": "    // hlfir.elemental captures element-wise semantics", "is_match": false },
        { "line_num": 32, "text": "    %expr = hlfir.elemental %shape unordered", "is_match": true },
        { "line_num": 33, "text": "        : (!fir.shape<1>) -> !hlfir.expr<?xf32> {", "is_match": false }
      ]
    },
    ...
  ]
}
```

---

### `GET /api/compare/{id1}/{id2}`

Side-by-side comparison at a pipeline stage.

**Query parameters:**
- `stage` (default: `hlfir`) — which stage to compare

```bash
curl "http://localhost:8001/api/compare/01_array_assignment/02_do_concurrent?stage=hlfir"
```

```json
{
  "stage": "hlfir",
  "a": { "id": "01_array_assignment", "name": "Array...", "content": "...", "key_ops": [...], "line_count": 52 },
  "b": { "id": "02_do_concurrent", "name": "DO CONCURRENT...", "content": "...", "key_ops": [...], "line_count": 40 },
  "ops_only_in_a": ["arith.addf", "hlfir.destroy"],
  "ops_only_in_b": ["arith.mulf"],
  "ops_shared": ["hlfir.apply", "hlfir.assign", "hlfir.declare", "hlfir.elemental", "hlfir.yield_element"],
  "diff": "--- 01_array_assignment / hlfir\n+++ 02_do_concurrent / hlfir\n@@ -1,6 +1,6 @@...",
  "diff_stats": { "added": 21, "removed": 35, "changed_files": 1 }
}
```

---

### `GET /api/metrics/{construct_id}`

Performance analysis of a construct's LLVM IR.

```bash
curl "http://localhost:8001/api/metrics/06_polymorphism"
```

```json
{
  "construct_id": "06_polymorphism",
  "construct_name": "Polymorphism & Dynamic Dispatch",
  "badges": [
    { "id": "vtable",  "icon": "🔗", "label": "Virtual dispatch",  "color": "#d29922" },
    { "id": "runtime", "icon": "📚", "label": "Runtime library",   "color": "#39c5cf" }
  ],
  "metrics": {
    "loads": 9, "stores": 0, "calls": 8, "fp_ops": 0,
    "gep": 5, "phi_nodes": 0, "branches": 5, "alloca": 0,
    "intrinsics": 0, "runtime_calls": 3, "caf_calls": 0, "indirect_calls": 2
  },
  "flags": {
    "vectorizable": false, "virtual_dispatch": true, "heap_alloc": false,
    "caf_distributed": false, "recursive": false, "has_runtime": true,
    "openmp": false, "has_sync_barrier": false
  },
  "mix": { "memory": 40, "compute": 0, "control": 22, "calls": 32 }
}
```

### `GET /api/metrics`

Metrics for all 10 constructs in one call (used for sidebar badge population).

---

### `GET /api/trace/{construct_id}/line/{line_num}`

Vertical lowering chain for a specific source line.

```bash
curl "http://localhost:8001/api/trace/02_do_concurrent/line/8"
```

```json
{
  "construct_id": "02_do_concurrent",
  "construct_name": "DO CONCURRENT Loop",
  "source_line": 8,
  "source_text": "  DO CONCURRENT (i = 1:n)",
  "construct_type": "do concurrent",
  "lowering_notes": "DO CONCURRENT's independence guarantee...",
  "chain": [
    { "stage": "parse_tree", "label": "Parse Tree",  "role": "AST nodes from parser",             "ops": ["DoConstruct", "ConcurrentControl", "ConcurrentHeader"], "lines": 36 },
    { "stage": "semantics",  "label": "Semantics",   "role": "type resolution · aliasing",         "ops": ["a", "b", "scale"],                                     "lines": 15 },
    { "stage": "hlfir",      "label": "HLFIR",       "role": "array semantics as values",          "ops": ["hlfir.elemental unordered", "hlfir.apply"],            "lines": 40 },
    { "stage": "fir",        "label": "FIR",         "role": "loops materialised",                 "ops": ["fir.do_loop unordered", "fir.array_fetch"],            "lines": 42 },
    { "stage": "llvm_ir",    "label": "LLVM IR",     "role": "target instructions",                "ops": ["phi", "getelementptr", "load"],                        "lines": 52 }
  ],
  "metrics": { ... }
}
```

---

### `POST /api/pattern-analyze`

Detect constructs in arbitrary Fortran source without a Flang install.

```bash
curl -X POST http://localhost:8001/api/pattern-analyze \
  -H "Content-Type: application/json" \
  -d '{"source": "DO CONCURRENT (i=1:n)\n  a(i) = SQRT(b(i))\nEND DO\nc = MATMUL(a_m, b_m)"}'
```

```json
{
  "source_lines": 4,
  "unique_constructs": 3,
  "construct_types": ["do_concurrent", "do_loop", "matmul_intrinsic"],
  "detections": [
    {
      "line": 1,
      "text": "DO CONCURRENT (i=1:n)",
      "construct_type": "do_concurrent",
      "lowering_note": "DO CONCURRENT has no loop-carried dependencies...",
      "best_match": { "id": "02_do_concurrent", "name": "DO CONCURRENT Loop", "category": "concurrency" }
    },
    ...
  ]
}
```

---

### `POST /api/explain`

SSE-streamed AI explanation for a source line.

**Request body:**
```json
{
  "construct_id": "02_do_concurrent",
  "source_line": 8,
  "source_text": "  DO CONCURRENT (i = 1:n)",
  "stage_outputs": { "parse_tree": "...", "fir": "...", "hlfir": "...", "llvm_ir": "..." },
  "lowering_context": "DO CONCURRENT's independence guarantee..."
}
```

**Response:** `text/event-stream`
```
data: {"text": "The DO CONCURRENT construct "}
data: {"text": "carries the independence guarantee "}
...
data: [DONE]
```

Requires `ANTHROPIC_API_KEY`. Falls back to cached `lowering_notes` from the construct's JSON when no key is set.

---

### `POST /api/analyze`

Compile arbitrary Fortran source with `flang-new` and return a full pipeline trace.

Requires `FLANG_BINARY` to be set. Returns a `PipelineResult` object identical in structure to `GET /api/constructs/{id}`.

```bash
curl -X POST http://localhost:8001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"source": "subroutine s(a,n)\n real :: a(n)\n a = a * 2.0\nend subroutine"}'
```

Returns `503 Service Unavailable` if no Flang binary is found.

---

## Error Responses

| HTTP Status | Meaning |
|-------------|---------|
| `404` | Construct ID not found |
| `422` | Validation error (missing required field, wrong type) |
| `503` | Flang not available (live compile requested but no binary) |
| `500` | Internal server error (check logs) |

---

## Type Reference

### `PipelineResult`

Full schema: [`schemas/correlated_construct.schema.json`](../schemas/correlated_construct.schema.json)

### `SourceCorrelation`

| Field | Type | Description |
|-------|------|-------------|
| `source_line` | `int ≥ 1` | 1-based line number in the Fortran source |
| `source_col` | `int ≥ 1` | Column (default 1) |
| `source_text` | `str` | The Fortran source line |
| `construct_type` | `str` | E.g. `do_concurrent`, `array_assignment`, `polymorphism` |
| `parse_tree_nodes` | `list[str]` | Parse tree node type names |
| `fir_ops` | `list[str]` | FIR dialect op names |
| `hlfir_ops` | `list[str]` | HLFIR dialect op names |
| `llvm_ir_lines` | `list[str]` | LLVM IR instruction keywords |
| `lowering_notes` | `str` | Technical explanation of the transformation |

### `StageOutput`

| Field | Type | Description |
|-------|------|-------------|
| `stage` | `str` | One of: `parse_tree`, `semantics`, `fir`, `hlfir`, `llvm_ir` |
| `content` | `str` | Raw text output from this stage |
| `line_count` | `int` | Number of lines in `content` |
| `key_ops` | `list[str]` | Dominant IR operations / node types |
| `loc_map` | `dict[str, list[int]]` | `"file:line"` → `[ir_line_numbers]` |
