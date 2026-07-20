# Spezifikation: HybridAthlete — Adaptiver Trainingsplaner (PWA)

**Arbeitstitel:** HybridAthlete *(Namens-Hinweis: Begriff ist in der Fitness-Szene stark besetzt; vor Launch Schreibvariante/Markenlage prüfen)*
**Version:** 2.0 (nach 2 Feedback-Runden am funktionalen Prototyp; normative Referenz: `HybridAthlete_Funktionaler_Prototyp.html` + Test-Dashboard T01–T17)
**Status:** Spezifikation abgenommen — implementierungsbereit
**Autor:** erstellt mit Claude auf Basis der Anforderungsklärung (4 Fragenblöcke)
**Zielnutzer V1:** Johannes (Multi-Sport: Bouldern, Kraft, Laufen, Bergsport), Preset "Referenz-Athlet"

---

## 1. Ziele, Scope & Systemgrenzen

### 1.1 Produktziel

Eine offline-fähige PWA, die eine vom Nutzer angelegte Trainingswoche laufend **überwacht** und bei geloggter Belastung, Ermüdung oder Schmerz **evidenzbasierte Umplanungsvorschläge** macht — ohne fixe Einheiten (Boulderabende, Bergtag) anzutasten. Ergänzend generiert die App auf Wunsch einen Krafttrainings-Wochenplan, der mit den übrigen Belastungsachsen (Bouldern, Laufen, Berg) verträglich ist.

### 1.2 Goals (messbar)

| # | Ziel | Messgröße V1 |
|---|------|--------------|
| G1 | Post-Session-Logging in unter 60 Sekunden möglich | Zeit vom Öffnen der Log-Karte bis Abschluss |
| G2 | Jede Planungsregel ist auf eine Quelle mit Evidenzgrad zurückführbar | 100 % der aktiven Regeln haben `source` + `evidenceLevel` |
| G3 | Vorschläge sind für den Nutzer nachvollziehbar und bewertbar | 👍/👎 + Grund pro Vorschlag erfassbar |
| G4 | Fixe Einheiten werden nie verändert | 0 Vorschläge, die eine `fixed`-Einheit verschieben/streichen |
| G5 | Schmerz überschreibt alle anderen Regeln (als Vorschlag) | Schmerz-Trigger hat höchste Priorität in der Engine |

### 1.3 Non-Goals (V1 explizit ausgeschlossen)

| Non-Goal | Begründung |
|----------|------------|
| Automatisches Lernen / adaptive Regelgewichtung | V1 loggt Ablehnungen; Auswertung & Parameter-Justierung manuell. Echtes Lernen = V2. |
| Mehrwochen-Periodisierung (Deload-Blöcke, Progressionsmesozyklen) | Scope ist laufende Woche + 48 h Überhang. ACWR wird berechnet, aber nicht als Blockplanung. |
| Zweiter Athlet ohne Code-Änderung (Onboarding-Flow für eigene Sportarten) | Datenmodell ist generisch, aber V1 liefert nur das Referenz-Preset. Konfig-UI = V2. |
| Automatische Plan-Anpassung ohne Bestätigung | Nur Vorschläge mit Annehmen/Ablehnen. |
| Ärztliche Hinweise / "Abklärung empfohlen"-Meldungen | Bewusst aus Scope (Haftung/Scope). App plant, diagnostiziert nicht. |
| Garmin Connect API (Push/OAuth) | Braucht Backend + Zulassung. Nur Datei-Import (FIT/TCX). |
| Garmin Recovery-Scores (Body Battery, Training Readiness, HRV) | Proprietäre Blackbox ohne offengelegte Methodik → verletzt Quellen-Anspruch. Ggf. V2 rein informativ. |
| Push-Benachrichtigungen als harte Abhängigkeit | Android-Badge/In-App-Hinweis reicht V1. Push optional. |
| Grifftyp-/Volumen-Tracking beim Bouldern | Bewusst simpel gehalten: Dauer + sRPE + optional 1 Toggle. |
| iOS-spezifische Optimierung | V1 zielt auf Android (Nutzergerät). Architektur bleibt web-standardkonform. |

### 1.4 Planungshorizont

- **Aktiv geplant:** laufende Kalenderwoche (Mo–So) plus rollierend die nächsten 48 h über den Sonntag hinaus.
- **Berechnet, nicht geplant:** ACWR-Fenster (7 Tage akut / 28 Tage chronisch) — Historie wird gehalten, aber nur als Regel-Input, nicht als Wochenstruktur über den Horizont hinaus.

---

## 2. Datenmodell

Persistenz: **IndexedDB** (via `idb`-Wrapper). Alle Stores lokal, JSON-Export für Backup.

### 2.1 Object Stores (Übersicht)

| Store | Zweck | Schlüssel |
|-------|-------|-----------|
| `profile` | Nutzerprofil, dauerhafte Constraints, Preset-Referenz | singleton |
| `sports` | Sportarten-Katalog inkl. Belastungsprofilen | `sportId` |
| `exercises` | Kraft-Übungskatalog (kuratiert + eigene) | `exerciseId` |
| `plannedSessions` | Geplante Einheiten der Woche (inkl. `fixed`-Flag) | `sessionId` |
| `sessionLogs` | Geloggte Einheiten (Ist-Belastung) | `logId` |
| `setLogs` | Sätze pro Kraftübung (Reps/Gewicht/RPE) | `setId` |
| `fatigueEntries` | Ermüdungs-Ampel pro Region (post-session + morgens) | `entryId` |
| `painEntries` | Schmerzeinträge (Region + NRS) | `painId` |
| `suggestions` | Erzeugte Umplanungsvorschläge + Nutzer-Feedback | `suggestionId` |
| `rules` | Regelkatalog (deklarativ, mit Quellen) | `ruleId` |
| `importBatches` | Garmin-Importprotokoll (Idempotenz) | `batchId` |

### 2.2 Körperregionen-Taxonomie (kanonisch)

Diese Liste ist die gemeinsame Referenz für Belastungsprofile, Ermüdungs-Ampel und Schmerz-Lokalisation.

| ID | Region | Ebene |
|----|--------|-------|
| `fingers` | Finger / Pulleys | obere Extremität |
| `forearm` | Unterarm (Beuger) | obere Extremität |
| `elbow` | Ellbogen | obere Extremität |
| `shoulder` | Schulter | obere Extremität |
| `chest` | Brust | Push |
| `triceps` | Trizeps | Push |
| `upper_back` | oberer Rücken / Lat | Rumpf/Zug |
| `lower_back` | unterer Rücken | Rumpf |
| `core` | Core | Rumpf |
| `quads` | Quadrizeps | untere Extremität |
| `posterior_chain` | hintere Kette (Ischios/Glutes) | untere Extremität |
| `calves` | Waden | untere Extremität |
| `knee` | Knie (Gelenk, nur Schmerz/Constraint) | Gelenk |
| `systemic` | zentrale/systemische Ermüdung | systemisch |

