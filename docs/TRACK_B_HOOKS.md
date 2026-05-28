# Track B — In-Process Pipeline Instrumentation Hooks

*Companion to Assignment 33 · Deliverable 1 (Pipeline Instrumentation)*

---

## What Track A does (current implementation)

fpc-trace uses **subprocess-based dump interception** ("Track A"). Flang is invoked once per stage with flags that make it print intermediate representations to stderr/stdout:

```bash
# Parse Tree
flang-new -fdebug-dump-parse-tree -fsyntax-only -O0 input.f90

# Semantics symbols
flang-new -fdebug-dump-symbols  -fsyntax-only -O0 input.f90

# FIR (before HLFIR passes)
flang-new -emit-fir -S -mmlir --mlir-print-ir-before-all -O0 -g input.f90

# HLFIR (after all MLIR passes)  
flang-new -emit-fir -S -mmlir --mlir-print-ir-after-all  -O0 -g input.f90

# LLVM IR
flang-new -emit-llvm -S -O0 -g input.f90
```

**Five subprocess invocations → five text artifacts → parsers → correlation engine.**

This is the method used by `scripts/collect_pipeline_dumps.sh` and `tracer/backend/engine/compiler_runner.py`. It works without modifying Flang's source and serves the assignment's demonstration purpose.

---

## What Track B would add (in-process hooks)

Track B replaces subprocess parsing with **MLIR pass callbacks registered inside llvm-project/flang**. The difference: hooks fire once per *operation* rather than once per file, giving per-construct representations directly.

### Architecture

```
llvm-project/flang/lib/Optimizer/Transforms/
└── PipelineTracer.cpp        ← new MLIR pass
    ├── struct TracedOp        ← per-op record: op text, source loc, pass name
    ├── class PipelineTracerPass : public PassWrapper<...>
    │     └── runOnOperation()  ← called by MLIR pass manager after every pass
    └── extern "C" void fpc_trace_flush(const char *json_path)
                                ← writes accumulated TracedOp records to JSON
```

### The registration point

```cpp
// In flang/lib/Frontend/CompilerInvocation.cpp
// (or wherever the MLIR pass pipeline is assembled)

#ifdef FPC_TRACE_ENABLED
  pm.addInstrumentation(std::make_unique<PipelineTracerInstrumentation>(
      /*outputDir=*/tracePath));
#endif
```

`PipelineTracerInstrumentation` implements `mlir::PassInstrumentation`:

```cpp
struct PipelineTracerInstrumentation : public mlir::PassInstrumentation {
  void runAfterPass(Pass *pass, Operation *op) override {
    // Serialize op to text, extract #loc attributes,
    // emit TracedOp record to per-pass bucket
  }
};
```

### Per-construct extraction

The key insight: MLIR operations carry `Location` attributes. Every `fir.do_loop`, `hlfir.elemental`, etc. has a `FileLineColLoc` that maps back to a Fortran source line. The in-process hook captures this *directly* rather than parsing it back from text:

```cpp
if (auto loc = op.getLoc().dyn_cast<mlir::FileLineColLoc>()) {
  record.sourceFile = loc.getFilename().str();
  record.sourceLine = loc.getLine();
  record.sourceCol  = loc.getColumn();
}
```

This eliminates the text-parsing regex layer entirely and gives exact op-to-source mapping — including for `FusedLoc` (post-inlining) and `UnknownLoc` fallbacks.

### Output format

The hook emits one JSON file per pass:

```json
{
  "pass": "flang-lower-hlfir",
  "stage": "hlfir",
  "ops": [
    {
      "opName": "hlfir.elemental",
      "sourceFile": "02_do_concurrent.f90",
      "sourceLine": 8,
      "sourceCol": 3,
      "irText": "hlfir.elemental %shape unordered : ...",
      "passSeq": 12
    }
  ]
}
```

These files are consumed by `scripts/regenerate_pregenerated.py --from-hooks` (not yet implemented) instead of the text-based parsers.

### Build requirements

```bash
# Standard llvm-project build with extra CMake flag
cmake -S llvm -B build \
  -DLLVM_ENABLE_PROJECTS="flang;mlir;clang" \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DFPC_TRACE_ENABLED=ON     # enables the instrumentation pass

# Full build: ~30-90 minutes depending on hardware
ninja -C build flang-new
```

### Comparison: Track A vs Track B

| Concern | Track A (current) | Track B (hooks) |
|---------|-------------------|-----------------|
| flang-new modification | None | ~300 lines C++ |
| Build complexity | pip + npm | Full llvm-project build |
| Per-construct granularity | Per source line (via regex) | Per MLIR op (exact) |
| FusedLoc / UnknownLoc | Fallback heuristic | Native Location API |
| Cross-pass provenance | Not tracked | Pass sequence number |
| Portability | Any Flang binary | Only instrumented build |
| Assignment lab use | ✅ Works now | ✅ Would replace parsers |

### Why Track A is sufficient for the assignment

Track A satisfies all five deliverables:

1. *Pipeline hooks* — subprocess dump invocations ARE hooks (external, not in-process)
2. *Correlation engine* — `#loc`/`!DILocation` parsing gives source-to-IR maps
3. *CLI text/JSON/HTML* — all three output modes implemented
4. *10 demonstrations* — pre-generated and reproducible via `regenerate_pregenerated.py`
5. *Lowering patterns* — documented from actual Flang IR

Track B would be the production-grade approach for a Flang upstream tool. For a lab submission, Track A is the appropriate scope.

---

## File locations if Track B were implemented

```
tracer/
└── hooks/                         # new directory
    ├── CMakeLists.txt
    ├── PipelineTracer.cpp
    ├── PipelineTracer.h
    ├── schema/hook_record.schema.json
    └── README.md
scripts/
└── build_flang_with_hooks.sh      # wraps cmake/ninja
```

The `HookRecord` JSON schema would be a subset of `schemas/correlated_construct.schema.json` (only the `SourceCorrelation` items, one per MLIR op).
