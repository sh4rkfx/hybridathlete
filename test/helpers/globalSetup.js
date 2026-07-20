// Truncate the per-run detail capture before any worker starts (story #41).
import { rmSync } from 'node:fs';

export default function setup() {
  rmSync('.test-details.jsonl', { force: true });
}
