// Pure derivations for the energy screen (kickoff step 9). No Preact, no DOM,
// no store — everything the screen needs to decide is computed here so it can
// be tested in Node, and the component stays a template. Same reason
// src/ui/helpers.js exists.
import { validate } from '../nutrition/config.js';
import { bmr, ffmKg, fatMassKg, bodyFatPct, reconcileIntake } from '../nutrition/energy.js';
import { calibrate, rollingCalibrations, effectiveFactor } from '../nutrition/calibration.js';
import {
  restDayTdeeKcal, dailyTarget, macroTargets, compensationKcal, activityEnergyKcal,
} from '../nutrition/targets.js';
import { energyAvailability } from '../nutrition/availability.js';
import { ledgerBalance, ledgerCorrectionKcal, eveningReconcile, windowSummary } from '../nutrition/ledger.js';
import { evaluateFlags } from '../nutrition/flags.js';
import { createFormulaAdapter } from '../adapters/FormulaAdapter.js';
import { createManualAdapter } from '../adapters/ManualAdapter.js';
import { weightTrend, toSeries, daysBetween } from '../nutrition/trend.js';
import { dateKey, dOnly, addDays } from '../engine/time.js';

// The fields the entry mask writes, grouped by the moment they belong to.
// Morning is measurement, evening is the reckoning, and expenditure is its own
// pair because one of those two numbers contains the other — see
// activityEnergyKcal in nutrition/targets.js.
export const MORNING_FIELDS = ['weightKg', 'bodyFatPct'];
export const INTAKE_FIELDS = ['kcal', 'proteinG'];
export const SPEND_FIELDS = ['exerciseKcal', 'totalKcal'];
export const DETAIL_FIELDS = ['fatG', 'carbsG', 'fiberG', 'alcoholG'];

// Kept for the older call sites and the storage round-trip: the full set, in a
// stable order.
export const ALWAYS_FIELDS = ['weightKg', 'kcal', 'proteinG'];
export const OPTIONAL_FIELD = 'bodyFatPct';
export const ENTRY_FIELDS = [
  ...ALWAYS_FIELDS, OPTIONAL_FIELD, ...SPEND_FIELDS, ...DETAIL_FIELDS,
];

export function nutritionConfig(state) {
  return validate(state?.nutrition?.config ?? {}).normalized;
}

export function dayRows(state) {
  return state?.nutrition?.days ?? [];
}

export function dayFor(state, date) {
  return dayRows(state).find((row) => row.date === date) ?? null;
}

// Tracking gaps are the commonest reason calibration fails, so the mask opens
// with the last value the user actually entered rather than empty fields —
// the most recent non-null per field, not just yesterday's row, so one skipped
// day does not blank the form.
export function prefillEntry(state, date) {
  const today = dayFor(state, date);
  const earlier = dayRows(state).filter((row) => row.date < date).sort((a, b) => (a.date < b.date ? 1 : -1));
  const out = {};
  for (const field of ENTRY_FIELDS) {
    if (today && Number.isFinite(today[field])) { out[field] = today[field]; continue; }
    const previous = earlier.find((row) => Number.isFinite(row[field]));
    out[field] = previous ? previous[field] : null;
  }
  // Intake and expenditure must both be re-entered every day. Carrying either
  // forward would fabricate the very data the calibration measures — yesterday's
  // calories as today's, or yesterday's training as a session that never
  // happened. Only body measurements carry over, because a weight from two days
  // ago is still the best estimate of today's until the scale says otherwise.
  if (!today) {
    for (const f of [...INTAKE_FIELDS, ...SPEND_FIELDS, ...DETAIL_FIELDS]) out[f] = null;
  }
  return { date, ...out, isNew: !today };
}

// Whether an entry is worth writing at all. Autosave fires on every pause in
// typing, and a row of nothing but nulls is not a logged day — it would count
// towards "X von 14 Tagen erfasst" and tell the calibration a day exists that
// carries no measurement.
export function hasEntryData(entry) {
  if (!entry) return false;
  return ENTRY_FIELDS.some((field) => Number.isFinite(entry[field]));
}

// Whether what is on screen is what is in the database. The saved indicator was
// component state first, and it went missing on the first save of a day —
// exactly the save a new user makes — because inserting the row re-runs the
// prefill and the flag did not survive it. Reading the stored row instead
// cannot drift: it reports what is persisted rather than what a variable
// remembers about a write.
export function entryMatchesStored(entry, state) {
  if (!hasEntryData(entry)) return false;
  const stored = dayFor(state, entry?.date);
  if (!stored) return false;
  return ENTRY_FIELDS.every((field) => {
    const shown = Number.isFinite(entry[field]) ? entry[field] : null;
    const kept = Number.isFinite(stored[field]) ? stored[field] : null;
    return shown === kept;
  });
}

