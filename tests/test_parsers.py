"""
tests/test_parsers.py
=====================
Unit tests for the fpc-trace parsing and correlation pipeline.

Tests are self-contained: no flang-new required.  Each test uses a small
hand-crafted IR snippet that is representative of real Flang output.

Run: pytest tests/ -v
"""
import json
import sys
from pathlib import Path

import pytest

# ── path setup ────────────────────────────────────────────────────────────────
BACKEND = Path(__file__).parent.parent / 'tracer' / 'backend'
sys.path.insert(0, str(BACKEND))

from engine.stage_parser import (
    parse_parse_tree, parse_semantics, parse_fir,
    parse_hlfir, parse_llvm_ir, parse_stage,
)
from engine.correlation import correlate, _classify_construct, _extract_ops

PREGENERATED = BACKEND / 'samples' / 'pregenerated'


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures — minimal real-looking IR snippets
# ─────────────────────────────────────────────────────────────────────────────

PARSE_TREE_SNIPPET = """\
  SubroutineSubprogram
  | SubroutineStmt -> Name = 'array_add'
  | ExecutionPart
  | | AssignmentStmt
  | | | Variable -> Name = 'a'
  | | | Expr -> Level2Expr -> AddOp
"""

SEMANTICS_SNIPPET = """\
Symbol table: array_add
  a: ObjectEntityDetails rank=1 REAL(4) intent=IntentOut TYPE
  b: ObjectEntityDetails rank=1 REAL(4) intent=IntentIn TYPE
  n: ObjectEntityDetails rank=0 INTEGER(4) intent=IntentIn TYPE
"""

FIR_SNIPPET = """\
module @_QMtest {
  func.func @_QParray_add(%arg0: !fir.ref<!fir.array<?xf32>>) {
    %c1 = arith.constant 1 : index
    %0  = fir.load %arg0 : !fir.ref<i32>          loc(#loc1)
    %1  = fir.do_loop %iv = %c1 to %0 step %c1 {  loc(#loc2)
      %2 = fir.array_fetch %3, %iv : (!fir.array<?xf32>, index) -> f32
      %4 = arith.addf %2, %2 fastmath<contract> : f32  loc(#loc2)
      fir.result %4
    }
    return
  }
}
#loc1 = loc("01_array_assignment.f90":3:0)
#loc2 = loc("01_array_assignment.f90":9:3)
"""

HLFIR_SNIPPET = """\
// *** IR Dump After LowerHLFIR ***
module @_QMtest {
  func.func @_QParray_add(%arg0: !fir.ref<!fir.array<?xf32>>) {
    %a:2 = hlfir.declare %arg0 {uniq_name = "_QFEa"}
           : (!fir.ref<!fir.array<?xf32>>) -> (!fir.box<!fir.array<?xf32>>, !fir.ref<!fir.array<?xf32>>)
    %expr = hlfir.elemental %shape : (!fir.shape<1>) -> !hlfir.expr<?xf32> {  loc(#loc1)
    ^bb0(%i: index):
      %el = hlfir.apply %a#0, %i : (!fir.box<!fir.array<?xf32>>, index) -> f32  loc(#loc1)
      %sum = arith.addf %el, %el : f32
      hlfir.yield_element %sum : f32
    }
    hlfir.assign %expr to %a#0 : !hlfir.expr<?xf32>, !fir.box<!fir.array<?xf32>>
    hlfir.destroy %expr : !hlfir.expr<?xf32>
    return
  }
}
#loc1 = loc("01_array_assignment.f90":9:3)
"""

LLVM_IR_SNIPPET = """\
; ModuleID = 'test.f90'
define void @_QParray_add(ptr %0, ptr %1) !dbg !5 {
entry:
  %n = load i32, ptr %1, align 4, !dbg !10
  br label %loop, !dbg !11
loop:
  %iv = phi i64 [ 0, %entry ], [ %iv.next, %loop ], !dbg !11
  %b_ptr = getelementptr inbounds float, ptr %0, i64 %iv, !dbg !11
  %b_val = load float, ptr %b_ptr, align 4, !dbg !11
  %sum   = fadd contract float %b_val, %b_val, !dbg !11
  store float %sum, ptr %b_ptr, align 4, !dbg !11
  %iv.next = add nuw nsw i64 %iv, 1, !dbg !11
  %done  = icmp eq i64 %iv.next, 10, !dbg !11
  br i1 %done, label %exit, label %loop, !dbg !11
exit:
  ret void, !dbg !12
}
!5  = distinct !DISubprogram(name: "array_add", line: 1)
!10 = !DILocation(line: 3, column: 3, scope: !5)
!11 = !DILocation(line: 9, column: 3, scope: !5)
!12 = !DILocation(line: 11, column: 1, scope: !5)
"""


