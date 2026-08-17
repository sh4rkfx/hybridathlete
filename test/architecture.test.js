// The hard architecture line (kickoff): engine/, data/, rules/, nutrition/ are
// pure vanilla — they must never import Preact/HTM or touch the DOM. This test
// enforces it. src/nutrition is the energy module's domain layer (ADR 0005);
// it is DB-free like engine/rules and additionally must not reach into
// src/adapters, which is where its IO lives.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;
const PURE_DIRS = ['engine', 'data', 'rules', 'nutrition'];

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

  it('src/engine, src/rules and src/nutrition never import the data layer', () => {
    for (const dir of ['engine', 'rules', 'nutrition']) {
      for (const file of jsFiles(join(ROOT, dir))) {
        const code = readFileSync(file, 'utf8');
        expect(code, file).not.toMatch(/from\s+['"][^'"]*\/data\//);
        expect(code, file).not.toMatch(/indexedDB|idb/i);
      }
    }
  });

  it('src/nutrition imports no adapters and only time.js from src/engine', () => {
    for (const file of jsFiles(join(ROOT, 'nutrition'))) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/from\s+['"][^'"]*\/adapters\//);
      for (const [, spec] of code.matchAll(/from\s+['"](\.[^'"]*)['"]/g)) {
        expect(spec, file).toMatch(/^\.\/|^\.\.\/engine\/time\.js$/);
      }
    }
  });
});
