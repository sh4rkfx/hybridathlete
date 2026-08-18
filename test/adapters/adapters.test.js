// Adapter contracts and the two v1 data sources (kickoff step 7).
import { describe, it, expect } from 'vitest';
import { assertAdapterContract, dataSourceProblems, DATA_SOURCE_CAPABILITIES } from '../../src/adapters/contract.js';
import { createManualAdapter, toDayMetrics, MANUAL_ADAPTER_ID } from '../../src/adapters/ManualAdapter.js';
import { createFormulaAdapter, activeKcal, minutesByDate, ACTIVE_REGRESSION } from '../../src/adapters/FormulaAdapter.js';
import { validate } from '../../src/nutrition/config.js';

const NOW = new Date('2026-08-17T00:00:00');
const SEED_PROFILE = { birthDate: '1988-06-16', sex: 'male', heightCm: 173, bodyComp: { mode: 'bodyFatPct', value: 27.9 } };
const cfg = (over = {}) => validate({ profile: SEED_PROFILE, ...over }).normalized;

describe('the contract', () => {
  const adapters = [
    ['manual', createManualAdapter()],
    ['formula', createFormulaAdapter({ config: cfg(), weightKg: 89.5, now: NOW })],
  ];

  it.each(adapters)('%s conforms', (_name, adapter) => {
    expect(() => assertAdapterContract(adapter)).not.toThrow();
  });

  it.each(adapters)('%s declares every capability as a boolean', (_name, adapter) => {
    expect(Object.keys(adapter.capabilities).sort()).toEqual([...DATA_SOURCE_CAPABILITIES].sort());
  });

  it('rejects a missing capability rather than treating it as false', () => {
    const partial = { id: 'x', capabilities: { totalKcal: true }, fetchRange() {}, isAvailable() {} };
    expect(dataSourceProblems(partial).length).toBe(DATA_SOURCE_CAPABILITIES.length - 1);
    expect(() => assertAdapterContract(partial)).toThrow(/contract violated/);
  });

  it('rejects an unknown capability, a missing id and a missing method', () => {
    expect(dataSourceProblems({ id: 'x', capabilities: { nope: true }, fetchRange() {}, isAvailable() {} })
      .some((p) => /unknown capability 'nope'/.test(p))).toBe(true);
    expect(dataSourceProblems({ capabilities: {}, fetchRange() {}, isAvailable() {} })
      .some((p) => /missing id/.test(p))).toBe(true);
    expect(dataSourceProblems({ id: 'x', capabilities: {} }).some((p) => /fetchRange/.test(p))).toBe(true);
    expect(dataSourceProblems(null)).toEqual(['DataSourceAdapter: not an object']);
  });
});

describe('ManualAdapter', () => {
  const rows = [
    { date: '2026-08-15', totalKcal: 2400, weightKg: 89.5, restingHr: 53 },
    { date: '2026-08-16', totalKcal: 2900, exerciseMinutes: 90, exerciseKcal: 500 },
    { date: '2026-08-17', weightKg: 89.2 },
  ];

  it('hands back what was typed and nothing more', async () => {
    const days = await createManualAdapter({ rows }).fetchRange('2026-08-15', '2026-08-17');
    expect(days.map((d) => d.date)).toEqual(['2026-08-15', '2026-08-16', '2026-08-17']);
    expect(days[0]).toMatchObject({ totalKcal: 2400, weightKg: 89.5, restingHr: 53 });
    // blank stays null — this is what makes the calibration refuse to guess
    expect(days[2].totalKcal).toBeNull();
    expect(days[0].exerciseKcal).toBeNull();
  });

  it('reports that its totals exclude thermogenesis', async () => {
    const adapter = createManualAdapter({ rows });
    expect(adapter.capabilities.includesTef).toBe(false);
    const [day] = await adapter.fetchRange('2026-08-15', '2026-08-15');
    expect(day.estimateIncludesTef).toBe(false);
  });

  it('clips to the requested range and sorts', async () => {
    const days = await createManualAdapter({ rows: [...rows].reverse() }).fetchRange('2026-08-16', '2026-08-16');
    expect(days.map((d) => d.date)).toEqual(['2026-08-16']);
  });

  it('defaults quality to measured and rejects a bogus one', () => {
    expect(toDayMetrics({ date: 'x' }).quality).toBe('measured');
    expect(toDayMetrics({ date: 'x', quality: 'guessed' }).quality).toBe('measured');
    expect(toDayMetrics({ date: 'x', quality: 'interpolated' }).quality).toBe('interpolated');
  });

  it('is always available and copes with no rows', async () => {
    const adapter = createManualAdapter();
    expect(await adapter.isAvailable()).toBe(true);
    expect(await adapter.fetchRange('2026-01-01', '2026-12-31')).toEqual([]);
    expect(adapter.id).toBe(MANUAL_ADAPTER_ID);
  });
});

