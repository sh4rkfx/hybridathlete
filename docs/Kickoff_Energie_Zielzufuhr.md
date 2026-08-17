# Kick-Off: Adaptives Energie- und Zielzufuhr-Modul

## Kontext

Wir bauen ein Feature, das den realen Energieumsatz einer Person **misst** statt ihn zu
schätzen, und daraus eine tägliche Zielzufuhr ableitet. Die Messung entsteht aus dem
Abgleich von getrackter Zufuhr und tatsächlichem Gewichtsverlauf.

**Zielumgebung:** Vanilla JS (ES2022, Module), IndexedDB, offline-first PWA.
Keine Build-Pipeline, keine Runtime-Dependencies, **kein Backend**.

Es existiert ein Python-Referenzprototyp, der die Kernrechnung validiert (synthetische
Rückgewinnung eines bekannten TDEE mit 0,4 % Abweichung). Er ist Spezifikation, nicht
Vorlage — die Zielarchitektur ist eine andere und die Konfigurierbarkeit geht weiter.

## Die drei Kernideen

### 1. Kalibrierung statt Schätzung

```
TDEE_real = Ø Zufuhr − (Gewichtstrend_kg_pro_Tag × Energiedichte)
Faktor    = TDEE_real ÷ Ø Umsatzschätzung der Datenquelle
```

Der Gewichtstrend kommt aus einer Regression über das gesamte Fenster, nie aus der
Differenz erster/letzter Wert — tägliche Wasserschwankungen von ±0,5 kg würden das
Ergebnis sonst um mehrere hundert kcal verschieben.

Der Faktor wird ausschließlich auf den **Gesamtumsatz** angewendet. Wearables verschieben
die Aufteilung zwischen Ruhe- und Aktivumsatz systematisch (real gemessen: Ruheumsatz
19 % über dem Formelwert, was einen rechnerisch unmöglichen PAL ergibt). Die Summe
stimmt, die Aufteilung nicht.

### 2. Basiszufuhr plus volle Kompensation

Trainingsumfang lässt sich nicht vorhersagen. Reale Streuung derselben Aktivität bei
einer Person: Krafttraining 40 %, Bouldern 32 %, Bergtouren Faktor 7 zwischen kürzester
und längster Einheit. Deshalb wird **nicht geplant, sondern nachgerechnet**:

| Topf | Wann festgelegt | Zählt ins Defizit? |
|---|---|---|
| Basiszufuhr | morgens, konstant = Ruhetag-TDEE − Phasendefizit | ja |
| Kompensation | nach der Einheit, aus Ist-Daten | nein |
| Wochenausgleich | am Folgetag, max. ±250 kcal | ja |

Die Kompensation beträgt **100 %** der gemessenen Trainingsenergie × Kalibrierungsfaktor.
Grund: Volle Kompensation hält die Energieverfügbarkeit (EA) über alle Tage konstant.
Jede unvollständige Kompensation erzeugt an Trainingstagen ein verstecktes Zusatzdefizit
— genau an den Tagen, an denen Muskelerhalt am meisten auf dem Spiel steht.

Belege dafür: Torstveit et al. fanden bei gleicher 24-h-Bilanz deutlich mehr Zeit in
Defiziten > 400 kcal bei Athleten mit unterdrücktem Ruheumsatz, verbunden mit höheren
Cortisolwerten. Ein systematisches Review (Murlasits et al. 2025) kommt zum selben
Schluss und empfiehlt, die Zufuhr dem Bedarf zeitlich folgen zu lassen.

### 3. Umverteilung statt Vorschuss

Vor einer Einheit werden **150 kcal aus der Basiszufuhr vorgezogen** (nicht addiert).
Fällt die Einheit aus, hat der Nutzer trotzdem nur seine Basis gegessen — das
Überessen-Risiko ist strukturell null, nicht nur statistisch klein.

## Nicht-Ziele

- Kein Wearable-Hersteller fest verdrahtet
- Keine Ernährungsdatenbank, kein Barcode-Scanner, keine Lebensmittelsuche
- Keine medizinischen oder trainingswissenschaftlichen Entscheidungen für den Nutzer
- Keine Serverkomponente, kein API-Key, kein CORS-Proxy in v1

