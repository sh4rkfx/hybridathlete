# Claude-Code-Kickoff-Prompt: HybridAthlete — Adaptiver Trainingsplaner (PWA)

> Diesen Prompt in Claude Code einfügen. Beiliegend und verbindlich: `Spezifikation_Adaptiver_Trainingsplaner.md` (**v2.0**), `exercises.seed.json`, `sports.seed.json`, `rules.catalog.json` sowie als **Verhaltens-Referenz** der funktionale Prototyp `HybridAthlete_Funktionaler_Prototyp.html` und das Test-Dashboard `HybridAthlete_Test_Dashboard.html` (17 normative Szenario-Tests). Spezifikation nach `docs/`, Seeds nach `src/seed/`, Prototyp + Dashboard nach `docs/prototype/`. Bei Widerspruch gilt die Spezifikation v2.0; bei Detailfragen zum Verhalten (Coach-Texte, Interaktionen, Grenzwerte) ist der Prototyp die Referenz-Implementierung. Repo-Name: `hybridathlete`. Code, Kommentare, Commits und Doku sind **Englisch**; die App-UI ist **Deutsch**.

---

## Auftrag

Baue eine **offline-fähige PWA**, die eine vom Nutzer angelegte Trainingswoche überwacht und bei geloggter Belastung, Ermüdung oder Schmerz **evidenzbasierte Umplanungsvorschläge** macht — ohne fixe Einheiten anzutasten. Zusätzlich ein Krafttrainings-Plan-Generator, der mit den übrigen Belastungsachsen (Bouldern, Laufen, Berg) verträglich ist.

Erster und einziger Nutzer in V1: Referenz-Athlet (Multi-Sport). Datenmodell generisch, aber V1 liefert nur dieses Preset.

**Wissenschaftlicher Anspruch ist nicht verhandelbar:** Jede aktive Planungsregel trägt `source` + `evidenceLevel`. Keine erfundenen Heuristiken. Wo Evidenz dünn ist, wird sie als `assumption`/`expert-consensus` gekennzeichnet, nicht versteckt. Der Regelkatalog mit Quellen steht fertig in §4 der Spezifikation — übernimm ihn, erfinde nichts dazu.

---

## Tech-Stack (fixiert — nicht neu verhandeln)

| Aspekt | Entscheidung |
|--------|--------------|
| Architektur | PWA, offline-first, Single-Repo, **kein Backend** |
| Sprache | Vanilla JS (ES-Module), **buildless** (kein Bundler-Zwang) |
| UI-Schicht | **Preact + HTM** via ESM (vendored/CDN-Pin), nur für Darstellung |
| Storage | **IndexedDB via `idb`** (Promise-Wrapper, Multi-Store-Transaktionen) |
| Regel-Engine | **Pure Functions**, eigenes Modul, **kein DOM-Zugriff**, unit-getestet |
| Regeln | Deklarativ als JSON mit `source`+`evidenceLevel`, nicht hartcodiert |
| FIT-Parsing | Client-seitig (`fit-file-parser` o. Ä., reine JS-Lib) |
| Tests | `node:test` oder Vitest — Engine ohne Browser testbar |
| Export | JSON (Backup) |
| **Sprache Code/Kommentare/Commits/Doku** | **Englisch** |
| Sprache App-UI | **Deutsch** (i18n-fähig strukturiert); Übungsnamen Englisch |
| Versionierung | **Git + GitHub**, Conventional Commits, Feature-Branches → PR → `main` |
| CI | **GitHub Actions**: Testsuite bei jedem Push/PR, Test-Report als Artefakt |
| Zielplattform | Android; Push optional, Fallback = In-App-Badge |

**Architektur-Trennlinie (hart):** `engine/`, `data/`, `rules/` sind reines Vanilla und dürfen Preact/HTM **nicht** importieren. Preact lebt ausschließlich in `ui/`. Diese Trennung macht die Engine testbar und die Wissenschaftsprüfung möglich — sie ist die wichtigste strukturelle Vorgabe.

---

## Repo-Struktur (Vorschlag)

