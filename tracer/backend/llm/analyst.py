"""
LLM orchestration for IR analysis — provider-agnostic via LiteLLM.

Configure via env vars:
  LLM_MODEL      any LiteLLM model string, e.g.
                   claude-sonnet-4-20250514  (Anthropic)
                   gpt-4o                    (OpenAI)
                   groq/llama-3.3-70b-versatile
                   ollama/llama3.2           (local, no key needed)
  LLM_BASE_URL   optional custom endpoint (for Ollama, LM Studio, etc.)
  <PROVIDER>_API_KEY  whatever the chosen provider requires

If LLM_MODEL is unset the caller falls back to pre-generated notes.
"""
from __future__ import annotations

import os
from typing import AsyncIterator

import litellm

from llm.prompts.ir_analyst import (
    SYSTEM_PROMPT,
    MITRE_SUMMARY_PROMPT,
    build_analysis_prompt,
    build_pattern_summary_prompt,
)
from models.schemas import ExplainRequest

litellm.suppress_debug_info = True

MODEL     = os.environ.get("LLM_MODEL", "claude-sonnet-4-20250514")
BASE_URL  = os.environ.get("LLM_BASE_URL") or None
MAX_TOKENS = 1500


def _kwargs(max_tokens: int = MAX_TOKENS) -> dict:
    kw: dict = {"max_tokens": max_tokens}
    if BASE_URL:
        kw["api_base"] = BASE_URL
    return kw


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

    response = await litellm.acompletion(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": prompt},
        ],
        stream=True,
        **_kwargs(),
    )
    async for chunk in response:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def analyze_batch(req: ExplainRequest) -> str:
    """Single blocking call; used by CLI and report generation."""
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

    response = await litellm.acompletion(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": prompt},
        ],
        **_kwargs(),
    )
    return response.choices[0].message.content


async def summarize_pattern(
    construct_name: str, key_ops: list[str], lowering_notes: str
) -> str:
    prompt = build_pattern_summary_prompt(construct_name, key_ops, lowering_notes)
    response = await litellm.acompletion(
        model=MODEL,
        messages=[
            {"role": "system", "content": MITRE_SUMMARY_PROMPT},
            {"role": "user",   "content": prompt},
        ],
        **_kwargs(max_tokens=200),
    )
    return response.choices[0].message.content
