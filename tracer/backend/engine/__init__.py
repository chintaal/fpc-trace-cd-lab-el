"""
fpc-trace compilation pipeline engine.

Submodules:
  compiler_runner  — invoke flang-new per stage (or load pre-generated data)
  stage_parser     — parse raw dump text into structured ParsedStage objects
  correlation      — map Fortran source lines to cross-stage IR operations
"""

from engine.compiler_runner import compile_all_stages, detect_flang, CompileStageResult
from engine.stage_parser import parse_stage, ParsedStage
from engine.correlation import correlate

__all__ = [
    "compile_all_stages",
    "detect_flang",
    "CompileStageResult",
    "parse_stage",
    "ParsedStage",
    "correlate",
]
