// CRUD repositories + engine-state assembly. Pure vanilla module — no UI imports.
// The rule engine never touches the DB: callers use loadEngineState() to build the
// plain state object the engine consumes, and persist results afterwards.
import exercisesSeed from '../seed/exercises.seed.json' with { type: 'json' };
import sportsSeed from '../seed/sports.seed.json' with { type: 'json' };
import rulesCatalog from '../rules/catalog.json' with { type: 'json' };

export const PROFILE_KEY = 'me';

// Reference-athlete preset (spec §2.4). V1 ships only this preset; the data
// model stays generic — nothing here is hardcoded into the engine.
export const PROFILE_SEED = {
  presetId: 'reference_athlete',
  goal: 'sport_support',
  trainingDays: 3,
  split: 'PPL',
  disabledUnits: ['pull'],
  activeSports: ['bouldering', 'mountain_day', 'running', 'gravel_cycling'],
  constraints: [
    {
      id: 'knee_flexion',
      region: 'knee',
      level: 'yellow',
      rule: 'avoid_loaded_flexion_80_90',
      note: 'Linkes Knie, posterolateral, positionsabhängig ~80–90° Flexion',
    },
  ],
  slotBoundaries: { morning: [6, 12], midday: [12, 18], evening: [18, 24] },
};

function repo(db, store) {
  return {
    get: (key) => db.get(store, key),
    getAll: () => db.getAll(store),
    put: (value, key) => db.put(store, value, key),
    delete: (key) => db.delete(store, key),
    clear: () => db.clear(store),
    count: () => db.count(store),
  };
}

export function repositories(db) {
  return {
    profile: repo(db, 'profile'),
    sports: repo(db, 'sports'),
    exercises: repo(db, 'exercises'),
    plannedSessions: repo(db, 'plannedSessions'),
    sessionLogs: repo(db, 'sessionLogs'),
    setLogs: repo(db, 'setLogs'),
    fatigueEntries: repo(db, 'fatigueEntries'),
    painEntries: repo(db, 'painEntries'),
    suggestions: repo(db, 'suggestions'),
    rules: repo(db, 'rules'),
    importBatches: repo(db, 'importBatches'),
  };
}

// First-run seeding (spec §2 "Seed beim Erststart"). Idempotent: only writes
// stores that are still empty, so user edits are never overwritten.
export async function seedIfEmpty(db) {
  const tx = db.transaction(['profile', 'sports', 'exercises', 'rules'], 'readwrite');
  const seeded = [];

  if ((await tx.objectStore('profile').count()) === 0) {
    await tx.objectStore('profile').put(structuredClone(PROFILE_SEED), PROFILE_KEY);
    seeded.push('profile');
  }
  if ((await tx.objectStore('sports').count()) === 0) {
    for (const sport of sportsSeed.sports) await tx.objectStore('sports').put(structuredClone(sport));
    seeded.push('sports');
  }
  if ((await tx.objectStore('exercises').count()) === 0) {
    for (const ex of exercisesSeed.exercises) await tx.objectStore('exercises').put(structuredClone(ex));
    seeded.push('exercises');
  }
  if ((await tx.objectStore('rules').count()) === 0) {
    for (const rule of rulesCatalog.rules) await tx.objectStore('rules').put(structuredClone(rule));
    seeded.push('rules');
  }

  await tx.done;
  return seeded;
}

// Garmin idempotency (AC9): re-importing the same activity must not create a
// duplicate. Returns the existing log if the garminActivityId is already known.
export async function putSessionLogIdempotent(db, log) {
  if (log.garminActivityId != null) {
    const existing = await db.getFromIndex('sessionLogs', 'byGarminActivityId', log.garminActivityId);
    if (existing) return { log: existing, duplicate: true };
  }
  await db.put('sessionLogs', log);
  return { log, duplicate: false };
}

// Assemble the plain state object the pure engine consumes (evaluate(state)).
// `rejected` and `ruleStats` are derived from the persisted suggestion history —
// they are projections, not stores of their own.
export async function loadEngineState(db) {
  const [profile, planned, allLogs, fatigue, pain, suggestions, rules, sports, exercises] =
    await Promise.all([
      db.get('profile', PROFILE_KEY),
      db.getAll('plannedSessions'),
      db.getAll('sessionLogs'),
      db.getAll('fatigueEntries'),
      db.getAll('painEntries'),
      db.getAll('suggestions'),
      db.getAll('rules'),
      db.getAll('sports'),
      db.getAll('exercises'),
    ]);

  const rejected = {};
  const ruleStats = {};
  for (const s of suggestions) {
    if (!ruleStats[s.ruleId]) ruleStats[s.ruleId] = { up: 0, down: 0 };
    if (s.status === 'accepted') ruleStats[s.ruleId].up++;
    if (s.status === 'rejected') {
      ruleStats[s.ruleId].down++;
      rejected[s.key] = s.feedback?.reasonCode ?? true;
    }
  }

  // AC9: Garmin drafts enter the load model only after sRPE confirmation —
  // the engine never sees them; the UI lists them separately.
  const logs = allLogs.filter((l) => !l.draft);
  const draftLogs = allLogs.filter((l) => l.draft);

  return { profile, planned, logs, draftLogs, fatigue, pain, suggestions, rules, sports, exercises, rejected, ruleStats };
}

// Persist a fresh evaluation result: open (un-answered) suggestions are replaced
// by the new set; accepted/rejected history is kept (it feeds rejected/ruleStats).
export async function persistSuggestions(db, freshSuggestions) {
  const tx = db.transaction('suggestions', 'readwrite');
  const store = tx.objectStore('suggestions');
  const all = await store.getAll();
  for (const s of all) {
    if (s.status === 'open') await store.delete(s.suggestionId);
  }
  for (const s of freshSuggestions) {
    await store.put({ ...s, suggestionId: s.id, status: s.status ?? 'open' });
  }
  await tx.done;
}
