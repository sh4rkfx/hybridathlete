// Story #39: check-in persistence helpers + recovery strip signal-only logic.
import { describe, it, expect } from 'vitest';
import { checkinDoneToday, todayCheckinLevels, currentRegionStatus } from '../../src/ui/helpers.js';

const NOW = new Date('2026-07-20T09:00:00');
const ts = (h) => new Date(NOW.getTime() + h * 36e5).toISOString();
const fat = (region, level, whenH, context = 'morning_checkin') => ({ id: region + whenH, region, level, ts: ts(whenH), context });

describe('checkinDoneToday / todayCheckinLevels', () => {
  it('is false/empty without a check-in today (post-session entries do not count)', () => {
    const state = { fatigue: [fat('quads', 'caution', -2, 'post_session'), fat('quads', 'caution', -30)] };
    expect(checkinDoneToday(state, NOW)).toBe(false);
    expect(todayCheckinLevels(state, NOW)).toEqual({});
  });

  it('returns today\'s saved levels so reopening shows what was entered', () => {
    const state = { fatigue: [fat('quads', 'caution', -1), fat('fingers', 'stop', -1)] };
    expect(checkinDoneToday(state, NOW)).toBe(true);
    expect(todayCheckinLevels(state, NOW)).toEqual({ quads: 'caution', fingers: 'stop' });
  });

  it('a correction later the same day wins (latest entry per region)', () => {
    const state = { fatigue: [fat('quads', 'stop', -3), fat('quads', 'fresh', -1)] };
    expect(todayCheckinLevels(state, NOW)).toEqual({ quads: 'fresh' });
  });
});

describe('currentRegionStatus — signal only', () => {
  it('returns an empty list when everything is fresh (UI renders the positive chip)', () => {
    expect(currentRegionStatus({ fatigue: [] }, NOW)).toEqual([]);
    expect(currentRegionStatus({ fatigue: [fat('quads', 'fresh', -1)] }, NOW)).toEqual([]);
  });

  it('lists only non-fresh regions, no fresh filler', () => {
    const state = { fatigue: [fat('quads', 'caution', -1), fat('shoulder', 'fresh', -1), fat('calves', 'stop', -2, 'manual')] };
    const regs = currentRegionStatus(state, NOW);
    expect(regs.map((x) => x.r).sort()).toEqual(['calves', 'quads']);
    expect(regs.every((x) => x.level !== 'fresh')).toBe(true);
  });
});
