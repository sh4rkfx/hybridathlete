// Per-rule trigger predicates + params sourcing from the declarative catalog.
import { describe, it, expect } from 'vitest';
import * as r1 from '../../src/rules/rules/r1.js';
import * as r2 from '../../src/rules/rules/r2.js';
import * as r3 from '../../src/rules/rules/r3.js';
import * as r4 from '../../src/rules/rules/r4.js';
import * as r5 from '../../src/rules/rules/r5.js';
import * as r6 from '../../src/rules/rules/r6.js';
import * as r7 from '../../src/rules/rules/r7.js';
import * as r8 from '../../src/rules/rules/r8.js';
import { ruleParams, ruleDef, CATALOG } from '../../src/rules/params.js';
import { catalogOf } from '../../src/engine/catalog.js';
import { freshDb, mkFat, mkPlanned } from '../helpers/fixtures.js';

const now = new Date('2026-07-20T12:00:00');
const cat = catalogOf({});

describe('rule params come from the catalog', () => {
  it('resolves short ids to catalog entries', () => {
    expect(ruleDef('R1').ruleId).toBe('R1_pain');
    expect(ruleParams('R3').minHoursBetweenHighFingerLoad).toBe(48);
    expect(ruleParams('R4').affectedRegions).toEqual(['quads', 'posterior_chain', 'calves']);
    expect(ruleParams('R5').redReloadHours).toEqual([48, 72]);
    expect(ruleParams('R6').minHoursBetweenStrengthEndurance).toBe(6);
    expect(ruleParams('R7').zones.danger.min).toBe(1.5);
  });

  it('catalog declares 4 operation types with minimal-intervention order', () => {
    expect(CATALOG._meta.operationTypes).toEqual(['swap', 'reduce', 'move', 'remove']);
    expect(CATALOG._meta.minimalInterventionOrder).toEqual(['swap', 'reduce', 'move', 'remove']);
  });
});

describe('triggers()', () => {
  it('R1 fires only for NRS > 2 inside the 36 h window', () => {
    const db = freshDb(now);
    expect(r1.triggers(db, now)).toBe(false);
    db.pain.push({ id: 'p', region: 'fingers', nrs: 2, ts: now.toISOString() });
    expect(r1.triggers(db, now)).toBe(false);
    db.pain.push({ id: 'p2', region: 'fingers', nrs: 3, ts: now.toISOString() });
    expect(r1.triggers(db, now)).toBe(true);
  });

  it('R2 reflects configured constraints', () => {
    expect(r2.triggers(freshDb(now))).toBe(true); // knee yellow in the preset
    expect(r2.triggers({ profile: { constraints: [] } })).toBe(false);
  });

  it('R3 fires when a finger session is planned < 48 h after hard finger load', () => {
    const db = freshDb(now);
    expect(r3.triggers(db, now, cat)).toBe(true); // bouldering tonight, hard fingers 20 h ago
    db.logs = db.logs.filter((l) => !l.hardFingerLoad);
    expect(r3.triggers(db, now, cat)).toBe(false);
  });

  it('R4 fires inside the hm-scaled eccentric window and expires after it', () => {
    const db = freshDb(now);
    expect(r4.triggers(db, now, cat)).toBe(true); // mountain 30 h ago, window 59 h
    const later = new Date(now.getTime() + 40 * 36e5); // 70 h after descent
    expect(r4.triggers(db, later, cat)).toBe(false);
    expect(r4.recoveryWindowHours(600)).toBe(48);
    expect(r4.recoveryWindowHours(1800)).toBe(72);
    expect(r4.recoveryWindowHours(3000)).toBe(72); // capped
  });

  it('R5 fires on non-fresh fatigue within 72 h', () => {
    const db = freshDb(now);
    expect(r5.triggers(db, now)).toBe(true); // quads/calves/fingers müde in the seed
    db.fatigue = [];
    expect(r5.triggers(db, now)).toBe(false);
  });

  it('R6 fires on same-day strength + endurance closer than 6 h', () => {
    const db = freshDb(now);
    expect(r6.triggers(db, now, cat)).toBe(false);
    // Put a run 3 h after the legs strength session (today + 15 h)
    db.planned.push(mkPlanned('running', new Date(now.getTime() + 15 * 36e5), 'evening', false));
    expect(r6.triggers(db, now, cat)).toBe(true);
  });

  it('R7 fires only above the danger threshold', () => {
    const db = freshDb(now);
    expect(r7.projectedRatio(db, now)).toBeGreaterThan(1.5);
    expect(r7.triggers(db, now)).toBe(true);
    // Balanced load: no planned week, steady history -> no trigger
    const calm = { ...db, planned: [], };
    expect(r7.triggers(calm, now)).toBe(false);
  });

  it('R8 fires when a split unit is disabled', () => {
    expect(r8.triggers(freshDb(now))).toBe(true);
    expect(r8.triggers({ profile: { disabledUnits: [] } })).toBe(false);
  });
});

describe('R5 fatigue staleness', () => {
  it('entries older than 72 h no longer trigger', () => {
    const db = freshDb(now);
    db.fatigue = [mkFat('quads', 'stop', new Date(now.getTime() - 80 * 36e5))];
    expect(r5.triggers(db, now)).toBe(false);
  });
});
