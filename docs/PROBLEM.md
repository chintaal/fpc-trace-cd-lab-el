# The Problem fpc-trace Solves

*Assignment 33 · HPE Flang · Compiler Design Lab*

---

## Table of Contents

- [Background: Flang's Pipeline](#background-flangs-pipeline)
- [The Gap No Tool Fills](#the-gap-no-tool-fills)
- [Concrete Pain Points](#concrete-pain-points)
- [What Flang Developers Actually Do Today](#what-flang-developers-actually-do-today)
- [Why This Matters](#why-this-matters)
- [The fpc-trace Solution](#the-fpc-trace-solution)
- [Assignment Objectives](#assignment-objectives-original-brief)

---

## Background: Flang's Pipeline

Flang (the LLVM Fortran compiler) is unique among LLVM frontends in having **five or more distinct intermediate representations** between source code and machine code. Unlike Clang (which goes straight to LLVM IR) or MLIR-based projects with two or three levels, Flang's pipeline looks like this:

```
Fortran Source (.f90)
       │
       │  flang-new -fdebug-dump-parse-tree -fsyntax-only
       ▼
┌────────────────────────────────────────────────────────┐
│  PARSE TREE                                            │
│  • Concrete syntax tree from the Fortran parser        │
│  • No types, no semantics — pure grammar structure     │
│  • Nodes: SubroutineSubprogram, DoConstruct,          │
│    AssignmentStmt, WhereConstruct, ForallConstruct…    │
└────────────────────────┬───────────────────────────────┘
                         │ semantic analysis
                         │  flang-new -fdebug-dump-symbols -fsyntax-only
                         ▼
┌────────────────────────────────────────────────────────┐
│  SEMANTICS (Decorated Parse Tree)                      │
│  • Types resolved (INTEGER(4), REAL(8), CLASS(T)…)    │
│  • Aliasing analysis completed                         │
│  • Interface conformance checked                       │
│  • Generic overloads resolved to specific procedures   │
│  • Coarray image indices annotated                     │
└────────────────────────┬───────────────────────────────┘
                         │ HLFIR lowering
                         │  flang-new -emit-fir --mlir-print-ir-after-all
                         ▼
┌────────────────────────────────────────────────────────┐
│  HLFIR  (High-Level FIR — MLIR-based)                 │
│  • Array semantics preserved as value types            │
│  • hlfir.elemental: element-wise ops as expressions    │
│  • hlfir.assign / hlfir.matmul: high-level intrinsics │
│  • Temporary lifetimes tracked (hlfir.destroy)         │
│  • Independence guaranteed via 'unordered' attribute   │
└────────────────────────┬───────────────────────────────┘
                         │ FIR materialization
                         │  flang-new -emit-fir --mlir-print-ir-before-all
                         ▼
┌────────────────────────────────────────────────────────┐
│  FIR  (Fortran IR — MLIR-based)                        │
│  • Loops materialised: fir.do_loop                     │
│  • Memory model applied: fir.array_load/fetch/update   │
│  • Copy-in/copy-out via fir.array_merge_store          │
│  • Runtime calls introduced: fir.call @_FortranAXxx   │
│  • Struct navigation: fir.field_index + coordinate_of │
└────────────────────────┬───────────────────────────────┘
                         │ LLVM lowering
                         │  flang-new -emit-llvm -S -O0 -g
                         ▼
┌────────────────────────────────────────────────────────┐
│  LLVM IR                                               │
│  • Target-independent machine model                    │
│  • getelementptr for all array/struct access           │
│  • phi nodes for loop induction variables              │
│  • !DILocation debug metadata for source correlation   │
│  • Vectoriser input: unordered loops become SIMD       │
└────────────────────────┬───────────────────────────────┘
                         │ code generation
                         ▼
                   Machine Code
```

This is **more IR levels than any other LLVM frontend**. It exists because Fortran has semantics that have no direct LLVM IR equivalent — array conformance, coarray remote access, polymorphic dispatch through type descriptors, and FORALL/DO CONCURRENT parallelism guarantees.

---

## The Gap No Tool Fills

| What a developer wants to know | Existing tools | Gap |
|-------------------------------|----------------|-----|
| What parse tree nodes does `DO CONCURRENT` produce? | `flang-new -fdebug-dump-parse-tree` | Thousands of unfiltered lines; manual search |
| How does `WHERE (x > 0)` become IR? | No tool | Completely manual |
| Which HLFIR ops correspond to line 9 of my source? | None | Nothing correlates line → HLFIR |
| How does `a = MATMUL(b, c)` differ from `a = b + c` in FIR? | None | No comparison mode exists |
| What calls does my coarray program make to the runtime? | Manual grep through LLVM IR | Tedious, error-prone |
| Will my loop vectorize? | LLVM opt-viewer (`-O2` only) | No FIR/HLFIR context; no Flang understanding |

**Godbolt** shows LLVM IR (and sometimes assembly) but has no concept of FIR, HLFIR, or Flang's parse tree. It is a general-purpose tool that doesn't understand Flang's multi-level pipeline.

**LLVM's opt-viewer** analyses optimisation remarks at LLVM IR level but has no understanding of Flang's MLIR-based pipeline stages above LLVM IR.

**flang-new CLI flags** dump individual stages but require separate invocations, produce thousands of lines, and provide no correlation between them.

---

## Concrete Pain Points

### 1. Manual correlation is fragile

When a Flang developer investigates why `DO CONCURRENT` doesn't vectorize, they:

```bash
# Step 1: get parse tree
flang-new -fdebug-dump-parse-tree -fsyntax-only my_loop.f90 > pt.txt

# Step 2: get HLFIR
flang-new -emit-fir -S -mmlir --mlir-print-ir-after-all my_loop.f90 > hlfir.mlir 2>&1

# Step 3: get LLVM IR
flang-new -emit-llvm -S -O0 -g my_loop.f90 -o my_loop.ll

# Step 4: manually find line 42 of source in each output
grep -n "42:" pt.txt hlfir.mlir my_loop.ll   # usually fails; location format differs
```

This fails for:
- **Intrinsic expansions**: `SQRT`, `MATMUL` → `UnknownLoc` in HLFIR
- **Inlining**: `FusedLoc` after procedure inlining
- **Implicit loops**: WHERE body doesn't have an explicit loop in source

### 2. The dumps are enormous

A simple subroutine with a `WHERE` block produces:
- Parse tree: ~200 lines
- HLFIR: ~500 lines (when all MLIR passes are dumped)
- FIR: ~300 lines
- LLVM IR: ~150 lines (simple; grows with `-O0` debug info)

Finding the relevant 10 lines for a specific construct among 1,200 total is time-consuming.

### 3. No comparison capability

Understanding the `unordered` attribute requires comparing:
- `DO CONCURRENT (i = 1:n) a(i) = b(i)` (has `unordered`)
- `DO i = 1, n; a(i) = b(i); END DO` (does not)

There is no tool that shows these side-by-side at FIR or HLFIR level.

### 4. Knowledge is siloed

The lowering patterns that experienced Flang developers know (e.g., "WHERE always becomes `arith.select`, not a branch") are not documented anywhere in a findable, structured form.

---

## What Flang Developers Actually Do Today

Based on the Flang development community's practice:

```
Flang developer wants to understand how FORALL lowers...

1. Writes a minimal .f90 with the construct               (~5 min)
2. Runs 4-5 different flang-new invocations               (~10 min)
3. Opens 4-5 output files in parallel                     (cognitive load)
4. Manually searches each for relevant line numbers       (~20 min)
5. Mentally correlates source → parse tree → HLFIR → FIR → LLVM  (~30 min)
6. Documents findings in a PR comment or Discourse post   (~20 min)

Total: ~85 minutes for one construct
```

With fpc-trace:

```
1. Open dashboard, click FORALL in sidebar               (30 seconds)
2. Click source line 11: FORALL (i = 1:n, j = 1:n)     (2 seconds)
3. Read vertical trace flow card: PT → SEM → HLFIR → FIR → LLVM  (2 minutes)
4. Click Compare → select FORALL vs DO CONCURRENT        (30 seconds)
5. Read ops unique to FORALL (no 'unordered')            (1 minute)

Total: ~4 minutes for one construct, with deeper insight
```

---

## Why This Matters

### For HPE / Flang upstream

HPE is a major contributor to Flang. Understanding and documenting the lowering pipeline is directly relevant to:
- Optimisation pass development (knowing what HLFIR ops exist to target)
- Bug investigation (correlating IR regressions to source)
- Onboarding new contributors to the Flang codebase
- Designing new Fortran standard features (knowing the implementation path)

### For the academic community

Flang's multi-level IR is a unique case study in MLIR-based compiler design. No paper has yet documented the full lowering chain for complex Fortran constructs. This tool provides:
- An interactive reference for teaching compiler design
- Data for research on multi-level IR correlation
- A reproducible artifact for compiler benchmarking

### For Fortran application developers

HPC applications written in Fortran (OpenFOAM, GROMACS, climate models) rely on the compiler's ability to vectorize, parallelize, and optimize. Understanding what the compiler does with `DO CONCURRENT` or `WHERE` blocks enables developers to:
- Verify their intent is being honoured (`unordered` present?)
- Diagnose performance issues (heap allocation where none expected?)
- Make informed decisions about language features

---

## The fpc-trace Solution

fpc-trace addresses every gap identified above:

| Pain Point | fpc-trace Solution |
|------------|-------------------|
| Manual dump correlation | Automatic `#loc` / `!DILocation` correlation engine |
| Enormous dump volumes | Filtered, construct-focused views with key ops extracted |
| No comparison | Side-by-side compare mode at any stage |
| Knowledge silos | 14 lowering patterns documented and searchable |
| Multiple invocations | One tool, one command, all five stages |
| No AI explanation | Optional Claude narration per source line |

---

## Assignment Objectives (Original Brief)

> *Build a tool that, given a Fortran source file and a highlighted construct (array assignment, DO CONCURRENT, derived type operation), traces that construct through Parse Tree → FIR → HLFIR → LLVM IR, showing the representation at each stage with cross-references.*

### Deliverables from the brief

1. **Pipeline instrumentation hooks** at each Flang stage capturing per-construct representations → [`engine/compiler_runner.py`](../tracer/backend/engine/compiler_runner.py) + [`TRACK_B_HOOKS.md`](TRACK_B_HOOKS.md)

2. **Cross-stage correlation engine** mapping source constructs to IR representations → [`engine/correlation.py`](../tracer/backend/engine/correlation.py)

3. **CLI tool** producing annotated multi-level output (text, HTML, JSON) → [`tracer/cli.py`](../tracer/cli.py)

4. **Demonstration on 10 complex Fortran constructs** (array operations, DO CONCURRENT, polymorphism, coarrays, WHERE blocks) → [`samples/pregenerated/`](../tracer/backend/samples/pregenerated/)

5. **Documentation of lowering patterns** discovered, useful as a Flang developer reference → [`docs/lowering-patterns.md`](lowering-patterns.md)
