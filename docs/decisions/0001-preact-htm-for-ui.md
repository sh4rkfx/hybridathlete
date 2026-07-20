# ADR 0001: Preact + HTM for the UI layer (buildless)

**Status:** accepted (spec v2.0, decision O2)

The week view, inbox and session editor are state-heavy; hand-rolled DOM diffing in
vanilla JS was the main source of complexity in early prototypes. Preact + HTM (~4 kB,
vendored ESM, no bundler) gives declarative rendering while staying buildless.

Consequence: Preact lives **only** in `src/ui/`. `engine/`, `data/` and `rules/` must
not import it — this keeps the engine pure, Node-testable and reviewable. The
separation is enforced by a test that scans imports.
