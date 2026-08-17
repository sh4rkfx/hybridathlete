// The warning system (kickoff step 6, "Warnsystem"). Pure module.
//
// One declarative table, one detector per code, mirroring how src/rules/
// keeps R1-R8 in a catalog instead of scattering thresholds through the
// engine. Every threshold is read from config.flags — nothing here is a
// literal — and the matrix test walks FLAG_DEFINITIONS to assert that each
// code fires in its own scenario and in no other.
//
// Flags carry { code, level, since, params, suggestedAction } and no text at
// all. German wording lives in src/i18n/de.json under nutrition.flags.*, keyed
// by code, and the locale test enforces the mapping both ways.
//
// The state this consumes, assembled by the caller (step 7/8 wire it to the
// adapters and the store):
//   {
//     now,
//     days: [{ date, intakeKcal, proteinG, estimateKcal, weightKg, restingHr,
//              exerciseKcal, exerciseMinutes, ...IntakeEntry macro fields }],
//     historyDays,          optional, for the year-on-year comparison
//     calibration,          a calibrate() result
//     ledger,               a ledgerBalance() result
//     body: { weightKg, bodyFatPct, ffmKg },
//     lastDietBreakEndedAt, lastCalibratedAt,
//   }
// Everything is optional: a detector that lacks its inputs returns null rather
// than guessing, so a half-configured app produces fewer flags, never wrong ones.
import { DEFAULT_CONFIG, maxRatePctBwPerWeek } from './config.js';
import { reconcileIntake, median } from './energy.js';
import { weightTrend, daysBetween, toSeries } from './trend.js';
import { energyAvailability } from './availability.js';
import { isRepresentative, eraFor, isRecalibrationDue } from './calibration.js';
import { isRestDay } from './targets.js';

export const LEVELS = ['info', 'warn', 'stop'];

function lastNDays(days, now, n) {
  return (days ?? [])
    .filter((day) => day?.date != null && daysBetween(day.date, now) < n && new Date(day.date) <= new Date(now))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function firstDateWhere(days, predicate) {
  const hit = days.find(predicate);
  return hit ? hit.date : null;
}

// Resting-heart-rate baseline. 'auto' takes the median of the first
// rhrBaselineDays of the CURRENT device era — resting HR is as device-dependent
// as energy expenditure, so carrying a baseline across a watch change would
// manufacture an RHR flag out of a hardware swap.
export function rhrBaseline(days, config, now) {
  const cfg = config ?? DEFAULT_CONFIG;
  if (Number.isFinite(cfg.flags.rhrBaseline)) return cfg.flags.rhrBaseline;

  const era = eraFor(now, cfg);
  const usable = (days ?? [])
    .filter((day) => Number.isFinite(day?.restingHr)
      && (!era || new Date(day.date) >= new Date(era.from)))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, cfg.flags.rhrBaselineDays);
  return usable.length ? median(usable.map((day) => day.restingHr)) : null;
}

// A sustained run of days satisfying `predicate`, ending at the most recent
// day. Returns the first date of the run, or null if the run is shorter than
// `minDays` or the recent has gaps in the values it needs.
function sustainedSince(days, minDays, predicate) {
  const relevant = days.filter((day) => predicate(day) !== null);
  if (relevant.length < minDays) return null;
  const tail = relevant.slice(-minDays);
  return tail.every(predicate) ? tail[0].date : null;
}