`knee` ist **keine** Muskelregion, sondern eine Gelenk-/Schmerz-/Constraint-Region — sie nimmt keine Ermüdungslast aus dem Load-Modell auf, aber Schmerz und Constraints (z. B. Flexionswinkel).

### 2.3 Skalen

| Zweck | Skala | Quelle/Begründung |
|-------|-------|-------------------|
| Ermüdung pro Region | Ampel: 🟢 frisch–leicht / 🟡 deutlich, braucht Pause / 🔴 extrem, dauert | Nutzerentscheidung; grobe Auflösung = schnelleres Logging, keine Scheingenauigkeit |
| sRPE (Gesamteinheit) | 0–10 (Borg CR-10, modifiziert nach Foster) | Foster et al. 2001, validiert |
| Schmerz | NRS 0–10 | Silbernagel Pain-Monitoring-Model |
| Constraint-Ampel | 🟢 frei / 🟡 alternative Übung / 🔴 Region gesperrt | Nutzerentscheidung |

### 2.4 Schema: `profile`

```
{
  presetId: "reference_athlete",
  goal: "sport_support",         // kraftaufbau | hypertrophie | erhalt | sport_support
  trainingDays: 3,               // Kraft-Tage pro Woche
  split: "PPL",                  // full_body | upper_lower | push_pull | PPL
  disabledUnits: ["pull"],       // abgewählte Einheiten des Splits
  constraints: [
    {
      id: "knee_flexion",
      region: "knee",
      level: "yellow",           // green | yellow | red
      rule: "avoid_loaded_flexion_80_90",
      note: "Linkes Knie, posterolateral, positionsabhängig ~80–90° Flexion"
    }
  ],
  slotBoundaries: {              // Slot + optionale Uhrzeit (Option B)
    morning: [6, 12],
    midday:  [12, 18],
    evening: [18, 24]
  }
}
```

### 2.5 Schema: `sports` (Belastungsprofil)

Jede Sportart trägt einen Regionen-Vektor `0–3` plus Flags. Die tatsächliche Session-Last skaliert dieses Profil (siehe §3.1).

```
{
  sportId: "bouldering",
  name: "Bouldering",
  frequency: "weekly",           // weekly | irregular
  loadProfile: {
    fingers: 3, forearm: 3, elbow: 2, shoulder: 2,
    upper_back: 2, core: 2, systemic: 2
  },
  flags: {
    tendonHeavy: true,           // längere Erholungskonstante (Pulley)
    eccentric: false
  },
  metrics: ["duration", "sRPE", "hardFingerLoad?"]  // hardFingerLoad = optionaler Toggle
}
```

Beispiel `mountain_day` (Bergtag):
```
loadProfile: { quads: 3, posterior_chain: 2, calves: 2, knee: 2, core: 1, systemic: 3 }
flags: { eccentric: true }       // Abstieg = exzentrische Quad-Last
metrics: ["duration", "elevationGain", "sRPE"]
```

### 2.6 Schema: `plannedSessions` / `sessionLogs`

```
plannedSession: {
  sessionId, sportId, date, slot: "evening", timeOptional: "17:00",
  fixed: true,                  // Boulderabend, Bergtag → Umplanung tabu
  intendedExercises: [exerciseId, ...],  // nur Kraft
  status: "planned"             // planned | logged | skipped | moved
}

sessionLog: {
  logId, plannedSessionId?, sportId, date, slot, timeOptional,
  duration_min, sRPE,           // → sRPE-TL = sRPE × duration
  hardFingerLoad?: true,        // nur Bouldern, optional
  source: "manual" | "garmin",
  garminActivityId?             // Idempotenz beim Import
}
```

### 2.7 Schema: `exercises`

```
{
  exerciseId: "romanian_deadlift",
  name: "Romanian Deadlift",     // Englisch (Nutzerentscheidung)
  equipment: ["barbell"],        // barbell | dumbbell (V1)
  category: "pull",              // push | pull | legs | core
  loadProfile: { posterior_chain: 3, lower_back: 2, forearm: 1 },
  kneeFlexionTag: "low",         // low | mid | deep  → Constraint-Logik
  custom: false
}
```

### 2.8 Schema: `fatigueEntries` / `painEntries`

```
fatigueEntry: {
  entryId, timestamp, region, level: "yellow",   // green | yellow | red
  context: "post_session" | "morning_checkin",
  sessionLogId?
}

painEntry: {
  entryId, timestamp, region, nrs: 4,            // 0–10
  linkedExerciseId?,             // optionaler 1-Tap-Bezug (für Ampel „andere Übung")
  linkedSessionLogId?
}
```

### 2.9 Schema: `suggestions`

```
{
  suggestionId, createdAt,
  operation: "move" | "reduce" | "remove",  // 3 Typen (konsolidiert)
  targetSessionId,
  proposedChange: { ... },       // z. B. { fromDate, toDate, fromSlot, toSlot }
  triggeredByRuleIds: [ruleId, ...],
  reasonShort: "UK-Kraft Mo → Mi: Quadrizeps 🟡 nach Bergtag (1150 hm), exzentrische Erholung 48–72 h",
  status: "open" | "accepted" | "rejected",
  feedback: { thumb: "up"|"down", reasonCode: "...", freeText?: "" }
}
```

---

## 3. Planungslogik & Load-Modell

### 3.1 Load-Quantifizierung

**Basis (validiert):** sRPE-TL = sRPE × Dauer (Foster et al. 2001). Diese Größe speist die ACWR-Berechnung und die systemische Ermüdung.

**Erweiterung (Annahme, gekennzeichnet):** Regionale Last pro Einheit:

```
regionLoad[r] = loadProfile[r] × (sRPE / 10) × (duration / 60)
```

> ⚠️ **Evidenzgrad: Annahme (assumption).** Foster validiert sRPE×Dauer als *globalen* internen Load. Die Aufschlüsselung auf Körperregionen über einen statischen Profil-Vektor ist eine transparente, aber **nicht validierte** Erweiterung. Im Code als `evidenceLevel: "assumption"` gekennzeichnet.

Flag `eccentric: true` verlängert die Erholungskonstante der betroffenen Regionen (siehe R4). Flag `tendonHeavy: true` (+ optional `hardFingerLoad`) verlängert die Erholung von `fingers` (siehe R3).

### 3.2 Prioritätshierarchie der Engine

Absteigend. Eine niedrigere Regel kann eine höhere nie überstimmen.

