#!/usr/bin/env bash
# One-time GitHub setup: private repo, labels, milestone, project board, 18 user-story issues.
# Requires: gh auth login (+ project scope: gh auth refresh -s project)
set -euo pipefail

REPO_NAME="hybridathlete"
PROJECT_TITLE="HybridAthlete V1"
MILESTONE="v0.1.0 MVP"

# --- repo ---------------------------------------------------------------
if ! gh repo view "$REPO_NAME" >/dev/null 2>&1; then
  gh repo create "$REPO_NAME" --private --source=. --remote=origin --push
else
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "$(gh repo view "$REPO_NAME" --json url -q .url).git"
  git push -u origin main
fi
OWNER=$(gh repo view --json owner -q .owner.login)

# --- labels -------------------------------------------------------------
for l in "epic:data|0e8a16" "epic:engine|1d76db" "epic:rules|5319e7" "epic:testing|fbca04" "epic:ui|d93f0b" "epic:pwa-import|c2e0c6" "user-story|bfd4f2"; do
  name="${l%%|*}"; color="${l##*|}"
  gh label create "$name" --color "$color" --force >/dev/null
done

# --- milestone ----------------------------------------------------------
if ! gh api "repos/$OWNER/$REPO_NAME/milestones" -q '.[].title' | grep -qxF "$MILESTONE"; then
  gh api "repos/$OWNER/$REPO_NAME/milestones" -f title="$MILESTONE" \
    -f description="Science gate T01–T17 green + core screens (Home, Log, Inbox, Week, Rulebook)" >/dev/null
fi

# --- project v2 ---------------------------------------------------------
PROJ_NUM=$(gh project list --owner "$OWNER" --format json -q ".projects[] | select(.title == \"$PROJECT_TITLE\") | .number" | head -1)
if [ -z "$PROJ_NUM" ]; then
  PROJ_NUM=$(gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json -q .number)
fi
echo "Project #$PROJ_NUM"

# --- issues -------------------------------------------------------------
issue() { # $1=title $2=label, body on stdin
  local n
  n=$(gh issue create --title "$1" --label "$2" --label "user-story" --milestone "$MILESTONE" --body-file - --json number -q .number 2>/dev/null) \
    || n=$(gh issue create --title "$1" --label "$2" --label "user-story" --milestone "$MILESTONE" --body-file - | grep -oE '[0-9]+$')
  gh project item-add "$PROJ_NUM" --owner "$OWNER" --url "$(gh issue view "$n" --json url -q .url)" >/dev/null
  echo "  #$n $1"
}

issue "Story 1: Lokale Persistenz (IndexedDB-Stores + Migrationen)" "epic:data" <<'EOF'
Als Athlet möchte ich, dass alle meine Trainingsdaten lokal auf dem Gerät gespeichert werden, damit die App vollständig offline und ohne Konto funktioniert.

**Akzeptanzkriterien (testbar)**
- Given die App startet zum ersten Mal, When die DB initialisiert wird, Then existieren alle 11 Object Stores gemäß Spez §2.1 (`profile`, `sports`, `exercises`, `plannedSessions`, `sessionLogs`, `setLogs`, `fatigueEntries`, `painEntries`, `suggestions`, `rules`, `importBatches`).
- Given eine ältere Schema-Version, When die DB geöffnet wird, Then laufen versionierte Migrations-Callbacks (Scaffold vorhanden, Test mit Version-Bump).
- CRUD + Multi-Store-Transaktionen je Store durch Unit-Tests auf fake-indexeddb abgedeckt.

Verifiziert durch: `test/data/` (fake-indexeddb).
EOF

issue "Story 2: Erststart-Seeding (Referenz-Athlet, Kataloge)" "epic:data" <<'EOF'
Als Referenz-Athlet möchte ich, dass die App beim ersten Start mein Profil und die Kataloge einspielt, damit ich ohne Konfiguration sofort loslegen kann.

**Akzeptanzkriterien (testbar)**
- Given leere DB, When Seeding läuft, Then enthält `profile` das Preset `reference_athlete` mit goal `sport_support`, split `PPL`, `disabledUnits: ["pull"]` und Knie-Constraint 🟡 `avoid_loaded_flexion_80_90`.
- Then sind `exercises` (aus exercises.seed.json), `sports` (sports.seed.json) und `rules` (rules/catalog.json) vollständig geseedet.
- Given bereits geseedete DB, When Seeding erneut läuft, Then entstehen keine Duplikate (Idempotenz-Test).

Verifiziert durch: Seed-Tests in `test/data/`.
EOF

