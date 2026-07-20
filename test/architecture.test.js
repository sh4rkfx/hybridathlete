// The hard architecture line (kickoff): engine/, data/, rules/ are pure vanilla —
// they must never import Preact/HTM or touch the DOM. This test enforces it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;
const PURE_DIRS = ['engine', 'data', 'rules'];

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js'))
    .map((d) => join(d.parentPath ?? d.path, d.name));
}

describe('architecture line', () => {
  for (const dir of PURE_DIRS) {
    it(`src/${dir} imports no UI layer and touches no DOM`, () => {
      for (const file of jsFiles(join(ROOT, dir))) {
        const code = readFileSync(file, 'utf8');
        expect(code, file).not.toMatch(/from\s+['"][^'"]*(preact|htm)[^'"]*['"]/);
        expect(code, file).not.toMatch(/from\s+['"][^'"]*\/ui\//);
        expect(code, file).not.toMatch(/\b(document|window)\.\w/);
      }
    });
  }

  it('src/engine and src/rules never import the data layer (engine is DB-free)', () => {
    for (const dir of ['engine', 'rules']) {
      for (const file of jsFiles(join(ROOT, dir))) {
        const code = readFileSync(file, 'utf8');
        expect(code, file).not.toMatch(/from\s+['"][^'"]*\/data\//);
        expect(code, file).not.toMatch(/indexedDB|idb/i);
      }
    }
  });
});
