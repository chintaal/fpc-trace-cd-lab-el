# The 10 Fortran Constructs — Complete Lowering Reference

*Every construct traced from source through Parse Tree → Semantics → HLFIR → FIR → LLVM IR.*  
*Use this document as a Flang developer reference for lowering patterns.*

---

## Index

| # | Construct | Standard | Complexity | Key Pattern |
|---|-----------|:--------:|:----------:|-------------|
| [01](#01-array-element-wise-assignment) | Array assignment | F90 | 🟡 MEDIUM | `hlfir.elemental` → `fir.do_loop` |
| [02](#02-do-concurrent-loop) | DO CONCURRENT | F2008 | 🟠 HIGH | `unordered` → auto-vectorizable |
| [03](#03-where--elsewhere) | WHERE block | F90 | 🟠 HIGH | `arith.select` (branchless) |
| [04](#04-forall-statement) | FORALL | F95 | 🟠 HIGH | 2-D `hlfir.elemental` |
| [05](#05-derived-type-field-access) | Derived type fields | F90 | 🟡 MEDIUM | `fir.field_index` + `fir.coordinate_of` |
| [06](#06-polymorphism--select-type) | Polymorphism | F2003 | 🔴 VERY HIGH | `fir.dispatch_table` + indirect call |
| [07](#07-coarray-remote-access) | Coarray (CAF) | F2008 | 🔴 VERY HIGH | `_caf_get` / `_caf_put` |
| [08](#08-array-intrinsics-matmul-sum-maxval) | MATMUL / SUM | F90 | 🟠 HIGH | `_FortranAMatmul` runtime ABI |
| [09](#09-recursive-function) | Recursion | F90 | 🟡 MEDIUM | `alloca` per frame, no TCO |
| [10](#10-generic-interface-resolution) | Generic interface | F90 | 🟡 MEDIUM | Compile-time overload resolution |

---

## 01 — Array Element-wise Assignment

**Source:** `tracer/backend/samples/01_array_assignment.f90`  
**Trace:** `tracer/backend/samples/pregenerated/01_array_assignment.json`

```fortran
subroutine array_add(a, b, c, n)
  implicit none
  integer, intent(in)  :: n
  real,    intent(in)  :: b(n), c(n)
  real,    intent(out) :: a(n)

  a = b + c   ← This single line triggers the full elemental lowering chain

end subroutine array_add
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `AssignmentStmt → Level2Expr → AddOp` |
| **Semantics** | `LHS: REAL(4) rank-1; RHS: elemental operator(+); conformance: OK` |
| **HLFIR** | `hlfir.elemental %shape → !hlfir.expr<?xf32>` with `hlfir.yield_element` |
| **FIR** | `fir.do_loop %iv unordered; fir.array_fetch × 2; arith.addf; fir.array_update` |
| **LLVM IR** | `phi; getelementptr × 3; load × 2; fadd; store` |

### Key patterns

**`hlfir.elemental`** captures element-wise semantics as a *value* (not a loop) at HLFIR level. This allows HLFIR passes to reason about shape, aliasing, and vectorizability before materialising a loop.

**`fir.array_merge_store`** writes the computed array back to the dummy argument, implementing Fortran's copy-in/copy-out semantics.

**LLVM IR** loop structure: `phi` (IV) → `getelementptr` (b[i], c[i], a[i]) → `load × 2` → `fadd` → `store` — a classic countable loop the vectoriser can handle.

---

## 02 — DO CONCURRENT Loop

**Source:** `tracer/backend/samples/02_do_concurrent.f90`

```fortran
DO CONCURRENT (i = 1:n)
  a(i) = b(i) * scale
END DO
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `DoConstruct → ConcurrentControl → ConcurrentHeader` |
| **Semantics** | `Independence: VERIFIED; index i: LOCAL_INIT; no aliasing` |
| **HLFIR** | `hlfir.elemental %shape **unordered**` |
| **FIR** | `fir.do_loop %iv **unordered** iter_args(...)` |
| **LLVM IR** | `phi; getelementptr; load; fmul; store` (no sequential constraint) |

### Key insight: `unordered` attribute

The Fortran standard's independence guarantee for `DO CONCURRENT` is encoded as the `unordered` attribute on `fir.do_loop` and `hlfir.elemental`. This attribute:
1. Prevents FIR passes from adding sequential constraints
2. Signals to LLVM's LoopVectorize pass that SIMD is safe
3. At `-O2`, produces `<4 x float>` SIMD operations

**With `-fopenmp`:** FIR emits `omp.parallel { omp.wsloop }` instead of a sequential loop.

---

## 03 — WHERE / ELSEWHERE

**Source:** `tracer/backend/samples/03_where_block.f90`

```fortran
WHERE (input > 0.0)
  result = SQRT(input)
ELSEWHERE
  result = 0.0
END WHERE
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `WhereConstruct → WhereConstructStmt → MaskExpr; ElsewhereStmt` |
| **Semantics** | `Mask: LOGICAL(4) rank-1; body: SQRT elemental; conformance: OK` |
| **HLFIR** | `hlfir.elemental` (one body): `arith.cmpf ogt` → `math.sqrt` → `arith.select` |
| **FIR** | `fir.do_loop; arith.cmpf ogt; fir.if { math.sqrt } else { 0.0 }` |
| **LLVM IR** | `fcmp ogt; call @llvm.sqrt.f32; select i1 %mask, %sq, 0.0` |

### Key insight: `arith.select` not `br`

Flang merges WHERE/ELSEWHERE into a **single** `hlfir.elemental` body using `arith.select`. This is branchless — ideal for SIMD vectorization with `vpblendvps`/`vmaskmovps` on AVX2.

**SQRT lowering path:** `SQRT` → `math.sqrt` (MLIR math dialect) → `@llvm.sqrt.f32` (LLVM intrinsic). This keeps the IR target-portable.

---

## 04 — FORALL Statement

**Source:** `tracer/backend/samples/04_forall.f90`

```fortran
FORALL (i = 1:n, j = 1:n)
  a(i,j) = MERGE(1.0, 0.0, i == j)   ← identity matrix
END FORALL
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `ForallConstruct → ForallHeader → ConcurrentControl × 2` |
| **Semantics** | `Two-phase semantics; subscript analysis: no aliasing; no temp needed` |
| **HLFIR** | `hlfir.elemental %shape<2>` with `^bb0(%i: index, %j: index)` |
| **FIR** | `fir.do_loop (outer: i) { fir.do_loop (inner: j) { arith.cmpi; arith.select } }` |
| **LLVM IR** | `phi(i); phi(j); icmp eq; select; getelementptr (col-major); store` |

### Key insights

**2-D `hlfir.elemental`**: Multi-index FORALL maps to a single elemental with 2-D shape. Both indices arrive as block arguments (`%i`, `%j`) simultaneously.

**`MERGE` → `arith.select`**: The elemental intrinsic `MERGE(1.0, 0.0, mask)` compiles to a single `arith.select` — no function call.

**Column-major GEP**: Fortran stores arrays column-major. `a(i,j)` → `offset = (j-1)*n + (i-1)`. The GEP pattern is `base + (j-1)*n + (i-1)`, **opposite of C's row-major** `base + (i-1)*m + (j-1)`.

---

## 05 — Derived Type Field Access

**Source:** `tracer/backend/samples/05_derived_type.f90`

```fortran
type :: Particle
  type(Vec3) :: position   ! Vec3: {x, y, z}
  type(Vec3) :: velocity
  real       :: mass
end type

p%position%x = p%position%x + p%velocity%x * dt
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `AssignmentStmt → DataRef → FieldSelector (position) → FieldSelector (x)` |
| **Semantics** | `Particle layout: position@0(Vec3@0), velocity@12(Vec3), mass@24` |
| **HLFIR / FIR** | `fir.field_index position; fir.coordinate_of %p → !fir.ref<Vec3>` then `fir.field_index x; fir.coordinate_of → !fir.ref<f32>` |
| **LLVM IR** | `getelementptr inbounds %Particle, ptr %p, i64 0, i32 0, i32 0` |

### Key insight: field chain → multi-index GEP

`fir.field_index` is a **compile-time token** encoding the member offset. `fir.coordinate_of` applies it to build the pointer. In LLVM IR, the entire chain collapses to a single multi-index `getelementptr` with all indices as compile-time constants.

`p%position%x` → `GEP %Particle, ptr %p, 0, 0, 0` (struct index 0 = position, sub-index 0 = x).

---

## 06 — Polymorphism & SELECT TYPE

**Source:** `tracer/backend/samples/06_polymorphism.f90`

```fortran
class(Shape), intent(in) :: s

a = s%area()        ← virtual dispatch

SELECT TYPE (s)
  TYPE IS (Circle)  ← runtime type guard
    print *, s%radius
  TYPE IS (Rectangle)
    print *, s%width
END SELECT
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `FunctionReference (dynamic); SelectTypeConstruct; TypeGuardStmt × 3` |
| **Semantics** | `Dynamic dispatch verified; type descriptor carried in CLASS box` |
| **FIR** | `fir.dispatch_table { fir.dt_entry area, @_QPcircle_area }; fir.dispatch "area"(s)` |
| **HLFIR** | `fir.dispatch "area"; fir.box_tdesc; fir.call @_FortranAClassIs` |
| **LLVM IR** | `GEP (box→tdesc); load (tdesc); GEP (tdesc→slot); load (fptr); call fptr` (indirect) |

### Key insight: `CLASS(T)` box layout

A polymorphic `CLASS(Shape)` variable carries a **Fortran descriptor box**:
```
struct Descriptor { 
  ptr   data_ptr;         // actual data
  ptr   type_descriptor;  // → vtable + type info
  i64   rank;
  ...
}
```

Virtual dispatch = 2 GEPs + 2 loads + 1 indirect call.

**SELECT TYPE guards** → chain of `@_FortranAClassIs(type_desc, target_desc)` runtime calls + conditional branches. On match, the box is statically downcast for direct field access.

---

## 07 — Coarray Remote Access

**Source:** `tracer/backend/samples/07_coarray.f90`

```fortran
real, intent(inout) :: a(n)[*]     ← coarray: one copy per image

a(1) = a(n)[me - 1]   ← remote READ from neighbouring image

SYNC ALL              ← global barrier
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `ImageSelector (me-1); CoarraySpec [*]; SyncAllStmt` |
| **Semantics** | `a: corank=1 cobound=[*]; image access: REMOTE READ` |
| **FIR** | `fir.call @_caf_get(token, image, byte_offset, dst, elem_sz, count)` |
| **HLFIR** | `fir.call @_caf_get (identical)` |
| **LLVM IR** | `call void @_caf_get(...)` — no load/store for remote element |

### Key insight: OpenCoarrays ABI

**There is no LLVM `load` for the remote element.** All inter-image memory access goes through the OpenCoarrays runtime ABI. The compiler encodes:
1. **Token** — opaque compile-time registration handle
2. **Image index** — `me - 1` (runtime value)
3. **Byte offset** — `(n-1) * sizeof(float)` (compile-time constant)

`SYNC ALL` → single unconditional `call @_caf_sync_all()`. All barrier semantics are in the runtime library.

---

## 08 — Array Intrinsics (MATMUL, SUM, MAXVAL)

**Source:** `tracer/backend/samples/08_intrinsics.f90`

```fortran
c = MATMUL(a, b)       ← transformational intrinsic (not elemental)
result_sum = SUM(a)
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `FunctionReference (MATMUL, transformational)` |
| **Semantics** | `Result shape: c(n,k); reduction dimension: m; cannot be elemental` |
| **HLFIR** | `hlfir.matmul %a, %b → !hlfir.expr<?x?xf32>` |
| **FIR** | `fir.embox × 2; fir.alloca (result desc); fir.call @_FortranAMatmul; fir.freemem` |
| **LLVM IR** | `alloca × 3 (descriptors); call @_FortranAMatmul; call @_FortranAAssign; call @_FortranAFreeMemory` |

### Key insight: MATMUL cannot be elemental

`MATMUL` has a **reduction dimension** (`m`) that cannot be expressed as `hlfir.elemental` (which is element-wise with no reduction). HLFIR introduces `hlfir.matmul` as a dedicated op, which lowers to the Fortran runtime via the **descriptor ABI**:

```
struct Descriptor { ptr data; i64 rank; i64 extents[]; i64 strides[]; ... }
```

Three stack-allocated descriptors encode the array geometry. `_FortranAMatmul` does the actual computation (naive triple loop, or BLAS if available).

---

## 09 — Recursive Function

**Source:** `tracer/backend/samples/09_recursion.f90`

```fortran
recursive function factorial(n) result(r)
  integer, intent(in) :: n
  integer(kind=8) :: r
  if (n <= 1) then; r = 1
  else; r = n * factorial(n - 1)
  end if
end function factorial
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `FunctionSubprogram (RECURSIVE); IfConstruct; FunctionReference (factorial)` |
| **Semantics** | `Self-call: factorial(n-1); result used in multiply → NO TCO` |
| **HLFIR / FIR** | `fir.alloca (result r); fir.alloca (n-1 arg); fir.call @_QPfactorial (no musttail)` |
| **LLVM IR** | `alloca i64 (r); alloca i32 (n_m1); call i64 @_QPfactorial (no tail attr); mul` |

### Key insight: no TCO in Flang

The recursive call cannot be tail-call optimised because its result is immediately consumed in a multiply (`r = n * factorial(n-1)`). **Flang does not implement sibling-call optimisation** (unlike GCC's `-foptimize-sibling-calls`). Each frame allocates:
- 8 bytes for the result variable `r`
- 4 bytes for the `n-1` argument copy (required by Fortran's pass-by-reference ABI)

Stack depth is O(n). Beware for large inputs.

---

## 10 — Generic Interface Resolution

**Source:** `tracer/backend/samples/10_generic_interface.f90`

```fortran
interface add
  module procedure add_int   ! INTEGER, INTEGER → INTEGER
  module procedure add_real  ! REAL, REAL → REAL
end interface add

i_result = add(10, 20)     → resolves to add_int at compile time
r_result = add(1.5, 2.5)   → resolves to add_real at compile time
```

### Lowering chain

| Stage | Key Representation |
|-------|-------------------|
| **Parse Tree** | `FunctionReference ('add', generic interface)` |
| **Semantics** | `add(INTEGER,INTEGER) → add_int; add(REAL,REAL) → add_real; rank disambiguation for norm` |
| **FIR** | `fir.call @_QMgeneric_mathPadd_int` (monomorphic) |
| **LLVM IR** | `call i32 @_QMgeneric_mathPadd_int` (direct call) |

### Key insight: compile-time resolution

**All three calls named `add` in Fortran become three different direct calls in LLVM IR.** There is no vtable, no type tag, no branch. The semantics phase resolves overloads by matching argument types and ranks, encodes the result as a mangled name, and FIR sees only monomorphic `fir.call` instructions.

**Flang mangling:** `_QM<module>P<procedure>`:
- `_Q` — Flang prefix
- `M<module>` — enclosing module name
- `P<procedure>` — specific procedure name

This enables separate compilation: different modules can define procedures with the same generic name without link-time conflicts.

---

## Patterns Summary

The 10 constructs collectively demonstrate **14 lowering patterns**. See [`lowering-patterns.md`](lowering-patterns.md) for complete documentation of each pattern with IR excerpts.

| Pattern | Construct(s) |
|---------|-------------|
| `hlfir.elemental` value semantics | 01, 02, 03, 04 |
| `fir.array_merge_store` copy-in/out | 01, 02, 03, 04 |
| `unordered` independence encoding | 02, 04 |
| `arith.select` branchless WHERE mask | 03 |
| 2-D `hlfir.elemental` | 04 |
| Fortran column-major GEP | 04, 08 |
| `fir.field_index` + `fir.coordinate_of` | 05 |
| `fir.dispatch_table` vtable | 06 |
| `@_FortranAClassIs` SELECT TYPE chain | 06 |
| OpenCoarrays `_caf_get`/`_caf_put` ABI | 07 |
| `SYNC ALL` → `_caf_sync_all` barrier | 07 |
| Fortran descriptor ABI | 08 |
| Stack frame per recursive call (no TCO) | 09 |
| Generic → monomorphic + Flang mangling | 10 |
