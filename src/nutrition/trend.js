// Weight-trend estimation (kickoff step 2). Pure module: no IO, no globals.
//
// Why a regression and never last-minus-first: day-to-day water swings of
// +/- 0.5 kg are normal, and over a 21-day window a single unlucky pair of
// endpoints moves the implied trend by 1 kg / 21 d = 0.048 kg/day, which at
// 7700 kcal/kg is 367 kcal/day of phantom energy balance. The regression uses
// every point, so the same noise contributes at 1/sqrt(n).
//
// x is days since the first sample, NOT the sample index. Gaps in the middle of
// a window are then handled correctly by construction — a missing Wednesday
// must not pull Thursday a day closer to Tuesday.
import { dOnly } from '../engine/time.js';

const MS_PER_DAY = 86400000;

// Scale factor that makes the median absolute deviation a consistent estimator
// of sigma for normally distributed data, so an MAD threshold of 3 really is
// "three sigma".
export const MAD_TO_SIGMA = 1.4826;
// Same idea for the mean absolute deviation, sqrt(pi/2). Only used as a
// fallback when the MAD collapses to zero — see madOutliers().
export const MEANAD_TO_SIGMA = 1.2533;

export function daysBetween(from, to) {
  return (dOnly(to) - dOnly(from)) / MS_PER_DAY;
}

// Turns [{ date, <valueKey> }] into [{ x: days since first, y, date, index }],
// dropping entries without a finite value. Input order is not assumed.
export function toSeries(samples, valueKey = 'weightKg') {
  const usable = (samples ?? [])
    .filter((s) => s && s.date != null && Number.isFinite(s[valueKey]))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!usable.length) return [];
  const origin = usable[0].date;
  return usable.map((s, index) => ({ x: daysBetween(origin, s.date), y: s[valueKey], date: s.date, index }));
}

// Ordinary least squares. `slope` is per unit of x, i.e. per day for a series
// built by toSeries(). r2 is 1 for a series with no variance in y (a flat line
// is fitted exactly); it is null when the fit is undefined.
export function linreg(points) {
  const n = points?.length ?? 0;
  if (n < 2) return { slope: null, intercept: n === 1 ? points[0].y : null, r2: null, n };

  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - meanX) ** 2;
    sxy += (p.x - meanX) * (p.y - meanY);
  }
  // Every sample on the same day: no slope is defined.
  if (sxx === 0) return { slope: null, intercept: meanY, r2: null, n };

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    ssRes += (p.y - (intercept + slope * p.x)) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, n };
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Outlier detection runs on the RESIDUALS of a first-pass fit, not on the raw
// weights. On a real cut the weight series trends downward by design, so a MAD
// over the raw values would flag both ends of the window as outliers and keep
// the middle — exactly backwards. Returns the indices into `points`.
export function madOutliers(points, threshold = 3) {
  if (!points || points.length < 4) return [];
  const fit = linreg(points);
  if (fit.slope == null) return [];

  const residuals = points.map((p) => p.y - (fit.intercept + fit.slope * p.x));
  const centre = median(residuals);
  const deviations = residuals.map((r) => Math.abs(r - centre));
  const mad = median(deviations);

  // A zero MAD means more than half the residuals are identical — which is what
  // a near-perfect series with one bad reading looks like, precisely the case
  // we most want to catch. Fall back to the mean absolute deviation, which only
  // vanishes when every residual is identical and there is genuinely no scale.
  const scale = mad ? MAD_TO_SIGMA * mad : MEANAD_TO_SIGMA * (deviations.reduce((a, b) => a + b, 0) / deviations.length);
  if (!scale) return [];

  const limit = threshold * scale;
  return points.reduce((out, _p, i) => {
    if (deviations[i] > limit) out.push(i);
    return out;
  }, []);
}

// Exponentially weighted smoothing over irregularly spaced samples: the weight
// of the previous value decays with the actual elapsed time, so a three-day gap
// discounts it three days' worth rather than one step's worth.
//
// The seed matters more than it looks. An EMA applied to a linear trend settles
// on y(t - tau), lagging by tau = (1 - alpha) / alpha days. Starting it at the
// first raw sample puts it tau days' worth of trend away from where the steady
// state wants it, and over a window only three half-lives long that transient
// never decays — it eats the slope. Measured on a clean 21-day series falling
// 0.0649 kg/day, seeding at y[0] recovers only 0.0394 kg/day: a 40 % shortfall,
// worth about 200 kcal/day of phantom TDEE, and biased in the same direction
// every time. So the series is seeded at the steady-state value implied by a
// first-pass OLS fit, which reproduces the slope exactly on clean data.
// (Zero-phase forward-backward filtering was measured too and is worse over a
// window this short — both ends get pulled toward the interior.)
export function emaSmooth(points, halfLifeDays) {
  if (!points?.length) return [];
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return points.map((p) => ({ ...p }));

  const fit = linreg(points);
  const alphaPerDay = 1 - 2 ** (-1 / halfLifeDays);
  const lagDays = (1 - alphaPerDay) / alphaPerDay;
  const seed = fit.slope == null ? points[0].y : points[0].y - fit.slope * lagDays;

  const out = [{ ...points[0], y: seed }];
  for (let i = 1; i < points.length; i++) {
    const dt = Math.abs(points[i].x - points[i - 1].x);
    const alpha = 1 - 2 ** (-dt / halfLifeDays);
    out.push({ ...points[i], y: out[i - 1].y + alpha * (points[i].y - out[i - 1].y) });
  }
  return out;
}

// Largest run of consecutive missing days inside a series, used by the
// calibration confidence rating. Two samples one day apart have a gap of 0.
export function maxGapDays(points) {
  if (!points || points.length < 2) return 0;
  let worst = 0;
  for (let i = 1; i < points.length; i++) worst = Math.max(worst, points[i].x - points[i - 1].x - 1);
  return worst;
}

// The trend the calibration consumes.
//   method 'linreg' — OLS over the window.
//   method 'ema'    — EMA-smooth first, then regress the smoothed series. The
//                     smoothing lags a real trend, so the fitted slope tracks
//                     it with a delay of roughly the half-life; that is the
//                     trade for its insensitivity to single-day spikes.
// `excluded` lists the samples MAD rejected, so the caller can show them
// instead of quietly dropping data.
export function weightTrend(samples, options = {}) {
  const {
    method = 'linreg',
    emaHalfLifeDays = 7,
    outlier = { method: 'mad', threshold: 3 },
    valueKey = 'weightKg',
  } = options;

  const all = toSeries(samples, valueKey);
  const empty = {
    slopeKgPerDay: null, intercept: null, r2: null, method,
    nUsed: all.length, nExcluded: 0, excluded: [], spanDays: 0, maxGapDays: maxGapDays(all),
  };
  if (all.length < 2) return empty;

  const rejected = outlier?.method === 'mad' ? madOutliers(all, outlier.threshold) : [];
  const rejectedSet = new Set(rejected);
  const kept = all.filter((_p, i) => !rejectedSet.has(i));
  const excluded = rejected.map((i) => ({ date: all[i].date, value: all[i].y }));
  if (kept.length < 2) return { ...empty, nUsed: kept.length, nExcluded: excluded.length, excluded };

  const fitted = method === 'ema' ? emaSmooth(kept, emaHalfLifeDays) : kept;
  const fit = linreg(fitted);

  return {
    slopeKgPerDay: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    method,
    nUsed: kept.length,
    nExcluded: excluded.length,
    excluded,
    spanDays: kept.at(-1).x - kept[0].x,
    maxGapDays: maxGapDays(kept),
  };
}