```
/
├── README.md                  # Englisch; Setup, Architektur, Wissenschaftsbasis, Screenshots
├── LICENSE
├── CHANGELOG.md               # Keep a Changelog Format
├── .gitignore
├── .github/
│   └── workflows/test.yml     # CI: Testsuite + Report bei Push/PR
├── docs/
│   ├── Spezifikation_Adaptiver_Trainingsplaner.md
│   ├── Claude_Code_Kickoff_Prompt.md
│   └── decisions/             # kurze ADRs (Preact-Wahl, ACWR-systemisch, etc.)
├── index.html
├── manifest.webmanifest
├── sw.js                      # Service Worker (offline-Cache)
├── test-dashboard.html        # HTML-Dashboard, liest test-report.js (siehe unten)
├── vendor/                    # gepinnte ESM-Kopien: preact, htm, idb, fit-parser
├── src/
│   ├── app.js                 # Bootstrap, Routing
│   ├── data/
│   │   ├── db.js              # idb-Setup, Stores, Migrationen
│   │   └── repositories.js    # CRUD pro Store, Transaktionen
│   ├── engine/
│   │   ├── load.js           # sRPE-TL + regionale Decomposition (§3.1)
│   │   ├── acwr.js           # systemische ACWR (§R7)
│   │   ├── planner.js        # Umplanungs-Orchestrierung (Prioritätshierarchie §3.2)
│   │   └── generator.js      # Kraftplan-Generator (§5)
│   ├── rules/
│   │   ├── catalog.json      # R1–R8 deklarativ mit Quellen
│   │   ├── evaluate.js       # pure: (state) -> suggestions[]
│   │   └── rules/            # eine Datei je Regel (pure predicate + action)
│   ├── ui/                    # Preact + HTM: Screens & Komponenten
│   │   ├── HomeScreen.js
│   │   ├── LogFlow.js
│   │   ├── MorningCheckin.js
│   │   ├── SuggestionInbox.js
│   │   ├── WeekView.js
│   │   ├── RulebookScreen.js
│   │   └── GarminImport.js
│   ├── i18n/de.json
│   └── seed/
│       ├── exercises.seed.json   # aus Repo-Root übernehmen
│       └── sports.seed.json      # Belastungsprofile (Bouldern, Berg, Lauf, Kraft)
└── test/
    ├── engine/               # Szenario-Tests (siehe unten)
    ├── rules/
    ├── data/                 # Repository-/Migrations-Tests
    └── report.js             # schreibt test-report.js (window.__TEST_REPORT__ = {...})
```

---

## Datenmodell

Vollständig in Spezifikation §2. Object Stores: `profile`, `sports`, `exercises`, `plannedSessions`, `sessionLogs`, `setLogs`, `fatigueEntries`, `painEntries`, `suggestions`, `rules`, `importBatches`.

Kanonische Regionen-IDs (§2.2) sind die **eine** gemeinsame Referenz für Belastungsprofile, Ermüdungs-Ampel und Schmerz. `knee` = Gelenk-/Schmerz-/Constraint-Region, nimmt **keine** Muskel-Load auf.

Seed beim Erststart: `profile` (Preset `reference_athlete`, goal `sport_support`, split `PPL`, `disabledUnits: ["pull"]`, Knie-Constraint 🟡 `avoid_loaded_flexion_80_90`), `exercises` aus `exercises.seed.json`, `sports` aus `sports.seed.json`, `rules` aus `rules/catalog.json`.

---

## Load-Modell (§3.1)

- **Global (validiert):** `sRPE-TL = sRPE × duration_min` (Foster 2001). Speist ACWR + systemische Ermüdung.
- **Regional (assumption, so kennzeichnen):** `regionLoad[r] = loadProfile[r] × (sRPE/10) × (duration/60)`.
- Flag `eccentric` → verlängert Erholungsfenster betroffener Regionen (R4).
- Flag `tendonHeavy` + `hardFingerLoad` → verlängert `fingers`-Erholung (R3).

---

## Regel-Engine