issue "Story 3: Lastmodell (sRPE-TL + regionale Decomposition)" "epic:engine" <<'EOF'
Als Athlet möchte ich, dass jede geloggte Einheit in eine globale und regionale Last übersetzt wird, damit Regeln auf realer Belastung basieren.

**Akzeptanzkriterien (testbar)**
- sRPE-TL = sRPE × Dauer (Foster 2001, validiert) — Unit-Tests.
- regionLoad[r] = loadProfile[r] × (sRPE/10) × (duration/60); im Code als `assumption` gekennzeichnet (Kommentar, Englisch).
- Kraft-Einheiten aggregieren Regionen-Last aus geloggten Übungen (loadSource `exercises`), nicht aus dem statischen Profil.
- **T01**: deterministische ACWR-Fixture ergibt Ratio exakt 1.00.

Verifiziert durch: `test/engine/load.test.js`, Szenario T01.
EOF

issue "Story 4: ACWR-Berechnung mit exakten Zonengrenzen" "epic:engine" <<'EOF'
Als Athlet möchte ich meine Wochenbelastung als ACWR sehen, damit ich Überlastungsrampen erkenne.

**Akzeptanzkriterien (testbar)**
- ACWR = Akut (7-Tage-Summe sRPE-TL) ÷ Chronisch (28-Tage-Wochenmittel), Rolling Average.
- Zonengrenzen exakt getestet: 0,79 → detraining; 0,80 & 1,30 → Sweet Spot; 1,31 & 1,50 → erhöht; 1,51 → Warnung.
- **T01** grün (Ratio exakt 1.00 bei deterministischer Fixture).
- Sweet-Spot-Fall: ACWR 0,8–1,3 erzeugt keinen R7-Vorschlag (Zusatztest).

Verifiziert durch: `test/engine/acwr.test.js`, T01.
EOF

issue "Story 5: R1 Schmerz-Ampel (Pain-Monitoring-Model)" "epic:rules" <<'EOF'
Als Athlet möchte ich, dass gemeldeter Schmerz alle anderen Planungsregeln überstimmt, damit ich nie in eine schmerzende Struktur hineintrainiere.

**Akzeptanzkriterien (testbar)**
- NRS ≤ 2: keine Aktion. NRS 3–5: reduce-Tier. NRS > 5: remove-Tier (auf fixen Einheiten: reduce).
- Schmerzfenster 36 h; Kraft-Einheiten versuchen zuerst `swap` (Übungsebene).
- **T09**: NRS 7 auf fingers + R3 auf gleichem Ziel → R1 gewinnt Dedupe, `reduce` auf fixem Bouldern, R1 steht an erster Stelle (Tier 1).
- Quelle Silbernagel 2007 (`rct`) am Vorschlag sichtbar.

Verifiziert durch: T09, `test/rules/r1.test.js`.
EOF

issue "Story 6: R2 Dauerhafte Constraints (generisch + Knie-Beugetiefe)" "epic:rules" <<'EOF'
Als Athlet mit Knie-Einschränkung möchte ich Constraints je Region hinterlegen, damit Generator und Umplanung nur machbare Übungen vorschlagen.

**Akzeptanzkriterien (testbar)**
- Generisch: gelb → Übungen mit Load ≥ 3 auf der Region fliegen aus dem Pool; rot → Load ≥ 2 fliegt.
- Sonderfall Knie: gelb schließt `kneeFlexionTag: "deep"` aus; rot alle Knie-getaggten Übungen.
- **T11**: Knie rot → Legs-Einheit ohne einzige Knie-getaggte Übung.
- **T12**: Schulter rot → Push ohne Übung mit shoulder-Load ≥ 2.
- Ersatzsuche von `swapProposal` respektiert alle aktiven Constraints.

Verifiziert durch: T11, T12; AC6.
EOF

issue "Story 7: R3 Sehnen-/Pulley-Erholung (48 h, reduce-only auf fix)" "epic:rules" <<'EOF'
Als Boulderer möchte ich nach harter Fingerbelastung vor einer zweiten hohen Fingerlast gewarnt werden, damit meine Pulleys nicht symptomatisch überlastet werden.

**Akzeptanzkriterien (testbar)**
- Nach Einheit mit `tendonHeavy` + `hardFingerLoad`: < 48 h keine zweite hohe Fingerlast.
- **T03**: Fingerlast < 48 h vor fixem Bouldern → R3 schlägt `reduce` vor, niemals `move` (fix schützt Timing).
- Evidenzgrad `expert-consensus` explizit; ohne `hardFingerLoad`-Flag arbeitet R3 mit statischem Boulder-Profil (low confidence).

