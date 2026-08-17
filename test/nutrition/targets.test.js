// Daily intake target, safety limits, macro split (kickoff step 4 and test 5
// "Grenzfälle"). Reference figures throughout are the seed profile:
// 89.5 kg / 27.9 % body fat / FFM 64.53 / BMR 1790 / rest-day TDEE 2334.
import { describe, it, expect } from 'vitest';
import {
  isRestDay, restDayTdeeKcal, deficitKcalPerDay, phaseFor, dailyTarget,
  macroTargets, compensationKcal, REASONS,
} from '../../src/nutrition/targets.js';
import { validate } from '../../src/nutrition/config.js';

const SEED_PROFILE = { birthDate: '1988-06-16', sex: 'male', heightCm: 173, bodyComp: { mode: 'bodyFatPct', value: 27.9 } };
const cfg = (over = {}) => validate({
  profile: SEED_PROFILE, goal: { mode: 'cut', target: { type: 'weight', valueKg: 75 } }, ...over,
}).normalized;
const BODY = { restTdeeKcal: 2334, bmrKcal: 1790, weightKg: 89.5, bodyFatPct: 27.9, ffmKg: 64.53 };

describe('rest-day TDEE', () => {
  it('counts a session only above minSessionMinutes — false starts are not training', () => {
    const config = cfg();
    expect(isRestDay({ exerciseMinutes: 0 }, config)).toBe(true);
    expect(isRestDay({ exerciseMinutes: 15 }, config)).toBe(true);   // default 20
    expect(isRestDay({ exerciseMinutes: 20 }, config)).toBe(false);
  });

  it('falls back to exercise energy when minutes are unknown', () => {
    const config = cfg();
    expect(isRestDay({ exerciseKcal: 400 }, config)).toBe(false);
    expect(isRestDay({ exerciseKcal: 0 }, config)).toBe(true);
    expect(isRestDay({}, config)).toBe(true);
  });

  it('takes the median of rest days and calibrates it', () => {
    const days = [
      { date: '2026-07-01', estimateKcal: 2400, exerciseMinutes: 0 },
      { date: '2026-07-02', estimateKcal: 2500, exerciseMinutes: 0 },
      { date: '2026-07-03', estimateKcal: 2600, exerciseMinutes: 0 },
      { date: '2026-07-04', estimateKcal: 3400, exerciseMinutes: 120 }, // training, excluded
    ];
    expect(restDayTdeeKcal(days, cfg(), 1)).toBe(2500);
    expect(restDayTdeeKcal(days, cfg(), 0.95)).toBeCloseTo(2375, 6);
  });

  it('the median resists one mountain day misfiled as a rest day', () => {
    const rest = Array.from({ length: 9 }, (_, i) => ({ date: `2026-07-0${i + 1}`, estimateKcal: 2400, exerciseMinutes: 0 }));
    const withMisfile = [...rest, { date: '2026-07-10', estimateKcal: 4800, exerciseMinutes: 0 }];
    expect(restDayTdeeKcal(withMisfile, cfg())).toBe(2400);
  });

  it('is null without rest days', () => {
    expect(restDayTdeeKcal([{ date: '2026-07-01', estimateKcal: 3000, exerciseMinutes: 90 }], cfg())).toBeNull();
    expect(restDayTdeeKcal([], cfg())).toBeNull();
  });
});

