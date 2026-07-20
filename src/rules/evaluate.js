// The pure engine core (spec §3): evaluate(state, now) -> Suggestion[].
// No DB, no DOM — the caller loads the state (data/repositories.js
// loadEngineState) and persists the returned suggestions.
//
// state = { profile, planned, logs, fatigue, pain, rejected,
//           sports?/exercises? (store contents) or catalog? (prebuilt) }
//
// Priority hierarchy (§3.2): R1 pain > R2 constraints (filter, no own stream)
// > fixed timing (guarded inside each rule) > R3/R4/R5 recovery > R6
// interference > R7 ACWR. Rules run in tier order; per-target dedupe keeps the
// lowest tier, ties resolved by minimal intervention (swap<reduce<move<remove).
import { catalogOf } from '../engine/catalog.js';
import { uid, dedupeByTarget } from '../engine/planner.js';
import { ruleActive } from './params.js';
import * as r1 from './rules/r1.js';
import * as r3 from './rules/r3.js';
import * as r4 from './rules/r4.js';
import * as r5 from './rules/r5.js';
import * as r6 from './rules/r6.js';
import * as r7 from './rules/r7.js';

const RULE_MODULES = [['R1', r1], ['R3', r3], ['R4', r4], ['R5', r5], ['R6', r6], ['R7', r7]];

export function evaluate(state, now = new Date()) {
  const catalog = catalogOf(state);
  const rejected = state.rejected || {};
  const sugs = [];

  // Idempotency guards (§3.5): rejected keys stay suppressed permanently;
  // removed targets get nothing further; reduced/adjusted targets don't get
  // the same intervention twice.
  const push = (s) => {
    const key = s.ruleId + '|' + s.targetId;
    if (rejected[key]) return;
    const t = state.planned.find((p) => p.id === s.targetId);
    if (t) {
      if (t.status === 'removed') return;
      if (s.operation === 'reduce' && t.reduced) return;
      if (s.operation === 'swap' && t.adjusted) return;
    }
    s.id = s.id || uid();
    s.key = key;
    sugs.push(s);
  };

  const ctx = { state, now, catalog, push, sugs };
  for (const [id, mod] of RULE_MODULES) {
    if (ruleActive(id)) mod.run(ctx);
  }

  return dedupeByTarget(sugs);
}
