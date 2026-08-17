# ADR 0005: The energy module lives in `src/nutrition/`, not in a second `domain/` layer

**Status:** accepted (kickoff "Adaptives Energie- und Zielzufuhr-Modul")

The kickoff specifies `domain/` (pure), `adapters/` and `storage/`. The repo already has
that split under different names, enforced by `test/architecture.test.js`: `src/engine/`
and `src/rules/` are pure and DB-free, `src/data/` owns IndexedDB, `src/ui/` owns Preact.

Adopting the kickoff names literally would give us two names for one pure layer
(`engine` + `domain`) and two access layers over a single database (`data` + `storage`).
So the mapping is: `domain/` -> `src/nutrition/` (a fourth pure layer, added to
`PURE_DIRS` and to the DB-free assertion), `adapters/` -> `src/adapters/`, `storage/` ->
a migration in the existing `src/data/db.js`.

`src/nutrition/` is a sibling of `src/engine/`, not a child: training planning and energy
balance share no state. Its only permitted `src/` import is `src/engine/time.js`.
