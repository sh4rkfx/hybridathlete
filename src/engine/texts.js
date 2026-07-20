// German display strings used inside engine output (coach texts, readiness
// reasons, rule metadata shown on suggestion cards). Centralized here so the
// engine stays free of scattered literals; the normative wording comes from the
// reference prototype and is asserted by the scenario tests (e.g. /Bergtag/).
export const FAT_LABELS = { fresh: 'frisch', caution: 'müde', stop: 'platt' };

// Story #35: the home chip shows the CURRENT ratio; R7 warns on the projected
// one — the labels keep the two numbers apart.
export const ACWR_CHIP_LABEL = 'ACWR aktuell ⓘ';

export const REGION_LABELS = {
  fingers: 'Finger', forearm: 'Unterarm', elbow: 'Ellbogen', shoulder: 'Schulter',
  chest: 'Brust', triceps: 'Trizeps', upper_back: 'Oberer Rücken', lower_back: 'Unterer Rücken',
  core: 'Core', quads: 'Quadrizeps', posterior_chain: 'Hintere Kette', calves: 'Waden',
  knee: 'Knie', systemic: 'Systemisch',
};

// Display metadata per rule (short ids, German). Params/evidence live in
// rules/catalog.json; this is presentation-side wording from the prototype.
export const RULE_META = {
  R1: { name: 'Schmerz-Ampel', lvl: 'rct', lvlLabel: 'RCT',
    src: 'Silbernagel et al. (2007), Am J Sports Med — Pain-Monitoring-Model. Training bis NRS ≤5 zulässig, wenn danach nicht steigend und am Folgetag zurück auf Ausgangswert.' },
  R2: { name: 'Dauerhafte Constraints', lvl: 'expert', lvlLabel: 'Experten-Konsens',
    src: 'Nutzerdefinierte Einschränkung (z. B. Knieflexion 80–90° unter Last). Substitutions-Mechanik = Standard-Load-Management.' },
  R3: { name: 'Sehnen/Pulley-Erholung', lvl: 'expert', lvlLabel: 'Experten-Konsens',
    src: "Low S., 'Rehabbing injured pulleys'; The Climbing Doctor; Hooper's Beta. ~48 h zwischen harten Finger-Reizen. Kein validierter Wert für gesunde Ringbänder — bewusst konservativ." },
  R4: { name: 'Exzentrische Erholung', lvl: 'cohort', lvlLabel: 'Kohorte',
    src: 'DOMS-Reviews (Physiopedia; ScienceDirect 2026); Eston et al. (1995). Peak 24–72 h nach exzentrischer Last. hm-Skalierung als Annahme gekennzeichnet.' },
  R5: { name: 'Muskuläre Erholung', lvl: 'expert', lvlLabel: 'Experten-Konsens',
    src: 'Allgemeine Trainingsphysiologie (MPS-Fenster, DOMS-Verlauf). Kombiniert Ampel-Input mit regionaler Last.' },
  R6: { name: 'Kraft/Ausdauer-Interferenz', lvl: 'meta', lvlLabel: 'Meta-Analyse',
    src: 'Hickson (1980); Schumann et al. (2022), 43 Studien — Interferenz geringer als früher angenommen. Kraft vor Ausdauer, ≥6 h Abstand. Niedrige Priorität.' },
  R7: { name: 'ACWR-Wochenlast', lvl: 'cohort', lvlLabel: 'Kohorte · umstritten',
    src: 'Gabbett (2016), Br J Sports Med 50(5):273–280. Sweet Spot 0,8–1,3; >1,5 erhöhtes Risiko. Kritik offen: coupling (Lolli 2019), Sensitivität (Impellizzeri 2020).' },
};