1. **Schmerz-Ampel** (R1) — kann alles vorschlagen zu ändern, außer Fixpunkte anzutasten (dann: Abschwächen statt Verschieben)
2. **Dauerhafte Constraints** (R2)
3. **Fixe Einheiten** — Termin unantastbar; Engine plant darum herum. **Fix schützt das Timing, nicht den Inhalt:** Abschwächen (`reduce`) und Anpassen (`swap`) sind auf fixen Einheiten erlaubt, Verschieben/Streichen nie
4. **Ermüdung / Erholung** (R3 Sehnen/Pulley, R4 exzentrisch, R5 muskulär)
5. **Interferenz Kraft/Ausdauer** (R6)
6. **ACWR-Wochensteuerung** (R7)

### 3.3 Umplanungs-Trigger

- **Post-Log automatisch:** nach jedem `sessionLog` + zugehörigen Ampel-/Schmerzeinträgen.
- **Morgen-Check-in:** optionaler 30-Sekunden-Flow (Ampel nur für Regionen mit Last in letzten 72 h).
- Vorschläge landen in einer **Inbox** (keine Unterbrechung).

### 3.4 Vorschlagstypen (4)

| Typ | Umfasst | Beispiel | Auf fixen Einheiten? |
|-----|---------|----------|----------------------|
| **Anpassen** (`swap`) | **Übungsebene:** betroffene Übungen einer Krafteinheit werden getauscht oder entfernt; Termin, Volumen und Rest bleiben | Full Body 42 h nach Bergtag: Back Squat raus, Bench/Row/Plank bleiben | **ja** |
| **Abschwächen** (`reduce`) | Volumen −30–50 % (Intensität halten); bei 🔴-Nähe zusätzlich Intensität; Limit- → Volumen-Bouldersession | Boulder als Volumen- statt Limit-Session (Finger müde) | ja |
| **Verschieben** (`move`) | Tag- und/oder Slot-Wechsel, inkl. Ringtausch zweier Einheiten | Beineinheit Mo → Mi (≥48 h nach Abstieg) | nein |
| **Streichen** (`remove`) | Einheit entfällt | Lauf entfällt (ACWR-Projektion > 1,5) | nein |

**Anpassen im Detail (`swapProposal`):** Betroffen = Übung lädt eine der Trigger-Regionen mit ≥ 2. Ersatzsuche: erst gleiche Kategorie, dann andere Kategorien der Unit; Kandidaten müssen die Trigger-Region < 2 laden **und** alle aktiven Constraints (R2) erfüllen; kein Ersatz gefunden → Einheit wird schlicht kürzer. **Aushöhl-Schutz:** Wären mehr als die Hälfte der Übungen betroffen (`drop > keep`), ist Tauschen unehrlich — dann Fallback auf `move`/`reduce`. Annahme setzt `adjusted: true` (verhindert erneutes Feuern) und die Karte zeigt Raus / Rein / Bleibt.

### 3.5 Engine-Verhalten

- **Rein reaktiv:** Vorschläge nur bei Regelverletzung, keine proaktive Optimierung (vermeidet Vorschlags-Müdigkeit, hält 👍/👎-Metrik sauber).
- **Minimaler Eingriff:** kleinste ausreichende Änderung wird bevorzugt — Rangfolge `swap` (0) < `reduce` (1) < `move` (2) < `remove` (3). Dedupe: pro Ziel-Einheit gewinnt der Vorschlag mit niedrigstem Tier, bei Gleichstand die mildeste Operation.
- **Idempotenz-Guards:** `reduced`-Einheiten erhalten kein weiteres `reduce`, `adjusted`-Einheiten kein weiteres `swap`; abgelehnte Vorschläge (Key = Regel|Ziel) werden dauerhaft unterdrückt (`rejected`-Store).
- **Keine Doppelzählung:** `logged`- und `skipped`-Einheiten verlassen `futurePlanned()` — sie zählen weder in die ACWR-Projektion (die reale Last steckt im Log) noch als Regel-Ziele.

### 3.6 Übungs-Machbarkeit (`exerciseReadiness`)

Zentrale Funktion der Planungsphase: Für **jede Übung** und einen **Zieltermin** liefert sie `fresh | caution | stop` **plus alle Gründe** (nicht nur den ersten). Gespeist aus denselben Signalen wie die Regeln:

| Signal | Fenster | Wirkung |
|--------|---------|---------|
| R2 Constraint (Region generisch) | zeitlos | rot: Load ≥ 2 → `stop`; gelb: Load ≥ 3 → `caution` |
| R2 Constraint (Knie) | zeitlos | rot: jede Knie-getaggte Übung → `stop`; gelb: `deep` → `stop`, `low/mid` → `caution` |
| R1 Schmerz | 36 h ab Eintrag | Load ≥ 2 auf Region: NRS > 5 → `stop`, NRS 3–5 → `caution` |
| R5 Ermüdung | müde 48 h / platt 72 h **relativ zum Zieltermin** | Load ≥ 2 auf Region: platt → `stop`, müde → `caution` |
| R4 Exzentrik | 48 h nach `eccentric`-Log | Bein-Load (quads/posterior_chain/calves) ≥ 3 → `stop`, = 2 → `caution` |

Verwendung: Session-Editor (Ampel je Übung + Gründe, live beim Tageswechsel), Log-Übungsschritt (Marker beim Abhaken), Generator (§5.5), Vorschau in den Einstellungen (●◆■-Marker).

---

## 4. Regelkatalog (mit Quellen & Evidenzgrad)

Jede Regel ist deklarativ in `rules` hinterlegt: `{ ruleId, tier, params, source, evidenceLevel, active }`. Evidenzgrade: `meta-analysis` > `rct` > `cohort` > `expert-consensus` > `assumption`.

### R1 — Schmerz-Ampel (Pain-Monitoring-Model)

| Feld | Wert |
|------|------|
| **Tier** | 1 (höchste Priorität) |
| **Logik** | NRS ≤ 2 → unbedenklich, keine Aktion. **Kraft-Einheiten: Übungsebene zuerst** — `swapProposal` tauscht die Übungen mit Load ≥ 2 auf der Schmerzregion aus dem Plan (NRS 3–5 und NRS > 5); greift der Aushöhl-Schutz (Mehrheit betroffen), Fallback: NRS 3–5 → Einheit abschwächen; NRS > 5 → streichen (nicht-fix) bzw. stark abschwächen (fix). Zusatzbedingung: Schmerz darf am Folgetag nicht über Ausgangsniveau steigen. |
| **Quelle** | Silbernagel KG, Thomeé R, Eriksson BI, Karlsson J. *Continued Sports Activity, Using a Pain-Monitoring Model, During Rehabilitation in Patients With Achilles Tendinopathy.* Am J Sports Med 2007;35(6):897–906. |
| **Evidenzgrad** | `rct` (Level 1, randomisiert) — Original an Achillessehne; Übertragung auf andere Strukturen ist verbreitete Praxis, aber extrapoliert → im Code-Kommentar vermerkt. |

