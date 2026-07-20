// Normative scenario suite T01–T17, ported 1:1 from
// docs/prototype/HybridAthlete_Test_Dashboard.html (the science gate).
// Fixtures and assertions are identical to the dashboard; the only deliberate
// deltas are the injected clock (fixed date instead of wall-clock NOW) and the
// full seed catalog's exercise ids (identical load profiles — see
// test/helpers/fixtures.js header for the id mapping).
import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/rules/evaluate.js';
import { acwr } from '../../src/engine/acwr.js';
import { generateStrength } from '../../src/engine/generator.js';
import { futurePlanned } from '../../src/engine/planner.js';
import { exerciseReadiness } from '../../src/engine/readiness.js';
import { DEFAULT_CATALOG } from '../../src/engine/catalog.js';
import { freshDb, mkFat } from '../helpers/fixtures.js';

// 19:00: the dashboard ran on wall-clock NOW and its T16 window (fatigue now,
// upper session at day+2 17:00, 48 h limit) presumes an evening evaluation.
const NOW = new Date('2026-07-20T19:00:00');
const H = (h) => new Date(NOW.getTime() + h * 36e5);
const EX = DEFAULT_CATALOG.exById;

describe('Lastmodell & Engine', () => {
  it('T01 — ACWR-Mathematik: bekannte Fixture ⇒ Ratio exakt 1.00', () => {
    const mk = (dAgo) => ({ id: 'x' + dAgo, sportId: 'running', date: new Date(NOW.getTime() - dAgo * 864e5).toISOString(), duration: 100, sRPE: 6 });
    const logs = [mk(3), mk(10), mk(17), mk(24)];
    const a = acwr(logs, NOW);
    expect(Math.round(a.acute)).toBe(600);
    expect(Math.round(a.chronicWk)).toBe(600);
    expect(a.ratio.toFixed(2)).toBe('1.00');
  });

  it('T02 — Demo-Seed erzeugt genau 3 Vorschläge (R3, R4, R7)', () => {
    const db = freshDb(NOW);
    const sugs = evaluate(db, NOW);
    const rules = sugs.map((s) => s.ruleId).sort().join(',');
    expect(sugs.length).toBe(3);
    expect(rules).toBe('R3,R4,R7');
  });

  it('T13 — Geloggte / ausgefallene Einheiten zählen nicht doppelt', () => {
    const db = freshDb(NOW);
    const b = db.planned.find((p) => p.sportId === 'bouldering' && p.fixed);
    b.status = 'logged';
    const r = db.planned.find((p) => p.sportId === 'running');
    r.status = 'skipped';
    const fp = futurePlanned(db, NOW);
    const leak = fp.filter((p) => p.status === 'logged' || p.status === 'skipped');
    const sugs = evaluate(db, NOW);
    const r3leak = sugs.some((s) => s.targetId === b.id);
    expect(leak.length).toBe(0);
    expect(r3leak).toBe(false);
  });
});

describe('Regeln R1–R7', () => {
  it('T03 — Fingerlast <48 h ⇒ fixes Bouldern wird abgeschwächt, nie verschoben', () => {
    const db = freshDb(NOW);
    const sugs = evaluate(db, NOW);
    const s = sugs.find((x) => x.ruleId === 'R3');
    const t = s && db.planned.find((p) => p.id === s.targetId);
    expect(s).toBeTruthy();
    expect(s.operation).toBe('reduce');
    expect(t.fixed).toBe(true);
    expect(t.sportId).toBe('bouldering');
  });

  it('T04 — Bergtag vor 30 h + reine Beineinheit in 12 h ⇒ Verschieben', () => {
    const db = freshDb(NOW);
    const sugs = evaluate(db, NOW);
    const s = sugs.find((x) => x.ruleId === 'R4');
    const t = s && db.planned.find((p) => p.id === s.targetId);
    expect(s).toBeTruthy();
    expect(s.operation).toBe('move');
    expect(t.unit).toBe('legs');
  });

  it('T05 — Projizierte ACWR > 1.5 ⇒ beweglichster Baustein (Lauf) wird gestrichen', () => {
    const db = freshDb(NOW);
    const sugs = evaluate(db, NOW);
    const s = sugs.find((x) => x.ruleId === 'R7');
    const t = s && db.planned.find((p) => p.id === s.targetId);
    const m = s && s.coach.match(/≈ ([\d.]+)/);
    expect(s).toBeTruthy();
    expect(s.operation).toBe('remove');
    expect(t.sportId).toBe('running');
    expect(t.fixed).toBe(false);
    expect(m).toBeTruthy();
    expect(parseFloat(m[1])).toBeGreaterThan(1.5);
  });

  it('T09 — Schmerz NRS 7 schlägt R3 auf demselben Ziel (Dedupe)', () => {
    const db = freshDb(NOW);
    db.pain.push({ id: 'p1', region: 'fingers', nrs: 7, ts: NOW.toISOString() });
    const sugs = evaluate(db, NOW);
    const boulder = db.planned.find((p) => p.sportId === 'bouldering' && p.fixed);
    const winner = sugs.find((s) => s.targetId === boulder.id);
    expect(winner).toBeTruthy();
    expect(winner.ruleId).toBe('R1');
    expect(winner.operation).toBe('reduce');
    expect(sugs[0].ruleId).toBe('R1');
  });

  it('T10 — Schulter platt ⇒ Push-Einheit wird verschoben (Swap unmöglich)', () => {
    const db = freshDb(NOW);
    db.fatigue.push(mkFat('shoulder', 'stop', NOW));
    const sugs = evaluate(db, NOW);
    const s = sugs.find((x) => {
      const t = db.planned.find((p) => p.id === x.targetId);
      return x.ruleId === 'R5' && t && t.unit === 'push';
    });
    expect(s).toBeTruthy();
    expect(s.operation).toBe('move');
  });
});

