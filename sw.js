// Service worker: cache-first offline shell (spec: offline-first, no backend).
// Bump CACHE_VERSION on every deploy that changes precached files.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `hybridathlete-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-maskable.svg',
  'src/app.js',
  'src/data/db.js',
  'src/data/repositories.js',
  'src/engine/acwr.js',
  'src/engine/catalog.js',
  'src/engine/generator.js',
  'src/engine/load.js',
  'src/engine/planner.js',
  'src/engine/readiness.js',
  'src/engine/swap.js',
  'src/engine/texts.js',
  'src/engine/time.js',
  'src/i18n/de.json',
  'src/rules/catalog.json',
  'src/rules/evaluate.js',
  'src/rules/params.js',
  'src/rules/rules/r1.js',
  'src/rules/rules/r2.js',
  'src/rules/rules/r3.js',
  'src/rules/rules/r4.js',
  'src/rules/rules/r5.js',
  'src/rules/rules/r6.js',
  'src/rules/rules/r7.js',
  'src/rules/rules/r8.js',
  'src/seed/exercises.seed.json',
  'src/seed/sports.seed.json',
  'src/ui/AcwrExplainer.js',
  'src/ui/GarminImport.js',
  'src/ui/garmin.js',
  'src/ui/App.js',
  'src/ui/HomeScreen.js',
  'src/ui/LogFlow.js',
  'src/ui/MorningCheckin.js',
  'src/ui/RulebookScreen.js',
  'src/ui/SessionEditor.js',
  'src/ui/SettingsScreen.js',
  'src/ui/SuggestionInbox.js',
  'src/ui/WeekView.js',
  'src/ui/app.css',
  'src/ui/demo.js',
  'src/ui/fonts.css',
  'src/ui/helpers.js',
  'src/ui/html.js',
  'src/ui/sportsUi.js',
  'src/ui/store.js',
  'src/ui/styles.css',
  'vendor/preact/preact.module.js',
  'vendor/preact/hooks.module.js',
  'vendor/htm/htm.module.js',
  'vendor/idb/index.js',
  'vendor/fit-file-parser/index.js',
  'vendor/jszip/index.js',
  'vendor/fonts/archivo-black-400.woff2',
  'vendor/fonts/barlow-400.woff2',
  'vendor/fonts/barlow-600.woff2',
  'vendor/fonts/barlow-700.woff2',
  'vendor/fonts/barlow-800.woff2',
  'vendor/fonts/jetbrains-mono-400.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit
      || fetch(event.request).then((resp) => {
        // Runtime-cache same-origin responses so updates land in the cache too.
        if (resp.ok && new URL(event.request.url).origin === location.origin) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      })),
  );
});