> Das Modell erlaubt Training *mit* Schmerz ≤5/10 während der Aktivität, solange er danach nicht deutlich steigt und am Folgetag zum Ausgangswert zurückkehrt. Genau diese Drei-Punkt-Prüfung (während / danach / Folgetag) bildet die Ampel ab.

### R2 — Dauerhafte Constraints

| Feld | Wert |
|------|------|
| **Tier** | 2 |
| **Logik** | Pro `constraint`: 🟡 → Übungen mit passendem Tag durch Alternative ersetzen (z. B. `kneeFlexionTag: "deep"` meiden bei `knee_flexion`-Constraint); 🔴 → Region gar nicht belasten. |
| **Quelle** | Nutzerdefiniert (kein Literaturanspruch — es ist eine Nutzerpräferenz/-vorgabe). |
| **Evidenzgrad** | `expert-consensus` (Constraint-Mechanik), Constraint-Inhalt = Nutzervorgabe. |

### R3 — Sehnen-/Pulley-Erholung

| Feld | Wert |
|------|------|
| **Tier** | 4 |
| **Logik** | Nach Einheit mit `tendonHeavy: true` **und** `hardFingerLoad`: `fingers`-Region trägt verlängerte Erholungskonstante. Solange Erholung nicht abgeschlossen → keine zweite hohe Fingerlast vorschlagen (Boulder-Limit oder Kraft-Zug mit hoher Griffbelastung → abschwächen/verschieben). Faustwert V1: ≥ 48 h zwischen zwei hohen Fingerbelastungen; Sehnengewebe regeneriert langsamer als Muskel. |
| **Quelle** | Steven Low, *Rehabbing injured pulleys* (empirische Praxis, Physiotherapeut): Loading-Frequenz ~3×/Woche bzw. jeden 2. Tag, um Erholung zu ermöglichen. Ergänzend: Schöffl-Klassifikation / Pulley-Rehab-Literatur (theclimbingdoctor.com, Hooper's Beta). |
| **Evidenzgrad** | `expert-consensus` — es gibt **keine** validierte Studie zur exakten Erholungsdauer eines *gesunden* Pulleys zwischen Trainingsreizen. Der 48-h-Wert ist ein konservativer Praxis-Richtwert. **Explizit als niedrige Evidenz gekennzeichnet.** |

> Hinweis im Regelwerk-Screen: Pulley-Überlastung ist oft *nicht* als Ermüdung spürbar, bevor sie symptomatisch wird — deshalb ist der `hardFingerLoad`-Toggle der einzige verlässliche Input für diese Regel. Ohne ihn arbeitet R3 mit dem statischen Boulder-Profil und wird als noch unsicherer markiert.

### R4 — Exzentrische Ermüdung (post-Berg, DOMS)

| Feld | Wert |
|------|------|
| **Tier** | 4 |
| **Logik** | Nach Einheit mit `eccentric: true` (v. a. Bergtag-Abstieg): Regionen `quads`, `posterior_chain`, `calves` tragen Erholungsfenster **24–72 h**. Krafteinheit im Fenster: **erst `swapProposal`** (nur Bein-Loader ≥ 2 tauschen, Rest bleibt — typischer Fall Full Body); greift der Aushöhl-Schutz (reine Beineinheit): verschieben (nicht-fix) bzw. abschwächen (fix). Skalierung des Fensters mit Höhenmetern (hm aus Log; Log-Flow erfasst hm per Regler). |
| **Quelle** | Eston et al. 1995 (downhill running EIMD); Übersichten zu DOMS/EIMD: Physiopedia; ScienceDirect *Eccentric exercise: Muscle damage to the new normal* (2026). DOMS peakt 24–72 h, klingt in 5–7 Tagen ab. |
| **Evidenzgrad** | `cohort`/`expert-consensus` — Zeitverlauf des DOMS gut belegt; exakte Skalierung nach hm ist Annahme. |

> Repeated-Bout-Effekt: Wer regelmäßig Bergtage macht, hat abgeschwächtes DOMS. V1 modelliert das **nicht** dynamisch (wäre V2) — konservativ wird das volle Fenster angesetzt. Als Annahme gekennzeichnet.

### R5 — Muskuläre Erholung (allgemein)

| Feld | Wert |
|------|------|
| **Tier** | 4 |
| **Logik** | müde → 24–48 h reduzierte Wiederbelastung; platt → 48–72 h keine schwere Wiederbelastung. Kraft-Einheiten: **erst `swapProposal`** auf der Region (auch auf fixen Einheiten — Fix schützt Timing, nicht Inhalt); Fallback: platt → verschieben, müde → abschwächen. Ampel-Labels kanonisch: **frisch / müde / platt** (`FAT_LABELS`), UI erklärt die Konsequenz („müde → nächste Einheit lockerer · platt → Region erst mal raus"). |
| **Quelle** | Allgemeine Trainingsphysiologie (Muskelproteinsynthese-Fenster, DOMS-Verlauf). |
| **Evidenzgrad** | `expert-consensus`. |

### R6 — Interferenz Kraft/Ausdauer

| Feld | Wert |
|------|------|
| **Tier** | 5 |
| **Logik** | (a) Bei Kraft + Ausdauer am selben Tag: wenn Uhrzeit vorhanden, ≥ 6 h Abstand anstreben; sonst Slot-Trennung. (b) Kraft **vor** Ausdauer bevorzugen, wenn beide unvermeidbar in einer Session/Tag (Vorteil v. a. für Unterkörper-Maximalkraft). (c) Ausdauer-Frequenz für Beine hoch + gleichzeitig schwere Beinkraft → Interferenz-Hinweis. |
| **Quelle** | Hickson RC (1980), *Eur J Appl Physiol* 45:255–263 — Originalbefund Interferenz. Schumann M et al. (2022), *Sports Med* 52(3):601–612, doi:10.1007/s40279-021-01587-7 — aktualisierte Meta-Analyse (43 Studien): Interferenz für Maximalkraft/Hypertrophie gering, v. a. **explosive** Kraft bei gleicher Session leicht reduziert. *The Role of Intra-Session Exercise Sequence in the Interference Effect* (Systematic Review with Meta-Analysis, Sports Medicine) — Kraft-vor-Ausdauer leicht vorteilhaft für dynamische UK-Kraft über ≥5 Wochen. Die konkrete Ausdauer-Frequenz-Schwelle ist ein justierbarer Parameter (expert-consensus), kein zitierter Einzelwert. |
| **Evidenzgrad** | `meta-analysis` — aber mit ehrlicher Einordnung: Der Interferenzeffekt ist in aktuellen Meta-Analysen **schwächer als früher angenommen**. Die Regel ist daher niedrig priorisiert (Tier 5) und eher ein „nice to have"-Hinweis als ein harter Trigger. |

> Für den Referenz-Nutzer besonders relevant: Da Ziel = `sport_support` (nicht Maximal-Hypertrophie), ist Interferenz ohnehin unkritisch. Die Regel dient v. a. der sinnvollen Slot-Anordnung, nicht der Anpassungs-Maximierung.

### R7 — ACWR-Wochensteuerung

| Feld | Wert |
|------|------|
| **Tier** | 6 (niedrigste) |
| **Logik** | ACWR = akute Last (7 Tage, Summe sRPE-TL) ÷ chronische Last (28-Tage-Wochenmittel). Zonen: < 0,8 detraining; **0,8–1,3 Sweet Spot**; 1,3–1,5 erhöht; > 1,5 Warnung. Bei prognostiziertem Wochenende > 1,5: Vorschlag, eine **nicht-fixe** Zusatzbelastung (typisch Lauf) zu streichen/abzuschwächen. **V1: ausschließlich systemisch** (globales sRPE-TL, validierte Basis). Keine Bein-Achse — deren Load-Basis wäre die `assumption`-Aufschlüsselung aus §3.1, kombiniert mit einer methodisch umstrittenen Kennzahl. Bein-spezifische Steuerung übernehmen R4 (exzentrisch) und R5 (regionale Ampel). Bein-ACWR → V2. |
| **Quelle** | Gabbett TJ. *The training–injury prevention paradox.* Br J Sports Med 2016;50(5):273–280. IOC-Consensus 2016. |
| **Evidenzgrad** | `cohort` mit **dokumentierter Kritik**: mathematical coupling (Lolli et al. 2019), Sensitivitätsprobleme (Impellizzeri et al. 2020). Daher niedrigste Priorität, EWMA als V2-Option vermerkt. |

> Der Regelwerk-Screen zeigt die Kritik offen an: ACWR ist ein populäres, aber methodisch umstrittenes Werkzeug. V1 nutzt die einfache Rolling-Average-Variante; EWMA/REDI sind als genauere Alternativen für V2 dokumentiert.

### R8 — Split-Abdeckungsprüfung (Generator)

| Feld | Wert |
|------|------|
| **Tier** | Generator (nicht Umplanung) |
| **Logik** | Beim Abwählen einer Split-Einheit (z. B. Pull): prüfe, welche Regionen dadurch unversorgt bleiben und welche durch andere Sportarten abgedeckt sind. Bouldern deckt `upper_back`/`forearm`/`fingers` gut ab, horizontales Ziehen und hintere Schulter aber nur schwach → Hinweis „Lücke: hintere Schulter/horizontales Ziehen — 1–2 Übungen in Push einstreuen?". |
| **Quelle** | Schulter-Präventionsliteratur im Klettersport (antagonistisches Training, Rotatorenmanschette). |
| **Evidenzgrad** | `expert-consensus`. |

---

## 5. Plan-Generator (Krafttraining)

### 5.1 Eingaben

- Ziel (`goal`), Trainingstage/Woche, Split, abgewählte Einheiten, vorhandene Fixpunkte (Bouldern/Berg) und deren Belastungsprofile.
- **Optional:** aktuelle Datenlage (`db`) + Zieltermin (`when`) → aktiviert die readiness-aware Auswahl (§5.5). Signatur: `generateStrength(profile, db?, when?)` — ohne die optionalen Parameter identisches Verhalten wie v1.1 (rückwärtskompatibel).

### 5.2 Ausgabe

- Wochenstruktur (welche Krafteinheit an welchem Tag/Slot) **plus** konkrete Übungen je Einheit aus dem Katalog, mit Satz-/Wdh-Schema nach Ziel.

### 5.3 Zielprofile (Volumen/Intensität)

| Ziel | Fokus | Schema (Richtwert V1) |
|------|-------|-----------------------|
| Kraftaufbau | niedrige Wdh, hohe Last | 4–6 Sätze, 3–6 Wdh |
| Hypertrophie | mittlere Wdh | 3–4 Sätze, 8–12 Wdh |
| Erhalt | minimales effektives Volumen | 2–3 Sätze, 6–10 Wdh |
| **Sport-Support** (Default) | Stützkraft für Bouldern/Laufen, geringe Interferenz | 3 Sätze, 5–8 Wdh, Fokus Rumpf/Antagonisten/Beinstabilität |

### 5.4 Constraint-Integration (generisch)

Constraints sind **für jede Region** anlegbar (Settings: Region + gelb/rot; pro Region max. ein Eintrag, Anlegen ersetzt). Generator-Wirkung: **gelb** = Übungen mit Load ≥ 3 auf der Region fliegen aus dem Pool (Alternative wählen); **rot** = Load ≥ 2 fliegt (Region gesperrt). **Sonderfall Knie** nutzt zusätzlich die Beugetiefe: gelb schließt `deep` aus, rot alle Knie-getaggten Übungen. Auch die Ersatzsuche von `swapProposal` respektiert alle aktiven Constraints. R8 prüft die Abdeckung.

### 5.5 Readiness-aware Auswahl (Planungsphase)

Mit `db` + `when` filtert und sortiert der Generator den Pool per `exerciseReadiness` für den **Zieltermin**: `stop` fliegt komplett raus, `fresh` vor `caution`. Konsequenz: Wer im Bergtag-Fenster generiert, bekommt eine Beineinheit aus Core + moderaten Bein-Loadern; vier Tage später sind die klassischen Beinübungen automatisch wieder drin. Verwendet von „Plan neu generieren", der Vorschau in den Einstellungen und dem Hinzufügen-Flow (§6.5). **Semantik des Demo-Seeds:** die geseedete Woche wurde bewusst *vor* den jüngsten Ereignissen geplant („blind") — Pläne aus der Vergangenheit kennen die Gegenwart nicht; genau daraus entstehen die Vorschläge der Inbox.

---

## 6. UI-Flows

### 6.1 Home-Screen (Post-Session-Fokus)

Priorität liegt auf dem häufigsten Flow: abends nach dem Training loggen.

- **Oben:** Karte „Jetzt loggen" für die heute geplante(n) Einheit(en) → 1 Tap ins Logging.
- **Darunter:** Vorschlags-Inbox-Badge (Anzahl offener Vorschläge).
- **Dann:** Zugang zur Wochenansicht.
- **Beim ersten Öffnen des Tages:** dezenter Hinweis auf Morgen-Check-in (Android-Badge; kein Push-Zwang).

### 6.2 Post-Session-Log (Ziel < 60 s)

1. **Einheit bestätigen** (vorausgewählt) — mit zwei Auswegen: „Nicht gemacht – ausgefallen" (`status: skipped`, Engine bewertet sofort neu) und „Was anderes gemacht" (Sport-Picker → freie Session ohne Plan-Bezug) →
2. **Dauer + sRPE** — Maximaldauer und Schrittweite sportabhängig (Bergtag bis 720 min reine Gehzeit in 30-min-Schritten, ab 2 h Anzeige h:mm; Gravel 480; Laufen 300). **Bergtag zusätzlich: Höhenmeter-Regler** (±100, bis 3000) → `elevationGain` skaliert das R4-Fenster. **sRPE farbcodiert** mit Begriffs-Label: 1–3 locker (Teal) · 4–6 moderat (Akzent) · 7–8 hart (Amber) · 9–10 sehr hart/maximal (Rose) →
3. Kraft: Übungen abhaken (Schema aus Ziel), **je Übung Machbarkeits-Marker + Gründe** (§3.6); Bouldern: 1 Toggle „harte Fingerbelastung" →
4. Ermüdungs-Ampel **nur für belastete Regionen**, Labels frisch/müde/platt mit Konsequenz-Hinweis →
5. optional Schmerz — **Regionsliste sportabhängig** (Bouldern: Finger/Unterarm/Ellbogen/Schulter; Bergtag/Laufen: Knie/Quadrizeps/Waden/unterer Rücken; Kraft: aus den abgehakten Übungen abgeleitet + Knie) →
6. Speichern → Engine rechnet → ggf. neue Vorschläge in Inbox. **Navigation:** ‹-Zurück ab Schritt 2 (führt auch aus dem Sport-Picker zurück); Timer läuft sichtbar mit und färbt sich > 60 s um.

### 6.3 Morgen-Check-in (optional, ~30 s)

Ampel nur für Regionen mit Last in den letzten 72 h. Schmerz optional. Danach ggf. Vorschläge.

### 6.4 Vorschlags-Inbox (Wissenschaft prominent)

Pro Vorschlag eine Karte:

- **Operation + Kurzbegründung in einem Satz** (mit Ampel-Emoji und konkreten Zahlen).
- **Direkt sichtbar (nicht nur aufklappbar):** die auslösende(n) Regel(n) mit **Quelle und Evidenzgrad** — laut Nutzerentscheidung prominent.
- Buttons **Annehmen / Ablehnen**. Bei Ablehnen: Grund-Auswahl (3–4 vordefiniert: „fühle mich fit genug", „Termin fix", „nicht nachvollziehbar", „anderer Grund" + Freitext).
- Feedback 👍/👎 wird pro Vorschlag **und** pro auslösender Regel aggregiert (füttert §7).

### 6.5 Wochenansicht (Planungs-Zentrale)

- **Rollierendes 7-Tage-Raster ab heute** (nicht Kalender-Montag), 3 Slots/Tag mit Spaltenkopf (morgens 8 / mittags 12 / abends 18 Uhr), Einheiten als Karten (fix = 📌). Status in der Karte: `✓ geloggt`, `ausgefallen` (durchgestrichen), `gestrichen`, `reduziert`, `angepasst`.
- **Antippen = Session-Editor:** Tag (7 Chips), Slot, 📌-Fix-Schalter (mit Erklärung), „Streichen/Wiederherstellen". Für Kraft zusätzlich die **Übungsliste mit Machbarkeits-Ampel je Übung** („was geht [Tag]? (n/m frei)", alle Gründe sichtbar): ⇄ tauscht gegen eine für den Tag freie, constraint-konforme Alternative, ✕ entfernt, ＋ fügt hinzu (Auswahl nach Machbarkeit sortiert, ●◆■). Machbarkeit wird **für den gewählten Tag** berechnet — Tageswechsel aktualisiert die Ampeln live. Übungsänderungen setzen `adjusted`.
- **Leerer Slot antippen oder „＋ Einheit planen" = Hinzufügen-Flow:** Sport wählen, bei Kraft Unit des Splits; Übungen werden **readiness-aware für den gewählten Termin vorbefüllt** (§5.5) und sind editierbar. Speichern → Engine prüft sofort die Woche.
- **Drag & Drop (pointer-basiert, Touch + Maus):** Halten (~0,3 s) hebt die Karte ab (Ghost folgt), Ziel-Slot leuchtet; Drop auf leeren Slot = verschieben (Slot-Standardzeit), auf belegten Slot = **Tausch** beider Einheiten; geloggte Ziele werden abgelehnt; Bewegung > 10 px vor dem Abheben = Scrollen (Drag bricht ab). Nach jedem Drop: `recompute()` + Toast mit Vorschlagsstand. Kein natives HTML5-DnD (kein Touch-Support).
- Statuszeile „aktuell belastete Regionen" mit Ampel liegt auf dem Home-Screen (Heatmap = V2).

