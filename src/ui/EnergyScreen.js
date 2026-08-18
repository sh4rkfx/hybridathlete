// The energy screen (kickoff step 9). Presentation only — every derivation
// lives in energyHelpers.js so it can be tested in Node, since this repo has no
// DOM shim and never renders a component in a test.
//
// Structure: one answer, one action, evidence on demand.
//   1. what is left today, as a ring
//   2. the entry that changes it
//   3. the weight trend the whole feature rests on
//   4. everything diagnostic, collapsed
// Anything at warn level or above jumps above all of it.
import { html } from './html.js';
import { useState, useEffect, useMemo } from 'preact/hooks';
import {
  assembleDays, deriveEnergy, nutritionConfig, prefillEntry, entryToDay,
  parseNumber, setupGaps, targetBreakdown, todayProgress, calibrationProgress,
  weightChartData,
} from './energyHelpers.js';
import { flagMessage, flagAction, LEVEL_LABEL } from './nutritionText.js';
import { dateKey } from '../engine/time.js';

const kcal = (v) => (Number.isFinite(v) ? `${Math.round(v)} kcal` : '—');
const gram = (v) => (Number.isFinite(v) ? `${Math.round(v)} g` : '—');
const one = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const signed = (v) => `${v < 0 ? '−' : '+'} ${Math.abs(Math.round(v))} kcal`;

// Plain German for what the domain calls things. The precise term stays in the
// "Warum?" text; nobody reads "Phasendefizit" at seven in the morning.
const ROW_LABEL = {
  restTdee: 'Verbrauch an Ruhetagen',
  deficit: 'Dein Defizit',
  ledger: 'Rückstand aus der Woche',
  compensation: 'Training ausgeglichen',
};

const CONFIDENCE = { high: 'verlässlich', medium: 'brauchbar', low: 'noch wackelig' };

function Why({ children }) {
  const [show, setShow] = useState(false);
  return html`<button class="src-toggle" onClick=${() => setShow(!show)}>${show ? 'Ausblenden' : 'Warum?'}</button>
    <div class="src-full ${show ? 'show' : ''}">${children}</div>`;
}

function Fold({ id, title, value, tone, open, onToggle, children }) {
  return html`<div class="acc ${open ? 'open' : ''}">
    <button class="acc-head" onClick=${() => onToggle(open ? null : id)} aria-expanded=${open}>
      <span class="acc-t">${title}</span>
      <span class="fold-v ${tone ?? ''}">${value}</span>
      <span class="acc-caret">▸</span>
    </button>
    ${open ? html`<div class="acc-body">${children}</div>` : ''}
  </div>`;
}

// Two concentric arcs: calories outside, protein inside. A ring rather than a
// bar because the interesting state is "how much of the day is left", and a
// ring reads that at a glance without a scale to interpret.
function Rings({ progress }) {
  const R1 = 52;
  const R2 = 38;
  const arc = (r, ratio) => {
    const c = 2 * Math.PI * r;
    return { dasharray: c, dashoffset: c * (1 - Math.min(1, Math.max(0, ratio ?? 0))) };
  };
  const k = arc(R1, progress.kcalRatio);
  const p = arc(R2, progress.proteinRatio);
  const tone = progress.over ? 'var(--caution)' : 'var(--brand)';

  return html`<svg class="ring" viewBox="0 0 130 130" role="img"
      aria-label=${progress.logged
    ? `${Math.round(progress.consumedKcal)} von ${Math.round(progress.targetKcal)} kcal gegessen`
    : 'Heute noch nichts erfasst'}>
    <circle cx="65" cy="65" r=${R1} fill="none" stroke="var(--surface-3)" stroke-width="9" />
    <circle cx="65" cy="65" r=${R2} fill="none" stroke="var(--surface-3)" stroke-width="6" />
    <circle cx="65" cy="65" r=${R1} fill="none" stroke=${tone} stroke-width="9" stroke-linecap="round"
      stroke-dasharray=${k.dasharray} stroke-dashoffset=${k.dashoffset} transform="rotate(-90 65 65)" />
    <circle cx="65" cy="65" r=${R2} fill="none" stroke="var(--fresh)" stroke-width="6" stroke-linecap="round"
      stroke-dasharray=${p.dasharray} stroke-dashoffset=${p.dashoffset} transform="rotate(-90 65 65)" />
  </svg>`;
}

