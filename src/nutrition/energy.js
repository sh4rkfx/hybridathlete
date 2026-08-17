// BMR formulas, Atwater intake derivation, TEF from macros and the TDEE
// composition (kickoff "Vorgehen" step 2). Pure module: no IO, no globals.
//
// Every constant here has an entry in ./sources.json with a literature anchor
// and an evidence level, mirroring the contract src/rules/catalog.json carries
// for the planning rules. Nothing in this file is invented; where the kickoff
// leaves a coefficient unspecified (alcohol TEF) the gap is documented rather
// than filled with a guess.
//
// Shapes:
//   profile     { birthDate, sex, heightCm, bodyComp: { mode, value } }
//   IntakeEntry { date, kcal, proteinG, fatG, carbsG, fiberG, alcoholG }
// All masses kg, heights cm, energies kcal — see config.js on units.
import { DEFAULT_CONFIG } from './config.js';

const MS_PER_YEAR = 365.2425 * 24 * 3600 * 1000;

export function ageYears(birthDate, now) {
  if (birthDate == null || now == null) return null;
  const years = (new Date(now) - new Date(birthDate)) / MS_PER_YEAR;
  return Number.isFinite(years) ? years : null;
}

// Fat-free mass from whichever body-composition mode the profile uses.
// 'none' yields null, which is what makes Katch and Cunningham unavailable.
export function ffmKg(profile, weightKg) {
  const comp = profile?.bodyComp;
  if (!comp || comp.mode === 'none' || !Number.isFinite(comp.value)) return null;
  if (comp.mode === 'ffm') return comp.value;
  if (comp.mode === 'bodyFatPct' && Number.isFinite(weightKg)) return weightKg * (1 - comp.value / 100);
  return null;
}

export function fatMassKg(profile, weightKg) {
  const ffm = ffmKg(profile, weightKg);
  if (ffm == null || !Number.isFinite(weightKg)) return null;
  return Math.max(0, weightKg - ffm);
}

export function bodyFatPct(profile, weightKg) {
  const comp = profile?.bodyComp;
  if (comp?.mode === 'bodyFatPct' && Number.isFinite(comp.value)) return comp.value;
  const fat = fatMassKg(profile, weightKg);
  if (fat == null || !weightKg) return null;
  return (fat / weightKg) * 100;
}

// The sex term differs by 166 kcal between the Mifflin variants. For
// 'unspecified' we take the midpoint rather than picking a side: biasing it
// "for safety" would be an invention, and the value feeds both the intake floor
// (where higher is safer) and the formula TDEE estimate (where lower is safer),
// so there is no direction that is conservative in both.
function sexSplit(profile, male, female) {
  if (profile?.sex === 'male') return male;
  if (profile?.sex === 'female') return female;
  return (male + female) / 2;
}

export function bmrMifflin(profile, weightKg, now) {
  const age = ageYears(profile?.birthDate, now);
  const h = profile?.heightCm;
  if (!Number.isFinite(weightKg) || !Number.isFinite(h) || age == null) return null;
  return 10 * weightKg + 6.25 * h - 5 * age + sexSplit(profile, 5, -161);
}

export function bmrOwen(profile, weightKg) {
  if (!Number.isFinite(weightKg)) return null;
  return sexSplit(profile, 879 + 10.2 * weightKg, 795 + 7.18 * weightKg);
}

export function bmrKatch(ffm) {
  return Number.isFinite(ffm) ? 370 + 21.6 * ffm : null;
}

// Overestimates on modern cohorts — selectable, never a default (see config.js
// WARN_FORMULAS and the CONFIG_BMR_FORMULA_OVERESTIMATES warning).
export function bmrHarris(profile, weightKg, now) {
  const age = ageYears(profile?.birthDate, now);
  const h = profile?.heightCm;
  if (!Number.isFinite(weightKg) || !Number.isFinite(h) || age == null) return null;
  return sexSplit(
    profile,
    66.473 + 13.7516 * weightKg + 5.0033 * h - 6.755 * age,
    655.0955 + 9.5634 * weightKg + 1.8496 * h - 4.6756 * age,
  );
}

