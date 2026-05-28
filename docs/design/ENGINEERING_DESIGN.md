# Flang Multi-Stage Compilation Pipeline Tracer
## Engineering Design Document & Project Execution Plan
### Version 1.0 | HPE Assignment 33

---

## Table of Contents

1. Technical Problem & Solution Architecture
2. Core Implementation Strategy
3. Step-by-Step Execution Plan (4 Phases)
4. The 10 Constructs Demo Strategy
5. Output Design: CLI, JSON Schema & HTML Interface
6. Appendix: Key MLIR/LLVM APIs Reference

---

---

## 1. Technical Problem & Solution Architecture

### 1.1 The Fundamental Correlation Problem

Flang's compilation pipeline is structurally unlike any other major compiler frontend. It does not operate as a classical single-AST pipeline; instead, it maintains **five distinct, semantically complete intermediate representations**, each governed by a different type system and grammar:

| Stage | Representation | Governing Type System | Primary Data Structure |
|-------|---------------|----------------------|------------------------|
| 0 | Fortran Source | ISO Fortran standard | Text + `CharBlock` source ranges |
| 1 | Parse Tree | Flang's structural grammar | `Fortran::parser::Program` variant tree |
| 2 | Decorated Parse Tree / Semantics | Symbol table + type system | `Fortran::semantics::Symbol`, `SomeExpr` |
| 3 | HLFIR | `hlfir` MLIR dialect | `hlfir.declare`, `hlfir.assign`, `hlfir.expr` |
| 4 | FIR | `fir` MLIR dialect | `fir.array_update`, `fir.do_loop`, `fir.box` |
| 5 | LLVM IR | LLVM type system | `llvm::Function`, `DILocation`, `getelementptr` |

The core engineering challenge is **referential continuity**: a single Fortran array assignment such as `A(:) = B(:) + C(:)` will expand into radically different representational structures at each level. At the Parse Tree level it appears as an `AssignmentStmt` node. At HLFIR it becomes an `hlfir.assign` wrapping an `hlfir.elemental` region. At FIR it expands into `fir.array_load`, `fir.array_fetch`, `fir.array_update`, and `fir.array_merge_store` instructions. At LLVM IR it has been fully lowered into scalar loops with `getelementptr`, `load`, `store`, and branch instructions, with any source provenance encoded only in `!DILocation` metadata.

**The root difficulty is that no single stable identifier threads through all five representations.** Source locations (`CharBlock` in the front-end, `mlir::Location` in MLIR dialects, `DILocation` at LLVM IR) are the only semantic anchor, but they are represented differently at each level and are subject to imprecise propagation during lowering passes.

### 1.2 Location Metadata: The Correlation Backbone

The tool's correctness is entirely contingent on precise location metadata threading. This section maps the metadata structures at each level:

**Level 1–2: Parse Tree & Semantics.** All parse tree nodes carry a `CharBlock` (pair of `const char*` pointers into the cooked source character buffer maintained by `Fortran::parser::AllSources`). The `CharBlock::begin()` and `CharBlock::end()` pointers allow mapping to line/column via `AllSources::GetSourcePositionRange()`. Semantic annotations are stored in the `semantics::SemanticsContext` symbol table; symbols carry `SourceName` (also a `CharBlock`) and full type information.

**Level 3–4: HLFIR and FIR.** MLIR operations carry an `mlir::Location` attribute, most commonly an `mlir::FileLineColLoc` or `mlir::FusedLoc`. Flang's lowering infrastructure in `lib/Lower/` propagates locations via `AbstractConverter::getCurrentLocation()` and `mlir::OpBuilder::setInsertionPointAndLoc()`. Every `fir` and `hlfir` operation that is lowered from a Fortran construct will carry a `loc()` attribute traceable to the originating source range. The critical API is `mlirLocationFileLineColGet()` / `mlir::FileLineColLoc::get()`.

**Level 5: LLVM IR.** After the `ConvertMLIRToLLVMIR` pass, MLIR locations are translated into `llvm::DILocation` nodes attached to `llvm::Instruction` metadata via the `!dbg` field. Every instruction originating from a Fortran source line will carry a `!DILocation(line: N, column: M, scope: !DISubprogram)` node. The LLVM `DebugInfoFinder` class provides traversal. The canonical API chain is `Instruction::getDebugLoc()` → `DILocation::getLine()`/`getColumn()`.

**The correlation algorithm** maps a user-supplied `(file, line, col)` range to:
- Parse Tree nodes via `AllSources` traversal
- MLIR operations via `mlir::FileLineColLoc` attribute matching
- LLVM instructions via `DILocation` metadata matching

### 1.3 High-Level Architecture

The architecture consists of four subsystems integrated around the `flang-new` driver infrastructure:

