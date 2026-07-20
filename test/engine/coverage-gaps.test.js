// Story #41: close the remaining engine coverage gaps — real paths, no
// assertion-weakening. Target: 100 % lines/statements/functions in src/engine.
import { describe, it, expect } from 'vitest';
import { mondayOf, WD } from '../../src/engine/time.js';
import { catalogOf, buildCatalog, DEFAULT_CATALOG } from '../../src/engine/catalog.js';
import { proposeChange, estPlannedTL } from '../../src/engine/planner.js';
import { acwr } from '../../src/engine/acwr.js';
import { regionLoad } from '../../src/engine/load.js';
import { generateStrength } from '../../src/engine/generator.js';
import { recommendPlan } from '../../src/engine/advisor.js';
import { exerciseReadiness } from '../../src/engine/readiness.js';
import { swapProposal, passesConstraints, exNames } from '../../src/engine/swap.js';
import { sessionLoadsRegion, isHeavyLowerBody, latestFatigue } from '../../src/engine/planner.js';
import { normalizeSport, normalizeExercise } from '../../src/engine/catalog.js';
import sportsSeed from '../../src/seed/sports.seed.json' with { type: 'json' };
import exercisesSeed from '../../src/seed/exercises.seed.json' with { type: 'json' };

describe('time.mondayOf', () => {
  it('returns the Monday of the week for every weekday', () => {
    // 2026-07-20 is a Monday
    expect(mondayOf(new Date('2026-07-20T15:00:00')).getDay()).toBe(1);
    expect(mondayOf(new Date('2026-07-23T09:00:00')).toDateString()).toBe(new Date('2026-07-20T00:00:00').toDateString());
    expect(mondayOf(new Date('2026-07-26T23:00:00')).toDateString()).toBe(new Date('2026-07-20T00:00:00').toDateString()); // Sunday belongs to the past week
    expect(WD[mondayOf(new Date('2026-07-22')).getDay()]).toBe('Mo');
  });
});

describe('catalog.catalogOf', () => {
  it('builds the catalog from store-shaped state (loadEngineState output)', () => {
    const state = { sports: sportsSeed.sports, exercises: exercisesSeed.exercises };
    const cat = catalogOf(state);
    expect(cat.sports.bouldering.flags.tendonHeavy).toBe(true);
    expect(cat.exById.back_squat.knee).toBe('deep');
  });

  it('a prebuilt state.catalog wins; empty state falls back to the seed catalog', () => {
    const own = buildCatalog(sportsSeed.sports.slice(0, 1), exercisesSeed.exercises.slice(0, 1));
    expect(catalogOf({ catalog: own })).toBe(own);
    expect(catalogOf(undefined)).toBe(DEFAULT_CATALOG);
    expect(catalogOf({ sports: [], exercises: [] })).toBe(DEFAULT_CATALOG);
  });

  it('normalizes prototype-shaped entries (id/cat/load passthrough, knee default)', () => {
    const cat = buildCatalog(
      [{ id: 'x', name: 'X', loadSource: 'profile', loadProfile: { core: 2 }, flags: { eccentric: true } }],
      [{ id: 'e1', name: 'E1', cat: 'core', load: { core: 3 } }],
    );
    expect(cat.sports.x.flags.eccentric).toBe(true);
    expect(cat.exById.e1.knee).toBeNull();
    expect(cat.exById.e1.cat).toBe('core');
  });
});

describe('planner defaults', () => {
  it('proposeChange returns an empty patch for operations without a generic change (swap)', () => {
    expect(proposeChange('swap', { id: 'x', date: '2026-07-21T12:00:00Z', slot: 'midday' })).toEqual({});
  });

  it('proposeChange(move) keeps the hour for sessions with an unknown slot', () => {
    const p = proposeChange('move', { id: 'x', date: '2026-07-21T09:30:00', slot: 'weird' });
    expect(new Date(p.date).getHours()).toBe(9);
  });

  it('estPlannedTL halves reduced sessions', () => {
    const full = estPlannedTL({ sportId: 'running', reduced: false });
    expect(estPlannedTL({ sportId: 'running', reduced: true })).toBe(full / 2);
  });
});

