// Story #35: wording/label assertions for the critique polish.
import { describe, it, expect } from 'vitest';
import { RULE_META, ACWR_CHIP_LABEL } from '../../src/engine/texts.js';
import { evaluate } from '../../src/rules/evaluate.js';
import { freshDb } from '../helpers/fixtures.js';

describe('ACWR labels differentiate current vs. projected', () => {
  it('home chip is labeled as the CURRENT ratio', () => {
    expect(ACWR_CHIP_LABEL).toMatch(/aktuell/);
  });

  it('the R7 card speaks of the PROJECTED ratio', () => {
    const NOW = new Date('2026-07-20T19:00:00');
    const sugs = evaluate(freshDb(NOW), NOW);
    const r7 = sugs.find((s) => s.ruleId === 'R7');
    expect(r7.coach).toMatch(/prognostizierte/);
  });
});

describe('citation typography', () => {
  it('no German low-9 quote renders as a stray comma in any rule source', () => {
    for (const [id, r] of Object.entries(RULE_META)) {
      expect(r.src, id).not.toMatch(/‚/);
    }
  });
});

describe('rule source links (story #57)', () => {
  it('linked rules carry https URLs; R1/R6/R7 resolve via doi.org; R2/R5 stay unlinked', async () => {
    const { RULE_META } = await import('../../src/engine/texts.js');
    for (const [id, meta] of Object.entries(RULE_META)) {
      for (const l of meta.links ?? []) {
        expect(l.url, id).toMatch(/^https:\/\//);
        expect(l.label, id).toBeTruthy();
      }
    }
    for (const id of ['R1', 'R6', 'R7']) {
      expect(RULE_META[id].links.some((l) => l.url.startsWith('https://doi.org/')), id).toBe(true);
    }
    expect(RULE_META.R2.links).toBeUndefined();
    expect(RULE_META.R5.links).toBeUndefined();
  });
});