```
┌───────────────────────────────────────────────────────────────────┐
│                   fpc-trace CLI entry point                       │
│         --construct / --line / --col / --output flags             │
└────────────────────────┬──────────────────────────────────────────┘
                         │ drives
                         ▼
┌───────────────────────────────────────────────────────────────────┐
│               InstrumentedFlangDriver                             │
│   (wraps flang-new's CompilerInstance / FrontendAction pipeline)  │
│                                                                   │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ ParseTreeHook│  │SemanticsHook│  │ MLIRHook  │  │ LLVMHook │  │
│  │(Action wrap) │  │(after sema) │  │(pass wrap)│  │(IR pass) │  │
│  └──────┬───────┘  └──────┬──────┘  └─────┬────┘  └────┬─────┘  │
└─────────┼─────────────────┼───────────────┼────────────┼─────────┘
          │                 │               │            │
          ▼                 ▼               ▼            ▼
┌───────────────────────────────────────────────────────────────────┐
│                    SnapshotStore                                   │
│          (in-memory map keyed by SourceRange → StageSnapshot)     │
│          optional SQLite persistence for large compilations       │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                   CorrelationEngine                               │
│  - resolves SourceRange → {ParseNode, SemaNode, HLFIROps,        │
│    FIROps, LLVMInstructions}                                      │
│  - computes cross-stage cross-references                          │
│  - produces CorrelatedConstruct data model                        │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                   Reporter subsystem                              │
│   TextReporter | JSONReporter | HTMLReporter                      │
└───────────────────────────────────────────────────────────────────┘
```

The `InstrumentedFlangDriver` is the single integration point with the Flang toolchain. All other subsystems are independent of LLVM/MLIR build infrastructure and can be tested in isolation.

---

---

## 2. Core Implementation Strategy

### 2.1 Instrumentation Hooks: Design Decisions

The central architectural question is: **custom MLIR/LLVM passes vs. post-compilation dump parsing?**

**Option A — Post-compilation dump parsing** uses `flang-new -fdebug-dump-parse-tree`, `-fdebug-dump-symbols`, `-emit-mlir`, and `--emit-llvm`, then parses the textual output with regex or a custom parser. This approach is low-effort to prototype but is **architecturally fragile**: it creates a maintenance dependency on textual dump formats that are explicitly not guaranteed to be stable in Flang; it loses structural information (e.g., parent-child relationships in the Parse Tree become opaque after text serialization); and it cannot capture transient intermediate states between HLFIR and FIR passes.

**Option B — In-process C++ instrumentation** registers callbacks at well-defined API boundaries inside the Flang/MLIR infrastructure. This is more complex to implement but produces structurally correct, type-safe snapshots. This is the **recommended approach** and the one specified below.

The four hook types, their integration points, and their C++ APIs are:

#### Hook 1: Parse Tree Capture

**Integration point:** Override `Fortran::frontend::ParseSyntaxOnlyAction` (or `CodeGenAction`) and install a post-parse callback via a custom `FrontendAction` subclass.

```cpp
// In flang/lib/Frontend/FrontendActions.cpp derivative:
class TracingFrontendAction : public CodeGenAction {
  void ExecuteAction() override {
    CodeGenAction::ExecuteAction();
  }
  void afterParsing() {
    auto &parseTree = getInstance().getParsing().parseTree();
    ParseTreeSnapshot snap;
    snap.capture(parseTree, targetRange_);
    store_->addSnapshot(Stage::ParseTree, snap);
  }
};
```

The `Fortran::parser::Walk()` function with a custom visitor captures any node whose `CharBlock` source range overlaps the target. The visitor pattern is:

```cpp
struct ConstructCapturingVisitor {
  bool Pre(const Fortran::parser::AssignmentStmt &stmt) {
    auto range = GetSourceRange(stmt);  // via source_.GetSourcePositionRange()
    if (range.OverlapsWith(targetRange_)) snapshots_.push_back(Dump(stmt));
    return true;
  }
  // ... one Pre() per relevant node type
};
```

#### Hook 2: Semantics Capture

**Integration point:** After `SemanticsContext::Perform()`, traverse the symbol table. Access via `CompilerInstance::getSemantics().context()`.

```cpp
for (auto &[name, symbol] : semanticsContext.globalScope()) {
  if (symbol.name().begin() >= targetRange_.begin() &&
      symbol.name().end() <= targetRange_.end()) {
    SemanticsSnapshot snap;
    snap.addSymbol(symbol);
    store_->addSnapshot(Stage::Semantics, snap);
  }
}
```

#### Hooks 3 & 4: HLFIR and FIR Capture via MLIR Pass

**Integration point:** Insert a custom `mlir::OperationPass<mlir::ModuleOp>` into Flang's pass pipeline at two points: (a) after HLFIR lowering but before `OptimizedBufferization`, and (b) after the `HLFIRToFIR` conversion pipeline completes.

```cpp
struct PipelineTracerPass
    : public mlir::PassWrapper<PipelineTracerPass,
                               mlir::OperationPass<mlir::ModuleOp>> {
  void runOnOperation() override {
    mlir::ModuleOp module = getOperation();
    module.walk([&](mlir::Operation *op) {
      auto loc = op->getLoc();
      if (auto fileLoc = loc.dyn_cast<mlir::FileLineColLoc>()) {
        if (isInTargetRange(fileLoc)) {
          MLIRSnapshot snap;
          snap.addOperation(op, stage_);
          store_->addSnapshot(stage_, snap);
        }
      } else if (auto fusedLoc = loc.dyn_cast<mlir::FusedLoc>()) {
        for (auto innerLoc : fusedLoc.getLocations()) {
          // recurse on innerLoc
        }
      }
    });
  }
  Stage stage_;    // HLFIR or FIR
  SnapshotStore *store_;
};
```

Register the pass in Flang's `MLIRPasses.cpp` and inject into the `PipelineBuilder` via a new `TracingPipelineOptions` struct.

#### Hook 5: LLVM IR Capture via LLVM Module Pass

**Integration point:** Add a `llvm::ModulePass` at the start of the LLVM optimization pipeline (before `-O` passes run), using `PassManagerBuilder::EP_ModuleOptimizerEarly`.

