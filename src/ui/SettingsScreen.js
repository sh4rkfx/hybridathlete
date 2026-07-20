// Setup (story #36 restructure): status card on top as the map, five accordion
// sections below (one open), advisor as the guided default entry, every
// explainer behind a Warum? toggle — guidance through less text, not more.
import { html } from './html.js';
import { useState } from 'preact/hooks';
import { atHour, addDays, dOnly } from '../engine/time.js';
import { REGION_LABELS } from '../engine/texts.js';
import { catalogOf, GOAL_SCHEMES, SPLITS, SPLIT_EVIDENCE } from '../engine/catalog.js';
import { generateStrength, splitCoverageGaps, splitHint } from '../engine/generator.js';
import { exerciseReadiness } from '../engine/readiness.js';
import { GarminImport } from './GarminImport.js';
import { PlanAdvisor } from './PlanAdvisor.js';
import { SportGlyph } from './sportsUi.js';
import { initialSetupSection } from './helpers.js';

function Why({ children }) {
  const [show, setShow] = useState(false);
  return html`
    <button class="src-toggle" onClick=${() => setShow(!show)}>${show ? 'Ausblenden' : 'Warum?'}</button>
    <div class="src-full ${show ? 'show' : ''}">${children}</div>`;
}

function Section({ id, title, desc, open, onToggle, children }) {
  return html`<div class="acc ${open ? 'open' : ''}">
    <button class="acc-head" onClick=${() => onToggle(open ? null : id)} aria-expanded=${open}>
      <div><div class="acc-t">${title}</div><div class="acc-d">${desc}</div></div>
      <span class="acc-caret" aria-hidden="true">›</span>
    </button>
    ${open ? html`<div class="acc-body">${children}</div>` : ''}
  </div>`;
}