Verifiziert durch: T03, `test/rules/r3.test.js`.
EOF

issue "Story 8: R4 Exzentrik/DOMS nach Bergtag (hm-Skalierung, swap, Aushöhl-Schutz)" "epic:rules" <<'EOF'
Als Bergsportler möchte ich, dass nach einem Abstieg meine Beineinheiten angepasst statt stur durchgezogen werden, damit ich nicht in den DOMS-Peak hineintrainiere.

**Akzeptanzkriterien (testbar)**
- Erholungsfenster 48 h + hm-Skalierung: `48 + min(24, (hm−600)/1200·24)`; betroffene Regionen quads/posterior_chain/calves.
- **T04**: Bergtag −30 h, reine Beineinheit +12 h → `move` (Aushöhl-Schutz, kein swap).
- **T14**: Full Body im Fenster → `swap`: nur Bein-Loader ≥ 2 raus (back_squat), 3 Übungen bleiben, Ersatz lädt keine Bein-Region ≥ 2.
- **T15**: reine Beineinheit → `move`, kein swap (drop > keep).
- hm-Skalierung als `assumption` gekennzeichnet.

Verifiziert durch: T04, T14, T15; AC5/AC11.
EOF

issue "Story 9: R5 Muskuläre Erholung (Ampel frisch/müde/platt, Übungs-swap)" "epic:rules" <<'EOF'
Als Athlet möchte ich meine Ermüdung je Region als Ampel melden, damit die nächste Einheit realistisch geplant wird.

**Akzeptanzkriterien (testbar)**
- müde (caution): 48 h reduzierte Wiederbelastung; platt (stop): 72 h keine schwere; Ampel-Einträge > 72 h alt verfallen.
- Kraft: `swap` zuerst, auch auf fixen Einheiten; Fallback platt → move, müde → reduce.
- **T10**: Schulter platt, Push mehrheitlich betroffen → `move` (Aushöhl-Schutz).
- **T16**: oberer Rücken müde, Upper-Session → `swap`: Barbell Row raus, Curl bleibt, Ergebnis lädt upper_back < 2.

Verifiziert durch: T10, T16; `test/rules/r5.test.js`.
EOF

issue "Story 10: R6 Interferenz + R7 ACWR-Wochensteuerung" "epic:rules" <<'EOF'
Als Hybrid-Athlet möchte ich Hinweise bei Kraft/Ausdauer-Kollisionen und bei zu steiler Wochenrampe, damit meine Gesamtlast im grünen Bereich bleibt.

**Akzeptanzkriterien (testbar)**
- R6: Kraft + Ausdauer am selben Tag mit < 6 h Abstand → Hinweis (Tier 5, mit ehrlicher Meta-Analyse-Einordnung Schumann 2022).
- R7: projizierte Wochen-ACWR > 1,5 am Horizontende → `remove`/`reduce` **nur auf nicht-fixe** Einheit (typisch Lauf).
- **T05**: Reha-Basis + volle Woche → R7 `remove` auf Lauf, projizierte Ratio > 1,5 (aus Coach-Text extrahierbar).
- Sweet Spot 0,8–1,3: kein R7-Vorschlag.

Verifiziert durch: T05, Sweet-Spot-Test; AC10.
EOF

issue "Story 11: Vorschlags-Orchestrierung (Priorität, Dedupe, Guards, Fix-Schutz)" "epic:engine" <<'EOF'
Als Athlet möchte ich pro Problem genau einen, minimal-invasiven Vorschlag bekommen, damit die Inbox vertrauenswürdig bleibt.

**Akzeptanzkriterien (testbar)**
- Prioritätshierarchie R1 > R2 > Fix > R3/R4/R5 > R6 > R7; Dedupe je Ziel: niedrigster Tier gewinnt, bei Gleichstand mildeste Operation (swap 0 < reduce 1 < move 2 < remove 3).
- **T02**: Demo-Seed → genau 3 Vorschläge: R3, R4, R7.
- **T06**: kein `move`/`remove` auf fixen Einheiten (Invariante über alle Seed-Vorschläge).
- **T07**: angenommener `move` → R4 feuert nicht erneut.
- **T08**: abgelehnter Key (`ruleId|targetId`) kommt nie wieder.
- **T13**: `logged`/`skipped` verlassen `futurePlanned()` — keine Doppelzählung, keine Regel-Ziele.

Verifiziert durch: T02, T06, T07, T08, T13.
EOF

