// Builds the _site tree that GitHub Pages publishes.
//
//   /       the test dashboard
//   /app/   the PWA itself
//
// The app goes in a subdirectory on purpose. A service worker's default scope
// is the directory its script is served from, and this one runtime-caches every
// same-origin GET it sees. From /app/sw.js it can only ever see /app/ requests,
// so the dashboard at the root stays outside its scope. Serving the app at the
// root would pull the dashboard into that scope and pin it to whichever version
// happened to be cached on the first visit.
//
// A script rather than shell in the workflow, because the precache check below
// is worth reading and worth running locally before pushing.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = '_site';
const APP = join(OUT, 'app');

// Explicit lists, never copy-everything-minus-exclusions: a new top-level
// directory has to be named here before it can be published by accident. The
// lists are exported so a test can check them against what index.html actually
// asks for — the failure otherwise is a deployed app missing one stylesheet.
export const DASHBOARD_FILES = [
  ['test-dashboard.html', 'index.html'],
  ['test-dashboard.html', 'test-dashboard.html'],
  ['test-report.js', 'test-report.js'],
  ['icons/icon.svg', 'icons/icon.svg'],
];
export const APP_FILES = ['index.html', 'sw.js', 'manifest.webmanifest'];
export const APP_DIRS = ['icons', 'src', 'vendor'];

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`missing input: ${from}`);
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(from, to, { recursive: true });
}

// Every file the worker precaches must exist in the deployed tree. If one is
// missing, cache.addAll() rejects, the worker never installs, and the failure
// is silent — the app simply is not offline, which is the one thing it
// promises. Caught here instead of on a phone.
function verifyPrecache() {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/^ {2}'([^']+)',$/gm)].map(([, path]) => path);
  if (listed.length < 30) throw new Error(`PRECACHE parsed as ${listed.length} entries — the list format changed`);

  const missing = listed.filter((path) => path !== './' && !existsSync(join(APP, path)));
  if (missing.length) throw new Error(`precached but not staged:\n  ${missing.join('\n  ')}`);
  return listed.length;
}

export function stage() {
  rmSync(OUT, { recursive: true, force: true });
  for (const [from, to] of DASHBOARD_FILES) copy(from, join(OUT, to));
  for (const file of APP_FILES) copy(file, join(APP, file));
  for (const dir of APP_DIRS) copy(dir, join(APP, dir));
  return verifyPrecache();
}

// Only when run as a script — importing this module must not touch the disk.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const count = stage();
  console.log(`staged ${OUT}/ (dashboard) and ${APP}/ (app, ${count} precached files)`);
}
