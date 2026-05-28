"""
Subprocess controller for flang-new.

Tries real compilation first; falls back to pre-generated samples.
All flags chosen to capture per-stage IR without optimisation noise.
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


FLANG_BINARY = os.environ.get("FLANG_BINARY", "flang-new")
SAMPLES_DIR = Path(__file__).parent.parent / "samples"
PREGENERATED_DIR = SAMPLES_DIR / "pregenerated"

# Flags that dump each IR stage to stderr/stdout
STAGE_FLAGS: dict[str, list[str]] = {
    "parse_tree": ["-fdebug-dump-parse-tree", "-fsyntax-only"],
    "semantics": ["-fdebug-dump-symbols", "-fsyntax-only"],
    "fir": ["-emit-fir", "-S", "-mmlir", "--mlir-print-ir-before-all"],
    "hlfir": ["-emit-fir", "-S", "-mmlir", "--mlir-print-ir-after-all"],
    "llvm_ir": ["-emit-llvm", "-S"],
}


@dataclass
class CompileStageResult:
    stage: str
    output: str
    success: bool
    error: str = ""


def detect_flang() -> tuple[bool, Optional[str]]:
    binary = shutil.which(FLANG_BINARY)
    if not binary:
        return False, None
    try:
        result = subprocess.run(
            [binary, "--version"],
            capture_output=True, text=True, timeout=5
        )
        version_line = (result.stdout or result.stderr).strip().split("\n")[0]
        return True, version_line
    except Exception:
        return False, None


async def compile_all_stages(source_text: str, filename: str = "input.f90") -> dict[str, CompileStageResult]:
    available, _ = detect_flang()
    if not available:
        raise RuntimeError("flang-new not found; use simulation mode")

    results: dict[str, CompileStageResult] = {}
    with tempfile.TemporaryDirectory() as tmpdir:
        src_path = Path(tmpdir) / filename
        src_path.write_text(source_text)

        for stage, flags in STAGE_FLAGS.items():
            result = await _run_stage(str(src_path), stage, flags, tmpdir)
            results[stage] = result

    return results


async def _run_stage(src_path: str, stage: str, flags: list[str], workdir: str) -> CompileStageResult:
    out_file = os.path.join(workdir, f"out_{stage}.txt")
    cmd = [FLANG_BINARY] + flags + [src_path]

    if stage == "llvm_ir":
        cmd += ["-o", os.path.join(workdir, "out.ll")]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)

        # Flang dumps IR stages to stderr; LLVM IR goes to the output file
        if stage == "llvm_ir":
            ll_path = os.path.join(workdir, "out.ll")
            output = Path(ll_path).read_text() if Path(ll_path).exists() else stderr.decode()
        else:
            output = stderr.decode() or stdout.decode()

        return CompileStageResult(
            stage=stage,
            output=output,
            success=proc.returncode == 0,
            error="" if proc.returncode == 0 else stderr.decode()[:500],
        )
    except asyncio.TimeoutError:
        return CompileStageResult(stage=stage, output="", success=False, error="Compilation timeout")
    except Exception as exc:
        return CompileStageResult(stage=stage, output="", success=False, error=str(exc))
