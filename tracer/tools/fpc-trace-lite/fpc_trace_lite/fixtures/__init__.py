"""Pre-generated fixture data for all 10 demonstration constructs.

When ``FLANG_BIN`` is not set (or the binary is absent), the compiler driver
uses this module to return realistic Flang-style pipeline dumps, enabling a
full demo on any machine without requiring an LLVM build.

The fixture format mirrors the actual ``flang-new`` textual dump outputs:
  - parse_tree  : ``-fdebug-dump-parse-tree``
  - semantics   : ``-fdebug-dump-symbols``
  - hlfir       : ``-emit-mlir`` (pre-bufferisation)
  - fir         : ``-emit-mlir`` (post-bufferisation / pre-LLVM)
  - llvm_ir     : ``--emit-llvm``
"""

from .data import FIXTURES, get_fixture, list_construct_ids

__all__ = ["FIXTURES", "get_fixture", "list_construct_ids"]
