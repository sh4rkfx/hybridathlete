// Config schema, validation and migration (kickoff "Regeln zum Schema",
// test 7 "Einheiten" and test 9 "Config-Migration").
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG, SCHEMA_VERSION, SAFETY_BOUNDS, MAX_RATE_BANDS,
  validate, assertValid, migrate, maxRatePctBwPerWeek,
  autoRatePctBwPerWeek, interpolatedRateCapPctBwPerWeek,
  massToKg, massFromKg, heightToCm, heightFromCm, energyToKcal, energyFromKcal,
} from '../../src/nutrition/config.js';

// Reference athlete from the kickoff seed profile, as a valid full config.
export const REFERENCE_CONFIG = {
  schemaVersion: 1,
  locale: 'de-AT',
  profile: { birthDate: '1988-06-16', sex: 'male', heightCm: 173, bodyComp: { mode: 'bodyFatPct', value: 27.9 } },
  goal: { mode: 'cut', target: { type: 'weight', valueKg: 75 } },
  phases: {
    auto: true,
    manual: [
      { name: 'Phase 1', untilWeightKg: 82, ratePctBwPerWeek: 0.50 },
      { name: 'Phase 2', untilWeightKg: 78, ratePctBwPerWeek: 0.40 },
      { name: 'Phase 3', untilWeightKg: 75, ratePctBwPerWeek: 0.30 },
    ],
  },
  history: {
    deviceEras: [{ from: '2024-01-01', to: null, label: 'Fenix 7' }],
    trainingContext: { defaultLabel: 'normal', periods: [{ from: '2026-03-01', to: null, label: 'rehab', representative: false }] },
  },
};

const codes = (list) => list.map((e) => e.code);
const paths = (list) => list.map((e) => e.path);

describe('defaults and normalization', () => {
  it('an empty config is valid and normalizes to the full defaults', () => {
    const { valid, errors, normalized } = validate({});
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
    expect(normalized).toEqual({ ...DEFAULT_CONFIG, schemaVersion: SCHEMA_VERSION });
  });

  it('undefined and non-objects normalize to the defaults too', () => {
    for (const input of [undefined, null, 42, 'nope', []]) {
      expect(validate(input).normalized.calibration.windowDays).toBe(21);
    }
  });

  it('the empty config warns about what is still missing rather than failing', () => {
    const { warnings } = validate({});
    expect(codes(warnings)).toContain('CONFIG_PROFILE_INCOMPLETE');
    expect(warnings.find((w) => w.code === 'CONFIG_PROFILE_INCOMPLETE').params.missing)
      .toEqual(['birthDate', 'heightCm', 'sex']);
  });

  it('merges partial input without dropping sibling defaults', () => {
    const { normalized } = validate({ calibration: { windowDays: 28 } });
    expect(normalized.calibration.windowDays).toBe(28);
    expect(normalized.calibration.minDays).toBe(14);
    expect(normalized.calibration.outlier).toEqual({ method: 'mad', threshold: 3 });
  });

  it('does not share structure with DEFAULT_CONFIG', () => {
    const { normalized } = validate({});
    normalized.calibration.outlier.threshold = 99;
    normalized.intake.atwater.fiber = 99;
    expect(DEFAULT_CONFIG.calibration.outlier.threshold).toBe(3);
    expect(DEFAULT_CONFIG.intake.atwater.fiber).toBe(2);
  });

  it('accepts the reference-athlete config without errors or warnings', () => {
    const { valid, errors, warnings } = validate(REFERENCE_CONFIG);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(valid).toBe(true);
  });
});

