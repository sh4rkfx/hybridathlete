// Story #41: runtime capture of Input / Expected / Actual per scenario test.
// Appended as JSONL (atomic-enough per line, safe across vitest workers);
// scripts/build-report.mjs merges it into test-report.js. Tests call record()
// BEFORE their assertions so Actual is captured even when the test fails.
import { appendFileSync } from 'node:fs';

export const DETAILS_FILE = '.test-details.jsonl';

export function record(id, { input, expected, actual }) {
  appendFileSync(DETAILS_FILE, JSON.stringify({ id, input, expected, actual }) + '\n');
}
