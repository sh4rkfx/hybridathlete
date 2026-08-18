// Pure derivations behind the energy screen (kickoff step 9). The repo has no
// DOM shim and never renders a component, so everything the screen decides
// lives here and is tested here.
import { describe, it, expect } from 'vitest';
import {
  prefillEntry, entryToDay, parseNumber, currentBody, assembleDays, deriveEnergy,
  nutritionConfig, setupGaps, isReady, reconcileToday, ENTRY_FIELDS,
} from '../../src/ui/energyHelpers.js';
import { loadDemoEnergy, buildDemoDays, DEMO_DAYS } from '../../src/ui/energyDemo.js';
import { validate } from '../../src/nutrition/config.js';

const NOW = new Date('2026-08-17T09:00:00');
const TODAY = '2026-08-17';

const withDays = (days, config = {}) => ({
  logs: [],
  nutrition: { days, config: validate(config).normalized, calibrations: [], ledger: [], phases: [] },
});

const SEED_CONFIG = {
  profile: { birthDate: '1988-06-16', sex: 'male', heightCm: 173, bodyComp: { mode: 'bodyFatPct', value: 27.9 } },
  goal: { mode: 'cut', target: { type: 'weight', valueKg: 82 } },
};

describe('parseNumber', () => {
  it.each([['2100', 2100], ['89,5', 89.5], ['  72.4 ', 72.4], ['', null], ['abc', null], [null, null]])(
    '%o -> %o', (raw, expected) => { expect(parseNumber(raw)).toBe(expected); });
});

describe('prefill', () => {
  const days = [
    { date: '2026-08-14', weightKg: 89.9, bodyFatPct: 28.1, kcal: 2050, proteinG: 150 },
    { date: '2026-08-15', weightKg: 89.6, kcal: 2100, proteinG: 155 },
    { date: '2026-08-16', weightKg: 89.4, kcal: 2080 },
  ];

  it('carries body values forward but never yesterday’s intake', () => {
    const entry = prefillEntry(withDays(days), TODAY);
    expect(entry.weightKg).toBe(89.4);
    expect(entry.bodyFatPct).toBe(28.1); // last recorded, two days back
    // Intake must be re-entered: carrying it forward would fabricate the very
    // data the calibration measures.
    expect(entry.kcal).toBeNull();
    expect(entry.proteinG).toBeNull();
    expect(entry.isNew).toBe(true);
  });

  it('reaches past a skipped day rather than blanking the form', () => {
    const gappy = [{ date: '2026-08-01', weightKg: 90.2, bodyFatPct: 28.5 }];
    expect(prefillEntry(withDays(gappy), TODAY)).toMatchObject({ weightKg: 90.2, bodyFatPct: 28.5 });
  });

  it('edits today’s row when one already exists', () => {
    const entry = prefillEntry(withDays([...days, { date: TODAY, kcal: 1990, weightKg: 89.2 }]), TODAY);
    expect(entry).toMatchObject({ kcal: 1990, weightKg: 89.2, isNew: false });
  });

  it('is all nulls on the very first day', () => {
    const entry = prefillEntry(withDays([]), TODAY);
    for (const field of ENTRY_FIELDS) expect(entry[field], field).toBeNull();
  });

  it('maps an entry to a day record with explicit nulls', () => {
    const day = entryToDay({ date: TODAY, kcal: 2100, weightKg: null, isNew: true });
    expect(day.date).toBe(TODAY);
    expect(day.kcal).toBe(2100);
    expect(day.fatG).toBeNull();
    expect(day.isNew).toBeUndefined(); // UI-only field does not reach the store
  });
});

describe('currentBody', () => {
  it('walks back to the last weigh-in and last body-fat reading', () => {
    const state = withDays([
      { date: '2026-08-10', weightKg: 90.0, bodyFatPct: 28.2 },
      { date: '2026-08-16', weightKg: 89.4 },
    ], SEED_CONFIG);
    const body = currentBody(state, nutritionConfig(state), TODAY);
    expect(body.weightKg).toBe(89.4);
    expect(body.bodyFatPct).toBe(28.2);
    expect(body.ffmKg).toBeCloseTo(89.4 * (1 - 0.282), 6);
  });

  it('ignores rows in the future', () => {
    const state = withDays([{ date: '2026-08-16', weightKg: 89.4 }, { date: '2026-09-01', weightKg: 85 }], SEED_CONFIG);
    expect(currentBody(state, nutritionConfig(state), TODAY).weightKg).toBe(89.4);
  });

  it('returns nulls with no data at all', () => {
    const state = withDays([], SEED_CONFIG);
    expect(currentBody(state, nutritionConfig(state), TODAY)).toMatchObject({ weightKg: null, ffmKg: null });
  });
});

