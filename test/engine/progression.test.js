// Story #47: R9 progression — RIR-scaled double progression with
// equipment × muscle-size increments.
import { describe, it, expect } from 'vitest';
import { progressionAdvice, incrementFor, muscleSizeOf, e1rmEpley, lastSetsFor, prefillSets } from '../../src/engine/progression.js';
import { DEFAULT_CATALOG, normalizeExercise } from '../../src/engine/catalog.js';
import { ruleParams } from '../../src/rules/params.js';

const S = (w, ...reps) => reps.map((r) => ({ w, reps: r }));
const advise = (exerciseId, sets, rir, goal = 'sport_support') => progressionAdvice({ exerciseId, sets, rir, goal });

describe('increment matrix (equipment × muscle size)', () => {
  it.each([
    ['barbell_bench_press', 'barbell', 'large', 2.5],   // chest
    ['overhead_barbell_press', 'barbell', 'small', 1.25], // shoulder
    ['dumbbell_bench_press', 'dumbbell', 'large', 2.0],
    ['dumbbell_lateral_raise', 'dumbbell', 'small', 1.0],
    ['band_pull_apart', 'band', 'small', 0],
    ['plank', 'bodyweight', 'small', 0],
  ])('%s -> %s/%s: %f kg', (id, equipment, size, step) => {
    const r = incrementFor(DEFAULT_CATALOG.exById[id]);
    expect(r.equipment).toBe(equipment);
    expect(r.size).toBe(size);
    expect(r.step).toBe(step);
  });

  it('machine steps are prepared for the V2 catalog (5.0 / 2.5)', () => {
    const latPull = normalizeExercise({ id: 'lat_pulldown', name: 'Lat Pulldown', cat: 'pull', load: { upper_back: 3 }, equipment: ['machine'] });
    expect(incrementFor(latPull)).toMatchObject({ equipment: 'machine', size: 'large', step: 5 });
    const triPress = normalizeExercise({ id: 'tri_press', name: 'Triceps Pressdown', cat: 'push', load: { triceps: 3 }, equipment: ['machine'] });
    expect(incrementFor(triPress).step).toBe(2.5);
  });

  it('muscle size derives from the primary (highest-load) region', () => {
    expect(muscleSizeOf(DEFAULT_CATALOG.exById.back_squat)).toBe('large'); // quads
    expect(muscleSizeOf(DEFAULT_CATALOG.exById.standing_calf_raise)).toBe('small'); // calves
  });
});

describe('RIR scaling on a full corridor (sport_support 5–8)', () => {
  it('RIR 2 -> +1 step, RIR 3+ -> +2 steps (the requested scaling)', () => {
    const two = advise('barbell_bench_press', S(62.5, 8, 8, 8), 2);
    expect(two).toMatchObject({ action: 'increase', deltaKg: 2.5, nextWeight: 65 });
    const three = advise('barbell_bench_press', S(62.5, 8, 8, 8), 3);
    expect(three).toMatchObject({ action: 'increase', deltaKg: 5, nextWeight: 67.5 });
  });

  it('small-muscle barbell lift scales with 1.25 kg steps', () => {
    const r = advise('overhead_barbell_press', S(42.5, 8, 8, 8), 3);
    expect(r.deltaKg).toBe(2.5); // 2 × 1.25
    expect(r.nextWeight).toBe(45);
  });

  it('RIR <= 1 holds even with a full corridor (grind guard)', () => {
    expect(advise('barbell_bench_press', S(62.5, 8, 8, 8), 1).action).toBe('hold');
    expect(advise('barbell_bench_press', S(62.5, 8, 8, 8), 0).action).toBe('hold');
  });
});

describe('double progression over ALL sets', () => {
  it('8/7/6 builds reps — the best set alone never progresses the load', () => {
    const r = advise('barbell_bench_press', S(62.5, 8, 7, 6), 2);
    expect(r.action).toBe('build_reps');
    expect(r.why).toMatch(/Schwächster Satz bei 6/);
    expect(r.nextWeight).toBe(62.5);
  });

  it('RIR 3+ with every set inside the corridor pulls the increase forward', () => {
    const r = advise('barbell_bench_press', S(62.5, 7, 6, 6), 3);
    expect(r).toMatchObject({ action: 'increase', deltaKg: 2.5 });
    expect(r.why).toMatch(/zu leicht/);
  });

  it('RIR 3+ below the corridor bottom does NOT increase', () => {
    expect(advise('barbell_bench_press', S(62.5, 6, 4, 4), 3).action).toBe('build_reps');
  });
});

