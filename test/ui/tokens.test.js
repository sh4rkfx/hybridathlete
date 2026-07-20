// Story #28: WCAG-AA contrast for small meta text + slot/hour consistency.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluate } from '../../src/rules/evaluate.js';
import { SLOT_HOUR, slotOfHour } from '../../src/engine/time.js';
import { proposeChange } from '../../src/engine/planner.js';
import { loadDemoWeek } from '../../src/ui/demo.js';
import { PROFILE_SEED } from '../../src/data/repositories.js';
import { freshDb, mkLog, mkPlanned } from '../helpers/fixtures.js';
import { resetIds } from '../../src/engine/planner.js';

const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = css.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${name} not found as hex in styles.css`);
  return m[1];
};

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

describe('design-token contrast (WCAG AA, small text >= 4.5:1)', () => {
  it.each(['--bg', '--surface-1', '--surface-2', '--surface-3'])('--text-low on %s', (surface) => {
    expect(contrast(token('--text-low'), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the text hierarchy intact (hi > mid > low luminance)', () => {
    expect(luminance(token('--text-hi'))).toBeGreaterThan(luminance(token('--text-mid')));
    expect(luminance(token('--text-mid'))).toBeGreaterThan(luminance(token('--text-low')));
  });

  it('traffic-light colors are untouched (spec §12 — unantastbar)', () => {
    expect(token('--fresh')).toBe('#34D6A6');
    expect(token('--caution')).toBe('#F2B84B');
    expect(token('--stop')).toBe('#FF6188');
  });
});

describe('slot/hour consistency (story #28)', () => {
  const NOW = new Date('2026-07-20T19:00:00');

  it('proposeChange(move) normalizes the hour to the slot standard hour', () => {
    resetIds();
    const target = mkPlanned('strength', new Date('2026-07-21T01:00:00'), 'midday', false, { unit: 'legs' });
    const proposed = proposeChange('move', target);
    expect(new Date(proposed.date).getHours()).toBe(SLOT_HOUR.midday);
  });

  it('an accepted R4 move lands on the slot standard hour', () => {
    const db = freshDb(NOW);
    const r4 = evaluate(db, NOW).find((s) => s.ruleId === 'R4');
    const t = db.planned.find((p) => p.id === r4.targetId);
    Object.assign(t, r4.proposed);
    expect(new Date(t.date).getHours()).toBe(SLOT_HOUR[t.slot]);
    // and R4 must still not refire after the accepted move (T07 invariant)
    expect(evaluate(db, NOW).some((s) => s.ruleId === 'R4')).toBe(false);
  });

  it('demo week: every planned session sits in the column of its actual hour', () => {
    resetIds();
    const state = { profile: structuredClone(PROFILE_SEED), logs: [], fatigue: [], pain: [], planned: [], rejected: {} };
    loadDemoWeek(state, NOW);
    for (const p of state.planned) {
      expect(slotOfHour(new Date(p.date).getHours()), `${p.sportId} @ ${p.date}`).toBe(p.slot);
    }
    // the demo's R4 spacing is preserved (legs ~12 h from now, 42 h after descent)
    expect(evaluate(state, NOW).map((s) => s.ruleId).sort().join(',')).toBe('R3,R4,R7');
  });
});