describe('Schutzmechanismen & Lernen', () => {
  it('T06 — Keine Regel darf eine fixe Einheit verschieben oder streichen', () => {
    const db = freshDb(NOW);
    const sugs = evaluate(db, NOW);
    const bad = sugs.filter((s) => {
      const t = db.planned.find((p) => p.id === s.targetId);
      return t && t.fixed && (s.operation === 'move' || s.operation === 'remove');
    });
    expect(bad).toEqual([]);
  });

  it('T07 — Verschieben annehmen ⇒ R4 feuert nicht erneut', () => {
    const db = freshDb(NOW);
    let sugs = evaluate(db, NOW);
    const r4 = sugs.find((s) => s.ruleId === 'R4');
    const t = db.planned.find((p) => p.id === r4.targetId);
    Object.assign(t, r4.proposed); // move +2 d -> 90 h after descent, outside the window
    sugs = evaluate(db, NOW);
    expect(sugs.some((s) => s.ruleId === 'R4')).toBe(false);
  });

  it('T08 — Abgelehnter Vorschlag kommt nie wieder', () => {
    const db = freshDb(NOW);
    let sugs = evaluate(db, NOW);
    const first = sugs[0];
    db.rejected[first.key] = 'fit';
    sugs = evaluate(db, NOW);
    expect(sugs.some((s) => s.key === first.key)).toBe(false);
  });
});

describe('Generator & Constraints', () => {
  it('T11 — Knie rot ⇒ Beineinheit ohne einzige Knie-belastende Übung', () => {
    const db = freshDb(NOW);
    db.profile.constraints = [{ id: 'k', region: 'knee', level: 'red' }];
    const units = generateStrength(db.profile);
    const legs = units.find((u) => u.unit === 'legs');
    const bad = (legs ? legs.exercises : []).filter((id) => EX[id].knee !== null);
    expect(bad).toEqual([]);
  });

  it('T12 — Constraint Schulter rot ⇒ Push ohne Schulter-Loader ≥2', () => {
    const db = freshDb(NOW);
    db.profile.constraints.push({ id: 's', region: 'shoulder', level: 'red' });
    const units = generateStrength(db.profile);
    const push = units.find((u) => u.unit === 'push');
    const bad = push.exercises.filter((id) => (EX[id].load.shoulder || 0) >= 2);
    expect(bad).toEqual([]);
  });
});

describe('Übungsebene', () => {
  it('T14 — Full Body nach Bergtag ⇒ nur Beinübungen raus, Rest bleibt', () => {
    const db = freshDb(NOW);
    const l = db.planned.find((p) => p.unit === 'legs');
    l.unit = 'full';
    l.exercises = ['barbell_bench_press', 'single_arm_dumbbell_row', 'back_squat', 'plank'];
    const sugs = evaluate(db, NOW);
    const s = sugs.find((x) => x.ruleId === 'R4');
    const legRegs = ['quads', 'posterior_chain', 'calves'];
    expect(s).toBeTruthy();
    expect(s.operation).toBe('swap');
    expect(s.swap.drop).toContain('back_squat');
    expect(s.swap.keep.length).toBe(3);
    for (const id of s.proposed.exercises) {
      expect(legRegs.some((rg) => (EX[id].load[rg] || 0) >= 2), id).toBe(false);
    }
  });

  it('T15 — Swap-Grenze: reine Beineinheit wird NICHT ausgehöhlt', () => {
    const db = freshDb(NOW);
    const sugs = evaluate(db, NOW);
    const s = sugs.find((x) => x.ruleId === 'R4');
    const ex = db.planned.find((p) => p.unit === 'legs').exercises;
    // Guard precondition: every planned leg exercise loads a leg region >= 2
    for (const id of ex) {
      expect(Math.max(EX[id].load.quads || 0, EX[id].load.posterior_chain || 0, EX[id].load.calves || 0), id).toBeGreaterThanOrEqual(2);
    }
    expect(s).toBeTruthy();
    expect(s.operation).toBe('move');
  });

  it('T16 — Oberkörper nach Bouldern ⇒ weniger / kein Pull', () => {
    const db = freshDb(NOW);
    db.fatigue.push(mkFat('upper_back', 'caution', NOW));
    const u = db.planned.find((p) => p.unit === 'push');
    u.unit = 'upper';
    u.exercises = ['barbell_bench_press', 'overhead_barbell_press', 'barbell_bent_over_row', 'barbell_curl'];
    const sugs = evaluate(db, NOW);
    const s = sugs.find((x) => x.ruleId === 'R5' && x.targetId === u.id);
    expect(s).toBeTruthy();
    expect(s.operation).toBe('swap');
    expect(s.swap.drop).toContain('barbell_bent_over_row');
    expect(s.swap.drop).not.toContain('barbell_curl');
    for (const id of s.proposed.exercises) {
      expect((EX[id].load.upper_back || 0), id).toBeLessThan(2);
    }
  });

  it('T17 — Übungs-Machbarkeit ist datumsabhängig: Bergtag-Fenster läuft ab', () => {
    const db = freshDb(NOW);
    const early = exerciseReadiness('back_squat', H(12), db, NOW);
    const late = exerciseReadiness('back_squat', H(96), db, NOW);
    const bench = exerciseReadiness('barbell_bench_press', H(12), db, NOW);
    expect(early.level).toBe('stop');
    expect(early.reasons.some((r) => /Bergtag/.test(r))).toBe(true);
    expect(late.reasons.some((r) => /Bergtag/.test(r))).toBe(false);
    expect(late.reasons.some((r) => /Knie|Beugetiefe/.test(r))).toBe(true);
    expect(bench.level).toBe('fresh');
  });
});
