# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Data layer: IndexedDB (11 stores per spec §2.1), versioned migrations, repositories, idempotent first-run seeding (reference-athlete preset + catalogs).
- Pure rule engine extracted from the normative prototype snapshot: load model (sRPE-TL + flagged regional decomposition), ACWR with exact zone bounds, rules R1–R8 as declarative-catalog-driven modules, exercise-level `swapProposal` with hollow-out guard, date-dependent `exerciseReadiness`, readiness-aware strength generator.
- Normative scenario suite T01–T17 ported 1:1 (science gate, green), plus 71 unit tests; test-report pipeline and buildless science dashboard (`test-dashboard.html`) with literature anchors, evidence levels and an R1–R8 coverage matrix.
- Full German UI (Preact + HTM, vendored, buildless): Home with ridgeline + ACWR explainer, <60 s log flow, morning check-in, suggestion inbox with Raus/Rein/Bleibt swap box and per-rule feedback, week view with session editor + pointer drag & drop, rulebook, settings with generic constraint manager and generator preview.
- Offline PWA shell: service worker precache (app + vendor + self-hosted fonts + seeds), web manifest, SVG icons.
- Garmin file import: FIT/TCX/ZIP → draft logs with sRPE confirmation, `garminActivityId` idempotency; drafts stay out of the load model until confirmed (AC9).
- Repository scaffolding: docs (spec v2.0, kickoff prompt, prototype references), seed catalogs, declarative rule catalog (aligned to spec v2.0: 4 operations incl. `swap`), CI skeleton, 4 ADRs.
