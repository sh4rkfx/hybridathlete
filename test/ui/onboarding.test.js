// Story #27: neutral weekly-load wording without data + first-run detection.
import { describe, it, expect } from 'vitest';
import { zoneWording, needsOnboarding } from '../../src/ui/helpers.js';
import { acwr } from '../../src/engine/acwr.js';
import { freshDb } from '../helpers/fixtures.js';

describe('zoneWording', () => {
  const a = (ratio, chronicWk = 1000) => ({ ratio, chronicWk, acute: ratio * chronicWk });

  it('is neutral without a chronic base — no "Untertrainiert" verdict on day one', () => {
    expect(zoneWording(a(0, 0))).toEqual({ zone: 'neutral', word: 'Noch keine Daten', ratioLabel: '–' });
    expect(zoneWording(acwr([], new Date()))).toMatchObject({ zone: 'neutral' });
  });

  it.each([
    [0.5, 'caution', 'Untertrainiert'],
    [1.0, 'fresh', 'Im grünen Bereich'],
    [1.4, 'caution', 'Erhöht – aufpassen'],
    [1.8, 'stop', 'Überlast'],
  ])('ratio %f -> %s / %s', (ratio, zone, word) => {
    expect(zoneWording(a(ratio))).toEqual({ zone, word, ratioLabel: ratio.toFixed(2) });
  });
});

describe('needsOnboarding', () => {
  const bare = () => ({ logs: [], planned: [] });

  it('is true on a fresh profile (nothing planned, nothing logged)', () => {
    expect(needsOnboarding(bare())).toBe(true);
  });

  it('removed sessions do not count as a plan', () => {
    const st = bare();
    st.planned.push({ id: 'x', status: 'removed' });
    expect(needsOnboarding(st)).toBe(true);
  });

  it('is false with a planned session OR history (existing users unchanged)', () => {
    const st = bare();
    st.planned.push({ id: 'x', status: 'planned' });
    expect(needsOnboarding(st)).toBe(false);

    const st2 = bare();
    st2.logs.push({ id: 'l', sportId: 'running' });
    expect(needsOnboarding(st2)).toBe(false);

    expect(needsOnboarding(freshDb(new Date('2026-07-20T19:00:00')))).toBe(false);
  });
});
