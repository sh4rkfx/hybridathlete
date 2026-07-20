// IndexedDB setup for HybridAthlete. Pure vanilla module — no UI imports.
// Object stores follow spec §2.1; region taxonomy §2.2 is shared by seeds and engine.
import { openDB } from '../../vendor/idb/index.js';

export const DB_NAME = 'hybridathlete';
export const DB_VERSION = 1;

// One migration per schema version. Index = target version - 1.
// Each migration receives (db, transaction) from idb's upgrade callback.
const MIGRATIONS = [
  // v1 — initial schema
  (db) => {
    db.createObjectStore('profile'); // singleton, key 'me'
    db.createObjectStore('sports', { keyPath: 'sportId' });
    db.createObjectStore('exercises', { keyPath: 'exerciseId' });

    const planned = db.createObjectStore('plannedSessions', { keyPath: 'sessionId' });
    planned.createIndex('byDate', 'date');

    const logs = db.createObjectStore('sessionLogs', { keyPath: 'logId' });
    logs.createIndex('byDate', 'date');
    // Garmin import idempotency (AC9). Not unique at the index level: manual
    // logs have no garminActivityId and IndexedDB unique indexes reject
    // duplicate `undefined` in some implementations — dedupe lives in the repo.
    logs.createIndex('byGarminActivityId', 'garminActivityId');

    db.createObjectStore('setLogs', { keyPath: 'setId' });

    const fatigue = db.createObjectStore('fatigueEntries', { keyPath: 'entryId' });
    fatigue.createIndex('byTimestamp', 'ts');

    const pain = db.createObjectStore('painEntries', { keyPath: 'painId' });
    pain.createIndex('byTimestamp', 'ts');

    db.createObjectStore('suggestions', { keyPath: 'suggestionId' });
    db.createObjectStore('rules', { keyPath: 'ruleId' });
    db.createObjectStore('importBatches', { keyPath: 'batchId' });
  },
];

export const STORE_NAMES = [
  'profile', 'sports', 'exercises', 'plannedSessions', 'sessionLogs', 'setLogs',
  'fatigueEntries', 'painEntries', 'suggestions', 'rules', 'importBatches',
];

export function openDatabase(name = DB_NAME, version = DB_VERSION) {
  // Guard before opening: throwing inside idb's upgrade callback would abort the
  // version-change transaction with an opaque AbortError.
  if (version > MIGRATIONS.length) {
    return Promise.reject(new Error(`missing migration for schema v${version}`));
  }
  return openDB(name, version, {
    upgrade(db, oldVersion, newVersion, tx) {
      for (let v = oldVersion; v < newVersion; v++) {
        MIGRATIONS[v](db, tx);
      }
    },
  });
}
