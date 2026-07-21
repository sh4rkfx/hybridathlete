// Story #54: Font-scale math, session summary, hardFingerLoad heuristic.
import { describe, it, expect } from 'vitest';
import { FONT_GRADES, GRIPS, gradeIndex, indexGrade, sessionSummary, suggestHardFingerLoad, bestPastGrade } from '../../src/engine/boulder.js';

const B = (grade, result, grip) => ({ grade, result, grip, seconds: 60 });

describe('Font scale', () => {
  it('is ordinal and round-trips', () => {
    expect(FONT_GRADES[0]).toBe('4');
    expect(FONT_GRADES[FONT_GRADES.length - 1]).toBe('8A');
    expect(gradeIndex('6C+')).toBeGreaterThan(gradeIndex('6B'));
    for (const g of FONT_GRADES) expect(indexGrade(gradeIndex(g))).toBe(g);
    expect(indexGrade(-5)).toBe('4');
    expect(indexGrade(99)).toBe('8A');
  });
});

describe('sessionSummary', () => {
  it('averages only sent boulders (flash/top); fails count as attempts', () => {
    const s = sessionSummary([
      B('6B', 'flash'), B('6B+', 'top'), B('6C', 'top'),
      B('7A', 'fail'), B('7A', 'fail'),
    ]);
    // sent indices: 6B=6, 6B+=7, 6C=8 -> mean 7 -> 6B+
    expect(s.avgGrade).toBe('6B+');
    expect(s.counts).toEqual({ flash: 1, top: 2, fail: 2 });
    expect(s.sent).toBe(3);
    expect(s.total).toBe(5);
    expect(s.maxGrade).toBe('7A'); // attempts count for the max
  });

  it('rounds the ordinal mean to the nearest grade', () => {
    const s = sessionSummary([B('6A+', 'top'), B('6B', 'top'), B('6C+', 'flash')]);
    expect(s.avgGrade).toBe('6B+'); // indices 5,6,9 -> mean 6.67 -> 7 -> 6B+
  });

  it('empty or all-fail sessions have no average', () => {
    expect(sessionSummary([]).avgGrade).toBeNull();
    expect(sessionSummary([B('6A', 'fail')]).avgGrade).toBeNull();
  });
});

describe('hardFingerLoad heuristic (assumption, overridable)', () => {
  it('triggers at >= 1/3 fingery grips (Crimp/Pocket)', () => {
    expect(suggestHardFingerLoad([B('6A', 'top', 'Crimp'), B('6A', 'top', 'Jug'), B('6A', 'top', 'Sloper')], null)).toBe(true);
    expect(suggestHardFingerLoad([B('6A', 'top', 'Crimp'), B('6A', 'top', 'Jug'), B('6A', 'top', 'Jug'), B('6A', 'top', 'Sloper')], null)).toBe(false);
  });

  it('triggers on limit attempts at/above the personal best', () => {
    expect(suggestHardFingerLoad([B('7A', 'fail', 'Jug')], '7A')).toBe(true);
    expect(suggestHardFingerLoad([B('6B', 'top', 'Jug')], '7A')).toBe(false);
    expect(suggestHardFingerLoad([], '7A')).toBe(false);
  });

  it('bestPastGrade scans past logs for the highest sent grade', () => {
    const state = { logs: [
      { boulders: [B('6C', 'top'), B('7A', 'fail')] },
      { boulders: [B('6C+', 'flash')] },
      { },
    ] };
    expect(bestPastGrade(state)).toBe('6C+');
    expect(bestPastGrade({ logs: [] })).toBeNull();
  });

  it('grip catalog covers the requested forms', () => {
    expect(GRIPS).toEqual(expect.arrayContaining(['Jug', 'Sloper', 'Crimp', 'Pinch', 'Pocket']));
  });
});