## Architektur

```
domain/       reine Funktionen, keine IO, keine Globals
  energy.js       BMR-Formeln, TEF aus Makros, TDEE-Zusammensetzung
  trend.js        Regression, EMA, Ausreißererkennung
  calibration.js  Faktorbestimmung, Konfidenz
  targets.js      Phasen, Defizit, Makros, Sicherheitsgrenzen
  ledger.js       Wochenkonto, Soll/Ist-Abgleich
  availability.js Energieverfügbarkeit
  flags.js        Warnsystem
  config.js       Defaults, Validierung, Migration

adapters/
  DataSourceAdapter.js    Interface für Umsatzdaten
  IntakeAdapter.js        Interface für Zufuhrdaten
  ManualAdapter.js        v1: Nutzer trägt ein
  FormulaAdapter.js       v1: BMR × PAL, wenn kein Wearable
  FileImportAdapter.js    v1: CSV/JSON mit Spalten-Mapping

storage/
  schema.js, repository.js, migrations.js
```

`domain/` importiert **nichts** aus `adapters/` oder `storage/`. Bitte per Test absichern.

### Adapter-Interfaces

```js
/**
 * @typedef {Object} DayMetrics
 * @property {string} date
 * @property {number|null} totalKcal      geschätzter Tagesgesamtumsatz
 * @property {number|null} exerciseKcal   Energie geplanter Einheiten
 * @property {number|null} exerciseMinutes
 * @property {number|null} steps
 * @property {number|null} restingHr
 * @property {number|null} weightKg
 * @property {number|null} bodyFatPct
 * @property {'measured'|'estimated'|'interpolated'} quality
 */

class DataSourceAdapter {
  get id() {}
  get capabilities() {}   // { totalKcal, exerciseKcal, steps, restingHr, weight, bodyFat, includesTef }
  async fetchRange(startDate, endDate) {}
  async isAvailable() {}
}

/**
 * @typedef {Object} IntakeEntry
 * @property {string} date
 * @property {number|null} kcal
 * @property {number|null} proteinG
 * @property {number|null} fatG
 * @property {number|null} carbsG
 * @property {number|null} fiberG
 * @property {number|null} alcoholG
 */

class IntakeAdapter {
  get id() {}
  get capabilities() {}   // { kcal, protein, fat, carbs, fiber, alcohol }
  async fetchRange(startDate, endDate) {}
}
```

`includesTef` ist wichtig: PAL-basierte Schätzungen enthalten die Thermogenese bereits,
Wearable-Werte nicht. Doppelzählung von ~240 kcal wäre sonst der häufigste Fehler.

## Konfigurationsschema

Versioniert, serialisierbar, alle Werte mit Defaults. Eine leere Config muss laufen.

