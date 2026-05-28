#!/usr/bin/env bash
# collect_pipeline_dumps.sh — dump all 5 Flang compilation stages for a .f90 file
#
# Usage:
#   ./scripts/collect_pipeline_dumps.sh <source.f90> [output_dir]
#   FLANG_BINARY=/path/to/flang-new ./scripts/collect_pipeline_dumps.sh file.f90
#
# Output (in output_dir, default = dumps/<stem>):
#   01_parse_tree.txt    -fdebug-dump-parse-tree
#   02_semantics.txt     -fdebug-dump-symbols
#   03_fir.mlir          -emit-fir -mmlir --mlir-print-ir-before-all
#   04_hlfir.mlir        -emit-fir -mmlir --mlir-print-ir-after-all
#   05_llvm_ir.ll        -emit-llvm -S
#   manifest.json        metadata: source, flang version, flags, timestamp
set -euo pipefail

FLANG=${FLANG_BINARY:-flang-new}
SRC="${1:?Usage: $0 <source.f90> [output_dir]}"
SRC_ABS="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"
STEM="$(basename "${SRC%.f90}")"
OUT="${2:-dumps/$STEM}"

# ── checks ────────────────────────────────────────────────────────────────────
if ! command -v "$FLANG" &>/dev/null; then
  echo "ERROR: '$FLANG' not found. Set FLANG_BINARY= or install flang-new." >&2
  exit 1
fi
[ -f "$SRC" ] || { echo "ERROR: $SRC not found" >&2; exit 1; }

VERSION=$("$FLANG" --version 2>&1 | head -1)
mkdir -p "$OUT"

echo "  flang: $VERSION"
echo "  src:   $SRC_ABS"
echo "  out:   $OUT"
echo ""

run_stage() {
  local name="$1" outfile="$2"; shift 2
  printf "  %-30s " "$name"
  if "$FLANG" "$@" "$SRC_ABS" 2>"$OUT/$outfile" || true; then
    # Most stage dumps land on stderr; -emit-llvm writes to -o
    echo "✓  $(wc -l < "$OUT/$outfile") lines → $outfile"
  else
    echo "✗  (compiler error; partial output in $outfile)"
  fi
}

# Stage 1: Parse Tree
run_stage "Parse Tree" "01_parse_tree.txt" \
  -fdebug-dump-parse-tree -fsyntax-only -O0

# Stage 2: Semantics (symbol tables)
run_stage "Semantics"  "02_semantics.txt" \
  -fdebug-dump-symbols -fsyntax-only -O0

# Stage 3: FIR (before HLFIR passes)
run_stage "FIR"        "03_fir.mlir" \
  -emit-fir -S -mmlir --mlir-print-ir-before-all -O0 -g -o /dev/null

# Stage 4: HLFIR (after all MLIR passes)
run_stage "HLFIR"      "04_hlfir.mlir" \
  -emit-fir -S -mmlir --mlir-print-ir-after-all -O0 -g -o /dev/null

# Stage 5: LLVM IR
printf "  %-30s " "LLVM IR"
"$FLANG" -emit-llvm -S -O0 -g "$SRC_ABS" -o "$OUT/05_llvm_ir.ll" 2>/dev/null || true
echo "✓  $(wc -l < "$OUT/05_llvm_ir.ll") lines → 05_llvm_ir.ll"

# Manifest
python3 - "$OUT" "$SRC_ABS" "$VERSION" "$STEM" <<'EOF'
import json, sys, datetime
out, src, ver, stem = sys.argv[1:]
m = {
  "source_file": src, "stem": stem,
  "flang_version": ver,
  "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
  "stages": {
    "parse_tree": "01_parse_tree.txt",
    "semantics":  "02_semantics.txt",
    "fir":        "03_fir.mlir",
    "hlfir":      "04_hlfir.mlir",
    "llvm_ir":    "05_llvm_ir.ll",
  },
  "flags": {
    "parse_tree": "-fdebug-dump-parse-tree -fsyntax-only -O0",
    "semantics":  "-fdebug-dump-symbols   -fsyntax-only -O0",
    "fir":        "-emit-fir -S -mmlir --mlir-print-ir-before-all -O0 -g",
    "hlfir":      "-emit-fir -S -mmlir --mlir-print-ir-after-all  -O0 -g",
    "llvm_ir":    "-emit-llvm -S -O0 -g",
  }
}
open(f"{out}/manifest.json","w").write(json.dumps(m, indent=2))
print(f"  Manifest                       ✓  {out}/manifest.json")
EOF

echo ""
echo "  Done. To build a trace JSON:"
echo "    python3 scripts/regenerate_pregenerated.py --from-dumps $OUT"