### 6.6 Regelwerk-Screen (Vertrauensanker)

Eigener Screen. Pro Regel: Parameter, Quelle (zitierfähig), Evidenzgrad, Aktiv-Status, und die persönliche 👍/👎-Statistik. Kritik-Hinweise (ACWR, Pulley-Evidenz) offen dargestellt.

### 6.7 Garmin-Import

- **Onboarding:** Garmin-Komplettexport (DSGVO-ZIP) → letzte ≥ 4 Wochen Lauf/Berg/Rad → chronische Last sofort verfügbar.
- **Laufend:** FIT/TCX per Drag & Drop → Aktivität erkannt (Typ/Dauer/hm) → landet als **Entwurf**, Nutzer ergänzt nur sRPE (~10 s) und bestätigt.
- **Idempotenz:** `garminActivityId` verhindert Doppelimport.
- Sprache UI: **Deutsch** (i18n-fähig). Übungsnamen: **Englisch**.

### 6.8 ACWR-Explainer (Erklärung am Ort der Nutzung)

Der ACWR-Chip auf Home ist antippbar (ⓘ) und öffnet ein Overlay mit den **Live-Zahlen** des Nutzers (Akut = Σ sRPE·min der letzten 7 Tage; Chronisch = Ø-Woche aus 28 Tagen; Ratio), den vier Zonen mit Ampel-Markern (< 0,8 untertrainiert · 0,8–1,3 Sweet Spot · 1,3–1,5 erhöht · > 1,5 deutlich erhöht), dem Hinweis auf das Sweet-Spot-Band in der Ridgeline, der Erläuterung des „Rampe nach Pause"-Falls und Quelle + offener Kritik (Gabbett 2016; Lolli 2019; Impellizzeri 2020). R7 prüft die **projizierte** Ratio am Horizontende.

