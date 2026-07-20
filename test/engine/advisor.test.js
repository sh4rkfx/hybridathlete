// Story #32: plan advisor — curated coverage, honesty rule, split matrix,
// frequency hint, source mandate.
import { describe, it, expect } from 'vitest';
import { recommendPlan } from '../../src/engine/advisor.js';

const LEVELS = ['meta-analysis', 'rct', 'cohort', 'expert-consensus', 'assumption'];
const profile = (over = {}) => ({ goal: 'sport_support', split: 'PPL', trainingDays: 3, activeSports: [], ...over });

describe('coverage by other sports (curated)', () => {
  it('bouldering covers the pull unit, with the R8 einstreu gap', () => {
    const rec = recommendPlan(profile({ activeSports: ['bouldering'] }));
    expect(rec.disabledUnits).toEqual(['pull']);
    expect(rec.assignment).not.toContain('pull');
    expect(rec.gaps).toHaveLength(1);
    expect(rec.gaps[0].fixIds).toEqual(expect.arrayContaining(['rear_delt_fly_db']));
    expect(rec.rationale.some((r) => /deckt die pull-Unit/.test(r.text))).toBe(true);
  });

  it('HONESTY: endurance sports never count as strength coverage', () => {
    const rec = recommendPlan(profile({ activeSports: ['running', 'gravel_cycling', 'mountain_day'] }));
    expect(rec.disabledUnits).toEqual([]);
    expect(rec.neededUnits).toEqual(['push', 'pull', 'legs']);
    expect(rec.rationale.some((r) => /kein Maximalkraftreiz/.test(r.text))).toBe(true);
  });
});

describe('split matrix', () => {
  it('<=2 days with full need -> full body, trained every session', () => {
    const rec = recommendPlan(profile({ trainingDays: 2 }));
    expect(rec.split).toBe('full_body');
    expect(rec.assignment).toEqual(['full', 'full']);
    expect(rec.perUnitFrequency).toBe(2);
  });

  it('3 days with bouldering -> push/legs cycled (the user-story example)', () => {
    const rec = recommendPlan(profile({ activeSports: ['bouldering'], trainingDays: 3 }));
    expect(rec.split).toBe('PPL');
    expect(rec.assignment).toEqual(['push', 'legs', 'push']);
    expect(rec.perUnitFrequency).toBe(1.5);
    expect(rec.dayOffsets).toHaveLength(3);
  });

  it('clamps trainingDays to 1–5 and defaults to 3', () => {
    expect(recommendPlan(profile({ trainingDays: 9 })).trainingDays).toBe(5);
    expect(recommendPlan(profile({ trainingDays: 0 })).trainingDays).toBe(1);
    expect(recommendPlan(profile({ trainingDays: undefined })).trainingDays).toBe(3);
  });
});

describe('frequency hint for strength goal', () => {
  it('fires below 2×/week per lift, stays silent at >= 2×', () => {
    const low = recommendPlan(profile({ goal: 'kraftaufbau', activeSports: ['bouldering'], trainingDays: 3 }));
    expect(low.rationale.some((r) => /Pelland/.test(r.source) && /Frequenz|≥2/.test(r.text))).toBe(true);

    const high = recommendPlan(profile({ goal: 'kraftaufbau', activeSports: ['bouldering'], trainingDays: 4 }));
    expect(high.perUnitFrequency).toBe(2);
    expect(high.rationale.some((r) => /aktuell ~/.test(r.text))).toBe(false);
  });
});

describe('source mandate', () => {
  it('every rationale entry carries source + valid evidenceLevel', () => {
    const recs = [
      recommendPlan(profile({ activeSports: ['bouldering', 'running'], goal: 'kraftaufbau', trainingDays: 2 })),
      recommendPlan(profile()),
      recommendPlan(profile({ trainingDays: 1 })),
    ];
    for (const rec of recs) {
      expect(rec.rationale.length).toBeGreaterThan(0);
      for (const r of rec.rationale) {
        expect(r.source, r.text).toBeTruthy();
        expect(LEVELS, r.text).toContain(r.evidenceLevel);
      }
    }
  });
});
