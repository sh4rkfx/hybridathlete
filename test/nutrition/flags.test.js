// The flag matrix (kickoff step 6 and test 6: "jedes Flag löst in seinem
// Szenario aus und in keinem anderen").
//
// The shape of this suite is the assertion. A healthy baseline is built once
// and asserted to raise NOTHING; every scenario is that baseline with a single
// perturbation, and each asserts both that its flag fires and that the full
// set is exactly what was expected. A detector that fires too eagerly breaks
// every other scenario, which is the property worth having.
import { describe, it, expect } from 'vitest';
import { evaluateFlags, rhrBaseline, FLAG_DEFINITIONS, FLAG_CODES, LEVELS } from '../../src/nutrition/flags.js';
import { validate } from '../../src/nutrition/config.js';

const NOW = '2026-08-17';
const FFM = 64.53;
const BODY = { weightKg: 89.5, bodyFatPct: 27.9, ffmKg: FFM };

const cfg = (over = {}) => validate({
  profile: { birthDate: '1988-06-16', sex: 'male', heightCm: 173, bodyComp: { mode: 'bodyFatPct', value: 27.9 } },
  goal: { mode: 'cut', target: { type: 'weight', valueKg: 75 } },
  ...over,
}).normalized;

const dayBefore = (n) => {
  const d = new Date(`${NOW}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// 60 healthy days: intake on plan, losing 0.0649 kg/day (well inside the 1.0
// %/week ceiling and well outside the plateau band), protein ample, resting HR
// flat on its baseline, the source supplying every day.
function baselineDays() {
  return Array.from({ length: 60 }, (_, i) => {
    const age = 59 - i;
    return {
      date: dayBefore(age),
      kcal: 2100,
      intakeKcal: 2100,
      proteinG: 155,
      estimateKcal: 2457,
      weightKg: 89.5 - 0.0649 * i,
      restingHr: 52.7,
      exerciseKcal: 0,
      exerciseMinutes: 0,
    };
  });
}

function baselineState(over = {}) {
  return {
    now: NOW,
    days: baselineDays(),
    body: BODY,
    calibration: { factor: 0.95, clamped: false, rawFactor: 0.95, computedAt: dayBefore(5) },
    ledger: { balanceKcal: 0, saturated: false },
    lastDietBreakEndedAt: dayBefore(14),
    lastCalibratedAt: dayBefore(5),
    ...over,
  };
}

// Replaces the most recent `n` days via `patch`.
function patchLast(days, n, patch) {
  return days.map((day, i) => (i >= days.length - n ? { ...day, ...patch(day, i) } : day));
}

const codesOf = (flags) => flags.map((f) => f.code).sort();

describe('the healthy baseline', () => {
  it('raises no flags at all', () => {
    expect(codesOf(evaluateFlags(baselineState(), cfg()))).toEqual([]);
  });

  it('derives the resting-HR baseline from the first days', () => {
    expect(rhrBaseline(baselineDays(), cfg(), NOW)).toBe(52.7);
  });

  it('honours an explicit baseline over the automatic one', () => {
    expect(rhrBaseline(baselineDays(), cfg({ flags: { rhrBaseline: 60 } }), NOW)).toBe(60);
  });

  it('has no baseline without resting-HR data', () => {
    const noHr = baselineDays().map(({ restingHr, ...rest }) => rest);
    expect(rhrBaseline(noHr, cfg(), NOW)).toBeNull();
  });
});

// Each entry: the flag under test, the perturbation, and every code the
// scenario is expected to raise (usually just the one).
const SCENARIOS = [
  {
    code: 'RHR_ELEVATED',
    state: () => baselineState({ days: patchLast(baselineDays(), 7, () => ({ restingHr: 58 })) }),
  },
  {
    code: 'RHR_SUPPRESSED',
    state: () => baselineState({ days: patchLast(baselineDays(), 21, () => ({ restingHr: 48 })) }),
  },
  {
    code: 'PLATEAU',
    state: () => baselineState({ days: patchLast(baselineDays(), 21, () => ({ weightKg: 86 })) }),
  },
  {
    code: 'RATE_TOO_FAST',
    // 0.2 kg/day is 1.56 %/week against a 1.0 %/week ceiling.
    state: () => baselineState({
      days: patchLast(baselineDays(), 21, (day, i) => ({ weightKg: 89.5 - 0.2 * (i - 38) })),
    }),
  },
  {
    code: 'PROTEIN_LOW',
    state: () => baselineState({ days: patchLast(baselineDays(), 7, () => ({ proteinG: 100 })) }),
  },
  {
    code: 'PROTEIN_NOT_TRACKED',
    state: () => baselineState({ days: patchLast(baselineDays(), 4, () => ({ proteinG: undefined })) }),
  },
  {
    code: 'MACRO_KCAL_MISMATCH',
    // Complete macros deriving 2620 kcal against an entered 2100: 25 % apart.
    state: () => baselineState({
      days: patchLast(baselineDays(), 2, () => ({ proteinG: 155, fatG: 80, carbsG: 320 })),
    }),
  },
  {
    code: 'TRACKING_GAP',
    state: () => baselineState({ days: patchLast(baselineDays(), 5, () => ({ intakeKcal: undefined, kcal: undefined })) }),
    also: [],
  },
  {
    code: 'FACTOR_CLAMPED',
    state: () => baselineState({ calibration: { factor: 0.7, rawFactor: 0.61, clamped: true, computedAt: dayBefore(5) } }),
  },
  {
    code: 'EA_LOW',
    // EA 21.7 kcal/kg FFM: under the tapered threshold of 22.93, above critical.
    state: () => baselineState({ days: patchLast(baselineDays(), 6, () => ({ intakeKcal: 1400, kcal: 1400 })) }),
  },
  {
    code: 'EA_CRITICAL',
    // Three consecutive days only, so EA_LOW's "5 of 7" stays quiet.
    state: () => baselineState({ days: patchLast(baselineDays(), 3, () => ({ intakeKcal: 1000, kcal: 1000 })) }),
  },
  {
    code: 'LEDGER_SATURATED',
    state: () => baselineState({ ledger: { balanceKcal: 1200, saturated: true } }),
  },
  {
    code: 'DIET_BREAK_DUE',
    state: () => baselineState({ lastDietBreakEndedAt: dayBefore(11 * 7) }),
  },
  {
    code: 'RECALIBRATION_DUE',
    state: () => baselineState({ lastCalibratedAt: dayBefore(60) }),
  },
  {
    code: 'SOURCE_DEGRADED',
    state: () => baselineState({ days: patchLast(baselineDays(), 10, () => ({ estimateKcal: undefined })) }),
  },
  {
    code: 'DEVICE_CHANGE_DETECTED',
    // A 20 % jump in rest-day expenditure at unchanged activity and pulse.
    state: () => baselineState({ days: patchLast(baselineDays(), 21, () => ({ estimateKcal: 2948 })) }),
  },
  {
    code: 'DISTRIBUTION_SHIFT',
    state: () => {
      // The detector refuses to compare against a thin prior window — it wants
      // at least half of history.windowDays — so the fixture supplies 120 days.
      const priorYear = Array.from({ length: 120 }, (_, i) => {
        const d = new Date(`${NOW}T00:00:00Z`);
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        d.setUTCDate(d.getUTCDate() - (119 - i));
        return { date: d.toISOString().slice(0, 10), estimateKcal: 1900 };
      });
      return baselineState({ historyDays: [...priorYear, ...baselineDays()] });
    },
  },
  {
    code: 'NON_REPRESENTATIVE_DATA',
    config: () => cfg({
      history: { trainingContext: { periods: [{ from: dayBefore(9), to: NOW, label: 'rehab', representative: false }] } },
    }),
    state: baselineState,
  },
];

describe('the flag matrix (test 6)', () => {
  it('covers every defined flag', () => {
    expect(SCENARIOS.map((s) => s.code).sort()).toEqual([...FLAG_CODES].sort());
  });

  it.each(SCENARIOS.map((s) => [s.code, s]))('%s fires in its own scenario and nothing else does', (code, scenario) => {
    const flags = evaluateFlags(scenario.state(), (scenario.config ?? cfg)());
    expect(codesOf(flags)).toEqual([code, ...(scenario.also ?? [])].sort());
    const flag = flags.find((f) => f.code === code);
    expect(LEVELS).toContain(flag.level);
    expect(flag.suggestedAction).toBeTruthy();
    expect(flag.params).toBeTypeOf('object');
  });
});

describe('flag shape and ordering', () => {
  it('every definition declares a level and an action', () => {
    for (const definition of FLAG_DEFINITIONS) {
      expect(LEVELS, definition.code).toContain(definition.level);
      expect(definition.suggestedAction, definition.code).toBeTruthy();
      expect(definition.detect, definition.code).toBeTypeOf('function');
    }
  });

  it('codes are unique', () => {
    expect(new Set(FLAG_CODES).size).toBe(FLAG_CODES.length);
  });

  it('sorts stop before warn before info', () => {
    const state = baselineState({
      days: patchLast(baselineDays(), 21, () => ({ restingHr: 48 })),   // stop
      ledger: { balanceKcal: 1200, saturated: true },                    // info
      calibration: { factor: 0.7, rawFactor: 0.61, clamped: true, computedAt: dayBefore(5) }, // warn
    });
    expect(evaluateFlags(state, cfg()).map((f) => f.level)).toEqual(['stop', 'warn', 'info']);
  });

  it('carries a since date wherever one is meaningful', () => {
    const state = baselineState({ days: patchLast(baselineDays(), 7, () => ({ restingHr: 58 })) });
    expect(evaluateFlags(state, cfg())[0].since).toBe(dayBefore(6));
  });
});

describe('robustness', () => {
  it('an empty state raises only the tracking gap, and does not throw', () => {
    expect(codesOf(evaluateFlags({ now: NOW, days: [] }, cfg()))).toEqual(['TRACKING_GAP']);
    expect(codesOf(evaluateFlags(undefined, cfg()))).toEqual(['TRACKING_GAP']);
  });

  it('a detector that throws is contained rather than taking the rest down', () => {
    const definition = FLAG_DEFINITIONS.find((d) => d.code === 'FACTOR_CLAMPED');
    const original = definition.detect;
    definition.detect = () => { throw new Error('boom'); };
    try {
      // The broken detector is skipped; every other flag still runs.
      const state = baselineState({ ledger: { balanceKcal: 1200, saturated: true } });
      expect(() => evaluateFlags(state, cfg())).not.toThrow();
      expect(codesOf(evaluateFlags(state, cfg()))).toEqual(['LEDGER_SATURATED']);
    } finally {
      definition.detect = original;
    }
  });

  it('detectors without their inputs stay silent instead of guessing', () => {
    const bare = { now: NOW, days: baselineDays().map(({ restingHr, estimateKcal, ...rest }) => rest) };
    const flags = codesOf(evaluateFlags(bare, cfg()));
    expect(flags).not.toContain('RHR_ELEVATED');
    expect(flags).not.toContain('RHR_SUPPRESSED');
    expect(flags).not.toContain('DEVICE_CHANGE_DETECTED');
    expect(flags).not.toContain('PROTEIN_LOW'); // no FFM supplied
  });

  it('maintain mode has no plateau to report', () => {
    const state = baselineState({ days: patchLast(baselineDays(), 21, () => ({ weightKg: 86 })) });
    const maintain = cfg({ goal: { mode: 'maintain', target: { type: 'weight', valueKg: null } } });
    expect(codesOf(evaluateFlags(state, maintain))).not.toContain('PLATEAU');
  });
});
