// Bounds for what a person can type into a day. Nothing checked these before,
// so 75 % body fat stored happily — physiologically impossible, and it does not
// announce itself: it silently distorts fat-free mass, and through it the
// protein target and the Katch/Cunningham BMR, for as long as the row survives.
// That is the failure mode this module exists for. A wrong number that stops the
// app is a nuisance; a wrong number the app believes is a corrupted measurement
// series that only shows up weeks later in the calibration.
//
// Two tiers, because "impossible" and "unusual" deserve different answers:
//
//   hard       outside what a human body or a day of eating can be. Refused —
//              the field is not written. Better an empty day than a poisoned one.
//   plausible  possible but surprising. Stored, and said out loud. A 36-hour
//              fast is a real 0 kcal day and the app must not argue with it,
//              but it should not be a typo passing unremarked either.
//
// The domain emits { field, level, code, params } and never a sentence; the
// wording lives in i18n/de.json like every other message in this module.
import { daysBetween } from './trend.js';

// Sources for the hard edges. They are deliberately wider than any athlete this
// app is built for — the tier exists to catch typos and unit mix-ups, not to
// referee anyone's physiology.
export const DAY_BOUNDS = {
  weightKg: {
    hard: [20, 400],
    plausible: [40, 200],
    source: 'Heaviest and lightest documented adult body masses, rounded well outside them.',
    evidenceLevel: 'assumption',
  },
  bodyFatPct: {
    hard: [3, 65],
    plausible: [5, 50],
    // Essential fat is about 3 % in men and 10–13 % in women; contest-lean men
    // reach 3–4 %. Anything under 3 is a fraction typed as a percentage (0.18).
    // The ceiling sits past documented extreme obesity (around 60 %) and well
    // past anything this app will meet — but below the 75 % that prompted all
    // of this, which must be refused rather than merely remarked on.
    source: 'Essential body fat (ACSM); ceiling beyond documented extreme-obesity values.',
    evidenceLevel: 'moderate',
  },
  kcal: {
    hard: [0, 25000],
    // Zero is a real fasting day, so it is plausible-low rather than refused.
    // Grand-tour stages run near 9000 kcal; multi-day ultra events higher still.
    plausible: [800, 8000],
    source: 'Measured intakes in grand-tour and ultra-endurance athletes.',
    evidenceLevel: 'moderate',
  },
  // Expenditure, not intake. The floor is a resting day for a small adult; the
  // plausible ceiling clears a hard training day for a large one without
  // reaching the multi-day-ultra figures the hard bound still allows.
  totalKcal: {
    hard: [500, 15000],
    plausible: [1200, 6000],
    source: 'Resting metabolic rate at the low end; measured expenditure in endurance athletes at the high end.',
    evidenceLevel: 'moderate',
  },
  // Active calories for one day. Zero is a rest day and entirely normal.
  exerciseKcal: {
    hard: [0, 10000],
    plausible: [0, 3000],
    source: 'Bounded by the daily expenditure figures above, less resting metabolism.',
    evidenceLevel: 'assumption',
  },
  proteinG: { hard: [0, 1500], plausible: [20, 400], source: 'Derived from the kcal bound at 4 kcal/g.', evidenceLevel: 'assumption' },
  fatG: { hard: [0, 1500], plausible: [10, 300], source: 'Derived from the kcal bound at 9 kcal/g.', evidenceLevel: 'assumption' },
  carbsG: { hard: [0, 3000], plausible: [20, 1200], source: 'Derived from the kcal bound at 4 kcal/g.', evidenceLevel: 'assumption' },
  fiberG: { hard: [0, 500], plausible: [0, 100], source: 'Well above any recorded habitual intake.', evidenceLevel: 'assumption' },
  alcoholG: {
    hard: [0, 1000],
    // 200 g is roughly 20 standard drinks. The upper plausible edge is a health
    // statement as much as a data one.
    plausible: [0, 200],
    source: 'Standard-drink equivalents; the plausible ceiling is near documented acute-toxicity ranges.',
    evidenceLevel: 'moderate',
  },
};