export const FLAG_DEFINITIONS = [
  {
    code: 'RHR_ELEVATED',
    level: 'warn',
    suggestedAction: 'REDUCE_LOAD_OR_EAT_MORE',
    detect(state, cfg) {
      const baseline = rhrBaseline(state.days, cfg, state.now);
      if (baseline == null) return null;
      const limit = baseline + cfg.flags.rhrHighDelta;
      const recent = lastNDays(state.days, state.now, cfg.flags.rhrHighDays);
      const since = sustainedSince(recent, cfg.flags.rhrHighDays,
        (day) => (Number.isFinite(day.restingHr) ? day.restingHr >= limit : null));
      return since ? { since, params: { baseline, limit, days: cfg.flags.rhrHighDays } } : null;
    },
  },
  {
    code: 'RHR_SUPPRESSED',
    level: 'stop',
    suggestedAction: 'END_DEFICIT',
    detect(state, cfg) {
      const baseline = rhrBaseline(state.days, cfg, state.now);
      if (baseline == null) return null;
      const limit = baseline + cfg.flags.rhrLowDelta;
      const recent = lastNDays(state.days, state.now, cfg.flags.rhrLowDays);
      const since = sustainedSince(recent, cfg.flags.rhrLowDays,
        (day) => (Number.isFinite(day.restingHr) ? day.restingHr <= limit : null));
      return since ? { since, params: { baseline, limit, days: cfg.flags.rhrLowDays } } : null;
    },
  },
  {
    code: 'PLATEAU',
    level: 'warn',
    suggestedAction: 'RECALIBRATE',
    detect(state, cfg) {
      if (cfg.goal.mode === 'maintain') return null;
      const recent = lastNDays(state.days, state.now, cfg.flags.plateauDays);
      const trend = weightTrend(recent, { method: cfg.calibration.trendMethod, outlier: cfg.calibration.outlier });
      if (trend.slopeKgPerDay == null || trend.nUsed < cfg.flags.plateauDays / 2) return null;
      if (Math.abs(trend.slopeKgPerDay) > cfg.flags.plateauMaxTrendKgPerDay) return null;
      return { since: recent[0]?.date ?? null, params: { slopeKgPerDay: trend.slopeKgPerDay, days: cfg.flags.plateauDays } };
    },
  },
  {
    code: 'RATE_TOO_FAST',
    level: 'warn',
    suggestedAction: 'RAISE_INTAKE',
    detect(state, cfg) {
      const { weightKg, bodyFatPct } = state.body ?? {};
      if (!Number.isFinite(weightKg)) return null;
      const recent = lastNDays(state.days, state.now, cfg.calibration.windowDays);
      const trend = weightTrend(recent, { method: cfg.calibration.trendMethod, outlier: cfg.calibration.outlier });
      if (trend.slopeKgPerDay == null || trend.slopeKgPerDay >= 0) return null;
      const ratePctBwPerWeek = (Math.abs(trend.slopeKgPerDay) * 7 / weightKg) * 100;
      const cap = maxRatePctBwPerWeek(cfg, bodyFatPct);
      return ratePctBwPerWeek > cap
        ? { since: recent[0]?.date ?? null, params: { ratePctBwPerWeek, cap } }
        : null;
    },
  },
  {
    code: 'PROTEIN_LOW',
    level: 'warn',
    suggestedAction: 'RAISE_PROTEIN',
    detect(state, cfg) {
      const ffm = state.body?.ffmKg;
      if (!Number.isFinite(ffm) || ffm <= 0) return null;
      const recent = lastNDays(state.days, state.now, 7);
      const tracked = recent.filter((day) => Number.isFinite(day.proteinG));
      if (!tracked.length) return null;
      const meanG = tracked.reduce((sum, day) => sum + day.proteinG, 0) / tracked.length;
      const gPerKgFfm = meanG / ffm;
      return gPerKgFfm < cfg.flags.proteinMinGPerKgFfm
        ? { since: tracked[0].date, params: { gPerKgFfm, minimum: cfg.flags.proteinMinGPerKgFfm } }
        : null;
    },
  },
  {
    code: 'PROTEIN_NOT_TRACKED',
    level: 'info',
    suggestedAction: 'TRACK_PROTEIN',
    detect(state, cfg) {
      const recent = lastNDays(state.days, state.now, 7);
      const withKcal = recent.filter((day) => Number.isFinite(day.intakeKcal));
      if (!withKcal.length) return null;
      const missing = withKcal.filter((day) => !Number.isFinite(day.proteinG));
      return missing.length > cfg.flags.proteinMissingDaysOf7
        ? { since: missing[0].date, params: { missing: missing.length, of: withKcal.length } }
        : null;
    },
  },
  {
    code: 'MACRO_KCAL_MISMATCH',
    level: 'warn',
    suggestedAction: 'REVIEW_ENTRY',
    detect(state, cfg) {
      const recent = lastNDays(state.days, state.now, 7);
      const mismatched = recent.filter((day) => reconcileIntake(day, cfg).mismatch);
      return mismatched.length
        ? { since: mismatched[0].date, params: { days: mismatched.length, tolerancePct: cfg.intake.reconciliation.mismatchTolerancePct } }
        : null;
    },
  },
  {
    code: 'TRACKING_GAP',
    level: 'info',
    suggestedAction: 'TRACK_DAILY',
    detect(state, cfg) {
      const recent = lastNDays(state.days, state.now, 7);
      const tracked = recent.filter((day) => Number.isFinite(day.intakeKcal));
      return tracked.length < cfg.flags.trackingCoverageMin
        ? { since: recent[0]?.date ?? null, params: { tracked: tracked.length, minimum: cfg.flags.trackingCoverageMin } }
        : null;
    },
  },
  {
    code: 'FACTOR_CLAMPED',
    level: 'warn',
    suggestedAction: 'REVIEW_TRACKING',
    detect(state) {
      // The usual cause is systematic under-tracking of intake, not an unusual
      // metabolism — the suggested action says so rather than widening the clamp.
      if (!state.calibration?.clamped) return null;
      return {
        since: state.calibration.computedAt ?? null,
        params: { rawFactor: state.calibration.rawFactor, factor: state.calibration.factor },
      };
    },
  },
  {
    code: 'EA_LOW',
    level: 'warn',
    suggestedAction: 'RAISE_INTAKE',
    detect(state, cfg) {
      const low = eaDays(state, cfg).filter((day) => day.low);
      return low.length >= cfg.flags.eaLowDaysOf7
        ? { since: low[0].date, params: { days: low.length, of: cfg.flags.eaLowDaysOf7 } }
        : null;
    },
  },
  {
    code: 'EA_CRITICAL',
    level: 'stop',
    suggestedAction: 'END_DEFICIT',
    detect(state, cfg) {
      const days = eaDays(state, cfg);
      let run = 0;
      let start = null;
      for (const day of days) {
        if (day.critical) { run++; if (run === 1) start = day.date; } else { run = 0; start = null; }
        if (run >= cfg.flags.eaCriticalConsecutiveDays) return { since: start, params: { days: run } };
      }
      return null;
    },
  },
  {
    code: 'LEDGER_SATURATED',
    level: 'info',
    suggestedAction: 'REVIEW_TARGET',
    detect(state) {
      if (!state.ledger?.saturated) return null;
      return { since: null, params: { balanceKcal: state.ledger.balanceKcal } };
    },
  },
  {
    code: 'DIET_BREAK_DUE',
    level: 'info',
    suggestedAction: 'TAKE_DIET_BREAK',
    detect(state, cfg) {
      if (!cfg.safety.dietBreak.auto || cfg.goal.mode !== 'cut') return null;
      const since = state.lastDietBreakEndedAt;
      if (since == null) return null;
      const weeks = daysBetween(since, state.now) / 7;
      return weeks >= cfg.safety.dietBreak.everyWeeks
        ? { since, params: { weeks, everyWeeks: cfg.safety.dietBreak.everyWeeks } }
        : null;
    },
  },
  {
    code: 'RECALIBRATION_DUE',
    level: 'info',
    suggestedAction: 'RECALIBRATE',
    detect(state, cfg) {
      if (!cfg.calibration.enabled || state.lastCalibratedAt == null) return null;
      return isRecalibrationDue(state.lastCalibratedAt, state.now, cfg)
        ? { since: state.lastCalibratedAt, params: { days: daysBetween(state.lastCalibratedAt, state.now) } }
        : null;
    },
  },
  {
    code: 'SOURCE_DEGRADED',
    level: 'warn',
    suggestedAction: 'CHECK_DATA_SOURCE',
    detect(state, cfg) {
      const span = cfg.calibration.windowDays;
      const recent = lastNDays(state.days, state.now, span);
      if (!recent.length) return null;
      const supplied = recent.filter((day) => Number.isFinite(day.estimateKcal)).length;
      const coverage = supplied / span;
      return coverage < cfg.flags.sourceCoverageMin
        ? { since: recent[0].date, params: { coverage, minimum: cfg.flags.sourceCoverageMin } }
        : null;
    },
  },
  {
    code: 'DEVICE_CHANGE_DETECTED',
    level: 'warn',
    suggestedAction: 'ADD_DEVICE_ERA',
    detect(state, cfg) {
      // "Median jump > 15 % at the same activity and pulse". The kickoff names
      // neither the comparison set nor what counts as the same, so this is a
      // coarse detector by construction: rest days only (same activity: none)
      // whose resting HR sits within rhrSameDeltaBpm of the baseline (same
      // pulse), median of the older half against the newer half of the recent.
      // ASSUMPTION, and a hint rather than a verdict — it suggests recording a
      // device era, it does not create one.
      const baseline = rhrBaseline(state.days, cfg, state.now);
      if (baseline == null) return null;
      const recent = lastNDays(state.days, state.now, cfg.calibration.windowDays * 2);
      const comparable = recent.filter((day) => isRestDay(day, cfg)
        && Number.isFinite(day.estimateKcal)
        && Number.isFinite(day.restingHr)
        && Math.abs(day.restingHr - baseline) <= cfg.flags.rhrSameDeltaBpm);
      if (comparable.length < 8) return null;

      const half = Math.floor(comparable.length / 2);
      const before = median(comparable.slice(0, half).map((day) => day.estimateKcal));
      const after = median(comparable.slice(half).map((day) => day.estimateKcal));
      if (!before || !after) return null;
      const jumpPct = Math.abs(after - before) / before * 100;
      return jumpPct > cfg.flags.deviceChangeJumpPct
        ? { since: comparable[half].date, params: { jumpPct, before, after } }
        : null;
    },
  },
  {
    code: 'DISTRIBUTION_SHIFT',
    level: 'info',
    suggestedAction: 'REVIEW_CONTEXT',
    detect(state, cfg) {
      const current = median(lastNDays(state.days, state.now, cfg.history.windowDays)
        .filter((day) => Number.isFinite(day.estimateKcal)).map((day) => day.estimateKcal));
      if (current == null) return null;

      // Same recent one year back, from the longer history the caller supplies.
      const yearAgo = new Date(state.now);
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      const priorDays = lastNDays(state.historyDays ?? state.days, yearAgo, cfg.history.windowDays);
      const prior = median(priorDays.filter((day) => Number.isFinite(day.estimateKcal)).map((day) => day.estimateKcal));
      if (prior == null || priorDays.length < cfg.history.windowDays / 2) return null;

      const shiftPct = Math.abs(current - prior) / prior * 100;
      return shiftPct > cfg.flags.distributionShiftPct
        ? { since: null, params: { shiftPct, current, prior } }
        : null;
    },
  },
  {
    code: 'NON_REPRESENTATIVE_DATA',
    level: 'info',
    suggestedAction: 'REVIEW_CONTEXT',
    detect(state, cfg) {
      const recent = lastNDays(state.days, state.now, cfg.calibration.windowDays);
      if (!recent.length) return null;
      const excluded = recent.filter((day) => !isRepresentative(day.date, cfg));
      const pct = (excluded.length / recent.length) * 100;
      return pct > cfg.flags.nonRepresentativeMaxPct
        ? { since: firstDateWhere(recent, (day) => !isRepresentative(day.date, cfg)), params: { pct, maximum: cfg.flags.nonRepresentativeMaxPct } }
        : null;
    },
  },
];