issue "Story 12: exerciseReadiness — datumsabhängige Machbarkeit je Übung" "epic:engine" <<'EOF'
Als Athlet möchte ich für jede Übung und jeden Zieltermin sehen, ob sie machbar ist (und warum nicht), damit Editor, Log und Generator ehrlich planen.

**Akzeptanzkriterien (testbar)**
- Signatur `exerciseReadiness(exerciseId, when, state) -> {level: fresh|caution|stop, reasons[]}` mit **allen** Gründen.
- Signale: R2 Constraints (zeitlos), R1 Schmerz (36 h), R5 Ermüdung (48/72 h relativ zum Zieltermin), R4 Exzentrik-Fenster.
- **T17**: Back Squat +12 h → `stop` mit Bergtag-Grund; +4 Tage → Bergtag-Grund entfällt, Knie-/Beugetiefe-Grund bleibt; Bench +12 h → `fresh`.

Verifiziert durch: T17; `test/engine/readiness.test.js` (5 Signal-Klassen + Datumsabhängigkeit).
EOF

issue "Story 13: Kraftplan-Generator (Split/Ziel/Constraints, readiness-aware, R8)" "epic:engine" <<'EOF'
Als Athlet möchte ich einen Kraftplan generieren, der zu Split, Ziel, Constraints und meinem aktuellen Erholungszustand passt.

**Akzeptanzkriterien (testbar)**
- `generateStrength(profile, state?, when?)`: ohne optionale Parameter deterministisch; mit state+when fliegt `stop` raus, `fresh` vor `caution`.
- Volumen-Schema je Ziel (Kraftaufbau 4–6×3–6, Hypertrophie 3–4×8–12, Erhalt 2–3×6–10, Sport-Support 3×5–8).
- Constraints generisch (gelb Load ≥ 3 raus, rot ≥ 2; Knie zusätzlich Beugetiefe) — T11/T12.
- R8: Pull abgewählt → Hinweis „hintere Schulter/horizontales Ziehen ungedeckt" + Einstreu-Vorschlag aus {rear_delt_fly_db, band_pull_apart, chest_supported_row_db}.
- Zieltermin im Bergtag-Fenster → keine Übung mit Readiness `stop` (AC14).

Verifiziert durch: T11, T12, R8-Test, Generator-Unit-Tests; AC6/AC7/AC14.
EOF

issue "Story 14: Wissenschafts-Gate — Test-Report + buildless Test-Dashboard" "epic:testing" <<'EOF'
Als wissenschaftlich anspruchsvoller Nutzer möchte ich sehen, welcher Test welches Abnahmekriterium und welche Quelle absichert, damit ich der Engine trauen kann.

**Akzeptanzkriterien (testbar)**
- T01–T17 1:1 aus dem normativen Dashboard portiert (identische Fixtures/Assertions), alle grün.
- Quellen-Pflicht: Test schlägt fehl, wenn eine aktive Regel `source` oder `evidenceLevel` fehlt (AC4).
- Testlauf schreibt `test-report.js` (`window.__TEST_REPORT__` mit generatedAt, totals, coverage, suites; Szenario-Tests tragen Anker + Evidenzgrad).
- `test-dashboard.html` öffnet per `file://` (kein fetch), zeigt Kopfzeile (Pass/Fail/Coverage engine+rules getrennt), Suiten-Gruppen, T01–T17-Tabelle mit Anker/Evidenzgrad, R1–R8-Abdeckungsmatrix.
- Coverage: engine+rules ≥ 90 %, gesamt ≥ 75 %.

Verifiziert durch: CI-Lauf + manuelles Öffnen des Dashboards.
EOF

issue "Story 15: Home + Post-Session-Log (<60 s) + Morgen-Check-in" "epic:ui" <<'EOF'
Als Athlet möchte ich abends in unter 60 Sekunden loggen und morgens in 30 Sekunden einchecken, damit Tracking nie zur Hürde wird.

**Akzeptanzkriterien (testbar)**
- Home: Ridgeline-Karte mit antippbarem ACWR-Chip → Explainer-Overlay (Live-Zahlen, 4 Zonen, Quelle + Kritik), „Jetzt loggen"-CTA, Check-in-Karte, Erholungs-Chips, Wochen-Vorschau.
- Log-Flow: Bestätigen mit Auswegen („Nicht gemacht" → skipped, „Was anderes gemacht" → Sport-Picker); Dauer/sRPE sportabhängig (Bergtag 720 min/30er-Schritte + hm-Regler; sRPE-Farbcode locker/moderat/hart/sehr hart/maximal); Kraft-Abhaken mit Machbarkeits-Markern; Boulder-Finger-Toggle; Ampel frisch/müde/platt mit Konsequenz-Zeile; sportabhängige Schmerzregionen; ‹-Zurück ab Schritt 2; sichtbarer Timer (>60 s färbt um).
- Nach Speichern läuft die Engine, neue Vorschläge landen in der Inbox (Toast).
- Morgen-Check-in: Ampel nur für Regionen mit Last in den letzten 72 h.