# ─────────────────────────────────────────────────────────────────────────────
# Stage parser tests
# ─────────────────────────────────────────────────────────────────────────────

class TestParseTree:
    def test_key_nodes_detected(self):
        ps = parse_parse_tree(PARSE_TREE_SNIPPET)
        assert 'AssignmentStmt' in ps.key_ops
        assert 'SubroutineSubprogram' in ps.key_ops

    def test_line_count(self):
        ps = parse_parse_tree(PARSE_TREE_SNIPPET)
        assert ps.line_count == len(PARSE_TREE_SNIPPET.splitlines())

    def test_empty_input(self):
        ps = parse_parse_tree('')
        assert ps.content == ''
        assert ps.line_count == 0


class TestSemantics:
    def test_symbol_extraction(self):
        ps = parse_semantics(SEMANTICS_SNIPPET)
        # Symbol lines contain TYPE — should extract variable names
        assert len(ps.key_ops) >= 2

    def test_content_preserved(self):
        ps = parse_semantics(SEMANTICS_SNIPPET)
        assert 'REAL(4)' in ps.content


class TestFIR:
    def test_key_ops_detected(self):
        ps = parse_fir(FIR_SNIPPET)
        assert 'fir.do_loop' in ps.key_ops
        assert 'fir.array_fetch' in ps.key_ops
        assert 'arith.addf' in ps.key_ops

    def test_loc_map_populated(self):
        ps = parse_fir(FIR_SNIPPET)
        # #loc2 = loc("01_array_assignment.f90":9:3)
        assert '01_array_assignment.f90:9' in ps.loc_map
        assert len(ps.loc_map['01_array_assignment.f90:9']) > 0

    def test_loc_map_line_numbers_are_ints(self):
        ps = parse_fir(FIR_SNIPPET)
        for key, lines in ps.loc_map.items():
            assert all(isinstance(ln, int) for ln in lines), \
                f'Non-int line numbers in loc_map[{key!r}]'

    def test_load_and_store_not_in_fir_key_ops(self):
        # fir.load IS in FIR key ops pattern; plain 'load' (LLVM) is not
        ps = parse_fir(FIR_SNIPPET)
        assert 'fir.load' in ps.key_ops
        assert 'load' not in ps.key_ops   # LLVM load keyword should not appear

    def test_content_preserved(self):
        ps = parse_fir(FIR_SNIPPET)
        assert 'fir.do_loop' in ps.content


class TestHLFIR:
    def test_hlfir_ops_detected(self):
        ps = parse_hlfir(HLFIR_SNIPPET)
        assert 'hlfir.elemental' in ps.key_ops
        assert 'hlfir.assign' in ps.key_ops
        assert 'hlfir.destroy' in ps.key_ops

    def test_loc_map_from_hlfir(self):
        ps = parse_hlfir(HLFIR_SNIPPET)
        assert '01_array_assignment.f90:9' in ps.loc_map

    def test_picks_last_dump_segment(self):
        # parse_hlfir should prefer the last "*** IR Dump ***" segment
        multi = "// *** IR Dump Before\nold content\n" + HLFIR_SNIPPET
        ps = parse_hlfir(multi)
        # The HLFIR-specific ops should still be found
        assert 'hlfir.elemental' in ps.key_ops


class TestLLVMIR:
    def test_instruction_keywords(self):
        ps = parse_llvm_ir(LLVM_IR_SNIPPET)
        assert 'load' in ps.key_ops
        assert 'store' in ps.key_ops
        assert 'getelementptr' in ps.key_ops
        assert 'fadd' in ps.key_ops
        assert 'phi' in ps.key_ops
        assert 'br' in ps.key_ops

    def test_dilocation_map(self):
        ps = parse_llvm_ir(LLVM_IR_SNIPPET)
        # !11 = !DILocation(line:9) — instructions with !dbg !11 should map to line 9
        assert 'input.f90:9' in ps.loc_map
        assert len(ps.loc_map['input.f90:9']) > 0

    def test_line_count(self):
        ps = parse_llvm_ir(LLVM_IR_SNIPPET)
        assert ps.line_count == len(LLVM_IR_SNIPPET.splitlines())


