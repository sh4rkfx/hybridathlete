// Story #36: setup guidance — the advisor opens as the guided default only
// when no strength sessions are planned.
import { describe, it, expect } from 'vitest';
import { initialSetupSection } from '../../src/ui/helpers.js';
import { freshDb } from '../helpers/fixtures.js';

describe('initialSetupSection', () => {
  it('opens the advisor on a profile without planned strength sessions', () => {
    expect(initialSetupSection({ planned: [] })).toBe('advisor');
    expect(initialSetupSection({ planned: [{ sportId: 'bouldering', status: 'planned' }] })).toBe('advisor');
  });

  it('removed-only strength sessions do not count as a plan', () => {
    expect(initialSetupSection({ planned: [{ sportId: 'strength', status: 'removed' }] })).toBe('advisor');
  });

  it('collapses everything once strength sessions exist (status card is the map)', () => {
    expect(initialSetupSection({ planned: [{ sportId: 'strength', status: 'planned' }] })).toBeNull();
    expect(initialSetupSection(freshDb(new Date('2026-07-20T19:00:00')))).toBeNull();
  });
});
