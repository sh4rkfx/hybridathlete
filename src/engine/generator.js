// Strength plan generator (spec §5). generateStrength(profile) is deterministic;
// with (state, when) it becomes readiness-aware (§5.5): stop-rated exercises are
// excluded, fresh sorts before caution.
import { SPLITS, UNIT_CATS, catalogOf, DEFAULT_CATALOG } from './catalog.js';
import { exerciseReadiness, READY_RANK } from './readiness.js';

export function generateStrength(profile, state, when, now = new Date()) {
  const catalog = state ? catalogOf(state) : DEFAULT_CATALOG;
  const split = SPLITS[profile.split] || SPLITS.PPL;
  const units = split.units.filter((u) => !(profile.disabledUnits || []).includes(u));
  return units.map((unit) => {
    const cats = UNIT_CATS[unit] || [unit];
    let pool = catalog.exercises.filter((e) => cats.includes(e.cat));

    // R2 — constraints, generic for every region (§5.4): knee uses the flexion
    // tag; other regions the load matrix. yellow = drop heavy loaders (>= 3),
    // red = lock the region (>= 2).
    (profile.constraints || []).forEach((c) => {
      if (c.region === 'knee') {
        if (c.level === 'red') pool = pool.filter((e) => e.knee === null);
        else pool = pool.filter((e) => e.knee !== 'deep');
      } else {
        const thr = c.level === 'red' ? 2 : 3;
        pool = pool.filter((e) => (e.load[c.region] || 0) < thr);
      }
    });

    if (state && when) {
      const ready = Object.fromEntries(pool.map((e) => [e.id, exerciseReadiness(e.id, when, state, now).level]));
      pool = pool.filter((e) => ready[e.id] !== 'stop');
      pool = pool.slice().sort((a, b) => READY_RANK[ready[a.id]] - READY_RANK[ready[b.id]]);
    }

    // Pick up to 4, preferring variety of primary regions.
    const picks = [];
    const usedPrimary = new Set();
    for (const e of pool) {
      const primary = Object.keys(e.load).sort((a, b) => e.load[b] - e.load[a])[0];
      if (!usedPrimary.has(primary) || picks.length < 2) { picks.push(e); usedPrimary.add(primary); }
      if (picks.length >= 4) break;
    }
    return { unit, exercises: picks.map((e) => e.id) };
  });
}

// Split advice (story #31): strength gains profit from per-lift frequency
// (Pelland et al. 2025), so goal 'kraftaufbau' on a 1×/week-per-muscle split
// gets a hint towards full-body/upper-lower. Returns null when nothing to say.
export function splitHint(profile) {
  if (profile.goal !== 'kraftaufbau') return null;
  if (profile.split !== 'PPL' && profile.split !== 'push_pull') return null;
  return {
    text: 'Für Maximalkraft ist höhere Frequenz je Übung leicht überlegen — mit deinem Split trainierst du jede Übung nur ~1×/Woche. Full Body oder Upper/Lower erhöhen die Frequenz bei gleichem Volumen.',
    source: 'Pelland et al. (2025), Dose-Response-Meta-Regression: Kraft steigt mit Frequenz (abnehmender Grenznutzen); Hypertrophie ist bei gleichem Volumen frequenzunabhängig (Schoenfeld 2019).',
    evidenceLevel: 'meta-analysis',
  };
}

// R8 — split coverage check (generator rule, not an in-week trigger): which
// regions lose coverage when a unit is disabled, and what other sports still
// cover. Suggested fixes are limited to what the V1 catalog can deliver.
export function splitCoverageGaps(profile) {
  const disabled = profile.disabledUnits || [];
  const gaps = [];
  if (disabled.includes('pull')) {
    gaps.push({
      label: 'Hintere Schulter & horizontales Ziehen',
      note: 'Bouldern deckt Lat/Unterarm ab, aber nicht die hintere Schulter.',
      fixIds: ['rear_delt_fly_db', 'band_pull_apart', 'chest_supported_row_db'],
    });
  }
  return gaps;
}