describe('edges', () => {
  it('band/bodyweight progress via reps or variant, never via kg', () => {
    expect(advise('band_pull_apart', S(0, 8, 8, 8), 3).action).toBe('add_reps_or_variant');
    expect(advise('plank', S(0, 6, 5), 2).action).toBe('build_reps');
  });

  it('rounds to the equipment step and reports Epley e1RM of the best set', () => {
    const r = advise('dumbbell_bench_press', [{ w: 26, reps: 8 }, { w: 26, reps: 8 }, { w: 26, reps: 8 }], 2);
    expect(r.nextWeight % 2).toBe(0); // dumbbell rack step 2.0
    expect(r.e1rm).toBeCloseTo(Math.round(e1rmEpley(26, 8) * 10) / 10);
  });

  it('unknown exercise or empty sets -> null; corridor follows the goal', () => {
    expect(advise('nope', S(60, 8), 2)).toBeNull();
    expect(progressionAdvice({ exerciseId: 'barbell_bench_press', sets: [], rir: 2, goal: 'sport_support' })).toBeNull();
    const kb = progressionAdvice({ exerciseId: 'barbell_bench_press', sets: S(80, 5, 5, 5, 5, 5), rir: 2, goal: 'kraftaufbau' });
    expect(kb.action).toBe('increase'); // kraftaufbau corridor tops at 5
  });

  it('R9 carries source + evidenceLevel (source mandate)', () => {
    expect(ruleParams('R9').increments.barbell.large).toBe(2.5);
  });
});

describe('prefill loop (story #50): log -> advice -> next prefill', () => {
  const rows = (logId, exerciseId, date, sets, rir) => sets.map(([weight, reps], setIndex) => ({
    setId: `${logId}-${exerciseId}-${setIndex}`, logId, exerciseId, setIndex, weight, reps, date,
    ...(setIndex === sets.length - 1 ? { rir } : {}),
  }));

  it('lastSetsFor picks the newest log and keeps set order + last-set RIR', () => {
    const state = { setLogs: [
      ...rows('l1', 'barbell_bench_press', '2026-07-10T17:00:00Z', [[60, 8], [60, 7]], 1),
      ...rows('l2', 'barbell_bench_press', '2026-07-17T17:00:00Z', [[62.5, 8], [62.5, 7], [62.5, 6]], 2),
    ] };
    const last = lastSetsFor('barbell_bench_press', state);
    expect(last.sets).toEqual([{ w: 62.5, reps: 8 }, { w: 62.5, reps: 7 }, { w: 62.5, reps: 6 }]);
    expect(last.rir).toBe(2);
    expect(lastSetsFor('plank', state)).toBeNull();
  });

  it('fresh: no history -> goal set count × corridor bottom at 0 kg', () => {
    const p = prefillSets('barbell_bench_press', { setLogs: [] }, 'sport_support');
    expect(p.source).toBe('fresh');
    expect(p.sets).toEqual([{ w: 0, reps: 5 }, { w: 0, reps: 5 }, { w: 0, reps: 5 }]);
  });

  it('last: history without progression is prefilled verbatim', () => {
    const state = { setLogs: rows('l1', 'barbell_bench_press', '2026-07-17T17:00:00Z', [[62.5, 8], [62.5, 7], [62.5, 6]], 2) };
    const p = prefillSets('barbell_bench_press', state, 'sport_support');
    expect(p.source).toBe('last');
    expect(p.sets[2]).toEqual({ w: 62.5, reps: 6 });
  });

  it('advice: full corridor @ RIR 2 -> next prefill at nextWeight, reps reset to corridor bottom', () => {
    const state = { setLogs: rows('l1', 'barbell_bench_press', '2026-07-17T17:00:00Z', [[62.5, 8], [62.5, 8], [62.5, 8]], 2) };
    const p = prefillSets('barbell_bench_press', state, 'sport_support');
    expect(p.source).toBe('advice');
    expect(p.deltaKg).toBe(2.5);
    expect(p.sets).toEqual([{ w: 65, reps: 5 }, { w: 65, reps: 5 }, { w: 65, reps: 5 }]);
  });
});
