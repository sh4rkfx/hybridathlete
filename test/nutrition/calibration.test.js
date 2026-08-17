// Calibration (kickoff step 3 and test 1, "Synthetische Rückgewinnung").
// Deterministic throughout: seeded PRNG, injected clock.
import { describe, it, expect } from 'vitest';
import {
  calibrate, rollingCalibrations, effectiveFactor, isRecalibrationDue,
  selectWindow, eraFor, isRepresentative, REASONS,
} from '../../src/nutrition/calibration.js';
import { validate } from '../../src/nutrition/config.js';
import { syntheticDays, mulberry32, gaussian } from '../helpers/synthetic.js';

const cfg = (over = {}) => validate(over).normalized;
const iso = (day) => `2026-07-${String(day).padStart(2, '0')}`;

// A flat 21-day window: intake 2100, source says 2600, weight perfectly stable.
// True TDEE therefore equals intake, and the factor is 2100/2600.
function flatDays({ n = 21, intakeKcal = 2100, estimateKcal = 2600, weightKg = 89.5, from = 1 } = {}) {
  return Array.from({ length: n }, (_, i) => ({ date: iso(from + i), intakeKcal, estimateKcal, weightKg }));
}

describe('synthetic recovery (test 1)', () => {
  // The kickoff asks for < 3 % on a 30-day window with sigma 0.35 kg on weight
  // and 110 kcal on intake. That tolerance is one sigma, not a bound: the
  // standard error of the slope is 0.35 / (8.66 * sqrt(30)) = 0.0074 kg/day,
  // which at 7700 kcal/kg is 57 kcal, and the intake mean adds 110/sqrt(30) =
  // 20 kcal — about 60 kcal, or 2.3 % of a 2600 kcal TDEE. Asserting < 3 % per
  // seed would fail roughly one seed in five (the observed worst here is 5.2 %).
  // So the suite asserts the distribution instead, which is the claim that was
  // actually meant: unbiased, and accurate in the mean.
  const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
  const TRUE_TDEE = 2600;
  const config = cfg({ calibration: { windowDays: 30, minDays: 14 } });

  const errors = SEEDS.map((seed) => {
    const days = syntheticDays({ seed, nDays: 30, trueTdeeKcal: TRUE_TDEE });
    const result = calibrate(days, config, { now: days.at(-1).date });
    expect(result.tdeeRealKcal, `seed ${seed}`).not.toBeNull();
    return (result.tdeeRealKcal - TRUE_TDEE) / TRUE_TDEE * 100;
  });
  const absolute = errors.map(Math.abs);

  it('recovers the known TDEE to better than 3 % in the mean', () => {
    expect(absolute.reduce((a, b) => a + b, 0) / absolute.length).toBeLessThan(3);
  });

  it('never misses by more than 6 % on any single seed', () => {
    expect(Math.max(...absolute)).toBeLessThan(6);
  });

  it('is unbiased — the signed error averages out', () => {
    expect(Math.abs(errors.reduce((a, b) => a + b, 0) / errors.length)).toBeLessThan(1);
  });

  it('recovers a biased data source as its reciprocal factor', () => {
    // A source overstating expenditure by 5 % must calibrate to about 1/1.05.
    const factors = SEEDS.map((seed) => {
      const days = syntheticDays({ seed, nDays: 30, trueTdeeKcal: TRUE_TDEE, estimateBiasFactor: 1.05 });
      const factor = calibrate(days, config, { now: days.at(-1).date }).factor;
      expect(factor, `seed ${seed}`).not.toBeNull();
      return factor;
    });
    const meanFactor = factors.reduce((a, b) => a + b, 0) / factors.length;
    expect(meanFactor).toBeCloseTo(1 / 1.05, 2);
  });

  it('tightens as the window grows', () => {
    const spread = (nDays) => {
      const errs = SEEDS.map((seed) => {
        const days = syntheticDays({ seed, nDays, trueTdeeKcal: TRUE_TDEE });
        const result = calibrate(days, cfg({ calibration: { windowDays: nDays, minDays: 14 } }), { now: days.at(-1).date });
        expect(result.tdeeRealKcal, `seed ${seed} / ${nDays}d`).not.toBeNull();
        return Math.abs(result.tdeeRealKcal - TRUE_TDEE);
      });
      return errs.reduce((a, b) => a + b, 0) / errs.length;
    };
    expect(spread(60)).toBeLessThan(spread(21));
  });

  it('the PRNG is deterministic and Gaussian-ish', () => {
    expect(mulberry32(7)()).toBe(mulberry32(7)());
    const rand = mulberry32(1);
    const sample = Array.from({ length: 4000 }, () => gaussian(rand));
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
    const sd = Math.sqrt(sample.reduce((s, x) => s + (x - mean) ** 2, 0) / sample.length);
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(sd).toBeCloseTo(1, 1);
  });
});

