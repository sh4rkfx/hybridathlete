// Config schema, defaults, validation and migration for the energy module
// (kickoff "Konfigurationsschema"). Pure module: no IO, no globals, no DOM.
//
// Three contracts the rest of the module relies on:
//   1. An empty config must run. `validate({})` returns the full defaults.
//   2. Unknown fields survive a load/save roundtrip (forward compatibility) —
//      a config written by a newer app version must not be silently pruned.
//   3. `safety.*` are hardcaps. The user may be more conservative, never more
//      aggressive. Violations are reported AND clamped in `normalized`, so a
//      caller that ignores `valid` still cannot get an aggressive config.
//
// Values are always stored in SI (kg / cm / kcal). `units` is display-only,
// see the mass/height/energy converters at the bottom.
//
// Errors and warnings carry `{ path, code, params }` only. German wording lives
// in src/i18n/de.json under `nutrition.errors.*` — the domain stays text-free.

export const SCHEMA_VERSION = 1;

export const DEFAULT_CONFIG = {
  schemaVersion: SCHEMA_VERSION,
  locale: 'de-AT',
  units: { mass: 'kg', height: 'cm', energy: 'kcal' },

  // Neutral defaults: the kickoff's concrete numbers are the reference athlete,
  // not a default. A profile without anthropometrics validates — it just cannot
  // produce a BMR yet, which `validate` reports as a warning, not an error.
  profile: {
    birthDate: null,
    sex: 'unspecified',
    heightCm: null,
    bodyComp: { mode: 'none', value: null },
  },

  goal: {
    mode: 'maintain',
    target: { type: 'weight', valueKg: null },
  },

  phases: { auto: true, manual: [] },

  energy: {
    bmrFormula: 'median',
    customBmrKcal: null,
    palFactor: 1.55,
    adapterId: 'manual',
  },

  intake: {
    entryMode: 'auto',
    requireProtein: true,
    atwater: { protein: 4, carbs: 4, fat: 9, alcohol: 7, fiber: 2 },
    fiberInCarbs: true,
    reconciliation: { preferDerivedWhenComplete: true, mismatchTolerancePct: 5 },
  },

  calibration: {
    enabled: true,
    windowDays: 21,
    minDays: 14,
    trendMethod: 'linreg',
    emaHalfLifeDays: 7,
    energyDensityKcalPerKg: 7700,
    factorClamp: [0.70, 1.30],
    outlier: { method: 'mad', threshold: 3 },
    recalibrateEveryDays: 56,
    cycleAwareSmoothing: false,
    // Extension over the kickoff schema. The kickoff requires a smoothed factor
    // and a confidence level but does not say how either is computed, so the
    // thresholds live here rather than as literals in calibration.js.
    // ASSUMPTION: the confidence cut-offs are judgement, not literature.
    smoothing: { method: 'median3', deviationWarnPct: 8 },
    confidence: {
      highCoverage: 0.85,
      highMaxGapDays: 2,
      mediumCoverage: 0.70,
      mediumMaxGapDays: 4,
      maxPlausibleTrendKgPerDay: 0.3,
    },
  },

  compensation: {
    rule: 'full',
    partialFraction: 0.6,
    preSessionRedistributionKcal: 150,
    intraSessionCarbsGPerHour: 40,
    roundingDirection: 'down',
    roundingStepKcal: 50,
    noDeficitAboveActiveKcal: 800,
  },

  ledger: {
    enabled: true,
    windowDays: 7,
    maxDailyCorrectionKcal: 250,
    capKcal: 1200,
    surplusExpiresAfterDays: 14,
  },

  macros: {
    protein: { basis: 'ffm', value: 2.4, minGPerKgBw: 1.6 },
    fat: { basis: 'bodyweight', value: 0.8, minG: 50 },
    carbs: { mode: 'remainder', minG: 50 },
    cycling: {
      enabled: false,
      swingKcal: 180,
      trainingDayRule: { type: 'activeKcalThreshold', value: 500 },
    },
    fiberGPer1000Kcal: 14,
  },

  safety: {
    intakeFloor: { bmrMultiple: 1.1, hardFloorBmrMultiple: 1.0 },
    maxRate: { mode: 'bodyFatAware', fallbackPctBwPerWeek: 0.7 },
    maxDeficit: { mode: 'fatMassAware', kcalPerKgFatMass: 30, absoluteCapKcal: 1200 },
    maxSurplusKcal: 500,
    dietBreak: { auto: true, everyWeeks: 10, durationWeeks: 2 },
  },

  history: {
    windowDays: 180,
    minSessionMinutes: 20,
    deviceEras: [],
    trainingContext: { defaultLabel: 'normal', periods: [] },
  },

  flags: {
    rhrBaseline: 'auto',
    rhrHighDelta: 4,
    rhrLowDelta: -4,
    plateauDays: 21,
    trackingCoverageMin: 5,
    proteinMinGPerKgFfm: 2.0,
    eaLowThreshold: 30,
    eaBodyFatAware: true,
  },
};