describe('phases', () => {
  it('the auto phase scales continuously with body fat', () => {
    expect(phaseFor({ weightKg: 89.5, bodyFatPct: 27.9 }, cfg()).ratePctBwPerWeek).toBeCloseTo(0.521, 3);
    expect(phaseFor({ weightKg: 78, bodyFatPct: 20 }, cfg()).ratePctBwPerWeek).toBeCloseTo(0.450, 3);
  });

  it('walks the manual ladder when auto is off', () => {
    const manual = cfg({
      phases: {
        auto: false,
        manual: [
          { name: 'Phase 1', untilWeightKg: 82, ratePctBwPerWeek: 0.5 },
          { name: 'Phase 2', untilWeightKg: 78, ratePctBwPerWeek: 0.4 },
          { name: 'Phase 3', untilWeightKg: 75, ratePctBwPerWeek: 0.3 },
        ],
      },
    });
    expect(phaseFor({ weightKg: 89.5 }, manual)).toMatchObject({ name: 'Phase 1', ratePctBwPerWeek: 0.5 });
    expect(phaseFor({ weightKg: 80 }, manual)).toMatchObject({ name: 'Phase 2', ratePctBwPerWeek: 0.4 });
    expect(phaseFor({ weightKg: 76 }, manual)).toMatchObject({ name: 'Phase 3', ratePctBwPerWeek: 0.3 });
  });

  it('walks the manual ladder upward in a gain phase', () => {
    const bulk = cfg({
      goal: { mode: 'gain', target: { type: 'weight', valueKg: 95 } },
      phases: {
        auto: false,
        manual: [
          { name: 'Aufbau 1', untilWeightKg: 92, ratePctBwPerWeek: 0.3 },
          { name: 'Aufbau 2', untilWeightKg: 95, ratePctBwPerWeek: 0.2 },
        ],
      },
    });
    expect(phaseFor({ weightKg: 89.5 }, bulk)).toMatchObject({ name: 'Aufbau 1' });
    expect(phaseFor({ weightKg: 93 }, bulk)).toMatchObject({ name: 'Aufbau 2' });
    expect(phaseFor({ weightKg: 95 }, bulk).reached).toBe(true);
  });

  it('a ladder with no rung left means the goal is reached', () => {
    const spent = cfg({ goal: { mode: 'cut', target: { type: 'weight', valueKg: null } }, phases: { auto: false, manual: [{ name: 'letzte', untilWeightKg: 80, ratePctBwPerWeek: 0.4 }] } });
    expect(phaseFor({ weightKg: 79 }, spent)).toMatchObject({ reached: true, ratePctBwPerWeek: 0 });
  });

  it('stops at the goal weight (test 5: Zielgewicht erreicht)', () => {
    const at = phaseFor({ weightKg: 75, bodyFatPct: 14 }, cfg());
    expect(at).toMatchObject({ reached: true, ratePctBwPerWeek: 0 });
    expect(phaseFor({ weightKg: 74, bodyFatPct: 14 }, cfg()).reached).toBe(true);
    expect(dailyTarget({ ...BODY, weightKg: 75, bodyFatPct: 14 }, cfg()).reasons).toContain(REASONS.GOAL_REACHED);
    expect(dailyTarget({ ...BODY, weightKg: 75, bodyFatPct: 14 }, cfg()).baseIntakeKcal).toBe(2334);
  });

  it('maintain has no phase and no deficit', () => {
    const config = cfg({ goal: { mode: 'maintain', target: { type: 'weight', valueKg: null } } });
    expect(phaseFor({ weightKg: 89.5, bodyFatPct: 27.9 }, config).ratePctBwPerWeek).toBe(0);
    expect(dailyTarget(BODY, config).deficitKcal).toBe(0);
  });

  it('converts a rate to a daily deficit', () => {
    // 0.5 %/week of 89.5 kg = 0.4475 kg/week -> /7 -> x 7700
    expect(deficitKcalPerDay(0.5, 89.5, cfg())).toBeCloseTo(492.25, 2);
    expect(deficitKcalPerDay(null, 89.5, cfg())).toBe(0);
  });
});

describe('daily target for the seed profile', () => {
  const result = dailyTarget(BODY, cfg());

  it('lands on the documented numbers', () => {
    expect(result.ratePctBwPerWeek).toBeCloseTo(0.521, 3);
    expect(Math.round(result.deficitKcal)).toBe(513);
    expect(Math.round(result.baseIntakeKcal)).toBe(1821);
  });

  it('is not clipped by either ceiling — the point of capFraction 0.45', () => {
    expect(result.reasons).not.toContain(REASONS.DEFICIT_CAPPED_FAT_MASS);
    expect(result.reasons).not.toContain(REASONS.DEFICIT_CAPPED_ABSOLUTE);
    expect(result.floor.applied).toBe(false);
    expect(Math.round(result.caps.fatMassKcal)).toBe(749);
  });

  it('warns at the soft floor without changing anything', () => {
    // 1821 sits between the hard floor (1790) and the soft one (1969): the two
    // multiples have different jobs, which is the whole reason both exist.
    expect(result.reasons).toContain(REASONS.BELOW_SOFT_FLOOR);
    expect(result.baseIntakeKcal).toBeGreaterThan(result.floor.hard);
    expect(result.baseIntakeKcal).toBeLessThan(result.floor.soft);
  });
});

