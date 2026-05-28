# Building Flang for fpc-trace

Track A only needs a working `flang-new` binary. Track B requires building Flang from source with your tracer pass linked in.

## Prerequisites

- macOS or Linux, ~30 GB disk for llvm-project
- CMake ≥ 3.20, Ninja, C++17 compiler
- Python ≥ 3.10 (Track A)

## Option 1 — Use system / package Flang (Track A fastest)

If your lab provides Flang 18+:

```bash
which flang-new || which flang
export FLANG_BIN="$(which flang-new 2>/dev/null || which flang)"
flang-new --version
```

## Option 2 — Build llvm-project (Track A + B)

```bash
git clone https://github.com/llvm/llvm-project.git "$LLVM_PROJECT_ROOT"
cd "$LLVM_PROJECT_ROOT"
git checkout llvmorg-18.1.0   # pin; record in research/location_survey.md

cmake -G Ninja -S llvm -B build \
  -DLLVM_ENABLE_PROJECTS="clang;flang;mlir" \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DLLVM_ENABLE_ASSERTIONS=ON \
  -DFLANG_ENABLE_TOOLS=ON

ninja -C build flang-new
export FLANG_BIN="$LLVM_PROJECT_ROOT/build/bin/flang-new"
```

Expect 1–3 hours on a modern laptop; use `-j$(nproc)` via `ninja -C build -j8`.

## Verify pipeline dumps

```bash
export FLANG_BIN=...
./scripts/collect_pipeline_dumps.sh tracer/backend/samples/01_array_assignment.f90
ls .snapshots/01_array_assignment/
# parse-tree.txt  symbols.txt  pre-opt.mlir  llvm.ll  meta.json
```

## Track B — In-process hooks (optional)

Track B requires modifying the llvm-project Flang tree. See [TRACK_B_HOOKS.md](TRACK_B_HOOKS.md) for the hook design and CMake integration checklist. The shipped assignment uses **Track A** (subprocess dumps via `tracer/backend/engine/compiler_runner.py`).

## Docker (optional, lab machines)

```dockerfile
# docs/Dockerfile.example — not built by default
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y cmake ninja-build python3 git
# ... clone and build llvm-project ...
```

## Debug flags reference

```bash
flang-new -O0 -g input.f90 -fdebug-dump-parse-tree
flang-new -O0 -g input.f90 -fdebug-dump-symbols
flang-new -O0 -g input.f90 -emit-mlir -o out.mlir
flang-new -O0 -g input.f90 -S -emit-llvm -o out.ll
flang-new -mmlir --mlir-print-pass-pipeline input.f90 2>&1 | head
```