// EA per day over the last week, computed here rather than taken from the
// caller so there is one implementation of the metric.
function eaDays(state, cfg) {
  const { ffmKg, bodyFatPct } = state.body ?? {};
  const factor = state.calibration?.factor ?? 1;
  return lastNDays(state.days, state.now, 7)
    .filter((day) => Number.isFinite(day.intakeKcal))
    .map((day) => ({
      date: day.date,
      ...energyAvailability({ intakeKcal: day.intakeKcal, exerciseKcal: day.exerciseKcal ?? 0, factor, ffmKg, bodyFatPct }, cfg),
    }))
    .filter((day) => day.eaKcalPerKgFfm != null);
}

const LEVEL_RANK = { stop: 0, warn: 1, info: 2 };

// Most severe first, so a caller that shows only the top flag shows the one
// that matters. A detector that throws is contained: one broken input must not
// take the whole warning system down with it.
export function evaluateFlags(state, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const input = { now: null, days: [], ...(state ?? {}) };
  const out = [];
  for (const definition of FLAG_DEFINITIONS) {
    let hit = null;
    try {
      hit = definition.detect(input, cfg);
    } catch {
      hit = null;
    }
    if (hit) {
      out.push({
        code: definition.code,
        level: definition.level,
        suggestedAction: definition.suggestedAction,
        since: hit.since ?? null,
        params: hit.params ?? {},
      });
    }
  }
  return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

export const FLAG_CODES = FLAG_DEFINITIONS.map((definition) => definition.code);
export const SUGGESTED_ACTIONS = [...new Set(FLAG_DEFINITIONS.map((d) => d.suggestedAction))];