describe('assembleDays', () => {
  it('lets a typed value win over the adapter estimate', async () => {
    const state = withDays([{ date: TODAY, totalKcal: 2500, kcal: 2100 }], { ...SEED_CONFIG, energy: { adapterId: 'formula' } });
    const [day] = (await assembleDays(state, nutritionConfig(state), { now: NOW })).slice(-1);
    expect(day.estimateKcal).toBe(2500);      // measured beats estimated
    expect(day.quality).toBe('measured');
  });

  it('fills in the estimate where nothing was typed', async () => {
    const state = withDays([{ date: TODAY, kcal: 2100, weightKg: 89.5 }], { ...SEED_CONFIG, energy: { adapterId: 'formula' } });
    const [day] = (await assembleDays(state, nutritionConfig(state), { now: NOW })).slice(-1);
    expect(day.estimateKcal).toBeGreaterThan(2000);
    expect(day.quality).toBe('estimated');
    expect(day.estimateIncludesTef).toBe(true);
  });

  it('resolves intake through the domain’s reconciliation', async () => {
    const state = withDays([{ date: TODAY, kcal: 2100, proteinG: 155, fatG: 70, carbsG: 200 }], SEED_CONFIG);
    const [day] = (await assembleDays(state, nutritionConfig(state), { now: NOW })).slice(-1);
    expect(day.intakeKcal).toBe(2050);  // 155*4 + 70*9 + 200*4, derived from complete macros
    expect(day.mismatch).toBe(false);
  });

  it('is empty when there is nothing to assemble', async () => {
    const state = withDays([], SEED_CONFIG);
    expect(await assembleDays(state, nutritionConfig(state), { now: NOW })).toEqual([]);
  });
});

describe('setup gaps', () => {
  it('names what is still missing', () => {
    expect(setupGaps(validate({}).normalized).sort())
      .toEqual(['birthDate', 'bodyComp', 'heightCm', 'sex']);
    expect(isReady(withDays([]))).toBe(false);
  });

  it('is satisfied by the seed profile', () => {
    expect(setupGaps(validate(SEED_CONFIG).normalized)).toEqual([]);
    expect(isReady(withDays([], SEED_CONFIG))).toBe(true);
  });

  it('wants a goal weight only when there is a goal', () => {
    expect(setupGaps(validate({ ...SEED_CONFIG, goal: { mode: 'cut', target: { type: 'weight', valueKg: null } } }).normalized))
      .toEqual(['goalWeight']);
    expect(setupGaps(validate({ ...SEED_CONFIG, goal: { mode: 'maintain', target: { type: 'weight', valueKg: null } } }).normalized))
      .toEqual([]);
  });
});

describe('the demo data actually demonstrates something', () => {
  const nutrition = { days: [], config: null, calibrations: [], ledger: [], phases: [] };
  loadDemoEnergy(nutrition, NOW);
  const state = { logs: [], nutrition };

  it('seeds a full window ending today', () => {
    expect(nutrition.days.length).toBe(DEMO_DAYS);
    expect(nutrition.days.at(-1).date).toBe(TODAY);
    expect(setupGaps(nutritionConfig(state))).toEqual([]);
  });

  it('is deterministic', () => {
    expect(buildDemoDays(NOW)).toEqual(buildDemoDays(NOW));
  });

  it('recovers a factor near the documented 0.95, at high confidence', async () => {
    const days = await assembleDays(state, nutritionConfig(state), { now: NOW });
    const d = deriveEnergy(state, { now: NOW, days });
    expect(d.factor.factor).toBeGreaterThan(0.90);
    expect(d.factor.factor).toBeLessThan(1.00);
    expect(d.calibration.confidence).toBe('high');
    expect(d.calibration.clamped).toBe(false);
  });

  it('produces a plausible target and energy availability', async () => {
    const days = await assembleDays(state, nutritionConfig(state), { now: NOW });
    const d = deriveEnergy(state, { now: NOW, days });
    expect(d.restTdeeKcal).toBeGreaterThan(2100);
    expect(d.restTdeeKcal).toBeLessThan(2600);
    expect(d.target.baseIntakeKcal).toBeGreaterThan(1600);
    expect(d.plannedIntakeKcal).toBeGreaterThanOrEqual(d.target.targetIntakeKcal);
    expect(d.macros.error).toBeNull();
    expect(d.availability.eaKcalPerKgFfm).toBeGreaterThan(d.availability.thresholdKcalPerKgFfm);
  });

  it('raises the tracking gap it deliberately contains, and nothing alarming', async () => {
    const days = await assembleDays(state, nutritionConfig(state), { now: NOW });
    const { flags } = deriveEnergy(state, { now: NOW, days });
    expect(flags.map((f) => f.code)).toContain('PROTEIN_NOT_TRACKED');
    expect(flags.filter((f) => f.level === 'stop')).toEqual([]);
  });

  it('can be reconciled into a ledger entry', async () => {
    const days = await assembleDays(state, nutritionConfig(state), { now: NOW });
    const d = deriveEnergy(state, { now: NOW, days });
    const entry = reconcileToday(d, d.config);
    expect(entry.date).toBe(TODAY);
    expect(Number.isFinite(entry.actualDeficitKcal)).toBe(true);
    expect(entry.bookedKcal).toBeGreaterThanOrEqual(0);
  });
});

describe('first run', () => {
  it('derives without throwing on an empty state', async () => {
    const state = withDays([], SEED_CONFIG);
    const days = await assembleDays(state, nutritionConfig(state), { now: NOW });
    const d = deriveEnergy(state, { now: NOW, days });
    expect(d.calibration.factor).toBeNull();
    expect(d.target.baseIntakeKcal).toBeNull();
    expect(d.macros).toBeNull();
    expect(d.availability.eaKcalPerKgFfm).toBeNull();
  });
});
