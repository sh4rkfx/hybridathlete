// Normative scenario suite T01–T17, ported 1:1 from
// docs/prototype/HybridAthlete_Test_Dashboard.html (the science gate).
// Fixtures and assertions are identical to the dashboard; the only deliberate
// deltas are the injected clock (fixed date instead of wall-clock NOW) and the
// full seed catalog's exercise ids (identical load profiles — see
// test/helpers/fixtures.js header for the id mapping).
//
// Story #41: each test record()s Input / Expected / Actual BEFORE asserting,
// so the dashboard can show them even for red runs (dashboard parity).
import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/rules/evaluate.js';
import { acwr } from '../../src/engine/acwr.js';
import { generateStrength } from '../../src/engine/generator.js';
import { futurePlanned } from '../../src/engine/planner.js';
import { exerciseReadiness } from '../../src/engine/readiness.js';
import { DEFAULT_CATALOG } from '../../src/engine/catalog.js';
import { exNames } from '../../src/engine/swap.js';
import { freshDb, mkFat } from '../helpers/fixtures.js';
import { record } from '../helpers/record.js';

// 19:00: the dashboard ran on wall-clock NOW and its T16 window (fatigue now,
// upper session at day+2 17:00, 48 h limit) presumes an evening evaluation.
const NOW = new Date('2026-07-20T19:00:00');
const H = (h) => new Date(NOW.getTime() + h * 36e5);
const EX = DEFAULT_CATALOG.exById;

const sugList = (db, sugs) => sugs.map((s) => {
  const t = db.planned.find((p) => p.id === s.targetId) || {};
  return `${s.ruleId} · ${s.operation} → ${DEFAULT_CATALOG.sports[t.sportId]?.name ?? '?'}${t.unit ? ` (${t.unit})` : ''}${t.fixed ? ' [FIX]' : ''}`;
}).join('\n');

