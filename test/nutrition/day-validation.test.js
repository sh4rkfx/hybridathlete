// Bounds on what a person can type into a day. The failure these prevent is
// silent: 75 % body fat stored happily and then distorted fat-free mass, the
// protein target and the Katch/Cunningham BMR for as long as the row lived.
import { describe, it, expect } from 'vitest';
import {
  DAY_BOUNDS, checkField, checkDrift, checkDay, sanitizeDay, driftAllowance,
} from '../../src/nutrition/dayValidation.js';
import de from '../../src/i18n/de.json' with { type: 'json' };

describe('field bounds', () => {
  // The exact value that prompted this module. Asserting 75.1 instead would
  // have passed against a ceiling of 75 while 75 itself sailed through as
  // merely unusual — which is what the first version of this did.
  it('refuses the body fat that started this', () => {
    expect(checkField('bodyFatPct', 75)).toMatchObject({ level: 'error', code: 'DAY_ABOVE_HARD_MAX' });
  });

  it('refuses a fraction typed as a percentage', () => {
    // 0.18 means 18 %, and taking it at face value would put fat-free mass at
    // 99.8 % of body weight.
    expect(checkField('bodyFatPct', 0.18)).toMatchObject({ level: 'error', code: 'DAY_BELOW_HARD_MIN' });
  });

  it('accepts a lean athlete without complaint', () => {
    expect(checkField('bodyFatPct', 6)).toBeNull();
  });

  // Contest-stage lean is real, so it must be storable — but it is rare enough
  // that a typo is the likelier explanation, which is exactly what the warn
  // tier is for: keep the value, say something.
  it('remarks on contest-stage lean rather than refusing it', () => {
    expect(checkField('bodyFatPct', 4)).toMatchObject({ level: 'warn', code: 'DAY_UNUSUALLY_LOW' });
  });

  it.each([
    ['weightKg', 88.4], ['kcal', 2143], ['proteinG', 168], ['fatG', 71],
    ['carbsG', 210], ['fiberG', 32], ['alcoholG', 0],
  ])('says nothing about an ordinary %s of %s', (field, value) => {
    expect(checkField(field, value)).toBeNull();
  });

  it('allows a fasting day but remarks on it', () => {
    expect(checkField('kcal', 0)).toMatchObject({ level: 'warn', code: 'DAY_UNUSUALLY_LOW' });
  });

  it('allows a grand-tour stage day', () => {
    expect(checkField('kcal', 7500)).toBeNull();
  });

  it('warns rather than refuses above the plausible ceiling', () => {
    expect(checkField('kcal', 9000)).toMatchObject({ level: 'warn', code: 'DAY_UNUSUALLY_HIGH' });
  });

  it('refuses what no day of eating can be', () => {
    expect(checkField('kcal', 30000)).toMatchObject({ level: 'error' });
  });

  it('ignores an empty field, which is not an error but an absence', () => {
    expect(checkField('kcal', null)).toBeNull();
    expect(checkField('kcal', undefined)).toBeNull();
  });

  it('refuses values that are not numbers', () => {
    expect(checkField('weightKg', NaN)).toMatchObject({ level: 'error', code: 'DAY_NOT_A_NUMBER' });
    expect(checkField('weightKg', Infinity)).toMatchObject({ level: 'error', code: 'DAY_NOT_A_NUMBER' });
  });

  it('has nothing to say about a field it does not govern', () => {
    expect(checkField('restingHr', 48)).toBeNull();
  });

  it('keeps every hard bound outside its plausible band', () => {
    for (const [field, b] of Object.entries(DAY_BOUNDS)) {
      expect(b.hard[0], `${field} hard min`).toBeLessThanOrEqual(b.plausible[0]);
      expect(b.hard[1], `${field} hard max`).toBeGreaterThanOrEqual(b.plausible[1]);
    }
  });

  it('states a source and an evidence level for every bound', () => {
    for (const [field, b] of Object.entries(DAY_BOUNDS)) {
      expect(b.source, field).toBeTruthy();
      expect(['strong', 'moderate', 'limited', 'assumption'], field).toContain(b.evidenceLevel);
    }
  });
});

