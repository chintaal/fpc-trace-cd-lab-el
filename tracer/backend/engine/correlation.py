"""
Cross-stage correlation engine.

Given parsed stage outputs, builds a SourceCorrelation list that maps
every meaningful source line to the IR ops that represent it at each stage.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from models.schemas import SourceCorrelation
from engine.stage_parser import ParsedStage


def correlate(
    source: str,
    parse_tree: ParsedStage,
    semantics: ParsedStage,
    fir: ParsedStage,
    hlfir: ParsedStage,
    llvm_ir: ParsedStage,
    filename: str = "input.f90",
) -> list[SourceCorrelation]:
    source_lines = source.splitlines()
    correlations: list[SourceCorrelation] = []

    for lineno, line_text in enumerate(source_lines, start=1):
        stripped = line_text.strip()
        if not stripped or stripped.startswith("!"):
            continue

        construct_type = _classify_construct(stripped)
        if construct_type is None:
            continue

        key = f"{filename}:{lineno}"
        short_key = f"input.f90:{lineno}"

        corr = SourceCorrelation(
            source_line=lineno,
            source_text=line_text.rstrip(),
            construct_type=construct_type,
            parse_tree_nodes=_ops_at(parse_tree, key, short_key),
            fir_ops=_ops_at(fir, key, short_key),
            hlfir_ops=_ops_at(hlfir, key, short_key),
            llvm_ir_lines=_ops_at(llvm_ir, key, short_key),
            lowering_notes=_lowering_note(construct_type),
        )
        correlations.append(corr)

    return correlations


def _ops_at(stage: ParsedStage, *keys: str) -> list[str]:
    """Return the actual IR op names found at source-correlated lines.

    We look up which IR line numbers map to the given source location, then
    scan those lines in the stage content for named operations.  This gives
    readers real op names (e.g. "fir.do_loop", "hlfir.elemental") rather
    than raw line-number integers.
    """
    for key in keys:
        ir_lines = stage.loc_map.get(key, [])
        if not ir_lines:
            continue
        content_lines = stage.content.splitlines()
        found: list[str] = []
        seen: set[str] = set()
        for ln in ir_lines[:12]:            # examine up to 12 correlated lines
            idx = ln - 1                    # 1-based → 0-based
            if 0 <= idx < len(content_lines):
                for op in _extract_ops(content_lines[idx]):
                    if op not in seen:
                        seen.add(op)
                        found.append(op)
            if len(found) >= 8:
                break
        if found:
            return found
    # Fallback: stage-level key ops when no loc_map match
    return stage.key_ops[:6]


# Patterns that extract meaningful IR token names from a single line
_OP_PATTERNS = [
    re.compile(r'\b(hlfir\.\w+|fir\.\w+|omp\.\w+|arith\.\w+|math\.\w+|func\.func)\b'),
    re.compile(r'\b(load|store|getelementptr|fadd|fsub|fmul|fdiv|fcmp|icmp|'
               r'call|br|ret|alloca|phi|select|sext|zext|trunc|bitcast|'
               r'extractelement|insertelement|tail call)\b'),
    re.compile(r'\b(AssignmentStmt|DoConstruct|ConcurrentControl|WhereConstruct|'
               r'ForallConstruct|DerivedTypeDef|SelectTypeConstruct|'
               r'SubroutineSubprogram|FunctionSubprogram)\b'),
]


def _extract_ops(line: str) -> list[str]:
    """Extract IR operation names from a single line of stage output."""
    found = []
    for pat in _OP_PATTERNS:
        for m in pat.finditer(line):
            found.append(m.group(0))
    return found


_CONSTRUCT_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bdo\s+concurrent\b', re.I), "do_concurrent"),
    (re.compile(r'\bdo\b', re.I), "do_loop"),
    (re.compile(r'\bforall\b', re.I), "forall"),
    (re.compile(r'\bwhere\b', re.I), "where_block"),
    (re.compile(r'\bif\b', re.I), "if_stmt"),
    (re.compile(r'\bmatmul\b', re.I), "matmul_intrinsic"),
    (re.compile(r'\btranspose\b', re.I), "transpose_intrinsic"),
    (re.compile(r'\bsum\b|\bproduct\b|\bmaxval\b', re.I), "reduction_intrinsic"),
    (re.compile(r'\bclass\s*\(', re.I), "polymorphism"),
    (re.compile(r'\bselect\s+type\b', re.I), "select_type"),
    (re.compile(r'\bcall\b', re.I), "procedure_call"),
    (re.compile(r'\brecursive\b', re.I), "recursive_proc"),
    (re.compile(r'\[\*\]|[\w)]\[[^\]]+\]', re.I), "coarray_access"),
    (re.compile(r'=\s*\w+\s*[+\-\*/]\s*\w+'), "array_assignment"),
    (re.compile(r'^\s*\w+\s*='), "assignment"),
]


def _classify_construct(line: str) -> Optional[str]:
    for pattern, name in _CONSTRUCT_PATTERNS:
        if pattern.search(line):
            return name
    return None


_LOWERING_NOTES: dict[str, str] = {
    "array_assignment": (
        "Array assignment lowers through HLFIR's elemental model: "
        "hlfir.elemental captures the element-wise semantics, "
        "then lowered to fir.do_loop + fir.array_fetch/update, "
        "finally becoming a counted loop in LLVM IR with GEP + load + fadd + store."
    ),
    "do_concurrent": (
        "DO CONCURRENT has no loop-carried dependencies by contract. "
        "Flang emits omp.parallel + omp.wsloop wrappers when -fopenmp is set, "
        "otherwise lowers to a sequential fir.do_loop with unordered attribute. "
        "LLVM IR may see auto-vectorization due to the independence guarantee."
    ),
    "where_block": (
        "WHERE blocks lower to masked elemental operations. "
        "The condition becomes a boolean mask array; "
        "HLFIR uses hlfir.elemental with an fir.if inside the body. "
        "LLVM IR produces a SELECT instruction or predicated stores."
    ),
    "forall": (
        "FORALL (deprecated in F2008) lowers similarly to DO CONCURRENT "
        "but without the dependency-freedom guarantee. "
        "Flang emits it as a nested fir.do_loop structure."
    ),
    "matmul_intrinsic": (
        "MATMUL lowers to a runtime library call: _FortranAMatmul or optimized BLAS. "
        "The result is a temporary heap-allocated array (hlfir.expr). "
        "FIR: fir.call @_FortranAMatmul; LLVM IR: call void @_FortranAMatmul."
    ),
    "polymorphism": (
        "CLASS(*) / SELECT TYPE introduces dynamic dispatch. "
        "Flang emits a vtable (fir.dispatch_table) and uses fir.dispatch for method calls. "
        "LLVM IR: indirect call through a function pointer loaded from the descriptor."
    ),
    "coarray_access": (
        "Coarray remote access (a[image_id]) lowers to OpenCoarrays runtime calls. "
        "FIR: fir.call @_caf_get / @_caf_put. "
        "LLVM IR: call to the coarray ABI functions with image index and byte offset."
    ),
    "recursive_proc": (
        "Recursive procedures get stack-allocated local variables (alloca). "
        "Flang does not perform tail-call optimisation by default; "
        "each recursive call is a standard CALL instruction in LLVM IR."
    ),
    "procedure_call": (
        "Generic procedure calls resolve at semantics phase (interface matching). "
        "FIR: fir.call with mangled name. LLVM IR: direct call unless polymorphic."
    ),
    "do_loop": (
        "Standard DO loop lowers to fir.do_loop in FIR, "
        "then to a counted loop with IV phi node in LLVM IR."
    ),
    "assignment": (
        "Scalar assignment: fir.load source → arith op → fir.store in FIR. "
        "LLVM IR: load + store with appropriate alignment."
    ),
    "if_stmt": (
        "IF statement lowers to fir.if (structured region) in FIR, "
        "then to LLVM IR br with condition."
    ),
}


def _lowering_note(construct_type: str) -> str:
    return _LOWERING_NOTES.get(construct_type, "")