class TestDispatcher:
    @pytest.mark.parametrize('stage,snippet,expected_op', [
        ('parse_tree', PARSE_TREE_SNIPPET,  'AssignmentStmt'),
        ('fir',        FIR_SNIPPET,          'fir.do_loop'),
        ('hlfir',      HLFIR_SNIPPET,        'hlfir.elemental'),
        ('llvm_ir',    LLVM_IR_SNIPPET,      'load'),
    ])
    def test_dispatch_routes(self, stage, snippet, expected_op):
        ps = parse_stage(stage, snippet)
        assert expected_op in ps.key_ops


# ─────────────────────────────────────────────────────────────────────────────
# Correlation engine tests
# ─────────────────────────────────────────────────────────────────────────────

FORTRAN_SOURCE = """\
subroutine array_add(a, b, n)
  implicit none
  integer, intent(in)  :: n
  real,    intent(in)  :: b(n)
  real,    intent(out) :: a(n)

  ! DO CONCURRENT demonstrates the independence guarantee
  DO CONCURRENT (i = 1:n)
    a(i) = b(i) + 1.0
  END DO

end subroutine array_add
"""


class TestConstructClassifier:
    @pytest.mark.parametrize('line,expected', [
        ('  DO CONCURRENT (i = 1:n)',       'do_concurrent'),
        ('  a = b + c',                     'array_assignment'),
        ('  WHERE (x > 0.0)',               'where_block'),
        ('  FORALL (i = 1:n)',              'forall'),
        ('  class(Shape), intent(in) :: s', 'polymorphism'),
        ('  SELECT TYPE (s)',               'select_type'),
        ('  a(1) = a(n)[me - 1]',          'coarray_access'),
        ('  result = MATMUL(a, b)',         'matmul_intrinsic'),
        ('  recursive function f(n)',       'recursive_proc'),
        ('  IF (n < 0) THEN',              'if_stmt'),
    ])
    def test_classify(self, line, expected):
        assert _classify_construct(line) == expected, \
            f'Expected {expected!r} for {line!r}'

    def test_comment_line_ignored(self):
        # Blank / comment lines return None
        assert _classify_construct('') is None
        # But the classifier receives a stripped line so this tests the logic
        # (blank after strip → correlate() skips before calling _classify_construct)


class TestExtractOps:
    def test_fir_ops(self):
        line = '    %0 = fir.do_loop %iv = %c1 to %n step %c1 {'
        ops = _extract_ops(line)
        assert 'fir.do_loop' in ops

    def test_hlfir_ops(self):
        line = '    %e = hlfir.elemental %shape : (!fir.shape<1>) -> !hlfir.expr<?xf32> {'
        ops = _extract_ops(line)
        assert 'hlfir.elemental' in ops

    def test_llvm_keywords(self):
        line = '  %b_ptr = getelementptr inbounds float, ptr %0, i64 %iv'
        ops = _extract_ops(line)
        assert 'getelementptr' in ops

    def test_parse_tree_nodes(self):
        line = '  | AssignmentStmt'
        ops = _extract_ops(line)
        assert 'AssignmentStmt' in ops

    def test_empty_line(self):
        assert _extract_ops('') == []
        assert _extract_ops('  // comment only') == []


