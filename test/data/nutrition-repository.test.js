// Energy-module persistence: schema v2, the v1 -> v2 upgrade, and the per-record
// write path (kickoff step 8). Runs on fake-indexeddb, no browser.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, STORE_NAMES, DB_VERSION } from '../../src/data/db.js';
import {
  loadNutritionState, saveNutritionConfig, putDay, putDays, putCalibration,
  putLedgerEntry, putPhase, clearNutrition, nutritionRepositories,
  NUTRITION_STORES, NUTRITION_CONFIG_KEY,
} from '../../src/data/nutritionRepository.js';
import { validate } from '../../src/nutrition/config.js';
import { syntheticDays } from '../helpers/synthetic.js';

let counter = 0;
const freshName = () => `nutrition-test-${++counter}`;
let db;

beforeEach(async () => { db = await openDatabase(freshName()); });

describe('schema v2', () => {
  it('adds the five energy stores with the keypaths the kickoff specifies', async () => {
    for (const name of NUTRITION_STORES) expect([...db.objectStoreNames]).toContain(name);
    const tx = db.transaction(NUTRITION_STORES);
    expect(tx.objectStore('nutritionDays').keyPath).toBe('date');
    expect(tx.objectStore('nutritionConfig').keyPath).toBe('id');
    expect(tx.objectStore('nutritionCalibrations').keyPath).toBe('computedAt');
    expect(tx.objectStore('nutritionLedger').keyPath).toBe('date');
    expect(tx.objectStore('nutritionPhases').keyPath).toBe('startedAt');
  });

  it('is version 2 and every registered store really exists', async () => {
    expect(DB_VERSION).toBe(2);
    for (const name of NUTRITION_STORES) expect(STORE_NAMES).toContain(name);
    // store.resetAll() opens one transaction over every STORE_NAMES entry, so a
    // name that is listed but never created would throw NotFoundError at runtime.
    await expect(Promise.all(STORE_NAMES.map((name) => db.count(name)))).resolves.toHaveLength(16);
  });
});

describe('the v1 -> v2 upgrade', () => {
  it('keeps existing v1 rows readable', async () => {
    const name = freshName();
    const v1 = await openDatabase(name, 1);
    expect([...v1.objectStoreNames]).not.toContain('nutritionDays');
    await v1.put('sessionLogs', { logId: 'l1', date: '2026-08-01T10:00:00', duration: 60, sRPE: 6 });
    await v1.put('profile', { presetId: 'reference_athlete', goal: 'sport_support' }, 'me');
    v1.close(); // mandatory: without it the version change blocks rather than throwing

    const v2 = await openDatabase(name, 2);
    expect(await v2.get('sessionLogs', 'l1')).toMatchObject({ duration: 60, sRPE: 6 });
    expect(await v2.get('profile', 'me')).toMatchObject({ goal: 'sport_support' });
    for (const store of NUTRITION_STORES) expect([...v2.objectStoreNames]).toContain(store);
    v2.close();
  });

  it('still refuses a version it has no migration for', async () => {
    const name = freshName();
    const opened = await openDatabase(name, DB_VERSION);
    opened.close();
    await expect(openDatabase(name, DB_VERSION + 1)).rejects.toThrow(/missing migration/);
  });
});

describe('config', () => {
  it('round-trips through validate and back', async () => {
    const config = validate({ profile: { sex: 'male', heightCm: 173 } }).normalized;
    await saveNutritionConfig(db, config);
    const state = await loadNutritionState(db);
    expect(state.config.id).toBe(NUTRITION_CONFIG_KEY);
    expect(state.config.profile.heightCm).toBe(173);
    expect(validate(state.config).valid).toBe(true);
  });

  it('is a singleton — saving twice replaces rather than accumulates', async () => {
    await saveNutritionConfig(db, validate({ locale: 'de-AT' }).normalized);
    await saveNutritionConfig(db, validate({ locale: 'de-DE' }).normalized);
    expect(await db.count('nutritionConfig')).toBe(1);
    expect((await loadNutritionState(db)).config.locale).toBe('de-DE');
  });

  it('an absent config is a valid state, not an error', async () => {
    const state = await loadNutritionState(db);
    expect(state.config).toBeNull();
    // which is the point: validate({}) is already a complete config
    expect(validate(state.config ?? {}).valid).toBe(true);
  });
});

