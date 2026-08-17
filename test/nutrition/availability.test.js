// Energy availability and the body-fat-aware threshold (kickoff step 4 and
// test 3, "Energieverfügbarkeit").
import { describe, it, expect } from 'vitest';
import { energyAvailability, eaThresholdKcalPerKgFfm, REASONS } from '../../src/nutrition/availability.js';
import { compensationKcal } from '../../src/nutrition/targets.js';
import { validate } from '../../src/nutrition/config.js';

const SEED_PROFILE = { birthDate: '1988-06-16', sex: 'male', heightCm: 173, bodyComp: { mode: 'bodyFatPct', value: 27.9 } };
const cfg = (over = {}) => validate({ profile: SEED_PROFILE, ...over }).normalized;
const FFM = 64.53;
const BASE_INTAKE = 1821; // the module's own rest-day recommendation

describe('the threshold taper', () => {
  it.each([[12, 30], [18, 27.33], [24, 24.67], [27.9, 22.93], [30, 22], [40, 22]])(
    '%f %% body fat -> %f kcal/kg FFM', (bodyFatPct, expected) => {
      expect(eaThresholdKcalPerKgFfm(cfg(), bodyFatPct)).toBeCloseTo(expected, 2);
    });

  it('holds the literature value below the lean anchor', () => {
    expect(eaThresholdKcalPerKgFfm(cfg(), 5)).toBe(30);
    expect(eaThresholdKcalPerKgFfm(cfg(), 12)).toBe(30);
  });

  it('is flat at 30 when the taper is switched off', () => {
    const flat = cfg({ flags: { eaBodyFatAware: false } });
    for (const bodyFatPct of [10, 20, 30, 40]) {
      expect(eaThresholdKcalPerKgFfm(flat, bodyFatPct)).toBe(30);
    }
  });

  it('falls back to the flat value when body fat is unknown', () => {
    expect(eaThresholdKcalPerKgFfm(cfg(), null)).toBe(30);
  });

  it('uses the female anchors for unspecified — the more cautious side', () => {
    const either = cfg({ profile: { ...SEED_PROFILE, sex: 'unspecified' } });
    const male = cfg({ profile: { ...SEED_PROFILE, sex: 'male' } });
    expect(eaThresholdKcalPerKgFfm(either, 27.9)).toBeGreaterThan(eaThresholdKcalPerKgFfm(male, 27.9));
    expect(eaThresholdKcalPerKgFfm(either, 22)).toBe(30);
  });

  it('is monotone non-increasing in body fat', () => {
    const config = cfg();
    let previous = Infinity;
    for (let bodyFatPct = 0; bodyFatPct <= 60; bodyFatPct += 0.5) {
      const value = eaThresholdKcalPerKgFfm(config, bodyFatPct);
      expect(value).toBeLessThanOrEqual(previous + 1e-12);
      previous = value;
    }
  });

  it('the taper is load-bearing, not cosmetic', () => {
    // Against the flat literature threshold the module's own recommended
    // rest-day intake would raise EA_LOW every rest day, indefinitely.
    const day = { intakeKcal: BASE_INTAKE, ffmKg: FFM, bodyFatPct: 27.9 };
    expect(energyAvailability(day, cfg()).eaKcalPerKgFfm).toBeCloseTo(28.22, 2);
    expect(energyAvailability(day, cfg({ flags: { eaBodyFatAware: false } })).low).toBe(true);
    expect(energyAvailability(day, cfg()).low).toBe(false);
  });
});