---

## 7. Erfolgsmessung & Lern-Schleife (V1)

- **Primär:** 👍/👎 pro Vorschlag mit Grund (G3). Aggregiert pro Regel im Regelwerk-Screen.
- **Manuelle Lern-Schleife:** Nutzer sieht Ablehnungsgründe je Regel und kann Regel-Parameter justieren (kein Auto-Learning in V1).
- **Kein** Safety-Assessment, keine ärztlichen Hinweise.

---

## 8. Technische Leitplanken

| Aspekt | Entscheidung |
|--------|--------------|
| Architektur | PWA, offline-first, Single-Repo, kein Pflicht-Backend (V1) |
| Sprache | Vanilla JS (ES-Module), buildless |
| UI-Schicht | Optional Preact/HTM (~4 kB) für die zustandsreiche Wochen-/Inbox-Ansicht — Entscheidung nach UI-Flow-Review |
| Storage | IndexedDB via `idb`-Wrapper (Promise-basiert, Multi-Store-Transaktionen) |
| Regel-Engine | **Pure Functions** in eigenem Modul `rules/`, kein DOM-Zugriff, Unit-getestet (Vitest oder `node:test`) mit Literatur-Szenarien |
| Regeln | Deklarativ als JSON mit `source` + `evidenceLevel`; nicht hartcodiert |
| FIT-Parsing | Client-seitig (z. B. `fit-file-parser`, reine JS-Lib) |
| Export | JSON (Backup + spätere Auswertung) |
| i18n | UI Deutsch, Struktur i18n-fähig; Übungsnamen Englisch |
| Plattform | Android (Push optional; Fallback Badge/In-App-Hinweis) |

