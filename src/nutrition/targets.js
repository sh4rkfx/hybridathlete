// Daily intake target, safety limits and the macro split (kickoff step 4,
// "Zielberechnung"). Pure module: no IO, no globals.
//
// Sign convention: `deficitKcal` is signed and positive means eating BELOW
// maintenance. A gain phase therefore carries a negative deficit, and
// `baseIntakeKcal = restTdeeKcal - deficitKcal` holds for cut, maintain and
// gain alike — one path, no mirrored branch to keep in step.
//
// The order of operations is the part most easily got wrong, and the kickoff is
// explicit about the last step: after a floor raises the intake, the deficit is
// RECOMPUTED from the intake that actually applies. Otherwise the app displays
// a deficit that is not in force.
//
// Reason codes are internal; flags.js (step 6) turns the user-facing ones into
// warnings, which is why they carry no de.json wording yet.
import { DEFAULT_CONFIG, autoRatePctBwPerWeek } from './config.js';
import { fatMassKg as fatMassOf, median } from './energy.js';

export const REASONS = {
  GOAL_REACHED: 'GOAL_REACHED',
  NO_REST_TDEE: 'NO_REST_TDEE',
  NO_BMR: 'NO_BMR',
  DEFICIT_CAPPED_FAT_MASS: 'DEFICIT_CAPPED_FAT_MASS',
  DEFICIT_CAPPED_ABSOLUTE: 'DEFICIT_CAPPED_ABSOLUTE',
  SURPLUS_CAPPED: 'SURPLUS_CAPPED',
  HARD_FLOOR_APPLIED: 'HARD_FLOOR_APPLIED',
  BELOW_SOFT_FLOOR: 'BELOW_SOFT_FLOOR',
  LEDGER_CORRECTION_CAPPED: 'LEDGER_CORRECTION_CAPPED',
  LEDGER_CORRECTION_CLIPPED_BY_FLOOR: 'LEDGER_CORRECTION_CLIPPED_BY_FLOOR',
  MACROS_FAT_REDUCED: 'MACROS_FAT_REDUCED',
  MACROS_PROTEIN_REDUCED: 'MACROS_PROTEIN_REDUCED',
  MACROS_INFEASIBLE: 'MACROS_INFEASIBLE',
  PROTEIN_BASIS_FELL_BACK: 'PROTEIN_BASIS_FELL_BACK',
  NO_EXPENDITURE_DATA: 'NO_EXPENDITURE_DATA',
};

// A session shorter than history.minSessionMinutes is a false start, not a
// training day (kickoff: "Fehlstarts fliegen raus"). Where minutes are unknown
// any recorded exercise energy is taken as a session.
export function isRestDay(day, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const minutes = day?.exerciseMinutes;
  if (Number.isFinite(minutes)) return minutes < cfg.history.minSessionMinutes;
  return !(Number.isFinite(day?.exerciseKcal) && day.exerciseKcal > 0);
}

// Rest-day TDEE: the median of the days without a session, calibrated. Median
// rather than mean because one mountain day misclassified as a rest day would
// otherwise move the base intake for weeks.
export function restDayTdeeKcal(days, config, factor = 1) {
  const cfg = config ?? DEFAULT_CONFIG;
  const values = (days ?? [])
    .filter((day) => isRestDay(day, cfg) && Number.isFinite(day?.estimateKcal))
    .map((day) => day.estimateKcal * factor);
  return median(values);
}

export function deficitKcalPerDay(ratePctBwPerWeek, weightKg, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  if (!Number.isFinite(ratePctBwPerWeek) || !Number.isFinite(weightKg)) return 0;
  return (ratePctBwPerWeek / 100) * weightKg / 7 * cfg.calibration.energyDensityKcalPerKg;
}

// Which phase is in force. `auto` scales continuously with body fat (config.js
// owns the curve so it shares the safety table); `manual` walks the configured
// ladder. Returns rate 0 once the goal weight is reached in the goal direction.
export function phaseFor({ weightKg, bodyFatPct }, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const gaining = cfg.goal.mode === 'gain';
  if (cfg.goal.mode === 'maintain') return { mode: 'maintain', name: null, ratePctBwPerWeek: 0, reached: false };

  const goalKg = cfg.goal.target?.valueKg;
  const reached = Number.isFinite(goalKg) && Number.isFinite(weightKg)
    && (gaining ? weightKg >= goalKg : weightKg <= goalKg);
  if (reached) return { mode: cfg.goal.mode, name: null, ratePctBwPerWeek: 0, reached: true };

  if (cfg.phases.auto) {
    return { mode: 'auto', name: null, ratePctBwPerWeek: autoRatePctBwPerWeek(cfg, bodyFatPct), reached: false };
  }

  // The first rung not yet passed, in the direction of travel.
  const ladder = cfg.phases.manual ?? [];
  const active = ladder.find((phase) => (gaining
    ? phase.untilWeightKg > weightKg
    : phase.untilWeightKg < weightKg));
  if (!active) return { mode: 'manual', name: null, ratePctBwPerWeek: 0, reached: true };
  return { mode: 'manual', name: active.name, ratePctBwPerWeek: active.ratePctBwPerWeek, reached: false };
}