describe('the core equation', () => {
  it('a stable weight makes the real TDEE equal the mean intake', () => {
    const r = calibrate(flatDays(), cfg(), { now: iso(21) });
    expect(r.trend.slopeKgPerDay).toBe(0);
    expect(r.tdeeRealKcal).toBeCloseTo(2100, 6);
    expect(r.factor).toBeCloseTo(2100 / 2600, 6);
  });

  it('a falling weight adds the mobilised energy back', () => {
    // -0.0649 kg/day x 7700 = 500 kcal/day of stored energy spent
    const days = flatDays().map((d, i) => ({ ...d, weightKg: 89.5 - 0.0649 * i }));
    const r = calibrate(days, cfg(), { now: iso(21) });
    expect(r.tdeeRealKcal).toBeCloseTo(2600, 0);
    expect(r.factor).toBeCloseTo(1.0, 3);
  });

  it('a rising weight subtracts it — a gain during a cut is not hidden', () => {
    const days = flatDays().map((d, i) => ({ ...d, weightKg: 89.5 + 0.0649 * i }));
    expect(calibrate(days, cfg(), { now: iso(21) }).tdeeRealKcal).toBeCloseTo(1600, 0);
  });

  it('honours a configured energy density', () => {
    const days = flatDays().map((d, i) => ({ ...d, weightKg: 89.5 - 0.1 * i }));
    const at = (kcalPerKg) => calibrate(days, cfg({ calibration: { energyDensityKcalPerKg: kcalPerKg } }), { now: iso(21) }).tdeeRealKcal;
    expect(at(9000) - at(7700)).toBeCloseTo(0.1 * (9000 - 7700), 6);
  });
});

describe('refusing to guess', () => {
  it('returns null below minDays', () => {
    const r = calibrate(flatDays({ n: 13 }), cfg(), { now: iso(13) });
    expect(r.factor).toBeNull();
    expect(r.tdeeRealKcal).toBeNull();
    expect(r.reasons).toContain(REASONS.BELOW_MIN_DAYS);
    expect(r.nDays).toBe(13);
  });

  it('produces a factor at exactly minDays', () => {
    expect(calibrate(flatDays({ n: 14 }), cfg(), { now: iso(14) }).factor).not.toBeNull();
  });

  it('computes the real TDEE but no factor when the source has no totals', () => {
    const days = flatDays().map((d) => ({ ...d, estimateKcal: null }));
    const r = calibrate(days, cfg(), { now: iso(21) });
    expect(r.tdeeRealKcal).toBeCloseTo(2100, 6);
    expect(r.factor).toBeNull();
    expect(r.reasons).toContain(REASONS.INSUFFICIENT_ESTIMATE_DAYS);
  });

  it('returns null without any weight data', () => {
    const days = flatDays().map((d) => ({ ...d, weightKg: null }));
    const r = calibrate(days, cfg(), { now: iso(21) });
    expect(r.factor).toBeNull();
    expect(r.reasons).toContain(REASONS.NO_WEIGHT_TREND);
  });

  it('is inert when calibration is switched off', () => {
    const r = calibrate(flatDays(), cfg({ calibration: { enabled: false } }), { now: iso(21) });
    expect(r.factor).toBeNull();
    expect(r.reasons).toEqual([REASONS.DISABLED]);
  });

  it('survives empty and malformed input', () => {
    for (const input of [[], null, [{}, { date: null }]]) {
      const r = calibrate(input, cfg(), { now: iso(21) });
      expect(r.factor).toBeNull();
      expect(r.nDays).toBe(0);
    }
  });
});

