// Catalog normalization: the engine consumes one canonical shape regardless of
// whether entries come from the seed/store schema (spec §2.5/§2.7) or are
// already normalized. Engine-internal shape:
//   sport:    { id, name, loadSource, loadProfile, flags, painRegions?, maxDur?, durStep? }
//   exercise: { id, name, cat, load, knee }
import sportsSeed from '../seed/sports.seed.json' with { type: 'json' };
import exercisesSeed from '../seed/exercises.seed.json' with { type: 'json' };

export const GOAL_SCHEMES = {
  kraftaufbau: { label: 'Kraftaufbau', sets: 5, reps: '3–5' },
  hypertrophie: { label: 'Hypertrophie', sets: 4, reps: '8–12' },
  erhalt: { label: 'Erhalt', sets: 2, reps: '6–10' },
  sport_support: { label: 'Sport-Support', sets: 3, reps: '5–8' },
};

export const SPLITS = {
  full_body: { label: 'Full Body', units: ['full'] },
  upper_lower: { label: 'Upper / Lower', units: ['upper', 'lower'] },
  push_pull: { label: 'Push / Pull', units: ['push', 'pull'] },
  PPL: { label: 'Push / Pull / Legs', units: ['push', 'pull', 'legs'] },
};

export const UNIT_CATS = {
  full: ['push', 'pull', 'legs', 'core'],
  upper: ['push', 'pull'],
  lower: ['legs'],
  push: ['push'],
  pull: ['pull'],
  legs: ['legs', 'core'],
};

export function normalizeSport(s) {
  return {
    id: s.id ?? s.sportId,
    name: s.name,
    loadSource: s.loadSource ?? 'profile',
    loadProfile: s.loadProfile ?? {},
    flags: s.flags ?? { eccentric: false, tendonHeavy: false },
    painRegions: s.painRegions,
    maxDur: s.maxDur,
    durStep: s.durStep,
    metrics: s.metrics,
    typicallyFixed: s.typicallyFixed,
  };
}

export function normalizeExercise(e) {
  return {
    id: e.id ?? e.exerciseId,
    name: e.name,
    cat: e.cat ?? e.category,
    load: e.load ?? e.loadProfile ?? {},
    knee: e.knee !== undefined ? e.knee : (e.kneeFlexionTag ?? null),
    eccentricEmphasis: e.eccentricEmphasis ?? false,
  };
}

export function buildCatalog(sports, exercises) {
  const exList = exercises.map(normalizeExercise);
  return {
    sports: Object.fromEntries(sports.map(normalizeSport).map((s) => [s.id, s])),
    exercises: exList,
    exById: Object.fromEntries(exList.map((e) => [e.id, e])),
  };
}

export const DEFAULT_CATALOG = buildCatalog(sportsSeed.sports, exercisesSeed.exercises);

// Resolve the catalog for an engine call: an explicit state.catalog wins, then
// catalogs assembled from store contents, then the shipped seed catalogs.
export function catalogOf(state) {
  if (state?.catalog) return state.catalog;
  if (state?.sports?.length || state?.exercises?.length) {
    return buildCatalog(state.sports ?? sportsSeed.sports, state.exercises ?? exercisesSeed.exercises);
  }
  return DEFAULT_CATALOG;
}
