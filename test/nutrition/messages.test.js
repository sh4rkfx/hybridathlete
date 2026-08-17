// The kickoff puts user-facing wording in a locale file, not in the domain:
// nutrition modules emit { path, code, params } and nothing else. This test is
// what keeps that honest in both directions — every code the domain can emit
// has German wording, and de.json carries no wording for codes nobody emits.
//
// Note this is deliberately stricter than the rest of the repo, where engine
// output carries German literals (src/engine/texts.js). New layer, new rule.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import de from '../../src/i18n/de.json' with { type: 'json' };
import { FLAG_CODES, SUGGESTED_ACTIONS } from '../../src/nutrition/flags.js';

const NUTRITION = new URL('../../src/nutrition', import.meta.url).pathname;

// Matches the err()/warn() helper call sites: err(<path>, 'CODE', { ... }).
const CALL = /\b(err|warn)\(\s*[^,\n]*,\s*'([A-Z][A-Z0-9_]*)'/g;

function emittedCodes() {
  const found = { err: new Set(), warn: new Set() };
  for (const name of readdirSync(NUTRITION).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(join(NUTRITION, name), 'utf8');
    for (const [, kind, id] of code.matchAll(CALL)) found[kind].add(id);
  }
  return found;
}

describe('locale coverage', () => {
  const found = emittedCodes();

  it('the domain emits codes at all (the scanner still matches)', () => {
    expect(found.err.size).toBeGreaterThan(10);
    expect(found.warn.size).toBeGreaterThan(3);
  });

  it.each([['err', 'errors'], ['warn', 'warnings']])('every %s code has German wording', (kind, bucket) => {
    const missing = [...found[kind]].filter((code) => !de.nutrition[bucket][code]);
    expect(missing).toEqual([]);
  });

  it.each([['err', 'errors'], ['warn', 'warnings']])('de.json has no orphan %s wording', (kind, bucket) => {
    const orphans = Object.keys(de.nutrition[bucket]).filter((code) => !found[kind].has(code));
    expect(orphans).toEqual([]);
  });

  it('every flag code has German wording, and there are no orphans', () => {
    expect(FLAG_CODES.filter((code) => !de.nutrition.flags[code])).toEqual([]);
    expect(Object.keys(de.nutrition.flags).filter((code) => !FLAG_CODES.includes(code))).toEqual([]);
  });

  it('every suggested action has German wording, and there are no orphans', () => {
    expect(SUGGESTED_ACTIONS.filter((action) => !de.nutrition.actions[action])).toEqual([]);
    expect(Object.keys(de.nutrition.actions).filter((action) => !SUGGESTED_ACTIONS.includes(action))).toEqual([]);
  });

  it('no message is empty and none leaks a raw code', () => {
    for (const bucket of ['errors', 'warnings', 'flags', 'actions']) {
      for (const [code, message] of Object.entries(de.nutrition[bucket])) {
        expect(message.trim().length, code).toBeGreaterThan(bucket === 'actions' ? 5 : 10);
        expect(message, code).not.toContain(code);
      }
    }
  });

  it('placeholders are balanced', () => {
    for (const bucket of ['errors', 'warnings', 'flags', 'actions']) {
      for (const [code, message] of Object.entries(de.nutrition[bucket])) {
        expect(message.split('{').length, code).toBe(message.split('}').length);
        for (const [, name] of message.matchAll(/\{([^}]*)\}/g)) {
          expect(name, code).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
        }
      }
    }
  });
});