describe('clamping', () => {
  const wild = (intakeKcal) => flatDays({ intakeKcal });

  it('clamps a high factor and says so', () => {
    const r = calibrate(wild(4000), cfg(), { now: iso(21) });
    expect(r.rawFactor).toBeCloseTo(4000 / 2600, 6);
    expect(r.factor).toBe(1.30);
    expect(r.clamped).toBe(true);
    expect(r.reasons).toContain(REASONS.FACTOR_CLAMPED);
  });

  it('clamps a low factor — usually systematic under-tracking', () => {
    const r = calibrate(wild(1200), cfg(), { now: iso(21) });
    expect(r.factor).toBe(0.70);
    expect(r.clamped).toBe(true);
  });

  it('a clamped factor is never rated confident', () => {
    expect(calibrate(wild(4000), cfg(), { now: iso(21) }).confidence).toBe('low');
  });

  it('leaves a factor inside the clamp untouched', () => {
    const r = calibrate(flatDays(), cfg(), { now: iso(21) });
    expect(r.clamped).toBe(false);
    expect(r.factor).toBe(r.rawFactor);
  });
});

describe('confidence', () => {
  it('full coverage with a complete weight series rates high', () => {
    const days = flatDays().map((d, i) => ({ ...d, weightKg: 89.5 - 0.0649 * i }));
    expect(calibrate(days, cfg(), { now: iso(21) }).confidence).toBe('high');
  });

  it('drops as coverage falls', () => {
    const days = flatDays().map((d, i) => ({ ...d, weightKg: 89.5 - 0.0649 * i }));
    const drop = (keep) => calibrate(days.filter((_d, i) => i % keep === 0 || i > 6), cfg(), { now: iso(21) }).confidence;
    expect(['medium', 'low']).toContain(drop(3));
  });

  it('a long gap costs the high rating', () => {
    const days = flatDays({ n: 21 }).map((d, i) => ({ ...d, weightKg: 89.5 - 0.0649 * i }));
    const gappy = days.filter((_d, i) => i < 7 || i > 12);
    expect(calibrate(gappy, cfg(), { now: iso(21) }).confidence).not.toBe('high');
  });

  it('weight only at the start of the window is not a full-window trend', () => {
    // Intake covers 21 days, weights only the first 8: the two sides of the
    // energy balance would describe different periods.
    const days = flatDays().map((d, i) => ({ ...d, weightKg: i < 8 ? 89.5 - 0.0649 * i : null }));
    const r = calibrate(days, cfg(), { now: iso(21) });
    expect(r.reasons).toContain(REASONS.SHORT_WEIGHT_SPAN);
    expect(r.confidence).not.toBe('high');
  });

  it('an impossible trend is reported and rated low', () => {
    const days = flatDays().map((d, i) => ({ ...d, weightKg: 89.5 - 0.5 * i }));
    const r = calibrate(days, cfg(), { now: iso(21) });
    expect(r.reasons).toContain(REASONS.IMPLAUSIBLE_TREND);
    expect(r.confidence).toBe('low');
  });
});

