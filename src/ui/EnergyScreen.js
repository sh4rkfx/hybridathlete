// The energy screen (kickoff step 9). Presentation only — every derivation
// lives in energyHelpers.js so it can be tested in Node, since this repo has no
// DOM shim and never renders a component in a test.
import { html } from './html.js';
import { useState, useEffect, useMemo } from 'preact/hooks';
import {
  assembleDays, deriveEnergy, nutritionConfig, prefillEntry, entryToDay,
  parseNumber, setupGaps, DETAIL_FIELDS,
} from './energyHelpers.js';
import { flagMessage, flagAction, LEVEL_LABEL, LEVEL_CLASS } from './nutritionText.js';
import { dateKey } from '../engine/time.js';

const kcal = (v) => (Number.isFinite(v) ? `${Math.round(v)} kcal` : '—');
const gram = (v) => (Number.isFinite(v) ? `${Math.round(v)} g` : '—');
const one = (v, unit = '') => (Number.isFinite(v) ? `${v.toFixed(1)}${unit}` : '—');
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)} %` : '—');

const CONFIDENCE_LABEL = { high: 'hoch', medium: 'mittel', low: 'niedrig' };

function Row({ k, v, d, total }) {
  return html`<div class="am-row ${total ? 'total' : ''}">
    <span class="am-k">${k}</span><span class="am-v">${v}</span>${d ? html`<span class="am-d">${d}</span>` : ''}
  </div>`;
}

// The one place this app uses a free-text numeric field. Steppers are the house
// style and stay so for weight and body fat, where the range is narrow — but
// reaching 2143 kcal in 50-kcal taps is not the 15-second interaction the
// kickoff asks for, so calories and grams get a keyboard.
function NumField({ label, unit, value, onInput, placeholder }) {
  return html`<label class="nf">
    <span class="nf-l">${label}${unit ? html` <small>${unit}</small>` : ''}</span>
    <input class="nf-i" type="text" inputmode="decimal" enterkeyhint="next"
      value=${value ?? ''} placeholder=${placeholder ?? '—'}
      onInput=${(e) => onInput(parseNumber(e.target.value))} />
  </label>`;
}

function EntryCard({ entry, setEntry, onSave, saved }) {
  const [details, setDetails] = useState(false);
  const set = (field) => (value) => setEntry({ ...entry, [field]: value });

  return html`<div class="settings-card">
    <div class="s-k">${entry.isNew ? 'Heute erfassen' : 'Heute – gespeichert, korrigieren?'}</div>
    <div class="nf-grid">
      <${NumField} label="Gewicht" unit="kg" value=${entry.weightKg} onInput=${set('weightKg')} />
      <${NumField} label="Kalorien" unit="kcal" value=${entry.kcal} onInput=${set('kcal')} />
      <${NumField} label="Protein" unit="g" value=${entry.proteinG} onInput=${set('proteinG')} />
      <${NumField} label="Körperfett" unit="%" value=${entry.bodyFatPct} onInput=${set('bodyFatPct')} />
    </div>
    <button class="src-toggle" onClick=${() => setDetails(!details)}>${details ? 'Details ausblenden' : 'Details'}</button>
    ${details ? html`<div class="nf-grid">
      <${NumField} label="Fett" unit="g" value=${entry.fatG} onInput=${set('fatG')} />
      <${NumField} label="Kohlenhydrate" unit="g" value=${entry.carbsG} onInput=${set('carbsG')} />
      <${NumField} label="Ballaststoffe" unit="g" value=${entry.fiberG} onInput=${set('fiberG')} />
      <${NumField} label="Alkohol" unit="g" value=${entry.alcoholG} onInput=${set('alcoholG')} />
    </div>` : ''}
    <p class="s-hint">Vorbelegt mit deinen letzten Werten – Gewicht und Körperfett stehen schon da, Kalorien und Protein trägst du ein.</p>
    <button class="act-btn primary" onClick=${onSave}>${saved ? 'Gespeichert ✓' : 'Tag speichern'}</button>
  </div>`;
}

function TargetCard({ d }) {
  if (d.target.baseIntakeKcal == null) {
    return html`<div class="settings-card"><div class="s-k">Zielzufuhr</div>
      <p class="s-hint">Noch keine Ruhetag-Basis – dafür braucht es Tage ohne Einheit mit Umsatzdaten.</p></div>`;
  }
  const m = d.macros;
  return html`<div class="settings-card">
    <div class="s-k">Zielzufuhr heute</div>
    <div class="big-kcal">${kcal(d.plannedIntakeKcal)}</div>
    <div class="acwr-math e-math">
      <${Row} k="Ruhetag-Umsatz" v=${kcal(d.restTdeeKcal)} />
      <${Row} k="Phasendefizit" v=${`− ${kcal(d.target.deficitKcal)}`} d=${`${one(d.target.ratePctBwPerWeek)} %/Woche`} />
      ${d.target.ledgerCorrectionKcal ? html`<${Row} k="Wochenkonto" v=${kcal(d.target.ledgerCorrectionKcal)} />` : ''}
      ${d.compensation.kcal ? html`<${Row} k="Kompensation Training" v=${`+ ${kcal(d.compensation.kcal)}`} d="100 %, kalibriert, auf 50 abgerundet" /> ` : ''}
      <${Row} k="Zielzufuhr" v=${kcal(d.plannedIntakeKcal)} total=${true} />
    </div>
    ${m ? html`<div class="acwr-math e-math" style="margin-top:8px">
      <${Row} k="Protein" v=${gram(m.proteinG)} d=${`${one(m.proteinG / (d.body.ffmKg || 1))} g/kg FFM`} />
      <${Row} k="Fett" v=${gram(m.fatG)} />
      <${Row} k="Kohlenhydrate" v=${gram(m.carbsG)} />
      <${Row} k="Ballaststoffe" v=${gram(m.fiberG)} />
    </div>` : ''}
    ${m?.error ? html`<p class="s-hint">Die Makros gehen bei dieser Zufuhr nicht auf – Protein-, Fett- und Kohlenhydrat-Untergrenze zusammen liegen darüber.</p>` : ''}
  </div>`;
}

function MeasurementCard({ d }) {
  const c = d.calibration;
  return html`<div class="settings-card">
    <div class="s-k">Messung statt Schätzung</div>
    ${c.factor == null
    ? html`<p class="s-hint">Noch kein Faktor – es braucht ${d.config.calibration.minDays} Tage mit Zufuhr, Umsatz und Gewicht. Aktuell: ${c.nDays}.</p>`
    : html`
      <div class="big-kcal">${Math.round(c.tdeeRealKcal ?? 0)} <small>kcal echter Umsatz</small></div>
      <div class="acwr-math e-math">
        <${Row} k="Faktor" v=${d.factor.factor?.toFixed(3) ?? '—'} d=${d.factor.method === 'median3' ? 'Median der letzten 3' : 'neueste Messung'} />
        <${Row} k="Konfidenz" v=${CONFIDENCE_LABEL[c.confidence]} d=${`${c.nDays} Tage · ${pct(c.coverage)} Abdeckung`} />
        <${Row} k="Ø Zufuhr" v=${kcal(c.meanIntakeKcal)} />
        <${Row} k="Gewichtstrend" v=${`${(c.trend?.slopeKgPerDay * 7).toFixed(2)} kg/Woche`} />
        <${Row} k="7 / 28 Tage" v=${`${d.rolling.d7.factor?.toFixed(2) ?? '—'} / ${d.rolling.d28.factor?.toFixed(2) ?? '—'}`} d="nur zur Anzeige" />
      </div>
      ${d.factor.deviates ? html`<p class="s-hint">Der neueste Faktor weicht um ${one(d.factor.deviationPct)} % vom geglätteten ab – echte Anpassung oder ein Tracking-Bruch.</p>` : ''}`}
  </div>`;
}

function AvailabilityCard({ d }) {
  const a = d.availability;
  const level = a.critical ? 'v-stop' : a.low ? 'v-caution' : 'v-fresh';
  return html`<div class="settings-card">
    <div class="s-k">Energieverfügbarkeit</div>
    <div class="ea-row">
      <span class="seg ${level} sel">${one(a.eaKcalPerKgFfm)}</span>
      <span class="subtle">kcal/kg FFM · Schwelle ${one(a.thresholdKcalPerKgFfm)}</span>
    </div>
    <p class="s-hint">Schwelle mit dem Körperfettanteil abgesenkt (${one(d.body.bodyFatPct)} %). Bewusste Abweichung von der Literatur – die 30 kcal/kg stammen aus schlanken Athletenkollektiven.</p>
  </div>`;
}

function LedgerCard({ d }) {
  return html`<div class="settings-card">
    <div class="s-k">Wochenkonto</div>
    <div class="acwr-math e-math">
      <${Row} k="Kontostand" v=${kcal(d.ledger.balanceKcal)} d=${d.ledger.saturated ? 'am Deckel' : 'offen'} />
      <${Row} k="Soll (7 Tage)" v=${kcal(d.week.targetDeficitKcal)} />
      <${Row} k="Ist (7 Tage)" v=${kcal(d.week.actualDeficitKcal)} />
      <${Row} k="Differenz" v=${kcal(d.week.shortfallKcal)} total=${true} />
    </div>
    <p class="s-hint">Überschuss wird nachgeholt, ein Defizit verfällt – kein Nachessen von Guthaben.</p>
  </div>`;
}

function FlagsCard({ flags }) {
  if (!flags.length) {
    return html`<div class="settings-card"><div class="s-k">Hinweise</div>
      <div class="empty"><div class="e-i">✓</div><div class="e-t">Keine Auffälligkeiten</div>
      <div class="e-s">Ruhepuls, Trend, Protein, Abdeckung und Energieverfügbarkeit sind im Rahmen.</div></div></div>`;
  }
  return html`<div class="settings-card">
    <div class="s-k">Hinweise</div>
    ${flags.map((flag) => html`<div class="flag-item">
      <span class="seg ${LEVEL_CLASS[flag.level]} sel">${LEVEL_LABEL[flag.level]}</span>
      <div class="fl-body">
        <div class="fl-t">${flagMessage(flag)}</div>
        <div class="fl-a">${flagAction(flag)}${flag.since ? ` · seit ${flag.since}` : ''}</div>
      </div>
    </div>`)}
  </div>`;
}

export function EnergyScreen({ state, now, actions, toast }) {
  const config = nutritionConfig(state);
  const today = dateKey(now);
  const gaps = setupGaps(config);

  const [days, setDays] = useState(null);
  const [entry, setEntry] = useState(() => prefillEntry(state, today));
  const [saved, setSaved] = useState(false);

  const rows = state?.nutrition?.days ?? [];
  // assembleDays is async because adapters are; re-run whenever the stored days
  // or the chosen source change.
  useEffect(() => {
    let alive = true;
    assembleDays(state, config, { now }).then((result) => { if (alive) setDays(result); });
    return () => { alive = false; };
  }, [rows.length, JSON.stringify(rows.at(-1) ?? null), config.energy.adapterId]);

  useEffect(() => { setEntry(prefillEntry(state, today)); setSaved(false); }, [rows.length, today]);

  const derived = useMemo(() => (days ? deriveEnergy(state, { now, days }) : null), [days, config]);

  if (gaps.length) {
    return html`<div>
      <div class="eyebrow">Energie</div><h1 class="title">Erst dein Profil</h1>
      <div class="settings-card">
        <p class="s-hint">Ohne Geburtsdatum, Größe, Geschlecht und Körperzusammensetzung lässt sich kein Ruheumsatz rechnen – und ohne den keine Zielzufuhr.</p>
        <button class="act-btn primary" onClick=${actions.goSetup}>Im Setup ergänzen</button>
        <button class="act-btn" onClick=${actions.loadDemoEnergy}>Demo-Energiedaten laden</button>
      </div>
    </div>`;
  }

  const save = () => {
    actions.saveDay(entryToDay(entry));
    setSaved(true);
    toast('Tag gespeichert');
  };

  return html`<div>
    <div class="eyebrow">Energie</div>
    <h1 class="title">${derived?.plannedIntakeKcal ? kcal(derived.plannedIntakeKcal) : 'Zielzufuhr'}</h1>
    <p class="subtle">Gemessener Umsatz statt Formel – aus deiner Zufuhr und dem Gewichtsverlauf.</p>

    <${EntryCard} entry=${entry} setEntry=${setEntry} onSave=${save} saved=${saved} />

    ${!derived ? html`<div class="settings-card"><p class="s-hint">Rechne …</p></div>` : html`
      <${TargetCard} d=${derived} />
      <${MeasurementCard} d=${derived} />
      <${AvailabilityCard} d=${derived} />
      <${LedgerCard} d=${derived} />
      <${FlagsCard} flags=${derived.flags} />
    `}
  </div>`;
}