```js
{
  schemaVersion: 1,
  locale: 'de-AT',
  units: { mass: 'kg', height: 'cm', energy: 'kcal' },  // Anzeige; intern immer SI

  profile: {
    birthDate: '1988-06-16',
    sex: 'male',                       // 'male' | 'female' | 'unspecified'
    heightCm: 173,
    bodyComp: { mode: 'bodyFatPct', value: 27.9 }
    // mode: 'ffm' | 'bodyFatPct' | 'none'
    // bei 'none' sind Katch und Cunningham nicht verfügbar
  },

  goal: {
    mode: 'cut',                       // 'cut' | 'maintain' | 'gain'
    target: { type: 'weight', valueKg: 75 }
    // type: 'weight' | 'bodyFatPct' | 'ffm' — intern auf Zielgewicht normalisieren
  },

  phases: {
    auto: true,
    manual: [
      { name: 'Phase 1', untilWeightKg: 82, ratePctBwPerWeek: 0.50 },
      { name: 'Phase 2', untilWeightKg: 78, ratePctBwPerWeek: 0.40 },
      { name: 'Phase 3', untilWeightKg: 75, ratePctBwPerWeek: 0.30 }
    ]
  },

  energy: {
    bmrFormula: 'median',              // median = Mifflin + Owen + Katch
    // einzeln wählbar: 'mifflin' | 'owen' | 'katch' | 'custom'
    // 'harris' und 'cunningham' nur explizit, mit Warnhinweis — beide überschätzen
    // systematisch (Harris 1918, Cunningham auf Leistungssportler kalibriert)
    customBmrKcal: null,
    palFactor: 1.55,                   // nur FormulaAdapter
    adapterId: 'manual'
  },

  intake: {
    entryMode: 'auto',                 // 'kcal' | 'macros' | 'auto'
    requireProtein: true,              // warnt, blockt nicht
    atwater: { protein: 4, carbs: 4, fat: 9, alcohol: 7, fiber: 2 },
    // fiber: 2 = EU-Kennzeichnung, 4 = US. Bei 35 g/Tag sind das 70 kcal Unterschied.
    fiberInCarbs: true,
    reconciliation: { preferDerivedWhenComplete: true, mismatchTolerancePct: 5 }
  },

  calibration: {
    enabled: true,
    windowDays: 21,
    minDays: 14,
    trendMethod: 'linreg',             // 'linreg' | 'ema'
    emaHalfLifeDays: 7,
    energyDensityKcalPerKg: 7700,
    factorClamp: [0.70, 1.30],
    outlier: { method: 'mad', threshold: 3 },
    recalibrateEveryDays: 56,
    cycleAwareSmoothing: false         // erzwingt 28-Tage-Fenster
  },

  compensation: {
    rule: 'full',                      // 'full' | 'partial' | 'none'
    partialFraction: 0.6,              // nur bei 'partial'
    preSessionRedistributionKcal: 150, // aus der Basis vorgezogen, nicht addiert
    intraSessionCarbsGPerHour: 40,     // ab Stunde 2 bei Einheiten > 90 min
    roundingDirection: 'down',
    roundingStepKcal: 50,
    noDeficitAboveActiveKcal: 800
  },

  ledger: {
    enabled: true,
    windowDays: 7,                     // rollierend, nicht Kalenderwoche
    maxDailyCorrectionKcal: 250,
    capKcal: 1200,
    surplusExpiresAfterDays: 14
  },

  macros: {
    protein: { basis: 'ffm', value: 2.4, minGPerKgBw: 1.6 },
    fat:     { basis: 'bodyweight', value: 0.8, minG: 50 },
    carbs:   { mode: 'remainder', minG: 50 },
    cycling: { enabled: false, swingKcal: 180,
               trainingDayRule: { type: 'activeKcalThreshold', value: 500 } },
    fiberGPer1000Kcal: 14
  },

  safety: {
    intakeFloor: { bmrMultiple: 1.1, hardFloorBmrMultiple: 1.0 },
    maxRate: { mode: 'bodyFatAware', fallbackPctBwPerWeek: 0.7 },
    maxDeficit: { mode: 'fatMassAware', kcalPerKgFatMass: 30, absoluteCapKcal: 1200 },
    maxSurplusKcal: 500,
    dietBreak: { auto: true, everyWeeks: 10, durationWeeks: 2 }
  },

  history: {
    windowDays: 180,                   // für Quantile und Verteilungsvergleiche
    minSessionMinutes: 20,             // Fehlstarts fliegen raus
    deviceEras: [
      { from: '2024-01-01', to: null, label: 'Fenix 7' }
    ],
    trainingContext: {
      defaultLabel: 'normal',
      periods: [ { from: '2026-03-01', to: null, label: 'rehab', representative: false } ]
    }
  },

  flags: {
    rhrBaseline: 'auto',               // Median der ersten 28 Tage
    rhrHighDelta: 4,
    rhrLowDelta: -4,
    plateauDays: 21,
    trackingCoverageMin: 5,            // von 7
    proteinMinGPerKgFfm: 2.0,
    eaLowThreshold: 30,                // kcal/kg FFM
    eaBodyFatAware: true
  }
}
```

### Regeln zum Schema

- `safety.*` sind Hardcaps. Der Nutzer darf konservativer setzen, nie aggressiver.
  Validierung muss das erzwingen und einen erklärenden Fehler werfen.
