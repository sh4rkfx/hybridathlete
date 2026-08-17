// Regression, EMA and outlier rejection (kickoff step 2). Deterministic
// fixtures throughout — no Math.random, no wall clock.
import { describe, it, expect } from 'vitest';
import {
  daysBetween, toSeries, linreg, median, madOutliers, emaSmooth, maxGapDays, weightTrend,
  MAD_TO_SIGMA, MEANAD_TO_SIGMA,
} from '../../src/nutrition/trend.js';

const DAY = '2026-07-';
const iso = (day) => `${DAY}${String(day).padStart(2, '0')}`;
// 21 days falling at exactly 0.0649 kg/day — a 500 kcal deficit at 7700 kcal/kg.
const TRUE_SLOPE = -0.0649;
const clean = Array.from({ length: 21 }, (_, i) => ({ date: iso(i + 1), weightKg: 89.5 + TRUE_SLOPE * i }));

describe('series construction', () => {
  it('x is days since the first sample, not the sample index', () => {
    const series = toSeries([
      { date: iso(1), weightKg: 90 }, { date: iso(3), weightKg: 89 }, { date: iso(10), weightKg: 88 },
    ]);
    expect(series.map((p) => p.x)).toEqual([0, 2, 9]);
  });

  it('sorts by date and drops unusable samples', () => {
    const series = toSeries([
      { date: iso(5), weightKg: 88 }, { date: iso(1), weightKg: 90 },
      { date: iso(3), weightKg: null }, { date: iso(4) }, null, { weightKg: 87 },
    ]);
    expect(series.map((p) => p.date)).toEqual([iso(1), iso(5)]);
  });

  it('reads an alternative value key', () => {
    expect(toSeries([{ date: iso(1), kcal: 2400 }], 'kcal')[0].y).toBe(2400);
  });

  it('handles empty input', () => {
    expect(toSeries([])).toEqual([]);
    expect(toSeries(null)).toEqual([]);
  });

  it('daysBetween ignores the time of day', () => {
    expect(daysBetween('2026-07-01T23:00:00', '2026-07-03T01:00:00')).toBe(2);
  });
});

describe('linreg', () => {
  it('recovers a known slope and intercept exactly', () => {
    const fit = linreg([{ x: 0, y: 10 }, { x: 1, y: 12 }, { x: 2, y: 14 }]);
    expect(fit).toMatchObject({ slope: 2, intercept: 10, r2: 1, n: 3 });
  });

  it('matches a hand-computed fit on scattered data', () => {
    // x = 0,1,2,3  y = 1,3,2,5
    // Sxy = 5.5, Sxx = 5 -> slope 1.1; intercept = 2.75 - 1.1*1.5 = 1.1
    // SSres = 2.70, SStot = 8.75 -> r2 = 1 - 2.70/8.75
    const fit = linreg([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 5 }]);
    expect(fit.slope).toBeCloseTo(1.1, 10);
    expect(fit.intercept).toBeCloseTo(1.1, 10);
    expect(fit.r2).toBeCloseTo(1 - 2.70 / 8.75, 10);
  });

  it('returns nulls rather than NaN for 0 and 1 points', () => {
    expect(linreg([])).toMatchObject({ slope: null, intercept: null, r2: null, n: 0 });
    expect(linreg([{ x: 0, y: 5 }])).toMatchObject({ slope: null, intercept: 5, n: 1 });
    expect(linreg(undefined)).toMatchObject({ slope: null, n: 0 });
  });

  it('has no slope when every sample is from the same day', () => {
    expect(linreg([{ x: 0, y: 80 }, { x: 0, y: 81 }])).toMatchObject({ slope: null, intercept: 80.5 });
  });

  it('calls a flat series a perfect fit', () => {
    expect(linreg([{ x: 0, y: 80 }, { x: 1, y: 80 }])).toMatchObject({ slope: 0, r2: 1 });
  });
});