describe('safety limits (test 5)', () => {
  it('the fat-mass ceiling binds on a lean athlete before the absolute one', () => {
    // 8 % body fat on 70 kg -> 5.6 kg fat -> 168 kcal/day ceiling
    const lean = { restTdeeKcal: 2600, bmrKcal: 1700, weightKg: 70, bodyFatPct: 8, ffmKg: 64.4 };
    const r = dailyTarget(lean, cfg({ goal: { mode: 'cut', target: { type: 'weight', valueKg: 65 } } }));
    expect(r.reasons).toContain(REASONS.DEFICIT_CAPPED_FAT_MASS);
    expect(r.deficitKcal).toBeCloseTo(30 * 5.6, 4);
  });

  it('the hard floor binds and the deficit is recomputed from what applies', () => {
    // A deep deficit against a low rest TDEE: the floor raises the intake, and
    // the reported deficit must follow, or the app shows one that is not in force.
    const r = dailyTarget({ restTdeeKcal: 2100, bmrKcal: 1900, weightKg: 120, bodyFatPct: 40, ffmKg: 72 }, cfg());
    expect(r.reasons).toContain(REASONS.HARD_FLOOR_APPLIED);
    expect(r.baseIntakeKcal).toBe(1900);
    expect(r.deficitKcal).toBe(200);
    expect(r.deficitKcal).toBeLessThan(r.requestedDeficitKcal);
    expect(r.restTdeeKcal - r.baseIntakeKcal).toBe(r.deficitKcal);
  });

  it('a gain phase mirrors the logic and is capped by maxSurplusKcal', () => {
    const gain = cfg({ goal: { mode: 'gain', target: { type: 'weight', valueKg: 95 } }, phases: { auto: false, manual: [{ name: 'bulk', untilWeightKg: 95, ratePctBwPerWeek: 1.0 }] } });
    const r = dailyTarget(BODY, gain);
    // 1.0 %/week of 89.5 kg = 984 kcal/day, capped at 500
    expect(r.reasons).toContain(REASONS.SURPLUS_CAPPED);
    expect(r.deficitKcal).toBe(-500);
    expect(r.baseIntakeKcal).toBe(2334 + 500);
  });

  it('caps the ledger correction at maxDailyCorrectionKcal', () => {
    const big = dailyTarget({ ...BODY, restTdeeKcal: 2600, ledgerCorrectionKcal: -900 }, cfg());
    expect(big.reasons).toContain(REASONS.LEDGER_CORRECTION_CAPPED);
    expect(big.ledgerCorrectionKcal).toBe(-250);
    expect(big.targetIntakeKcal).toBe(big.baseIntakeKcal - 250);
  });

  it('the hard floor clips the correction, and for this profile that leaves 31 kcal', () => {
    // Worth pinning rather than hiding: the seed athlete's base intake of 1821
    // sits only 31 kcal above the hard floor of 1790, so a downward ledger
    // correction has almost no room to work. The account can still be paid off
    // upward-free over many days, but a single -250 day is not available here.
    const r = dailyTarget({ ...BODY, ledgerCorrectionKcal: -250 }, cfg());
    expect(r.reasons).toContain(REASONS.LEDGER_CORRECTION_CLIPPED_BY_FLOOR);
    expect(r.targetIntakeKcal).toBe(1790);
    expect(Math.round(r.baseIntakeKcal - r.targetIntakeKcal)).toBe(31);
  });

  it('an upward correction is not floored', () => {
    const r = dailyTarget({ ...BODY, ledgerCorrectionKcal: 200 }, cfg());
    expect(r.reasons).not.toContain(REASONS.LEDGER_CORRECTION_CLIPPED_BY_FLOOR);
    expect(Math.round(r.targetIntakeKcal)).toBe(2021);
  });

  it('reports missing inputs instead of inventing them', () => {
    expect(dailyTarget({ ...BODY, restTdeeKcal: null }, cfg()).reasons).toEqual([REASONS.NO_REST_TDEE]);
    expect(dailyTarget({ ...BODY, bmrKcal: null }, cfg()).reasons).toContain(REASONS.NO_BMR);
    expect(dailyTarget({ ...BODY, bmrKcal: null }, cfg()).floor.hard).toBeNull();
    expect(dailyTarget(null, cfg()).baseIntakeKcal).toBeNull();
  });

  it('weight gain during a cut still produces a target (test 5)', () => {
    // Gaining weight does not change the phase; the calibration absorbs it.
    const r = dailyTarget({ ...BODY, weightKg: 91 }, cfg());
    expect(r.baseIntakeKcal).toBeLessThan(2334);
    expect(r.reasons).not.toContain(REASONS.GOAL_REACHED);
  });
});