function BudgetCard({ derived, progress }) {
  if (!Number.isFinite(progress.targetKcal)) {
    return html`<div class="settings-card"><div class="s-k">Heute</div>
      <p class="s-hint">Noch keine Zielzufuhr — dafür braucht es Ruhetage mit Umsatzdaten.</p></div>`;
  }
  const headline = !progress.logged
    ? kcal(progress.targetKcal)
    : `${progress.over ? '' : ''}${Math.abs(Math.round(progress.remainingKcal))} kcal`;

  return html`<div class="budget">
    <${Rings} progress=${progress} />
    <div class="budget-text">
      <div class="s-k">${!progress.logged ? 'Heute verfügbar' : progress.over ? 'Darüber' : 'Noch übrig'}</div>
      <div class="budget-n ${progress.over ? 'over' : ''}">${headline}</div>
      <div class="budget-sub">
        ${progress.logged
    ? html`${kcal(progress.consumedKcal)} von ${kcal(progress.targetKcal)}`
    : html`Ziel für heute · noch nichts erfasst`}
      </div>
      <div class="budget-sub protein">
        Protein ${progress.proteinG == null ? '—' : gram(progress.proteinG)} von ${gram(progress.proteinTargetG)}
      </div>
    </div>
  </div>`;
}

// The one place this app uses a free-text numeric field. Steppers are the house
// style and remain so elsewhere, but reaching 2143 kcal in 50-kcal taps is not
// the 15-second entry the kickoff asks for.
function NumField({ label, unit, value, onInput, autofocus }) {
  return html`<label class="nf">
    <span class="nf-l">${label}${unit ? html` <small>${unit}</small>` : ''}</span>
    <input class="nf-i" type="text" inputmode="decimal" enterkeyhint="next" autofocus=${autofocus}
      value=${value ?? ''} placeholder="—"
      onInput=${(e) => onInput(parseNumber(e.target.value))} />
  </label>`;
}

function EntryCard({ entry, setEntry, onSave, dirty }) {
  const [details, setDetails] = useState(false);
  const set = (field) => (value) => setEntry({ ...entry, [field]: value });

  return html`<div class="settings-card">
    <div class="s-k">${entry.isNew ? 'Heute eintragen' : 'Heute'}</div>
    <div class="nf-grid">
      <${NumField} label="Kalorien" unit="kcal" value=${entry.kcal} onInput=${set('kcal')} />
      <${NumField} label="Protein" unit="g" value=${entry.proteinG} onInput=${set('proteinG')} />
      <${NumField} label="Gewicht" unit="kg" value=${entry.weightKg} onInput=${set('weightKg')} />
      <${NumField} label="Körperfett" unit="%" value=${entry.bodyFatPct} onInput=${set('bodyFatPct')} />
    </div>
    <button class="det-toggle" onClick=${() => setDetails(!details)} aria-expanded=${details}>
      ${details ? 'Weniger' : 'Fett, Kohlenhydrate, Ballaststoffe, Alkohol'}
    </button>
    ${details ? html`<div class="nf-grid">
      <${NumField} label="Fett" unit="g" value=${entry.fatG} onInput=${set('fatG')} />
      <${NumField} label="Kohlenhydrate" unit="g" value=${entry.carbsG} onInput=${set('carbsG')} />
      <${NumField} label="Ballaststoffe" unit="g" value=${entry.fiberG} onInput=${set('fiberG')} />
      <${NumField} label="Alkohol" unit="g" value=${entry.alcoholG} onInput=${set('alcoholG')} />
    </div>` : ''}
    ${dirty ? html`<button class="act-btn primary" onClick=${onSave}>Speichern</button>` : ''}
  </div>`;
}

