// R9 — Load progression (story #47): double progression over ALL sets with
// RIR-scaled increments sized by equipment class × primary-muscle size.
// Pure function; thresholds live in rules/catalog.json (R9 params).
//
// Evidence framing (see R9 in the catalog): the autoregulation PRINCIPLE
// (RIR/RPE-guided load beats fixed %1RM) carries meta-analytic support; the
// concrete step sizes are practical equipment constraints (tunable, honest
// expert-consensus). Epley e1RM is an estimate, never a tested max.
import { GOAL_SCHEMES, catalogOf } from './catalog.js';
import { ruleParams } from '../rules/params.js';

export const e1rmEpley = (w, reps) => w * (1 + reps / 29);

export function muscleSizeOf(exercise, params = ruleParams('R9')) {
  const primary = Object.keys(exercise.load).sort((a, b) => exercise.load[b] - exercise.load[a])[0];
  return params.largeMuscleRegions.includes(primary) ? 'large' : 'small';
}

export function incrementFor(exercise, params = ruleParams('R9')) {
  const equipment = exercise.equipment?.[0] ?? 'barbell';
  const size = muscleSizeOf(exercise, params);
  const step = params.increments[equipment]?.[size] ?? params.increments.barbell[size];
  return { equipment, size, step };
}

const roundToStep = (w, step) => (step > 0 ? Math.round(w / step) * step : w);

// sets: [{ w, reps }, ...] · rir: reps in reserve of the LAST set (0..3 = 3+)
export function progressionAdvice({ exerciseId, sets, rir, goal }, state) {
  const catalog = catalogOf(state);
  const e = catalog.exById[exerciseId];
  if (!e || !sets?.length) return null;
  const params = ruleParams('R9');
  const [lo, hi] = GOAL_SCHEMES[goal]?.corridor ?? GOAL_SCHEMES.sport_support.corridor;
  const { equipment, size, step } = incrementFor(e, params);

  const topWeight = Math.max(...sets.map((s) => s.w));
  const minReps = Math.min(...sets.map((s) => s.reps));
  const allTop = sets.every((s) => s.reps >= hi);
  const allInCorridor = sets.every((s) => s.reps >= lo);
  const best = Math.max(...sets.map((s) => e1rmEpley(s.w, s.reps)));
  const base = {
    exerciseId, equipment, muscleSize: size, stepKg: step,
    corridor: [lo, hi], e1rm: Math.round(best * 10) / 10,
  };

  // Band/bodyweight: no external increments — progress via reps/variant.
  if (step === 0) {
    return { ...base, action: allTop ? 'add_reps_or_variant' : 'build_reps', nextWeight: topWeight,
      why: allTop
        ? `Korridor voll – ohne Zusatzlast geht Progression über mehr Wiederholungen oder eine schwerere Variante.`
        : `Schwächster Satz bei ${minReps} Wdh – Korridor ${lo}–${hi} erst füllen.` };
  }

  // Grind guard: RIR <= 1 means near-limit work — stabilize before loading.
  if (rir <= 1) {
    return { ...base, action: 'hold', nextWeight: topWeight,
      why: `RIR ${rir}: nahe am Limit gearbeitet – Last halten, Wiederholungen stabilisieren.` };
  }

  if (allTop) {
    const factor = params.rirStepFactors[String(Math.min(rir, 3))] ?? 1;
    const delta = factor * step;
    return { ...base, action: 'increase', nextWeight: roundToStep(topWeight + delta, step), deltaKg: delta,
      why: `Alle Sätze am Korridor-Ende (${hi}) bei RIR ${rir >= 3 ? '3+' : rir} ⇒ +${factor} ${equipment === 'machine' ? 'Steckstufe' : 'Schritt'}${factor > 1 ? 'e' : ''} (${delta} kg, ${equipment}/${size === 'large' ? 'große' : 'kleine'} Muskelgruppe).` };
  }

  // Clearly too light even mid-corridor: RIR 3+ across the board pulls the
  // increase forward by one step (the user-requested RIR scaling).
  if (rir >= params.earlyIncreaseMinRir && allInCorridor) {
    return { ...base, action: 'increase', nextWeight: roundToStep(topWeight + step, step), deltaKg: step,
      why: `RIR 3+ bei allen Sätzen im Korridor – zu leicht. Vorgezogene Steigerung um ${step} kg statt auf das Korridor-Ende zu warten.` };
  }

  return { ...base, action: 'build_reps', nextWeight: topWeight,
    why: `Schwächster Satz bei ${minReps} Wdh – noch ${hi - minReps} bis zur Laststeigerung (double progression).` };
}