export function SettingsScreen({ state, now, actions, toast }) {
  const cat = catalogOf(state);
  const p = state.profile;
  const gaps = splitCoverageGaps(p);
  const [open, setOpen] = useState(() => initialSetupSection(state));
  const [newCLevel, setNewCLevel] = useState('yellow');
  const [newCRegion, setNewCRegion] = useState('fingers');

  const previewWhen = atHour(addDays(dOnly(now), 1), 17);
  const units = generateStrength(p, state, previewWhen, now);
  const sc = GOAL_SCHEMES[p.goal];
  const mk = (id) => {
    const lv = exerciseReadiness(id, previewWhen, state, now).level;
    return lv === 'fresh' ? '●' : lv === 'caution' ? '◆' : '■';
  };
  const hint = splitHint(p);
  const activeSports = p.activeSports ?? [];

  return html`
    <div class="eyebrow">Setup</div><h1 class="title">Dein Plan</h1>

    <div class="plan-status">
      <button class="stat-chip" onClick=${() => setOpen('manual')}><span class="k">Ziel</span> ${sc.label}</button>
      <button class="stat-chip" onClick=${() => setOpen('manual')}><span class="k">Split</span> ${SPLITS[p.split].label}${(p.disabledUnits || []).length ? ` − ${(p.disabledUnits || []).join('/')}` : ''}</button>
      <button class="stat-chip" onClick=${() => setOpen('advisor')}>${p.trainingDays ?? 3} Tage</button>
      ${activeSports.length ? html`<button class="stat-chip" onClick=${() => setOpen('advisor')}>${activeSports.map((id) => html`<${SportGlyph} id=${id} size=${16} />`)}</button>` : ''}
      ${(p.constraints || []).map((c) => html`<button class="stat-chip warn" onClick=${() => setOpen('manual')}>${REGION_LABELS[c.region]} · ${c.level === 'red' ? 'rot' : 'gelb'}</button>`)}
    </div>

    <${Section} id="advisor" title="Plan-Berater" desc="Empfehlung aus Ziel, Tagen & deinen Sportarten" open=${open === 'advisor'} onToggle=${setOpen}>
      <${PlanAdvisor} state=${state} now=${now} actions=${actions} toast=${toast} />
    <//>

    <${Section} id="manual" title="Manuell anpassen" desc="Ziel, Split, Einheiten, Constraints" open=${open === 'manual'} onToggle=${setOpen}>
      <div class="field"><div class="f-lbl">Ziel</div><div class="opt-row">
        ${Object.entries(GOAL_SCHEMES).map(([k, v]) => html`<button class="opt ${p.goal === k ? 'sel' : ''}" onClick=${() => actions.setGoal(k)}>${v.label}</button>`)}
      </div></div>
      <div class="field"><div class="f-lbl">Split</div><div class="opt-row">
        ${Object.entries(SPLITS).map(([k, v]) => html`<button class="opt ${p.split === k ? 'sel' : ''}" onClick=${() => actions.setSplit(k)}>${v.label}</button>`)}
      </div>
      <${Why}>
        Split-Wahl ist Präferenz: bei gleichem Wochenvolumen sind Split und Ganzkörper gleichwertig — zählen tun Volumen, Last und Anstrengung. ${SPLIT_EVIDENCE.source}
        ${hint ? html`<br/><br/><b>Frequenz-Hinweis:</b> ${hint.text} ${hint.source}` : ''}
      <//>
      </div>
      <div class="field"><div class="f-lbl">Einheiten abwählen</div><div class="opt-row">
        ${SPLITS[p.split].units.map((u) => html`<button class="opt ${(p.disabledUnits || []).includes(u) ? 'sel-toggle' : ''}" onClick=${() => actions.toggleUnit(u)}>${u}</button>`)}
      </div></div>
      <div class="field"><div class="f-lbl">Constraints</div>
        <div class="c-list">${(p.constraints || []).length ? (p.constraints || []).map((c) => html`
          <span class="c-chip ${c.level}">${REGION_LABELS[c.region]}${c.region === 'knee' ? ' (Beugetiefe)' : ''} · ${c.level === 'red' ? 'rot' : 'gelb'}
            <button class="c-del" onClick=${() => actions.delConstraint(c.id)} aria-label="entfernen">✕</button></span>`)
        : html`<span class="subtle" style="font-size:12.5px">keine</span>`}</div>
        <div class="c-add">
          <select class="csel" value=${newCRegion} onChange=${(e) => setNewCRegion(e.target.value)}>
            ${Object.entries(REGION_LABELS).filter(([k]) => k !== 'systemic').map(([k, v]) => html`<option value=${k}>${v}</option>`)}
          </select>
          <button class="opt ${newCLevel === 'yellow' ? 'sel' : ''}" onClick=${() => setNewCLevel('yellow')}>gelb</button>
          <button class="opt ${newCLevel === 'red' ? 'sel' : ''}" onClick=${() => setNewCLevel('red')}>rot</button>
          <button class="opt" onClick=${() => actions.addConstraint(newCRegion, newCLevel)}>＋ anlegen</button>
        </div>
        <${Why}>gelb = Alternative wählen (schwer belastende Übungen fliegen aus dem Pool) · rot = Region sperren. Knie berücksichtigt zusätzlich die Beugetiefe der Übungen (low/mid/deep).<//>
      </div>
    <//>

    <${Section} id="preview" title="Vorschau & Generator" desc="Was der Generator für morgen bauen würde" open=${open === 'preview'} onToggle=${setOpen}>
      <div class="gen-preview">
        <b>${units.length} Krafteinheit${units.length === 1 ? '' : 'en'}</b> · ${sc.sets}×${sc.reps} (${sc.label}) · readiness-aware für morgen<br/>
        ${units.map((u) => html`<span><b>${u.unit}:</b> ${u.exercises.map((id) => mk(id) + ' ' + cat.exById[id].name).join(', ')}<br/></span>`)}
      </div>
      ${gaps.map((g) => html`<div class="gap-hint"><b>Lücke: ${g.label}</b><br/>${g.note} Vorschlag: ${g.fixIds.map((id) => cat.exById[id].name).join(', ')} in Push einstreuen.</div>`)}
      <button class="act-btn primary" onClick=${actions.regenerate}>Plan neu generieren</button>
    <//>

    <${Section} id="import" title="Garmin-Import" desc="FIT / TCX / Export-ZIP als Entwürfe" open=${open === 'import'} onToggle=${setOpen}>
      <${GarminImport} state=${state} toast=${toast} />
    <//>

    <${Section} id="data" title="Daten" desc="Export, Demo-Woche, Zurücksetzen" open=${open === 'data'} onToggle=${setOpen}>
      <button class="act-btn" onClick=${actions.exportData}>Als JSON exportieren</button>
      <button class="act-btn" onClick=${actions.loadDemo}>Demo-Woche laden (Referenz-Szenario)</button>
      <button class="act-btn danger" onClick=${actions.resetData}>Zurücksetzen</button>
    <//>`;
}
