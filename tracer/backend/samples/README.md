# Fortran construct samples

Ten minimal programs — one per Assignment 33 construct — plus pre-generated full-pipeline JSON traces.

## Files

| ID | Source | Pre-generated trace |
|----|--------|---------------------|
| 01 | `01_array_assignment.f90` | `pregenerated/01_array_assignment.json` |
| 02 | `02_do_concurrent.f90` | `pregenerated/02_do_concurrent.json` |
| 03 | `03_where_block.f90` | `pregenerated/03_where_block.json` |
| 04 | `04_forall.f90` | `pregenerated/04_forall.json` |
| 05 | `05_derived_type.f90` | `pregenerated/05_derived_type.json` |
| 06 | `06_polymorphism.f90` | `pregenerated/06_polymorphism.json` |
| 07 | `07_coarray.f90` | `pregenerated/07_coarray.json` |
| 08 | `08_intrinsics.f90` (MATMUL) | `pregenerated/08_intrinsics.json` |
| 09 | `09_recursion.f90` | `pregenerated/09_recursion.json` |
| 10 | `10_generic_interface.f90` | `pregenerated/10_generic_interface.json` |

## Regenerating traces

With `flang-new` on your PATH:

```bash
export FLANG_BINARY=flang-new
python3 ../../../scripts/regenerate_pregenerated.py
```

Each JSON file contains: source text, five stage outputs, per-line `SourceCorrelation` entries, and `lowering_notes` used when no API key is configured.

## Naming convention

- Prefix `NN_` matches construct ID in API and CLI (`02_do_concurrent`, etc.).
- JSON stems match Fortran stems for predictable loading in `main.py` and `cli.py`.