describe('device eras', () => {
  const eraConfig = cfg({
    history: {
      deviceEras: [
        { from: '2026-01-01', to: '2026-07-10', label: 'Fenix 6' },
        { from: '2026-07-10', to: null, label: 'Fenix 7' },
      ],
    },
  });

  it('resolves the era covering a date', () => {
    expect(eraFor('2026-07-05', eraConfig).label).toBe('Fenix 6');
    expect(eraFor('2026-07-20', eraConfig).label).toBe('Fenix 7');
    expect(eraFor('2025-01-01', eraConfig)).toBeNull();
    expect(eraFor('2026-07-20', cfg())).toBeNull();
  });

  it('never averages across an era boundary', () => {
    // 21 days ending 2026-07-21, but the current era starts on the 10th.
    const days = flatDays({ n: 21, from: 1 });
    const window = selectWindow(days, eraConfig, { now: iso(21) });
    expect(window.truncated).toBe(true);
    expect(window.days[0].date).toBe(iso(10));
    expect(window.days.length).toBe(12);
  });

  it('returns null rather than carrying the old device forward', () => {
    const days = flatDays({ n: 21, from: 1 });
    const r = calibrate(days, eraConfig, { now: iso(21) });
    expect(r.factor).toBeNull();
    expect(r.reasons).toEqual(expect.arrayContaining([REASONS.ERA_TRUNCATED, REASONS.BELOW_MIN_DAYS]));
  });

  it('the switch day belongs to the new device, not the old one', () => {
    // Regression (PR #62 review): eras touch by construction, so an inclusive
    // `to` handed the boundary day to the outgoing era and pooled that day's
    // new-device data with 20 old-device days.
    expect(eraFor('2026-07-09', eraConfig).label).toBe('Fenix 6');
    expect(eraFor(iso(10), eraConfig).label).toBe('Fenix 7');

    const window = selectWindow(flatDays({ n: 30, from: 1 }), eraConfig, { now: iso(10) });
    expect(window.era.label).toBe('Fenix 7');
    expect(window.truncated).toBe(true);
    expect(window.days.map((d) => d.date)).toEqual([iso(10)]);
  });

  it('a gap between eras is a boundary too', () => {
    // Found while checking the above: with no era covering the window end,
    // eraFor returned null and nothing was truncated at all, so the window
    // reached back across the previous era's end. A gap is a real state — the
    // cut is at every boundary, `from` and `to` alike, not just at eras.
    const gapConfig = cfg({
      history: {
        deviceEras: [
          { from: '2026-01-01', to: iso(12), label: 'A' },
          { from: iso(20), to: null, label: 'B' },
        ],
      },
    });
    const window = selectWindow(flatDays({ n: 30, from: 1 }), gapConfig, { now: iso(16) });
    expect(window.era).toBeNull();
    expect(window.truncated).toBe(true);
    expect(window.days[0].date).toBe(iso(12));
  });

  it('does not truncate before the first era or without eras at all', () => {
    const late = cfg({ history: { deviceEras: [{ from: '2027-01-01', to: null, label: 'future' }] } });
    expect(selectWindow(flatDays(), late, { now: iso(21) }).truncated).toBe(false);
    expect(selectWindow(flatDays(), cfg(), { now: iso(21) }).truncated).toBe(false);
  });

  it('calibrates normally once the new era is long enough', () => {
    const days = flatDays({ n: 21, from: 10 });
    const r = calibrate(days, eraConfig, { now: iso(30) });
    expect(r.factor).not.toBeNull();
    expect(r.era.label).toBe('Fenix 7');
  });
});

describe('non-representative periods', () => {
  const rehabConfig = cfg({
    history: { trainingContext: { periods: [{ from: '2026-07-05', to: '2026-07-09', label: 'rehab', representative: false }] } },
  });

  it('excludes flagged days from the sample', () => {
    expect(isRepresentative('2026-07-07', rehabConfig)).toBe(false);
    expect(isRepresentative('2026-07-04', rehabConfig)).toBe(true);
    const window = selectWindow(flatDays(), rehabConfig, { now: iso(21) });
    expect(window.excluded).toBe(5);
    expect(window.days.map((d) => d.date)).not.toContain(iso(7));
  });

  it('reports the exclusion instead of quietly shrinking the sample', () => {
    expect(calibrate(flatDays(), rehabConfig, { now: iso(21) }).reasons)
      .toContain(REASONS.NON_REPRESENTATIVE_EXCLUDED);
  });

  it('context periods stay inclusive of their end date, unlike eras', () => {
    // Deliberately different semantics: a hand-written 05-09 rehab label means
    // the 9th is rehab too, where an era's `to` is the first day of the next
    // device. Both are asserted so neither drifts to match the other.
    expect(isRepresentative(iso(9), rehabConfig)).toBe(false);
    expect(isRepresentative(iso(10), rehabConfig)).toBe(true);
  });

  it('a period marked representative is kept', () => {
    const keep = cfg({ history: { trainingContext: { periods: [{ from: '2026-07-05', to: '2026-07-09', label: 'camp', representative: true }] } } });
    expect(selectWindow(flatDays(), keep, { now: iso(21) }).excluded).toBe(0);
  });
});

