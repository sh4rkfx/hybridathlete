// Shared planning helpers + suggestion construction (spec §3.2–§3.5).
// All functions are pure; `now` is injected for deterministic tests.
import { hoursBetween, dOnly, addDays } from './time.js';
import { RULE_META } from './texts.js';

let _idc = 1;
export function resetIds() { _idc = 1; }
export function uid() { return 'id' + (_idc++) + '_' + Math.random().toString(36).slice(2, 6); }

// Latest fatigue entry per region; entries older than 72 h are stale (R5).
export function latestFatigue(state, region, now) {
  const rel = state.fatigue
    .filter((f) => f.region === region && hoursBetween(f.ts, now) <= 72)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return rel[0] || null;
}

export function sessionLoadsRegion(p, region, catalog) {
  const sport = catalog.sports[p.sportId];
  if (sport.loadSource === 'exercises') {
    return (p.exercises || []).some((id) => catalog.exById[id] && catalog.exById[id].load[region] >= 2);
  }
  return (sport.loadProfile[region] || 0) >= 2;
}

export function isHeavyLowerBody(p, catalog) {
  const sport = catalog.sports[p.sportId];
  if (p.sportId === 'strength') {
    return (p.exercises || []).some((id) => {
      const e = catalog.exById[id];
      return e && e.cat === 'legs' && (e.load.quads >= 2 || e.load.posterior_chain >= 3);
    });
  }
  return (sport.loadProfile.quads || 0) >= 2;
}

// Sessions still relevant for planning: logged/skipped/removed sessions leave
// the projection so their load is never double-counted (spec §3.5, T13).
export function futurePlanned(state, now) {
  return state.planned
    .filter((p) => p.status !== 'removed' && p.status !== 'logged' && p.status !== 'skipped'
      && new Date(p.date) >= dOnly(now))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Estimated planned training load for the ACWR projection (R7). Duration/sRPE
// guesses are deliberately coarse — the projection only gates the >1.5 warning.
export function estPlannedTL(pl) {
  const durGuess = pl.sportId === 'mountain_day' ? 360 : pl.sportId === 'running' ? 45 : pl.sportId === 'bouldering' ? 90 : 60;
  const rpeGuess = pl.sportId === 'mountain_day' ? 8 : 6;
  return (pl.reduced ? 0.5 : 1) * durGuess * rpeGuess;
}

export function proposeChange(op, target) {
  if (op === 'move') {
    // V1: move by a flat +2 days, keep slot (exact target date selectable in V2).
    const nd = addDays(new Date(target.date), 2);
    return { date: nd.toISOString() };
  }
  if (op === 'reduce') return { reduced: true };
  if (op === 'remove') return { status: 'removed' };
  return {};
}

export function sug(ruleId, tier, operation, target, coach, why, proposedOverride, swapDetail) {
  const r = RULE_META[ruleId];
  return {
    ruleId, tier, operation, targetId: target.id, coach, why,
    ruleName: r.name, src: r.src, lvl: r.lvl, lvlLabel: r.lvlLabel,
    proposed: proposedOverride || proposeChange(operation, target),
    swap: swapDetail || null,
  };
}

// Minimal-intervention rank (spec §3.4/§3.5): swap < reduce < move < remove.
export const OP_RANK = { swap: 0, reduce: 1, move: 2, remove: 3 };

// Dedupe: one suggestion per target — lowest tier wins, ties broken by the
// mildest operation. Result sorted by tier (R1 first).
export function dedupeByTarget(sugs) {
  const byTarget = {};
  sugs.forEach((s) => {
    const t = byTarget[s.targetId];
    if (!t || s.tier < t.tier || (s.tier === t.tier && OP_RANK[s.operation] < OP_RANK[t.operation])) {
      byTarget[s.targetId] = s;
    }
  });
  return Object.values(byTarget).sort((a, b) => a.tier - b.tier);
}