// Yesterday, when yesterday still owes a number. Intake is entered in the
// evening or the next morning, so at the moment the scale is read the previous
// day is usually still open — that is the normal case here, not the exception.
// Returns null when there is nothing to chase, so the strip can be absent
// rather than empty on every other day.
//
// Only intake counts as owed. A missing weigh-in is not a gap worth chasing:
// the trend regression is built to survive one, and asking for a weight after
// the fact would invite a made-up number.
export function yesterdayGap(state, today) {
  const date = dateKey(addDays(dOnly(today), -1));
  const rows = dayRows(state);
  // Nothing to chase before there is any history at all — a first-ever day has
  // no yesterday, only an absence.
  if (!rows.some((row) => row.date < date)) return null;
  const row = rows.find((r) => r.date === date);
  if (row && Number.isFinite(row.kcal)) return null;
  return { date, kcal: null, proteinG: row?.proteinG ?? null };
}

export function entryToDay(entry) {
  const day = { date: entry.date };
  for (const field of ENTRY_FIELDS) day[field] = Number.isFinite(entry[field]) ? entry[field] : null;
  return day;
}

// Parses what a text field contains. German decimal commas are accepted because
// the UI is German and a comma is what the keyboard offers.
export function parseNumber(raw) {
  if (raw == null) return null;
  const text = String(raw).trim().replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// Latest recorded body composition, walking backwards so a day without a
// weigh-in still resolves.
export function currentBody(state, config, date) {
  const rows = dayRows(state).filter((row) => row.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1));
  const weightKg = rows.find((row) => Number.isFinite(row.weightKg))?.weightKg ?? null;
  const bfRow = rows.find((row) => Number.isFinite(row.bodyFatPct));
  const profile = bfRow
    ? { ...config.profile, bodyComp: { mode: 'bodyFatPct', value: bfRow.bodyFatPct } }
    : config.profile;
  return {
    weightKg,
    bodyFatPct: bodyFatPct(profile, weightKg),
    ffmKg: ffmKg(profile, weightKg),
    fatMassKg: fatMassKg(profile, weightKg),
    profile,
  };
}

// Merges what the source estimates with what the user entered, into the row
// shape the domain consumes. The adapter's estimate never overwrites a value
// the user typed — a measurement beats an estimate.
export async function assembleDays(state, config, { now, windowDays = 90 } = {}) {
  const end = dateKey(now);
  const start = dateKey(addDays(dOnly(now), -(windowDays - 1)));
  const rows = dayRows(state);

  const adapter = config.energy.adapterId === 'formula'
    ? createFormulaAdapter({
      config,
      weightKg: currentBody(state, config, end).weightKg,
      sessionLogs: state?.logs ?? [],
      now,
      bodyRows: rows,
    })
    : createManualAdapter({ rows });

  const metrics = Object.fromEntries((await adapter.fetchRange(start, end)).map((m) => [m.date, m]));
  const dates = [...new Set([...rows.map((r) => r.date), ...Object.keys(metrics)])]
    .filter((date) => date >= start && date <= end)
    .sort();

  return dates.map((date) => {
    const row = rows.find((r) => r.date === date) ?? { date };
    const metric = metrics[date] ?? {};
    const intake = reconcileIntake(row, config);
    return {
      date,
      ...row,
      intakeKcal: intake.kcal,
      mismatch: intake.mismatch,
      estimateKcal: Number.isFinite(row.totalKcal) ? row.totalKcal : (metric.totalKcal ?? null),
      exerciseKcal: Number.isFinite(row.exerciseKcal) ? row.exerciseKcal : (metric.exerciseKcal ?? null),
      exerciseMinutes: Number.isFinite(row.exerciseMinutes) ? row.exerciseMinutes : (metric.exerciseMinutes ?? null),
      restingHr: Number.isFinite(row.restingHr) ? row.restingHr : (metric.restingHr ?? null),
      estimateIncludesTef: metric.estimateIncludesTef ?? false,
      quality: Number.isFinite(row.totalKcal) ? 'measured' : (metric.quality ?? 'estimated'),
    };
  });
}

