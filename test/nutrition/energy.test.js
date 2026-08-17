// BMR formulas, Atwater derivation, TEF (kickoff step 2, test 4 "Zufuhr-
// Ableitung" and test 7 "Einheiten"). Reference values come from the kickoff's
// seed profile: 38 y / 173 cm / 89.5 kg / 27.9 % body fat -> FFM 64.5 kg.
import { describe, it, expect } from 'vitest';
import {
  ageYears, ffmKg, fatMassKg, bodyFatPct, median,
  bmr, bmrMifflin, bmrOwen, bmrKatch, bmrHarris, bmrCunningham,
  hasCompleteMacros, macroKcalBreakdown, derivedIntakeKcal, reconcileIntake,
  tefKcal, TEF_COEFFICIENTS, tdeeComposition, formulaTdeeKcal,
} from '../../src/nutrition/energy.js';
import { validate, massToKg, heightToCm } from '../../src/nutrition/config.js';

const NOW = new Date('2026-08-17T00:00:00Z');
const SEED = { birthDate: '1988-06-16', sex: 'male', heightCm: 173, bodyComp: { mode: 'bodyFatPct', value: 27.9 } };
const cfg = (over = {}) => validate({ profile: SEED, ...over }).normalized;

describe('profile derivation', () => {
  it('age is measured against the injected clock, not wall time', () => {
    expect(ageYears('1988-06-16', NOW)).toBeCloseTo(38.17, 2);
    expect(ageYears(null, NOW)).toBeNull();
    expect(ageYears('1988-06-16', null)).toBeNull();
  });

  it('derives FFM and fat mass from a body-fat percentage', () => {
    expect(ffmKg(SEED, 89.5)).toBeCloseTo(64.53, 2);
    expect(fatMassKg(SEED, 89.5)).toBeCloseTo(24.97, 2);
    expect(bodyFatPct(SEED, 89.5)).toBe(27.9);
  });

  it('takes FFM directly when that is the mode, and derives the percentage back', () => {
    const p = { ...SEED, bodyComp: { mode: 'ffm', value: 64.5 } };
    expect(ffmKg(p, 89.5)).toBe(64.5);
    expect(fatMassKg(p, 89.5)).toBeCloseTo(25.0, 6);
    expect(bodyFatPct(p, 89.5)).toBeCloseTo(27.93, 2);
  });

  it("mode 'none' yields null rather than a guess", () => {
    const p = { ...SEED, bodyComp: { mode: 'none', value: null } };
    expect(ffmKg(p, 89.5)).toBeNull();
    expect(fatMassKg(p, 89.5)).toBeNull();
    expect(bodyFatPct(p, 89.5)).toBeNull();
  });

  it('needs a weight to turn a percentage into a mass', () => {
    expect(ffmKg(SEED, null)).toBeNull();
    expect(fatMassKg(SEED, undefined)).toBeNull();
  });
});

describe('BMR formulas against the seed profile', () => {
  it.each([
    ['mifflin', 1790],
    ['owen', 1792],
    ['katch', 1764],
    ['harris', 1905],
    ['cunningham', 1920],
  ])('%s -> %i kcal', (formula, expected) => {
    expect(Math.round(bmr(cfg({ energy: { bmrFormula: formula } }), 89.5, NOW).kcal)).toBe(expected);
  });

  it('the median of Mifflin, Owen and Katch is the documented 1790 kcal', () => {
    const result = bmr(cfg(), 89.5, NOW);
    expect(Math.round(result.kcal)).toBe(1790);
    expect(result.usedFormulas).toEqual(['mifflin', 'owen', 'katch']);
  });

  it('Harris and Cunningham sit well above the median — which is why they warn', () => {
    const { parts, kcal } = bmr(cfg(), 89.5, NOW);
    expect(parts.harris).toBeGreaterThan(kcal + 100);
    expect(parts.cunningham).toBeGreaterThan(kcal + 100);
  });

  it('the median degrades to Mifflin + Owen without body composition', () => {
    const noComp = validate({ profile: { ...SEED, bodyComp: { mode: 'none', value: null } } }).normalized;
    const result = bmr(noComp, 89.5, NOW);
    expect(result.usedFormulas).toEqual(['mifflin', 'owen']);
    expect(result.kcal).toBeCloseTo((bmrMifflin(SEED, 89.5, NOW) + bmrOwen(SEED, 89.5)) / 2, 6);
  });

  it('returns null rather than a number when the profile is short', () => {
    const bare = validate({}).normalized;
    expect(bmrMifflin(bare.profile, 89.5, NOW)).toBeNull();
    expect(bmrKatch(null)).toBeNull();
    expect(bmrCunningham(undefined)).toBeNull();
    expect(bmrHarris(bare.profile, 89.5, NOW)).toBeNull();
    expect(bmr(bare, null, NOW).kcal).toBeNull();
  });

  it("'custom' short-circuits to the configured value", () => {
    const c = cfg({ energy: { bmrFormula: 'custom', customBmrKcal: 1650 } });
    expect(bmr(c, 89.5, NOW)).toMatchObject({ kcal: 1650, formula: 'custom' });
    expect(bmr(cfg({ energy: { bmrFormula: 'custom' } }), 89.5, NOW).kcal).toBeNull();
  });

  it("'unspecified' sex takes the midpoint of the two variants", () => {
    const male = { ...SEED, sex: 'male' };
    const female = { ...SEED, sex: 'female' };
    const either = { ...SEED, sex: 'unspecified' };
    expect(bmrMifflin(either, 89.5, NOW))
      .toBeCloseTo((bmrMifflin(male, 89.5, NOW) + bmrMifflin(female, 89.5, NOW)) / 2, 6);
    expect(bmrOwen(either, 89.5)).toBeCloseTo((bmrOwen(male, 89.5) + bmrOwen(female, 89.5)) / 2, 6);
    // Katch is FFM-based and carries no sex term at all.
    expect(bmrKatch(64.5)).toBe(bmrKatch(64.5));
  });

  it('median() handles even counts and empty input', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([null, NaN, undefined])).toBeNull();
  });
});