- `units` betrifft nur Ein- und Ausgabe. Rechnung immer in kg/cm/kcal.
- Unbekannte Felder beim Laden nicht verwerfen (Vorwärtskompatibilität).
- `config.js` exportiert `validate(config) → { valid, errors[], normalized }`.
- Kontextlabels sind **Datenmetadaten**, keine Auslöser für veränderte Empfehlungen.
  `representative: false` schließt einen Zeitraum aus Statistiken aus — mehr nicht.

## Funktionale Anforderungen

### Zufuhr

1. Kalorien sind das einzige Pflichtfeld — direkt eingegeben oder aus Makros ableitbar.
2. Ableitung über Atwater-Faktoren, Ballaststoffe je nach Locale.
3. Bei vollständigen Makros gewinnt der abgeleitete Wert. Bei unvollständigen die
   eingegebenen Kalorien. Bei Abweichung > Toleranz beide behalten und flaggen.
4. Letzter Wert als Vorbelegung im Eingabefeld — Tracking-Lücken sind der häufigste
   Grund, warum die Kalibrierung scheitert.

### TEF

Aus Makros berechnen, nicht schätzen: Protein 25 %, Kohlenhydrate 8 %, Fett 2 %.
Fallback 10 % der Zufuhr, wenn keine Makros vorliegen. Nicht addieren, wenn
`capabilities.includesTef === true`.

### Kalibrierung

1. Ab `minDays` einen Faktor liefern, darunter `null`.
2. Konfidenz `low` / `medium` / `high` aus Tagesanzahl, Lücken und Plausibilität.
3. Faktor außerhalb `factorClamp` → clampen **und** flaggen. Häufigste Ursache ist
   systematisches Untertracking, nicht ein ungewöhnlicher Stoffwechsel.
4. Rollierend für 7 und 28 Tage parallel ausgeben.
5. Nie über eine `deviceEra`-Grenze hinweg rechnen. Bei Gerätewechsel verwerfen,
   nicht fortschreiben. Geräteübergreifende Korrekturfaktoren **nicht** anbieten —
   der Bias ist aktivitätsabhängig (real gemessen: +34 % Krafttraining, −22 % Gehen
   zwischen zwei Geräten) und nicht sauber abbildbar.

### Zielberechnung

1. Basiszufuhr = Ruhetag-TDEE − Phasendefizit. Ruhetag-TDEE ist der Median der Tage
   ohne Einheit im Statistikfenster.
2. Sicherheitsboden anwenden, danach Defizit **neu** aus der tatsächlichen Zufuhr
   zurückrechnen — sonst zeigt die App ein Defizit an, das nicht gilt.
3. `maxDeficit` im Modus `fatMassAware`: 30 kcal je kg Fettmasse. Physiologisch
   begründet — Fettgewebe kann pro Tag nur begrenzt Energie freisetzen, darüber holt
   der Körper Muskelprotein.
4. `maxRate` im Modus `bodyFatAware`:

   | Körperfett m/w | max %/Woche |
   |---|---|
   | > 30 % / > 40 % | 1,2 |
   | 20–30 % / 30–40 % | 1,0 |
   | 12–20 % / 22–30 % | 0,7 |
   | < 12 % / < 22 % | 0,5 |

5. Makros: Protein und Fett zuerst, Kohlenhydrate als Rest. Unterschreitet der Rest
   `carbs.minG`, erst Fett bis `fat.minG` reduzieren, dann Protein bis
   `protein.minGPerKgBw`, dann Fehler.
6. `gain`: identische Logik mit umgekehrtem Vorzeichen, `maxSurplusKcal` greift.

### Wochenkonto

Zweistufig — morgens Plan, abends Ist:

```
Morgens   → Basiszufuhr, ggf. korrigiert um Kontostand (max ±250 kcal)
Tagsüber  → Umverteilung 150 kcal vor der Einheit; bei > 90 min zusätzlich
            intraSessionCarbsGPerHour ab Stunde 2
Abends    → Ist-TDEE aus Adapter → Ist-Defizit → Differenz aufs Konto
```

Asymmetrie-Prinzip, damit Fehler immer in dieselbe Richtung fallen:

