// R8 — Split coverage check (generator rule, not an in-week replanning
// trigger): disabling a split unit may leave regions uncovered that other
// sports don't compensate. Implemented in the generator module; re-exported
// here so the rulebook screen and tests address all rules uniformly.
export { splitCoverageGaps } from '../../engine/generator.js';

export const TIER = 'generator';

export function triggers(state) {
  return (state.profile.disabledUnits || []).length > 0;
}
