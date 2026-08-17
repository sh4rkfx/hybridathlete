// Calibration: measuring the real energy turnover instead of estimating it
// (kickoff step 3, "Kalibrierung statt Schätzung"). Pure module.
//
//   TDEE_real = mean intake - (weight trend in kg/day x energy density)
//   factor    = TDEE_real / mean estimate from the data source
//
// The trend comes from a regression over the whole window, never from the
// difference of the first and last value — see the header of trend.js for what
// that costs. The factor is applied to the source's TOTAL only: wearables shift
// the split between resting and active energy systematically (the kickoff
// reports a measured resting figure 19 % above the formula value, implying an
// arithmetically impossible PAL), so the sum is usable and the split is not.
//
// A day, as this module wants it:
//   { date, intakeKcal, estimateKcal, weightKg }
// intakeKcal is what energy.reconcileIntake() resolved; estimateKcal is the
// source's total daily expenditure. Building these from adapter output is step
// 7's job — this module stays on the plain shape.
//
// Reason codes are internal; flags.js (step 6) is what turns them into
// user-facing warnings, which is why they have no de.json wording yet.
import { DEFAULT_CONFIG } from './config.js';
import { weightTrend, maxGapDays, toSeries, median, daysBetween } from './trend.js';

export const REASONS = {
  DISABLED: 'DISABLED',
  BELOW_MIN_DAYS: 'BELOW_MIN_DAYS',
  INSUFFICIENT_ESTIMATE_DAYS: 'INSUFFICIENT_ESTIMATE_DAYS',
  NO_WEIGHT_TREND: 'NO_WEIGHT_TREND',
  IMPLAUSIBLE_TREND: 'IMPLAUSIBLE_TREND',
  SHORT_WEIGHT_SPAN: 'SHORT_WEIGHT_SPAN',
  FACTOR_CLAMPED: 'FACTOR_CLAMPED',
  ERA_TRUNCATED: 'ERA_TRUNCATED',
  NON_REPRESENTATIVE_EXCLUDED: 'NON_REPRESENTATIVE_EXCLUDED',
};

// Device eras are half-open, [from, to). Validated eras touch — one ends on the
// date the next begins — and the data recorded on that date comes from the NEW
// device, so the switch day belongs to the new era. Treating `to` inclusively
// would hand the boundary day to the old device and pool it with old-device
// days, which is exactly what this module promises not to do.
function inEra(date, era) {
  const d = new Date(date);
  if (d < new Date(era.from)) return false;
  return era.to == null || d < new Date(era.to);
}

// Training-context periods are inclusive, [from, to] — deliberately unlike
// eras. A user labelling 2026-03-01 to 2026-03-31 as rehab means all of March,
// the 31st included; these are hand-written annotations, not a partition.
function inPeriod(date, from, to) {
  const d = new Date(date);
  if (d < new Date(from)) return false;
  return to == null || d <= new Date(to);
}

// The era covering `date`, for labelling. Null before the first era or inside a
// gap between two — which is a real state, not an error, and one the window
// truncation below still has to respect.
export function eraFor(date, config) {
  const eras = config?.history?.deviceEras ?? [];
  return eras.find((era) => era?.from != null && inEra(date, era)) ?? null;
}

// Every date on which the recording device changed: era starts, and era ends
// where no era follows immediately. Both are boundaries — a window that reached
// back past an era's `to` into a gap would pool two different devices just as
// surely as one that crossed a `from`.
export function eraBoundaries(config) {
  const dates = new Set();
  for (const era of config?.history?.deviceEras ?? []) {
    if (era?.from != null) dates.add(era.from);
    if (era?.to != null) dates.add(era.to);
  }
  return [...dates].sort((a, b) => new Date(a) - new Date(b));
}

// The most recent device boundary at or before `date`, i.e. the earliest day a
// window ending on `date` may reach back to. Null when no boundary has been
// crossed yet, in which case nothing needs truncating.
export function lastEraBoundaryOn(date, config) {
  const before = eraBoundaries(config).filter((d) => new Date(d) <= new Date(date));
  return before.at(-1) ?? null;
}