`rules/evaluate.js` ist eine **pure function**: `(state) => Suggestion[]`. `state` = { profile, plannedSessions (Restwoche + 48 h), sessionLogs, fatigueEntries, painEntries, abgeleitete Loads/ACWR }. Keine DB-, keine DOM-Zugriffe in der Engine — der Aufrufer lädt den State und persistiert die Vorschläge.

Prioritätshierarchie (§3.2), absteigend, niedrigere überstimmt höhere nie:
**R1 Schmerz → R2 Constraints → Fixpunkte (unantastbar) → R3/R4/R5 Ermüdung/Erholung → R6 Interferenz → R7 ACWR.**

Regelkatalog R1–R8 inkl. Parametern, Quellen und Evidenzgraden **wörtlich aus Spezifikation §4** in `rules/catalog.json` übertragen. Jede Regel als eigenes Modul mit reinem Prädikat (`triggers(state) -> bool`) und Aktion (`propose(state) -> Suggestion`).

Vorschlagstypen (**4**): `swap` | `reduce` | `move` | `remove` (Spez §3.4). **`swap` = Übungsebene:** `swapProposal(session, regions, profile)` tauscht Übungen mit Load ≥ 2 auf den Trigger-Regionen; Ersatzsuche erst gleiche Kategorie, dann Unit-Kategorien, Kandidaten laden die Region < 2 und erfüllen alle Constraints; **Aushöhl-Schutz** `drop > keep` → Fallback `move`/`reduce`. R1, R4 und R5 versuchen bei Kraft-Einheiten **zuerst** `swap` — auch auf fixen Einheiten (Fix schützt Timing, nicht Inhalt). Minimaler Eingriff als Dedupe-Rang: `swap` 0 < `reduce` 1 < `move` 2 < `remove` 3. Guards: `reduced`/`adjusted` verhindern Wiederholung; `rejected[ruleId|targetId]` unterdrückt dauerhaft; `logged`/`skipped` verlassen `futurePlanned()` (keine Doppelzählung in der ACWR-Projektion).

**Zweite pure Kernfunktion:** `exerciseReadiness(exerciseId, when, state) -> {level: fresh|caution|stop, reasons[]}` (Spez §3.6) — datumsabhängige Machbarkeit je Übung aus R2/R1/R5/R4-Signalen, mit **allen** Gründen. Verbraucher: Session-Editor, Log-Übungsschritt, Generator, Vorschau.

**Generator:** `generateStrength(profile, state?, when?)` — mit `state`+`when` readiness-aware (stop raus, fresh vor caution), ohne identisch zu v1 (Spez §5.5). Constraints generisch für alle Regionen (gelb: Load ≥ 3 raus; rot: ≥ 2; Knie zusätzlich Beugetiefe).

---

## Test-Strategie

Drei Ebenen. Die Engine ist ohne Browser testbar (pure functions) — das ist der Kern.

**Ebene 1 — Unit (data/):** `db.js`-Migrationen, `repositories.js`-CRUD und Transaktionen. Fake-IndexedDB im Test (z. B. `fake-indexeddb`), damit ohne Browser lauffähig.

**Ebene 2 — Unit (engine/, rules/):** `load.js` (sRPE-TL + Decomposition), `acwr.js` (Zonen-Grenzen exakt: 0,79/0,80/1,30/1,31/1,50/1,51), `generator.js` (Split-Aufbau, generische Constraints, readiness-aware Auswahl, Volumen je Ziel), `readiness.js` (`exerciseReadiness`: alle 5 Signal-Klassen + Datumsabhängigkeit), `swap.js` (`swapProposal`: Treffer-Logik, Ersatzsuche, Aushöhl-Schutz, Constraint-Konformität), jede Einzelregel `triggers`/`propose`.

**Ebene 3 — Szenario (engine/):** die Integrationstests T01–T17 unten. Sie fahren die volle Engine `evaluate(state)` gegen realistische Wochen-States und prüfen Vorschlag **und** auslösende Regel. Dies ist das Wissenschafts-Gate.

**Coverage-Ziel:** `engine/` + `rules/` ≥ 90 % (harte Kernlogik), Gesamt ≥ 75 %. Coverage-Zahl fließt in den Test-Report.

