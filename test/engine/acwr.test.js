// ACWR math + exact zone boundaries (story 4; kickoff mandates 0.79/0.80/1.30/1.31/1.50/1.51).
import { describe, it, expect } from 'vitest';
import { acwr, acwrZone } from '../../src/engine/acwr.js';

describe('acwr()', () => {
  it('yields ratio exactly 1.00 for a perfectly even 4-week history', () => {
    const now = new Date('2026-07-20T12:00:00');
    const mk = (dAgo) => ({ sportId: 'running', date: new Date(now.getTime() - dAgo * 864e5).toISOString(), duration: 100, sRPE: 6 });
    const logs = [mk(3), mk(10), mk(17), mk(24)];
    const { acute, chronicWk, ratio } = acwr(logs, now);
    expect(acute).toBe(600);
    expect(chronicWk).toBe(600);
    expect(ratio.toFixed(2)).toBe('1.00');
  });

  it('ignores logs outside the 28-day chronic window and future logs', () => {
    const now = new Date('2026-07-20T12:00:00');
    const mk = (dAgo) => ({ sportId: 'running', date: new Date(now.getTime() - dAgo * 864e5).toISOString(), duration: 100, sRPE: 6 });
    const { acute, chronicWk } = acwr([mk(30), mk(-1), mk(3)], now);
    expect(acute).toBe(600);        // only the 3-days-ago log
    expect(chronicWk).toBe(150);    // 600 / 4 — the 30-day-old and future logs don't count
  });

  it('returns ratio 0 when there is no chronic base', () => {
    expect(acwr([], new Date()).ratio).toBe(0);
  });
});

describe('acwrZone() — exact zone bounds', () => {
  it.each([
    [0.79, 'caution'], // detraining
    [0.80, 'fresh'],   // sweet spot lower bound (inclusive)
    [1.30, 'fresh'],   // sweet spot upper bound (inclusive)
    [1.31, 'caution'], // elevated
    [1.50, 'caution'], // elevated upper bound (inclusive)
    [1.51, 'stop'],    // danger
  ])('ratio %f -> %s', (ratio, zone) => {
    expect(acwrZone(ratio)).toBe(zone);
  });
});