class TestCorrelate:
    def _run(self, source: str | None = None) -> list:
        from engine.stage_parser import ParsedStage
        src = source or FORTRAN_SOURCE
        empty = ParsedStage(content='', key_ops=[], loc_map={}, line_count=0)

        fir = parse_fir(FIR_SNIPPET)
        hlfir = parse_hlfir(HLFIR_SNIPPET)
        llvm = parse_llvm_ir(LLVM_IR_SNIPPET)
        pt = parse_parse_tree(PARSE_TREE_SNIPPET)
        sem = parse_semantics(SEMANTICS_SNIPPET)

        return correlate(src, pt, sem, fir, hlfir, llvm,
                         filename='01_array_assignment.f90')

    def test_correlations_returned(self):
        corrs = self._run()
        assert len(corrs) > 0, 'correlate() returned empty list'

    def test_correlations_have_required_fields(self):
        for c in self._run():
            assert c.source_line >= 1
            assert isinstance(c.source_text, str)
            assert isinstance(c.construct_type, str)
            assert isinstance(c.fir_ops, list)
            assert isinstance(c.hlfir_ops, list)
            assert isinstance(c.llvm_ir_lines, list)

    def test_correlated_lines_are_in_source(self):
        src_lines = FORTRAN_SOURCE.splitlines()
        for c in self._run():
            assert 1 <= c.source_line <= len(src_lines), \
                f'source_line {c.source_line} out of range'

    def test_lowering_notes_populated(self):
        corrs = self._run()
        notes = [c.lowering_notes for c in corrs if c.lowering_notes]
        assert len(notes) > 0, 'No correlations have lowering_notes'

    def test_loc_map_match_gives_op_names_not_line_numbers(self):
        """_ops_at must return IR op names, not raw integer strings."""
        corrs = self._run()
        for c in corrs:
            for ops in (c.fir_ops, c.hlfir_ops, c.llvm_ir_lines):
                for op in ops:
                    # A raw line number would be all digits
                    assert not op.isdigit(), \
                        f'Got raw line number {op!r} instead of op name in correlation'


# ─────────────────────────────────────────────────────────────────────────────
# Integration test: load pregenerated JSONs and validate schema conformance
# ─────────────────────────────────────────────────────────────────────────────

class TestPregenerated:
    """Smoke-tests against the 10 pre-generated construct traces."""

    REQUIRED_STAGES = ['parse_tree', 'semantics', 'fir', 'hlfir', 'llvm_ir']
    REQUIRED_FIELDS = ['id', 'name', 'description', 'category',
                       'complexity', 'fortran_standard', 'source',
                       'stages', 'correlations']

    @pytest.fixture(params=sorted(PREGENERATED.glob('*.json')),
                    ids=lambda p: p.stem)
    def construct(self, request):
        return json.loads(request.param.read_text())

    def test_required_top_level_fields(self, construct):
        for f in self.REQUIRED_FIELDS:
            assert f in construct, f'Missing field: {f!r} in {construct["id"]}'

    def test_all_stages_present(self, construct):
        for stage in self.REQUIRED_STAGES:
            assert stage in construct['stages'], \
                f'Missing stage {stage!r} in {construct["id"]}'

    def test_stage_has_content(self, construct):
        for stage in self.REQUIRED_STAGES:
            sd = construct['stages'][stage]
            assert 'content' in sd
            assert isinstance(sd['content'], str)
            assert len(sd['content']) > 0, \
                f'Stage {stage!r} has empty content in {construct["id"]}'

    def test_stage_line_count_matches_content(self, construct):
        """line_count should be within 25% of actual split lines.

        Pre-generated JSONs have hand-authored line_count values which may
        differ slightly from the stored content string (trailing newlines,
        comment lines, etc.).  We use a proportional tolerance rather than
        an absolute one.
        """
        for stage in self.REQUIRED_STAGES:
            sd = construct['stages'][stage]
            actual = len(sd['content'].splitlines())
            stored = sd.get('line_count', 0)
            if actual == 0:
                continue   # empty stage — skip
            ratio = abs(actual - stored) / max(actual, 1)
            assert ratio <= 0.25, \
                (f'{construct["id"]} stage {stage}: line_count={stored} '
                 f'vs actual={actual} ({ratio:.0%} discrepancy)')

    def test_correlations_are_valid(self, construct):
        for i, c in enumerate(construct['correlations']):
            assert isinstance(c.get('source_line'), int) and c['source_line'] >= 1, \
                f'{construct["id"]} correlation[{i}]: bad source_line'
            assert isinstance(c.get('source_text'), str)
            assert isinstance(c.get('construct_type'), str)

    def test_compilation_mode_valid(self, construct):
        mode = construct.get('compilation_mode', 'simulation')
        assert mode in ('simulation', 'real'), \
            f'{construct["id"]}: invalid compilation_mode={mode!r}'

    def test_source_is_valid_fortran_looking(self, construct):
        """Source should look like Fortran — not just whitespace."""
        src = construct['source']
        assert len(src.strip()) > 10, f'{construct["id"]}: suspiciously short source'
        # Should contain at least one Fortran keyword
        import re
        kw = re.compile(r'\b(subroutine|function|module|do|if|real|integer|'
                        r'end\s+subroutine|end\s+function|end\s+module)\b', re.I)
        assert kw.search(src), f'{construct["id"]}: source does not look like Fortran'