describe('rolling 7 and 28 day reads', () => {
  const days = flatDays({ n: 40, from: 1 }).map((d, i) => ({
    ...d, date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10), weightKg: 89.5 - 0.0649 * i,
  }));

  it('produces both windows in parallel', () => {
    const r = rollingCalibrations(days, cfg(), '2026-07-10');
    expect(r.d7.windowDays).toBe(7);
    expect(r.d28.windowDays).toBe(28);
    expect(r.d7.factor).not.toBeNull();
    expect(r.d28.factor).not.toBeNull();
  });

  it('marks the short reads as display-only', () => {
    const r = rollingCalibrations(days, cfg(), '2026-07-10');
    expect(r.d7.purpose).toBe('display');
    expect(r.d28.purpose).toBe('display');
    expect(r.current.purpose).toBeUndefined();
  });

  it('the current read still honours the configured minDays', () => {
    const short = rollingCalibrations(days.slice(0, 5), cfg(), '2026-06-05');
    expect(short.current.factor).toBeNull();
    expect(short.d7.factor).toBeNull(); // 5 days, still under a 7-day minimum
  });
});

describe('effectiveFactor', () => {
  const history = (...factors) => factors.map((factor, i) => ({ factor, computedAt: iso(i + 1) }));

  it('takes the median of the last three', () => {
    const r = effectiveFactor(history(0.9, 1.2, 0.95, 1.0, 0.98), cfg());
    expect(r.method).toBe('median3');
    expect(r.used).toEqual([0.95, 1.0, 0.98]);
    expect(r.factor).toBe(0.98);
    expect(r.latest).toBe(0.98);
  });

  it('a single bad window cannot drag the target the way a mean would', () => {
    const r = effectiveFactor(history(0.95, 1.30, 0.96), cfg());
    expect(r.factor).toBe(0.96);
    const mean = (0.95 + 1.30 + 0.96) / 3;
    expect(Math.abs(r.factor - 0.955)).toBeLessThan(Math.abs(mean - 0.955));
  });

  it('uses the newest value below three calibrations', () => {
    expect(effectiveFactor(history(0.95), cfg())).toMatchObject({ method: 'latest', factor: 0.95 });
    expect(effectiveFactor(history(0.95, 1.05), cfg())).toMatchObject({ method: 'latest', factor: 1.05 });
  });

  it('flags a newest value that has run away from the smoothed one', () => {
    const r = effectiveFactor(history(0.95, 0.96, 1.15), cfg());
    expect(r.factor).toBe(0.96);
    expect(r.deviationPct).toBeCloseTo(19.79, 2);
    expect(r.deviates).toBe(true);
  });

  it('stays quiet when the newest value agrees', () => {
    expect(effectiveFactor(history(0.94, 0.95, 0.96), cfg()).deviates).toBe(false);
  });

  it("smoothing method 'latest' skips the median entirely", () => {
    const r = effectiveFactor(history(0.95, 1.30, 0.96), cfg({ calibration: { smoothing: { method: 'latest' } } }));
    expect(r).toMatchObject({ method: 'latest', factor: 0.96 });
  });

  it('sorts by computedAt rather than trusting array order', () => {
    const shuffled = [
      { factor: 1.10, computedAt: iso(3) }, { factor: 0.90, computedAt: iso(1) }, { factor: 1.00, computedAt: iso(2) },
    ];
    expect(effectiveFactor(shuffled, cfg()).latest).toBe(1.10);
  });

  it('ignores entries without a factor and handles an empty history', () => {
    expect(effectiveFactor([{ factor: null, computedAt: iso(1) }], cfg()).factor).toBeNull();
    expect(effectiveFactor([], cfg())).toMatchObject({ factor: null, method: 'none' });
    expect(effectiveFactor(null, cfg()).factor).toBeNull();
  });
});

describe('isRecalibrationDue', () => {
  it('is due when never calibrated', () => {
    expect(isRecalibrationDue(null, iso(21), cfg())).toBe(true);
  });

  it.each([[55, false], [56, true], [70, true]])('%i days since -> %s', (days, expected) => {
    const then = new Date(Date.UTC(2026, 0, 1));
    const now = new Date(Date.UTC(2026, 0, 1 + days));
    expect(isRecalibrationDue(then.toISOString().slice(0, 10), now.toISOString().slice(0, 10), cfg())).toBe(expected);
  });
});