| Regel | Wirkung |
|---|---|
| Kompensation auf 50 kcal **abrunden** | systematisch leicht unterkompensiert |
| Überschuss nachholen, Defizit verfallen lassen | kein Nachessen von „Guthaben" |
| Fehlende Umsatzdaten → Kompensation 0 | keine Schätzung, keine Annahme |

### Energieverfügbarkeit

Erstklassige Kennzahl, pro Tag berechnet und gespeichert:

```
EA = (Zufuhr − Trainingsenergie) ÷ FFM       [kcal/kg FFM]
```

Schwelle 30 kcal/kg FFM. **Bewusste Abweichung von der Literatur:** Bei
`eaBodyFatAware: true` wird die Schwelle mit steigendem Körperfettanteil abgesenkt.
Die EA-Grenzwerte stammen aus schlanken Athletenkollektiven; bei 28 % Körperfett steht
reichlich endogene Energie zur Verfügung. Diese Anpassung ist nicht durch Studien
gedeckt, sondern physiologisch plausibel — bitte im Code als solche kommentieren.

### Warnsystem

| Code | Auslöser | Level |
|---|---|---|
| `RHR_ELEVATED` | Ruhepuls ≥ Baseline + `rhrHighDelta` über 7 Tage | warn |
| `RHR_SUPPRESSED` | Ruhepuls ≤ Baseline + `rhrLowDelta` über 21 Tage | stop |
| `PLATEAU` | Gewichtstrend ≈ 0 über `plateauDays` | warn |
| `RATE_TOO_FAST` | Verlust über `maxRate` | warn |
| `PROTEIN_LOW` | Ø Protein < `proteinMinGPerKgFfm` | warn |
| `PROTEIN_NOT_TRACKED` | kcal vorhanden, Protein fehlt an > 3 von 7 Tagen | info |
| `MACRO_KCAL_MISMATCH` | Abweichung eingegeben vs. abgeleitet > Toleranz | warn |
| `TRACKING_GAP` | < `trackingCoverageMin` von 7 Tagen | info |
| `FACTOR_CLAMPED` | Faktor außerhalb Clamp | warn |
| `EA_LOW` | EA < Schwelle an ≥ 5 von 7 Tagen | warn |
| `EA_CRITICAL` | EA < Schwelle − 5 an ≥ 3 Tagen in Folge | stop |
| `LEDGER_SATURATED` | Kontodeckel erreicht | info |
| `DIET_BREAK_DUE` | `everyWeeks` seit letzter Pause | info |
| `RECALIBRATION_DUE` | `recalibrateEveryDays` überschritten | info |
| `SOURCE_DEGRADED` | Adapter liefert < 80 % der Tage | warn |
| `DEVICE_CHANGE_DETECTED` | Median-Sprung > 15 % bei gleicher Aktivität und Puls | warn |
| `DISTRIBUTION_SHIFT` | Median weicht > 20 % vom Vorjahresfenster ab | info |
| `NON_REPRESENTATIVE_DATA` | > 30 % des Fensters als nicht repräsentativ markiert | info |

Jedes Flag trägt `{ level, code, message, since, suggestedAction }`. Messages gehören
in eine Locale-Datei, nicht in die Domain-Logik.

## Persistenz

| Store | Keypath | Inhalt |
|---|---|---|
| `days` | `date` | DayMetrics + IntakeEntry + Gewicht + KFA |
| `config` | `id` | Konfiguration, versioniert |
| `calibrations` | `computedAt` | Faktor-Historie für Trendanzeige |
| `ledger` | `date` | Soll, Ist, Saldo |
| `phases` | `startedAt` | tatsächlicher Verlauf inkl. Diätpausen |

Berechnete Werte (Ziel, Faktor, Flags, EA) **nicht** persistieren, sondern beim Laden
neu rechnen. Die Domain-Funktionen sind schnell genug, und eine korrigierte Formel
liefert so rückwirkend saubere Ergebnisse.

## Seed-Profil für Entwicklung und Tests

Echte Werte aus 825 gemessenen Tagen, als Fixture verwendbar:

| Parameter | Wert | Herkunft |
|---|---|---|
| Alter / Größe | 38 / 173,0 cm | Profil |
| Gewicht / KFA | 89,5 kg / 27,9 % | BIA-Waage |
| FFM | 64,5 kg | abgeleitet |
| BMR (Median) | 1.790 kcal | Mifflin 1.791, Owen 1.792, Katch 1.763 |
| TDEE Ø | 2.601 kcal | 180 Tage gemessen |
| **Ruhetag-TDEE** | **2.334 kcal** | 116 Tage ohne Einheit |
| Trainingstag 60–120 min | 2.803 kcal | 52 Tage |
| Trainingstag > 120 min | 3.127 kcal | 34 Tage |
| Ruhepuls-Baseline | 52,7 bpm | 180 Tage |
| Faktor (vorläufig) | 0,95 | Plausibilitätsgrenze aus Gewichtsverlauf |
| Basiszufuhr Phase 1 | 1.850 kcal | Ruhetag − 484 |

Regression aus denselben Daten, brauchbar als Plausibilitätscheck:

```
Aktivkalorien = 30 + 4,27 × Trainingsminuten + 0,0308 × Schritte     R² = 0,827
```

## Tests

Pflicht, bevor irgendeine UI entsteht:

1. **Synthetische Rückgewinnung.** Bekannter wahrer TDEE, verrauschtes Gewicht
   (σ = 0,35 kg), schwankende Zufuhr (σ = 110 kcal), 30 Tage. Muss auf < 3 % genau
   wiedergefunden werden. Mehrere Seeds.
2. **Wochenkonto.** Woche mit einer unerwartet langen Einheit muss das Wochendefizit
   treffen, ohne an einem Tag `maxDailyCorrectionKcal` zu überschreiten.
3. **Energieverfügbarkeit.** Volle Kompensation muss EA über Ruhe- und Trainingstage
   konstant halten (± 1 kcal/kg FFM).
4. **Zufuhr-Ableitung.** kcal aus Makros, Ballaststoffe 2 vs. 4, Alkohol,
   Mismatch-Erkennung, unvollständige Makros.
5. **Grenzfälle:** Zielgewicht erreicht, Kalorienboden greift, Makros gehen nicht auf,
   `bodyComp.mode: 'none'`, Adapter ohne `totalKcal`, 0/1 Tag Daten, Lücken mitten im
   Fenster, Gewichtszunahme im Cut, Ära-Grenze im Fenster.
6. **Flag-Matrix:** jedes Flag löst in seinem Szenario aus und in keinem anderen.
7. **Einheiten:** lb/in muss bis auf Rundung dasselbe liefern wie kg/cm.
8. **Schichtentrennung:** Test schlägt fehl, wenn `domain/` aus `adapters/` oder
   `storage/` importiert.
9. **Config-Migration:** v1 lädt, unbekannte Felder überleben einen Roundtrip.

## Vorgehen

In dieser Reihenfolge, mit Zwischenstopp nach jedem Schritt:

1. `config.js` — Schema, Defaults, Validierung, plus Tests
2. `energy.js`, `trend.js` — BMR, TEF aus Makros, Regression, plus Tests
3. `calibration.js` — plus synthetische Rückgewinnung
4. `targets.js`, `availability.js` — plus Grenzfälle
5. `ledger.js` — plus Wochenkonto-Szenarien
6. `flags.js` — plus Flag-Matrix
7. Adapter-Interfaces, `ManualAdapter`, `FormulaAdapter`, `FileImportAdapter`
8. IndexedDB-Schicht mit Migration
9. Erst danach UI

## UI-Hinweise für Schritt 9

Die Eingabemaske ist der Punkt, an dem das Feature scheitert oder funktioniert.

| Feld | Sichtbarkeit |
|---|---|
| Gewicht, Kalorien, Protein | immer |
| Körperfett | immer, optional |
| Fett, Kohlenhydrate, Ballaststoffe, Alkohol | hinter „Details" |

Alle Felder mit dem Vortageswert vorbelegt. Ziel: ein Tag ist in unter 15 Sekunden
erfasst.

## Offene Entscheidungen

Bitte vor Schritt 1 kurz klären, nicht selbst festlegen:

- **Energiedichte:** 7700 kcal/kg als fixer Default, oder abhängig vom Körperfettanteil
  modellieren (Anteil Fett vs. fettfreies Gewebe am Verlust variiert)?