export function isRepresentative(date, config) {
  const periods = config?.history?.trainingContext?.periods ?? [];
  return !periods.some((p) => p.representative === false && inPeriod(date, p.from, p.to));
}

// Days inside the window that survive era truncation and the representativity
// filter. `now` is the window's last day, injected — never read from the clock.
export function selectWindow(days, config, { now, windowDays } = {}) {
  const cfg = config ?? DEFAULT_CONFIG;
  const span = windowDays ?? cfg.calibration.windowDays;
  const sorted = (days ?? []).filter((d) => d?.date != null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!sorted.length) return { days: [], era: null, truncated: false, excluded: 0, windowDays: span };

  const end = now ?? sorted.at(-1).date;
  const era = eraFor(end, cfg);
  const boundary = lastEraBoundaryOn(end, cfg);
  let start = -(span - 1); // in days relative to `end`
  let truncated = false;
  if (boundary) {
    const boundaryOffset = -daysBetween(boundary, end);
    if (boundaryOffset > start) { start = boundaryOffset; truncated = true; }
  }

  const inWindow = sorted.filter((d) => {
    const offset = -daysBetween(d.date, end);
    return offset >= start && offset <= 0;
  });
  const kept = inWindow.filter((d) => isRepresentative(d.date, cfg));
  return { days: kept, era, truncated, excluded: inWindow.length - kept.length, windowDays: span };
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function rateConfidence({ coverage, gap, spanCoverage, plausible, thresholds }) {
  if (!plausible) return 'low';
  if (coverage >= thresholds.highCoverage && gap <= thresholds.highMaxGapDays
      && spanCoverage >= thresholds.highCoverage) return 'high';
  if (coverage >= thresholds.mediumCoverage && gap <= thresholds.mediumMaxGapDays) return 'medium';
  return 'low';
}

// One calibration over one window. Returns factor null — never a guess — when
// there is not enough data, when the source supplies no expenditure estimate,
// or when calibration is switched off.
export function calibrate(days, config, options = {}) {
  const cfg = config ?? DEFAULT_CONFIG;
  const cal = cfg.calibration;
  const { now, windowDays, minDays = cal.minDays } = options;
  const reasons = [];

  const scope = selectWindow(days, cfg, { now, windowDays });
  const span = scope.windowDays;
  if (scope.truncated) reasons.push(REASONS.ERA_TRUNCATED);
  if (scope.excluded) reasons.push(REASONS.NON_REPRESENTATIVE_EXCLUDED);

  const base = {
    factor: null,
    rawFactor: null,
    tdeeRealKcal: null,
    meanIntakeKcal: null,
    meanEstimateKcal: null,
    trend: null,
    confidence: 'low',
    nDays: 0,
    nEstimateDays: 0,
    coverage: 0,
    maxGapDays: 0,
    clamped: false,
    windowDays: span,
    era: scope.era,
    computedAt: now ?? null,
    reasons,
  };
  if (!cal.enabled) return { ...base, reasons: [...reasons, REASONS.DISABLED] };

  const intakeDays = scope.days.filter((d) => Number.isFinite(d.intakeKcal));
  const pairedDays = intakeDays.filter((d) => Number.isFinite(d.estimateKcal));
  const series = toSeries(intakeDays, 'intakeKcal');
  const coverage = span ? intakeDays.length / span : 0;
  const gap = maxGapDays(series);

  const trend = weightTrend(scope.days, {
    method: cal.trendMethod,
    emaHalfLifeDays: cal.emaHalfLifeDays,
    outlier: cal.outlier,
  });

  const stats = {
    ...base,
    trend,
    nDays: intakeDays.length,
    nEstimateDays: pairedDays.length,
    coverage,
    maxGapDays: gap,
    meanIntakeKcal: mean(intakeDays.map((d) => d.intakeKcal)),
    meanEstimateKcal: mean(pairedDays.map((d) => d.estimateKcal)),
  };

  if (intakeDays.length < minDays) return { ...stats, reasons: [...reasons, REASONS.BELOW_MIN_DAYS] };
  if (trend.slopeKgPerDay == null) return { ...stats, reasons: [...reasons, REASONS.NO_WEIGHT_TREND] };

  // A trend beyond the plausible band is a data problem, not a metabolism:
  // a mistyped weight or a scale in the wrong unit. It still produces a number,
  // but never a confident one.
  const plausibleTrend = Math.abs(trend.slopeKgPerDay) <= cal.confidence.maxPlausibleTrendKgPerDay;
  if (!plausibleTrend) reasons.push(REASONS.IMPLAUSIBLE_TREND);

  // The trend must cover the window the intake mean covers, or the two sides of
  // the energy balance describe different periods.
  const spanCoverage = span > 1 ? trend.spanDays / (span - 1) : 0;
  if (spanCoverage < cal.confidence.mediumCoverage) reasons.push(REASONS.SHORT_WEIGHT_SPAN);

  const tdeeRealKcal = stats.meanIntakeKcal - trend.slopeKgPerDay * cal.energyDensityKcalPerKg;

  if (pairedDays.length < minDays || !stats.meanEstimateKcal) {
    return { ...stats, tdeeRealKcal, reasons: [...reasons, REASONS.INSUFFICIENT_ESTIMATE_DAYS] };
  }

  const rawFactor = tdeeRealKcal / stats.meanEstimateKcal;
  const [lo, hi] = cal.factorClamp;
  const factor = Math.min(hi, Math.max(lo, rawFactor));
  const clamped = factor !== rawFactor;
  // The usual cause is systematic under-tracking of intake, not an unusual
  // metabolism — worth saying out loud rather than quietly widening the clamp.
  if (clamped) reasons.push(REASONS.FACTOR_CLAMPED);

  const confidence = rateConfidence({
    coverage,
    gap,
    spanCoverage,
    plausible: plausibleTrend && !clamped,
    thresholds: cal.confidence,
  });

  return { ...stats, tdeeRealKcal, rawFactor, factor, clamped, confidence, reasons };
}

// The parallel short/long read the kickoff asks for.
//
// The 7-day figure is for display only and must never drive a target. With a
// daily weighing noise of 0.35 kg the standard error of a 7-day slope is about
// 0.066 kg/day, i.e. +/- 500 kcal/day in the recovered TDEE — the same order as
// the quantity being measured. Over 28 days it falls to roughly 90 kcal.
// minDays is relaxed to the window length here, or the 7-day read could never
// produce a number at all.
export function rollingCalibrations(days, config, now) {
  const cfg = config ?? DEFAULT_CONFIG;
  const forWindow = (windowDays) => calibrate(days, cfg, {
    now, windowDays, minDays: Math.min(cfg.calibration.minDays, windowDays),
  });
  return {
    d7: { ...forWindow(7), purpose: 'display' },
    d28: { ...forWindow(28), purpose: 'display' },
    current: calibrate(days, cfg, { now }),
  };
}

// Which factor the targets actually use. The median of the last three
// calibrations, so one bad window cannot drag the target the way a mean would;
// the newest value below three. A large gap between newest and smoothed is
// either real metabolic adaptation or a break in tracking, and both are worth
// seeing rather than averaging away.
export function effectiveFactor(history, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const { method, deviationWarnPct } = cfg.calibration.smoothing;
  const usable = (history ?? [])
    .filter((entry) => Number.isFinite(entry?.factor))
    .sort((a, b) => new Date(a.computedAt) - new Date(b.computedAt));

  if (!usable.length) return { factor: null, method: 'none', latest: null, used: [], deviationPct: null, deviates: false };

  const latest = usable.at(-1).factor;
  const recent = usable.slice(-3).map((entry) => entry.factor);
  const smoothed = method === 'median3' && recent.length === 3 ? median(recent) : latest;
  const used = method === 'median3' && recent.length === 3 ? recent : [latest];
  const deviationPct = smoothed ? Math.abs(latest - smoothed) / smoothed * 100 : null;

  return {
    factor: smoothed,
    method: used.length === 3 ? 'median3' : 'latest',
    latest,
    used,
    deviationPct,
    deviates: deviationPct != null && deviationPct > deviationWarnPct,
  };
}

export function isRecalibrationDue(lastComputedAt, now, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  if (lastComputedAt == null) return true;
  return daysBetween(lastComputedAt, now) >= cfg.calibration.recalibrateEveryDays;
}