---

## 9. Abnahmekriterien (Given/When/Then)

**AC1 — Fixpunkte unantastbar (G4)**
- Given eine Einheit ist als `fixed` markiert (Boulderabend)
- When die Engine nach einem Log rechnet und Ermüdung/ACWR eine Änderung nahelegt
- Then wird **kein** Vorschlag erzeugt, der diese Einheit verschiebt oder streicht (max. Abschwächen, falls Schmerz die Region betrifft)

**AC2 — Schmerz-Priorität (G5)**
- Given ein Schmerzeintrag NRS > 5 für `fingers`
- When die Engine rechnet
- Then wird die betroffene Region für Belastung gesperrt und ein Vorschlag mit R1 als auslösender Regel erzeugt, unabhängig von allen niedrigeren Regeln

**AC3 — Post-Session-Log < 60 s (G1)**
- Given eine geplante Boulder-Einheit
- When der Nutzer den „Jetzt loggen"-Flow durchläuft (Dauer, sRPE, Ampel für belastete Regionen)
- Then ist der Log in unter 60 s abschließbar (max. 6 Ampel-Taps + 2 Felder)

**AC4 — Quellenpflicht (G2)**
- Given ein beliebiger erzeugter Vorschlag
- When er in der Inbox angezeigt wird
- Then sind auslösende Regel, Quelle und Evidenzgrad sichtbar; keine Regel ohne `source` + `evidenceLevel` ist aktiv

**AC5 — Exzentrisches Erholungsfenster (R4)**
- Given ein geloggter Bergtag mit `eccentric: true` und hohen hm am Samstag
- When für Montag eine schwere Unterkörper-Krafteinheit geplant ist (innerhalb 48 h)
- Then wird ein Verschiebe- oder Abschwäch-Vorschlag mit R4 (Quelle DOMS/EIMD) erzeugt

**AC6 — Constraint bei Übungsauswahl (R2)**
- Given aktiver `knee_flexion`-Constraint auf 🟡
- When der Generator eine Bein-Einheit erstellt
- Then enthält sie keine `kneeFlexionTag: "deep"`-Übung, sondern eine `low`/`mid`-Alternative

**AC7 — Split-Abdeckung (R8)**
- Given der Nutzer wählt die Pull-Einheit ab
- When der Generator den Plan erstellt
- Then wird ein Hinweis auf ungedeckte Regionen (hintere Schulter/horizontales Ziehen) angezeigt, mit optionalem Einstreu-Vorschlag

**AC8 — Feedback-Erfassung (G3)**
- Given ein Vorschlag in der Inbox
- When der Nutzer ihn ablehnt
- Then wird ein Grund (vordefiniert oder Freitext) erfasst und der auslösenden Regel zugeordnet

**AC9 — Garmin-Import als Entwurf**
- Given eine FIT-Datei eines Laufs wird importiert
- When der Import verarbeitet ist
- Then existiert ein Log-Entwurf mit Typ/Dauer/hm, der erst nach sRPE-Ergänzung und Bestätigung in die Load-Berechnung eingeht; ein erneuter Import derselben Aktivität erzeugt kein Duplikat

**AC10 — ACWR nur außerhalb der Fixpunkte**
- Given prognostizierte Wochen-ACWR > 1,5
- When die Engine einen Reduktionsvorschlag macht
- Then betrifft er eine nicht-fixe Einheit (typisch Lauf), nie den Bergtag oder Boulderabend

**AC11 — Anpassen statt Verschieben bei gemischter Einheit (Übungsebene)**
- Given ein Bergtag vor < 48 h und eine gemischte Full-Body-Einheit im Fenster (Bein-Anteil ≤ 50 %)
- When die Engine rechnet
- Then wird ein `swap`-Vorschlag erzeugt (nur Bein-Loader ≥ 2 raus, Ersatz lädt keine Bein-Region ≥ 2, Termin bleibt); eine **reine** Beineinheit erhält weiterhin `move` (Aushöhl-Schutz)

**AC12 — Schmerz plant Übungen raus (Planungsphase)**
- Given Schmerzeintrag NRS 3–5 auf einer Region und eine geplante Krafteinheit, in der eine Minderheit der Übungen die Region ≥ 2 lädt
- When die Engine rechnet
- Then erzeugt R1 einen `swap`-Vorschlag, der genau diese Übungen tauscht/entfernt; der Vorschlag benennt Raus/Rein/Bleibt

**AC13 — Machbarkeit ist datumsabhängig**
- Given Bergtag vor 30 h, Knie-Constraint gelb
- When `exerciseReadiness("back_squat", t)` für t = +12 h bzw. +4 Tage berechnet wird
- Then liefert +12 h `stop` mit Bergtag-Grund; +4 Tage entfällt der Bergtag-Grund, der Knie-Grund bleibt

**AC14 — Generator meidet Gesperrtes am Zieltermin**
- Given ein Zieltermin im Bergtag-Fenster
- When `generateStrength(profile, db, when)` läuft
- Then enthält keine generierte Einheit eine Übung mit Readiness `stop` am Zieltermin

**AC15 — Manuelle Planung mit sofortiger Prüfung**
- Given der Nutzer fügt per leerem Slot / ＋-Button eine Einheit hinzu oder verschiebt per Drag & Drop
- When er speichert bzw. fallen lässt
- Then läuft `recompute()` sofort; Drop auf belegten Slot tauscht beide Einheiten, Drop auf geloggte Ziele wird abgelehnt

