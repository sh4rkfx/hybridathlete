// Reference energy data for trying the module out (kickoff "Seed-Profil für
// Entwicklung und Tests"). Mirrors src/ui/demo.js: a synchronous in-place
// mutator with no DB knowledge and no Preact import, so store.updateNutrition
// handles persistence and notification.
//
// Deterministic by construction — a seeded PRNG, no Math.random — so the demo
// looks the same every time and can be asserted in tests.
import { validate } from '../nutrition/config.js';
import { eveningReconcile } from '../nutrition/ledger.js';
import { dateKey, dOnly, addDays } from '../engine/time.js';

export const DEMO_DAYS = 70;

// Seed profile, kickoff: 38 y / 173 cm / 89.5 kg / 27.9 % body fat, factor 0.95.
export const DEMO_PROFILE = {
  birthDate: '1988-06-16',
  sex: 'male',
  heightCm: 173,
  bodyComp: { mode: 'bodyFatPct', value: 27.9 },
};

const TRUE_TDEE_REST = 2334;
const FACTOR = 0.95;          // the source over-reports by ~5 %
const ENERGY_DENSITY = 7700;
const DEMO_BASE_INTAKE = 1850;   // kickoff seed profile, Phase 1

// mulberry32 — small, well distributed, and identical to the generator the
// domain tests use.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(rand(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Roughly the kickoff's own mix over 180 days: 116 rest, 52 medium, 34 long.
function sessionMinutes(weekday, rand) {
  if (weekday === 3) return 90 + Math.round(rand() * 30);    // boulder night
  if (weekday === 6) return 150 + Math.round(rand() * 120);  // mountain day
  if (weekday === 1) return 55 + Math.round(rand() * 20);    // strength
  return 0;
}

export function buildDemoDays(now, seed = 20260817) {
  const rand = mulberry32(seed);
  const start = addDays(dOnly(now), -(DEMO_DAYS - 1));
  const days = [];
  let trueWeight = 92.6;

  for (let i = 0; i < DEMO_DAYS; i++) {
    const d = addDays(start, i);
    const minutes = sessionMinutes(d.getDay(), rand);
    const activeKcal = minutes ? 30 + 4.27 * minutes : 0;
    const trueTdee = TRUE_TDEE_REST + activeKcal;

    // Intake: the plan plus full compensation, plus the noise of a real week.
    const base = DEMO_BASE_INTAKE;
    const intake = Math.round(base + activeKcal * 0.95 + gaussian(rand) * 120);

    // Real logs have holes, and protein is the field people skip. Four of the
    // last seven days are left blank, which is one over the PROTEIN_NOT_TRACKED
    // threshold, so the demo shows the warning system doing something — a
    // realistic gap rather than a fabricated problem.
    const daysAgo = DEMO_DAYS - 1 - i;
    const skipsProtein = daysAgo < 7 && [1, 3, 5, 6].includes(daysAgo);

    days.push({
      date: dateKey(d),
      kcal: intake,
      proteinG: skipsProtein ? null : Math.round(150 + gaussian(rand) * 18),
      fatG: null,
      carbsG: null,
      fiberG: null,
      alcoholG: null,
      // The source over-reports, which is exactly what the calibration recovers.
      totalKcal: Math.round(trueTdee / FACTOR),
      exerciseKcal: minutes ? Math.round(activeKcal / FACTOR) : 0,
      exerciseMinutes: minutes,
      weightKg: Math.round((trueWeight + gaussian(rand) * 0.35) * 10) / 10,
      bodyFatPct: i === DEMO_DAYS - 1 ? 27.9 : null,
      restingHr: Math.round(52.7 + gaussian(rand) * 1.2),
    });

    trueWeight += (intake - trueTdee) / ENERGY_DENSITY;
  }
  return days;
}

// In-place mutator over state.nutrition. Returns the days it wrote so the
// caller can hand them to the persistence layer.
export function loadDemoEnergy(nutrition, now) {
  const days = buildDemoDays(now);
  const config = validate({
    ...(nutrition.config ?? {}),
    profile: DEMO_PROFILE,
    goal: { mode: 'cut', target: { type: 'weight', valueKg: 82 } },
    energy: { adapterId: 'manual' },
  }).normalized;

  // The weekly account is filled by running the real evening reconciliation over
  // the last week of demo days — the same function the app calls each evening,
  // not invented rows. Intake carries noise, so genuine overshoots appear.
  const plannedDeficitKcal = TRUE_TDEE_REST - DEMO_BASE_INTAKE;
  const ledger = days.slice(-config.ledger.windowDays).map((day) => eveningReconcile({
    date: day.date,
    plannedDeficitKcal,
    actualIntakeKcal: day.kcal,
    actualTdeeKcal: Math.round(day.totalKcal * FACTOR),
    exerciseKcal: day.exerciseKcal,
    factor: FACTOR,
  }, config));

  nutrition.days = days;
  nutrition.config = { ...config, id: 'me' };
  nutrition.calibrations = [];
  nutrition.ledger = ledger;
  nutrition.phases = [];
  return days;
}
