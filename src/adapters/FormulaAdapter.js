// v1 data source for people without a wearable: BMR x PAL plus measured
// activity (kickoff step 7). Pure module — it takes the training log as data
// and touches no IO.
//
// The obvious formulation, totalKcal = BMR x energy.palFactor, does not work.
// palFactor (1.55) is a WHOLE-DAY figure that already contains exercise, so
// every day would come out identical — 1790 x 1.55 = 2775 kcal for the seed
// profile — and the rest-day/training-day distinction that the base intake is
// built on would be gone. So the adapter uses a non-exercise PAL and adds the
// activity it can actually see:
//
//   totalKcal(day) = BMR x energy.nonExercisePalFactor + activeKcal(day)
//   activeKcal     = 30 + 4.27 x trainingMinutes + 0.0308 x steps
//
// The activity term is the kickoff's own regression over 825 measured days
// (R2 = 0.827). The non-exercise PAL is derived from the same source rather than
// picked: rest-day TDEE 2334 over BMR 1790 is 1.304. Together they reproduce all
// three documented day types to within 6 kcal — rest 2328 against 2334, 105 min
// 2806 against 2803, 180 min 3126 against 3127. Asserted in the adapter tests.
//
// Note a rest day gets no regression intercept: activeKcal() returns 0 rather
// than 30 when nothing was trained, because the intercept is the fixed cost of
// *having* a session, not a daily levy.
//
// This app records no step counts, so that term is always zero here. It stays in
// the formula because the regression includes it and a future source may supply
// it; it is not silently dropped.
//
// `includesTef: true`: a PAL is defined against total daily expenditure, so
// thermogenesis is already inside the number and must not be added again.
import { DEFAULT_CONFIG } from '../nutrition/config.js';
import { bmr } from '../nutrition/energy.js';
import { dateKey, dOnly } from '../engine/time.js';

export const FORMULA_ADAPTER_ID = 'formula';

// Kickoff "Regression aus denselben Daten": R2 = 0.827.
export const ACTIVE_REGRESSION = { intercept: 30, perMinute: 4.27, perStep: 0.0308 };

export function activeKcal({ minutes = 0, steps = 0 } = {}) {
  if (!minutes && !steps) return 0;
  return ACTIVE_REGRESSION.intercept
    + ACTIVE_REGRESSION.perMinute * (minutes || 0)
    + ACTIVE_REGRESSION.perStep * (steps || 0);
}

// Training minutes per calendar day from the planner's sessionLogs. Drafts are
// excluded for the same reason the rule engine excludes them (AC9): they are not
// confirmed data yet.
export function minutesByDate(sessionLogs = [], config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const out = {};
  for (const log of sessionLogs) {
    if (!log || log.draft || log.date == null) continue;
    const minutes = Number.isFinite(log.duration) ? log.duration : 0;
    if (minutes < cfg.history.minSessionMinutes) continue; // false starts fly out
    const key = dateKey(log.date);
    out[key] = (out[key] ?? 0) + minutes;
  }
  return out;
}

export function createFormulaAdapter({ config, weightKg, sessionLogs = [], now = new Date(), bodyRows = [] } = {}) {
  const cfg = config ?? DEFAULT_CONFIG;
  const byDate = minutesByDate(sessionLogs, cfg);
  // Weight and body fat are not something a formula can produce; where the user
  // has recorded them they are passed through, otherwise they stay null.
  const body = Object.fromEntries((bodyRows ?? []).filter((r) => r?.date).map((r) => [r.date, r]));

  return {
    id: FORMULA_ADAPTER_ID,
    capabilities: {
      totalKcal: true,
      exerciseKcal: true,
      exerciseMinutes: true,
      steps: false,
      restingHr: false,
      weight: false,
      bodyFat: false,
      includesTef: true,
    },
    async isAvailable() {
      return bmr(cfg, weightKg, now).kcal != null;
    },
    async fetchRange(startDate, endDate) {
      const restingKcal = bmr(cfg, weightKg, now).kcal;
      const out = [];
      for (let d = dOnly(startDate); dateKey(d) <= endDate; d.setDate(d.getDate() + 1)) {
        const date = dateKey(d);
        const minutes = byDate[date] ?? 0;
        const active = activeKcal({ minutes });
        const row = body[date] ?? {};
        out.push({
          date,
          totalKcal: restingKcal == null ? null : restingKcal * cfg.energy.nonExercisePalFactor + active,
          exerciseKcal: active,
          exerciseMinutes: minutes,
          steps: null,
          restingHr: Number.isFinite(row.restingHr) ? row.restingHr : null,
          weightKg: Number.isFinite(row.weightKg) ? row.weightKg : null,
          bodyFatPct: Number.isFinite(row.bodyFatPct) ? row.bodyFatPct : null,
          estimateIncludesTef: true,
          quality: 'estimated',
        });
      }
      return out;
    },
  };
}
