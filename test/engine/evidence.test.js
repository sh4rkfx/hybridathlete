// Story #31: source mandate for goal schemes & split evidence + splitHint logic.
import { describe, it, expect } from 'vitest';
import { GOAL_SCHEMES, SPLIT_EVIDENCE, SPLITS } from '../../src/engine/catalog.js';
import { splitHint } from '../../src/engine/generator.js';

const LEVELS = ['meta-analysis', 'rct', 'cohort', 'expert-consensus', 'assumption'];

describe('source mandate for goal schemes (AC4 culture)', () => {
  it.each(Object.keys(GOAL_SCHEMES))('goal %s carries source + valid evidenceLevel', (goal) => {
    const g = GOAL_SCHEMES[goal];
    expect(g.source, goal).toBeTruthy();
    expect(g.source.length, goal).toBeGreaterThan(30);
    expect(LEVELS, goal).toContain(g.evidenceLevel);
  });

  it('split evidence is documented (Ramos-Campo 2024)', () => {
    expect(SPLIT_EVIDENCE.source).toMatch(/Ramos-Campo/);
    expect(SPLIT_EVIDENCE.evidenceLevel).toBe('meta-analysis');
  });
});

describe('splitHint', () => {
  it('hints towards frequency for kraftaufbau on 1×/week-per-lift splits', () => {
    for (const split of ['PPL', 'push_pull']) {
      const h = splitHint({ goal: 'kraftaufbau', split });
      expect(h, split).toBeTruthy();
      expect(h.text).toMatch(/Frequenz/);
      expect(h.source).toMatch(/Pelland/);
      expect(LEVELS).toContain(h.evidenceLevel);
    }
  });

  it('stays silent for high-frequency splits and for every other goal', () => {
    expect(splitHint({ goal: 'kraftaufbau', split: 'full_body' })).toBeNull();
    expect(splitHint({ goal: 'kraftaufbau', split: 'upper_lower' })).toBeNull();
    for (const goal of ['hypertrophie', 'erhalt', 'sport_support']) {
      for (const split of Object.keys(SPLITS)) {
        expect(splitHint({ goal, split }), `${goal}/${split}`).toBeNull();
      }
    }
  });
});
