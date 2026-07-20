// Exercise-level substitution (spec §3.4 "Anpassen"): exchange only the
// exercises loading a trigger region >= 2, keep timing and the rest.
import { UNIT_CATS } from './catalog.js';

export function passesConstraints(e, profile) {
  return (profile.constraints || []).every((c) => {
    if (c.region === 'knee') return c.level === 'red' ? e.knee === null : e.knee !== 'deep';
    return (e.load[c.region] || 0) < (c.level === 'red' ? 2 : 3);
  });
}

// Returns {drop, keep, repl, proposed} or null when swapping is not honest:
// fewer than 2 exercises, no exercise affected, or the hollow-out guard
// (drop > keep — the session would lose its identity; move/reduce instead).
export function swapProposal(pl, regions, profile, catalog) {
  const ids = pl.exercises || [];
  if (ids.length < 2) return null;
  const hits = (id) => {
    const e = catalog.exById[id];
    return !!e && regions.some((r) => (e.load[r] || 0) >= 2);
  };
  const drop = ids.filter(hits);
  const keep = ids.filter((id) => !hits(id));
  if (!drop.length) return null;
  if (drop.length > keep.length) return null;

  // Replacement search: same category first, then any category of the unit.
  // Candidates must load every trigger region < 2 and satisfy all constraints.
  const unitCats = UNIT_CATS[pl.unit] || [pl.unit];
  const taken = new Set(keep);
  const repl = [];
  drop.forEach((id) => {
    const orig = catalog.exById[id];
    const ok = (x) => !regions.some((r) => (x.load[r] || 0) >= 2) && !taken.has(x.id) && x.id !== id
      && passesConstraints(x, profile);
    const cand = catalog.exercises.find((x) => x.cat === orig.cat && ok(x))
      || catalog.exercises.find((x) => unitCats.includes(x.cat) && ok(x));
    if (cand) { repl.push(cand.id); taken.add(cand.id); }
    // No candidate found -> the session simply gets shorter (spec §3.4).
  });
  return { drop, keep, repl, proposed: [...keep, ...repl] };
}

export function exNames(ids, catalog) {
  return ids.map((id) => (catalog.exById[id] ? catalog.exById[id].name : id)).join(', ');
}