describe('macro split (test 5)', () => {
  const body = { weightKg: 89.5, ffmKg: 64.53 };

  it('protein and fat first, carbohydrate as the remainder', () => {
    const m = macroTargets(1821, body, cfg());
    expect(Math.round(m.proteinG)).toBe(155);   // 2.4 g/kg FFM
    expect(Math.round(m.fatG)).toBe(72);        // 0.8 g/kg bodyweight
    expect(Math.round(m.carbsG)).toBe(139);
    expect(m.error).toBeNull();
  });

  it('the macros add up to the intake exactly', () => {
    const m = macroTargets(1821, body, cfg());
    expect(m.kcal.protein + m.kcal.fat + m.kcal.carbs).toBeCloseTo(1821, 6);
  });

  it('scales fibre with intake', () => {
    expect(macroTargets(2000, body, cfg()).fiberG).toBeCloseTo(28, 6); // 14 g per 1000
  });

  it('reduces fat first when carbohydrate falls under its minimum', () => {
    const m = macroTargets(1350, body, cfg());
    expect(m.adjustments).toContain(REASONS.MACROS_FAT_REDUCED);
    expect(m.adjustments).not.toContain(REASONS.MACROS_PROTEIN_REDUCED);
    expect(m.fatG).toBeGreaterThanOrEqual(50);
    expect(m.carbsG).toBeCloseTo(50, 6);
    expect(m.error).toBeNull();
  });

  it('then protein, down to the bodyweight floor', () => {
    const m = macroTargets(1250, body, cfg());
    expect(m.adjustments).toEqual([REASONS.MACROS_FAT_REDUCED, REASONS.MACROS_PROTEIN_REDUCED]);
    expect(m.fatG).toBeCloseTo(50, 6);
    expect(m.proteinG).toBeGreaterThanOrEqual(cfg().macros.protein.minGPerKgBw * body.weightKg - 1e-9);
    expect(m.error).toBeNull();
  });

  it('then refuses, rather than returning something impossible', () => {
    // Below protein floor 143.2 g + fat floor 50 g + carb minimum 50 g = 1223
    // kcal nothing can satisfy all three, and the module says so.
    const m = macroTargets(800, body, cfg());
    expect(m.error).toBe(REASONS.MACROS_INFEASIBLE);
    expect(m.proteinG).toBeCloseTo(1.6 * 89.5, 6); // held at the floor
    expect(m.fatG).toBeCloseTo(50, 6);
  });

  it('1223 kcal is the feasibility boundary for this profile', () => {
    const floorKcal = 1.6 * 89.5 * 4 + 50 * 9 + 50 * 4;
    expect(macroTargets(floorKcal + 1, body, cfg()).error).toBeNull();
    expect(macroTargets(floorKcal - 1, body, cfg()).error).toBe(REASONS.MACROS_INFEASIBLE);
  });

  it("falls back to the bodyweight floor at bodyComp 'none' (test 5)", () => {
    const m = macroTargets(1821, { weightKg: 89.5 }, cfg({ profile: { ...SEED_PROFILE, bodyComp: { mode: 'none', value: null } } }));
    expect(m.adjustments).toContain(REASONS.PROTEIN_BASIS_FELL_BACK);
    expect(m.proteinG).toBeCloseTo(1.6 * 89.5, 6);
    expect(m.error).toBeNull();
  });

  it('handles a missing intake', () => {
    expect(macroTargets(null, body, cfg()).error).toBe(REASONS.MACROS_INFEASIBLE);
  });
});

