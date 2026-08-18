// Persistence for the energy module (kickoff step 8). Pure vanilla module —
// no UI imports. The domain in src/nutrition/ never sees any of this; it is
// handed plain arrays and hands back plain objects.
//
// Writes are PER RECORD, deliberately unlike the wholesale collection rewrite
// in src/ui/store.js. That pattern clears a store and re-puts everything held in
// memory, which is fine for a week of planned sessions and destructive for a
// daily history that only ever grows — anything not currently loaded would be
// erased on the next save.
//
// The config store is not seeded. `validate({})` already yields a complete,
// working config, so an absent row is a valid state; that also means resetAll()
// cannot lose one and first-run seeding has nothing to do.
import { dateKey } from '../engine/time.js';

export const NUTRITION_CONFIG_KEY = 'me';

export const NUTRITION_STORES = [
  'nutritionDays', 'nutritionConfig', 'nutritionCalibrations', 'nutritionLedger', 'nutritionPhases',
];

export function nutritionRepositories(db) {
  const repo = (store) => ({
    get: (key) => db.get(store, key),
    getAll: () => db.getAll(store),
    put: (value) => db.put(store, value),
    delete: (key) => db.delete(store, key),
    clear: () => db.clear(store),
    count: () => db.count(store),
  });
  return {
    days: repo('nutritionDays'),
    config: repo('nutritionConfig'),
    calibrations: repo('nutritionCalibrations'),
    ledger: repo('nutritionLedger'),
    phases: repo('nutritionPhases'),
  };
}

// The envelope the domain already expects. Sorted by date so callers can rely
// on order without re-sorting in every selector.
export async function loadNutritionState(db) {
  const [days, configRows, calibrations, ledger, phases] = await Promise.all([
    db.getAll('nutritionDays'),
    db.getAll('nutritionConfig'),
    db.getAll('nutritionCalibrations'),
    db.getAll('nutritionLedger'),
    db.getAll('nutritionPhases'),
  ]);
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return {
    days: days.sort(byDate),
    config: configRows.find((row) => row.id === NUTRITION_CONFIG_KEY) ?? null,
    calibrations: calibrations.sort((a, b) => new Date(a.computedAt) - new Date(b.computedAt)),
    ledger: ledger.sort(byDate),
    phases: phases.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt)),
  };
}

export function saveNutritionConfig(db, config) {
  return db.put('nutritionConfig', structuredClone({ ...config, id: NUTRITION_CONFIG_KEY }));
}

// Merge rather than replace. A source that only knows about weight must not
// wipe the macros somebody typed by hand for the same day — the two arrive
// separately and both are real.
export async function putDay(db, day) {
  const date = day.date ?? dateKey(day.at ?? new Date());
  const existing = await db.get('nutritionDays', date);
  const merged = { ...(existing ?? {}), ...day, date };
  await db.put('nutritionDays', structuredClone(merged));
  return merged;
}

export async function putDays(db, days) {
  const written = [];
  for (const day of days ?? []) written.push(await putDay(db, day));
  return written;
}

export function putCalibration(db, calibration) {
  return db.put('nutritionCalibrations', structuredClone(calibration));
}

export function putLedgerEntry(db, entry) {
  return db.put('nutritionLedger', structuredClone(entry));
}

export function putPhase(db, phase) {
  return db.put('nutritionPhases', structuredClone(phase));
}

export async function clearNutrition(db) {
  for (const store of NUTRITION_STORES) await db.clear(store);
}
