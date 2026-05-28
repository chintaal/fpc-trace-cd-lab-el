"""
Claude API orchestration for IR analysis.

Provides both a streaming endpoint (SSE, for frontend typewriter effect)
and a batch call (for CLI and report generation).
"""
from __future__ import annotations

import os
from typing import AsyncIterator

import anthropic

from llm.prompts.ir_analyst import (
    SYSTEM_PROMPT,
    MITRE_SUMMARY_PROMPT,
    build_analysis_prompt,
    build_pattern_summary_prompt,
)
from models.schemas import ExplainRequest

MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 1500


def _client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


async def stream_analysis(req: ExplainRequest) -> AsyncIterator[str]:
    """Yields text chunks for SSE streaming to the frontend."""
    stages = req.stage_outputs

    prompt = build_analysis_prompt(
        construct_type=req.source_text,
        source_text=req.source_text,
        parse_tree_excerpt=stages.get("parse_tree", "")[:800],
        fir_excerpt=stages.get("fir", "")[:1000],
        hlfir_excerpt=stages.get("hlfir", "")[:1000],
        llvm_ir_excerpt=stages.get("llvm_ir", "")[:1000],
        selected_lines=str(req.source_line),
        lowering_context=req.lowering_context or "",
    )

    async with _client().messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def analyze_batch(req: ExplainRequest) -> str:
    """Single blocking call; used by CLI tool."""
    stages = req.stage_outputs

    prompt = build_analysis_prompt(
        construct_type=req.source_text,
        source_text=req.source_text,
        parse_tree_excerpt=stages.get("parse_tree", "")[:800],
        fir_excerpt=stages.get("fir", "")[:1000],
        hlfir_excerpt=stages.get("hlfir", "")[:1000],
        llvm_ir_excerpt=stages.get("llvm_ir", "")[:1000],
        selected_lines=str(req.source_line),
        lowering_context=req.lowering_context or "",
    )

    result = await _client().messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return result.content[0].text


async def summarize_pattern(construct_name: str, key_ops: list[str], lowering_notes: str) -> str:
    prompt = build_pattern_summary_prompt(construct_name, key_ops, lowering_notes)
    result = await _client().messages.create(
        model=MODEL,
        max_tokens=200,
        system=MITRE_SUMMARY_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return result.content[0].text