Verifiziert durch: manueller Smoke-Test gegen Prototyp-Verhalten; AC3.
EOF

issue "Story 16: Vorschlags-Inbox + Regelwerk-Screen (Wissenschaft sichtbar)" "epic:ui" <<'EOF'
Als Athlet möchte ich jeden Vorschlag mit Regel, Quelle und Evidenzgrad sehen und mit Grund ablehnen können, damit ich nachvollziehen und mitsteuern kann.

**Akzeptanzkriterien (testbar)**
- Karte je Vorschlag: Operation farbcodiert (Anpassen/Abschwächen/Verschieben/Streichen), Coach-Text (2. Person), bei `swap` Raus/Rein/Bleibt-Box, Regel + Quelle + Evidenzgrad direkt sichtbar (AC4).
- Annehmen wendet `proposed` an und recomputet; Ablehnen erfasst Grund (vordefiniert + Freitext) und ordnet ihn der Regel zu (AC8); Ablehnung unterdrückt den Key dauerhaft.
- 👍/👎 aggregiert pro Regel; Regelwerk-Screen zeigt je Regel Parameter, Quelle, Evidenzgrad, Statistik; ACWR-/Pulley-Kritik offen.

Verifiziert durch: manueller Smoke-Test; AC4/AC8.
EOF

issue "Story 17: Wochenansicht als Planungs-Zentrale (Editor, Hinzufügen, Drag & Drop)" "epic:ui" <<'EOF'
Als Athlet möchte ich meine Woche direkt manipulieren (verschieben, tauschen, Übungen editieren), damit Planung und Realität nicht auseinanderlaufen.

**Akzeptanzkriterien (testbar)**
- Rollierende 7 Tage ab heute, 3 Slots/Tag mit Spaltenkopf; Karten mit Status (geloggt/ausgefallen/gestrichen/reduziert/angepasst), fix = 📌.
- Session-Editor: Tag/Slot/Fix/Streichen; bei Kraft Übungsliste mit Machbarkeits-Ampel je Übung (alle Gründe), ⇄/✕/＋, live beim Tageswechsel; Änderungen setzen `adjusted`.
- Hinzufügen über leeren Slot oder ＋: readiness-aware vorbefüllt, sofortige Engine-Prüfung nach Speichern (AC15).
- Drag & Drop pointer-basiert: ~280 ms Long-Press-Lift, Ghost, Drop-Highlight, leer = move, belegt = Tausch, geloggt = abgelehnt, > 10 px vor Lift = Scroll-Cancel, danach recompute() + Toast. Kein natives HTML5-DnD.
- Settings: Ziel/Split/Abwahl, generischer Constraint-Manager, Generator-Vorschau mit ●◆■, „Plan neu generieren" readiness-aware, Export/Import/Reset.

Verifiziert durch: manueller Smoke-Test; AC15.
EOF

issue "Story 18: Offline-PWA + Garmin-Datei-Import" "epic:pwa-import" <<'EOF'
Als Nutzer unterwegs möchte ich die App offline nutzen und Garmin-Aktivitäten per Datei importieren, damit meine Ausdauereinheiten ohne Handarbeit einfließen.

**Akzeptanzkriterien (testbar)**
- manifest.webmanifest + Service Worker: App lädt nach erstem Besuch vollständig offline (Precache App + Vendor + Fonts + Seeds); Push optional, Fallback In-App-Badge.
- FIT/TCX-Import erzeugt einen **Entwurf** (Typ/Dauer/hm), der erst nach sRPE-Ergänzung + Bestätigung in die Load-Berechnung eingeht (AC9).
- Erneuter Import derselben Aktivität erzeugt kein Duplikat (`garminActivityId`, `importBatches`) — automatisierter Test.
- ZIP-Onboarding: letzte ≥ 4 Wochen Lauf/Berg/Rad → chronische Last sofort verfügbar.

Verifiziert durch: Idempotenz-Test + Offline-Smoke-Test.
EOF

echo "Done. Repo, labels, milestone, project #$PROJ_NUM and 18 story issues created."