describe('units are display-only (test 7)', () => {
  it('lb/in gives the same BMR as kg/cm up to rounding', () => {
    const lb = 197.31; // 89.5 kg
    const inches = 68.11; // 173 cm
    const imperial = validate({
      units: { mass: 'lb', height: 'in', energy: 'kcal' },
      profile: { ...SEED, heightCm: heightToCm(inches, 'in') },
    }).normalized;
    const metric = bmr(cfg(), 89.5, NOW).kcal;
    expect(bmr(imperial, massToKg(lb, 'lb'), NOW).kcal).toBeCloseTo(metric, 0);
  });
});

describe('intake derivation (test 4)', () => {
  const base = { date: '2026-08-17', proteinG: 180, fatG: 70, carbsG: 200 };

  it('derives kcal from complete macros', () => {
    // 180*4 + 70*9 + 200*4 = 720 + 630 + 800
    expect(derivedIntakeKcal(base, cfg())).toBe(2150);
  });

  it('returns null when macros are incomplete', () => {
    expect(hasCompleteMacros({ proteinG: 180, fatG: 70 })).toBe(false);
    expect(derivedIntakeKcal({ proteinG: 180, fatG: 70 }, cfg())).toBeNull();
    expect(derivedIntakeKcal(null, cfg())).toBeNull();
  });

  it('fibre at 2 vs 4 kcal/g is 70 kcal at 35 g/day', () => {
    const entry = { ...base, carbsG: 200, fiberG: 35 };
    const eu = derivedIntakeKcal(entry, cfg({ intake: { atwater: { fiber: 2 } } }));
    const us = derivedIntakeKcal(entry, cfg({ intake: { atwater: { fiber: 4 } } }));
    expect(us - eu).toBe(70);
    // EU: 720 + 630 + (200-35)*4 + 35*2 = 720 + 630 + 660 + 70
    expect(eu).toBe(2080);
  });

  it('fiberInCarbs decides whether fibre is subtracted out first', () => {
    const entry = { ...base, fiberG: 35 };
    const inside = derivedIntakeKcal(entry, cfg({ intake: { fiberInCarbs: true } }));
    const outside = derivedIntakeKcal(entry, cfg({ intake: { fiberInCarbs: false } }));
    expect(inside).toBe(2080);
    expect(outside).toBe(2220); // 720 + 630 + 200*4 + 35*2
    expect(outside - inside).toBe(35 * 4);
  });

  it('a missing fibre line counts all carbohydrate at the carb factor', () => {
    expect(derivedIntakeKcal(base, cfg())).toBe(derivedIntakeKcal({ ...base, fiberG: 0 }, cfg()));
  });

  it('counts alcohol at 7 kcal/g', () => {
    expect(derivedIntakeKcal({ ...base, alcoholG: 20 }, cfg()) - 2150).toBe(140);
  });

  it('breaks the energy down per macro', () => {
    const parts = macroKcalBreakdown({ ...base, fiberG: 35, alcoholG: 20 }, cfg());
    expect(parts).toMatchObject({ protein: 720, fat: 630, carbs: 660, fiber: 70, alcohol: 140 });
    expect(parts.total).toBe(2220);
  });

  it('never lets fibre exceeding carbs produce negative carb energy', () => {
    const parts = macroKcalBreakdown({ ...base, carbsG: 10, fiberG: 35 }, cfg());
    expect(parts.carbs).toBe(0);
  });
});