describe('regression beats last-minus-first (the reason it exists)', () => {
  it('a water swing on the endpoints wrecks the difference and barely moves the fit', () => {
    // -0.5 kg on day 1, +0.5 kg on day 21: both within normal daily fluctuation
    const swung = clean.map((d, i) => ({
      ...d, weightKg: d.weightKg + (i === 0 ? -0.5 : i === 20 ? 0.5 : 0),
    }));
    const endpointSlope = (swung.at(-1).weightKg - swung[0].weightKg) / 20;
    const fitted = weightTrend(swung, { outlier: { method: 'none' } }).slopeKgPerDay;

    const asKcal = (slope) => Math.abs(slope - TRUE_SLOPE) * 7700;
    expect(asKcal(endpointSlope)).toBeGreaterThan(350); // hundreds of kcal wrong
    expect(asKcal(fitted)).toBeLessThan(120);
    expect(asKcal(fitted)).toBeLessThan(asKcal(endpointSlope) / 3);
  });

  it('alternating daily noise averages out over the window', () => {
    const noisy = clean.map((d, i) => ({ ...d, weightKg: d.weightKg + (i % 2 ? 0.5 : -0.5) }));
    expect(weightTrend(noisy).slopeKgPerDay).toBeCloseTo(TRUE_SLOPE, 3);
  });
});

describe('MAD outlier rejection', () => {
  it('flags a single bad reading and keeps the rest', () => {
    const spiked = clean.map((d, i) => (i === 10 ? { ...d, weightKg: d.weightKg + 3 } : d));
    const result = weightTrend(spiked);
    expect(result.nExcluded).toBe(1);
    expect(result.excluded[0].date).toBe(iso(11));
    expect(result.nUsed).toBe(20);
    expect(result.slopeKgPerDay).toBeCloseTo(TRUE_SLOPE, 6);
  });

  it('runs on residuals, not raw values — a real trend is not an outlier', () => {
    // Raw MAD over a falling series would reject both ends and keep the middle.
    expect(weightTrend(clean).nExcluded).toBe(0);
    expect(madOutliers(toSeries(clean), 3)).toEqual([]);
  });

  it('a zero MAD falls back to the mean absolute deviation', () => {
    // Near-perfect series with one bad reading: over half the residuals are
    // identical, so the MAD is 0 and the naive guard would find nothing.
    const points = toSeries(clean.map((d, i) => (i === 10 ? { ...d, weightKg: d.weightKg + 3 } : d)));
    expect(median(points.map((p) => Math.abs(p.y - p.y)))).toBe(0);
    expect(madOutliers(points, 3)).toEqual([10]);
    expect(MEANAD_TO_SIGMA).toBeCloseTo(Math.sqrt(Math.PI / 2), 3);
    expect(MAD_TO_SIGMA).toBeCloseTo(1.4826, 4);
  });

  it('finds nothing when every value is identical', () => {
    const flat = Array.from({ length: 10 }, (_, i) => ({ date: iso(i + 1), weightKg: 80 }));
    expect(weightTrend(flat)).toMatchObject({ nExcluded: 0, slopeKgPerDay: 0, r2: 1 });
  });

  it('needs at least four points before rejecting anything', () => {
    expect(madOutliers(toSeries(clean.slice(0, 3)), 3)).toEqual([]);
  });

  it('a looser threshold rejects less', () => {
    const spiked = clean.map((d, i) => (i === 10 ? { ...d, weightKg: d.weightKg + 3 } : d));
    expect(weightTrend(spiked, { outlier: { method: 'mad', threshold: 30 } }).nExcluded).toBe(0);
  });

  it("outlier method 'none' disables rejection entirely", () => {
    const spiked = clean.map((d, i) => (i === 10 ? { ...d, weightKg: d.weightKg + 3 } : d));
    expect(weightTrend(spiked, { outlier: { method: 'none' } }).nExcluded).toBe(0);
  });
});