```cpp
struct LLVMTracerPass : public llvm::ModulePass {
  bool runOnModule(llvm::Module &M) override {
    llvm::DebugInfoFinder finder;
    finder.processModule(M);
    for (auto &F : M) {
      for (auto &BB : F) {
        for (auto &I : BB) {
          if (auto *DL = I.getDebugLoc().get()) {
            if (isInTargetRange(DL->getLine(), DL->getColumn())) {
              LLVMSnapshot snap;
              snap.addInstruction(&I, DL);
              store_->addSnapshot(Stage::LLVMIR, snap);
            }
          }
        }
      }
    }
    return false;  // analysis-only, no IR modification
  }
};
```

### 2.2 Correlation Engine: Cross-Stage Mapping

The `CorrelationEngine` consumes the five `StageSnapshot` objects from `SnapshotStore` and produces a `CorrelatedConstruct` output model. Its core algorithm:

**Step 1 — Canonical source range resolution.** The user-supplied `(file, line, col)` or construct-name selector is resolved to a canonical `SourceRange` by querying `AllSources::GetSourcePosition()`. This range is the primary correlation key.

**Step 2 — Parse Tree node matching.** Walk the captured Parse Tree snapshot and extract all nodes whose `CharBlock` overlaps the canonical range. Output: a set of typed `ParseNodeRef` objects with node kind, text, and child structure.

**Step 3 — Semantics symbol matching.** Query the semantics snapshot for all `Symbol` entries whose `SourceName` overlaps. For each symbol, extract: name, ultimate symbol (following host/use association), declared type, and any ArraySpec attributes.

**Step 4 — MLIR operation matching.** For each MLIR operation in the HLFIR and FIR snapshots, extract the `mlir::FileLineColLoc` location. Match against the canonical range with a configurable tolerance (exact match or ±N lines for fused/macro-expanded locations). Group operations by dialect (hlfir vs. fir) and by structural containment (parent `fir.func` or `hlfir.declare` region).

**Step 5 — LLVM IR instruction matching.** Match `DILocation` metadata against canonical range. Crucially, collect not just exact-line matches but also the entire basic block containing matched instructions, since one source expression may lower into an entire BB in LLVM IR (e.g., a `DO CONCURRENT` construct may generate parallel loop infrastructure spanning many instructions).

**Step 6 — Cross-reference construction.** Build the `CorrelatedConstruct.stages[N].crossRefs` field by identifying semantic relationships between stages: e.g., an `hlfir.assign` at stage 3 maps to the `AssignmentStmt` at stage 1 and to `fir.array_merge_store` at stage 4. This is done via a lookup table populated during Flang development (a "lowering pattern registry") combined with heuristic name matching.

### 2.3 Key MLIR APIs Required

The following APIs must be imported and used correctly:

```cpp
// Location access
#include "mlir/IR/Location.h"
mlir::Location loc = op->getLoc();
if (auto fl = loc.dyn_cast<mlir::FileLineColLoc>()) {
  llvm::StringRef file = fl.getFilename();
  unsigned line = fl.getLine();
  unsigned col  = fl.getColumn();
}

// Walking an MLIR module
#include "mlir/IR/Visitors.h"
module.walk([](mlir::Operation *op) { /* inspect */ });

// Printing an operation to string
std::string buf;
llvm::raw_string_ostream os(buf);
op->print(os, mlir::OpPrintingFlags().useLocalScope());

// Dialect attribute inspection (FIR-specific)
#include "flang/Optimizer/Dialect/FIROps.h"
if (auto arrayUpdate = mlir::dyn_cast<fir::ArrayUpdateOp>(op)) {
  // access operands, result type, etc.
}
```

---

---

## 3. Step-by-Step Execution Plan

### Phase 1: Research & Environment Setup (Weeks 1–2)

**Objective:** Establish a working Flang build environment with debug info, understand the pipeline at source level, and prototype a minimal hook.

**Task 1.1 — Build Flang from source.**
Clone `llvm-project` at a pinned commit (use the latest release branch, e.g., `llvmorg-18.x`). Configure with:
```bash
cmake -G Ninja ../llvm \
  -DLLVM_ENABLE_PROJECTS="clang;flang;mlir" \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DLLVM_ENABLE_ASSERTIONS=ON \
  -DFLANG_ENABLE_TOOLS=ON \
  -DLLVM_BUILD_EXAMPLES=ON
ninja flang-new
```
The `RelWithDebInfo` + `ASSERTIONS=ON` combination is essential; assertions catch invalid IR states during hook development.

**Task 1.2 — Map the source tree.** Study these directories carefully:
- `flang/lib/Frontend/` — `FrontendActions.cpp`, `CompilerInvocation.cpp` (driver pipeline)
- `flang/lib/Lower/` — `Bridge.cpp`, `CallInterface.cpp`, `ConvertExpr.cpp` (HLFIR lowering)
- `flang/lib/Optimizer/HLFIR/` — HLFIR dialect definition and transforms
- `flang/lib/Optimizer/CodeGen/` — HLFIR→FIR→LLVM IR lowering passes
- `mlir/lib/IR/Location.cpp` — location infrastructure

