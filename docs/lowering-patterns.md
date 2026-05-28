# Flang Lowering Patterns Reference

*Discovered via fpc-trace — Assignment 33 · Flang Pipeline Construct Tracer*

This document catalogs key IR transformation patterns in Flang's compilation pipeline, traced from Fortran source through Parse Tree → Semantics → FIR → HLFIR → LLVM IR.

---

## Pattern Index

| # | Pattern | Construct | Key Op |
|---|---------|-----------|--------|
| 1 | [Elemental Array Op](#1-elemental-array-op) | `a = b + c` | `hlfir.elemental` → `fir.do_loop` |
| 2 | [Array Merge Store](#2-array-merge-store) | Array assignment | `fir.array_merge_store` |
| 3 | [DO CONCURRENT Unordered](#3-do-concurrent-unordered) | DO CONCURRENT | `unordered` attribute |
| 4 | [WHERE Mask → select](#4-where-mask--arithselect) | WHERE | `arith.select` (branchless) |
| 5 | [FORALL 2-D Elemental](#5-forall-2-d-elemental) | FORALL | 2-D `hlfir.elemental` |
| 6 | [Column-Major GEP](#6-fortran-column-major-gep) | 2-D arrays | GEP `(j-1)*n + (i-1)` |
| 7 | [Derived Type Field Chain](#7-derived-type-field-chain) | `p%pos%x` | `fir.field_index` + `fir.coordinate_of` |
| 8 | [Virtual Dispatch vtable](#8-virtual-dispatch-vtable) | `CLASS(T)%method()` | `fir.dispatch` → indirect call |
| 9 | [SELECT TYPE ClassIs chain](#9-select-type--classis-chain) | SELECT TYPE | `@_FortranAClassIs` |
| 10 | [Coarray Remote Get ABI](#10-coarray-remote-get-abi) | `a(n)[img]` | `@_caf_get` |
| 11 | [Transformational Intrinsic ABI](#11-transformational-intrinsic-abi) | MATMUL | `@_FortranAMatmul` |
| 12 | [Recursive No-TCO](#12-recursive-no-tco) | RECURSIVE FUNCTION | `alloca` per frame |
| 13 | [Generic Overload Resolution](#13-generic-overload-resolution) | INTERFACE | compile-time → monomorphic |
| 14 | [MERGE → arith.select](#14-merge--arithselect) | MERGE intrinsic | `arith.select` |

---

## 1. Elemental Array Op

**Source:** `a = b + c` (rank-1 arrays, subroutine dummy args)

```
Parse Tree: AssignmentStmt → Level2Expr → AddOperandExpr
Semantics:  Elemental operator(+), conformance OK, no aliasing
HLFIR:      hlfir.elemental %shape → !hlfir.expr<?xf32>
            { ^bb0(%i): hlfir.apply %b,%i → arith.addf → hlfir.yield_element }
            hlfir.assign %expr to %a  |  hlfir.destroy %expr
FIR:        fir.do_loop %iv unordered iter_args(%acc=...) {
              fir.array_fetch, arith.addf, fir.array_update }
            fir.array_merge_store
LLVM IR:    phi(%iv) | getelementptr | load×2 | fadd | store | br
```

`hlfir.elemental` captures element-wise semantics as a lazy value before materializing a loop, enabling HLFIR passes to optimize shape/alias/vectorizability.

---

## 2. Array Merge Store

**Source:** Any assignment to a dummy array argument.

```mlir
%old = fir.array_load %arg(%shape)      ; take snapshot
%new = fir.do_loop ... iter_args(%acc = %old) { ...; fir.result %updated }
fir.array_merge_store %old, %new to %arg
```

Implements Fortran copy-in/copy-out semantics for dummy arguments. Prevents aliasing when the array appears on both LHS and RHS of a single statement.

---

## 3. DO CONCURRENT Unordered

**Source:** `DO CONCURRENT (i = 1:n)`

```mlir
HLFIR: hlfir.elemental %shape unordered  ; independence guarantee preserved
FIR:   fir.do_loop %iv unordered         ; no loop-carried dep assertion
LLVM:  loop body with phi+GEP+load/store ; vectorizer can apply SIMD legally
```

With `-fopenmp`: FIR emits `omp.parallel { omp.wsloop }` instead.

---

## 4. WHERE Mask → arith.select

**Source:** `WHERE (input > 0.0) result = SQRT(input) ELSEWHERE result = 0.0`

```mlir
HLFIR: hlfir.elemental (single body, no branch):
         %cmp = arith.cmpf ogt, %in, 0.0
         %sq  = math.sqrt %in              ; both branches computed
         %sel = arith.select %cmp, %sq, 0.0
         hlfir.yield_element %sel

LLVM:  %mask = fcmp ogt ...
       %sq   = call @llvm.sqrt.f32(...)
       %res  = select i1 %mask, %sq, 0.0  ; branchless → SIMD blend
```

WHERE/ELSEWHERE merged into one `hlfir.elemental` with `arith.select`, not conditional branches. Enables `vpblendvps` / `vmaskmovps` on AVX2.

---

## 5. FORALL 2-D Elemental

**Source:** `FORALL (i = 1:n, j = 1:n) a(i,j) = MERGE(1.0, 0.0, i==j)`

```mlir
hlfir.elemental %shape<2> -> !hlfir.expr<?x?xf32> {
^bb0(%i: index, %j: index):
  %ieqj  = arith.cmpi eq, %i, %j
  %merge = arith.select %ieqj, 1.0, 0.0
  hlfir.yield_element %merge
}
```

Multi-index FORALL maps to a 2-D `hlfir.elemental`; both loop variables appear as block arguments simultaneously, matching the parallel semantics.

---

## 6. Fortran Column-Major GEP

**Source:** `a(i, j)` in a 2-D array `a(n, m)`

```llvm
; offset = (j-1)*n + (i-1)   (column-major, 1-based)
%j_1    = sub i64 %j, 1
%i_1    = sub i64 %i, 1
%col    = mul i64 %j_1, %n_extent
%off    = add i64 %col, %i_1
%ptr    = getelementptr inbounds float, ptr %a, i64 %off
```

Opposite of C's row-major. The compiler adjusts the base pointer for 1-based indexing at compile time so the subtraction of 1 can be folded.

---

## 7. Derived Type Field Chain

**Source:** `p%position%x`

```mlir
; FIR
%fi_pos = fir.field_index position, !fir.type<@Particle>  ; compile-time token
%pos    = fir.coordinate_of %p, %fi_pos                   ; → !fir.ref<Vec3>
%fi_x   = fir.field_index x, !fir.type<@Vec3>
%px     = fir.coordinate_of %pos, %fi_x                   ; → !fir.ref<f32>

; LLVM IR — single multi-index GEP, all constants
%px_ptr = getelementptr inbounds %Particle, ptr %p, i64 0, i32 0, i32 0
```

`fir.field_index` is a pure compile-time token; all offsets are constants and collapse to one GEP.

---

## 8. Virtual Dispatch vtable

**Source:** `a = s%area()` where `s` is `CLASS(Shape)`

```mlir
; FIR — dispatch table per concrete type
fir.dispatch_table @_QDTshapesTCircle extends @_QDTshapesTShape {
  fir.dt_entry area, @_QPcircle_area
}
%result = fir.dispatch "area"(%s : !fir.class<...>) -> f32

; LLVM IR — box → tdesc → vtable slot → indirect call
%tdesc_ptr  = getelementptr %Descriptor, ptr %s, 0, 1
%tdesc      = load ptr, ptr %tdesc_ptr
%area_slot  = getelementptr %TypeDescriptor, ptr %tdesc, 0, 3
%fptr       = load ptr, ptr %area_slot
%result     = call float %fptr(ptr %s)         ; indirect call
```

2 GEPs + 2 loads + 1 indirect call per virtual dispatch. No inlining without devirtualization.

---

## 9. SELECT TYPE → ClassIs chain

**Source:** `SELECT TYPE (s) TYPE IS (Circle) ...`

```llvm
; Linear chain of runtime type comparisons
%is_circle = call i1 @_FortranAClassIs(ptr %tdesc, ptr %circle_desc)
br i1 %is_circle, label %circle_block, label %check_rect
check_rect:
  %is_rect = call i1 @_FortranAClassIs(ptr %tdesc, ptr %rect_desc)
  br i1 %is_rect, label %rect_block, label %default
circle_block:
  ; Downcast: reinterpret ptr as concrete type for direct field access
  %r_ptr = getelementptr inbounds %Circle, ptr %s, 0, 1
```

Guards compile to a sequential chain of `@_FortranAClassIs` calls. On match, the selector is statically downcast — no vtable needed inside the guard.

---

## 10. Coarray Remote Get ABI

**Source:** `a(1) = a(n)[me - 1]`

```mlir
; FIR — no load/store for remote memory; all through runtime ABI
fir.call @_caf_get(%token, %src_image, %byte_offset, %dst_ptr, %elem_sz, %count)

; LLVM IR
call void @_caf_get(ptr %token, i32 %src_img, i64 %offset,
                    ptr %dst_ptr, i64 4, i64 1)
; SYNC ALL
call void @_caf_sync_all()
```

The coarray token (compile-time registration handle) + runtime image index + byte offset fully describe the remote access. The transport (MPI / shared memory / RDMA) is entirely inside the OpenCoarrays runtime.

---

## 11. Transformational Intrinsic ABI

**Source:** `c = MATMUL(a, b)`

```mlir
; HLFIR — dedicated op preserves semantics before lowering
%result = hlfir.matmul %a#0, %b#0 : (...) -> !hlfir.expr<?x?xf32>
hlfir.assign %result to %c#0
hlfir.destroy %result

; LLVM IR — 3 stack descriptors + 2 runtime calls + free
%a_desc = alloca %Descriptor  ; rank, extents, stride, base_addr
%b_desc = alloca %Descriptor
%r_desc = alloca %Descriptor  ; runtime allocates result data
call void @_FortranAMatmul(ptr %r_desc, ptr %a_desc, ptr %b_desc, ...)
call void @_FortranAAssign(ptr %c_desc, ptr %r_desc, ...)
call void @_FortranAFreeMemory(ptr %r_data)
```

Transformational intrinsics cannot be `hlfir.elemental` (reduction dimension). HLFIR introduces specific ops; FIR lowers to Fortran runtime via descriptor ABI.

---

## 12. Recursive No-TCO

**Source:** `r = n * factorial(n-1)` (`RECURSIVE FUNCTION`)

```llvm
entry:
  %n_m1 = alloca i32    ; by-ref Fortran ABI requires copy of n-1
  %r    = alloca i64    ; result variable (not SSA)
  ...
  store i32 %n_minus_1, ptr %n_m1
  %recur = call i64 @_QPfactorial(ptr %n_m1)   ; no 'tail' attribute
  %prod  = mul nsw i64 %n_ext, %recur
```

The call result is consumed in a multiply — TCO is illegal. Flang does not implement sibling-call optimization. Stack depth = O(n). Each frame allocates: result variable + argument copy.

---

## 13. Generic Overload Resolution

**Source:** `add(10, 20)` where `add` is a generic interface

```
Semantics:  add(INTEGER, INTEGER) matches add_int by type
            → resolved to _QMgeneric_mathPadd_int

FIR:   fir.call @_QMgeneric_mathPadd_int(%t10, %t20) : (...) -> i32
LLVM:  call i32 @_QMgeneric_mathPadd_int(ptr %t10, ptr %t20)
```

All generic resolution is compile-time. FIR and LLVM IR see only direct monomorphic calls. Mangling: `_Q` + `M<module>` + `P<procedure>`.

---

## 14. MERGE → arith.select

**Source:** `MERGE(1.0, 0.0, i == j)` inside FORALL body

```mlir
%cmp  = arith.cmpi eq, %i, %j : index
%val  = arith.select %cmp, 1.0_f32, 0.0_f32 : f32

; LLVM IR
%ieqj   = icmp eq i64 %i, %j
%result = select i1 %ieqj, float 1.0, float 0.0
```

Fortran's elemental `MERGE` compiles to a single `arith.select`; no function call, no branch, fully vectorizable.

---

*Generated by fpc-trace · HPE Flang · Assignment 33*