// How far a value may move from the last recorded one before it reads as a typo
// rather than a measurement. Weight genuinely swings up to about 2 kg overnight
// on hydration, glycogen and gut content alone, so the allowance starts there
// and widens with the gap — but stops widening, or a long gap would excuse any
// number at all.
const DRIFT = {
  weightKg: { base: 2, perDay: 1, cap: 10 },
  // Bioimpedance is far noisier than a scale; several points day to day is
  // normal and says more about hydration than about fat.
  bodyFatPct: { base: 3, perDay: 0.5, cap: 10 },
};

export function driftAllowance(field, gapDays) {
  const rule = DRIFT[field];
  if (!rule) return null;
  const gap = Number.isFinite(gapDays) && gapDays > 0 ? gapDays : 1;
  return Math.min(rule.base + rule.perDay * gap, rule.cap);
}

// One field on its own. Returns null when there is nothing to say.
export function checkField(field, value) {
  const bounds = DAY_BOUNDS[field];
  if (!bounds || value == null) return null;
  if (!Number.isFinite(value)) return { field, level: 'error', code: 'DAY_NOT_A_NUMBER', params: { field } };

  const [hardMin, hardMax] = bounds.hard;
  if (value < hardMin) return { field, level: 'error', code: 'DAY_BELOW_HARD_MIN', params: { field, value, min: hardMin } };
  if (value > hardMax) return { field, level: 'error', code: 'DAY_ABOVE_HARD_MAX', params: { field, value, max: hardMax } };

  const [lowMin, lowMax] = bounds.plausible;
  if (value < lowMin) return { field, level: 'warn', code: 'DAY_UNUSUALLY_LOW', params: { field, value, min: lowMin } };
  if (value > lowMax) return { field, level: 'warn', code: 'DAY_UNUSUALLY_HIGH', params: { field, value, max: lowMax } };
  return null;
}

// A field against what was recorded before it. This is the check that earns its
// keep in practice: a value inside every bound can still be a slipped digit,
// and the previous weigh-in is the only thing that knows.
export function checkDrift(field, value, previous) {
  const allowance = driftAllowance(field, previous ? daysBetween(previous.date, value?.date) : null);
  if (allowance == null || !previous || !Number.isFinite(value?.value) || !Number.isFinite(previous.value)) return null;
  const delta = value.value - previous.value;
  if (Math.abs(delta) <= allowance) return null;
  return {
    field,
    level: 'warn',
    code: 'DAY_JUMPED',
    params: { field, from: previous.value, to: value.value, delta: Math.abs(delta), days: daysBetween(previous.date, value.date) },
  };
}

// Everything wrong with one day, given the rows before it. Errors first, so a UI
// that shows only the first issue per field shows the blocking one.
export function checkDay(day, { history = [] } = {}) {
  const issues = [];
  for (const field of Object.keys(DAY_BOUNDS)) {
    const value = day?.[field];
    if (value == null) continue;
    const bound = checkField(field, value);
    if (bound) { issues.push(bound); if (bound.level === 'error') continue; }

    const earlier = history
      .filter((row) => row.date < day.date && Number.isFinite(row[field]))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const drift = earlier && checkDrift(field, { value, date: day.date }, { value: earlier[field], date: earlier.date });
    if (drift) issues.push(drift);
  }
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

// The day as it may be stored: refused fields dropped, everything else kept.
// Dropping rather than rejecting the whole row matters with autosave — one
// impossible body-fat reading must not also throw away the weight typed beside
// it, and a row the app refuses to hold is better than one it quietly believes.
export function sanitizeDay(day, { history = [] } = {}) {
  const issues = checkDay(day, { history });
  const refused = new Set(issues.filter((i) => i.level === 'error').map((i) => i.field));
  const clean = { ...day };
  for (const field of refused) clean[field] = null;
  return { day: clean, issues, refused: [...refused] };
}
