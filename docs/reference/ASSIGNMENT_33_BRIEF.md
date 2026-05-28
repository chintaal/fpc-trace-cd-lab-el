Assignment 33 - Flang Multi-Stage Compilation Pipeline Tracer
Description: A tool that traces Fortran source constructs through every stage of Flang's unique multi-level compilation pipeline — Parse Tree, Semantics, FIR, HLFIR, LLVM IR — producing an annotated cross-level view showing how each source construct is represented and transformed at every stage.
Background: Flang has a unique compilation pipeline with 5+ representation levels between source and machine code: Parse Tree → Decorated Parse Tree → FIR → HLFIR → LLVM IR. No existing tool traces a Fortran construct across these levels. Godbolt doesn't show FIR/HLFIR. LLVM's opt-viewer doesn't understand Flang's pipeline. Flang developers currently dump each stage separately and manually correlate — an error-prone process for complex features like array operations, WHERE blocks, FORALL, polymorphism, and DO CONCURRENT. This tool would democratize understanding of Flang's lowering pipeline.
Objective: Build a tool that, given a Fortran source file and a highlighted construct (array assignment, DO CONCURRENT, derived type operation), traces that construct through Parse Tree → FIR → HLFIR → LLVM IR, showing the representation at each stage with cross- references.
Deliverables:
 
1. Pipeline instrumentation hooks at each Flang compilation stage capturing per- construct representations
2. Cross-stage correlation engine mapping source constructs to their representations at FIR, HLFIR, and LLVM IR levels
3. CLI tool producing annotated multi-level output (text, HTML, or JSON)
4. Demonstration on 10 complex Fortran constructs (array operations, DO
CONCURRENT, polymorphism, coarrays, WHERE blocks) showing the full
lowering chain
5. Documentation of lowering patterns discovered, useful as a Flang developer reference