// Everything the screen shows, in one pass. Nothing here is persisted — the
// kickoff is explicit that computed values are recomputed on load so a
// corrected formula fixes history retroactively.
export function deriveEnergy(state, { now, days }) {
  const config = nutritionConfig(state);
  const date = dateKey(now);
  const body = currentBody(state, config, date);
  const bmrResult = bmr(config, body.weightKg, now);

  const calibration = calibrate(days, config, { now: date });
  const rolling = rollingCalibrations(days, config, date);
  const history = [...(state?.nutrition?.calibrations ?? []), { ...calibration, computedAt: date }];
  const factor = effectiveFactor(history, config);
  const usableFactor = factor.factor ?? 1;

  const restTdeeKcal = restDayTdeeKcal(days, config, usableFactor);
  const ledger = ledgerBalance(state?.nutrition?.ledger ?? [], date, config);
  const target = dailyTarget({
    restTdeeKcal,
    bmrKcal: bmrResult.kcal,
    weightKg: body.weightKg,
    bodyFatPct: body.bodyFatPct,
    ffmKg: body.ffmKg,
    ledgerCorrectionKcal: ledgerCorrectionKcal(ledger.balanceKcal, config),
  }, config);

  const today = days.find((day) => day.date === date) ?? { date };
  // One of the two expenditure numbers, never both — the day's total already
  // contains the session. See activityEnergyKcal.
  const activity = activityEnergyKcal({
    totalKcal: today.totalKcal,
    exerciseKcal: today.exerciseKcal,
    restDayTdeeKcal: restTdeeKcal,
  });
  const compensation = compensationKcal(activity.kcal, usableFactor, config);
  const plannedIntakeKcal = target.targetIntakeKcal == null
    ? null
    : target.targetIntakeKcal + compensation.kcal;

  const macros = plannedIntakeKcal == null
    ? null
    : macroTargets(plannedIntakeKcal, { weightKg: body.weightKg, ffmKg: body.ffmKg }, config);

  const availability = energyAvailability({
    intakeKcal: today.intakeKcal,
    exerciseKcal: activity.kcal ?? 0,
    factor: usableFactor,
    ffmKg: body.ffmKg,
    bodyFatPct: body.bodyFatPct,
  }, config);

  const flags = evaluateFlags({
    now: date,
    days,
    body,
    calibration,
    ledger,
    lastDietBreakEndedAt: state?.nutrition?.phases?.at(-1)?.dietBreakEndedAt ?? null,
    lastCalibratedAt: state?.nutrition?.calibrations?.at(-1)?.computedAt ?? null,
  }, config);

  return {
    config, date, body, bmrKcal: bmrResult.kcal, bmrFormulas: bmrResult.parts,
    calibration, rolling, factor, restTdeeKcal, target, compensation, activity, plannedIntakeKcal,
    macros, availability, ledger, flags, today,
    week: windowSummary(state?.nutrition?.ledger ?? [], date, config),
  };
}

// Evening reconciliation for a finished day, ready to be written to the ledger.
export function reconcileToday(derived, config) {
  return eveningReconcile({
    date: derived.date,
    plannedDeficitKcal: derived.target.deficitKcal ?? 0,
    actualIntakeKcal: derived.today.intakeKcal,
    actualTdeeKcal: derived.today.estimateKcal,
    exerciseKcal: derived.today.exerciseKcal,
    factor: derived.factor.factor ?? 1,
  }, config);
}

// What the setup section must still collect before anything can be computed.
export function setupGaps(config) {
  const gaps = [];
  if (config.profile.birthDate == null) gaps.push('birthDate');
  if (!Number.isFinite(config.profile.heightCm)) gaps.push('heightCm');
  if (config.profile.sex === 'unspecified') gaps.push('sex');
  if (config.profile.bodyComp.mode === 'none') gaps.push('bodyComp');
  if (config.goal.mode !== 'maintain' && !Number.isFinite(config.goal.target?.valueKg)) gaps.push('goalWeight');
  return gaps;
}

export function isReady(state) {
  return setupGaps(nutritionConfig(state)).length === 0;
}

// --- what the screen shows ---------------------------------------------------

// The target as an ordered list of contributions whose sum IS the target. Keys
// only; the German labels live in the component, as everywhere else in src/ui.
//
// The applied ledger correction is used, not the requested one. Printing the
// request produces a breakdown that does not add up whenever the intake floor
// clipped it — restTdee - deficit + request != target — which is the fastest
// way to lose a user's trust in a screen made of numbers.
export function targetBreakdown(derived) {
  const { target, compensation } = derived;
  if (target?.baseIntakeKcal == null) return [];
  const rows = [{ key: 'restTdee', kcal: target.restTdeeKcal }];
  if (target.deficitKcal) rows.push({ key: 'deficit', kcal: -target.deficitKcal });
  if (Math.round(target.appliedLedgerCorrectionKcal)) {
    rows.push({
      key: 'ledger',
      kcal: target.appliedLedgerCorrectionKcal,
      // Flagged so the UI can say why it is smaller than the account balance.
      clipped: Math.abs(target.appliedLedgerCorrectionKcal) + 0.5 < Math.abs(target.ledgerCorrectionKcal),
    });
  }
  if (compensation?.kcal) rows.push({ key: 'compensation', kcal: compensation.kcal });
  return rows;
}

