#!/usr/bin/env python3
"""
regenerate_pregenerated.py
==========================
Regenerate tracer/backend/samples/pregenerated/*.json from real flang-new output.

Two modes:

  1. Live compile (requires FLANG_BINARY):
       python3 scripts/regenerate_pregenerated.py
       python3 scripts/regenerate_pregenerated.py --construct 02_do_concurrent

  2. From pre-collected dumps (no flang needed):
       python3 scripts/regenerate_pregenerated.py --from-dumps dumps/02_do_concurrent

The script re-runs the three-layer pipeline
(compiler_runner → stage_parser → correlation) and writes updated JSON,
stamping the result with `compilation_mode: real` and the Flang version.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

REPO   = Path(__file__).parent.parent
TRACER = REPO / 'tracer'
sys.path.insert(0, str(TRACER / 'backend'))

from engine.compiler_runner import STAGE_FLAGS, detect_flang, compile_all_stages
from engine.stage_parser     import parse_stage
from engine.correlation      import correlate
from models.schemas          import PipelineResult, StageOutput, CompilerMode


PREGENERATED = TRACER / 'backend' / 'samples' / 'pregenerated'
SAMPLES      = TRACER / 'backend' / 'samples'


def _load_dumps(dump_dir: Path) -> dict[str, str]:
    """Read stage dumps from collect_pipeline_dumps.sh output."""
    manifest_path = dump_dir / 'manifest.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        stage_files = manifest['stages']
    else:
        stage_files = {
            'parse_tree': '01_parse_tree.txt',
            'semantics':  '02_semantics.txt',
            'fir':        '03_fir.mlir',
            'hlfir':      '04_hlfir.mlir',
            'llvm_ir':    '05_llvm_ir.ll',
        }
    raw: dict[str, str] = {}
    for stage, filename in stage_files.items():
        p = dump_dir / filename
        raw[stage] = p.read_text() if p.exists() else ''
    return raw


def _build_pipeline_result(
    construct_id: str,
    source: str,
    raw_stages: dict[str, str],
    existing_meta: dict,
    flang_version: str | None,
) -> dict:
    """Run parsers + correlator and return a PipelineResult-shaped dict."""
    parsed = {name: parse_stage(name, content)
              for name, content in raw_stages.items()}

    corrs = correlate(
        source     = source,
        parse_tree = parsed['parse_tree'],
        semantics  = parsed['semantics'],
        fir        = parsed['fir'],
        hlfir      = parsed['hlfir'],
        llvm_ir    = parsed['llvm_ir'],
        filename   = f'{construct_id}.f90',
    )

    stages_out = {}
    for name, ps in parsed.items():
        stages_out[name] = {
            'stage':      name,
            'content':    ps.content,
            'line_count': ps.line_count,
            'key_ops':    ps.key_ops,
            'loc_map':    {k: list(v) for k, v in ps.loc_map.items()},
        }

    result = dict(existing_meta)  # preserve name, description, category, etc.
    result.update({
        'source':           source,
        'stages':           stages_out,
        'correlations':     [c.model_dump() for c in corrs],
        'compilation_mode': 'real' if flang_version else 'simulation',
    })
    if flang_version:
        result['flang_version'] = flang_version

    return result


def _load_existing(construct_id: str) -> dict:
    p = PREGENERATED / f'{construct_id}.json'
    if p.exists():
        return json.loads(p.read_text())
    return {'id': construct_id, 'name': construct_id.replace('_', ' ').title(),
            'description': '', 'category': 'custom', 'complexity': 'UNKNOWN',
            'fortran_standard': 'F90', 'key_patterns': [], 'lowering_patterns': []}


def regenerate_one_live(construct_id: str, flang_version: str) -> dict:
    src_path = SAMPLES / f'{construct_id}.f90'
    if not src_path.exists():
        raise FileNotFoundError(f'Sample not found: {src_path}')
    source = src_path.read_text()

    raw = asyncio.run(compile_all_stages(source, filename=f'{construct_id}.f90'))
    raw_stages = {name: res.output for name, res in raw.items()}

    return _build_pipeline_result(
        construct_id  = construct_id,
        source        = source,
        raw_stages    = raw_stages,
        existing_meta = _load_existing(construct_id),
        flang_version = flang_version,
    )


def regenerate_one_from_dumps(construct_id: str, dump_dir: Path) -> dict:
    manifest_path = dump_dir / 'manifest.json'
    flang_version = None
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        flang_version = manifest.get('flang_version')

    # Source: prefer the .f90 sample; fall back to manifest
    src_path = SAMPLES / f'{construct_id}.f90'
    if src_path.exists():
        source = src_path.read_text()
    else:
        source = json.loads(manifest_path.read_text()).get('source', '') if manifest_path.exists() else ''

    raw_stages = _load_dumps(dump_dir)
    return _build_pipeline_result(
        construct_id  = construct_id,
        source        = source,
        raw_stages    = raw_stages,
        existing_meta = _load_existing(construct_id),
        flang_version = flang_version,
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--construct', '-c', metavar='ID',
                    help='Regenerate only this construct (default: all)')
    ap.add_argument('--from-dumps', metavar='DIR',
                    help='Read stage dumps from collect_pipeline_dumps.sh output dir')
    ap.add_argument('--dry-run', '-n', action='store_true',
                    help='Print what would be written but do not write')
    args = ap.parse_args()

    # ── from-dumps mode ───────────────────────────────────────────────────
    if args.from_dumps:
        dump_dir = Path(args.from_dumps)
        if not dump_dir.is_dir():
            print(f'ERROR: {dump_dir} is not a directory', file=sys.stderr)
            sys.exit(1)
        cid = args.construct or dump_dir.name
        print(f'  Regenerating {cid} from {dump_dir}…')
        result = regenerate_one_from_dumps(cid, dump_dir)
        out_path = PREGENERATED / f'{cid}.json'
        if not args.dry_run:
            out_path.write_text(json.dumps(result, indent=2))
            print(f'  ✓  {out_path}  ({len(result["correlations"])} correlations)')
        else:
            print(f'  [dry-run] would write {out_path}')
        return

    # ── live compile mode ─────────────────────────────────────────────────
    ok, version = detect_flang()
    if not ok:
        print('ERROR: FLANG_BINARY not found. Install flang-new or use --from-dumps.',
              file=sys.stderr)
        sys.exit(1)
    print(f'  flang: {version}')

    if args.construct:
        constructs = [args.construct]
    else:
        constructs = sorted(p.stem for p in PREGENERATED.glob('*.json'))

    for cid in constructs:
        t0 = time.monotonic()
        try:
            result = regenerate_one_live(cid, version)
            out_path = PREGENERATED / f'{cid}.json'
            if not args.dry_run:
                out_path.write_text(json.dumps(result, indent=2))
            elapsed = time.monotonic() - t0
            n = len(result['correlations'])
            tag = '[dry-run] would write' if args.dry_run else '✓'
            print(f'  {tag}  {cid:<34} {n:2} correlations  {elapsed:.1f}s')
        except Exception as e:
            print(f'  ✗  {cid}: {e}')


if __name__ == '__main__':
    main()