**Normative Test-Suite:** Die 17 Szenario-Tests **T01–T17** im Test-Dashboard (`HybridAthlete_Test_Dashboard.html`) sind Bestandteil der Abnahme: jede Implementierung muss sie mit identischen Inputs/Expected-Werten bestehen (Wissenschafts-Gate, vor UI-Arbeit grün).

---

## 10. Offene Punkte — beschlossen

| # | Frage | Entscheidung | Konsequenz |
|---|-------|--------------|------------|
| O1 | `hardFingerLoad`-Toggle | **Aufnehmen (binär, optional).** sRPE ist kein valider Proxy für Maximal-Fingerlast. | R3 erhält validen Input; +1 Boolean im Boulder-Log |
| O2 | Preact/HTM | **Ja, Preact + HTM (buildless) für die gesamte UI-Schicht.** | Engine & Datenschicht bleiben UI-agnostisches Vanilla; Preact berührt nur Darstellung |
| O3 | Übungskatalog-Umfang | **~40 Übungen (Lang-/Kurzhantel).** Kriterium ist nicht die Anzahl, sondern: **jede trainierbare Region ≥ 2 Übungen über verschiedene Flexions-/Belastungs-Tags.** Rear-Delt-Übung (DB Rear Delt Fly / Band Pull-Apart / Chest-Supported Row) zwingend, damit R8 umsetzbar ist. | Constraint-Substitution (AC6) und R8 bekommen reale Ausweichziele; Seed-Katalog `exercises.seed.json` beiliegend |
| O4 | ACWR pro Achse | **Nur systemisch in V1.** Bein-Achse würde `assumption`-Decomposition × umstrittene Kennzahl multiplizieren. | ACWR bleibt auf validierter Foster-Basis; Bein-Steuerung via R4/R5; Bein-ACWR → V2 |
| O5 | Repeated-Bout-Abschwächung | **Konservativ: volles 24–72-h-Fenster in V1.** | Fehlerkosten asymmetrisch (falsche Warnung billig, verpasste teuer); selbstkorrigierend über die 👍/👎-Feedback-Schleife, die V2-RBE-Modellierung kalibriert |

---

## 11. V2-Parkplatz (bewusst dokumentiert)

- Onboarding-Flow für zweiten Athleten (eigene Sportarten/Constraints/Fixpunkte)
- Automatisches Regel-Lernen (Gewichtung nach 👍/👎)
- Mehrwochen-Periodisierung / Deload-Blöcke
- EWMA/REDI statt Rolling-Average-ACWR
- Regionen-Heatmap in der Wochenansicht
- Abschwäch-Auswahl (Sätze vs. Gewicht) pro Vorschlag
- Sätze/Wdh/Gewicht-Erfassung pro Übung im Log (V1: Abhaken + Schema aus Ziel)
- Exaktes Ziel-Datum bei `move`-Vorschlägen wählbar (V1: pauschal +2 Tage)
- Garmin Recovery-Scores rein informativ
- Grifftyp-/Volumen-Tracking Bouldern
- Repeated-Bout-Modellierung (dynamisches DOMS-Fenster)
- Kabelzug-/Maschinen-Übungen im Katalog



---

## 12. CI / Design-Tokens (HybridAthlete)

**These:** athletisches Präzisions-Instrument — Race-Brand-Energie (HYROX-/Functional-Szene) statt Soft-App. Referenz-Implementierung: `:root`-Block im Prototyp.

| Token | Wert | Zweck |
|-------|------|-------|
| `--bg` / Surfaces | `#0E1320` / `#151B2B` / `#1B2333` / `#222C40` | Dark-first, tiefes Ink-Blau (kein reines Schwarz) |
| `--brand` (Volt) | `#C8F542` (`-hi #D9FF6B`) | Interaktion/CTA; schwarzer Text auf Volt |
| Ampel | frisch Teal `#34D6A6` ● · müde Amber `#F2B84B` ◆ · platt Rose `#FF6188` ■ | **unverändert & redundant kodiert** (Farbe + Form + Label) — rot-grün-sicher. Bewusster Trade-off: Volt und Teal sind beide grünlich → Formen tragen die Unterscheidung mit |
| Typo | Archivo Black (Display/Wordmark, uppercase) · Barlow (Text) · JetBrains Mono (Messwerte: sRPE, ACWR, Timer) | athletisch + „Instrument-Readout" |
| Radien | 7 / 11 / 14 px | kantiger als v1 (22 px) — Race-Brand |
| Wordmark | **HYBRID**ATHLETE (ATHLETE in Volt) · Glyph: zwei Hantelscheiben + Pulslinie | Kraft × Ausdauer in einem Zeichen |
| Signature | Wochenlast als **Ridgeline** (Höhenprofil, Gradient Volt→Teal) mit ACWR-Sweet-Spot-Band | datentragend, nicht dekorativ |
| sRPE-Farbcode | locker Teal · moderat Volt-hi · hart Amber · sehr hart/maximal Rose | Anstrengung fühlbar machen |

Offline-Hinweis: Fonts im echten Build **selbst hosten** (Prototyp lädt Google Fonts per CDN).

---

## 13. Changelog

**v2.0** (nach Feedback-Runden am funktionalen Prototyp)
- Vierte Operation **Anpassen** (`swap`) auf Übungsebene: R1/R4/R5 tauschen betroffene Übungen statt ganze Einheiten anzufassen; Aushöhl-Schutz; auf fixen Einheiten erlaubt (Fix schützt Timing, nicht Inhalt); Rangfolge minimaler Intervention swap < reduce < move < remove
- **`exerciseReadiness`** (§3.6): datumsabhängige Machbarkeit je Übung mit allen Gründen; genutzt in Editor, Log, Generator, Vorschau
- Generator **readiness-aware** (§5.5, optionale Parameter `db`, `when`); Constraints **generisch für alle Regionen** (§5.4)
- Wochenansicht = Planungs-Zentrale: Session-Editor (Tag/Slot/Fix/Übungen), **Hinzufügen-Flow** (leerer Slot/＋), **Drag & Drop** mit Tausch (§6.5)
- Log-Flow: Auswege im Bestätigungs-Schritt (`skipped`, freie Session), sportabhängige Maximaldauer + **hm-Regler** (Bergtag → R4-Skalierung), sportabhängige Schmerzregionen, **sRPE-Farbcode**, ‹-Zurück
- Ampel-Labels kanonisch **frisch/müde/platt**; Statusmodell `logged/skipped` ohne Doppelzählung; Ablehnungs-Persistenz
- **ACWR-Explainer** am Chip (§6.8); Toast mit echtem Hidden-Zustand
- Rebranding **HybridAthlete** (§12); 17 normative Szenario-Tests T01–T17 (§9)

**v1.1** — O1–O5 beschlossen. **v1.0** — Erstfassung nach Anforderungsklärung.