describe('intake reconciliation (test 4)', () => {
  const complete = { proteinG: 180, fatG: 70, carbsG: 200 }; // 2150 derived

  it('prefers the derived value when macros are complete', () => {
    const r = reconcileIntake({ ...complete, kcal: 2160 }, cfg());
    expect(r).toMatchObject({ kcal: 2150, source: 'derived', enteredKcal: 2160, derivedKcal: 2150 });
    expect(r.mismatch).toBe(false);
  });

  it('falls back to the entered kcal when macros are incomplete', () => {
    const r = reconcileIntake({ proteinG: 180, kcal: 2160 }, cfg());
    expect(r).toMatchObject({ kcal: 2160, source: 'entered', derivedKcal: null });
  });

  it('keeps both values and flags a mismatch beyond the tolerance', () => {
    const r = reconcileIntake({ ...complete, kcal: 1800 }, cfg());
    expect(r.mismatch).toBe(true);
    expect(r.mismatchPct).toBeCloseTo(19.44, 2);
    expect(r.enteredKcal).toBe(1800);
    expect(r.derivedKcal).toBe(2150);
  });

  it('respects a widened tolerance', () => {
    const wide = cfg({ intake: { reconciliation: { mismatchTolerancePct: 25 } } });
    expect(reconcileIntake({ ...complete, kcal: 1800 }, wide).mismatch).toBe(false);
  });

  it('honours preferDerivedWhenComplete: false', () => {
    const c = cfg({ intake: { reconciliation: { preferDerivedWhenComplete: false } } });
    expect(reconcileIntake({ ...complete, kcal: 1800 }, c)).toMatchObject({ kcal: 1800, source: 'entered' });
    // still derived when there is no entered value to prefer
    expect(reconcileIntake(complete, c)).toMatchObject({ kcal: 2150, source: 'derived' });
  });

  it.each([
    ['kcal', { ...complete, kcal: 1800 }, 1800, 'entered'],
    ['macros', { ...complete, kcal: 1800 }, 2150, 'derived'],
  ])('entryMode %s forces the source', (entryMode, entry, kcal, source) => {
    expect(reconcileIntake(entry, cfg({ intake: { entryMode } }))).toMatchObject({ kcal, source });
  });

  it('entryMode kcal without a kcal value yields nothing rather than deriving anyway', () => {
    expect(reconcileIntake(complete, cfg({ intake: { entryMode: 'kcal' } })))
      .toMatchObject({ kcal: null, source: 'none' });
  });

  it('an empty entry produces no intake and no mismatch', () => {
    expect(reconcileIntake({}, cfg())).toMatchObject({ kcal: null, source: 'none', mismatchPct: null, mismatch: false });
  });

  it('a zero entered value does not divide by zero', () => {
    expect(reconcileIntake({ ...complete, kcal: 0 }, cfg()).mismatchPct).toBeNull();
  });
});

describe('TEF', () => {
  const complete = { proteinG: 180, fatG: 70, carbsG: 200 };

  it('computes from macros rather than estimating', () => {
    // 720*0.25 + 800*0.08 + 630*0.02 = 180 + 64 + 12.6
    const r = tefKcal(complete, cfg());
    expect(r.source).toBe('macros');
    expect(r.kcal).toBeCloseTo(256.6, 6);
  });

  it('treats fibre energy at the carbohydrate coefficient', () => {
    expect(TEF_COEFFICIENTS.fiber).toBe(TEF_COEFFICIENTS.carbs);
  });

  it('counts alcohol at 0 % — a documented gap, not an estimate', () => {
    expect(TEF_COEFFICIENTS.alcohol).toBe(0);
    expect(tefKcal({ ...complete, alcoholG: 50 }, cfg()).kcal)
      .toBeCloseTo(tefKcal(complete, cfg()).kcal, 6);
  });

  it('falls back to 10 % of intake without macros', () => {
    const r = tefKcal({ kcal: 2400 }, cfg());
    expect(r).toMatchObject({ source: 'fallback' });
    expect(r.kcal).toBeCloseTo(240, 6);
  });

  it('is suppressed when the source already includes it', () => {
    expect(tefKcal(complete, cfg(), { includesTef: true })).toEqual({ kcal: 0, source: 'suppressed' });
  });

  it('is zero when there is no intake at all', () => {
    expect(tefKcal({}, cfg())).toEqual({ kcal: 0, source: 'none' });
  });
});

describe('TDEE composition', () => {
  it('sums the components', () => {
    expect(tdeeComposition({ bmrKcal: 1790, activityKcal: 550, tefKcal: 260 }))
      .toEqual({ bmrKcal: 1790, activityKcal: 550, tefKcal: 260, totalKcal: 2600 });
  });

  it('drops TEF instead of double-counting it — the ~240 kcal trap', () => {
    const naive = tdeeComposition({ bmrKcal: 1790, activityKcal: 550, tefKcal: 240 });
    const guarded = tdeeComposition({ bmrKcal: 1790, activityKcal: 550, tefKcal: 240, includesTef: true });
    expect(naive.totalKcal - guarded.totalKcal).toBe(240);
    expect(guarded.tefKcal).toBe(0);
  });

  it('propagates a missing BMR as null', () => {
    expect(tdeeComposition({ bmrKcal: null, activityKcal: 550 }).totalKcal).toBeNull();
  });

  it('the formula path is BMR x PAL and already contains thermogenesis', () => {
    expect(formulaTdeeKcal(1790, 1.55)).toBeCloseTo(2774.5, 6);
    expect(formulaTdeeKcal(null, 1.55)).toBeNull();
    expect(formulaTdeeKcal(1790, null)).toBeNull();
  });
});
