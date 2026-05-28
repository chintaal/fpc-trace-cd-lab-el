#!/usr/bin/env bash
# validate_trace_json.sh — validate all pregenerated JSON traces against schema
#
# Usage:
#   ./scripts/validate_trace_json.sh                    # validate all
#   ./scripts/validate_trace_json.sh 02_do_concurrent   # validate one
#
# Checks (in order):
#   1. Valid JSON syntax
#   2. Required top-level fields present
#   3. All 5 stages present with required sub-fields
#   4. Correlations have required fields with correct types
#   5. Compilation mode is one of: simulation | real
#   6. Source line numbers are positive integers
#   7. No stage with 0 lines (warns only)
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREGEN="$REPO/tracer/backend/samples/pregenerated"
SCHEMA="$REPO/schemas/correlated_construct.schema.json"

GRN='\033[0;32m'; YEL='\033[0;33m'; RED='\033[0;31m'; DIM='\033[2m'; RST='\033[0m'

PASS=0; FAIL=0; WARN=0

validate_one() {
  local file="$1"
  local name
  name="$(basename "${file%.json}")"

  # 1. JSON syntax
  if ! python3 -c "import json,sys; json.load(open('$file'))" 2>/dev/null; then
    echo -e "${RED}FAIL${RST}  $name  invalid JSON syntax"
    ((FAIL++)); return
  fi

  # 2–7. Structural checks via embedded Python
  result=$(python3 - "$file" "$name" <<'EOF'
import json, sys
path, name = sys.argv[1], sys.argv[2]
d = json.load(open(path))
errors = []; warnings = []

REQUIRED_TOP = ['id','name','description','category','complexity',
                'fortran_standard','source','stages','correlations']
for f in REQUIRED_TOP:
    if f not in d:
        errors.append(f'missing top-level field: {f!r}')

REQUIRED_STAGES = ['parse_tree','semantics','fir','hlfir','llvm_ir']
stages = d.get('stages', {})
for s in REQUIRED_STAGES:
    if s not in stages:
        errors.append(f'missing stage: {s!r}')
    else:
        sd = stages[s]
        for sf in ['stage','content','line_count','key_ops']:
            if sf not in sd:
                errors.append(f'stage {s!r} missing field: {sf!r}')
        lc = sd.get('line_count', 0)
        if lc == 0:
            warnings.append(f'stage {s!r} has 0 lines (possibly empty dump)')

for i, c in enumerate(d.get('correlations', [])):
    for cf in ['source_line','source_text','construct_type']:
        if cf not in c:
            errors.append(f'correlation[{i}] missing: {cf!r}')
    sl = c.get('source_line')
    if sl is not None and (not isinstance(sl, int) or sl < 1):
        errors.append(f'correlation[{i}] source_line must be int >= 1, got {sl!r}')

mode = d.get('compilation_mode','simulation')
if mode not in ('simulation','real'):
    errors.append(f'compilation_mode must be simulation|real, got {mode!r}')

for e in errors:
    print(f'ERROR: {e}')
for w in warnings:
    print(f'WARN: {w}')
if not errors and not warnings:
    print('OK')
EOF
)

  local had_error=0
  while IFS= read -r line; do
    if [[ "$line" == ERROR:* ]]; then
      echo -e "${RED}FAIL${RST}  $name  ${line#ERROR: }"
      had_error=1
    elif [[ "$line" == WARN:* ]]; then
      echo -e "${YEL}WARN${RST}  $name  ${line#WARN: }"
      ((WARN++))
    fi
  done <<< "$result"

  if [ "$had_error" -eq 1 ]; then
    ((FAIL++))
  else
    echo -e "${GRN} OK ${RST}  $name"
    ((PASS++))
  fi
}

echo -e "\n${DIM}fpc-trace — JSON trace validator${RST}\n"

if [ "${1:-}" != "" ]; then
  f="$PREGEN/${1%.json}.json"
  [ -f "$f" ] || { echo "ERROR: $f not found"; exit 1; }
  validate_one "$f"
else
  for f in $(ls "$PREGEN"/*.json | sort); do
    validate_one "$f"
  done
fi

echo ""
echo -e "  ${GRN}PASS: $PASS${RST}  ${YEL}WARN: $WARN${RST}  ${RED}FAIL: $FAIL${RST}"

# Check jsonschema if available
if python3 -c "import jsonschema" 2>/dev/null && [ -f "$SCHEMA" ]; then
  echo -e "\n${DIM}Running jsonschema validation…${RST}"
  python3 - "$PREGEN" "$SCHEMA" <<'EOF'
import json, sys
from pathlib import Path
try:
    import jsonschema
    schema = json.loads(Path(sys.argv[2]).read_text())
    ok = fail = 0
    for p in sorted(Path(sys.argv[1]).glob('*.json')):
        d = json.loads(p.read_text())
        try:
            jsonschema.validate(d, schema)
            print(f"  OK   {p.stem}")
            ok += 1
        except jsonschema.ValidationError as e:
            print(f"  FAIL {p.stem}: {e.message}")
            fail += 1
    print(f"\n  schema: {ok} valid, {fail} invalid")
except ImportError:
    print("  jsonschema not installed — skipping schema validation")
EOF
fi

[ "$FAIL" -eq 0 ]  # exit 0 only if no failures
