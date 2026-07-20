# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Plan advisor (Setup): pick goal, weekly strength days and other active sports — get a justified split recommendation (curated coverage: bouldering ≈ pull unit incl. rear-delt gap; endurance sports explicitly never count as leg-strength substitute) with sources and evidence levels, applied only on explicit accept.
- Evidence metadata for goal schemes and split choice (source + evidenceLevel like R1–R8), split-preference note and strength-frequency hint in Setup.
- First-run onboarding on Home: neutral weekly-load state ("Noch keine Daten") without a chronic base, and an "Erste Woche planen" block (generate strength plan / plan a session) replacing the dead-end empty screen.

### Fixed
- WCAG-AA contrast for small meta text (`--text-low` raised; week-slot meta was 3.74:1).
- Move suggestions and the demo seed now normalize session times to slot standard hours — no more card times outside their week-view column.
- Service-worker precache bypasses the browser HTTP cache (`cache: 'reload'`), preventing stale assets after a version bump behind caching static servers.

### Added (v0.1.0 scope)
- Data layer: IndexedDB (11 stores per spec §2.1), versioned migrations, repositories, idempotent first-run seeding (reference-athlete preset + catalogs).
- Pure rule engine extracted from the normative prototype snapshot: load model (sRPE-TL + flagged regional decomposition), ACWR with exact zone bounds, rules R1–R8 as declarative-catalog-driven modules, exercise-level `swapProposal` with hollow-out guard, date-dependent `exerciseReadiness`, readiness-aware strength generator.
- Normative scenario suite T01–T17 ported 1:1 (science gate, green), plus 71 unit tests; test-report pipeline and buildless science dashboard (`test-dashboard.html`) with literature anchors, evidence levels and an R1–R8 coverage matrix.
- Full German UI (Preact + HTM, vendored, buildless): Home with ridgeline + ACWR explainer, <60 s log flow, morning check-in, suggestion inbox with Raus/Rein/Bleibt swap box and per-rule feedback, week view with session editor + pointer drag & drop, rulebook, settings with generic constraint manager and generator preview.
- Offline PWA shell: service worker precache (app + vendor + self-hosted fonts + seeds), web manifest, SVG icons.
- Garmin file import: FIT/TCX/ZIP → draft logs with sRPE confirmation, `garminActivityId` idempotency; drafts stay out of the load model until confirmed (AC9).
- Repository scaffolding: docs (spec v2.0, kickoff prompt, prototype references), seed catalogs, declarative rule catalog (aligned to spec v2.0: 4 operations incl. `swap`), CI skeleton, 4 ADRs.
