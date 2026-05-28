"""
Parses raw text output from each Flang compilation stage into structured data.

Each parser extracts:
  - cleaned content (for display)
  - key_ops list (dominant IR operations)
  - loc_map: source "file:line" → list of IR line numbers
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class ParsedStage:
    content: str
    key_ops: list[str] = field(default_factory=list)
    loc_map: dict[str, list[int]] = field(default_factory=dict)
    line_count: int = 0


# --- Parse Tree ---------------------------------------------------------------

_PT_KEY_NODES = [
    "AssignmentStmt", "DoConstruct", "ConcurrentControl", "WhereConstruct",
    "ForallConstruct", "FunctionSubprogram", "SubroutineSubprogram",
    "DerivedTypeDef", "SelectTypeConstruct", "CriticalConstruct",
    "ArrayElement", "SectionSubscriptList", "PartRef",
]

def parse_parse_tree(raw: str) -> ParsedStage:
    lines = raw.splitlines()
    found_nodes: set[str] = set()
    for line in lines:
        for node in _PT_KEY_NODES:
            if node in line:
                found_nodes.add(node)

    loc_map: dict[str, list[int]] = {}
    # Flang embeds source refs as "source: file.f90:line:col" in some tree modes
    for i, line in enumerate(lines):
        m = re.search(r'(\w+\.f90):(\d+):(\d+)', line)
        if m:
            key = f"{m.group(1)}:{m.group(2)}"
            loc_map.setdefault(key, []).append(i + 1)

    return ParsedStage(
        content=raw,
        key_ops=sorted(found_nodes),
        loc_map=loc_map,
        line_count=len(lines),
    )


# --- Semantics ----------------------------------------------------------------

def parse_semantics(raw: str) -> ParsedStage:
    lines = raw.splitlines()
    symbols: list[str] = []
    for line in lines:
        # Symbol table entries usually start with a name followed by type info
        if re.match(r'\s+\w+:.*\bTYPE\b', line, re.I):
            name = line.strip().split(":")[0].strip()
            symbols.append(name)

    return ParsedStage(
        content=raw,
        key_ops=symbols[:20],
        loc_map={},
        line_count=len(lines),
    )


# --- FIR / HLFIR -------------------------------------------------------------

# Interesting MLIR ops to surface
_FIR_KEY_OPS = re.compile(
    r'\b(hlfir\.elemental|hlfir\.assign|hlfir\.declare|hlfir\.apply|'
    r'hlfir\.yield_element|hlfir\.destroy|fir\.do_loop|fir\.array_load|'
    r'fir\.array_fetch|fir\.array_update|fir\.array_merge_store|'
    r'fir\.call|fir\.dispatch|fir\.convert|fir\.load|fir\.store|'
    r'omp\.parallel|omp\.wsloop|fir\.global_len|arith\.addf|arith\.mulf|'
    r'fir\.shape|fir\.box_addr|fir\.embox|fir\.box_rank)\b'
)

_LOC_ATTR    = re.compile(r'#loc\("([^"]+)":(\d+):(\d+)\)')    # inline loc
_LOC_REF     = re.compile(r'loc\(#loc(\d+)\)')                  # named loc ref
_LOC_DEF_NUM = re.compile(r'^#loc(\d+)\s*=\s*loc\("([^"]+)":(\d+):(\d+)\)')  # named definition


def parse_fir(raw: str) -> ParsedStage:
    return _parse_mlir_stage(raw)


def parse_hlfir(raw: str) -> ParsedStage:
    # HLFIR is captured from mlir-print-ir-after-all; grab last full module dump
    modules = re.split(r'// \*\*\* IR Dump', raw)
    # Take the last non-empty segment that contains hlfir ops
    best = raw
    for seg in reversed(modules):
        if "hlfir." in seg or "func.func" in seg:
            best = "// *** IR Dump" + seg if seg != modules[0] else seg
            break
    return _parse_mlir_stage(best)


def _parse_mlir_stage(raw: str) -> ParsedStage:
    lines = raw.splitlines()
    found_ops: set[str] = set()
    loc_map: dict[str, list[int]] = {}

    # Pass 1: collect named-loc definitions  (#locN = loc("file":line:col))
    named_locs: dict[str, str] = {}   # "N" → "file:line"
    for line in lines:
        m = _LOC_DEF_NUM.match(line.strip())
        if m:
            idx, fname, ln = m.group(1), m.group(2), m.group(3)
            named_locs[idx] = f"{fname}:{ln}"
        # Also index inline definitions that appear embedded in an op line
        for m2 in _LOC_ATTR.finditer(line):
            key = f"{m2.group(1)}:{m2.group(2)}"
            named_locs[key] = key   # self-mapping for inline

    # Pass 2: scan each line for ops and source-location references
    for i, line in enumerate(lines):
        ln_num = i + 1

        # Collect key op tokens
        for mo in _FIR_KEY_OPS.finditer(line):
            found_ops.add(mo.group(0))

        # Inline loc attribute:  loc(#loc("file":line:col))
        for m in _LOC_ATTR.finditer(line):
            key = f"{m.group(1)}:{m.group(2)}"
            loc_map.setdefault(key, []).append(ln_num)

        # Named loc reference:  loc(#locN)  → look up in named_locs
        for m in _LOC_REF.finditer(line):
            ref = m.group(1)
            if ref in named_locs:
                key = named_locs[ref]
                loc_map.setdefault(key, []).append(ln_num)

    return ParsedStage(
        content=raw,
        key_ops=sorted(found_ops),
        loc_map=loc_map,
        line_count=len(lines),
    )


# --- LLVM IR -----------------------------------------------------------------

_LLVM_KEY_INSTRS = re.compile(
    r'\b(load|store|getelementptr|fadd|fmul|call|invoke|'
    r'phi|br|ret|alloca|bitcast|ptrtoint|inttoptr|'
    r'extractelement|insertelement|shufflevector|'
    r'tail call|musttail)\b'
)

_DBG_LOC = re.compile(r'!DILocation\(line:\s*(\d+),\s*column:\s*(\d+),\s*scope:\s*!(\d+)\)')
_INSTR_DBG = re.compile(r'!dbg\s+!(\d+)')


def parse_llvm_ir(raw: str) -> ParsedStage:
    lines = raw.splitlines()
    found_instrs: set[str] = set()

    # Build !N → DILocation map
    diloc: dict[str, tuple[int, int]] = {}
    for line in lines:
        m = _DBG_LOC.search(line)
        if m:
            node_id = m.group(0)
            # Extract node id from the line  e.g. "!42 = !DILocation(...)"
            id_m = re.match(r'!(\d+)\s*=', line.strip())
            if id_m:
                diloc[id_m.group(1)] = (int(m.group(1)), int(m.group(2)))

    loc_map: dict[str, list[int]] = {}
    for i, line in enumerate(lines):
        for mo in _LLVM_KEY_INSTRS.finditer(line):
            found_instrs.add(mo.group(0))
        dbg_m = _INSTR_DBG.search(line)
        if dbg_m and dbg_m.group(1) in diloc:
            src_line, _ = diloc[dbg_m.group(1)]
            key = f"input.f90:{src_line}"
            loc_map.setdefault(key, []).append(i + 1)

    return ParsedStage(
        content=raw,
        key_ops=sorted(found_instrs),
        loc_map=loc_map,
        line_count=len(lines),
    )


# --- Dispatcher ---------------------------------------------------------------

def parse_stage(stage_name: str, raw_output: str) -> ParsedStage:
    dispatch = {
        "parse_tree": parse_parse_tree,
        "semantics": parse_semantics,
        "fir": parse_fir,
        "hlfir": parse_hlfir,
        "llvm_ir": parse_llvm_ir,
    }
    fn = dispatch.get(stage_name, parse_parse_tree)
    return fn(raw_output)
