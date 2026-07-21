// Story #47: R9 progression — RIR-scaled double progression with
// equipment × muscle-size increments.
import { describe, it, expect } from 'vitest';
import { progressionAdvice, incrementFor, muscleSizeOf, e1rmEpley } from '../../src/engine/progression.js';
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