// Body-fat-aware rate ceiling (kickoff "Zielberechnung" 4). Bands are ordered
// from the highest body fat down; the first match wins. `unspecified` uses the
// female thresholds because they are the more conservative of the two at any
// given body-fat percentage (at 32 % a male gets 1.2 %/week, a female 1.0 %).
export const MAX_RATE_BANDS = [
  { minPct: { male: 30, female: 40 }, maxPctBwPerWeek: 1.2 },
  { minPct: { male: 20, female: 30 }, maxPctBwPerWeek: 1.0 },
  { minPct: { male: 12, female: 22 }, maxPctBwPerWeek: 0.7 },
  { minPct: { male: 0, female: 0 }, maxPctBwPerWeek: 0.5 },
];

// `fallbackPctBwPerWeek` applies when the mode is 'fixed' or body fat is
// unknown — it does NOT cap the bands, or the table's 1.0 and 1.2 tiers could
// never be reached. The bands themselves are a module constant, so they are not
// user-reachable and need no SAFETY_BOUNDS entry.
export function maxRatePctBwPerWeek(config, bodyFatPct) {
  const safety = config?.safety?.maxRate ?? DEFAULT_CONFIG.safety.maxRate;
  if (safety.mode !== 'bodyFatAware' || !Number.isFinite(bodyFatPct)) return safety.fallbackPctBwPerWeek;
  const sex = config?.profile?.sex === 'male' ? 'male' : 'female';
  const band = MAX_RATE_BANDS.find((b) => bodyFatPct > b.minPct[sex]) ?? MAX_RATE_BANDS.at(-1);
  return band.maxPctBwPerWeek;
}

// Declarative hardcaps. `direction: 'max'` means the default is a ceiling (the
// user may only go lower), `'min'` means it is a floor (may only go higher).
// Data-driven on purpose, mirroring how src/rules/params.js reads thresholds
// from a catalog instead of hardcoding them per call site.
export const SAFETY_BOUNDS = [
  { path: 'safety.intakeFloor.bmrMultiple', direction: 'min' },
  { path: 'safety.intakeFloor.hardFloorBmrMultiple', direction: 'min' },
  { path: 'safety.maxRate.fallbackPctBwPerWeek', direction: 'max' },
  { path: 'safety.maxDeficit.kcalPerKgFatMass', direction: 'max' },
  { path: 'safety.maxDeficit.absoluteCapKcal', direction: 'max' },
  { path: 'safety.maxSurplusKcal', direction: 'max' },
  { path: 'safety.dietBreak.everyWeeks', direction: 'max' },
  { path: 'safety.dietBreak.durationWeeks', direction: 'min' },
];

