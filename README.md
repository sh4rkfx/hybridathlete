# HybridAthlete — Adaptive Training Planner (PWA)

An offline-first PWA that watches your self-planned training week and, based on logged
load, fatigue and pain, proposes **evidence-based replanning** — without ever touching
fixed sessions (boulder nights, mountain days). It also generates a strength plan that
is compatible with the other load axes (bouldering, running, mountain).

The **app UI is German**; code, comments, commits and docs are English.

> Status: MVP feature-complete. The science gate (normative scenario tests T01–T17) is
> green, all core screens (Home, Log, Inbox, Week, Rulebook, Settings), the offline PWA
> shell and the Garmin file import are implemented. 88 tests, coverage engine 99 % /
> rules 90 % / total 96 %.

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

- `src/engine/`, `src/data/`, `src/rules/`, `src/nutrition/` — pure vanilla ES modules. No
  DOM, no Preact, and engine/rules/nutrition have no DB access. This keeps the rule engine
  unit-testable in Node and the science reviewable.
- `src/ui/` — Preact + HTM (vendored ESM, buildless), presentation only.

`src/nutrition/` is the energy and target-intake module (in progress — domain layer only,
no UI yet). It measures real daily energy turnover by reconciling tracked intake against
the regressed weight trend rather than estimating it from a formula, then derives a daily
target from it: rest-day TDEE minus a continuously scaling phase deficit, bounded by a
fat-mass-aware deficit ceiling and an intake floor, with training energy fully compensated
so energy availability stays flat across rest and training days. A rolling weekly account
reconciles plan against actual. Constants carry a source and an evidence level in
`src/nutrition/sources.json`, same as the planning rules, and the handful that are
judgement rather than evidence say so; see
[ADR 0005](docs/decisions/0005-nutrition-module-placement.md) for why it is a sibling of
`src/engine/` and not a second `domain/` layer.

Data flow: log → engine (`evaluate(state)`, pure) → suggestions → inbox (accept/reject
with reason) → feedback aggregated per rule.

## Getting started

Prerequisites: Node ≥ 20, npm.

```sh
npm install        # dev dependencies only (vitest); the app itself is buildless
npm test           # unit + scenario tests with coverage, writes test-report.js
npx http-server .  # any static server — ES modules need http(s), then open index.html
```

In the app, `Setup → Demo-Woche laden` loads the reference scenario (mountain day 30 h
ago, hard finger session 20 h ago, a week planned "blind") — the engine then produces
the three textbook suggestions (R3 reduce, R4 move, R7 remove).

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