describe('EA constancy under full compensation (test 3)', () => {
  const config = cfg();
  const FACTOR = 0.95;
  const ea = (intakeKcal, exerciseKcal) => energyAvailability(
    { intakeKcal, exerciseKcal, factor: FACTOR, ffmKg: FFM, bodyFatPct: 27.9 }, config,
  ).eaKcalPerKgFfm;
  const restEA = ea(BASE_INTAKE, 0);

  it.each([300, 600, 900, 1500, 2500])('a %i kcal session moves EA by less than 1 kcal/kg FFM', (exerciseKcal) => {
    const compensated = BASE_INTAKE + compensationKcal(exerciseKcal, FACTOR, config).kcal;
    expect(Math.abs(ea(compensated, exerciseKcal) - restEA)).toBeLessThan(1);
  });

  it('the residual is one-sided — rounding can only lower EA, never raise it', () => {
    // This is the asymmetry principle showing up as a testable property. The
    // bound is the rounding step over FFM: 49 / 64.53 = 0.76 kcal/kg.
    for (let exerciseKcal = 50; exerciseKcal <= 3000; exerciseKcal += 17) {
      const compensated = BASE_INTAKE + compensationKcal(exerciseKcal, FACTOR, config).kcal;
      const delta = ea(compensated, exerciseKcal) - restEA;
      expect(delta).toBeLessThanOrEqual(1e-9);
      expect(delta).toBeGreaterThan(-config.compensation.roundingStepKcal / FFM);
    }
  });

  it('would break the +/- 1 tolerance if EA used the raw expenditure', () => {
    // The reason availability.js calibrates: at factor 0.95 a 1500 kcal session
    // shifts EA by 1.55 kcal/kg if the raw figure is subtracted from a
    // compensated intake, which is outside the kickoff's own tolerance.
    const exerciseKcal = 1500;
    const compensated = BASE_INTAKE + compensationKcal(exerciseKcal, FACTOR, config).kcal;
    const raw = (compensated - exerciseKcal) / FFM;
    expect(Math.abs(raw - restEA)).toBeGreaterThan(1);
    expect(Math.abs(ea(compensated, exerciseKcal) - restEA)).toBeLessThan(1);
  });

  it('partial compensation does not hold EA — the hidden extra deficit', () => {
    // Kickoff's argument for full compensation: anything less quietly deepens
    // the deficit on exactly the days muscle retention is most at stake.
    const partial = cfg({ compensation: { rule: 'partial', partialFraction: 0.6 } });
    const compensated = BASE_INTAKE + compensationKcal(1000, FACTOR, partial).kcal;
    const eaPartial = energyAvailability(
      { intakeKcal: compensated, exerciseKcal: 1000, factor: FACTOR, ffmKg: FFM, bodyFatPct: 27.9 }, partial,
    ).eaKcalPerKgFfm;
    expect(restEA - eaPartial).toBeGreaterThan(5);
  });
});

describe('per-day levels and missing data', () => {
  const config = cfg();

  it('flags low and critical against the tapered threshold', () => {
    const threshold = eaThresholdKcalPerKgFfm(config, 27.9); // 22.93
    const at = (ea) => energyAvailability({ intakeKcal: ea * FFM, ffmKg: FFM, bodyFatPct: 27.9 }, config);
    expect(at(threshold + 1)).toMatchObject({ low: false, critical: false });
    expect(at(threshold - 1)).toMatchObject({ low: true, critical: false });
    expect(at(threshold - 6)).toMatchObject({ low: true, critical: true });
  });

  it('the critical margin comes from config', () => {
    const wide = cfg({ flags: { eaCriticalMargin: 10 } });
    const threshold = eaThresholdKcalPerKgFfm(wide, 27.9);
    expect(energyAvailability({ intakeKcal: (threshold - 6) * FFM, ffmKg: FFM, bodyFatPct: 27.9 }, wide).critical).toBe(false);
  });

  it('subtracts the calibrated training energy, and reports it', () => {
    const r = energyAvailability({ intakeKcal: 2500, exerciseKcal: 1000, factor: 0.9, ffmKg: FFM, bodyFatPct: 27.9 }, config);
    expect(r.calibratedExerciseKcal).toBe(900);
    expect(r.eaKcalPerKgFfm).toBeCloseTo((2500 - 900) / FFM, 6);
  });

  it('returns null rather than a number when FFM or intake is missing', () => {
    expect(energyAvailability({ intakeKcal: 2000, ffmKg: null }, config)).toMatchObject({ eaKcalPerKgFfm: null, low: false });
    expect(energyAvailability({ intakeKcal: 2000, ffmKg: 0 }, config).reasons).toContain(REASONS.NO_FFM);
    expect(energyAvailability({ ffmKg: FFM }, config).reasons).toContain(REASONS.NO_INTAKE);
    expect(energyAvailability(null, config).eaKcalPerKgFfm).toBeNull();
  });

  it('treats a non-numeric session as no training energy', () => {
    expect(energyAvailability({ intakeKcal: 2000, exerciseKcal: null, ffmKg: FFM }, config).calibratedExerciseKcal).toBe(0);
    expect(energyAvailability({ intakeKcal: 2000, exerciseKcal: 500, factor: null, ffmKg: FFM }, config).calibratedExerciseKcal).toBe(500);
  });

  it('a floor clamped to the threshold flattens the taper', () => {
    const flat = cfg({ flags: { eaLowThreshold: 20 } });
    // config clamps the 22 floor down to the 20 threshold, so no taper is left
    expect(eaThresholdKcalPerKgFfm(flat, 12)).toBe(20);
    expect(eaThresholdKcalPerKgFfm(flat, 35)).toBe(20);
  });

  it('defaults an absent session to no training energy', () => {
    expect(energyAvailability({ intakeKcal: 2000, ffmKg: FFM }, config).calibratedExerciseKcal).toBe(0);
  });
});