- **Auto-Phasen:** stetig skalierend oder in diskreten Stufen? Stetig ist eleganter,
  Stufen sind nachvollziehbarer.
- **Faktor-Historie:** immer den neuesten Faktor, oder über die letzten drei
  Kalibrierungen glätten? Glättung ist stabiler, reagiert aber träger auf echte
  metabolische Anpassung.

## Ton

Wenn eine Anforderung widersprüchlich, unterspezifiziert oder fachlich fragwürdig ist,
sag das, statt eine Annahme zu treffen und weiterzubauen.

---

## Entscheidungen (nachgetragen, ersetzen „Offene Entscheidungen")

| Frage | Entscheidung | Wo umgesetzt |
|---|---|---|
| Energiedichte | Fix 7.700 kcal/kg, konfigurierbar. Forbes-Modellierung ist dokumentierte V2-Option. | ADR 0006 |
| Auto-Phasen | Stetig skalierende Rate. Die Kurve wird in Schritt 4 festgelegt, nicht vorher erfunden. | offen bis Schritt 4 |
| Faktor-Historie | Median der letzten drei Kalibrierungen, darunter der neueste. Abweichung neuester ↔ geglätteter wird gemeldet. | `calibration.effectiveFactor` |
| Modul-Platzierung | `domain/` → `src/nutrition/`, `adapters/` → `src/adapters/`, `storage/` → bestehendes `src/data/`. | ADR 0005 |
| Kalorienboden | `intakeFloor.bmrMultiple` (1,1) **warnt**, `hardFloorBmrMultiple` (1,0) **bindet** und löst die Defizit-Rückrechnung aus. | Schritt 4 |
| `noDeficitAboveActiveKcal` | Greift abends im Kontoabgleich: Soll-Defizit des Tages → 0. Die morgens fixierte Basiszufuhr bleibt unberührt, der Ausgleich läuft über das Wochenkonto. | Schritt 5 |

### Korrekturen am Dokument

Drei Stellen sind in sich nicht konsistent und werden abweichend umgesetzt:

1. **EA-Konstanz (Test 3).** Mit Rundung und Faktor ≠ 1 ist die geforderte Toleranz von
   ± 1 kcal/kg FFM nicht erreichbar, wenn EA die rohe Trainingsenergie des Adapters
   verwendet: bei Faktor 0,95 und einer 1.500-kcal-Einheit fällt EA um 1,55 kcal/kg.
   Deshalb rechnet EA mit der **kalibrierten** Trainingsenergie (`exerciseKcal × Faktor`).
   Das ist auch physiologisch die richtige Größe — der rohe Wearable-Wert ist genau der,
   dessen Bias bekannt ist. Es bleibt nur die Rundung, begrenzt auf 0,76 kcal/kg und
   immer nach unten.
2. **Synthetische Rückgewinnung (Test 1).** Bei n = 30 und σ = 0,35 kg beträgt der
   Standardfehler der Regressionssteigung 0,0074 kg/Tag ≙ 57 kcal, zusammen mit dem
   Zufuhrmittel rund 60 kcal ≙ 2,3 % eines TDEE von 2.600 kcal — also 1 σ. Ein hartes
   „< 3 % pro Seed" fiele etwa bei jedem fünften Seed durch. Der Test prüft deshalb über
   20 deterministische Seeds: mittlerer Absolutfehler < 3 %, jeder einzelne Seed < 6 %,
   mittlerer **vorzeichenbehafteter** Fehler < 1 % (kein systematischer Bias).
3. **TEF für Alkohol** ist nicht angegeben. Nach der Repo-Regel „erfinde keine Werte"
   wird 0 % gerechnet und die Lücke in `sources.json` als solche markiert.

### Seed-Profil

Die Tabelle in „Seed-Profil" ist intern rund 8 kcal locker: 0,50 %/Woche von 89,5 kg sind
492 kcal/Tag, die Tabelle nennt 484 (Basiszufuhr 1.850). Fixtures prüfen mit Toleranz
gegen berechnete Werte, nicht gegen die Literalzahl.