export function dailyTarget(input, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const {
    restTdeeKcal, bmrKcal, weightKg, bodyFatPct, ffmKg, ledgerCorrectionKcal = 0,
  } = input ?? {};
  const reasons = [];
  const gaining = cfg.goal.mode === 'gain';

  if (!Number.isFinite(restTdeeKcal)) {
    return { baseIntakeKcal: null, targetIntakeKcal: null, deficitKcal: null, phase: null, reasons: [REASONS.NO_REST_TDEE] };
  }

  const phase = phaseFor({ weightKg, bodyFatPct }, cfg);
  if (phase.reached) reasons.push(REASONS.GOAL_REACHED);

  // 1. rate -> raw energy delta
  let deficit = deficitKcalPerDay(phase.ratePctBwPerWeek, weightKg, cfg);
  const requestedDeficitKcal = gaining ? -deficit : deficit;

  // 2. ceilings. Fat tissue can only release so much per day; past that the
  //    body takes muscle protein instead (kickoff, maxDeficit fatMassAware).
  const fatMass = fatMassOf({ bodyComp: { mode: 'bodyFatPct', value: bodyFatPct } }, weightKg)
    ?? (Number.isFinite(ffmKg) && Number.isFinite(weightKg) ? Math.max(0, weightKg - ffmKg) : null);
  const caps = { fatMassKcal: null, absoluteKcal: null, surplusKcal: null };

  if (gaining) {
    caps.surplusKcal = cfg.safety.maxSurplusKcal;
    if (deficit > caps.surplusKcal) { deficit = caps.surplusKcal; reasons.push(REASONS.SURPLUS_CAPPED); }
    deficit = -deficit;
  } else {
    if (cfg.safety.maxDeficit.mode === 'fatMassAware' && Number.isFinite(fatMass)) {
      caps.fatMassKcal = cfg.safety.maxDeficit.kcalPerKgFatMass * fatMass;
      if (deficit > caps.fatMassKcal) { deficit = caps.fatMassKcal; reasons.push(REASONS.DEFICIT_CAPPED_FAT_MASS); }
    }
    caps.absoluteKcal = cfg.safety.maxDeficit.absoluteCapKcal;
    if (deficit > caps.absoluteKcal) { deficit = caps.absoluteKcal; reasons.push(REASONS.DEFICIT_CAPPED_ABSOLUTE); }
  }

  // 3-5. base, hard floor, then recompute the deficit from what actually applies
  let baseIntakeKcal = restTdeeKcal - deficit;
  const floor = { hard: null, soft: null, applied: false };
  if (Number.isFinite(bmrKcal)) {
    floor.hard = cfg.safety.intakeFloor.hardFloorBmrMultiple * bmrKcal;
    floor.soft = cfg.safety.intakeFloor.bmrMultiple * bmrKcal;
    if (baseIntakeKcal < floor.hard) {
      baseIntakeKcal = floor.hard;
      floor.applied = true;
      reasons.push(REASONS.HARD_FLOOR_APPLIED);
    }
    // 6. The soft floor warns and changes nothing — the two multiples have
    //    different jobs, or the second would be dead config.
    if (baseIntakeKcal < floor.soft) reasons.push(REASONS.BELOW_SOFT_FLOOR);
  } else {
    reasons.push(REASONS.NO_BMR);
  }
  const deficitKcal = restTdeeKcal - baseIntakeKcal;

  // 7. ledger correction, capped, and never through the hard floor
  let correction = ledgerCorrectionKcal ?? 0;
  const maxCorrection = cfg.ledger.maxDailyCorrectionKcal;
  if (Math.abs(correction) > maxCorrection) {
    correction = Math.sign(correction) * maxCorrection;
    reasons.push(REASONS.LEDGER_CORRECTION_CAPPED);
  }
  let targetIntakeKcal = baseIntakeKcal + correction;
  if (floor.hard != null && targetIntakeKcal < floor.hard) {
    targetIntakeKcal = floor.hard;
    reasons.push(REASONS.LEDGER_CORRECTION_CLIPPED_BY_FLOOR);
  }

  return {
    baseIntakeKcal,
    targetIntakeKcal,
    deficitKcal,
    requestedDeficitKcal,
    effectiveDeficitKcal: restTdeeKcal - targetIntakeKcal,
    ratePctBwPerWeek: phase.ratePctBwPerWeek,
    phase,
    floor,
    caps,
    ledgerCorrectionKcal: correction,
    // What the correction actually achieved once the floor had its say. The
    // requested figure above can be larger, and a UI that shows the request
    // instead of the effect prints a breakdown that does not add up:
    // restTdee - deficit + requested != target whenever the floor clips.
    appliedLedgerCorrectionKcal: targetIntakeKcal - baseIntakeKcal,
    restTdeeKcal,
    reasons,
  };
}