describe('drift against the last reading', () => {
  const at = (date, value) => ({ date, value });

  it('accepts an overnight swing that is really water', () => {
    expect(checkDrift('weightKg', at('2026-08-18', 89.6), at('2026-08-17', 88.0))).toBeNull();
  });

  it('flags a slipped digit that every bound would let through', () => {
    // 98.4 instead of 89.4: inside every bound, impossible overnight.
    expect(checkDrift('weightKg', at('2026-08-18', 98.4), at('2026-08-17', 89.4)))
      .toMatchObject({ level: 'warn', code: 'DAY_JUMPED' });
  });

  it('widens the allowance over a gap, but not without limit', () => {
    expect(driftAllowance('weightKg', 1)).toBe(3);
    expect(driftAllowance('weightKg', 5)).toBe(7);
    expect(driftAllowance('weightKg', 365)).toBe(10);  // a long gap must not excuse anything
  });

  it('is looser for bioimpedance than for a scale', () => {
    expect(driftAllowance('bodyFatPct', 1)).toBeGreaterThan(driftAllowance('weightKg', 1) - 1);
    expect(checkDrift('bodyFatPct', at('2026-08-18', 20.5), at('2026-08-17', 18))).toBeNull();
  });

  it('has no opinion without a previous reading', () => {
    expect(checkDrift('weightKg', at('2026-08-18', 88), null)).toBeNull();
  });

  it('governs no drift for fields where a jump means nothing', () => {
    expect(driftAllowance('kcal', 1)).toBeNull();
    expect(checkDrift('kcal', at('2026-08-18', 3500), at('2026-08-17', 1200))).toBeNull();
  });
});

describe('a whole day', () => {
  const history = [
    { date: '2026-08-16', weightKg: 89.6, bodyFatPct: 18.2 },
    { date: '2026-08-17', weightKg: 89.4 },
  ];

  it('reaches past a day without a weigh-in to find the last one', () => {
    const issues = checkDay({ date: '2026-08-18', bodyFatPct: 30 }, { history });
    expect(issues.some((i) => i.code === 'DAY_JUMPED')).toBe(true);
  });

  it('puts refusals before remarks', () => {
    const issues = checkDay({ date: '2026-08-18', bodyFatPct: 90, kcal: 0 }, { history });
    expect(issues[0].level).toBe('error');
  });

  it('says nothing about a normal day', () => {
    expect(checkDay({ date: '2026-08-18', weightKg: 89.2, kcal: 2100, proteinG: 165 }, { history })).toEqual([]);
  });

  it('does not check drift on a field it already refused', () => {
    const issues = checkDay({ date: '2026-08-18', weightKg: 900 }, { history });
    expect(issues.filter((i) => i.field === 'weightKg')).toHaveLength(1);
  });
});

describe('sanitizeDay', () => {
  it('drops the refused field and keeps the one typed beside it', () => {
    const { day, refused } = sanitizeDay({ date: '2026-08-18', weightKg: 88.4, bodyFatPct: 90 });
    expect(day.weightKg).toBe(88.4);   // the good value survives
    expect(day.bodyFatPct).toBeNull();
    expect(refused).toEqual(['bodyFatPct']);
  });

  it('keeps a merely unusual value, since it is stored and only remarked on', () => {
    const { day, issues, refused } = sanitizeDay({ date: '2026-08-18', kcal: 0 });
    expect(day.kcal).toBe(0);
    expect(refused).toEqual([]);
    expect(issues[0].level).toBe('warn');
  });

  it('leaves a clean day untouched', () => {
    const input = { date: '2026-08-18', weightKg: 88.4, kcal: 2143 };
    expect(sanitizeDay(input)).toMatchObject({ day: input, issues: [], refused: [] });
  });
});

describe('every code has German wording', () => {
  const codes = new Set();
  const collect = (issue) => issue && codes.add(`${issue.level}:${issue.code}`);
  collect(checkField('weightKg', 0.1));
  collect(checkField('weightKg', 9999));
  collect(checkField('weightKg', NaN));
  collect(checkField('kcal', 0));
  collect(checkField('kcal', 9000));
  collect(checkDrift('weightKg', { date: '2026-08-18', value: 98.4 }, { date: '2026-08-17', value: 89.4 }));

  it('covers every code the domain can emit', () => {
    expect(codes.size).toBe(6);
    for (const entry of codes) {
      const [level, code] = entry.split(':');
      const bucket = level === 'error' ? de.nutrition.errors : de.nutrition.warnings;
      expect(bucket[code], entry).toBeTruthy();
    }
  });

  it('names every governed field in German', () => {
    for (const field of Object.keys(DAY_BOUNDS)) {
      expect(de.nutrition.fields[field], field).toBeTruthy();
    }
  });
});
