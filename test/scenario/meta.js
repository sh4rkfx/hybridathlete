// Metadata for the normative scenario tests T01–T17: literature anchor (AC +
// source) and evidence level, joined into test-report.js by
// scripts/build-report.mjs so the dashboard links each result to its science.
// `rules` feeds the R1–R8 coverage matrix.
export const SCENARIO_META = {
  T01: { anchor: 'Lastmodell — Foster 2001 (sRPE-TL); ACWR Rolling Average (Gabbett 2016)', evidenceLevel: 'cohort', rules: ['R7'] },
  T02: { anchor: 'Engine-Integration — Regelkatalog §4, Demo-Seed', evidenceLevel: '—', rules: ['R3', 'R4', 'R7'] },
  T03: { anchor: 'AC1/R3 — Pulley ≥48 h (Low; Climbing Doctor; Hooper’s Beta)', evidenceLevel: 'expert-consensus', rules: ['R3'] },
  T04: { anchor: 'AC5/R4 — DOMS 24–72 h (Eston 1995; Reviews)', evidenceLevel: 'cohort', rules: ['R4'] },
  T05: { anchor: 'AC10/R7 — ACWR >1.5 (Gabbett 2016, BJSM 50(5):273–280)', evidenceLevel: 'cohort', rules: ['R7'] },
  T06: { anchor: 'AC1/G4 — Fix-Schutz-Invariante (Spez §3.2)', evidenceLevel: '—', rules: ['R1', 'R3', 'R4', 'R5', 'R6', 'R7'] },
  T07: { anchor: 'Zustandsübergang — Annahme-Mutation (Spez §3.5)', evidenceLevel: '—', rules: ['R4'] },
  T08: { anchor: 'AC8/G3 — Ablehnungs-Persistenz (Spez §3.5)', evidenceLevel: '—', rules: ['R1', 'R3', 'R4', 'R5', 'R6', 'R7'] },
  T09: { anchor: 'AC2/G5/R1 — Pain-Monitoring-Model (Silbernagel 2007, RCT)', evidenceLevel: 'rct', rules: ['R1', 'R3'] },
  T10: { anchor: 'R5 — muskuläre Erholung 48–72 h (Trainingsphysiologie)', evidenceLevel: 'expert-consensus', rules: ['R5'] },
  T11: { anchor: 'AC6/R2 — Constraint-Substitution Knie (Beugetiefe)', evidenceLevel: 'expert-consensus', rules: ['R2'] },
  T12: { anchor: 'R2 generisch — Region-Sperre über Load-Matrix', evidenceLevel: 'expert-consensus', rules: ['R2'] },
  T13: { anchor: 'Lastmodell-Integrität — keine Doppelzählung (Spez §3.5)', evidenceLevel: '—', rules: ['R3', 'R7'] },
  T14: { anchor: 'AC11/R4 — Übungsebene swap (Spez §3.4)', evidenceLevel: 'cohort', rules: ['R4'] },
  T15: { anchor: 'AC11/R4 — Aushöhl-Schutz (Spez §3.4)', evidenceLevel: 'cohort', rules: ['R4'] },
  T16: { anchor: 'R5 — Übungsebene swap (Spez §3.4)', evidenceLevel: 'expert-consensus', rules: ['R5'] },
  T17: { anchor: 'AC13 — exerciseReadiness datumsabhängig (Spez §3.6)', evidenceLevel: '—', rules: ['R1', 'R2', 'R4', 'R5'] },
};
