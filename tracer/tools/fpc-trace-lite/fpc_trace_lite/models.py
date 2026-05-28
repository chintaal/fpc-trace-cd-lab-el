"""Core data models for fpc-trace-lite.

All models are plain dataclasses that round-trip to JSON so they satisfy the
``schemas/correlated_construct.schema.json`` contract.
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any
import json
import datetime

# ── Stage constants ───────────────────────────────────────────────────────────

STAGES = ["parse_tree", "semantics", "hlfir", "fir", "llvm_ir"]

STAGE_LABELS = {
    "parse_tree": "Parse Tree",
    "semantics": "Semantics / Symbols",
    "hlfir": "HLFIR (High-Level FIR)",
    "fir": "FIR (Fortran IR)",
    "llvm_ir": "LLVM IR",
}

STAGE_COLORS = {
    "parse_tree": "#58a6ff",   # blue
    "semantics": "#79c0ff",    # light blue
    "hlfir": "#d2a8ff",        # purple
    "fir": "#ffa657",          # orange
    "llvm_ir": "#3fb950",      # green
}

# ── Location ──────────────────────────────────────────────────────────────────

@dataclass
class SourceLocation:
    file: str
    line: int
    col: int = 0
    end_line: Optional[int] = None
    end_col: Optional[int] = None

    def __str__(self) -> str:
        loc = f"{self.file}:{self.line}"
        if self.col:
            loc += f":{self.col}"
        if self.end_line and self.end_line != self.line:
            loc += f"-{self.end_line}"
        return loc


# ── IR Node ───────────────────────────────────────────────────────────────────

@dataclass
class IRNode:
    """A single highlighted node within a stage's textual dump."""
    text: str
    op_name: str = ""
    kind: str = ""                  # "construct", "op", "instruction", "symbol"
    line_ref: Optional[int] = None  # source line this maps back to
    col_ref: Optional[int] = None
    loc_attr: str = ""              # raw loc("...") attribute string
    is_target: bool = False         # directly correlated to the traced construct


# ── Stage Snapshot ────────────────────────────────────────────────────────────

@dataclass
class StageSnapshot:
    """One compiler stage's representation of the traced construct."""
    stage: str
    raw_text: str
    nodes: List[IRNode] = field(default_factory=list)
    op_count: int = 0
    target_node_count: int = 0
    location: Optional[SourceLocation] = None
    # diagnostics / notes specific to this stage
    notes: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def label(self) -> str:
        return STAGE_LABELS.get(self.stage, self.stage)

    @property
    def color(self) -> str:
        return STAGE_COLORS.get(self.stage, "#888888")


# ── Cross-reference ───────────────────────────────────────────────────────────

@dataclass
class CrossRef:
    """Links a concept in one stage to its counterpart in another."""
    from_stage: str
    to_stage: str
    from_node: str
    to_node: str
    ref_kind: str          # "lowering" | "expansion" | "optimization" | "elimination"
    confidence: float      # 0.0 – 1.0
    description: str = ""


# ── Lowering Pattern ─────────────────────────────────────────────────────────

@dataclass
class LoweringPattern:
    name: str
    description: str
    source_construct: str
    stages_involved: List[str]
    transformation_type: str   # "scalar_expansion" | "runtime_call" | "vectorization" | ...
    ops_in: int = 1
    ops_out: int = 1


# ── Top-level result ──────────────────────────────────────────────────────────

@dataclass
class CorrelatedConstruct:
    """Full cross-stage trace result for one Fortran construct."""
    id: str
    source_file: str
    source_line: int
    source_end_line: int
    construct_kind: str         # "do_concurrent" | "where_block" | "matmul" | ...
    construct_name: str
    source_text: str            # full source of the traced function/program
    stages: Dict[str, StageSnapshot] = field(default_factory=dict)
    cross_refs: List[CrossRef] = field(default_factory=list)
    patterns: List[LoweringPattern] = field(default_factory=list)
    ai_explanation: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    flang_version: str = "flang-new 18.1.0 (LLVM 18)"
    generated_at: str = field(default_factory=lambda: datetime.datetime.utcnow().isoformat() + "Z")
    simulated: bool = True      # True when using fixture data (no live Flang binary)

    # ── serialisation ────────────────────────────────────────────────────────

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # convert nested stage snapshots to plain dicts
        return d

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)

    @property
    def expansion_factor(self) -> float:
        """Ratio of LLVM IR ops to source lines (code expansion metric)."""
        llvm = self.stages.get("llvm_ir")
        src_lines = max(1, self.source_end_line - self.source_line + 1)
        if llvm:
            return round(llvm.op_count / src_lines, 1)
        return 0.0

    @property
    def total_ops(self) -> Dict[str, int]:
        return {s: snap.op_count for s, snap in self.stages.items()}
