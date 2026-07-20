// UI state container: holds the in-memory engine state, runs the pure engine
// after every mutation, and writes through to IndexedDB. The engine itself
// never sees this module (architecture line) — the store is the caller that
// loads state and persists results.
import { openDatabase } from '../data/db.js';
import { seedIfEmpty, loadEngineState, persistSuggestions, PROFILE_KEY } from '../data/repositories.js';
import { evaluate } from '../rules/evaluate.js';
import { uid } from '../engine/planner.js';

let db = null;
let state = null;
const listeners = new Set();

export function getState() { return state; }
export const now = () => new Date();

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { listeners.forEach((fn) => fn(state)); }

export async function boot() {
  db = await openDatabase();
  await seedIfEmpty(db);
  state = await loadEngineState(db);
  state.suggestions = state.suggestions.filter((s) => s.status === 'open');
  recompute();
  notify();
  return state;
}

export function recompute() {
  state.suggestions = evaluate(state, now());
}

// Run a mutation, re-evaluate, persist, notify. All UI actions go through here.
export function update(mutator, { reevaluate = true } = {}) {
  mutator(state);
  if (reevaluate) recompute();
  sync();
  notify();
}

// Write-through: V1 data volumes are tiny, so collections are rewritten
// wholesale — simple and impossible to get out of sync.
async function sync() {
  if (!db) return;
  try {
    const tx = db.transaction(['profile', 'plannedSessions', 'sessionLogs', 'fatigueEntries', 'painEntries'], 'readwrite');
    await tx.objectStore('profile').put(structuredClone(state.profile), PROFILE_KEY);
    const writeAll = async (storeName, rows, key) => {
      const s = tx.objectStore(storeName);
      await s.clear();
      for (const r of rows) await s.put(structuredClone({ ...r, [key]: r[key] ?? r.id }));
    };
    await writeAll('plannedSessions', state.planned, 'sessionId');
    await writeAll('sessionLogs', state.logs, 'logId');
    await writeAll('fatigueEntries', state.fatigue, 'entryId');
    await writeAll('painEntries', state.pain, 'painId');
    await tx.done;
    await persistSuggestions(db, state.suggestions);
  } catch (e) {
    console.error('persist failed', e);
  }
}

// Record an answered suggestion in history (feeds rejected + ruleStats on reload).
export async function persistAnswered(sug, status, reasonCode) {
  if (!db) return;
  await db.put('suggestions', {
    ...structuredClone(sug), suggestionId: sug.id, status,
    feedback: reasonCode ? { thumb: 'down', reasonCode } : { thumb: 'up' },
  });
}

export function acceptSuggestion(key) {
  const s = state.suggestions.find((x) => x.key === key);
  if (!s) return null;
  persistAnswered(s, 'accepted');
  update((st) => {
    const target = st.planned.find((p) => p.id === s.targetId);
    if (target) Object.assign(target, s.proposed);
    (st.ruleStats[s.ruleId] ??= { up: 0, down: 0 }).up++;
  });
  return s;
}

export function rejectSuggestion(key, reason) {
  const s = state.suggestions.find((x) => x.key === key);
  if (!s) return null;
  persistAnswered(s, 'rejected', reason);
  update((st) => {
    (st.ruleStats[s.ruleId] ??= { up: 0, down: 0 }).down++;
    st.rejected[key] = reason;
  });
  return s;
}

export async function resetAll() {
  const { STORE_NAMES } = await import('../data/db.js');
  const tx = db.transaction(STORE_NAMES, 'readwrite');
  for (const s of STORE_NAMES) await tx.objectStore(s).clear();
  await tx.done;
  await seedIfEmpty(db);
  state = await loadEngineState(db);
  state.suggestions = [];
  recompute();
  await sync();
  notify();
}

export { uid };
