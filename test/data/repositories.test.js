// Repositories: CRUD, transactions, seeding, engine-state assembly, Garmin idempotency.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../../src/data/db.js';
import {
  repositories, seedIfEmpty, loadEngineState, persistSuggestions,
  putSessionLogIdempotent, PROFILE_KEY,
} from '../../src/data/repositories.js';

let dbCounter = 0;
let db;
beforeEach(async () => {
  db = await openDatabase(`repo-test-${++dbCounter}`);
});

describe('seedIfEmpty', () => {
  it('seeds profile preset, sports, exercises and rules on first run', async () => {
    const seeded = await seedIfEmpty(db);
    expect(seeded.sort()).toEqual(['exercises', 'profile', 'rules', 'sports']);

    const profile = await db.get('profile', PROFILE_KEY);
    expect(profile.presetId).toBe('reference_athlete');
    expect(profile.goal).toBe('sport_support');
    expect(profile.split).toBe('PPL');
    expect(profile.disabledUnits).toEqual(['pull']);
    expect(profile.constraints).toHaveLength(1);
    expect(profile.constraints[0]).toMatchObject({ region: 'knee', level: 'yellow' });

    expect(await db.count('sports')).toBe(5);
    expect(await db.count('exercises')).toBe(40);
    expect(await db.count('rules')).toBe(9);
  });

  it('is idempotent and never overwrites user edits', async () => {
    await seedIfEmpty(db);
    const profile = await db.get('profile', PROFILE_KEY);
    profile.goal = 'hypertrophie';
    await db.put('profile', profile, PROFILE_KEY);

    const seededAgain = await seedIfEmpty(db);
    expect(seededAgain).toEqual([]);
    expect((await db.get('profile', PROFILE_KEY)).goal).toBe('hypertrophie');
    expect(await db.count('exercises')).toBe(40);
  });

  it('every seeded rule carries source and evidenceLevel (AC4 groundwork)', async () => {
    await seedIfEmpty(db);
    for (const rule of await db.getAll('rules')) {
      expect(rule.source, rule.ruleId).toBeTruthy();
      expect(rule.source.citation, rule.ruleId).toBeTruthy();
      expect(rule.evidenceLevel, rule.ruleId).toBeTruthy();
    }
  });
});

describe('repositories CRUD', () => {
  it('put/get/getAll/delete round-trips per store', async () => {
    const repos = repositories(db);
    await repos.plannedSessions.put({ sessionId: 's1', sportId: 'running', date: '2026-07-21', slot: 'morning', fixed: false, status: 'planned' });
    expect((await repos.plannedSessions.get('s1')).sportId).toBe('running');
    expect(await repos.plannedSessions.getAll()).toHaveLength(1);
    await repos.plannedSessions.delete('s1');
    expect(await repos.plannedSessions.count()).toBe(0);
  });

  it('multi-store transaction commits atomically', async () => {
    const tx = db.transaction(['sessionLogs', 'fatigueEntries'], 'readwrite');
    await tx.objectStore('sessionLogs').put({ logId: 'l1', sportId: 'bouldering', date: '2026-07-19', duration: 90, sRPE: 7 });
    await tx.objectStore('fatigueEntries').put({ entryId: 'f1', region: 'fingers', level: 'caution', ts: '2026-07-19T21:00:00Z' });
    await tx.done;
    expect(await db.count('sessionLogs')).toBe(1);
    expect(await db.count('fatigueEntries')).toBe(1);
  });
});

describe('putSessionLogIdempotent (AC9)', () => {
  it('rejects a duplicate garminActivityId as duplicate, keeps first log', async () => {
    const a = await putSessionLogIdempotent(db, { logId: 'l1', garminActivityId: 'g-123', sportId: 'running', duration: 40, sRPE: 5 });
    const b = await putSessionLogIdempotent(db, { logId: 'l2', garminActivityId: 'g-123', sportId: 'running', duration: 40, sRPE: 5 });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.log.logId).toBe('l1');
    expect(await db.count('sessionLogs')).toBe(1);
  });

  it('manual logs without garminActivityId are never deduped against each other', async () => {
    await putSessionLogIdempotent(db, { logId: 'l1', sportId: 'running', duration: 40, sRPE: 5 });
    const b = await putSessionLogIdempotent(db, { logId: 'l2', sportId: 'running', duration: 40, sRPE: 5 });
    expect(b.duplicate).toBe(false);
    expect(await db.count('sessionLogs')).toBe(2);
  });
});

describe('loadEngineState / persistSuggestions', () => {
  it('assembles the engine state and derives rejected + ruleStats from history', async () => {
    await seedIfEmpty(db);
    await db.put('suggestions', { suggestionId: 'sg1', id: 'sg1', key: 'R4|s1', ruleId: 'R4', status: 'rejected', feedback: { reasonCode: 'fit' } });
    await db.put('suggestions', { suggestionId: 'sg2', id: 'sg2', key: 'R7|s2', ruleId: 'R7', status: 'accepted' });
    await db.put('suggestions', { suggestionId: 'sg3', id: 'sg3', key: 'R3|s3', ruleId: 'R3', status: 'open' });

    const state = await loadEngineState(db);
    expect(state.profile.presetId).toBe('reference_athlete');
    expect(state.rejected).toEqual({ 'R4|s1': 'fit' });
    expect(state.ruleStats.R4).toEqual({ up: 0, down: 1 });
    expect(state.ruleStats.R7).toEqual({ up: 1, down: 0 });
    expect(state.exercises).toHaveLength(40);
  });

  it('replaces open suggestions but keeps answered history', async () => {
    await db.put('suggestions', { suggestionId: 'old-open', id: 'old-open', key: 'R5|x', ruleId: 'R5', status: 'open' });
    await db.put('suggestions', { suggestionId: 'old-rej', id: 'old-rej', key: 'R4|y', ruleId: 'R4', status: 'rejected' });

    await persistSuggestions(db, [{ id: 'new1', key: 'R3|z', ruleId: 'R3' }]);

    const all = await db.getAll('suggestions');
    const ids = all.map((s) => s.suggestionId).sort();
    expect(ids).toEqual(['new1', 'old-rej']);
    expect(all.find((s) => s.suggestionId === 'new1').status).toBe('open');
  });
});
