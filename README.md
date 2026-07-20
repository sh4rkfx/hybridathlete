# HybridAthlete — Adaptive Training Planner (PWA)

An offline-first PWA that watches your self-planned training week and, based on logged
load, fatigue and pain, proposes **evidence-based replanning** — without ever touching
fixed sessions (boulder nights, mountain days). It also generates a strength plan that
is compatible with the other load axes (bouldering, running, mountain).

The **app UI is German**; code, comments, commits and docs are English.

> Status: scaffolding. The engine science gate (normative scenario tests T01–T17) is the
> first milestone; UI follows once it is green.

## Scientific basis

Every active planning rule carries a `source` and an `evidenceLevel`
(`meta-analysis > rct > cohort > expert-consensus > assumption`) — enforced by a test.
Where evidence is thin it is labeled, not hidden.

| Rule | Topic | Source | Evidence |
|------|-------|--------|----------|
| R1 | Pain-monitoring model (NRS traffic light) | Silbernagel et al. 2007, Am J Sports Med | rct |
| R2 | Permanent constraints (e.g. knee flexion) | user-defined; substitution mechanic | expert-consensus |
| R3 | Tendon/pulley recovery ≥ 48 h | Low; The Climbing Doctor; Hooper's Beta | expert-consensus |
| R4 | Eccentric fatigue / DOMS after mountain descents | Eston 1995; DOMS reviews | cohort |
| R5 | General muscular recovery (fatigue traffic light) | training physiology | expert-consensus |
| R6 | Strength/endurance interference | Hickson 1980; Schumann 2022 meta-analysis | meta-analysis |
| R7 | ACWR weekly load steering (systemic only) | Gabbett 2016 — with documented criticism (Lolli 2019, Impellizzeri 2020) | cohort |

Honest `assumption` flags: the **regional load decomposition** (§3.1 of the spec) and the
**elevation-gain scaling** of R4 are transparent but unvalidated extensions of the
validated sRPE×duration load model (Foster 2001). Details:
[docs/Spezifikation_Adaptiver_Trainingsplaner.md](docs/Spezifikation_Adaptiver_Trainingsplaner.md).

## Architecture

Hard separation line:

- `src/engine/`, `src/data/`, `src/rules/` — pure vanilla ES modules. No DOM, no Preact,
  engine has no DB access. This keeps the rule engine unit-testable in Node and the
  science reviewable.
- `src/ui/` — Preact + HTM (vendored ESM, buildless), presentation only.

Data flow: log → engine (`evaluate(state)`, pure) → suggestions → inbox (accept/reject
with reason) → feedback aggregated per rule.

## Getting started

Prerequisites: Node ≥ 20, npm.

```sh
npm install        # dev dependencies only (vitest); the app itself is buildless
npm test           # unit + scenario tests, writes test-report.js
npx serve .        # any static server — ES modules need http(s), then open index.html
```

Open `test-dashboard.html` directly in a browser (works from `file://`) to see the
test/science dashboard.

## Data & privacy

Everything stays local in IndexedDB. No backend, no accounts. JSON export/import for
backup. Garmin data comes in via file import (FIT/TCX) only.

## Testing

Three levels: data-layer unit tests (fake-indexeddb), engine/rules unit tests, and the
normative **scenario suite T01–T17** (the "science gate": every suggestion asserted
against rule, operation and literature anchor). Coverage targets: engine+rules ≥ 90 %,
total ≥ 75 %. See the [test dashboard](test-dashboard.html).

## Roadmap

See the V2 parking lot in
[the spec, §11](docs/Spezifikation_Adaptiver_Trainingsplaner.md).

## License & contributing

[MIT](LICENSE). V1 targets a single reference athlete; issues/PRs welcome once public.
