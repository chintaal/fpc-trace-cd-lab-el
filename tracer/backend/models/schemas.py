"""
Shared data contracts for fpc-trace.

Used by the FastAPI backend, CLI, and JSON Schema export
(schemas/correlated_construct.schema.json).  Keep field names stable —
pregenerated traces and the React UI depend on them.
"""
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class CompilerMode(str, Enum):
    REAL = "real"
    SIMULATION = "simulation"


class ConstructCategory(str, Enum):
    ARRAY_OPS = "array_operations"
    CONCURRENCY = "concurrency"
    CONTROL_FLOW = "control_flow"
    DATA_STRUCTURES = "data_structures"
    POLYMORPHISM = "polymorphism"
    DISTRIBUTED = "distributed"
    INTRINSICS = "intrinsics"
    PROCEDURES = "procedures"


class SourceCorrelation(BaseModel):
    source_line: int
    source_col: int = 1
    source_text: str
    construct_type: str
    parse_tree_nodes: list[str] = Field(default_factory=list)
    fir_ops: list[str] = Field(default_factory=list)
    hlfir_ops: list[str] = Field(default_factory=list)
    llvm_ir_lines: list[str] = Field(default_factory=list)
    lowering_notes: str = ""


class StageOutput(BaseModel):
    stage: str
    content: str
    line_count: int = 0
    key_ops: list[str] = Field(default_factory=list)
    loc_map: dict[str, list[int]] = Field(default_factory=dict)  # "file:line" → [ir_lines]


class PipelineResult(BaseModel):
    id: str
    name: str
    description: str
    category: ConstructCategory
    complexity: str
    fortran_standard: str
    source: str
    stages: dict[str, StageOutput]
    correlations: list[SourceCorrelation]
    lowering_patterns: list[dict[str, str]] = Field(default_factory=list)
    compilation_mode: CompilerMode = CompilerMode.SIMULATION


class ConstructSummary(BaseModel):
    id: str
    name: str
    description: str
    category: ConstructCategory
    complexity: str
    fortran_standard: str
    key_patterns: list[str]


class AnalyzeRequest(BaseModel):
    source: str
    construct_hint: Optional[str] = None
    selected_line: Optional[int] = None


class ExplainRequest(BaseModel):
    construct_id: str
    source_line: int
    source_text: str
    stage_outputs: dict[str, str]
    focus_stage: Optional[str] = None
    lowering_context: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    flang_available: bool
    flang_version: Optional[str]
    mode: CompilerMode
    construct_count: int
    llm_configured: bool = False
    llm_model: Optional[str] = None