**Report-Ausgabe:** Der Test-Runner schreibt `test-report.js` mit `window.__TEST_REPORT__ = { generatedAt, totals, coverage, suites:[{name, tests:[{id, title, status, anchor, evidenceLevel, durationMs}]}] }`. Für die Szenario-Tests trägt jeder Test seinen Literatur-Anker (Spalte „Anker") und ggf. `evidenceLevel` mit in den Report — so verknüpft das Dashboard Testergebnis mit Quelle.

### Szenario-Tests T01–T17 (Wissenschafts-Gate — vor UI grün)

**Normative Quelle ist das beiliegende Test-Dashboard** (`HybridAthlete_Test_Dashboard.html`): Es enthält alle 17 Tests mit exakten Inputs, Expected- und Actual-Werten, lauffähig gegen den Engine-Snapshot. Portiere sie 1:1 nach Vitest (`tests/scenario/`), identische Fixtures und Assertions. Kurzübersicht (Details im Dashboard, Anker in Spez §4/§9):

| Test | Szenario | Kern-Erwartung |
|------|----------|----------------|
| T01 | ACWR-Mathematik, deterministische Fixture | Ratio exakt 1.00 |
| T02 | Demo-Seed | genau 3 Vorschläge: R3, R4, R7 |
| T03 | Fingerlast < 48 h, fixes Bouldern | R3 `reduce` (nie move) |
| T04 | Bergtag −30 h, reine Beineinheit +12 h | R4 `move` (Aushöhl-Schutz) |
| T05 | Reha-Basis + volle Woche | R7 `remove` auf Lauf, proj. Ratio > 1,5 |
| T06 | alle Seed-Vorschläge | 0× `move`/`remove` auf fix |
| T07 | `move` angenommen | R4 feuert nicht erneut |
| T08 | Ablehnung | Key kommt nie wieder |
| T09 | Schmerz NRS 7 + R3 auf gleichem Ziel | R1 gewinnt Dedupe, `reduce` auf fix |
| T10 | Schulter platt, Push mehrheitlich betroffen | R5 `move` (kein swap) |
| T11 | Knie rot | Legs-Einheit ohne Knie-getaggte Übung |
| T12 | Constraint Schulter rot | Push ohne Schulter-Loader ≥ 2 |
| T13 | `logged`/`skipped` | raus aus Projektion & Regel-Zielen |
| T14 | Full Body im Bergtag-Fenster | R4 `swap`: nur Bein-Loader raus, Rest bleibt |
| T15 | reine Beineinheit im Fenster | `move`, kein swap (Aushöhl-Schutz) |
| T16 | oberer Rücken müde, Upper-Session | R5 `swap`: Barbell Row raus, Curl bleibt |
| T17 | Machbarkeit datumsabhängig | Back Squat +12 h `stop` (Bergtag), +4 d nur noch Knie-Grund; Bench `fresh` |

Zusätzlich aus v1 übernehmen: R8-Abdeckungstest (Pull abgewählt → Einstreu-Vorschlag), Garmin-Idempotenz (`garminActivityId`), Quellen-Pflicht (jede aktive Regel hat `source` + `evidenceLevel`, sonst rot), ACWR-Zonengrenzen exakt.

| Test | Szenario | Erwartung | Anker |
|------|----------|-----------|-------|
| T1 | Einheit `fixed` (Boulderabend), Ermüdung/ACWR legen Änderung nahe | **kein** `move`/`remove` auf diese Einheit | AC1 |
| T2 | Schmerz NRS 7 auf `fingers` | Region gesperrt, Vorschlag mit R1 als Trigger, unabhängig von niedrigeren Regeln | AC2 / Silbernagel |
| T3 | Schmerz NRS 3 auf `fingers` | `reduce` (nicht Sperre); Folgetag-Prüfung aktiv | R1 (≤5 tolerabel) |
| T4 | Bergtag Sa, `eccentric`, hohe hm; schwere UK-Kraft Mo (< 48 h) | `move`/`reduce` mit R4-Trigger | AC5 / DOMS 24–72 h |
| T5 | Boulder-Limit Di mit `hardFingerLoad`; Kraft-Zug hoher Griff Mi | `reduce`/`move` mit R3-Trigger | R3 / Pulley ≥48 h |
| T6 | Constraint Knie 🟡, Generator baut Bein-Einheit | keine `deep`-Übung, `low`/`mid`-Alternative aus Katalog | AC6 |
| T7 | Nutzer wählt Pull ab, Generator läuft | Hinweis auf ungedeckte hintere Schulter/horizontales Ziehen + Einstreu-Vorschlag (rear_delt_fly_db / band_pull_apart / chest_supported_row_db) | AC7 / R8 |
| T8 | Vorschlag abgelehnt mit Grund | Grund erfasst + Regel zugeordnet | AC8 |
| T9 | FIT-Lauf importiert, dann erneut importiert | 1 Log-Entwurf, kein Duplikat (garminActivityId) | AC9 |
| T10 | prognostizierte Wochen-ACWR > 1,5 | `reduce`/`remove` auf **nicht-fixe** Einheit (Lauf), nie Berg/Boulder | AC10 / Gabbett |
| T11 | jede aktive Regel | hat `source` + `evidenceLevel`; Test schlägt fehl, wenn eine fehlt | AC4 / G2 |
| T12 | Sweet-Spot-ACWR 0,8–1,3 | kein ACWR-Vorschlag | R7-Zonen |

---

## UI (Preact + HTM), nach grünen Engine-Tests

Screens gemäß Spez §6 (v2.0). Der Prototyp ist die Verhaltens-Referenz — bei Unklarheit dort nachsehen. Prioritäten:

1. **Home:** Ridgeline-Karte (Signature) mit antippbarem **ACWR-Chip → Explainer-Overlay** (Live-Zahlen, Zonen, Quelle + Kritik, Spez §6.8); „Jetzt loggen"-CTA; Check-in-Karte; Erholungs-Chips (frisch/müde/platt); Wochen-Vorschau.
2. **Post-Session-Log (< 60 s, AC3):** Bestätigen **mit Auswegen** („Nicht gemacht" → `skipped`; „Was anderes gemacht" → Sport-Picker, freie Session) → Dauer/sRPE (sportabhängige Max/Schrittweite; Bergtag + **hm-Regler**; **sRPE-Farbcode** locker/moderat/hart/sehr hart/maximal) → Kraft: Abhaken mit **Machbarkeits-Markern**; Bouldern: Finger-Toggle → Ampel (frisch/müde/platt + Konsequenz-Zeile) → Schmerz mit **sportabhängiger Regionsliste** → speichern → Engine. ‹-Zurück ab Schritt 2; Timer sichtbar.
3. **Morgen-Check-in (~30 s):** Ampel nur für Regionen mit Last in letzten 72 h.
4. **Vorschlags-Inbox:** Karte mit Operation (Anpassen/Abschwächen/Verschieben/Streichen, farbcodiert), Coach-Text (2. Person), **Raus/Rein/Bleibt-Box bei `swap`**, Regel + Quelle + Evidenzgrad direkt sichtbar; Annehmen/Ablehnen mit Grund; Feedback pro Vorschlag **und** Regel aggregiert.
5. **Wochenansicht = Planungs-Zentrale (Spez §6.5):** rollierende 7 Tage ab heute, Slot-Spaltenkopf; **Session-Editor** (Tag/Slot/Fix/Streichen + bei Kraft Übungsliste mit Machbarkeits-Ampel je Übung, ⇄/✕/＋, live beim Tageswechsel); **Hinzufügen** über leeren Slot oder ＋-Button (readiness-aware vorbefüllt); **Drag & Drop pointer-basiert** (Long-Press-Lift ~280 ms, Ghost, Drop-Highlight, leer = move, belegt = Tausch, geloggt = abgelehnt, Scroll-Cancel > 10 px vor Lift, danach `recompute()` + Toast). Kein natives HTML5-DnD.
6. **Regelwerk-Screen:** pro Regel Parameter, Quelle, Evidenzgrad, 👍/👎-Statistik; ACWR-/Pulley-Kritik offen.
7. **Einstellungen:** Ziel/Split/Einheiten-Abwahl; **Constraint-Manager generisch** (Region-Dropdown + gelb/rot, Chips mit ✕, Auswahl bleibt beim Level-Toggle erhalten); Generator-Vorschau mit ●◆■-Markern; „Plan neu generieren" readiness-aware; Import/Export/Reset unter Eyebrow-Gruppen.
8. **Garmin-Import:** wie v1 (ZIP-Onboarding, FIT/TCX-Entwurf + sRPE-Ergänzung, Idempotenz via `garminActivityId`).

**CI:** Design-Tokens aus Spez §12 (HybridAthlete: Volt `#C8F542`, Archivo Black/Barlow/JetBrains Mono, Radien 7/11/14, Ampel Teal/Amber/Rose **redundant kodiert** — unantastbar). `:root`-Block des Prototyps 1:1 als Token-Quelle übernehmen; Fonts selbst hosten (offline).

Slot-Modell (Option B): Slots morning 6–12 / midday 12–18 / evening 18–24 als Default; **optionale Uhrzeit** verfeinert Interferenz-Abstände (R6, ≥6 h). 17:00 fällt per Slot in midday, aber mit Uhrzeit rechnet R6 den realen Stundenabstand.

---

## Test-Dashboard (`test-dashboard.html`)

Ein **buildless, browser-öffenbares** HTML-Dashboard, das den Testzustand sichtbar macht — passend zum Wissenschaftsanspruch: es zeigt nicht nur grün/rot, sondern **welches Abnahmekriterium und welche Quelle** ein Test absichert.

Anforderungen:
- **Datenquelle:** lädt `test-report.js` per `<script src>` (setzt `window.__TEST_REPORT__`). **Kein `fetch()` auf lokale JSON** — das scheitert beim Öffnen via `file://`. Deshalb Report als zuweisendes JS-File, nicht als reine `.json`.
- **Kopfzeile:** Gesamt-Status (Pass/Fail/Skip-Zähler), Coverage-Prozent (engine/rules separat + gesamt), Zeitstempel des Laufs.
- **Suiten-Gruppierung:** data / engine / rules / scenario. Pro Test: Status-Badge, Titel, Dauer.
- **Szenario-Sektion prominent:** Tabelle T01–T17 mit Spalten Test · Status · **Anker (AC + Literatur)** · **Evidenzgrad**. Fehlgeschlagene rot hervorheben.
- **Regel-Abdeckungs-Matrix:** R1–R8 × „durch welche Tests abgedeckt" — macht sichtbar, wenn eine Regel ungetestet ist.
- **Kein Framework nötig:** Vanilla HTML/CSS/JS in einer Datei (das Dashboard ist bewusst kein Preact-Screen, damit es unabhängig vom App-Build läuft). Keine externen CDN-Abhängigkeiten außer optional einer gepinnten Chart-Lib; sonst reicht CSS.
- **Aktualität:** Der Testlauf regeneriert `test-report.js`; das Dashboard bleibt dadurch automatisch aktuell. In der CI wird das Dashboard + Report als Artefakt hochgeladen.

## Dokumentation & README (Englisch)

`README.md` muss einen sachkundigen Leser in wenigen Minuten arbeitsfähig machen:
- **What it is:** ein Satz Zweck + dass die App-UI Deutsch, der Code Englisch ist.
- **Scientific basis:** kurze Tabelle der tragenden Regeln R1–R7 mit Quelle + Evidenzgrad und dem ehrlichen Hinweis auf `assumption`-Stellen (regionale Decomposition, ACWR-Kritik). Verweis auf `docs/Spezifikation…`.
- **Architecture:** die harte Trennlinie engine/data/rules (Vanilla, testbar) vs. ui (Preact/HTM); Datenfluss Log → Engine → Vorschlag → Inbox.
- **Getting started:** Voraussetzungen, `npm install`, `npm test`, wie man die App lokal öffnet (statischer Server wegen ES-Module), wie man das Test-Dashboard öffnet.
- **Data & privacy:** alles lokal in IndexedDB, kein Backend, JSON-Export/-Import, Garmin nur Datei-Import.
- **Testing:** kurze Beschreibung der drei Ebenen + Link zum Dashboard.
- **Roadmap:** V2-Parkplatz aus Spezifikation §11 verlinken.
- **License** + Contributing-Hinweis.

Zusätzlich: **kurze ADRs** in `docs/decisions/` (je ~10 Zeilen) für die vier tragenden Entscheidungen — Preact statt Vanilla-only, ACWR nur systemisch, Pulley-48-h als expert-consensus, konservatives DOMS-Fenster. Das dokumentiert das *Warum*, nicht nur das *Was*.

## Git & GitHub Workflow (sauber & nachvollziehbar)

- **Init früh:** Repo initialisieren, `.gitignore` (node_modules, coverage, generierte Reports optional), erster Commit = Scaffolding + Doku, bevor Logik entsteht.
- **Conventional Commits:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`. Ein Commit = eine logische Einheit, nicht ein Riesen-Dump.
- **Branch-Strategie (Solo):** Feature-Branch je Modul (`feat/data-layer`, `feat/engine-rules`, `feat/ui-inbox`, …) → PR nach `main`. PR-Beschreibung nennt, welche AC/Tests der Branch grün macht.
- **Commit-Checkpoints:** nach jedem der Module (a)–(f) im Vorgehen committen und pushen; die Szenario-Tests müssen im jeweiligen PR grün sein.
- **CI-Gate:** `.github/workflows/test.yml` läuft die Testsuite bei Push/PR, lädt `test-report.js` + `test-dashboard.html` als Artefakt hoch. `main` nur mit grüner CI mergen.
- **Tags:** `v0.1.0` sobald T01–T17 grün und die UI-Kernscreens stehen (MVP).
- Vor dem ersten Push fragt Claude Code nach dem **Repo-Namen und ob privat/öffentlich**; Standard-Vorschlag privat, bis der MVP steht.



1. **Bevor du Code schreibst:** Lies Spezifikation §2 (Datenmodell), §3 (Logik), §4 (Regelkatalog mit Quellen). Wenn dir eine Regel-Parametrisierung unklar ist, frag nach — erfinde keine Werte. Frag nach Repo-Name und privat/öffentlich, dann `git init` + Scaffolding-Commit + Push.
2. **Reihenfolge:** (a) `data/` + Seed-Loading, (b) `engine/` + `rules/` inkl. `rules/catalog.json` aus §4, (c) **Szenario-Tests T01–T17 + Unit-Tests grün, `test-report.js` + `test-dashboard.html` erzeugt**, (d) `ui/`, (e) Service Worker + Manifest (offline), (f) Garmin-Import. **Nach jedem Schritt: Conventional-Commit + Push** über den zugehörigen Feature-Branch/PR.
3. **CI zuerst lauffähig:** `.github/workflows/test.yml` so früh einrichten, dass ab Schritt (b) jeder Push die Tests grün oder rot meldet.
4. **README + ADRs** parallel pflegen, nicht am Ende — nach (c) muss die README Setup + Wissenschaftsbasis + Testing/Dashboard abdecken.
5. **Nach jedem Modul:** kurze Zusammenfassung was gebaut wurde + welche Annahmen getroffen wurden + welche Tests/AC nun grün sind.
6. **Kennzeichne jede `assumption`** im Code-Kommentar (Englisch) und in `catalog.json`. Die regionale Load-Decomposition und die hm-Skalierung von R4 sind Annahmen — nicht als Fakt darstellen.
7. **Generalisierbarkeit mitdenken, aber nicht bauen:** Datenmodell generisch halten (kein Hartcodieren des Presets in die Engine), aber keinen Onboarding-Flow für zweite Athleten (= V2).
8. **Tag `v0.1.0`** setzen, sobald T01–T17 grün und die UI-Kernscreens (Home, Log, Inbox, Wochenansicht, Regelwerk) stehen.

Beginne mit Repo-Setup (Name/Sichtbarkeit erfragen, `git init`, `.gitignore`, README-Grundgerüst, CI-Skeleton) und danach Modul (a) `data/db.js` + `repositories.js` + Seed-Loading. Zeig mir das Store-Schema und die Migrationsstrategie, bevor du weitergehst.
