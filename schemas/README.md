# JSON schemas

## `correlated_construct.schema.json`

Describes the shape of a **fully correlated** construct trace: source metadata, five `StageOutput` objects, and a list of `SourceCorrelation` records.

Used by:

- `scripts/validate_trace_json.sh` — structural validation of all 10 pre-generated files
- External tooling or graders consuming trace JSON

Regenerate traces from Fortran samples:

```bash
export FLANG_BINARY=flang-new   # optional
python3 scripts/regenerate_pregenerated.py
./scripts/validate_trace_json.sh
```

See [../docs/design/ENGINEERING_DESIGN.md](../docs/design/ENGINEERING_DESIGN.md) §5.1 for the canonical field definitions.
