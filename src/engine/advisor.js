// Plan advisor (story #32): goal + available strength days + other active
// sports -> a justified split recommendation. Pure function, no DOM/DB.
//
// Coverage is CURATED (R8 params, expert-consensus), not derived from the
// load-profile vectors: bouldering genuinely replaces most of a pull unit,
// while endurance leg work (running/cycling/mountain) is explicitly NOT
// counted as a strength stimulus — an honesty rule, not an oversight.
import { catalogOf } from './catalog.js';

// Rule params live in the declarative catalog; imported via the same accessor
// the rules use. (engine -> rules/params.js is a data dependency, not a cycle:
// params.js only reads catalog.json.)
import { ruleParams } from '../rules/params.js';

const ALL_UNITS = ['push', 'pull', 'legs'];
const DAY_SPREAD = { 1: [2], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [1, 2, 3, 4, 6] };

const SOURCES = {
  coverage: {
    source: 'Kletter-Präventionsliteratur / R8 (antagonistisches Training, Rotatorenmanschette): Bouldern liefert hohes Zug-/Griffvolumen, aber wenig hintere Schulter und horizontales Ziehen.',
    evidenceLevel: 'expert-consensus',
  },
  endurance: {
    source: 'Repetition Continuum (Schoenfeld/Grgic 2021, Meta-Analyse): Maximalkraft erfordert schwere Lasten — Ausdauerreize (Laufen, Rad, Berggehen) ersetzen kein Bein-Krafttraining.',
    evidenceLevel: 'meta-analysis',
  },
  split: {
    source: 'Ramos-Campo et al. (2024), 14 RCTs: Split vs. Ganzkörper gleichwertig bei gleichem Volumen — die Verteilung folgt deinen Tagen, nicht umgekehrt.',
    evidenceLevel: 'meta-analysis',
  },
  frequency: {
    source: 'Pelland et al. (2025), Dose-Response-Meta-Regression: Kraft profitiert von höherer Frequenz je Übung (abnehmender Grenznutzen).',
    evidenceLevel: 'meta-analysis',
  },
  timeEfficient: {
    source: 'Iversen et al. (2021), „No Time to Lift?": bei wenigen Einheiten sind Ganzkörper-Programme mit Mehrgelenksübungen am zeiteffizientesten.',
    evidenceLevel: 'expert-consensus',
  },
};

export function recommendPlan(profile, state) {
  const catalog = state ? catalogOf(state) : catalogOf({});
  const p = ruleParams('R8');
  const active = profile.activeSports ?? [];
  const trainingDays = Math.max(1, Math.min(5, profile.trainingDays ?? 3));
  const rationale = [];
  const gaps = [];

  // 1) Curated coverage by other sports.
  const covered = [];
  for (const [sportId, cov] of Object.entries(p.unitCoverage ?? {})) {
    if (!active.includes(sportId)) continue;
    covered.push(cov.unit);
    gaps.push({ label: 'Hintere Schulter & horizontales Ziehen', note: cov.note, fixIds: cov.einstreu });
    rationale.push({
      text: `${catalog.sports[sportId]?.name ?? sportId} deckt die ${cov.unit}-Unit weitgehend ab (${cov.note}) — 1–2 Einstreu-Übungen ersetzen den Rest.`,
      ...SOURCES.coverage,
    });
  }

  // 2) Honesty rule: endurance sports are no strength substitute.
  const endurance = (p.enduranceNotStrength ?? []).filter((s) => active.includes(s));
  if (endurance.length) {
    rationale.push({
      text: `${endurance.map((s) => catalog.sports[s]?.name ?? s).join(', ')} zählen nicht als Ersatz für Bein-Krafttraining — Ausdauerreiz ist kein Maximalkraftreiz. Die Legs-Unit bleibt im Plan.`,
      ...SOURCES.endurance,
    });
  }

  const needed = ALL_UNITS.filter((u) => !covered.includes(u));

  // 3) Split matrix: few days + full need -> full body; otherwise cycle the
  //    needed units across the available days.
  let split;
  let assignment;
  let disabledUnits;
  if (trainingDays <= 2 && needed.length === 3) {
    split = 'full_body';
    disabledUnits = [];
    assignment = Array(trainingDays).fill('full');
    rationale.push({ text: `Mit ${trainingDays} Krafttag${trainingDays === 1 ? '' : 'en'} und vollem Bedarf trainiert Ganzkörper jede Region am häufigsten pro Woche.`, ...SOURCES.timeEfficient });
  } else {
    split = 'PPL';
    disabledUnits = covered;
    assignment = Array.from({ length: trainingDays }, (_, i) => needed[i % needed.length]);
  }
  rationale.push({ text: 'Der Split selbst ist Präferenz — entscheidend sind Wochenvolumen, Last und Anstrengung.', ...SOURCES.split });

  const perUnitFrequency = split === 'full_body'
    ? trainingDays
    : Math.round((trainingDays / needed.length) * 10) / 10;

  // 4) Strength goal + low per-lift frequency -> frequency hint.
  if (profile.goal === 'kraftaufbau' && perUnitFrequency < 2) {
    rationale.push({
      text: `Für Maximalkraft wären ≥2 Einheiten je Übung/Woche leicht überlegen (aktuell ~${perUnitFrequency}×). Mehr Krafttage oder Ganzkörper erhöhen die Frequenz.`,
      ...SOURCES.frequency,
    });
  }

  return {
    split,
    disabledUnits,
    trainingDays,
    assignment,
    dayOffsets: DAY_SPREAD[trainingDays],
    perUnitFrequency,
    gaps,
    rationale,
    coveredUnits: covered,
    neededUnits: needed,
  };
}