describe('Lastmodell & Engine', () => {
  it('T01 — ACWR-Mathematik: bekannte Fixture ⇒ Ratio exakt 1.00', () => {
    const mk = (dAgo) => ({ id: 'x' + dAgo, sportId: 'running', date: new Date(NOW.getTime() - dAgo * 864e5).toISOString(), duration: 100, sRPE: 6 });
    const logs = [mk(3), mk(10), mk(17), mk(24)];
    const a = acwr(logs, NOW);
    record('T01', {
      input: 'logs = 4 × (100 min · sRPE 6) @ vor 3 / 10 / 17 / 24 Tagen\nsrpeTL je Einheit = 6 × 100 = 600',
      expected: 'acute = 600\nchronicWk = 2400 / 4 = 600\nratio = 1.00',
      actual: `acute = ${Math.round(a.acute)}\nchronicWk = ${Math.round(a.chronicWk)}\nratio = ${a.ratio.toFixed(2)}`,
    });
    expect(Math.round(a.acute)).toBe(600);
    expect(Math.round(a.chronicWk)).toBe(600);
    expect(a.ratio.toFixed(2)).toBe('1.00');
  });

  it('T02 — Demo-Seed erzeugt genau 3 Vorschläge (R3, R4, R7)', () => {
    const db = freshDb(NOW);
    const sugs = evaluate(db, NOW);
    const rules = sugs.map((s) => s.ruleId).sort().join(',');
    record('T02', {
      input: `seed(): ${db.logs.length} Logs (28 d) · ${db.planned.length} geplante Einheiten · Bergtag −30 h · harte Finger −20 h`,
      expected: '3 Vorschläge: R3, R4, R7',
      actual: `${sugs.length} Vorschläge: ${rules}\n${sugList(db, sugs)}`,
    });
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
    record('T13', {
      input: "bouldering.status='logged' · running.status='skipped'",
      expected: 'futurePlanned enthält keine davon · R3 zielt nicht mehr aufs geloggte Bouldern',
      actual: `Leaks in futurePlanned: ${leak.length} · R3 auf geloggtes Bouldern: ${r3leak ? 'ja' : 'nein'}`,
    });
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
    record('T03', {
      input: 'lastFinger = Bouldern (hardFingerLoad) vor 20 h\ngeplant: Bouldern HEUTE, fixed=true, in ~3 h ⇒ Abstand ~23 h',
      expected: 'R3 · operation=reduce · Ziel=Bouldern (fix)',
      actual: s ? `R3 · operation=${s.operation} · Ziel=${DEFAULT_CATALOG.sports[t?.sportId]?.name ?? '?'}${t?.fixed ? ' (fix)' : ''}` : 'kein R3-Vorschlag',
    });
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
    record('T04', {
      input: 'lastEcc = Bergtag 1150 hm vor 30 h ⇒ Fenster 48–72 h aktiv\ngeplant: Kraft legs in ~12 h ⇒ 42 h nach Abstieg (< 48 h)\nÜbungen: alle mit Bein-Load ≥2 ⇒ Swap-Guard greift',
      expected: 'R4 · operation=move · Ziel=Kraft (legs)',
      actual: s ? `R4 · operation=${s.operation} · Ziel=${DEFAULT_CATALOG.sports[t?.sportId]?.name ?? '?'} (${t?.unit})` : 'kein R4-Vorschlag',
    });
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
    record('T05', {
      input: `chronicWk ≈ ${Math.round(acwr(db.logs, NOW).chronicWk)} (reduzierte Basis)\nprojizierte Akut-Last = Logs im 7-d-Fenster am Horizontende + geplante Einheiten`,
      expected: 'R7 · operation=remove · Ziel=Laufen (nicht fix) · proj. Ratio > 1.5',
      actual: s ? `R7 · operation=${s.operation} · Ziel=${DEFAULT_CATALOG.sports[t?.sportId]?.name ?? '?'} · proj. Ratio ≈ ${m ? m[1] : '?'}` : 'kein R7-Vorschlag',
    });
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
    record('T09', {
      input: 'pain = {region: fingers, NRS 7, jetzt}\nKonkurrent: R3 (Fingerlast vor 20 h) auf dasselbe Ziel',
      expected: 'Gewinner am Ziel: R1 · reduce · R1 ist erster Vorschlag der Liste',
      actual: `Gewinner: ${winner ? winner.ruleId + ' · ' + winner.operation : '?'} · erster: ${sugs[0]?.ruleId ?? '?'}`,
    });
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
    const pushEx = db.planned.find((p) => p.unit === 'push')?.exercises ?? [];
    record('T10', {
      input: `fatigue = {shoulder, platt, jetzt}\nPush-Übungen: ${exNames(pushEx, DEFAULT_CATALOG)}`,
      expected: 'R5 · operation=move · Ziel=Kraft (push)',
      actual: s ? `R5 · operation=${s.operation} · Ziel=Kraft (push)` : 'kein R5 auf push',
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
    record('T06', {
      input: `alle Seed-Vorschläge geprüft:\n${sugList(db, sugs)}`,
      expected: '0 Verstöße (move/remove auf fix)',
      actual: `${bad.length} Verstöße${bad.length ? ': ' + bad.map((s) => s.ruleId + ' ' + s.operation).join(', ') : ''}`,
    });
    expect(bad).toEqual([]);
  });

  it('T07 — Verschieben annehmen ⇒ R4 feuert nicht erneut', () => {
    const db = freshDb(NOW);
    let sugs = evaluate(db, NOW);
    const r4 = sugs.find((s) => s.ruleId === 'R4');
    const t = db.planned.find((p) => p.id === r4.targetId);
    const before = new Date(t.date);
    Object.assign(t, r4.proposed); // move +2 d -> ~90 h after descent, outside the window
    sugs = evaluate(db, NOW);
    const refires = sugs.some((s) => s.ruleId === 'R4');
    record('T07', {
      input: `accept: Object.assign(legs, proposed)\nvorher: ${before.toISOString().slice(0, 16)}\nnachher: ${t.date.slice(0, 16)}`,
      expected: 'kein R4-Vorschlag mehr auf diese Einheit',
      actual: refires ? 'R4 feuert erneut' : `kein R4 mehr · verbleibend: ${sugs.map((s) => s.ruleId).join(', ') || '–'}`,
    });
    expect(refires).toBe(false);
  });

  it('T08 — Abgelehnter Vorschlag kommt nie wieder', () => {
    const db = freshDb(NOW);
    let sugs = evaluate(db, NOW);
    const first = sugs[0];
    db.rejected[first.key] = 'fit';
    sugs = evaluate(db, NOW);
    const back = sugs.some((s) => s.key === first.key);
    record('T08', {
      input: `rejected['${first.key}'] = 'fit'`,
      expected: 'Key erscheint in keiner Neubewertung mehr',
      actual: back ? 'Vorschlag erneut da' : `Vorschlag dauerhaft unterdrückt · verbleibend: ${sugs.length}`,
    });
    expect(back).toBe(false);
  });
});

describe('Generator & Constraints', () => {
  it('T11 — Knie rot ⇒ Beineinheit ohne einzige Knie-belastende Übung', () => {
    const db = freshDb(NOW);
    db.profile.constraints = [{ id: 'k', region: 'knee', level: 'red' }];
    const units = generateStrength(db.profile);
    const legs = units.find((u) => u.unit === 'legs');
    const bad = (legs ? legs.exercises : []).filter((id) => EX[id].knee !== null);
    record('T11', {
      input: 'constraints = [{knee, rot}] · Split PPL ohne Pull',
      expected: 'legs-Einheit: 0 Übungen mit knee-Tag',
      actual: `legs = ${exNames(legs?.exercises ?? [], DEFAULT_CATALOG)}\nmit knee-Tag: ${bad.length}`,
    });
    expect(bad).toEqual([]);
  });

  it('T12 — Constraint Schulter rot ⇒ Push ohne Schulter-Loader ≥2', () => {
    const db = freshDb(NOW);
    db.profile.constraints.push({ id: 's', region: 'shoulder', level: 'red' });
    const units = generateStrength(db.profile);
    const push = units.find((u) => u.unit === 'push');
    const bad = push.exercises.filter((id) => (EX[id].load.shoulder || 0) >= 2);
    record('T12', {
      input: 'constraints += [{shoulder, rot}]',
      expected: 'push-Einheit: alle Übungen mit load[shoulder] < 2',
      actual: `push = ${exNames(push.exercises, DEFAULT_CATALOG)}\nVerstöße: ${bad.length}`,
    });
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
    record('T14', {
      input: 'Einheit (full, in 12 h · 42 h nach 1150 hm):\n· Bench Press (chest)\n· Single-Arm Row (upper_back)\n· Back Squat (quads 3) ← betroffen\n· Plank (core)',
      expected: 'operation=swap · Raus: Back Squat · Bench/Row/Plank bleiben · Ersatz lädt keine Beinregion ≥2',
      actual: s ? `operation=${s.operation}\nRaus: ${exNames(s.swap?.drop ?? [], DEFAULT_CATALOG)}\nRein: ${s.swap?.repl?.length ? exNames(s.swap.repl, DEFAULT_CATALOG) : '–'}\nBleibt: ${exNames(s.swap?.keep ?? [], DEFAULT_CATALOG)}` : 'kein R4',
    });
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
    record('T15', {
      input: `legs-Einheit: ${exNames(ex, DEFAULT_CATALOG)}\nalle ${ex.length} laden Beinregionen ≥2 ⇒ drop(${ex.length}) > keep(0)`,
      expected: 'operation=move (kein swap)',
      actual: s ? `operation=${s.operation}` : 'kein R4',
    });
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
    record('T16', {
      input: 'fatigue = {upper_back, müde}\nUpper-Session: Bench · OHP · Bent-Over Row (upper_back 3) · Curl',
      expected: 'operation=swap · Raus: Bent-Over Row · Curl bleibt · Ergebnis lädt upper_back < 2',
      actual: s ? `operation=${s.operation}\nRaus: ${exNames(s.swap?.drop ?? [], DEFAULT_CATALOG)}\nRein: ${s.swap?.repl?.length ? exNames(s.swap.repl, DEFAULT_CATALOG) : '–'}` : 'kein R5-Swap',
    });
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
    record('T17', {
      input: 'Kontext: Bergtag 1150 hm vor 30 h · Knie-Constraint gelb · Quads müde\nÜbung: Back Squat (quads 3, knee deep) vs. Bench Press',
      expected: 'Back Squat @+12 h: stop (Bergtag im Fenster)\nBack Squat @+4 d: Bergtag-Grund weg, Knie-Grund bleibt\nBench @+12 h: fresh',
      actual: `Back Squat @+12 h: ${early.level} [${early.reasons.join(' · ')}]\nBack Squat @+4 d: ${late.level} [${late.reasons.join(' · ')}]\nBench @+12 h: ${bench.level}`,
    });
    expect(early.level).toBe('stop');
    expect(early.reasons.some((r) => /Bergtag/.test(r))).toBe(true);
    expect(late.reasons.some((r) => /Bergtag/.test(r))).toBe(false);
    expect(late.reasons.some((r) => /Knie|Beugetiefe/.test(r))).toBe(true);
    expect(bench.level).toBe('fresh');
  });
});
