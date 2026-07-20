// Strength generator: split build, generic constraints, readiness-aware
// selection, goal volumes, R8 coverage (stories 13, AC6/AC7/AC14).
import { describe, it, expect } from 'vitest';
import { generateStrength, splitCoverageGaps } from '../../src/engine/generator.js';
import { GOAL_SCHEMES, DEFAULT_CATALOG } from '../../src/engine/catalog.js';
import { exerciseReadiness } from '../../src/engine/readiness.js';
import { freshDb } from '../helpers/fixtures.js';

const cat = DEFAULT_CATALOG;
const baseProfile = { goal: 'sport_support', split: 'PPL', disabledUnits: ['pull'], constraints: [] };

describe('split build', () => {
  it('PPL without pull yields push + legs, each with up to 4 exercises of matching categories', () => {
    const units = generateStrength(baseProfile);
    expect(units.map((u) => u.unit)).toEqual(['push', 'legs']);
    for (const u of units) {
      expect(u.exercises.length).toBeGreaterThanOrEqual(3);
      expect(u.exercises.length).toBeLessThanOrEqual(4);
    }
    const legCats = ['legs', 'core'];
    for (const id of units[1].exercises) expect(legCats).toContain(cat.exById[id].cat);
  });

  it('full-body split yields one unit mixing categories', () => {
    const units = generateStrength({ ...baseProfile, split: 'full_body', disabledUnits: [] });
    expect(units).toHaveLength(1);
    expect(units[0].unit).toBe('full');
  });
});

describe('generic constraints (spec §5.4)', () => {
  it('knee yellow excludes deep-flexion exercises from legs (AC6)', () => {
    const units = generateStrength({ ...baseProfile, constraints: [{ id: 'k', region: 'knee', level: 'yellow' }] });
    const legs = units.find((u) => u.unit === 'legs');
    for (const id of legs.exercises) expect(cat.exById[id].knee).not.toBe('deep');
  });

  it('knee red excludes every knee-tagged exercise', () => {
    const units = generateStrength({ ...baseProfile, constraints: [{ id: 'k', region: 'knee', level: 'red' }] });
    const legs = units.find((u) => u.unit === 'legs');
    expect(legs.exercises.length).toBeGreaterThan(0);
    for (const id of legs.exercises) expect(cat.exById[id].knee).toBeNull();
  });

  it('generic region red locks load >= 2, yellow only >= 3', () => {
    const red = generateStrength({ ...baseProfile, constraints: [{ id: 's', region: 'shoulder', level: 'red' }] });
    for (const id of red.find((u) => u.unit === 'push').exercises) {
      expect((cat.exById[id].load.shoulder || 0)).toBeLessThan(2);
    }
    const yellow = generateStrength({ ...baseProfile, constraints: [{ id: 's', region: 'shoulder', level: 'yellow' }] });
    for (const id of yellow.find((u) => u.unit === 'push').exercises) {
      expect((cat.exById[id].load.shoulder || 0)).toBeLessThan(3);
    }
  });
});

describe('readiness-aware selection (spec §5.5, AC14)', () => {
  it('excludes stop-rated exercises for a target date inside the mountain window', () => {
    const now = new Date('2026-07-20T12:00:00');
    const db = freshDb(now);
    const when = new Date(now.getTime() + 12 * 36e5);
    const units = generateStrength(db.profile, db, when, now);
    for (const u of units) {
      for (const id of u.exercises) {
        expect(exerciseReadiness(id, when, db, now).level, id).not.toBe('stop');
      }
    }
  });

  it('is deterministic without state/when (backward-compatible signature)', () => {
    expect(generateStrength(baseProfile)).toEqual(generateStrength(baseProfile));
  });
});

describe('goal volume schemes (spec §5.3)', () => {
  it.each([
    ['kraftaufbau', 5, '3–5'],
    ['hypertrophie', 4, '8–12'],
    ['erhalt', 2, '6–10'],
    ['sport_support', 3, '5–8'],
  ])('%s -> %i sets × %s reps', (goal, sets, reps) => {
    expect(GOAL_SCHEMES[goal].sets).toBe(sets);
    expect(GOAL_SCHEMES[goal].reps).toBe(reps);
  });
});

describe('R8 split coverage (AC7)', () => {
  it('flags rear shoulder / horizontal pull when pull is disabled, with actionable fixes', () => {
    const gaps = splitCoverageGaps(baseProfile);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].label).toMatch(/Hintere Schulter/);
    for (const id of gaps[0].fixIds) expect(cat.exById[id], id).toBeTruthy();
    expect(gaps[0].fixIds).toEqual(expect.arrayContaining(['rear_delt_fly_db']));
  });

  it('reports no gap when nothing is disabled', () => {
    expect(splitCoverageGaps({ ...baseProfile, disabledUnits: [] })).toEqual([]);
  });
});