describe('parameter defaults across the engine', () => {
  it('acwr defaults refDate to now', () => {
    const log = { sportId: 'running', date: new Date().toISOString(), duration: 30, sRPE: 5 };
    expect(acwr([log]).acute).toBe(150);
  });

  it('regionLoad handles strength logs without sets and unknown exercise ids', () => {
    const cat = DEFAULT_CATALOG;
    const noSets = regionLoad({ sportId: 'strength', sRPE: 10, duration: 60 }, cat);
    expect(noSets.systemic).toBeCloseTo(1);
    const unknown = regionLoad({ sportId: 'strength', sRPE: 10, duration: 60, sets: [{ exerciseId: 'nope' }] }, cat);
    expect(unknown.systemic).toBeCloseTo(1);
  });

  it('generateStrength falls back to PPL for unknown splits and tolerates missing disabledUnits', () => {
    const units = generateStrength({ goal: 'sport_support', split: '???', constraints: [] });
    expect(units.map((u) => u.unit)).toEqual(['push', 'pull', 'legs']);
  });

  it('swapProposal tolerates units outside UNIT_CATS (custom unit fallback)', () => {
    const pl = { unit: 'custom', exercises: ['barbell_bench_press', 'back_squat'] };
    const sw = swapProposal(pl, ['quads'], { constraints: [] }, DEFAULT_CATALOG);
    expect(sw.drop).toEqual(['back_squat']);
    // same-category search still applies regardless of the unknown unit
    expect(sw.repl).toEqual(['romanian_deadlift']);
    expect((DEFAULT_CATALOG.exById.romanian_deadlift.load.quads ?? 0)).toBeLessThan(2);
  });

  it('readiness ignores future eccentric logs and sub-threshold pain', () => {
    const now = new Date('2026-07-20T12:00:00');
    const state = {
      profile: { constraints: [] },
      logs: [{ id: 'l', sportId: 'mountain_day', date: new Date(now.getTime() + 24 * 36e5).toISOString(), duration: 300, sRPE: 7 }],
      fatigue: [], pain: [{ id: 'p', region: 'quads', nrs: 2, ts: now.toISOString() }], planned: [],
    };
    expect(exerciseReadiness('back_squat', now, state, now).level).toBe('fresh');
  });

  it('passesConstraints enforces the red paths (knee lockout, generic >=2)', () => {
    const squat = DEFAULT_CATALOG.exById.back_squat;
    const plank = DEFAULT_CATALOG.exById.plank;
    expect(passesConstraints(squat, { constraints: [{ region: 'knee', level: 'red' }] })).toBe(false);
    expect(passesConstraints(plank, { constraints: [{ region: 'knee', level: 'red' }] })).toBe(true);
    expect(passesConstraints(squat, { constraints: [{ region: 'quads', level: 'red' }] })).toBe(false);
    expect(passesConstraints(squat, { constraints: [{ region: 'quads', level: 'yellow' }] })).toBe(false); // quads 3 >= 3
  });

  it('swap/planner helpers tolerate strength sessions without an exercises field', () => {
    const bare = { id: 's', sportId: 'strength', unit: 'legs' };
    expect(swapProposal(bare, ['quads'], { constraints: [] }, DEFAULT_CATALOG)).toBeNull();
    expect(sessionLoadsRegion(bare, 'quads', DEFAULT_CATALOG)).toBe(false);
    expect(isHeavyLowerBody(bare, DEFAULT_CATALOG)).toBe(false);
    expect(exNames(['back_squat', 'nope'], DEFAULT_CATALOG)).toBe('Back Squat, nope');
  });

  it('latestFatigue returns null without matching entries', () => {
    expect(latestFatigue({ fatigue: [] }, 'quads', new Date())).toBeNull();
  });

  it('normalize* fills every default for minimal store entries', () => {
    const s = normalizeSport({ sportId: 'min', name: 'Min' });
    expect(s.loadSource).toBe('profile');
    expect(s.flags).toEqual({ eccentric: false, tendonHeavy: false });
    expect(s.loadProfile).toEqual({});
    const e = normalizeExercise({ exerciseId: 'ex', name: 'Ex', category: 'core', loadProfile: { core: 1 }, kneeFlexionTag: 'mid' });
    expect(e.knee).toBe('mid');
    const e2 = normalizeExercise({ id: 'ex2', name: 'Ex2', cat: 'legs', load: {}, knee: null });
    expect(e2.knee).toBeNull();
  });

  it('recommendPlan resolves sport names from a provided state catalog', () => {
    const state = { sports: sportsSeed.sports, exercises: exercisesSeed.exercises };
    const rec = recommendPlan({ goal: 'sport_support', trainingDays: 3, activeSports: ['bouldering', 'running'] }, state);
    expect(rec.rationale.some((r) => r.text.includes('Bouldern'))).toBe(true);
    expect(rec.rationale.some((r) => r.text.includes('Laufen'))).toBe(true);
  });
});