describe('forward compatibility (test 9)', () => {
  it('unknown fields survive a validate roundtrip at every depth', () => {
    const input = {
      futureTopLevel: { nested: 42 },
      calibration: { windowDays: 21, futureNested: ['a', 'b'] },
      profile: { bodyComp: { mode: 'none', value: null, futureDeep: true } },
    };
    const { normalized } = validate(input);
    expect(normalized.futureTopLevel).toEqual({ nested: 42 });
    expect(normalized.calibration.futureNested).toEqual(['a', 'b']);
    expect(normalized.profile.bodyComp.futureDeep).toBe(true);
    // and again through a second pass — a save/load/save cycle
    expect(validate(normalized).normalized.futureTopLevel).toEqual({ nested: 42 });
  });

  it('reports the unknown paths as a warning, not an error', () => {
    const { valid, warnings } = validate({ nope: 1, calibration: { alsoNope: 2 } });
    expect(valid).toBe(true);
    const w = warnings.find((x) => x.code === 'CONFIG_UNKNOWN_FIELDS');
    expect(w.params.paths).toEqual(['nope', 'calibration.alsoNope']);
  });

  it('a v1 config migrates to v1 unchanged', () => {
    const result = migrate({ schemaVersion: 1, locale: 'de-AT' });
    expect(result).toMatchObject({ from: 1, to: 1, applied: 0, ahead: false });
    expect(result.config.locale).toBe('de-AT');
  });

  it('a config from a newer schema is kept intact and flagged, not downgraded', () => {
    const future = { schemaVersion: 99, brandNew: 'keep me', calibration: { windowDays: 42 } };
    expect(migrate(future)).toMatchObject({ from: 99, to: 99, ahead: true });
    const { valid, warnings, normalized } = validate(future);
    expect(valid).toBe(true);
    expect(codes(warnings)).toContain('CONFIG_SCHEMA_AHEAD');
    expect(normalized.schemaVersion).toBe(99);
    expect(normalized.brandNew).toBe('keep me');
  });

  it('a malformed subtree keeps the defaults and reports, instead of throwing', () => {
    // Regression (PR #62 review): a corrupted store handing back `profile: null`
    // used to replace the default subtree, and the cross-field checks then threw
    // a TypeError on profile.bodyComp — a config that cannot be loaded at all
    // rather than one that says what is wrong with it.
    for (const [input, path] of [
      [{ profile: null }, 'profile'],
      [{ calibration: { confidence: null } }, 'calibration.confidence'],
      [{ profile: { bodyComp: 'lean' } }, 'profile.bodyComp'],
      [{ intake: { atwater: 42 } }, 'intake.atwater'],
      [{ safety: [] }, 'safety'],
    ]) {
      const result = validate(input);
      expect(result.valid, path).toBe(false);
      expect(result.errors.find((e) => e.path === path)?.code, path).toBe('CONFIG_NOT_AN_OBJECT');
      // the default subtree survived, so `normalized` is still usable
      expect(result.normalized.profile.bodyComp, path).toEqual({ mode: 'none', value: null });
      expect(result.normalized.calibration.confidence.mediumCoverage, path).toBe(0.70);
      expect(result.normalized.safety.maxSurplusKcal, path).toBe(500);
    }
  });

  it('a missing schemaVersion is treated as current', () => {
    expect(validate({ locale: 'de-AT' }).normalized.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('safety hardcaps', () => {
  // Every declared bound must reject the aggressive direction, accept the
  // conservative one, and be clamped in `normalized` either way.
  it.each(SAFETY_BOUNDS)('$path may not move in the aggressive direction', ({ path, direction }) => {
    const limit = path.split('.').reduce((o, k) => o[k], DEFAULT_CONFIG);
    const aggressive = direction === 'max' ? limit * 1.5 : limit * 0.5;
    const conservative = direction === 'max' ? limit * 0.5 : limit * 1.5;

    const bad = validate(nest(path, aggressive));
    expect(bad.valid).toBe(false);
    expect(bad.errors.find((e) => e.path === path).code).toBe('CONFIG_SAFETY_MORE_AGGRESSIVE');
    // clamped even though the caller was told it is invalid
    expect(path.split('.').reduce((o, k) => o[k], bad.normalized)).toBe(limit);

    // Raising the hard floor is only conservative if the soft floor moves with
    // it — otherwise it trips CONFIG_HARD_FLOOR_ABOVE_SOFT_FLOOR on its own.
    const companion = path === 'safety.intakeFloor.hardFloorBmrMultiple'
      ? { safety: { intakeFloor: { bmrMultiple: conservative, hardFloorBmrMultiple: conservative } } }
      : nest(path, conservative);
    const good = validate(companion);
    expect(good.errors.filter((e) => e.path === path)).toEqual([]);
  });

  it('the hard floor may not sit above the soft floor', () => {
    const { errors } = validate({ safety: { intakeFloor: { bmrMultiple: 1.5, hardFloorBmrMultiple: 1.6 } } });
    expect(codes(errors)).toContain('CONFIG_HARD_FLOOR_ABOVE_SOFT_FLOOR');
  });

  it('a manual phase may not out-run the body-fat rate ceiling', () => {
    const cfg = {
      ...REFERENCE_CONFIG,
      phases: { auto: false, manual: [{ name: 'zu schnell', untilWeightKg: 80, ratePctBwPerWeek: 1.4 }] },
    };
    const { valid, errors } = validate(cfg);
    expect(valid).toBe(false);
    const e = errors.find((x) => x.code === 'CONFIG_PHASE_RATE_ABOVE_CAP');
    expect(e.path).toBe('phases.manual.0.ratePctBwPerWeek');
    expect(e.params.cap).toBe(1.0); // male, 27.9 % -> the 20-30 % band
  });

  it('rejects malformed phase entries', () => {
    const { errors } = validate({ phases: { manual: [{ name: '', untilWeightKg: -1, ratePctBwPerWeek: 'fast' }] } });
    expect(paths(errors)).toEqual([
      'phases.manual.0.name', 'phases.manual.0.untilWeightKg', 'phases.manual.0.ratePctBwPerWeek',
    ]);
  });
});

describe('maxRate body-fat bands', () => {
  const bands = (sex) => (pct) => maxRatePctBwPerWeek({ profile: { sex }, safety: DEFAULT_CONFIG.safety }, pct);

  it.each([[35, 1.2], [25, 1.0], [15, 0.7], [8, 0.5]])('male %i %% -> %f %%/week', (pct, expected) => {
    expect(bands('male')(pct)).toBe(expected);
  });

  it.each([[45, 1.2], [35, 1.0], [25, 0.7], [15, 0.5]])('female %i %% -> %f %%/week', (pct, expected) => {
    expect(bands('female')(pct)).toBe(expected);
  });

  it('unspecified uses the female thresholds, the more conservative side', () => {
    expect(bands('unspecified')(32)).toBe(1.0);
    expect(bands('male')(32)).toBe(1.2);
  });

  it('falls back when body fat is unknown or the mode is fixed', () => {
    expect(bands('male')(null)).toBe(0.7);
    expect(maxRatePctBwPerWeek({ profile: { sex: 'male' }, safety: { maxRate: { mode: 'fixed', fallbackPctBwPerWeek: 0.4 } } }, 35)).toBe(0.4);
  });

  it('the fallback does not cap the bands', () => {
    // regression: Math.min(band, fallback) would make 1.0 and 1.2 unreachable
    expect(bands('male')(35)).toBeGreaterThan(DEFAULT_CONFIG.safety.maxRate.fallbackPctBwPerWeek);
    expect(MAX_RATE_BANDS[0].maxPctBwPerWeek).toBe(1.2);
  });
});

describe('continuous auto-phase rate', () => {
  const male = (over = {}) => validate({ profile: { ...REFERENCE_CONFIG.profile }, ...over }).normalized;
  // Hand-built rather than validated: SAFETY_BOUNDS clamps capFraction back to
  // the default, and the point here is to prove the guard holds regardless.
  const rawMale = (capFraction) => ({
    profile: { sex: 'male' },
    phases: { autoRate: { capFraction } },
    safety: DEFAULT_CONFIG.safety,
  });

  it('interpolates between the band anchors instead of stepping', () => {
    const config = male();
    expect(interpolatedRateCapPctBwPerWeek(config, 27.9)).toBeCloseTo(1.158, 3);
    expect(interpolatedRateCapPctBwPerWeek(config, 20)).toBeCloseTo(1.0, 6);
    expect(interpolatedRateCapPctBwPerWeek(config, 12)).toBeCloseTo(0.7, 6);
    // clamped outside the anchor range
    expect(interpolatedRateCapPctBwPerWeek(config, 60)).toBe(1.2);
    expect(interpolatedRateCapPctBwPerWeek(config, 0)).toBe(0.5);
  });

  it.each([[27.9, 0.521], [24, 0.486], [20, 0.450], [14, 0.349]])(
    'at %f %% body fat the auto rate is %f %%/week', (bodyFatPct, expected) => {
      expect(autoRatePctBwPerWeek(male(), bodyFatPct)).toBeCloseTo(expected, 3);
    });

  it('is continuous and monotone in body fat', () => {
    const config = male();
    const samples = Array.from({ length: 501 }, (_, i) => autoRatePctBwPerWeek(config, i / 10));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 1e-12);   // monotone
      expect(samples[i] - samples[i - 1]).toBeLessThan(0.02);              // no jumps
    }
  });

  it('never exceeds the safety ceiling, at any body fat or any capFraction', () => {
    for (const capFraction of [0.05, 0.45, 0.7, 1]) {
      const config = rawMale(capFraction);
      for (let bodyFatPct = 0; bodyFatPct <= 50; bodyFatPct += 0.1) {
        expect(autoRatePctBwPerWeek(config, bodyFatPct))
          .toBeLessThanOrEqual(maxRatePctBwPerWeek(config, bodyFatPct) + 1e-12);
      }
    }
  });

  it('falls back to the fixed ceiling share when body fat is unknown', () => {
    expect(autoRatePctBwPerWeek(male(), null)).toBeCloseTo(0.7 * 0.45, 6);
  });

  it('capFraction 0.70 is rejected as more aggressive than the default', () => {
    // Pinned deliberately. 0.70 is the largest share that never touches the
    // ceiling, which is exactly what makes it useless: the fat-mass cap and the
    // hard intake floor then bind for the whole cut and the curve stops
    // steering. Raising the default should require seeing this fail.
    const { valid, errors, normalized } = validate({ phases: { autoRate: { capFraction: 0.7 } } });
    expect(valid).toBe(false);
    expect(errors.find((e) => e.path === 'phases.autoRate.capFraction').code)
      .toBe('CONFIG_SAFETY_MORE_AGGRESSIVE');
    expect(normalized.phases.autoRate.capFraction).toBe(0.45);
  });

  it('a smaller share is allowed — conservative is always permitted', () => {
    expect(validate({ phases: { autoRate: { capFraction: 0.3 } } }).valid).toBe(true);
  });
});

describe('EA threshold taper config', () => {
  it('rejects anchors that do not run downward', () => {
    const { errors } = validate({ flags: { eaThresholdTaper: { fullThresholdBelowBodyFatPct: { male: 35 } } } });
    expect(errors.find((e) => e.path === 'flags.eaThresholdTaper.floorAtBodyFatPct.male').code)
      .toBe('CONFIG_TAPER_ANCHORS_UNORDERED');
  });

  it('a floor above the threshold flattens the taper rather than failing', () => {
    // Raising the floor is the conservative direction, so it has to stay
    // reachable; a floor at or above the threshold just means no taper at all.
    const { valid, warnings, normalized } = validate({ flags: { eaThresholdTaper: { minThresholdKcalPerKgFfm: 45 } } });
    expect(valid).toBe(true);
    expect(codes(warnings)).toContain('CONFIG_EA_FLOOR_ABOVE_THRESHOLD');
    expect(normalized.flags.eaThresholdTaper.minThresholdKcalPerKgFfm).toBe(30);
  });

  it('lowering the floor is rejected as more aggressive', () => {
    const { valid, errors } = validate({ flags: { eaThresholdTaper: { minThresholdKcalPerKgFfm: 15 } } });
    expect(valid).toBe(false);
    expect(codes(errors)).toContain('CONFIG_SAFETY_MORE_AGGRESSIVE');
  });
});

describe('body composition and BMR formula availability', () => {
  it("bodyComp 'none' makes Katch and Cunningham unavailable", () => {
    for (const formula of ['katch', 'cunningham']) {
      const { valid, errors } = validate({ energy: { bmrFormula: formula } });
      expect(valid).toBe(false);
      expect(codes(errors)).toContain('CONFIG_FORMULA_NEEDS_BODY_COMP');
    }
  });

  it("'median' degrades to Mifflin + Owen and says so", () => {
    const { valid, warnings } = validate({ energy: { bmrFormula: 'median' } });
    expect(valid).toBe(true);
    expect(codes(warnings)).toContain('CONFIG_MEDIAN_WITHOUT_KATCH');
  });

  it('Harris and Cunningham warn about systematic overestimation', () => {
    const withComp = { profile: { bodyComp: { mode: 'ffm', value: 64.5 } } };
    for (const formula of ['harris', 'cunningham']) {
      const { warnings } = validate({ ...withComp, energy: { bmrFormula: formula } });
      expect(codes(warnings)).toContain('CONFIG_BMR_FORMULA_OVERESTIMATES');
    }
    expect(codes(validate({ energy: { bmrFormula: 'mifflin' } }).warnings))
      .not.toContain('CONFIG_BMR_FORMULA_OVERESTIMATES');
  });

  it("'custom' without customBmrKcal is an error", () => {
    expect(codes(validate({ energy: { bmrFormula: 'custom' } }).errors)).toContain('CONFIG_CUSTOM_BMR_MISSING');
    expect(validate({ energy: { bmrFormula: 'custom', customBmrKcal: 1790 } }).valid).toBe(true);
  });

  it('a bodyComp mode without a value is an error', () => {
    expect(codes(validate({ profile: { bodyComp: { mode: 'ffm', value: null } } }).errors))
      .toContain('CONFIG_BODY_COMP_VALUE_MISSING');
  });

  it.each([['bodyFatPct', 80], ['bodyFatPct', 0], ['ffm', 250]])('%s = %i is out of range', (mode, value) => {
    expect(codes(validate({ profile: { bodyComp: { mode, value } } }).errors)).toContain('CONFIG_OUT_OF_RANGE');
  });
});

describe('field-level validation', () => {
  it.each([
    ['units.mass', 'stones', 'CONFIG_UNKNOWN_ENUM'],
    ['profile.sex', 'other', 'CONFIG_UNKNOWN_ENUM'],
    ['profile.heightCm', 20, 'CONFIG_OUT_OF_RANGE'],
    ['profile.birthDate', 'yesterday', 'CONFIG_NOT_A_DATE'],
    ['calibration.windowDays', 21.5, 'CONFIG_NOT_AN_INTEGER'],
    ['calibration.trendMethod', 'kalman', 'CONFIG_UNKNOWN_ENUM'],
    ['calibration.energyDensityKcalPerKg', 'lots', 'CONFIG_NOT_A_NUMBER'],
    ['intake.fiberInCarbs', 'yes', 'CONFIG_NOT_A_BOOLEAN'],
    ['locale', 7, 'CONFIG_NOT_A_STRING'],
    ['flags.rhrBaseline', 'sometimes', 'CONFIG_NOT_A_NUMBER'],
  ])('%s = %o -> %s', (path, value, code) => {
    const { valid, errors } = validate(nest(path, value));
    expect(valid).toBe(false);
    expect(errors.find((e) => e.path === path).code).toBe(code);
  });

  it('rhrBaseline accepts both auto and a concrete bpm value', () => {
    expect(validate({ flags: { rhrBaseline: 'auto' } }).valid).toBe(true);
    expect(validate({ flags: { rhrBaseline: 52.7 } }).valid).toBe(true);
  });

  it('the calibration window may not be shorter than minDays', () => {
    const { errors } = validate({ calibration: { windowDays: 10, minDays: 14 } });
    expect(codes(errors)).toContain('CONFIG_WINDOW_BELOW_MIN_DAYS');
  });

  it.each([[[1.3, 0.7]], [[0.7]], [[1.1, 1.3]], [['a', 'b']]])('rejects factorClamp %o', (clamp) => {
    expect(codes(validate({ calibration: { factorClamp: clamp } }).errors)).toContain('CONFIG_CLAMP_INVALID');
  });

  it('cycleAwareSmoothing forces a 28-day window', () => {
    const { normalized, warnings } = validate({ calibration: { cycleAwareSmoothing: true } });
    expect(normalized.calibration.windowDays).toBe(28);
    expect(codes(warnings)).toContain('CONFIG_CYCLE_WINDOW_FORCED');
  });

  it('an unusual fiber Atwater factor warns but is allowed', () => {
    expect(codes(validate({ intake: { atwater: { fiber: 3 } } }).warnings)).toContain('CONFIG_FIBER_ATWATER_UNUSUAL');
    expect(codes(validate({ intake: { atwater: { fiber: 4 } } }).warnings)).not.toContain('CONFIG_FIBER_ATWATER_UNUSUAL');
  });

  it('the daily ledger correction may not exceed the ledger cap', () => {
    expect(codes(validate({ ledger: { maxDailyCorrectionKcal: 250, capKcal: 200 } }).errors))
      .toContain('CONFIG_LEDGER_CORRECTION_ABOVE_CAP');
  });
});

describe('device eras', () => {
  const eras = (list) => validate({ history: { deviceEras: list } });

  it('accepts an ordered, gapless, open-ended list', () => {
    expect(eras([
      { from: '2022-01-01', to: '2024-01-01', label: 'Fenix 6' },
      { from: '2024-01-01', to: null, label: 'Fenix 7' },
    ]).valid).toBe(true);
  });

  it.each([
    [[{ from: '2024-01-01', to: '2023-01-01' }], 'CONFIG_ERA_REVERSED'],
    [[{ from: '2024-01-01', to: '2025-01-01' }, { from: '2023-01-01', to: null }], 'CONFIG_ERA_UNORDERED'],
    [[{ from: '2022-01-01', to: '2024-06-01' }, { from: '2024-01-01', to: null }], 'CONFIG_ERA_OVERLAP'],
    [[{ from: '2022-01-01', to: null }, { from: '2024-01-01', to: null }], 'CONFIG_ERA_OVERLAP'],
    [[{ from: 'whenever', to: null }], 'CONFIG_NOT_A_DATE'],
  ])('rejects %o with %s', (list, code) => {
    expect(codes(eras(list).errors)).toContain(code);
  });

  it('rejects a non-array', () => {
    expect(codes(eras('Fenix 7').errors)).toContain('CONFIG_NOT_AN_ARRAY');
  });

  it('validates training-context periods the same way', () => {
    const bad = validate({ history: { trainingContext: { periods: [{ from: '2026-03-01', to: 'soon' }] } } });
    expect(codes(bad.errors)).toContain('CONFIG_NOT_A_DATE');
  });
});

describe('units are display-only (test 7)', () => {
  it.each([
    [89.5, 'lb'], [0, 'lb'], [173, 'in'],
  ])('%f roundtrips through %s', (value, unit) => {
    const to = unit === 'lb' ? massToKg : heightToCm;
    const from = unit === 'lb' ? massFromKg : heightFromCm;
    expect(to(from(value, unit), unit)).toBeCloseTo(value, 10);
  });

  it('converts the reference athlete without loss', () => {
    expect(massToKg(massFromKg(89.5, 'lb'), 'lb')).toBeCloseTo(89.5, 10);
    expect(massFromKg(89.5, 'lb')).toBeCloseTo(197.31, 2);
    expect(heightFromCm(173, 'in')).toBeCloseTo(68.11, 2);
    expect(energyFromKcal(2334, 'kJ')).toBeCloseTo(9765.5, 1);
    expect(energyToKcal(energyFromKcal(2334, 'kJ'), 'kJ')).toBeCloseTo(2334, 10);
  });

  it('SI units are the identity', () => {
    expect(massToKg(89.5, 'kg')).toBe(89.5);
    expect(heightToCm(173, 'cm')).toBe(173);
    expect(energyToKcal(2334, 'kcal')).toBe(2334);
  });
});

describe('assertValid', () => {
  it('returns the normalized config when valid', () => {
    expect(assertValid({}).calibration.windowDays).toBe(21);
  });

  it('throws with the offending paths and codes', () => {
    expect(() => assertValid({ profile: { sex: 'other' } }))
      .toThrow(/invalid nutrition config — profile\.sex: CONFIG_UNKNOWN_ENUM/);
  });
});

function nest(path, value) {
  return path.split('.').reverse().reduce((acc, key) => ({ [key]: acc }), value);
}