export function breakdownSum(rows) {
  return rows.reduce((total, row) => total + row.kcal, 0);
}

// Today against today's target. This is the question the app is opened to
// answer, and it is the one the first version never actually answered.
export function todayProgress(derived) {
  const target = derived.plannedIntakeKcal;
  const consumed = Number.isFinite(derived.today?.intakeKcal) ? derived.today.intakeKcal : null;
  const proteinTargetG = derived.macros?.proteinG ?? null;
  const proteinG = Number.isFinite(derived.today?.proteinG) ? derived.today.proteinG : null;
  const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);
  return {
    targetKcal: target,
    consumedKcal: consumed,
    remainingKcal: Number.isFinite(target) && consumed != null ? target - consumed : null,
    kcalRatio: ratio(consumed, target),
    over: Number.isFinite(target) && consumed != null && consumed > target,
    proteinG,
    proteinTargetG,
    proteinRatio: ratio(proteinG, proteinTargetG),
    logged: consumed != null,
  };
}

// Progress toward the first calibration. Days 1-13 are where this feature is
// abandoned — the domain returns null until minDays, and a screen that only
// says "not yet" gives no reason to come back tomorrow.
export function calibrationProgress(days, config, now) {
  const usable = (days ?? []).filter((day) => Number.isFinite(day.intakeKcal));
  const needed = config.calibration.minDays;
  const today = dateKey(now);

  // Consecutive days ending today or yesterday — one missed day should not
  // read as a total reset while the day is still young.
  const tracked = new Set(usable.map((day) => day.date));
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const date = dateKey(addDays(dOnly(now), -i));
    if (tracked.has(date)) streak++;
    else if (!(i === 0)) break;
  }

  return {
    tracked: usable.length,
    needed,
    remaining: Math.max(0, needed - usable.length),
    ratio: Math.min(1, needed ? usable.length / needed : 0),
    streak,
    loggedToday: tracked.has(today),
  };
}

// Weight points plus the regression the whole feature rests on, in viewBox
// units so the component only has to draw. Showing the scatter against the fit
// is the one honest argument for "measure, do not estimate" — the daily noise
// the regression exists to absorb becomes visible instead of asserted.
export function weightChartData(days, config, { width = 320, height = 90, pad = 6, goalKg = null } = {}) {
  const series = toSeries(days ?? [], 'weightKg');
  if (series.length < 2) return null;

  const trend = weightTrend(days, {
    method: config.calibration.trendMethod,
    emaHalfLifeDays: config.calibration.emaHalfLifeDays,
    outlier: config.calibration.outlier,
  });

  const xs = series.map((p) => p.x);
  const ys = series.map((p) => p.y);
  // The scale is set by the weights alone. Stretching it to reach a goal 15 kg
  // away would flatten months of real movement into a straight line, and the
  // movement is the entire point of the chart. A goal outside the range simply
  // does not get a line.
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || 1;
  const spanX = Math.max(...xs) - Math.min(...xs) || 1;
  const minX = Math.min(...xs);

  const sx = (x) => pad + ((x - minX) / spanX) * (width - 2 * pad);
  const sy = (y) => height - pad - ((y - minY) / spanY) * (height - 2 * pad);

  const excluded = new Set((trend.excluded ?? []).map((e) => e.date));
  const points = series.map((p) => ({ x: sx(p.x), y: sy(p.y), date: p.date, kg: p.y, excluded: excluded.has(p.date) }));

  let fit = null;
  if (trend.slopeKgPerDay != null && trend.intercept != null) {
    const at = (x) => trend.intercept + trend.slopeKgPerDay * x;
    const x0 = minX;
    const x1 = Math.max(...xs);
    fit = { x1: sx(x0), y1: sy(at(x0)), x2: sx(x1), y2: sy(at(x1)) };
  }

  return {
    width,
    height,
    points,
    fit,
    // A regression over three days is noise drawn confidently. The calibration
    // refuses to state a factor below minDays for the same reason, so the chart
    // marks a short window as provisional rather than asserting a slope the
    // data cannot carry.
    provisional: daysBetween(series[0].date, series.at(-1).date) < config.calibration.minDays,
    goalY: Number.isFinite(goalKg) && goalKg >= minY && goalKg <= maxY ? sy(goalKg) : null,
    minKg: minY,
    maxKg: maxY,
    firstDate: series[0].date,
    lastDate: series.at(-1).date,
    slopeKgPerWeek: trend.slopeKgPerDay == null ? null : trend.slopeKgPerDay * 7,
    spanDays: daysBetween(series[0].date, series.at(-1).date),
  };
}
