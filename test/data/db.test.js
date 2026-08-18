// Data layer: schema + migration scaffold (runs on fake-indexeddb, no browser).
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDatabase, STORE_NAMES, DB_VERSION } from '../../src/data/db.js';

let dbCounter = 0;
const freshName = () => `test-db-${++dbCounter}`;

describe('db schema', () => {
  it('creates all 16 object stores (spec §2.1 plus the energy module) on first open', async () => {
    const db = await openDatabase(freshName());
    expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    expect(db.objectStoreNames.length).toBe(16);
    db.close();
  });

  it('creates the indexes needed by queries and Garmin idempotency', async () => {
    const db = await openDatabase(freshName());
    const tx = db.transaction(['sessionLogs', 'plannedSessions', 'fatigueEntries', 'painEntries']);
    expect([...tx.objectStore('sessionLogs').indexNames].sort()).toEqual(['byDate', 'byGarminActivityId']);
    expect([...tx.objectStore('plannedSessions').indexNames]).toContain('byDate');
    expect([...tx.objectStore('fatigueEntries').indexNames]).toContain('byTimestamp');
    expect([...tx.objectStore('painEntries').indexNames]).toContain('byTimestamp');
    db.close();
  });

  it('runs migrations sequentially and fails loudly when one is missing', async () => {
    const name = freshName();
    const db = await openDatabase(name, DB_VERSION);
    db.close();
    // A future schema version without a registered migration must not silently
    // produce a half-migrated database.
    await expect(openDatabase(name, DB_VERSION + 1)).rejects.toThrow(/missing migration/);
  });
});