// Per-field type/enum/range checks. Everything expressible here stays here;
// only genuine cross-field rules get bespoke code below.
const FIELD_SPECS = [
  { path: 'locale', type: 'string' },
  { path: 'units.mass', enum: ['kg', 'lb'] },
  { path: 'units.height', enum: ['cm', 'in'] },
  { path: 'units.energy', enum: ['kcal', 'kJ'] },

  { path: 'profile.birthDate', type: 'date', nullable: true },
  { path: 'profile.sex', enum: ['male', 'female', 'unspecified'] },
  { path: 'profile.heightCm', type: 'number', min: 50, max: 260, nullable: true },
  { path: 'profile.bodyComp.mode', enum: ['ffm', 'bodyFatPct', 'none'] },

  { path: 'goal.mode', enum: ['cut', 'maintain', 'gain'] },
  { path: 'goal.target.type', enum: ['weight', 'bodyFatPct', 'ffm'] },

  { path: 'phases.auto', type: 'boolean' },

  { path: 'energy.bmrFormula', enum: ['median', 'mifflin', 'owen', 'katch', 'harris', 'cunningham', 'custom'] },
  { path: 'energy.customBmrKcal', type: 'number', min: 500, max: 5000, nullable: true },
  { path: 'energy.palFactor', type: 'number', min: 1.0, max: 2.6 },
  { path: 'energy.adapterId', type: 'string' },

  { path: 'intake.entryMode', enum: ['kcal', 'macros', 'auto'] },
  { path: 'intake.requireProtein', type: 'boolean' },
  { path: 'intake.atwater.protein', type: 'number', min: 0, max: 12 },
  { path: 'intake.atwater.carbs', type: 'number', min: 0, max: 12 },
  { path: 'intake.atwater.fat', type: 'number', min: 0, max: 12 },
  { path: 'intake.atwater.alcohol', type: 'number', min: 0, max: 12 },
  { path: 'intake.atwater.fiber', type: 'number', min: 0, max: 12 },
  { path: 'intake.fiberInCarbs', type: 'boolean' },
  { path: 'intake.reconciliation.preferDerivedWhenComplete', type: 'boolean' },
  { path: 'intake.reconciliation.mismatchTolerancePct', type: 'number', min: 0, max: 100 },

  { path: 'calibration.enabled', type: 'boolean' },
  { path: 'calibration.windowDays', type: 'integer', min: 7, max: 365 },
  { path: 'calibration.minDays', type: 'integer', min: 3, max: 365 },
  { path: 'calibration.trendMethod', enum: ['linreg', 'ema'] },
  { path: 'calibration.emaHalfLifeDays', type: 'number', min: 1, max: 90 },
  { path: 'calibration.energyDensityKcalPerKg', type: 'number', min: 1000, max: 12000 },
  { path: 'calibration.outlier.method', enum: ['mad', 'none'] },
  { path: 'calibration.outlier.threshold', type: 'number', min: 1, max: 10 },
  { path: 'calibration.recalibrateEveryDays', type: 'integer', min: 7, max: 365 },
  { path: 'calibration.cycleAwareSmoothing', type: 'boolean' },
  { path: 'calibration.smoothing.method', enum: ['median3', 'latest'] },
  { path: 'calibration.smoothing.deviationWarnPct', type: 'number', min: 0, max: 100 },
  { path: 'calibration.confidence.highCoverage', type: 'number', min: 0, max: 1 },
  { path: 'calibration.confidence.mediumCoverage', type: 'number', min: 0, max: 1 },
  { path: 'calibration.confidence.highMaxGapDays', type: 'integer', min: 0, max: 365 },
  { path: 'calibration.confidence.mediumMaxGapDays', type: 'integer', min: 0, max: 365 },
  { path: 'calibration.confidence.maxPlausibleTrendKgPerDay', type: 'number', min: 0.01, max: 5 },

  { path: 'compensation.rule', enum: ['full', 'partial', 'none'] },
  { path: 'compensation.partialFraction', type: 'number', min: 0, max: 1 },
  { path: 'compensation.preSessionRedistributionKcal', type: 'number', min: 0, max: 1000 },
  { path: 'compensation.intraSessionCarbsGPerHour', type: 'number', min: 0, max: 120 },
  { path: 'compensation.roundingDirection', enum: ['down', 'nearest'] },
  { path: 'compensation.roundingStepKcal', type: 'number', min: 0, max: 500 },
  { path: 'compensation.noDeficitAboveActiveKcal', type: 'number', min: 0, max: 5000 },

  { path: 'ledger.enabled', type: 'boolean' },
  { path: 'ledger.windowDays', type: 'integer', min: 2, max: 60 },
  { path: 'ledger.maxDailyCorrectionKcal', type: 'number', min: 0, max: 1000 },
  { path: 'ledger.capKcal', type: 'number', min: 0, max: 10000 },
  { path: 'ledger.surplusExpiresAfterDays', type: 'integer', min: 1, max: 365 },

  { path: 'macros.protein.basis', enum: ['ffm', 'bodyweight', 'absolute'] },
  { path: 'macros.protein.value', type: 'number', min: 0, max: 500 },
  { path: 'macros.protein.minGPerKgBw', type: 'number', min: 0, max: 5 },
  { path: 'macros.fat.basis', enum: ['ffm', 'bodyweight', 'absolute', 'pctKcal'] },
  { path: 'macros.fat.value', type: 'number', min: 0, max: 500 },
  { path: 'macros.fat.minG', type: 'number', min: 0, max: 500 },
  { path: 'macros.carbs.mode', enum: ['remainder', 'absolute'] },
  { path: 'macros.carbs.minG', type: 'number', min: 0, max: 1000 },
  { path: 'macros.cycling.enabled', type: 'boolean' },
  { path: 'macros.cycling.swingKcal', type: 'number', min: 0, max: 1500 },
  { path: 'macros.cycling.trainingDayRule.type', enum: ['activeKcalThreshold', 'sessionMinutesThreshold'] },
  { path: 'macros.cycling.trainingDayRule.value', type: 'number', min: 0 },
  { path: 'macros.fiberGPer1000Kcal', type: 'number', min: 0, max: 40 },

  { path: 'safety.intakeFloor.bmrMultiple', type: 'number', min: 0.5, max: 3 },
  { path: 'safety.intakeFloor.hardFloorBmrMultiple', type: 'number', min: 0.5, max: 3 },
  { path: 'safety.maxRate.mode', enum: ['bodyFatAware', 'fixed'] },
  { path: 'safety.maxRate.fallbackPctBwPerWeek', type: 'number', min: 0.05, max: 2 },
  { path: 'safety.maxDeficit.mode', enum: ['fatMassAware', 'fixed'] },
  { path: 'safety.maxDeficit.kcalPerKgFatMass', type: 'number', min: 1, max: 100 },
  { path: 'safety.maxDeficit.absoluteCapKcal', type: 'number', min: 100, max: 3000 },
  { path: 'safety.maxSurplusKcal', type: 'number', min: 0, max: 2000 },
  { path: 'safety.dietBreak.auto', type: 'boolean' },
  { path: 'safety.dietBreak.everyWeeks', type: 'integer', min: 1, max: 104 },
  { path: 'safety.dietBreak.durationWeeks', type: 'integer', min: 1, max: 52 },

  { path: 'history.windowDays', type: 'integer', min: 7, max: 3650 },
  { path: 'history.minSessionMinutes', type: 'number', min: 0, max: 600 },
  { path: 'history.trainingContext.defaultLabel', type: 'string' },

  { path: 'flags.rhrBaseline', type: 'rhrBaseline' },
  { path: 'flags.rhrHighDelta', type: 'number', min: 0, max: 40 },
  { path: 'flags.rhrLowDelta', type: 'number', min: -40, max: 0 },
  { path: 'flags.plateauDays', type: 'integer', min: 3, max: 180 },
  { path: 'flags.trackingCoverageMin', type: 'integer', min: 0, max: 7 },
  { path: 'flags.proteinMinGPerKgFfm', type: 'number', min: 0, max: 5 },
  { path: 'flags.eaLowThreshold', type: 'number', min: 5, max: 80 },
  { path: 'flags.eaBodyFatAware', type: 'boolean' },
];