**Task 1.3 — Run pipeline dumps on a test construct.** For each construct in Section 4, produce all five dumps:
```bash
flang-new -fdebug-dump-parse-tree test.f90        # Parse Tree
flang-new -fdebug-dump-symbols test.f90            # Semantics
flang-new -emit-mlir -O0 test.f90 -o test.mlir     # HLFIR+FIR (pre-opt)
flang-new -emit-mlir -O2 test.f90 -o test_opt.mlir # Post-opt FIR
flang-new -emit-llvm test.f90 -o test.ll           # LLVM IR
```
Manually correlate for three constructs. Document the location attribute propagation behavior, especially any cases where `loc()` becomes `unknown` (a known issue in Flang's lowering of certain intrinsic expansions).

**Task 1.4 — Write a minimal MLIR pass skeleton.** Implement a no-op `mlir::OperationPass<mlir::ModuleOp>` that prints all `FileLineColLoc` attributes to `stderr`. Inject it into `flang/lib/Optimizer/Passes/CMakeLists.txt` and verify it fires. This validates the build infrastructure before any correlation logic is written.

**Deliverable:** A working Flang build, a populated location metadata survey document for 3 test constructs, and a compiled no-op tracer pass.

---

### Phase 2: Pipeline Instrumentation Hooks (Weeks 3–5)

**Objective:** Implement all five capture hooks as production-quality C++ components with a stable `SnapshotStore` interface.

**Task 2.1 — Define the `SnapshotStore` data model.** In a new directory `tools/fpc-trace/lib/`, define:

```cpp
// SnapshotStore.h
enum class Stage { ParseTree, Semantics, HLFIR, FIR, LLVMIR };

struct OpRecord {
  std::string dialectName;   // "hlfir", "fir", "llvm"
  std::string opName;        // "hlfir.assign", "fir.array_update"
  std::string prettyPrint;   // full textual IR of the op
  unsigned sourceLine;
  unsigned sourceCol;
  std::string locStr;        // full loc() attribute string
};

struct StageSnapshot {
  Stage stage;
  std::vector<OpRecord> ops;
  std::string rawDump;       // full module dump for reference
};

class SnapshotStore {
public:
  void addSnapshot(Stage s, StageSnapshot snap);
  const StageSnapshot& get(Stage s) const;
private:
  std::unordered_map<Stage, StageSnapshot> data_;
};
```

**Task 2.2 — Implement Hook 1 (Parse Tree).** Subclass `Fortran::frontend::CodeGenAction`:
- Override `ExecuteAction()` to call the base, then walk `getParsing().parseTree()` with a `ConstructCapturingVisitor`.
- The visitor must handle: `AssignmentStmt`, `DoConstruct`, `WhereConstruct`, `ForallConstruct`, `CallStmt`, `DerivedTypeDef`, and all `ActionStmt` variants.
- Write 10 unit tests using `FileCheck` in `test/Tools/fpc-trace/parse-tree/`.

**Task 2.3 — Implement Hook 2 (Semantics).** After `getInstance().performSemantics()`:
- Extract `Symbol` entries from `SemanticsContext::globalScope()` and all nested scopes.
- For each symbol: record `name()`, `details()` type tag (e.g., `ObjectEntityDetails`, `ProcEntityDetails`), and any `ArraySpec` (via `ObjectEntityDetails::shape()`).
- Test against symbols declared in all 10 demo constructs.

**Task 2.4 — Implement Hooks 3 & 4 (HLFIR and FIR passes).** Write `PipelineTracerPass` as described in Section 2.1. Register at two pipeline positions in `flang/lib/Optimizer/Passes/InternalNames.cpp`. Critical: use `mlir::FusedLoc` recursion to handle intrinsic calls that wrap original locations.

**Task 2.5 — Implement Hook 5 (LLVM IR pass).** Write `LLVMTracerPass`. Integrate via `flang/lib/CodeGen/BackendUtil.cpp`'s `EmitAssemblyHelper::RunOptimizationPipeline()`. Verify with `llc -debug-only=fpc-tracer`.

**Task 2.6 — `SnapshotStore` serialization.** Implement `SnapshotStore::serialize(llvm::raw_ostream&)` using `llvm::json::OStream` for intermediate persistence. This enables reuse of snapshots without re-running compilation.

**Deliverable:** Five tested hook implementations, a working `SnapshotStore`, and a command-line flag `--fpc-trace-dump-snapshots=<dir>` that writes all five stage dumps as structured JSON.

---

### Phase 3: Correlation Engine (Weeks 6–8)

**Objective:** Implement the `CorrelationEngine` that produces `CorrelatedConstruct` output from five stage snapshots.

**Task 3.1 — Define `CorrelatedConstruct` data model.** (See Section 5.1 for full JSON schema.) The C++ counterpart:

```cpp
struct StageRepresentation {
  Stage stage;
  std::string stageName;
  std::vector<OpRecord> ops;
  std::vector<CrossRef> crossRefs; // links to other stages
};

struct CorrelatedConstruct {
  std::string constructType;
  SourceRange sourceRange;
  std::string sourceSnippet;
  std::array<StageRepresentation, 5> stages;
  std::vector<LoweringPattern> patterns;  // discovered during correlation
};
```

**Task 3.2 — Implement `SourceRangeResolver`.** Maps user input (`--line`, `--col`, `--construct-name`) to a `SourceRange` using `AllSources`. Handle the common case where the user selects a line number and the resolver must expand to the full construct (e.g., line 10 of a DO CONCURRENT that spans lines 10–20).

**Task 3.3 — Implement `MLIRLocationMatcher`.** Takes a `SourceRange` and a `StageSnapshot`, returns `std::vector<OpRecord>`. Must handle:
- Exact `FileLineColLoc` matches.
- `FusedLoc` with any component matching.
- Parent-region inference: if `hlfir.assign` is matched, also capture its immediately enclosing `fir.func` for context.

**Task 3.4 — Implement `LLVMLocationMatcher`.** Takes a `SourceRange` and `StageSnapshot` of LLVM IR, returns `std::vector<OpRecord>` at instruction granularity. Additionally extract the parent `BasicBlock` and `Function` for context.

**Task 3.5 — Implement `CrossRefBuilder`.** Populates the `crossRefs` field using two strategies:
- **Name-based heuristics:** An `hlfir.assign` matches to `AssignmentStmt`; `hlfir.forall` matches to `ForallConstruct`; `fir.do_loop` matches to `DoConstruct`. These mappings are stored in a static `LoweringPatternRegistry` table.
- **Location-based inference:** Operations at the same line/col across stages are cross-referenced by default.

**Task 3.6 — Integration test suite.** Write 10 end-to-end tests (one per demo construct) using `lit` infrastructure. Each test: compiles a `.f90` file with the tracer, verifies the JSON output contains expected node kinds at each stage.

**Deliverable:** `CorrelationEngine` producing structurally correct `CorrelatedConstruct` JSON for all 10 demo constructs, validated by a `lit` test suite.

---

### Phase 4: CLI Tool, Reporting, and Demonstrations (Weeks 9–12)

**Objective:** Build the user-facing CLI, implement all three reporters (text, JSON, HTML), and produce the 10-construct demonstration artifacts.

**Task 4.1 — CLI design (`fpc-trace`).** Using `llvm::cl` option parsing:

```bash
fpc-trace [options] <input.f90>

Options:
  --construct=<name>         Fortran construct type to trace (e.g., DO_CONCURRENT)
  --line=<n>                 Source line of the construct
  --col=<n>                  Source column (optional, default 1)
  --end-line=<n>             End line for range selection (optional)
  --output=<text|json|html>  Output format (default: text)
  --output-file=<path>       Output destination (default: stdout)
  --stages=<list>            Comma-separated stages to include (default: all)
  --snapshot-dir=<path>      Persist stage snapshots to directory
  --verbose                  Include full module context (not just matched ops)
  --lowering-patterns        Emit discovered lowering pattern summary
```

**Task 4.2 — `TextReporter`.** Produces colored terminal output using ANSI escape codes (via `llvm::WithColor`). Format:

```
━━━ fpc-trace: Construct Trace Report ━━━
Construct: DO CONCURRENT (line 12–18, test.f90)

[Stage 1: Parse Tree]
  DoConstruct (line 12–18)
  └─ DoLoopControl (CONCURRENT)
     └─ ConcurrentHeader
        └─ ConcurrentControl: i = 1, N

[Stage 3: HLFIR]
  hlfir.forall (%i = %c1 to %N step %c1) {
    hlfir.region_assign { ... }
  } loc("test.f90":12:3)
  ↑ cross-ref: DoConstruct @ Parse Tree

[Stage 4: FIR]
  fir.do_loop %i = %c1 to %N step %c1 unordered {
    ...
  } loc("test.f90":12:3)
```

**Task 4.3 — `JSONReporter`.** Serializes `CorrelatedConstruct` to JSON (see Section 5.1 schema). Uses `llvm::json::Object`.

**Task 4.4 — `HTMLReporter`.** Generates a self-contained HTML file (single file, no external dependencies) with a five-column side-by-side view. See Section 5.2 for the interface design specification. Use `llvm::raw_string_ostream` to generate the HTML, with inline CSS and JavaScript for the tab/expand interactions.

**Task 4.5 — Produce 10 demonstration artifacts.** For each construct in Section 4, run `fpc-trace` and produce:
- A `.json` trace file
- A `.html` annotated view
- A paragraph of "lowering pattern notes" for the documentation

**Task 4.6 — Lowering patterns documentation.** Compile the 10 pattern notes into a Markdown reference document `docs/lowering-patterns.md` explaining the key lowering patterns discovered: array operation scalarization, concurrent loop parallelization IR, polymorphic dispatch table layout, coarray runtime call injection, etc.

**Deliverable:** Working `fpc-trace` binary, 10 HTML demo artifacts, and `lowering-patterns.md` documentation.

---

---

## 4. The 10 Constructs Demo Strategy

The following constructs are selected to exercise the maximum diversity of Flang's lowering pipeline, covering array operations, control flow, type system features, and parallelism abstractions.

### Construct 1: Whole-Array Assignment with Intrinsic

```fortran
A(:) = MATMUL(B, C) + D(:)
```

**Why this construct:** Exercises the HLFIR `hlfir.assign` + `hlfir.elemental` + `hlfir.apply` chain. At FIR level, the intrinsic `MATMUL` is dispatched to `fir.call @_FortranAMatmul`, making this an excellent test of runtime call injection. The `+ D(:)` triggers array temporization logic. At LLVM IR level, the loop structure and pointer arithmetic generated by array descriptor (`fir.box`) lowering is visible.

### Construct 2: DO CONCURRENT with Locality Specifications

```fortran
DO CONCURRENT (i = 1:N, j = 1:M) LOCAL(tmp)
  A(i,j) = SQRT(B(i,j)) * tmp
END DO
```

**Why this construct:** DO CONCURRENT is Flang's primary parallelism construct and has its own specialized lowering path through `hlfir.forall` → `fir.do_loop` (with `unordered` attribute). The `LOCAL` locality clause must be tracked through semantics (it creates a new scope) and verified at FIR level (a per-iteration `fir.alloca` should appear). At LLVM IR, the `!llvm.loop` parallel metadata annotation should be present.

### Construct 3: WHERE Block with ELSEWHERE

```fortran
WHERE (A > 0.0)
  B = LOG(A)
  C = SQRT(A)
ELSEWHERE
  B = 0.0
  C = 0.0
END WHERE
```

**Why this construct:** `WHERE` constructs are lowered through a mask-array scalarization path unique to Flang. At HLFIR, `hlfir.where` and `hlfir.elsewhere` regions appear. At FIR, the mask is computed into a temporary logical array and applied via conditional logic. This construct tests the mask-variable lifetime tracking across stages.

### Construct 4: FORALL with Subscript Triplet

```fortran
FORALL (i = 1:N, j = 1:N, A(i,j) /= 0.0)
  B(i,j) = 1.0 / A(i,j)
END FORALL
```

**Why this construct:** FORALL is semantically distinct from DO CONCURRENT (it has defined assignment semantics requiring temporaries). The mask expression `A(i,j) /= 0.0` generates a temporary boolean array in FIR. This construct demonstrates how the HLFIR-to-FIR lowering handles FORALL's complex dependency semantics differently from DO CONCURRENT.

### Construct 5: Assumed-Shape Array Dummy Argument

```fortran
SUBROUTINE proc(A, B)
  REAL, INTENT(IN)  :: A(:,:)
  REAL, INTENT(OUT) :: B(:,:)
  B = TRANSPOSE(A)
END SUBROUTINE
```

**Why this construct:** Assumed-shape arrays require `fir.box` (array descriptor) handling throughout the pipeline. The `fir.box` structure encodes bounds, stride, and element type. At LLVM IR, `fir.box` lowers to a struct of `{ ptr, i64, i64, ... }` fields accessed via `getelementptr`. This construct is critical for understanding Flang's ABI for array arguments.

### Construct 6: Polymorphic Variable and SELECT TYPE

```fortran
CLASS(*), INTENT(IN) :: x
SELECT TYPE (x)
  TYPE IS (INTEGER) ; print *, "int:", x
  TYPE IS (REAL)    ; print *, "real:", x
  CLASS IS (Animal) ; call x%speak()
END SELECT
```

**Why this construct:** Polymorphic dispatch is the most complex lowering in Flang. `CLASS(*)` variables require unlimited polymorphism support via `fir.class` descriptors. `SELECT TYPE` lowers to a sequence of `fir.is_present` + type-code comparison + `fir.dispatch` operations. At LLVM IR, the dispatch table pointer dereference pattern is visible. This construct exercises the full type descriptor infrastructure.

### Construct 7: Coarray Communication

```fortran
A[target_image] = local_value
SYNC ALL
result = B[source_image]
```

**Why this construct:** Coarray operations are lowered to calls into the OpenCoarrays or MPI-based coarray runtime library (`_FortranACoarrayStore`, `_FortranASyncAll`, etc.). At HLFIR and FIR levels, coarray accesses appear as `hlfir.copy_in`/`hlfir.copy_out` or direct `fir.call` to runtime functions with coarray descriptors. This construct demonstrates how source-level parallel semantics map to runtime library boundaries.

### Construct 8: Derived Type with Allocatable Component

```fortran
TYPE :: grid_t
  REAL, ALLOCATABLE :: data(:,:)
  INTEGER :: nx, ny
END TYPE
TYPE(grid_t) :: g
ALLOCATE(g%data(100, 100))
g%data = 0.0
DEALLOCATE(g%data)
```

**Why this construct:** Allocatable component management requires `fir.type_desc`, `fir.field_index`, and `fir.coordinate_of` to navigate struct fields. The `ALLOCATE` statement lowers to `_FortranAAllocatableAllocate` runtime calls. The subsequent whole-array assignment `g%data = 0.0` triggers array descriptor + elemental lowering through the allocatable's `fir.box`. This tests derived type struct layout in LLVM IR.

### Construct 9: Generic Interface with Elemental Function

```fortran
INTERFACE add
  ELEMENTAL FUNCTION add_i(a, b) RESULT(c)
    INTEGER, INTENT(IN) :: a, b
    INTEGER :: c
    c = a + b
  END FUNCTION
  ELEMENTAL FUNCTION add_r(a, b) RESULT(c)
    REAL, INTENT(IN) :: a, b
    REAL :: c
    c = a + b
  END FUNCTION
END INTERFACE
result_int  = add(x_int, y_int)
result_real = add(x_real, y_real)
```

**Why this construct:** Generic interface resolution happens at semantics (the `ResolveNames` pass selects the specific procedure). The `ELEMENTAL` attribute means that array arguments trigger array-valued calls through a scalarization loop at FIR level. This construct tests how generic resolution at semantics level maps to distinct function calls in LLVM IR, with each specific function inlined or called directly.

### Construct 10: Internal Subprogram with Host Association

```fortran
SUBROUTINE outer(n)
  INTEGER :: n, counter = 0
  CALL inner(n)
CONTAINS
  SUBROUTINE inner(m)
    INTEGER, INTENT(IN) :: m
    counter = counter + m   ! host-associated
  END SUBROUTINE
END SUBROUTINE
```

**Why this construct:** Host association (accessing `counter` from `inner`) requires Flang to create a "host association tuple" — a struct passed as an additional implicit argument to `inner` containing a pointer to `counter`. At FIR level, `fir.embox`/`fir.load` on the host tuple pointer is visible. At LLVM IR, the extra argument appears in the function signature. This construct tests the complete host association ABI, which is a common source of confusion for Flang developers.

---

---

## 5. Output Design: CLI, JSON Schema & HTML Interface

### 5.1 JSON Schema: `CorrelatedConstruct`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CorrelatedConstruct",
  "type": "object",
  "required": ["schemaVersion", "construct", "source", "stages"],
  "properties": {
    "schemaVersion": { "type": "string", "const": "1.0" },
    "construct": {
      "type": "object",
      "properties": {
        "type":        { "type": "string", "description": "e.g. DO_CONCURRENT, ARRAY_ASSIGNMENT, WHERE_BLOCK" },
        "name":        { "type": "string", "description": "Optional user-visible label" },
        "complexity":  { "type": "integer", "description": "Approximate FIR op count, for sorting/filtering" }
      }
    },
    "source": {
      "type": "object",
      "properties": {
        "file":        { "type": "string" },
        "startLine":   { "type": "integer" },
        "startCol":    { "type": "integer" },
        "endLine":     { "type": "integer" },
        "endCol":      { "type": "integer" },
        "snippet":     { "type": "string", "description": "Verbatim source lines, max 50 lines" }
      }
    },
    "stages": {
      "type": "array",
      "minItems": 5,
      "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["stageId", "stageName", "representations"],
        "properties": {
          "stageId":   { "type": "integer", "minimum": 1, "maximum": 5 },
          "stageName": { "type": "string", "enum": ["ParseTree","Semantics","HLFIR","FIR","LLVMIR"] },
          "representations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id":          { "type": "string", "description": "Stable opaque identifier for cross-referencing" },
                "kind":        { "type": "string", "description": "AST node kind or MLIR op name or LLVM instruction type" },
                "dialect":     { "type": "string", "description": "MLIR dialect: hlfir, fir, llvm, or null for non-MLIR stages" },
                "text":        { "type": "string", "description": "Textual representation of this node/op/instruction" },
                "location": {
                  "type": "object",
                  "properties": {
                    "file":   { "type": "string" },
                    "line":   { "type": "integer" },
                    "col":    { "type": "integer" },
                    "locStr": { "type": "string", "description": "Full MLIR loc() attribute string if available" }
                  }
                },
                "parentContext": { "type": "string", "description": "Enclosing fir.func or llvm.func name" },
                "attributes": {
                  "type": "object",
                  "description": "Key-value map of relevant dialect-specific attributes",
                  "additionalProperties": { "type": "string" }
                },
                "crossRefs": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "targetStage": { "type": "string" },
                      "targetId":    { "type": "string" },
                      "refKind":     {
                        "type": "string",
                        "enum": ["lowers_to", "lowered_from", "corresponds_to", "generates"]
                      },
                      "confidence":  { "type": "number", "minimum": 0.0, "maximum": 1.0 }
                    }
                  }
                }
              }
            }
          },
          "rawModuleContext": { "type": "string", "description": "Full containing fir.func or llvm.func for reference; omitted by default" }
        }
      }
    },
    "loweringPatterns": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "patternName":  { "type": "string" },
          "description":  { "type": "string" },
          "sourceStage":  { "type": "string" },
          "targetStage":  { "type": "string" },
          "exampleKind":  { "type": "string" }
        }
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "flangVersion":   { "type": "string" },
        "llvmCommit":     { "type": "string" },
        "traceTimestamp": { "type": "string", "format": "date-time" },
        "optimizationLevel": { "type": "string", "enum": ["O0","O1","O2","O3"] }
      }
    }
  }
}
```

### 5.2 HTML Interface Design Specification

The HTML reporter produces a **self-contained single-file** output. The layout is a five-column horizontal panel view for desktop and a vertically stacked accordion for mobile.

**Visual layout (desktop — five columns at ~20% each):**

```
┌─────────────────────────────────────────────────────────────────────┐
│  fpc-trace — Pipeline Trace: DO CONCURRENT (test.f90:12–18)        │
│  [↓ JSON] [↑ expand all] [filter: show crossrefs only]             │
├──────────┬──────────┬──────────┬──────────┬─────────────────────────┤
│ Source   │ Parse    │ HLFIR    │ FIR      │ LLVM IR                 │
│  .f90    │  Tree    │  ops     │  ops     │  instructions           │
├──────────┼──────────┼──────────┼──────────┼─────────────────────────┤
│ DO CON-  │ DoConstr │ hlfir    │ fir      │ define internal         │
│ CURRENT  │ uct      │ .forall  │ .do_loop │ void @_QFtest...        │
│ (i=1:N,  │ ├DoLoop  │ (%i =    │  %i =    │   ...                   │
│  j=1:M)  │  Control │  %c1 to  │  %c1 to  │   br label %bb1         │
│ LOCAL    │ ├Concurr  │  %N) {   │  %N step │ bb1:                    │
│  (tmp)   │  entHdr  │  hlfir   │  %c1 un  │   %tmp = alloca ...     │
│ A(i,j) = │ ├Concurr  │  .region │  ordered │   %0 = getelementptr   │
│ SQRT(B)  │  entCtrl │  _assign │  {       │   ...                   │
│  * tmp   │ └...      │    { }   │   fir    │   store float ...       │
│          │          │ }        │  .call   │                         │
│          │          │          │  @_Frt   │                         │
├──────────┼──────────┼──────────┼──────────┼─────────────────────────┤
│ ● Hover  any highlighted element to see its cross-stage references  │
│ ● Click to pin. Click the arrow (→) to jump to the correlated op.  │
└─────────────────────────────────────────────────────────────────────┘
```

**Interaction model:**
- Each `<div>` representing an op or node is assigned a `data-id` attribute matching its JSON `id` field.
- Cross-references are stored in a JavaScript `crossRefMap` object keyed by `data-id`.
- `mouseover` on any element highlights all correlated elements in other columns with a color-coded border (distinct color per stage: purple=ParseTree, blue=HLFIR, teal=FIR, orange=LLVMIR).
- `click` pins the highlight state; a second click unpins.
- A toggle button switches from "full module view" (entire `fir.func` context) to "construct-only view" (only matched ops).
- A "Download JSON" button is wired to `Blob` + `URL.createObjectURL()`.

**Color coding:**
- Stage 1 (Parse Tree): `#7B68EE` (medium slate blue)
- Stage 2 (Semantics): `#20B2AA` (light sea green)
- Stage 3 (HLFIR): `#4682B4` (steel blue)
- Stage 4 (FIR): `#2E8B57` (sea green)
- Stage 5 (LLVM IR): `#CD853F` (peru/amber)
- Cross-reference highlight: `2px solid <stage-color>` + `background: <stage-color>1A` (10% opacity)

**Lowering Patterns panel:** Below the five-column view, a collapsible `<details>` section renders the `loweringPatterns` array as a table with columns: Pattern, Source Stage, Target Stage, Description.

---

---

## 6. Appendix: Key MLIR/LLVM API Reference

### FIR Dialect Operations (relevant to tracing)

| FIR Op | Fortran construct | Key attributes |
|--------|------------------|----------------|
| `fir.do_loop` | DO / DO CONCURRENT | `unordered` attr for CONCURRENT |
| `fir.array_load` | Array section read | `typeparams`, `slice` operands |
| `fir.array_update` | Array element write | Result type = `fir.array` |
| `fir.array_merge_store` | Array section assignment | Completes array update sequence |
| `fir.embox` | Allocatable/pointer boxing | Produces `fir.box<T>` descriptor |
| `fir.box_addr` | Box address extraction | Unwraps `fir.box` to raw pointer |
| `fir.call` | CALL / function call | Direct or indirect via `fir.functype` |
| `fir.dispatch` | Polymorphic method call | `method` attribute = TBP name |
| `fir.type_desc` | Derived type descriptor | Used in SELECT TYPE |
| `fir.field_index` | Derived type field access | `name` attribute = component name |
| `fir.coordinate_of` | Component address | Used with `fir.field_index` |
| `fir.alloca` | LOCAL variable in CONCURRENT | `in_type` attribute |

### HLFIR Dialect Operations

| HLFIR Op | Fortran construct | Notes |
|----------|------------------|-------|
| `hlfir.declare` | Variable declaration | Carries `fir.shape`, `fir.char_len` |
| `hlfir.assign` | Assignment statement | `realloc` flag for allocatables |
| `hlfir.elemental` | ELEMENTAL function call | Wraps scalar body in region |
| `hlfir.apply` | Apply elemental to array | Reduces to loop in FIR |
| `hlfir.forall` | FORALL / DO CONCURRENT | `order` attr distinguishes |
| `hlfir.where` | WHERE construct mask | `mask` block + `body` block |
| `hlfir.copy_in` | Array temp for contiguity | Generated for non-contiguous sections |
| `hlfir.destroy` | Temporary cleanup | Paired with `hlfir.copy_in` |
| `hlfir.concat` | Character concatenation | `//` operator |

### Critical Build Flags for Tracer Development

```bash
# Enable MLIR debug output for a specific pass
flang-new -mmlir --debug-only=fpc-tracer-pass input.f90

# Dump MLIR between every pass (very verbose, useful for pass ordering)
flang-new -mmlir --mlir-print-ir-after-all input.f90 2>all_stages.mlir

# Verify IR after every pass (catches invalid IR from hook modifications)
flang-new -mmlir --mlir-print-ir-after-failure input.f90

# Print pass pipeline (to understand injection points)
flang-new -mmlir --mlir-print-pass-pipeline input.f90

# Disable optimizations for cleaner correlation (recommended for tracing)
flang-new -O0 -g input.f90
```

### Location Propagation Known Issues

During Phase 1 research, verify the following known Flang behaviors:

1. **Intrinsic call location loss:** Some intrinsic function expansions in `flang/lib/Lower/IntrinsicCall.cpp` create operations with `mlir::UnknownLoc`. The tracer must handle this gracefully by falling back to the enclosing construct's location.

2. **FusedLoc in inlining:** After FIR inlining passes, locations become `FusedLoc` with metadata attributes. The tracer's `MLIRLocationMatcher` must recursively decompose `FusedLoc`.

3. **LLVM IR location stripping at `-O2`:** The LLVM inliner and loop vectorizer may strip or merge `DILocation` metadata. Run the tracer at `-O0` for reliable location correlation; at `-O2`, use the `--verbose` flag to include full BB context.

4. **Column information gaps:** Flang's parser populates column information inconsistently for certain statement types (notably continuation lines in fixed-form). The `SourceRangeResolver` should tolerate column=0 matches and fall back to line-only correlation.

---

*Document version 1.0. Generated for HPE Assignment 33 — Flang Multi-Stage Compilation Pipeline Tracer.*
*Intended audience: compiler engineers with LLVM/MLIR background. Assumes familiarity with C++17, CMake, and the LLVM build system.*
