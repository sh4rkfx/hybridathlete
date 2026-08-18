// Pure derivations behind the energy screen (kickoff step 9). The repo has no
// DOM shim and never renders a component, so everything the screen decides
// lives here and is tested here.
import { describe, it, expect } from 'vitest';
import {
  prefillEntry, entryToDay, parseNumber, currentBody, assembleDays, deriveEnergy,
  nutritionConfig, setupGaps, isReady, reconcileToday, ENTRY_FIELDS,
  targetBreakdown, breakdownSum, todayProgress, calibrationProgress, weightChartData,
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

describe('the target breakdown adds up', () => {
  // The bug this exists to prevent: the screen listed the requested ledger
  // correction, so restTdee - deficit + correction came to 1588 while the
  // target read 1795. A breakdown that does not sum destroys trust in every
  // other number on a screen made of numbers.
  const base = {
    target: {
      restTdeeKcal: 2373, baseIntakeKcal: 1838, deficitKcal: 535,
      ledgerCorrectionKcal: -250, appliedLedgerCorrectionKcal: -43, targetIntakeKcal: 1795,
    },
    compensation: { kcal: 0 },
    plannedIntakeKcal: 1795,
  };

  it('sums to the target when the floor clipped the correction', () => {
    const rows = targetBreakdown(base);
    expect(breakdownSum(rows)).toBeCloseTo(1795, 10);
    expect(rows.map((r) => r.key)).toEqual(['restTdee', 'deficit', 'ledger']);
    expect(rows.find((r) => r.key === 'ledger')).toMatchObject({ kcal: -43, clipped: true });
  });

  it('does not claim a clip when the correction went through in full', () => {
    const rows = targetBreakdown({
      ...base,
      target: { ...base.target, appliedLedgerCorrectionKcal: -250, targetIntakeKcal: 1588 },
      plannedIntakeKcal: 1588,
    });
    expect(rows.find((r) => r.key === 'ledger').clipped).toBe(false);
    expect(breakdownSum(rows)).toBeCloseTo(1588, 10);
  });

  it('includes compensation and still sums', () => {
    const rows = targetBreakdown({ ...base, compensation: { kcal: 550 }, plannedIntakeKcal: 2345 });
    expect(rows.map((r) => r.key)).toContain('compensation');
    expect(breakdownSum(rows)).toBeCloseTo(2345, 10);
  });

  it('omits rows that are zero rather than printing "- 0 kcal"', () => {
    const rows = targetBreakdown({
      target: { restTdeeKcal: 2400, baseIntakeKcal: 2400, deficitKcal: 0, ledgerCorrectionKcal: 0, appliedLedgerCorrectionKcal: 0, targetIntakeKcal: 2400 },
      compensation: { kcal: 0 }, plannedIntakeKcal: 2400,
    });
    expect(rows.map((r) => r.key)).toEqual(['restTdee']);
  });

  it('is empty without a target', () => {
    expect(targetBreakdown({ target: { baseIntakeKcal: null } })).toEqual([]);
    expect(targetBreakdown({})).toEqual([]);
  });

  it('sums for the demo data, end to end', async () => {
    const nutrition = { days: [], config: null, calibrations: [], ledger: [], phases: [] };
    loadDemoEnergy(nutrition, NOW);
    const state = { logs: [], nutrition };
    const days = await assembleDays(state, nutritionConfig(state), { now: NOW });
    const derived = deriveEnergy(state, { now: NOW, days });
    expect(breakdownSum(targetBreakdown(derived))).toBeCloseTo(derived.plannedIntakeKcal, 6);
  });
});

describe('todayProgress', () => {
  const derived = (over = {}) => ({
    plannedIntakeKcal: 2000,
    macros: { proteinG: 150 },
    today: { intakeKcal: 1800, proteinG: 120 },
    ...over,
  });

  it('answers the question the app is opened for', () => {
    expect(todayProgress(derived())).toMatchObject({
      targetKcal: 2000, consumedKcal: 1800, remainingKcal: 200, over: false, logged: true,
    });
  });

  it('reports an overshoot as negative remaining, and says so', () => {
    const p = todayProgress(derived({ today: { intakeKcal: 2150 } }));
    expect(p.remainingKcal).toBe(-150);
    expect(p.over).toBe(true);
  });

  it('tracks protein against its own target', () => {
    expect(todayProgress(derived()).proteinRatio).toBeCloseTo(0.8, 10);
  });

  it('is honest about a day with nothing logged', () => {
    const p = todayProgress(derived({ today: {} }));
    expect(p).toMatchObject({ consumedKcal: null, remainingKcal: null, logged: false, over: false });
  });

  it('does not divide by a missing target', () => {
    expect(todayProgress(derived({ plannedIntakeKcal: null, macros: null })).kcalRatio).toBeNull();
  });
});

describe('calibrationProgress', () => {
  const day = (offset, extra = {}) => {
    const d = new Date(`${TODAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    return { date: d.toISOString().slice(0, 10), intakeKcal: 2000, ...extra };
  };
  const config = validate({}).normalized;

  it('counts down to the first possible measurement', () => {
    const p = calibrationProgress([day(2), day(1), day(0)], config, NOW);
    expect(p).toMatchObject({ tracked: 3, needed: 14, remaining: 11, loggedToday: true });
    expect(p.ratio).toBeCloseTo(3 / 14, 10);
  });

  it('counts a streak and does not break it on a day still in progress', () => {
    // nothing logged today yet, but yesterday and before — the streak stands
    expect(calibrationProgress([day(3), day(2), day(1)], config, NOW).streak).toBe(3);
    expect(calibrationProgress([day(3), day(2), day(1)], config, NOW).loggedToday).toBe(false);
  });

  it('breaks the streak on a real gap', () => {
    expect(calibrationProgress([day(5), day(4), day(1)], config, NOW).streak).toBe(1);
  });

  it('ignores days without intake — an empty row is not a logged day', () => {
    expect(calibrationProgress([day(1, { intakeKcal: null }), day(0)], config, NOW).tracked).toBe(1);
  });

  it('saturates once the minimum is reached', () => {
    const many = Array.from({ length: 30 }, (_, i) => day(i));
    expect(calibrationProgress(many, config, NOW)).toMatchObject({ remaining: 0, ratio: 1 });
  });

  it('handles no data', () => {
    expect(calibrationProgress([], config, NOW)).toMatchObject({ tracked: 0, streak: 0, ratio: 0 });
  });
});

describe('weightChartData', () => {
  const config = validate({}).normalized;
  const series = Array.from({ length: 21 }, (_, i) => {
    const d = new Date('2026-07-01T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), weightKg: 89.5 - 0.0649 * i };
  });

  it('projects points and the regression into the viewBox', () => {
    const c = weightChartData(series, config, { width: 320, height: 90, pad: 6 });
    expect(c.points.length).toBe(21);
    for (const p of c.points) {
      expect(p.x).toBeGreaterThanOrEqual(6);
      expect(p.x).toBeLessThanOrEqual(314);
      expect(p.y).toBeGreaterThanOrEqual(6);
      expect(p.y).toBeLessThanOrEqual(84);
    }
    expect(c.fit).toBeTruthy();
    expect(c.slopeKgPerWeek).toBeCloseTo(-0.0649 * 7, 6);
  });

  it('puts a falling series on a downward line — y grows downward in SVG', () => {
    const c = weightChartData(series, config);
    expect(c.fit.y2).toBeGreaterThan(c.fit.y1);
    expect(c.points.at(-1).y).toBeGreaterThan(c.points[0].y);
  });

  it('marks the points the outlier rejection dropped', () => {
    const spiked = series.map((d, i) => (i === 10 ? { ...d, weightKg: d.weightKg + 3 } : d));
    const c = weightChartData(spiked, config);
    expect(c.points.filter((p) => p.excluded).map((p) => p.date)).toEqual(['2026-07-11']);
  });

  it('places the goal line only when it falls inside the plotted range', () => {
    expect(weightChartData(series, config, { goalKg: 88.5 }).goalY).not.toBeNull();
    expect(weightChartData(series, config, { goalKg: 70 }).goalY).toBeNull();
    expect(weightChartData(series, config, { goalKg: null }).goalY).toBeNull();
  });

  it('marks a window too short to carry a slope as provisional', () => {
    // Same honesty rule as the calibration, which returns null below minDays:
    // a regression over three days is noise, and drawing it in the accent
    // colour would assert something the data cannot support.
    expect(weightChartData(series.slice(0, 4), config).provisional).toBe(true);
    expect(weightChartData(series, config).provisional).toBe(false);
  });

  it('needs two points to draw anything', () => {
    expect(weightChartData(series.slice(0, 1), config)).toBeNull();
    expect(weightChartData([], config)).toBeNull();
  });

  it('survives a flat series without dividing by zero', () => {
    const flat = series.map((d) => ({ ...d, weightKg: 88 }));
    const c = weightChartData(flat, config);
    expect(c.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
