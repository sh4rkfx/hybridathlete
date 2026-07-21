// Story #55: week planner — the user-story wish set, placement constraints,
// sacrifice order, conflict reporting, source mandate.
import { describe, it, expect } from 'vitest';
import { recommendWeek, weekdayOffset } from '../../src/engine/week.js';

// 2026-07-21 is a Tuesday (getDay 2): Mi=+1, Fr=+3, Sa=+4, So=+5.
const NOW = new Date('2026-07-21T10:00:00');
const profile = { goal: 'sport_support', split: 'PPL', trainingDays: 2, activeSports: ['bouldering', 'mountain_day', 'running'], constraints: [] };
// The user-story example: 2× bouldering (Mi fix, Fr variabel), weekend
// mountain tour, strength with help, 1–2 runs "wenn möglich".
const WISHES = {
  bouldering: { count: 2, fixedDays: [3], preferredDays: [5] },
  mountain_day: { count: 1, fixedDays: [6] },
  running: { count: 2, optional: true },
};

const rec = () => recommendWeek(profile, WISHES, undefined, NOW);
const byDay = (r) => Object.fromEntries(r.sessions.map((s) => [s.dayOffset, s]));

describe('weekdayOffset', () => {
  it('maps weekdays into the coming 7 days (today = 0)', () => {
    expect(weekdayOffset(3, NOW)).toBe(1);  // Mi
    expect(weekdayOffset(6, NOW)).toBe(4);  // Sa
    expect(weekdayOffset(2, NOW)).toBe(0);  // heute (Di)
    expect(weekdayOffset(1, NOW)).toBe(6);  // nächster Mo
  });
});

describe('the user-story week', () => {
  it('places fixed wishes on their days, variable ones on preferred days', () => {
    const r = rec();
    const d = byDay(r);
    expect(d[1]).toMatchObject({ sportId: 'bouldering', fixed: true });   // Mi fix
    expect(d[3]).toMatchObject({ sportId: 'bouldering', fixed: false });  // Fr variabel
    expect(d[4]).toMatchObject({ sportId: 'mountain_day', fixed: true, slot: 'morning' }); // Sa fix
  });

  it('keeps leg-loaded strength out of the R4 window (mountain day + next day)', () => {
    const r = rec();
    const legs = r.sessions.find((s) => s.sportId === 'strength' && s.unit === 'legs');
    expect(legs).toBeTruthy();
    expect([4, 5]).not.toContain(legs.dayOffset); // Sa (Berg) + So gesperrt
    // push has no leg block and may sit anywhere free
    expect(r.sessions.filter((s) => s.sportId === 'strength')).toHaveLength(2); // PPL − pull (Bouldern aktiv)
  });

  it('one session per day; runs fill the remaining capacity last', () => {
    const r = rec();
    const days = r.sessions.map((s) => s.dayOffset);
    expect(new Set(days).size).toBe(days.length);
    // 7 Tage − (2 Bouldern + 1 Berg + 2 Kraft) = 2 freie Tage -> beide Läufe passen
    expect(r.sessions.filter((s) => s.sportId === 'running')).toHaveLength(2);
    expect(r.conflicts).toEqual([]);
  });

  it('sacrifices optional runs first when the week is full (conflict with R7 reason)', () => {
    const full = recommendWeek({ ...profile, trainingDays: 4 }, WISHES, undefined, NOW);
    const runs = full.sessions.filter((s) => s.sportId === 'running').length;
    expect(runs).toBeLessThan(2);
    const c = full.conflicts.find((x) => x.sportId === 'running');
    expect(c).toBeTruthy();
    expect(c.rule).toBe('R7');
    expect(c.reason).toMatch(/geopfert/);
  });

  it('reports occupied fixed wish days as conflicts', () => {
    const clash = recommendWeek(profile, {
      bouldering: { count: 1, fixedDays: [6] },
      mountain_day: { count: 1, fixedDays: [6] },
    }, undefined, NOW);
    expect(clash.conflicts.some((c) => c.rule === 'Kapazität')).toBe(true);
  });

  it('every rationale entry carries source + evidence (source mandate)', () => {
    const r = rec();
    expect(r.rationale.length).toBeGreaterThan(2);
    for (const item of r.rationale) {
      expect(item.source, item.text).toBeTruthy();
      expect(item.evidenceLevel, item.text).toBeTruthy();
    }
  });
});