describe('EMA', () => {
  it('does not attenuate a known slope — the seeded-start fix', () => {
    // Seeding at the raw first sample yields ~-0.0394 here, a 40 % shortfall
    // and ~200 kcal/day of phantom TDEE. The steady-state seed removes it.
    expect(weightTrend(clean, { method: 'ema', emaHalfLifeDays: 7 }).slopeKgPerDay)
      .toBeCloseTo(TRUE_SLOPE, 6);
  });

  it.each([3, 7, 14, 21])('is unbiased at any half-life (%i days)', (halfLife) => {
    expect(weightTrend(clean, { method: 'ema', emaHalfLifeDays: halfLife }).slopeKgPerDay)
      .toBeCloseTo(TRUE_SLOPE, 6);
  });

  it('damps daily noise more than the raw series does', () => {
    const noisy = clean.map((d, i) => ({ ...d, weightKg: d.weightKg + (i % 2 ? 0.4 : -0.4) }));
    const smoothed = emaSmooth(toSeries(noisy), 7);
    const spread = (pts) => Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(spread(smoothed)).toBeLessThan(spread(toSeries(noisy)));
  });

  it('decays by elapsed time, not by sample count', () => {
    const gappy = [{ x: 0, y: 100 }, { x: 30, y: 0 }];
    const [, second] = emaSmooth(gappy, 1);
    // 30 half-lives later the previous value has essentially no weight left
    expect(second.y).toBeCloseTo(0, 6);
  });

  it('is a no-op for a non-positive half-life', () => {
    const points = toSeries(clean);
    expect(emaSmooth(points, 0)).toEqual(points);
    expect(emaSmooth(points, null)).toEqual(points);
    expect(emaSmooth([], 7)).toEqual([]);
  });
});

describe('gaps and degenerate windows', () => {
  it('measures the largest run of missing days', () => {
    expect(maxGapDays(toSeries([{ date: iso(1), weightKg: 90 }, { date: iso(5), weightKg: 89 }]))).toBe(3);
    expect(maxGapDays(toSeries([{ date: iso(1), weightKg: 90 }, { date: iso(2), weightKg: 89 }]))).toBe(0);
    expect(maxGapDays([])).toBe(0);
  });

  it('a gap in the middle of the window does not distort the slope', () => {
    // days 1-5 and 14-21 present, 6-13 missing: an eight-day hole
    const gappy = clean.filter((_d, i) => i < 5 || i > 12);
    expect(weightTrend(gappy).slopeKgPerDay).toBeCloseTo(TRUE_SLOPE, 6);
    expect(weightTrend(gappy).maxGapDays).toBe(8);
  });

  it.each([[[]], [[{ date: iso(1), weightKg: 90 }]]])('0 or 1 samples give a null slope, not NaN', (samples) => {
    const result = weightTrend(samples);
    expect(result.slopeKgPerDay).toBeNull();
    expect(result.nUsed).toBe(samples.length);
  });

  it('reports the span it actually covered', () => {
    expect(weightTrend(clean).spanDays).toBe(20);
  });

  it('gives up cleanly when rejection leaves fewer than two points', () => {
    const result = weightTrend(
      [{ date: iso(1), weightKg: 90 }, { date: iso(2), weightKg: 90 },
        { date: iso(3), weightKg: 90 }, { date: iso(4), weightKg: 91 },
        { date: iso(5), weightKg: 90 }],
      { outlier: { method: 'mad', threshold: 0.01 } },
    );
    expect(result.nUsed).toBeLessThan(2);
    expect(result.slopeKgPerDay).toBeNull();
    expect(result.excluded.length).toBe(result.nExcluded);
  });

  it('a four-point window resists rejection — the MAD breakdown point', () => {
    // One wild value among four drags the first-pass fit far enough that its
    // own residual no longer stands out. Documented, not a bug: robust scale
    // estimators need more than a handful of points, which is also why
    // calibration.minDays exists.
    const result = weightTrend([
      { date: iso(1), weightKg: 90 }, { date: iso(2), weightKg: 90 },
      { date: iso(3), weightKg: 90 }, { date: iso(4), weightKg: 200 },
    ]);
    expect(result.nExcluded).toBe(0);
  });
});

describe('median', () => {
  it.each([[[3, 1, 2], 2], [[4, 1, 3, 2], 2.5], [[5], 5]])('median(%o) = %f', (values, expected) => {
    expect(median(values)).toBe(expected);
  });

  it('ignores non-finite values and returns null when nothing is left', () => {
    expect(median([1, NaN, 3, null, undefined])).toBe(2);
    expect(median([])).toBeNull();
  });
});
