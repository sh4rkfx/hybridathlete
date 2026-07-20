// Load model (spec §3.1).
// Validated basis: session load sRPE-TL = sRPE × duration (Foster et al. 2001).
// ASSUMPTION (spec §3.1, flagged): the regional decomposition below distributes
// that load over body regions via a static per-sport profile — transparent but
// NOT validated. Strength sessions aggregate region load from logged exercises
// instead of a static profile (loadSource 'exercises').
export function srpeTL(log) { return (log.sRPE || 0) * (log.duration || 0); }

export function regionLoad(log, catalog) {
  const sport = catalog.sports[log.sportId];
  const out = {};
  if (!sport) return out;
  const scale = (log.sRPE / 10) * (log.duration / 60);
  if (sport.loadSource === 'exercises') {
    (log.sets || []).forEach((s) => {
      const ex = catalog.exById[s.exerciseId];
      if (!ex) return;
      for (const r in ex.load) out[r] = (out[r] || 0) + ex.load[r] * scale * 0.4;
    });
    out.systemic = (out.systemic || 0) + 1 * scale;
  } else {
    for (const r in sport.loadProfile) out[r] = (out[r] || 0) + sport.loadProfile[r] * scale;
  }
  return out;
}
