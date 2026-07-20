// Branch coverage for the rarer rule paths (story: rules coverage >= 99 %):
// R1 exercise-level swap + non-fixed remove + mild reduce, R3/R4/R5 fallbacks,
// evaluate idempotency guards, R7 edge cases, params/r2/r8 defaults.
import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/rules/evaluate.js';
import * as r4 from '../../src/rules/rules/r4.js';
import * as r7 from '../../src/rules/rules/r7.js';
import * as r2 from '../../src/rules/rules/r2.js';
import * as r8 from '../../src/rules/rules/r8.js';
import { ruleDef, ruleParams, ruleActive } from '../../src/rules/params.js';
import { resetIds, uid } from '../../src/engine/planner.js';
import { mkLog, mkPlanned } from '../helpers/fixtures.js';

const NOW = new Date('2026-07-20T19:00:00');
const H = (h) => new Date(NOW.getTime() + h * 36e5);

function bare() {
  resetIds();
  return { profile: { goal: 'sport_support', split: 'PPL', disabledUnits: [], constraints: [] }, logs: [], fatigue: [], pain: [], planned: [], rejected: {} };
}
const pain = (region, nrs, when = NOW) => ({ id: uid(), region, nrs, ts: new Date(when).toISOString() });
const fat = (region, level, when = NOW) => ({ id: uid(), region, level, ts: new Date(when).toISOString(), context: 'post_session' });

// Upper session where only the OHP loads the shoulder >= 2 -> minority affected.
const upperSession = (extra = {}) => mkPlanned('strength', H(20), 'midday', false, {
  unit: 'upper',
  exercises: ['overhead_barbell_press', 'barbell_curl', 'single_arm_dumbbell_row', 'plank'],
  ...extra,
});

describe('R1 exercise level (AC12)', () => {
  it('NRS 3–5 on a strength session swaps only the painful loaders', () => {
    const db = bare();
    db.pain.push(pain('shoulder', 4));
    db.planned.push(upperSession());
    const s = evaluate(db, NOW).find((x) => x.ruleId === 'R1');
    expect(s.operation).toBe('swap');
    expect(s.swap.drop).toEqual(['overhead_barbell_press']);
    expect(s.swap.keep).toHaveLength(3);
    expect(s.coach).toMatch(/zwickt/);
    expect(s.proposed.adjusted).toBe(true);
  });

  it('NRS > 5 on a strength session still swaps (region locked, minority affected)', () => {
    const db = bare();
    db.pain.push(pain('shoulder', 7));
    db.planned.push(upperSession());
    const s = evaluate(db, NOW).find((x) => x.ruleId === 'R1');
    expect(s.operation).toBe('swap');
    expect(s.coach).toMatch(/klaren Schmerz/);
    expect(s.why).toMatch(/gesperrt/);
  });

  it('NRS > 5 removes a non-fixed session, reduces a fixed one', () => {
    const db = bare();
    db.pain.push(pain('fingers', 7));
    db.planned.push(mkPlanned('bouldering', H(4), 'evening', false));
    expect(evaluate(db, NOW).find((x) => x.ruleId === 'R1').operation).toBe('remove');

    const db2 = bare();
    db2.pain.push(pain('fingers', 7));
    db2.planned.push(mkPlanned('bouldering', H(4), 'evening', true));
    expect(evaluate(db2, NOW).find((x) => x.ruleId === 'R1').operation).toBe('reduce');
  });

  it('NRS 3–5 on a non-strength session is a mild reduce (Folgetag-Prüfung im Text)', () => {
    const db = bare();
    db.pain.push(pain('fingers', 4));
    db.planned.push(mkPlanned('bouldering', H(4), 'evening', false));
    const s = evaluate(db, NOW).find((x) => x.ruleId === 'R1');
    expect(s.operation).toBe('reduce');
    expect(s.why).toMatch(/Folgetag/);
  });
});