export function bmrCunningham(ffm) {
  return Number.isFinite(ffm) ? 500 + 22 * ffm : null;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Resolves config.energy.bmrFormula against the profile. 'median' takes the
// median of Mifflin, Owen and Katch — and of whichever subset is available, so
// a profile without body composition degrades to the midpoint of the other two
// instead of failing (config.js reports that as CONFIG_MEDIAN_WITHOUT_KATCH).
// Returns null when the profile lacks what the chosen formula needs; callers
// must handle that rather than substituting a number.
export function bmr(config, weightKg, now) {
  const cfg = config ?? DEFAULT_CONFIG;
  const profile = cfg.profile;
  const formula = cfg.energy?.bmrFormula ?? 'median';
  const ffm = ffmKg(profile, weightKg);

  if (formula === 'custom') {
    const kcal = cfg.energy?.customBmrKcal;
    return { kcal: Number.isFinite(kcal) ? kcal : null, formula, parts: {} };
  }

  const parts = {
    mifflin: bmrMifflin(profile, weightKg, now),
    owen: bmrOwen(profile, weightKg),
    katch: bmrKatch(ffm),
    harris: bmrHarris(profile, weightKg, now),
    cunningham: bmrCunningham(ffm),
  };

  if (formula !== 'median') return { kcal: parts[formula] ?? null, formula, parts };

  const used = ['mifflin', 'owen', 'katch'].filter((k) => Number.isFinite(parts[k]));
  return { kcal: median(used.map((k) => parts[k])), formula, parts, usedFormulas: used };
}

// --- Intake ----------------------------------------------------------------

const MACRO_KEYS = ['proteinG', 'fatG', 'carbsG'];

export function hasCompleteMacros(entry) {
  return MACRO_KEYS.every((k) => Number.isFinite(entry?.[k]));
}

// Per-macro energy in kcal. `fiberInCarbs` decides whether carbsG already
// contains the fibre grams — if it does they are subtracted out and re-added at
// the fibre factor, which is the whole point of the EU/US distinction.
// A missing fiberG is treated as 0, i.e. all carbohydrate counts at the carb
// factor; that is the same assumption a label without a fibre line makes.
export function macroKcalBreakdown(entry, config) {
  const at = (config ?? DEFAULT_CONFIG).intake.atwater;
  const fiberInCarbs = (config ?? DEFAULT_CONFIG).intake.fiberInCarbs;
  const g = (key) => (Number.isFinite(entry?.[key]) ? entry[key] : 0);

  const fiberG = g('fiberG');
  const carbsG = fiberInCarbs ? Math.max(0, g('carbsG') - fiberG) : g('carbsG');

  const parts = {
    protein: g('proteinG') * at.protein,
    fat: g('fatG') * at.fat,
    carbs: carbsG * at.carbs,
    fiber: fiberG * at.fiber,
    alcohol: g('alcoholG') * at.alcohol,
  };
  parts.total = parts.protein + parts.fat + parts.carbs + parts.fiber + parts.alcohol;
  return parts;
}

export function derivedIntakeKcal(entry, config) {
  return hasCompleteMacros(entry) ? macroKcalBreakdown(entry, config).total : null;
}

// Kickoff "Zufuhr" 1-3. Returns both numbers whenever both exist, so the UI can
// show the discrepancy instead of silently picking a winner; `mismatch` is what
// step 6 turns into MACRO_KCAL_MISMATCH.
export function reconcileIntake(entry, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const { entryMode, reconciliation } = cfg.intake;
  const entered = Number.isFinite(entry?.kcal) ? entry.kcal : null;
  const derived = derivedIntakeKcal(entry, cfg);

  let mismatchPct = null;
  if (entered != null && derived != null && entered !== 0) {
    mismatchPct = Math.abs(derived - entered) / Math.abs(entered) * 100;
  }
  const mismatch = mismatchPct != null && mismatchPct > reconciliation.mismatchTolerancePct;

  let kcal = null;
  let source = 'none';
  if (entryMode === 'kcal') {
    if (entered != null) { kcal = entered; source = 'entered'; }
  } else if (entryMode === 'macros') {
    if (derived != null) { kcal = derived; source = 'derived'; }
  } else if (derived != null && (entered == null || reconciliation.preferDerivedWhenComplete)) {
    kcal = derived; source = 'derived';
  } else if (entered != null) {
    kcal = entered; source = 'entered';
  }

  return { kcal, source, enteredKcal: entered, derivedKcal: derived, mismatchPct, mismatch };
}

// --- TEF -------------------------------------------------------------------

// Westerterp 2004: protein 25 %, carbohydrate 8 %, fat 2 % of the energy from
// that macro. Alcohol has no coefficient in the kickoff and is therefore
// counted at 0 %, which makes the result a slight underestimate — see the
// documented gap on `tef_macros` in sources.json.
export const TEF_COEFFICIENTS = { protein: 0.25, carbs: 0.08, fiber: 0.08, fat: 0.02, alcohol: 0 };
export const TEF_FALLBACK_FRACTION = 0.10;

// `includesTef` comes from the data source's capabilities: PAL-based estimates
// already contain thermogenesis, wearable active-energy figures do not. Adding
// it twice is worth ~240 kcal/day, which the kickoff calls the most likely
// single error in the whole module.
export function tefKcal(entry, config, { includesTef = false } = {}) {
  if (includesTef) return { kcal: 0, source: 'suppressed' };
  const cfg = config ?? DEFAULT_CONFIG;

  if (hasCompleteMacros(entry)) {
    const parts = macroKcalBreakdown(entry, cfg);
    const kcal = Object.entries(TEF_COEFFICIENTS)
      .reduce((sum, [key, coefficient]) => sum + parts[key] * coefficient, 0);
    return { kcal, source: 'macros' };
  }

  const intake = reconcileIntake(entry, cfg).kcal;
  if (intake == null) return { kcal: 0, source: 'none' };
  return { kcal: intake * TEF_FALLBACK_FRACTION, source: 'fallback' };
}

// --- TDEE ------------------------------------------------------------------

// Components sum to the daily total. `tefKcal` is dropped rather than added
// when the source already includes it, so callers can pass it unconditionally.
export function tdeeComposition({ bmrKcal, activityKcal = 0, tefKcal: tef = 0, includesTef = false }) {
  const thermic = includesTef ? 0 : tef;
  const base = Number.isFinite(bmrKcal) ? bmrKcal : null;
  return {
    bmrKcal: base,
    activityKcal,
    tefKcal: thermic,
    totalKcal: base == null ? null : base + activityKcal + thermic,
  };
}

// FormulaAdapter path: BMR x PAL. A PAL factor is defined against total daily
// expenditure, so the result already contains thermogenesis — this is exactly
// the `includesTef: true` case.
export function formulaTdeeKcal(bmrKcal, palFactor) {
  if (!Number.isFinite(bmrKcal) || !Number.isFinite(palFactor)) return null;
  return bmrKcal * palFactor;
}