// Formulas that need fat-free mass, i.e. that are unavailable at bodyComp 'none'.
export const FFM_FORMULAS = ['katch', 'cunningham'];
// Both overestimate systematically — Harris 1918 on a historic cohort, Cunningham
// on trained athletes. Selectable, but never silently.
export const WARN_FORMULAS = ['harris', 'cunningham'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (!isPlainObject(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
}

// Union merge: defaults fill the gaps, unknown input keys are carried through
// untouched. Arrays are replaced wholesale (phases.manual, deviceEras,
// factorClamp are values, not things to merge element-wise).
//
// Where the defaults hold an object and the input holds something else —
// `profile: null` out of a corrupted store, a hand-edited file — the default
// subtree is KEPT and the path recorded in `mismatches`. Letting the null win
// would make `normalized` structurally unsound, and the cross-field checks
// below would then throw a TypeError instead of returning structured errors:
// a config that cannot be loaded rather than a config that reports what is
// wrong with it.
function deepMerge(defaults, input, mismatches = [], prefix = '') {
  const out = {};
  const keys = new Set([...Object.keys(defaults), ...Object.keys(isPlainObject(input) ? input : {})]);
  for (const key of keys) {
    const d = defaults[key];
    const i = isPlainObject(input) ? input[key] : undefined;
    const path = prefix ? `${prefix}.${key}` : key;
    if (i === undefined) out[key] = structuredClone(d);
    else if (isPlainObject(d)) {
      if (isPlainObject(i)) out[key] = deepMerge(d, i, mismatches, path);
      else { mismatches.push(path); out[key] = structuredClone(d); }
    } else out[key] = structuredClone(i);
  }
  return out;
}

function unknownPaths(defaults, input, prefix = '') {
  if (!isPlainObject(input)) return [];
  const out = [];
  for (const key of Object.keys(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in defaults)) out.push(path);
    else if (isPlainObject(defaults[key])) out.push(...unknownPaths(defaults[key], input[key], path));
  }
  return out;
}

function isValidDate(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

// One migration per schema version step. Index 0 upgrades v1 -> v2 — the same
// index-by-target convention the storage-layer migrations use in src/data/db.js.
const MIGRATIONS = [];

export function migrate(stored) {
  const raw = isPlainObject(stored) ? stored : {};
  const from = Number(raw.schemaVersion ?? SCHEMA_VERSION);
  if (!Number.isFinite(from) || from < 1) {
    return { config: { ...raw, schemaVersion: SCHEMA_VERSION }, from: null, to: SCHEMA_VERSION, applied: 0, ahead: false };
  }
  // A config from a newer app version is left alone rather than downgraded:
  // pruning fields we do not understand is the one way to actually lose data.
  if (from > SCHEMA_VERSION) return { config: structuredClone(raw), from, to: from, applied: 0, ahead: true };

  let config = structuredClone(raw);
  for (let v = from; v < SCHEMA_VERSION; v++) config = MIGRATIONS[v - 1](config);
  config.schemaVersion = SCHEMA_VERSION;
  return { config, from, to: SCHEMA_VERSION, applied: SCHEMA_VERSION - from, ahead: false };
}

export function validate(input) {
  const errors = [];
  const warnings = [];
  const err = (path, code, params = {}) => errors.push({ path, code, params });
  const warn = (path, code, params = {}) => warnings.push({ path, code, params });

  const { config: migrated, from, ahead } = migrate(input);
  if (ahead) warn('schemaVersion', 'CONFIG_SCHEMA_AHEAD', { stored: from, known: SCHEMA_VERSION });

  const mismatches = [];
  const normalized = deepMerge(DEFAULT_CONFIG, migrated, mismatches);
  if (!ahead) normalized.schemaVersion = SCHEMA_VERSION;
  for (const path of mismatches) err(path, 'CONFIG_NOT_AN_OBJECT', {});

  const unknown = unknownPaths(DEFAULT_CONFIG, migrated).filter((p) => p !== 'schemaVersion');
  if (unknown.length) warn('', 'CONFIG_UNKNOWN_FIELDS', { paths: unknown });

  for (const spec of FIELD_SPECS) {
    const value = getPath(normalized, spec.path);
    if (value == null) {
      if (!spec.nullable && !('enum' in spec)) err(spec.path, 'CONFIG_REQUIRED', {});
      continue;
    }
    if (spec.enum) {
      if (!spec.enum.includes(value)) err(spec.path, 'CONFIG_UNKNOWN_ENUM', { value, allowed: spec.enum });
      continue;
    }
    if (spec.type === 'string' && typeof value !== 'string') { err(spec.path, 'CONFIG_NOT_A_STRING', { value }); continue; }
    if (spec.type === 'boolean' && typeof value !== 'boolean') { err(spec.path, 'CONFIG_NOT_A_BOOLEAN', { value }); continue; }
    if (spec.type === 'date' && !isValidDate(value)) { err(spec.path, 'CONFIG_NOT_A_DATE', { value }); continue; }
    // 'auto' or a concrete bpm baseline.
    if (spec.type === 'rhrBaseline' && value !== 'auto' && !Number.isFinite(value)) { err(spec.path, 'CONFIG_NOT_A_NUMBER', { value }); continue; }
    if (spec.type === 'number' || spec.type === 'integer') {
      if (!Number.isFinite(value)) { err(spec.path, 'CONFIG_NOT_A_NUMBER', { value }); continue; }
      if (spec.type === 'integer' && !Number.isInteger(value)) err(spec.path, 'CONFIG_NOT_AN_INTEGER', { value });
      if (spec.min != null && value < spec.min) err(spec.path, 'CONFIG_OUT_OF_RANGE', { value, min: spec.min, max: spec.max ?? null });
      if (spec.max != null && value > spec.max) err(spec.path, 'CONFIG_OUT_OF_RANGE', { value, min: spec.min ?? null, max: spec.max });
    }
  }

  // --- Hardcaps. Clamped as well as reported: see the header contract. -------
  for (const bound of SAFETY_BOUNDS) {
    const value = getPath(normalized, bound.path);
    const limit = getPath(DEFAULT_CONFIG, bound.path);
    if (!Number.isFinite(value)) continue;
    const aggressive = bound.direction === 'max' ? value > limit : value < limit;
    if (aggressive) {
      err(bound.path, 'CONFIG_SAFETY_MORE_AGGRESSIVE', { value, limit, direction: bound.direction });
      setPath(normalized, bound.path, limit);
    }
  }

  // --- Cross-field rules ----------------------------------------------------
  const { profile, energy, calibration, goal, phases, safety, macros, ledger, intake } = normalized;

  if (energy.bmrFormula === 'custom' && !Number.isFinite(energy.customBmrKcal)) {
    err('energy.customBmrKcal', 'CONFIG_CUSTOM_BMR_MISSING', {});
  }
  if (WARN_FORMULAS.includes(energy.bmrFormula)) {
    warn('energy.bmrFormula', 'CONFIG_BMR_FORMULA_OVERESTIMATES', { formula: energy.bmrFormula });
  }
  if (profile.bodyComp.mode === 'none') {
    if (FFM_FORMULAS.includes(energy.bmrFormula)) {
      err('energy.bmrFormula', 'CONFIG_FORMULA_NEEDS_BODY_COMP', { formula: energy.bmrFormula });
    } else if (energy.bmrFormula === 'median') {
      // 'median' degrades to the median of what is available (Mifflin + Owen).
      warn('energy.bmrFormula', 'CONFIG_MEDIAN_WITHOUT_KATCH', {});
    }
  } else if (!Number.isFinite(profile.bodyComp.value)) {
    err('profile.bodyComp.value', 'CONFIG_BODY_COMP_VALUE_MISSING', { mode: profile.bodyComp.mode });
  } else if (profile.bodyComp.mode === 'bodyFatPct' && (profile.bodyComp.value <= 0 || profile.bodyComp.value >= 75)) {
    err('profile.bodyComp.value', 'CONFIG_OUT_OF_RANGE', { value: profile.bodyComp.value, min: 0, max: 75 });
  } else if (profile.bodyComp.mode === 'ffm' && (profile.bodyComp.value <= 0 || profile.bodyComp.value > 200)) {
    err('profile.bodyComp.value', 'CONFIG_OUT_OF_RANGE', { value: profile.bodyComp.value, min: 0, max: 200 });
  }

  const missing = ['birthDate', 'heightCm'].filter((k) => profile[k] == null);
  if (profile.sex === 'unspecified') missing.push('sex');
  if (missing.length && energy.bmrFormula !== 'custom') {
    warn('profile', 'CONFIG_PROFILE_INCOMPLETE', { missing });
  }

  if (goal.mode !== 'maintain' && goal.target.valueKg == null && goal.target.type === 'weight') {
    warn('goal.target.valueKg', 'CONFIG_GOAL_TARGET_MISSING', { mode: goal.mode });
  }

  if (calibration.windowDays < calibration.minDays) {
    err('calibration.windowDays', 'CONFIG_WINDOW_BELOW_MIN_DAYS', {
      windowDays: calibration.windowDays, minDays: calibration.minDays,
    });
  }
  const clamp = calibration.factorClamp;
  if (!Array.isArray(clamp) || clamp.length !== 2 || !clamp.every(Number.isFinite)
      || clamp[0] <= 0 || clamp[0] >= 1 || clamp[1] <= 1) {
    err('calibration.factorClamp', 'CONFIG_CLAMP_INVALID', { value: clamp });
  }
  if (calibration.confidence.mediumCoverage > calibration.confidence.highCoverage) {
    err('calibration.confidence.mediumCoverage', 'CONFIG_CONFIDENCE_ORDER', {
      medium: calibration.confidence.mediumCoverage, high: calibration.confidence.highCoverage,
    });
  }
  // cycleAwareSmoothing forces a full 28-day window so the trend spans a whole
  // cycle — a 21-day window would alias the fluid shift it is meant to absorb.
  if (calibration.cycleAwareSmoothing && calibration.windowDays !== 28) {
    warn('calibration.windowDays', 'CONFIG_CYCLE_WINDOW_FORCED', { was: calibration.windowDays });
    calibration.windowDays = 28;
    if (calibration.minDays > 28) calibration.minDays = 28;
  }

  if (![0, 2, 4].includes(intake.atwater.fiber)) {
    warn('intake.atwater.fiber', 'CONFIG_FIBER_ATWATER_UNUSUAL', { value: intake.atwater.fiber });
  }

  if (ledger.maxDailyCorrectionKcal > ledger.capKcal) {
    err('ledger.maxDailyCorrectionKcal', 'CONFIG_LEDGER_CORRECTION_ABOVE_CAP', {
      correction: ledger.maxDailyCorrectionKcal, cap: ledger.capKcal,
    });
  }

  // Not an error: without FFM the protein target degrades to the bodyweight
  // floor `macros.protein.minGPerKgBw`, which exists for exactly this case.
  // An empty config must stay valid (header contract 1).
  if (macros.protein.basis === 'ffm' && profile.bodyComp.mode === 'none') {
    warn('macros.protein.basis', 'CONFIG_PROTEIN_BASIS_NEEDS_BODY_COMP', { fallback: 'minGPerKgBw' });
  }

  // Manual phase rates against the body-fat rate ceiling. Only the statically
  // detectable case is caught here: the cap tightens as body fat falls, so a
  // phase that is legal today can exceed it later — targets.js re-checks at
  // computation time against the current measurement.
  const bodyFatPct = profile.bodyComp.mode === 'bodyFatPct' ? profile.bodyComp.value : null;
  const rateCap = maxRatePctBwPerWeek(normalized, bodyFatPct);
  if (!Array.isArray(phases.manual)) {
    err('phases.manual', 'CONFIG_NOT_AN_ARRAY', { value: phases.manual });
  } else {
    phases.manual.forEach((phase, i) => {
      const path = `phases.manual.${i}`;
      if (!isPlainObject(phase)) { err(path, 'CONFIG_NOT_AN_OBJECT', { value: phase }); return; }
      if (typeof phase.name !== 'string' || !phase.name) err(`${path}.name`, 'CONFIG_REQUIRED', {});
      if (!Number.isFinite(phase.untilWeightKg) || phase.untilWeightKg <= 0) {
        err(`${path}.untilWeightKg`, 'CONFIG_NOT_A_NUMBER', { value: phase.untilWeightKg });
      }
      if (!Number.isFinite(phase.ratePctBwPerWeek) || phase.ratePctBwPerWeek < 0) {
        err(`${path}.ratePctBwPerWeek`, 'CONFIG_NOT_A_NUMBER', { value: phase.ratePctBwPerWeek });
      } else if (phase.ratePctBwPerWeek > rateCap) {
        err(`${path}.ratePctBwPerWeek`, 'CONFIG_PHASE_RATE_ABOVE_CAP', { value: phase.ratePctBwPerWeek, cap: rateCap });
      }
    });
  }

  // Device eras must be ordered and non-overlapping. Gaps between them are
  // allowed — a stretch with no device is a real thing — and calibration cuts
  // its window at every era boundary, start or end, so a gap can neither be
  // pooled with the era before it nor silently spanned.
  const eras = normalized.history.deviceEras;
  if (!Array.isArray(eras)) {
    err('history.deviceEras', 'CONFIG_NOT_AN_ARRAY', { value: eras });
  } else {
    eras.forEach((era, i) => {
      const path = `history.deviceEras.${i}`;
      if (!isPlainObject(era) || !isValidDate(era.from)) { err(`${path}.from`, 'CONFIG_NOT_A_DATE', { value: era?.from }); return; }
      if (era.to != null && !isValidDate(era.to)) err(`${path}.to`, 'CONFIG_NOT_A_DATE', { value: era.to });
      if (era.to != null && isValidDate(era.to) && new Date(era.to) < new Date(era.from)) {
        err(`${path}.to`, 'CONFIG_ERA_REVERSED', { from: era.from, to: era.to });
      }
      const prev = eras[i - 1];
      if (prev && isValidDate(prev.from)) {
        if (new Date(era.from) < new Date(prev.from)) err(`${path}.from`, 'CONFIG_ERA_UNORDERED', { from: era.from, previous: prev.from });
        else if (prev.to == null || new Date(prev.to) > new Date(era.from)) {
          err(`${path}.from`, 'CONFIG_ERA_OVERLAP', { from: era.from, previousTo: prev.to });
        }
      }
    });
  }

  const periods = normalized.history.trainingContext.periods;
  if (!Array.isArray(periods)) {
    err('history.trainingContext.periods', 'CONFIG_NOT_AN_ARRAY', { value: periods });
  } else {
    periods.forEach((p, i) => {
      const path = `history.trainingContext.periods.${i}`;
      if (!isPlainObject(p) || !isValidDate(p.from)) err(`${path}.from`, 'CONFIG_NOT_A_DATE', { value: p?.from });
      else if (p.to != null && !isValidDate(p.to)) err(`${path}.to`, 'CONFIG_NOT_A_DATE', { value: p.to });
    });
  }

  if (safety.intakeFloor.hardFloorBmrMultiple > safety.intakeFloor.bmrMultiple) {
    err('safety.intakeFloor.hardFloorBmrMultiple', 'CONFIG_HARD_FLOOR_ABOVE_SOFT_FLOOR', {
      hard: safety.intakeFloor.hardFloorBmrMultiple, soft: safety.intakeFloor.bmrMultiple,
    });
  }

  return { valid: errors.length === 0, errors, warnings, normalized };
}

// Convenience for call sites that cannot proceed on an invalid config. The
// message is English developer text; user-facing German comes from de.json.
export function assertValid(input) {
  const result = validate(input);
  if (!result.valid) {
    const detail = result.errors.map((e) => `${e.path || '<root>'}: ${e.code}`).join(', ');
    throw new Error(`invalid nutrition config — ${detail}`);
  }
  return result.normalized;
}

// --- Units. Display only; everything stored and computed is kg / cm / kcal. --
export const LB_PER_KG = 2.20462262184878;
export const CM_PER_IN = 2.54;
export const KJ_PER_KCAL = 4.184;

export function massToKg(value, unit) { return unit === 'lb' ? value / LB_PER_KG : value; }
export function massFromKg(kg, unit) { return unit === 'lb' ? kg * LB_PER_KG : kg; }
export function heightToCm(value, unit) { return unit === 'in' ? value * CM_PER_IN : value; }
export function heightFromCm(cm, unit) { return unit === 'in' ? cm / CM_PER_IN : cm; }
export function energyToKcal(value, unit) { return unit === 'kJ' ? value / KJ_PER_KCAL : value; }
export function energyFromKcal(kcal, unit) { return unit === 'kJ' ? kcal * KJ_PER_KCAL : kcal; }