function gramsFor(basis, value, { weightKg, ffmKg, intakeKcal, kcalPerGram }) {
  if (basis === 'absolute') return value;
  if (basis === 'ffm') return Number.isFinite(ffmKg) ? value * ffmKg : null;
  if (basis === 'bodyweight') return Number.isFinite(weightKg) ? value * weightKg : null;
  if (basis === 'pctKcal') return Number.isFinite(intakeKcal) ? (value / 100) * intakeKcal / kcalPerGram : null;
  return null;
}

// Protein and fat first, carbohydrate as the remainder (kickoff
// "Zielberechnung" 5). If the remainder falls below carbs.minG the order of
// concessions is fixed: fat down to its minimum, then protein down to the
// bodyweight floor, then refuse. Protein last because it is the macro the
// deficit is there to protect.
export function macroTargets(intakeKcal, body, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const at = cfg.intake.atwater;
  const { weightKg, ffmKg } = body ?? {};
  const adjustments = [];
  if (!Number.isFinite(intakeKcal)) return { proteinG: null, fatG: null, carbsG: null, fiberG: null, adjustments, error: REASONS.MACROS_INFEASIBLE };

  const proteinFloorG = Number.isFinite(weightKg) ? cfg.macros.protein.minGPerKgBw * weightKg : 0;
  let proteinG = gramsFor(cfg.macros.protein.basis, cfg.macros.protein.value, { weightKg, ffmKg, intakeKcal, kcalPerGram: at.protein });
  if (proteinG == null) {
    // No body composition: the bodyweight floor is exactly what it is for.
    proteinG = proteinFloorG;
    adjustments.push(REASONS.PROTEIN_BASIS_FELL_BACK);
  }
  let fatG = gramsFor(cfg.macros.fat.basis, cfg.macros.fat.value, { weightKg, ffmKg, intakeKcal, kcalPerGram: at.fat })
    ?? cfg.macros.fat.minG;

  const carbsFrom = () => (intakeKcal - proteinG * at.protein - fatG * at.fat) / at.carbs;
  let carbsG = carbsFrom();

  if (carbsG < cfg.macros.carbs.minG) {
    const fatFloor = cfg.macros.fat.minG;
    if (fatG > fatFloor) {
      const needKcal = (cfg.macros.carbs.minG - carbsG) * at.carbs;
      const freed = Math.min(needKcal, (fatG - fatFloor) * at.fat);
      fatG -= freed / at.fat;
      adjustments.push(REASONS.MACROS_FAT_REDUCED);
      carbsG = carbsFrom();
    }
  }
  if (carbsG < cfg.macros.carbs.minG && proteinG > proteinFloorG) {
    const needKcal = (cfg.macros.carbs.minG - carbsG) * at.carbs;
    const freed = Math.min(needKcal, (proteinG - proteinFloorG) * at.protein);
    proteinG -= freed / at.protein;
    adjustments.push(REASONS.MACROS_PROTEIN_REDUCED);
    carbsG = carbsFrom();
  }

  const error = carbsG < cfg.macros.carbs.minG ? REASONS.MACROS_INFEASIBLE : null;

  return {
    proteinG,
    fatG,
    carbsG,
    fiberG: (cfg.macros.fiberGPer1000Kcal * intakeKcal) / 1000,
    kcal: { protein: proteinG * at.protein, fat: fatG * at.fat, carbs: carbsG * at.carbs },
    adjustments,
    error,
  };
}

function roundKcal(value, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const step = cfg.compensation.roundingStepKcal;
  if (!step) return value;
  return cfg.compensation.roundingDirection === 'nearest'
    ? Math.round(value / step) * step
    : Math.floor(value / step) * step;
}

// Compensation for a session's energy, calibrated (kickoff "Basiszufuhr plus
// volle Kompensation"). Rounding DOWN is the asymmetry principle: errors are
// meant to fall on the under-compensated side every time, not on average.
// Missing expenditure data compensates nothing — no estimate, no assumption.
export function compensationKcal(exerciseKcal, factor, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  if (!Number.isFinite(exerciseKcal) || exerciseKcal <= 0) {
    return { kcal: 0, calibratedKcal: 0, reasons: [REASONS.NO_EXPENDITURE_DATA] };
  }
  const calibratedKcal = exerciseKcal * (Number.isFinite(factor) ? factor : 1);
  const share = { full: 1, partial: cfg.compensation.partialFraction, none: 0 }[cfg.compensation.rule] ?? 1;
  return { kcal: Math.max(0, roundKcal(calibratedKcal * share, cfg)), calibratedKcal, reasons: [] };
}
