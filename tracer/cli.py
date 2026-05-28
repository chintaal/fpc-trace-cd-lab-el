#!/usr/bin/env python3
"""
fpc-trace CLI — Flang Pipeline Construct Tracer
================================================
Traces Fortran constructs through Parse Tree → Semantics → FIR → HLFIR → LLVM IR.

Usage examples
--------------
  python tracer/cli.py --list
  python tracer/cli.py 02_do_concurrent
  python tracer/cli.py --stage hlfir 02_do_concurrent
  python tracer/cli.py --line 9 01_array_assignment
  python tracer/cli.py --json 03_where_block > trace.json
  python tracer/cli.py --output trace.html 06_polymorphism
  python tracer/cli.py --patterns
  FLANG_BINARY=flang-new python tracer/cli.py samples/my_loop.f90
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import textwrap
from pathlib import Path

# ── path setup ───────────────────────────────────────────────────────────────
_BACKEND = Path(__file__).parent / 'backend'
sys.path.insert(0, str(_BACKEND))

PREGENERATED = _BACKEND / 'samples' / 'pregenerated'

# ── ANSI colours ─────────────────────────────────────────────────────────────
STAGE_COL = {
    'parse_tree': '\033[95m', 'semantics': '\033[94m',
    'fir':        '\033[92m', 'hlfir':     '\033[93m',
    'llvm_ir':    '\033[91m',
}
RST  = '\033[0m'; BLD = '\033[1m'; DIM = '\033[2m'
CYN  = '\033[96m'; YEL = '\033[93m'; RED = '\033[91m'
CPXC = {'LOW': '\033[92m', 'MEDIUM': '\033[93m', 'HIGH': '\033[33m',
         'VERY_HIGH': '\033[91m', 'UNKNOWN': '\033[90m'}

STAGES      = ['parse_tree', 'semantics', 'fir', 'hlfir', 'llvm_ir']
STAGE_LABEL = {'parse_tree': 'Parse Tree', 'semantics': 'Semantics',
               'fir': 'FIR', 'hlfir': 'HLFIR', 'llvm_ir': 'LLVM IR'}

# ── data loading ─────────────────────────────────────────────────────────────

def load_pregenerated(cid: str) -> dict:
    for stem in (cid, Path(cid).stem):
        p = PREGENERATED / f'{stem}.json'
        if p.exists():
            return json.loads(p.read_text())
    raise FileNotFoundError(f'No pre-generated trace for: {cid!r}')


def compile_live(source_path: Path) -> dict:
    """Compile source_path with flang-new and return a PipelineResult dict."""
    from engine.compiler_runner import compile_all_stages, detect_flang
    from engine.stage_parser import parse_stage
    from engine.correlation import correlate

    ok, ver = detect_flang()
    if not ok:
        raise RuntimeError(
            'FLANG_BINARY not found. Set FLANG_BINARY= or use a pre-generated ID.'
        )
    print(f'{DIM}  flang: {ver}{RST}')

    source = source_path.read_text()
    raw    = asyncio.run(compile_all_stages(source, filename=source_path.name))

    parsed = {name: parse_stage(name, res.output) for name, res in raw.items()}
    corrs  = correlate(
        source=source,
        parse_tree=parsed['parse_tree'],
        semantics=parsed['semantics'],
        fir=parsed['fir'],
        hlfir=parsed['hlfir'],
        llvm_ir=parsed['llvm_ir'],
        filename=source_path.name,
    )

    stages = {
        name: {
            'stage': name, 'content': ps.content,
            'line_count': ps.line_count, 'key_ops': ps.key_ops,
            'loc_map': {k: list(v) for k, v in ps.loc_map.items()},
        }
        for name, ps in parsed.items()
    }

    return {
        'id': source_path.stem,
        'name': source_path.stem.replace('_', ' ').title(),
        'description': f'Live trace of {source_path.name}',
        'category': 'custom',
        'complexity': 'UNKNOWN',
        'fortran_standard': 'F2018',
        'source': source,
        'stages': stages,
        'correlations': [c.model_dump() for c in corrs],
        'lowering_patterns': [],
        'compilation_mode': 'real',
        'flang_version': ver,
    }

# ── display helpers ───────────────────────────────────────────────────────────

def _rule(ch: str = '─', width: int = 72) -> str:
    return f'{DIM}{ch * width}{RST}'


def show_list():
    print(f'\n{BLD}fpc-trace — Construct Library{RST}')
    print(_rule())
    cat = None
    for p in sorted(PREGENERATED.glob('*.json')):
        d = json.loads(p.read_text())
        if d['category'] != cat:
            cat = d['category']
            print(f'\n  {CYN}{cat.upper().replace("_"," ")}{RST}')
        cx = CPXC.get(d['complexity'], '')
        print(f'    {DIM}{d["id"][:22]:<24}{RST}'
              f'{BLD}{d["name"][:38]:<40}{RST}'
              f'{cx}{d["complexity"]:<12}{RST}'
              f'{DIM}{d["fortran_standard"]}{RST}')
    print()


def show_patterns():
    print(f'\n{BLD}fpc-trace — Lowering Patterns Reference{RST}\n')
    seen: set[str] = set()
    for p in sorted(PREGENERATED.glob('*.json')):
        d = json.loads(p.read_text())
        for pat in d.get('lowering_patterns', []):
            if pat['name'] in seen:
                continue
            seen.add(pat['name'])
            print(f'  {YEL}{BLD}{pat["name"]}{RST}')
            print(f'  {DIM}↳ {d["name"]}{RST}')
            print(f'  {textwrap.fill(pat["description"], 68, subsequent_indent="  ")}\n')


def show_pipeline(data: dict, stage_filter: str | None, focus_line: int | None,
                  max_lines: int = 50):
    print(f'\n{BLD}{"═" * 72}{RST}')
    print(f'{BLD}  {data["name"]}{RST}')
    print(f'  {DIM}{data["description"]}{RST}')
    cx = CPXC.get(data['complexity'], '')
    mode = data.get('compilation_mode', 'simulation')
    mode_tag = f'{CYN}[simulation]{RST}' if mode == 'simulation' else f'{YEL}[live:{data.get("flang_version","?")}]{RST}'
    print(f'\n  {cx}{data["complexity"]}{RST}  {CYN}{data["fortran_standard"]}{RST}'
          f'  {mode_tag}')

    # Pipeline summary bar
    parts = [f'{STAGE_COL[s]}{STAGE_LABEL[s]}{RST}'
             f'{DIM}({data["stages"].get(s,{}).get("line_count",0)}L){RST}'
             for s in STAGES]
    print(f'\n  {" → ".join(parts)}\n')

    # ── Source viewer ──────────────────────────────────────────────────────
    print(_rule()); print(f'{BLD}  Fortran Source{RST}'); print(_rule())
    src_lines = data['source'].split('\n')
    corr_map  = {c['source_line']: c for c in data.get('correlations', [])}
    for i, line in enumerate(src_lines, 1):
        if focus_line and i != focus_line:
            pass  # still show all lines, just highlight focus
        hl   = i == focus_line
        has  = i in corr_map
        mark = f'{CYN}▶{RST}' if has else ' '
        tag  = (f' {DIM}[{corr_map[i]["construct_type"].replace("_"," ")}]{RST}'
                if has else '')
        pfx  = f'{BLD}' if hl else ''
        sfx  = f'{RST}' if hl else ''
        print(f'  {DIM}{i:3}{RST} {mark} {pfx}{line}{tag}{sfx}')
    print()

    # ── Stage panels ───────────────────────────────────────────────────────
    stages_to_show = [stage_filter] if stage_filter else STAGES
    for stage in stages_to_show:
        sd = data['stages'].get(stage)
        if not sd:
            continue
        col = STAGE_COL[stage]
        print(_rule())
        print(f'{col}{BLD}  {STAGE_LABEL[stage]}{RST}  {DIM}{sd["line_count"]} lines{RST}')
        kops = sd.get('key_ops', [])
        if kops:
            print(f'  {DIM}Key ops: {", ".join(kops[:8])}{RST}')
        print()
        lines = sd['content'].split('\n')
        for ln in lines[:max_lines]:
            print(f'  {ln}')
        if len(lines) > max_lines:
            print(f'  {DIM}… {len(lines)-max_lines} more lines — use --full{RST}')
        print()

    # ── Correlations ───────────────────────────────────────────────────────
    corrs = data.get('correlations', [])
    if corrs:
        to_show = [c for c in corrs if focus_line is None or c['source_line'] == focus_line]
        if to_show:
            print(_rule()); print(f'{BLD}  Cross-Stage Correlations{RST}\n')
            for c in to_show:
                print(f'  {YEL}Line {c["source_line"]:3}{RST}  '
                      f'{BLD}{c["source_text"].strip()[:60]}{RST}')
                print(f'  {DIM}construct: {c["construct_type"].replace("_"," ")}{RST}')
                for key, label in [('hlfir_ops','HLFIR'), ('fir_ops','FIR'),
                                   ('llvm_ir_lines','LLVM IR'), ('parse_tree_nodes','Parse Tree')]:
                    ops = c.get(key, [])
                    if ops:
                        print(f'  {STAGE_COL.get(key.split("_")[0],"")}'
                              f'{label:<10}{RST}{DIM}{", ".join(ops[:5])}{RST}')
                notes = c.get('lowering_notes', '')
                if notes:
                    print(f'\n  {DIM}{textwrap.fill(notes[:300], 68, subsequent_indent="  ")}{RST}')
                print()

    # ── Lowering patterns ──────────────────────────────────────────────────
    pats = data.get('lowering_patterns', [])
    if pats:
        print(_rule()); print(f'{BLD}  Lowering Patterns{RST}\n')
        for p in pats:
            print(f'  {YEL}▸ {p["name"]}{RST}')
            print(f'    {DIM}{p["description"]}{RST}\n')

    print(_rule('═'))

# ── HTML export ───────────────────────────────────────────────────────────────

_HTML_STAGE_CSS = {
    'parse_tree': '#bc8cff', 'semantics': '#388bfd',
    'fir':        '#3fb950', 'hlfir':     '#e3b341',
    'llvm_ir':    '#f85149',
}

def export_html(data: dict, out_path: Path):
    """Generate a self-contained, offline-capable HTML trace report."""

    def _esc(s: str) -> str:
        return (s.replace('&', '&amp;').replace('<', '&lt;')
                 .replace('>', '&gt;').replace('"', '&quot;'))

    def _highlight_ir(text: str, stage: str) -> str:
        t = _esc(text)
        if stage in ('fir', 'hlfir'):
            t = re.sub(r'(hlfir\.\w+)',
                       r'<span class="op-hlfir">\1</span>', t)
            t = re.sub(r'(fir\.\w+)',
                       r'<span class="op-fir">\1</span>', t)
            t = re.sub(r'(arith\.\w+|math\.\w+)',
                       r'<span class="op-arith">\1</span>', t)
            t = re.sub(r'(//[^\n]*)',
                       r'<span class="comment">\1</span>', t)
            t = re.sub(r'(%\w+)',
                       r'<span class="reg">\1</span>', t)
        elif stage == 'llvm_ir':
            kw = ('load|store|getelementptr|fadd|fmul|call|br|ret|alloca|phi|'
                  'select|icmp|fcmp|sext|zext|trunc|bitcast|add|sub|mul')
            t = re.sub(rf'\b({kw})\b',
                       r'<span class="llvm-kw">\1</span>', t)
            t = re.sub(r'(;[^\n]*)',
                       r'<span class="comment">\1</span>', t)
            t = re.sub(r'(@[\w$.]+)',
                       r'<span class="llvm-global">\1</span>', t)
        return t

    corr_map = {c['source_line']: c for c in data.get('correlations', [])}

    def _source_html() -> str:
        lines = data['source'].split('\n')
        out = ['<div class="source-panel"><pre>']
        for i, line in enumerate(lines, 1):
            corr = corr_map.get(i)
            cls = 'src-line'
            mark = ''
            if corr:
                cls += ' src-corr'
                mark = f'<span class="construct-tag">{_esc(corr["construct_type"].replace("_"," "))}</span>'
            out.append(f'<span class="{cls}" data-line="{i}">'
                       f'<span class="lineno">{i:3}</span> '
                       f'{mark}{_esc(line)}</span>')
        out.append('</pre></div>')
        return '\n'.join(out)

    def _stage_html(stage: str) -> str:
        sd = data['stages'].get(stage, {})
        content = sd.get('content', '(no data)')
        kops    = sd.get('key_ops', [])
        lc      = sd.get('line_count', 0)
        col     = _HTML_STAGE_CSS.get(stage, '#888')
        ops_html = ' '.join(f'<code class="op-chip">{_esc(op)}</code>' for op in kops[:8])
        return f'''<div class="stage-panel" id="stage-{stage}">
  <div class="stage-header" style="border-left:3px solid {col}">
    <span class="stage-name" style="color:{col}">{STAGE_LABEL[stage]}</span>
    <span class="meta">{lc} lines</span>
  </div>
  <div class="key-ops">{ops_html}</div>
  <pre class="ir-code">{_highlight_ir(content, stage)}</pre>
</div>'''

    def _corr_html() -> str:
        corrs = data.get('correlations', [])
        if not corrs:
            return '<p class="dim">No correlations</p>'
        out = []
        for c in corrs:
            ops_rows = ''
            for key, label, stage in [
                ('parse_tree_nodes', 'Parse Tree', 'parse_tree'),
                ('fir_ops',          'FIR',        'fir'),
                ('hlfir_ops',        'HLFIR',      'hlfir'),
                ('llvm_ir_lines',    'LLVM IR',    'llvm_ir'),
            ]:
                ops = c.get(key, [])
                if ops:
                    col = _HTML_STAGE_CSS.get(stage, '#888')
                    chips = ' '.join(
                        f'<code class="op-chip" style="color:{col}">{_esc(o)}</code>'
                        for o in ops[:5]
                    )
                    ops_rows += (f'<div class="corr-row">'
                                 f'<span class="corr-stage" style="color:{col}">{label}</span>'
                                 f'{chips}</div>')
            notes_html = (f'<p class="lowering-notes">{_esc(c.get("lowering_notes",""))}</p>'
                          if c.get('lowering_notes') else '')
            out.append(f'''<div class="corr-card">
  <div class="corr-header">
    <span class="lineno-tag">Line {c["source_line"]}</span>
    <code class="src-text">{_esc(c["source_text"].strip())}</code>
    <span class="ct-tag">{_esc(c["construct_type"].replace("_"," "))}</span>
  </div>
  <div class="corr-ops">{ops_rows}</div>
  {notes_html}
</div>''')
        return '\n'.join(out)

    def _patterns_html() -> str:
        pats = data.get('lowering_patterns', [])
        if not pats:
            return ''
        rows = ''.join(
            f'<div class="pat-card"><strong>{_esc(p["name"])}</strong>'
            f'<p>{_esc(p["description"])}</p></div>'
            for p in pats
        )
        return f'<section><h2>Lowering Patterns</h2>{rows}</section>'

    mode = data.get('compilation_mode', 'simulation')
    mode_badge = ('simulation' if mode == 'simulation'
                  else f'live · {_esc(data.get("flang_version","?"))}')

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>fpc-trace · {_esc(data["name"])}</title>
<style>
:root {{
  --bg:#0d1117; --surface:#161b22; --border:#30363d;
  --text:#e6edf3; --dim:#8b949e; --muted:#484f58;
  --parse-tree:#bc8cff; --semantics:#388bfd; --fir:#3fb950;
  --hlfir:#e3b341; --llvm-ir:#f85149;
  --font-mono:'JetBrains Mono','Fira Code','Cascadia Code',monospace;
}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.5}}
h1{{font-size:18px;font-weight:700;margin-bottom:4px}}
h2{{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--dim);margin:24px 0 12px}}
.header{{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px}}
.header .meta{{font-size:11px;color:var(--dim);margin-top:4px}}
.badge{{display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;border:1px solid rgba(56,139,253,.3);background:rgba(56,139,253,.1);color:#388bfd;margin-right:6px}}
.pipeline-bar{{display:flex;align-items:center;gap:8px;padding:10px 24px;background:var(--surface);border-bottom:1px solid var(--border)}}
.stage-chip{{padding:3px 10px;border-radius:4px;font-family:var(--font-mono);font-size:10px;font-weight:700;border:1px solid;cursor:pointer}}
.stage-chip:hover{{opacity:.8}}
.arrow{{color:var(--muted);font-size:10px}}
.content{{display:grid;grid-template-columns:38% 1fr;height:calc(100vh - 120px);overflow:hidden}}
.source-panel{{border-right:1px solid var(--border);overflow:auto;background:var(--surface)}}
.source-panel pre{{padding:12px 0;font-family:var(--font-mono);font-size:12px;line-height:20px}}
.src-line{{display:block;padding:0 12px 0 0;white-space:pre}}
.src-corr{{border-left:3px solid rgba(56,139,253,.4);background:rgba(56,139,253,.05);cursor:pointer}}
.src-corr:hover{{background:rgba(56,139,253,.1)}}
.lineno{{color:var(--muted);min-width:36px;display:inline-block;text-align:right;padding-right:12px;user-select:none}}
.construct-tag{{font-size:8px;font-weight:700;padding:1px 5px;border-radius:8px;background:rgba(56,139,253,.2);color:#388bfd;text-transform:uppercase;margin-right:4px}}
.stages-col{{overflow-y:auto;background:var(--surface)}}
.stage-tabs{{display:flex;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10;background:var(--surface)}}
.stage-tab{{padding:8px 14px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font-mono);border-bottom:2px solid transparent;color:var(--dim)}}
.stage-tab.active{{border-bottom-color:currentColor}}
.stage-panel{{display:none;padding:0}}
.stage-panel.active{{display:block}}
.stage-header{{padding:8px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}}
.stage-name{{font-family:var(--font-mono);font-size:11px;font-weight:700}}
.meta{{font-size:10px;color:var(--dim)}}
.key-ops{{padding:6px 14px;display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--border)}}
.op-chip{{font-family:var(--font-mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--dim)}}
.ir-code{{padding:10px 14px;font-family:var(--font-mono);font-size:11.5px;line-height:18px;tab-size:2;overflow:auto}}
.comment{{color:var(--dim);font-style:italic}}
.op-hlfir{{color:#e3b341;font-weight:700}}
.op-fir{{color:#3fb950;font-weight:700}}
.op-arith{{color:#39c5cf}}
.reg{{color:#a5d6ff}}
.llvm-kw{{color:#f85149;font-weight:600}}
.llvm-global{{color:#d2a8ff}}
.section{{padding:20px 24px;border-top:1px solid var(--border)}}
.corr-card{{background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px}}
.corr-header{{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1c2128;flex-wrap:wrap}}
.lineno-tag{{font-size:10px;color:var(--dim);flex-shrink:0}}
.src-text{{font-family:var(--font-mono);font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.ct-tag{{font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;background:rgba(56,139,253,.15);color:#388bfd;border:1px solid rgba(56,139,253,.3);text-transform:uppercase;letter-spacing:.4px}}
.corr-ops{{padding:8px 12px;display:flex;flex-direction:column;gap:4px}}
.corr-row{{display:flex;align-items:center;gap:6px;flex-wrap:wrap}}
.corr-stage{{font-size:9px;font-weight:700;min-width:72px;text-transform:uppercase}}
.lowering-notes{{padding:8px 12px;font-size:11px;color:var(--dim);border-top:1px solid var(--border);line-height:1.6}}
.pat-card{{background:#1c2128;border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:8px}}
.pat-card strong{{color:#e3b341;font-size:12px;display:block;margin-bottom:4px}}
.pat-card p{{font-size:11px;color:var(--dim);line-height:1.6}}
footer{{padding:12px 24px;color:var(--muted);font-size:10px;border-top:1px solid var(--border);background:var(--surface)}}
</style>
</head>
<body>
<div class="header">
  <h1>{_esc(data["name"])}</h1>
  <div class="meta">
    <span class="badge">{_esc(mode_badge)}</span>
    <span class="badge" style="border-color:rgba(63,185,80,.3);background:rgba(63,185,80,.1);color:#3fb950">{_esc(data.get("fortran_standard",""))}</span>
    <span class="badge" style="border-color:rgba(255,255,255,.15);background:transparent;color:var(--dim)">{_esc(data.get("complexity",""))}</span>
    <span style="color:var(--dim);margin-left:8px">{_esc(data["description"])}</span>
  </div>
</div>

<div class="pipeline-bar">
  {"".join(
    f'<span class="stage-chip" style="color:{_HTML_STAGE_CSS[s]};border-color:{_HTML_STAGE_CSS[s]}40"'
    f' onclick="setStage(\'{s}\')">{STAGE_LABEL[s]}</span>'
    + (f'<span class="arrow">→</span>' if i < len(STAGES)-1 else '')
    for i, s in enumerate(STAGES)
  )}
</div>

<div class="content">
{_source_html()}
<div class="stages-col">
  <div class="stage-tabs">
    {"".join(f'<span class="stage-tab" id="tab-{s}" style="color:{_HTML_STAGE_CSS[s]}" onclick="setStage(\'{s}\')">{STAGE_LABEL[s]}</span>' for s in STAGES)}
  </div>
  {"".join(_stage_html(s) for s in STAGES)}
</div>
</div>

<div class="section">
  <h2>Cross-Stage Correlations</h2>
  {_corr_html()}
</div>

{_patterns_html()}

<footer>
  fpc-trace · Assignment 33 · Flang Pipeline Construct Tracer ·
  <a href="https://github.com/llvm/llvm-project/tree/main/flang" style="color:#388bfd">Flang upstream ↗</a>
</footer>

<script>
function setStage(s) {{
  document.querySelectorAll('.stage-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.stage-tab').forEach(t => t.classList.remove('active'));
  const p = document.getElementById('stage-' + s);
  const t = document.getElementById('tab-' + s);
  if (p) p.classList.add('active');
  if (t) t.classList.add('active');
}}
setStage('{STAGES[3]}');
</script>
</body>
</html>'''

    out_path.write_text(html, encoding='utf-8')
    print(f'{CYN}  HTML report → {out_path}{RST}')


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description='fpc-trace — Flang Pipeline Construct Tracer',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument('input',     nargs='?',
                    help='Construct ID (e.g. 02_do_concurrent) or path to .f90 file')
    ap.add_argument('--list',    '-l', action='store_true', help='List all constructs')
    ap.add_argument('--patterns','-p', action='store_true', help='Show lowering patterns')
    ap.add_argument('--stage',   '-s', choices=STAGES, metavar='STAGE',
                    help='Show only one stage: ' + '|'.join(STAGES))
    ap.add_argument('--line',    '-n', type=int, metavar='N',
                    help='Focus on a specific source line number')
    ap.add_argument('--json',    '-j', action='store_true', help='Output raw JSON')
    ap.add_argument('--output',  '-o', metavar='FILE',
                    help='Write self-contained HTML report to FILE')
    ap.add_argument('--full',    '-f', action='store_true',
                    help='Show full IR without line-count truncation')
    args = ap.parse_args()

    if args.list:
        show_list(); return

    if args.patterns:
        show_patterns(); return

    if not args.input:
        ap.print_help()
        print(f'\n{DIM}Quick start: python tracer/cli.py --list{RST}')
        return

    # ── resolve data ──────────────────────────────────────────────────────
    src = Path(args.input)
    if src.is_file() and src.suffix == '.f90':
        print(f'{DIM}  Compiling {src} with flang-new…{RST}')
        try:
            data = compile_live(src)
        except Exception as e:
            print(f'{RED}Error: {e}{RST}', file=sys.stderr)
            sys.exit(1)
    else:
        try:
            data = load_pregenerated(args.input)
        except FileNotFoundError as e:
            print(f'{RED}Error: {e}{RST}', file=sys.stderr)
            print(f'Run --list to see available constructs.', file=sys.stderr)
            sys.exit(1)

    # ── output ────────────────────────────────────────────────────────────
    if args.json:
        print(json.dumps(data, indent=2))
        return

    if args.output:
        export_html(data, Path(args.output))
        return

    max_lines = 999 if args.full else 50
    show_pipeline(data, stage_filter=args.stage,
                  focus_line=args.line, max_lines=max_lines)


if __name__ == '__main__':
    main()
