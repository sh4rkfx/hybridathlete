// Pure derivations for the energy screen (kickoff step 9). No Preact, no DOM,
// no store — everything the screen needs to decide is computed here so it can
// be tested in Node, and the component stays a template. Same reason
// src/ui/helpers.js exists.
import { validate } from '../nutrition/config.js';
import { bmr, ffmKg, fatMassKg, bodyFatPct, reconcileIntake } from '../nutrition/energy.js';
import { calibrate, rollingCalibrations, effectiveFactor } from '../nutrition/calibration.js';
import { restDayTdeeKcal, dailyTarget, macroTargets, compensationKcal } from '../nutrition/targets.js';
import { energyAvailability } from '../nutrition/availability.js';
import { ledgerBalance, ledgerCorrectionKcal, eveningReconcile, windowSummary } from '../nutrition/ledger.js';
import { evaluateFlags } from '../nutrition/flags.js';
import { createFormulaAdapter } from '../adapters/FormulaAdapter.js';
import { createManualAdapter } from '../adapters/ManualAdapter.js';
import { dateKey, dOnly, addDays } from '../engine/time.js';

// The fields the entry mask writes. Weight, calories and protein are always
// visible; body fat is visible but optional; the rest sit behind "Details"
// (kickoff "UI-Hinweise für Schritt 9").
export const ALWAYS_FIELDS = ['weightKg', 'kcal', 'proteinG'];
export const OPTIONAL_FIELD = 'bodyFatPct';
export const DETAIL_FIELDS = ['fatG', 'carbsG', 'fiberG', 'alcoholG'];
export const ENTRY_FIELDS = [...ALWAYS_FIELDS, OPTIONAL_FIELD, ...DETAIL_FIELDS];

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
  // Intake is the one thing that must be re-entered every day; carrying
  // yesterday's calories forward as if they were today's would quietly
  // fabricate the very data the calibration measures.
  if (!today) { out.kcal = null; out.proteinG = null; for (const f of DETAIL_FIELDS) out[f] = null; }
  return { date, ...out, isNew: !today };
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
  const compensation = compensationKcal(today.exerciseKcal, usableFactor, config);
  const plannedIntakeKcal = target.targetIntakeKcal == null
    ? null
    : target.targetIntakeKcal + compensation.kcal;

  const macros = plannedIntakeKcal == null
    ? null
    : macroTargets(plannedIntakeKcal, { weightKg: body.weightKg, ffmKg: body.ffmKg }, config);

  const availability = energyAvailability({
    intakeKcal: today.intakeKcal,
    exerciseKcal: today.exerciseKcal ?? 0,
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
    calibration, rolling, factor, restTdeeKcal, target, compensation, plannedIntakeKcal,
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
