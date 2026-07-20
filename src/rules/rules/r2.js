// R2 — Permanent constraints (tier 2). R2 has no own suggestion stream in the
// weekly evaluation: it acts as a filter inside every exercise selection —
// the generator pool (engine/generator.js), swap replacement search
// (engine/swap.js: passesConstraints) and exerciseReadiness (engine/readiness.js).
// This module exposes the predicate for those consumers and the rulebook screen.
import { passesConstraints } from '../../engine/swap.js';

export const TIER = 2;

export function triggers(state) {
  return (state.profile.constraints || []).length > 0;
}

export { passesConstraints };