describe('days', () => {
  it('merges rather than replaces, so two sources can fill one day', async () => {
    await putDay(db, { date: '2026-08-17', weightKg: 89.5 });
    await putDay(db, { date: '2026-08-17', kcal: 2100, proteinG: 155 });
    const [day] = (await loadNutritionState(db)).days;
    expect(day).toMatchObject({ date: '2026-08-17', weightKg: 89.5, kcal: 2100, proteinG: 155 });
    expect(await db.count('nutritionDays')).toBe(1);
  });

  it('a later write still overwrites the fields it does carry', async () => {
    await putDay(db, { date: '2026-08-17', kcal: 2100 });
    await putDay(db, { date: '2026-08-17', kcal: 2250 });
    expect((await loadNutritionState(db)).days[0].kcal).toBe(2250);
  });

  it('writes per record — an unrelated day is untouched', async () => {
    await putDays(db, [{ date: '2026-08-15', kcal: 2000 }, { date: '2026-08-16', kcal: 2100 }]);
    await putDay(db, { date: '2026-08-17', kcal: 2200 });
    expect((await loadNutritionState(db)).days.map((d) => d.date))
      .toEqual(['2026-08-15', '2026-08-16', '2026-08-17']);
  });

  it('returns days sorted by date regardless of write order', async () => {
    await putDays(db, [{ date: '2026-08-17' }, { date: '2026-08-01' }, { date: '2026-08-09' }]);
    expect((await loadNutritionState(db)).days.map((d) => d.date))
      .toEqual(['2026-08-01', '2026-08-09', '2026-08-17']);
  });

  it('takes a synthetic series wholesale', async () => {
    await putDays(db, syntheticDays({ seed: 3, nDays: 30 }));
    const state = await loadNutritionState(db);
    expect(state.days.length).toBe(30);
    expect(state.days[0].date < state.days.at(-1).date).toBe(true);
  });
});

describe('calibrations, ledger and phases', () => {
  it('keeps a calibration history keyed by computedAt', async () => {
    await putCalibration(db, { computedAt: '2026-07-01', factor: 0.95 });
    await putCalibration(db, { computedAt: '2026-06-01', factor: 0.92 });
    const { calibrations } = await loadNutritionState(db);
    expect(calibrations.map((c) => c.factor)).toEqual([0.92, 0.95]);
  });

  it('keeps one ledger row per day and one phase per start', async () => {
    await putLedgerEntry(db, { date: '2026-08-17', bookedKcal: 300 });
    await putLedgerEntry(db, { date: '2026-08-17', bookedKcal: 0 });
    await putPhase(db, { startedAt: '2026-06-01', name: 'Phase 1' });
    const state = await loadNutritionState(db);
    expect(state.ledger).toEqual([{ date: '2026-08-17', bookedKcal: 0 }]);
    expect(state.phases[0].name).toBe('Phase 1');
  });

  it('exposes plain repositories for the five stores', async () => {
    const repos = nutritionRepositories(db);
    expect(Object.keys(repos).sort()).toEqual(['calibrations', 'config', 'days', 'ledger', 'phases']);
    await repos.days.put({ date: '2026-08-17', kcal: 2100 });
    expect(await repos.days.count()).toBe(1);
    expect(await repos.days.get('2026-08-17')).toMatchObject({ kcal: 2100 });
  });

  it('clears only the energy stores', async () => {
    await db.put('sessionLogs', { logId: 'keep-me', date: '2026-08-01T10:00:00' });
    await putDay(db, { date: '2026-08-17', kcal: 2100 });
    await saveNutritionConfig(db, validate({}).normalized);
    await clearNutrition(db);
    const state = await loadNutritionState(db);
    expect(state.days).toEqual([]);
    expect(state.config).toBeNull();
    expect(await db.get('sessionLogs', 'keep-me')).toBeTruthy();
  });
});