describe('alternative macro bases', () => {
  const body = { weightKg: 89.5, ffmKg: 64.53 };

  it.each([
    ['absolute', 170, 170],
    ['bodyweight', 2, 179],
    ['ffm', 2.4, 154.872],
  ])('protein basis %s x %f -> %f g', (basis, value, expected) => {
    const m = macroTargets(2600, body, cfg({ macros: { protein: { basis, value } } }));
    expect(m.proteinG).toBeCloseTo(expected, 3);
  });

  it.each([
    ['absolute', 80, 80],
    ['ffm', 1, 64.53],
    ['pctKcal', 30, 2600 * 0.3 / 9],
  ])('fat basis %s x %f -> %f g', (basis, value, expected) => {
    const m = macroTargets(2600, body, cfg({ macros: { fat: { basis, value } } }));
    expect(m.fatG).toBeCloseTo(expected, 3);
  });

  it('falls back to the fat minimum when the basis cannot be resolved', () => {
    const m = macroTargets(2600, { weightKg: 89.5 }, cfg({ macros: { fat: { basis: 'ffm', value: 1 } } }));
    expect(m.fatG).toBe(50);
  });

  it('an unresolvable protein basis without a weight yields the zero floor', () => {
    const m = macroTargets(2600, {}, cfg());
    expect(m.proteinG).toBe(0);
    expect(m.adjustments).toContain(REASONS.PROTEIN_BASIS_FELL_BACK);
  });
});

describe('compensation', () => {
  it('is full, calibrated and rounded down', () => {
    // 600 x 0.95 = 570 -> down to the 50 step
    expect(compensationKcal(600, 0.95, cfg())).toMatchObject({ kcal: 550, calibratedKcal: 570 });
  });

  it('rounding down is systematic, never on average', () => {
    for (const exercise of [300, 517, 900, 1234, 1500]) {
      const { kcal, calibratedKcal } = compensationKcal(exercise, 0.95, cfg());
      expect(kcal).toBeLessThanOrEqual(calibratedKcal);
      expect(calibratedKcal - kcal).toBeLessThan(50);
    }
  });

  it('honours the partial and none rules', () => {
    expect(compensationKcal(600, 1, cfg({ compensation: { rule: 'partial', partialFraction: 0.6 } })).kcal).toBe(350);
    expect(compensationKcal(600, 1, cfg({ compensation: { rule: 'none' } })).kcal).toBe(0);
  });

  it('compensates nothing without expenditure data — no estimate', () => {
    for (const value of [null, undefined, NaN, 0, -5]) {
      expect(compensationKcal(value, 0.95, cfg())).toMatchObject({ kcal: 0 });
    }
    expect(compensationKcal(null, 0.95, cfg()).reasons).toContain(REASONS.NO_EXPENDITURE_DATA);
  });

  it('does not round at all when the step is zero', () => {
    expect(compensationKcal(600, 0.95, cfg({ compensation: { roundingStepKcal: 0 } })).kcal).toBe(570);
  });

  it('treats a missing factor as 1', () => {
    expect(compensationKcal(600, null, cfg()).kcal).toBe(600);
  });

  it('rounds to nearest when configured to', () => {
    expect(compensationKcal(600, 0.95, cfg({ compensation: { roundingDirection: 'nearest' } })).kcal).toBe(550);
    expect(compensationKcal(620, 0.95, cfg({ compensation: { roundingDirection: 'nearest' } })).kcal).toBe(600);
    expect(compensationKcal(620, 0.95, cfg()).kcal).toBe(550);
  });
});
