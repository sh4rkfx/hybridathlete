// Load model (spec §3.1): validated sRPE-TL + assumption-level regional decomposition.
import { describe, it, expect } from 'vitest';
import { srpeTL, regionLoad } from '../../src/engine/load.js';
import { DEFAULT_CATALOG } from '../../src/engine/catalog.js';

describe('srpeTL', () => {
  it('is sRPE × duration (Foster 2001)', () => {
    expect(srpeTL({ sRPE: 7, duration: 90 })).toBe(630);
    expect(srpeTL({})).toBe(0);
  });
});

describe('regionLoad', () => {
  it('scales the static sport profile by (sRPE/10) × (duration/60)', () => {
    const log = { sportId: 'bouldering', sRPE: 5, duration: 120 };
    const out = regionLoad(log, DEFAULT_CATALOG);
    // scale = 0.5 × 2 = 1 -> profile values pass through
    expect(out.fingers).toBe(3);
    expect(out.systemic).toBe(2);
    expect(out.quads).toBeUndefined();
  });

  it('aggregates strength load from logged exercises, not the static profile', () => {
    const log = {
      sportId: 'strength', sRPE: 10, duration: 60,
      sets: [{ exerciseId: 'back_squat' }, { exerciseId: 'plank' }],
    };
    const out = regionLoad(log, DEFAULT_CATALOG);
    // scale = 1; exercise factor 0.4: back_squat quads 3 -> 1.2; plank core 3 -> 1.2 + squat core 1 -> 0.4
    expect(out.quads).toBeCloseTo(1.2);
    expect(out.core).toBeCloseTo(1.6);
    expect(out.systemic).toBeCloseTo(1); // systemic base for the whole session
  });

  it('returns empty load for unknown sports', () => {
    expect(regionLoad({ sportId: 'nope', sRPE: 5, duration: 60 }, DEFAULT_CATALOG)).toEqual({});
  });
});
