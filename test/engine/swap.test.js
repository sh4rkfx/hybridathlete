// swapProposal: hit logic, replacement search, hollow-out guard, constraint conformity.
import { describe, it, expect } from 'vitest';
import { swapProposal, passesConstraints } from '../../src/engine/swap.js';
import { DEFAULT_CATALOG } from '../../src/engine/catalog.js';

const cat = DEFAULT_CATALOG;
const profile = { constraints: [{ id: 'k', region: 'knee', level: 'yellow' }] };

describe('swapProposal', () => {
  it('drops only exercises loading a trigger region >= 2 and finds a clean replacement', () => {
    const pl = { unit: 'full', exercises: ['barbell_bench_press', 'single_arm_dumbbell_row', 'back_squat', 'plank'] };
    const sw = swapProposal(pl, ['quads', 'posterior_chain', 'calves'], profile, cat);
    expect(sw.drop).toEqual(['back_squat']);
    expect(sw.keep).toHaveLength(3);
    expect(sw.proposed).toHaveLength(4);
    for (const id of sw.proposed) {
      const e = cat.exById[id];
      expect(Math.max(e.load.quads || 0, e.load.posterior_chain || 0, e.load.calves || 0)).toBeLessThan(2);
    }
  });

  it('hollow-out guard: returns null when drop > keep (pure leg session)', () => {
    const pl = { unit: 'legs', exercises: ['box_squat', 'goblet_squat', 'romanian_deadlift', 'standing_calf_raise'] };
    expect(swapProposal(pl, ['quads', 'posterior_chain', 'calves'], profile, cat)).toBeNull();
  });

  it('returns null when nothing is affected or fewer than 2 exercises', () => {
    expect(swapProposal({ unit: 'push', exercises: ['barbell_bench_press', 'close_grip_bench_press'] }, ['quads'], profile, cat)).toBeNull();
    expect(swapProposal({ unit: 'legs', exercises: ['back_squat'] }, ['quads'], profile, cat)).toBeNull();
  });

  it('replacements respect active constraints (no deep knee flexion under yellow)', () => {
    const pl = { unit: 'upper', exercises: ['barbell_bench_press', 'overhead_barbell_press', 'barbell_bent_over_row', 'barbell_curl'] };
    const sw = swapProposal(pl, ['upper_back'], profile, cat);
    expect(sw.drop).toEqual(['barbell_bent_over_row']);
    for (const id of sw.repl) {
      expect(passesConstraints(cat.exById[id], profile)).toBe(true);
      expect((cat.exById[id].load.upper_back || 0)).toBeLessThan(2);
    }
  });

  it('session simply gets shorter when no replacement candidate exists', () => {
    // Every push-category exercise loads chest, triceps or shoulder >= 2, so
    // with all three as trigger regions no push replacement can qualify.
    const pl = { unit: 'push', exercises: ['barbell_bench_press', 'plank'] };
    const sw = swapProposal(pl, ['chest', 'triceps', 'shoulder'], profile, cat);
    expect(sw.drop).toEqual(['barbell_bench_press']);
    expect(sw.repl).toEqual([]);
    expect(sw.proposed).toEqual(['plank']);
  });
});