describe('FormulaAdapter', () => {
  const BMR = 1790; // seed profile median, asserted in energy.test.js
  const adapter = (over = {}) => createFormulaAdapter({ config: cfg(), weightKg: 89.5, now: NOW, ...over });

  it('reproduces all three documented day types of the seed profile', async () => {
    // The validation that justifies the whole formulation. Kickoff figures:
    // rest 2334, training 60-120 min 2803, training > 120 min 3127.
    const logs = [
      { id: 'a', date: '2026-08-15T18:00:00', duration: 105 },
      { id: 'b', date: '2026-08-16T09:00:00', duration: 180 },
    ];
    const days = await adapter({ sessionLogs: logs }).fetchRange('2026-08-14', '2026-08-16');
    const [rest, medium, long] = days.map((d) => d.totalKcal);
    expect(Math.round(rest)).toBe(2328);       // doc 2334
    expect(Math.round(medium)).toBe(2806);     // doc 2803
    expect(Math.round(long)).toBe(3126);       // doc 3127
    for (const [actual, documented] of [[rest, 2334], [medium, 2803], [long, 3127]]) {
      expect(Math.abs(actual - documented)).toBeLessThan(10);
    }
  });

  it('does not collapse to one estimate for every day', () => {
    // The failure mode the non-exercise PAL exists to avoid: BMR x 1.55 = 2775
    // on a rest day and on a mountain day alike.
    expect(Math.round(BMR * cfg().energy.palFactor)).toBe(2775);
    expect(cfg().energy.nonExercisePalFactor).toBeLessThan(cfg().energy.palFactor);
  });

  it('reports that a PAL-based total already contains thermogenesis', async () => {
    expect(adapter().capabilities.includesTef).toBe(true);
    const [day] = await adapter().fetchRange('2026-08-17', '2026-08-17');
    expect(day.estimateIncludesTef).toBe(true);
  });

  it('emits one row per day across the range, gaps included', async () => {
    const days = await adapter().fetchRange('2026-08-10', '2026-08-17');
    expect(days.length).toBe(8);
    expect(days.at(-1).date).toBe('2026-08-17');
    expect(days.every((d) => d.exerciseKcal === 0)).toBe(true);
  });

  it('sums several sessions on one day and drops false starts', () => {
    const logs = [
      { id: 'a', date: '2026-08-16T09:00:00', duration: 60 },
      { id: 'b', date: '2026-08-16T18:00:00', duration: 45 },
      { id: 'c', date: '2026-08-16T20:00:00', duration: 5 },   // under minSessionMinutes
      { id: 'd', date: '2026-08-16T21:00:00', duration: 30, draft: true }, // unconfirmed
    ];
    expect(minutesByDate(logs, cfg())).toEqual({ '2026-08-16': 105 });
  });

  it('the activity regression matches the documented coefficients', () => {
    expect(ACTIVE_REGRESSION).toEqual({ intercept: 30, perMinute: 4.27, perStep: 0.0308 });
    expect(activeKcal({ minutes: 90 })).toBeCloseTo(30 + 4.27 * 90, 6);
    expect(activeKcal({ minutes: 90, steps: 8000 })).toBeCloseTo(30 + 4.27 * 90 + 0.0308 * 8000, 6);
    expect(activeKcal()).toBe(0); // a day with no activity costs nothing, not the intercept
  });

  it('passes recorded body data through and leaves the rest null', async () => {
    const days = await adapter({ bodyRows: [{ date: '2026-08-17', weightKg: 89.2, restingHr: 53 }] })
      .fetchRange('2026-08-16', '2026-08-17');
    expect(days[0].weightKg).toBeNull();
    expect(days[1]).toMatchObject({ weightKg: 89.2, restingHr: 53 });
    expect(days[1].steps).toBeNull();
  });

  it('is unavailable, and produces no totals, without a usable profile', async () => {
    const bare = createFormulaAdapter({ config: validate({}).normalized, weightKg: null, now: NOW });
    expect(await bare.isAvailable()).toBe(false);
    const [day] = await bare.fetchRange('2026-08-17', '2026-08-17');
    expect(day.totalKcal).toBeNull();
  });
});