describe('R3/R4/R5 fallback operations', () => {
  it('R3 moves a NON-fixed finger session closer than 48 h', () => {
    const db = bare();
    db.logs.push(mkLog('bouldering', H(-20), 90, 7, { hardFingerLoad: true }));
    db.planned.push(mkPlanned('bouldering', H(4), 'evening', false));
    const s = evaluate(db, NOW).find((x) => x.ruleId === 'R3');
    expect(s.operation).toBe('move');
  });

  it('R4 reduces a FIXED pure-leg session inside the DOMS window', () => {
    const db = bare();
    db.logs.push(mkLog('mountain_day', H(-30), 330, 7, { elevationGain: 1150 }));
    db.planned.push(mkPlanned('strength', H(12), 'midday', true, {
      unit: 'legs', exercises: ['box_squat', 'goblet_squat', 'romanian_deadlift', 'standing_calf_raise'],
    }));
    const s = evaluate(db, NOW).find((x) => x.ruleId === 'R4');
    expect(s.operation).toBe('reduce');
  });

  it('R4 stays silent without an eccentric log and outside the 48 h spacing', () => {
    const db = bare();
    db.planned.push(mkPlanned('strength', H(12), 'midday', false, { unit: 'legs', exercises: ['box_squat', 'goblet_squat'] }));
    expect(evaluate(db, NOW).some((x) => x.ruleId === 'R4')).toBe(false);

    const db2 = bare();
    db2.logs.push(mkLog('mountain_day', H(-30), 330, 7, { elevationGain: 1150 })); // window 59 h
    db2.planned.push(mkPlanned('strength', H(25), 'midday', false, { unit: 'legs', exercises: ['box_squat', 'goblet_squat', 'romanian_deadlift', 'standing_calf_raise'] }));
    expect(evaluate(db2, NOW).some((x) => x.ruleId === 'R4')).toBe(false); // 55 h after descent
  });

  it('R5 reduces a müde region on a non-fixed, non-strength session', () => {
    const db = bare();
    db.fatigue.push(fat('shoulder', 'caution'));
    db.planned.push(mkPlanned('bouldering', H(4), 'evening', false));
    const s = evaluate(db, NOW).find((x) => x.ruleId === 'R5');
    expect(s.operation).toBe('reduce');
    expect(s.coach).toMatch(/müde/);
  });
});

describe('evaluate idempotency guards (§3.5)', () => {
  it('removed targets get no further suggestions', () => {
    const db = bare();
    db.pain.push(pain('fingers', 7));
    db.planned.push(mkPlanned('bouldering', H(4), 'evening', false, { status: 'removed' }));
    expect(evaluate(db, NOW)).toEqual([]);
  });

  it('reduced targets get no second reduce', () => {
    const db = bare();
    db.logs.push(mkLog('bouldering', H(-20), 90, 7, { hardFingerLoad: true }));
    db.planned.push(mkPlanned('bouldering', H(4), 'evening', true, { reduced: true }));
    expect(evaluate(db, NOW).some((x) => x.ruleId === 'R3')).toBe(false);
  });

  it('adjusted targets get no second swap', () => {
    const db = bare();
    db.pain.push(pain('shoulder', 4));
    db.planned.push(upperSession({ adjusted: true }));
    expect(evaluate(db, NOW).some((x) => x.operation === 'swap')).toBe(false);
  });
});

describe('R7 edges', () => {
  it('projected ratio is 0 without a chronic base', () => {
    const db = bare();
    db.planned.push(mkPlanned('mountain_day', H(24), 'morning', true, { hm: 1500 }));
    expect(r7.projectedRatio(db, NOW)).toBe(0);
  });

  it('stays silent above the threshold when no non-fixed run exists', () => {
    const db = bare();
    // Tiny chronic base + a huge fixed week -> ratio > 1.5, but nothing removable.
    db.logs.push(mkLog('running', H(-24 * 20), 30, 3));
    db.planned.push(mkPlanned('mountain_day', H(24), 'morning', true, { hm: 1500 }));
    db.planned.push(mkPlanned('bouldering', H(48), 'evening', true));
    expect(r7.projectedRatio(db, NOW)).toBeGreaterThan(1.5);
    expect(evaluate(db, NOW).some((x) => x.ruleId === 'R7')).toBe(false);
  });
});

describe('defaults & catalog access', () => {
  it('unknown rule ids resolve to empty params and count as active', () => {
    expect(ruleDef('R99')).toBeUndefined();
    expect(ruleParams('R99')).toEqual({});
    expect(ruleActive('R99')).toBe(true);
  });

  it('R2/R8 triggers handle profiles without constraints/disabledUnits', () => {
    expect(r2.triggers({ profile: {} })).toBe(false);
    expect(r8.triggers({ profile: {} })).toBe(false);
  });

  it('R4 window formula defaults elevation gain to the base (48 h)', () => {
    expect(r4.recoveryWindowHours(undefined)).toBe(48);
  });
});