function TrendCard({ chart, goalKg }) {
  if (!chart) {
    return html`<div class="settings-card"><div class="s-k">Gewichtsverlauf</div>
      <p class="s-hint">Zwei Wiegungen genügen für die erste Kurve.</p></div>`;
  }
  const dir = chart.provisional ? 'zu kurz für einen Trend'
    : chart.slopeKgPerWeek == null ? ''
      : chart.slopeKgPerWeek < 0 ? `${one(Math.abs(chart.slopeKgPerWeek))} kg pro Woche runter`
        : `${one(chart.slopeKgPerWeek)} kg pro Woche rauf`;

  return html`<div class="settings-card">
    <div class="s-k">Gewichtsverlauf · ${Math.round(chart.spanDays)} Tage</div>
    <svg class="trend" viewBox=${`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none"
      role="img" aria-label=${`Gewicht von ${one(chart.maxKg)} auf ${one(chart.minKg)} kg, ${dir}`}>
      ${chart.goalY != null ? html`<line x1="0" x2=${chart.width} y1=${chart.goalY} y2=${chart.goalY}
        stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="3 3" />` : ''}
      ${chart.points.map((p) => html`<circle cx=${p.x} cy=${p.y} r=${p.excluded ? 2 : 2.4}
        fill=${p.excluded ? 'transparent' : 'var(--text-low)'}
        stroke=${p.excluded ? 'var(--caution)' : 'none'} stroke-width="1" />`)}
      ${chart.fit ? html`<line x1=${chart.fit.x1} y1=${chart.fit.y1} x2=${chart.fit.x2} y2=${chart.fit.y2}
        stroke=${chart.provisional ? 'var(--text-low)' : 'var(--brand)'} stroke-width="2" stroke-linecap="round"
        stroke-dasharray=${chart.provisional ? '4 4' : ''} />` : ''}
    </svg>
    <div class="trend-legend">
      <span>${one(chart.maxKg)}–${one(chart.minKg)} kg</span>
      <span class="trend-dir">${dir}</span>
    </div>
    <${Why}>Die grüne Linie ist eine Regression über alle Punkte, nicht die Verbindung von erstem und
      letztem Wert. Tägliche Wasserschwankungen von ±0,5 kg würden den Verlauf sonst um mehrere hundert
      Kilokalorien pro Tag verschieben. Hohle Punkte hat die Ausreißererkennung verworfen.<//>
  </div>`;
}

function StartCard({ progress, calib }) {
  return html`<div class="settings-card start">
    <div class="s-k">Noch ${calib.remaining} Tag${calib.remaining === 1 ? '' : 'e'} bis zur ersten Messung</div>
    <div class="start-bar"><div class="start-fill" style=${`width:${Math.round(calib.ratio * 100)}%`}></div></div>
    <div class="budget-sub">${calib.tracked} von ${calib.needed} Tagen erfasst${calib.streak > 1 ? ` · ${calib.streak} in Folge` : ''}</div>
    <p class="s-hint">
      ${progress.logged
    ? 'Heute ist erledigt. Ab hier zählt nur noch Dranbleiben — unter dieser Grenze lässt sich dein Umsatz nicht messen, nur schätzen.'
    : 'Trag heute ein. Unter dieser Grenze lässt sich dein Umsatz nicht messen, nur schätzen.'}
    </p>
  </div>`;
}

function FlagList({ flags }) {
  return flags.map((flag) => html`<div class="flag-item ${flag.level}">
    <span class="fl-badge ${flag.level}">${LEVEL_LABEL[flag.level]}</span>
    <div class="fl-body">
      <div class="fl-t">${flagMessage(flag)}</div>
      <div class="fl-a">${flagAction(flag)}${flag.since ? ` · seit ${flag.since}` : ''}</div>
    </div>
  </div>`);
}

export function EnergyScreen({ state, now, actions, toast }) {
  const config = nutritionConfig(state);
  const today = dateKey(now);
  const gaps = setupGaps(config);

  const [days, setDays] = useState(null);
  const [entry, setEntry] = useState(() => prefillEntry(state, today));
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(null);

  const rows = state?.nutrition?.days ?? [];
  useEffect(() => {
    let alive = true;
    assembleDays(state, config, { now }).then((result) => { if (alive) setDays(result); });
    return () => { alive = false; };
  }, [rows.length, JSON.stringify(rows.at(-1) ?? null), config.energy.adapterId]);

  useEffect(() => { setEntry(prefillEntry(state, today)); setDirty(false); }, [rows.length, today]);

  const derived = useMemo(() => (days ? deriveEnergy(state, { now, days }) : null), [days, config]);

  if (gaps.length) {
    return html`<div>
      <div class="eyebrow">Energie</div><h1 class="title">Erst dein Profil</h1>
      <div class="settings-card">
        <p class="s-hint">Ohne Geburtsdatum, Größe, Geschlecht und Körperzusammensetzung lässt sich kein
          Ruheumsatz rechnen – und ohne den keine Zielzufuhr.</p>
        <button class="act-btn primary" onClick=${actions.goSetup}>Im Setup ergänzen</button>
        <button class="act-btn" onClick=${actions.loadDemoEnergy}>Demo-Energiedaten laden</button>
      </div>
    </div>`;
  }

  const change = (next) => { setEntry(next); setDirty(true); };
  const save = () => { actions.saveDay(entryToDay(entry)); setDirty(false); toast('Tag gespeichert'); };

  if (!derived) {
    return html`<div><div class="eyebrow">Energie</div><h1 class="title">Rechne …</h1></div>`;
  }

  const progress = todayProgress(derived);
  const calib = calibrationProgress(days, config, now);
  const chart = weightChartData(days, config, { goalKg: config.goal.target?.valueKg });
  const breakdown = targetBreakdown(derived);
  const urgent = derived.flags.filter((f) => f.level !== 'info');
  const rest = derived.flags.filter((f) => f.level === 'info');
  const a = derived.availability;
  const c = derived.calibration;

  return html`<div>
    <div class="eyebrow">Energie</div>
    <h1 class="title">${progress.logged && !progress.over ? 'Gut unterwegs'
    : progress.over ? 'Über dem Ziel' : 'Heute'}</h1>

    ${urgent.length ? html`<div class="settings-card urgent"><${FlagList} flags=${urgent} /></div>` : ''}

    <${BudgetCard} derived=${derived} progress=${progress} />
    ${calib.remaining > 0 ? html`<${StartCard} progress=${progress} calib=${calib} />` : ''}
    <${EntryCard} entry=${entry} setEntry=${change} onSave=${save} dirty=${dirty} />
    <${TrendCard} chart=${chart} goalKg=${config.goal.target?.valueKg} />

    <div class="sec-title">Wie die Zahl zustande kommt</div>

    <${Fold} id="target" title="Zielzufuhr" value=${kcal(derived.plannedIntakeKcal)}
      open=${open === 'target'} onToggle=${setOpen}>
      <div class="acwr-math e-math">
        ${breakdown.map((row) => html`<div class="am-row">
          <span class="am-k">${ROW_LABEL[row.key]}</span>
          <span class="am-v">${row.key === 'restTdee' ? kcal(row.kcal) : signed(row.kcal)}</span>
          <span class="am-d">${row.key === 'deficit' ? `${one(derived.target.ratePctBwPerWeek)} %/Woche`
    : row.clipped ? 'durch Kalorienboden begrenzt'
      : row.key === 'compensation' ? 'voll, auf 50 abgerundet' : ''}</span>
        </div>`)}
        <div class="am-row total"><span class="am-k">Zielzufuhr</span>
          <span class="am-v">${kcal(derived.plannedIntakeKcal)}</span><span class="am-d"></span></div>
      </div>
      ${derived.macros ? html`<div class="acwr-math e-math" style="margin-top:8px">
        ${[['Protein', derived.macros.proteinG], ['Fett', derived.macros.fatG],
    ['Kohlenhydrate', derived.macros.carbsG], ['Ballaststoffe', derived.macros.fiberG]]
    .map(([label, g]) => html`<div class="am-row"><span class="am-k">${label}</span>
      <span class="am-v">${gram(g)}</span><span class="am-d"></span></div>`)}
      </div>` : ''}
    <//>

    <${Fold} id="measure" title="Gemessener Umsatz"
      value=${c.factor == null ? 'noch nicht' : kcal(c.tdeeRealKcal)}
      tone=${c.factor == null ? 'muted' : ''} open=${open === 'measure'} onToggle=${setOpen}>
      ${c.factor == null
    ? html`<p class="s-hint">Es braucht ${config.calibration.minDays} Tage mit Zufuhr, Umsatz und Gewicht.
        Aktuell sind es ${c.nDays}. Bis dahin rechnet die App mit der Formelschätzung.</p>`
    : html`<div class="acwr-math e-math">
        <div class="am-row"><span class="am-k">Verlässlichkeit</span><span class="am-v">${CONFIDENCE[c.confidence]}</span>
          <span class="am-d">${c.nDays} Tage</span></div>
        <div class="am-row"><span class="am-k">Ø Zufuhr</span><span class="am-v">${kcal(c.meanIntakeKcal)}</span><span class="am-d"></span></div>
        <div class="am-row"><span class="am-k">Korrekturfaktor</span><span class="am-v">${derived.factor.factor?.toFixed(3)}</span>
          <span class="am-d">auf die Schätzung deiner Datenquelle</span></div>
      </div>
      <${Why}>Dein echter Umsatz ist die Ø Zufuhr plus die Energie, die dein Gewichtsverlust freigesetzt hat.
        Der Faktor sagt, um wie viel deine Datenquelle danebenliegt. Kurzfristige Werte über sieben Tage sind
        zu verrauscht, um damit zu planen — bei ±0,35 kg Wiegerauschen liegt ihr Fehler bei rund
        ±500 kcal pro Tag.<//>`}
    <//>

    <${Fold} id="ea" title="Energieverfügbarkeit"
      value=${a.eaKcalPerKgFfm == null ? '—' : one(a.eaKcalPerKgFfm)}
      tone=${a.critical ? 'bad' : a.low ? 'warn' : 'good'} open=${open === 'ea'} onToggle=${setOpen}>
      <p class="s-hint">${a.eaKcalPerKgFfm == null ? 'Noch keine Zufuhr für heute erfasst.'
    : a.critical ? 'Deutlich zu wenig. Das geht auf die Substanz.'
      : a.low ? 'Unter deiner Schwelle. Ein, zwei Tage sind unkritisch, dauerhaft nicht.'
        : `Im grünen Bereich — deine Schwelle liegt bei ${one(a.thresholdKcalPerKgFfm)}.`}</p>
      <${Why}>Energieverfügbarkeit ist die Zufuhr abzüglich der Trainingsenergie, geteilt durch deine
        fettfreie Masse. Die Literatur nennt 30 kcal/kg als Grenze, gewonnen an schlanken Athleten. Bei
        ${one(derived.body.bodyFatPct)} % Körperfett steht deutlich mehr körpereigene Energie bereit, deshalb
        senkt die App die Schwelle auf ${one(a.thresholdKcalPerKgFfm)}. Das ist plausibel, aber nicht durch
        Studien gedeckt.<//>
    <//>

    <${Fold} id="week" title="Woche"
      value=${derived.ledger.balanceKcal ? kcal(derived.ledger.balanceKcal) : 'ausgeglichen'}
      tone=${derived.ledger.balanceKcal ? 'warn' : 'good'} open=${open === 'week'} onToggle=${setOpen}>
      <div class="acwr-math e-math">
        <div class="am-row"><span class="am-k">Rückstand</span><span class="am-v">${kcal(derived.ledger.balanceKcal)}</span>
          <span class="am-d">${derived.ledger.saturated ? 'am Deckel' : ''}</span></div>
        <div class="am-row"><span class="am-k">Geplant, 7 Tage</span><span class="am-v">${kcal(derived.week.targetDeficitKcal)}</span><span class="am-d"></span></div>
        <div class="am-row"><span class="am-k">Tatsächlich</span><span class="am-v">${kcal(derived.week.actualDeficitKcal)}</span><span class="am-d"></span></div>
      </div>
      <${Why}>Ein Überschuss wird über die Folgetage abgetragen, ein Defizit verfällt — Guthaben lässt sich
        nicht nachessen. Abgetragen wird höchstens bis zum Kalorienboden, was den Spielraum an manchen Tagen
        auf wenige Kilokalorien begrenzt.<//>
    <//>

    ${rest.length ? html`<div class="settings-card"><div class="s-k">Hinweise</div>
      <${FlagList} flags=${rest} /></div>` : ''}
  </div>`;
}
