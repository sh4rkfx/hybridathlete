// Energy availability (kickoff step 4, "Energieverfügbarkeit"). Pure module.
//
//   EA = (intake - training energy) / FFM        [kcal/kg FFM]
//
// A first-class daily metric, not a derived display value: it is the number
// that says whether a deficit is being paid for out of fat or out of the
// athlete, and the whole "full compensation" design exists to hold it steady.
//
// The training energy here is CALIBRATED (exerciseKcal x factor), not the raw
// figure the data source reports. Two reasons, and the first is the real one:
// the raw wearable number is precisely the one with known bias, so subtracting
// it from a calibrated intake would mix two scales. The second is that the
// kickoff's own +/- 1 kcal/kg constancy requirement is unreachable with the raw
// value — at factor 0.95 a 1500 kcal session moves EA by 1.55 kcal/kg. With the
// calibrated value the only residual is the compensation rounding, bounded and
// always downward.
import { DEFAULT_CONFIG } from './config.js';

export const REASONS = {
  NO_FFM: 'NO_FFM',
  NO_INTAKE: 'NO_INTAKE',
};

// The threshold, optionally lowered as body fat rises.
//
// DELIBERATE DEPARTURE FROM THE LITERATURE, flagged as such in sources.json
// (ea_threshold_taper) and in the kickoff. The 30 kcal/kg FFM cut-off comes
// from lean athlete cohorts (Loucks & Thuma 2003); at 28 % body fat there is
// ample endogenous energy and the flat threshold produces false positives.
// Concretely: the module's own recommended rest-day intake for the reference
// profile gives EA 28.2 kcal/kg FFM, so a flat 30 would raise EA_LOW every
// single rest day, indefinitely. Physiologically plausible, not evidence-based.
//
// 'unspecified' uses the female anchors, which keep the full threshold in force
// to a higher body fat and are therefore the more cautious of the two.
export function eaThresholdKcalPerKgFfm(config, bodyFatPct) {
  const cfg = config ?? DEFAULT_CONFIG;
  const base = cfg.flags.eaLowThreshold;
  if (!cfg.flags.eaBodyFatAware || !Number.isFinite(bodyFatPct)) return base;

  const taper = cfg.flags.eaThresholdTaper;
  const sex = cfg.profile?.sex === 'male' ? 'male' : 'female';
  const lean = taper.fullThresholdBelowBodyFatPct[sex];
  const high = taper.floorAtBodyFatPct[sex];
  const floor = Math.min(taper.minThresholdKcalPerKgFfm, base);

  if (bodyFatPct <= lean) return base;
  if (bodyFatPct >= high) return floor;
  return base - ((bodyFatPct - lean) / (high - lean)) * (base - floor);
}

// One day's energy availability. The `low` / `critical` booleans are per-day
// facts; the "5 of 7 days" and "3 consecutive days" aggregation that turns them
// into EA_LOW and EA_CRITICAL belongs to flags.js (step 6).
export function energyAvailability(input, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const { intakeKcal, exerciseKcal = 0, factor = 1, ffmKg, bodyFatPct } = input ?? {};
  const thresholdKcalPerKgFfm = eaThresholdKcalPerKgFfm(cfg, bodyFatPct);
  const criticalThresholdKcalPerKgFfm = thresholdKcalPerKgFfm - cfg.flags.eaCriticalMargin;
  const reasons = [];

  const calibratedExerciseKcal = Number.isFinite(exerciseKcal)
    ? exerciseKcal * (Number.isFinite(factor) ? factor : 1)
    : 0;

  if (!Number.isFinite(intakeKcal)) reasons.push(REASONS.NO_INTAKE);
  if (!Number.isFinite(ffmKg) || ffmKg <= 0) reasons.push(REASONS.NO_FFM);
  if (reasons.length) {
    return {
      eaKcalPerKgFfm: null, thresholdKcalPerKgFfm, criticalThresholdKcalPerKgFfm,
      low: false, critical: false, calibratedExerciseKcal, reasons,
    };
  }

  const eaKcalPerKgFfm = (intakeKcal - calibratedExerciseKcal) / ffmKg;
  return {
    eaKcalPerKgFfm,
    thresholdKcalPerKgFfm,
    criticalThresholdKcalPerKgFfm,
    low: eaKcalPerKgFfm < thresholdKcalPerKgFfm,
    critical: eaKcalPerKgFfm < criticalThresholdKcalPerKgFfm,
    calibratedExerciseKcal,
    reasons,
  };
}
