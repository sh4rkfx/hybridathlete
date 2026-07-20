// Settings (spec §6, "Setup"): goal/split/unit toggles, generic constraint
// manager, readiness-aware generator preview (●◆■), regenerate, data tools.
import { html } from './html.js';
import { useState } from 'preact/hooks';
import { atHour, addDays, dOnly } from '../engine/time.js';
import { REGION_LABELS } from '../engine/texts.js';
import { catalogOf, GOAL_SCHEMES, SPLITS } from '../engine/catalog.js';
import { generateStrength, splitCoverageGaps } from '../engine/generator.js';
import { exerciseReadiness } from '../engine/readiness.js';

export function SettingsScreen({ state, now, actions, toast }) {
  const cat = catalogOf(state);
  const p = state.profile;
  const gaps = splitCoverageGaps(p);
  const [newCLevel, setNewCLevel] = useState('yellow');
  const [newCRegion, setNewCRegion] = useState('fingers');

  const previewWhen = atHour(addDays(dOnly(now), 1), 17);
  const units = generateStrength(p, state, previewWhen, now);
  const sc = GOAL_SCHEMES[p.goal];
  const mk = (id) => {
    const lv = exerciseReadiness(id, previewWhen, state, now).level;
    return lv === 'fresh' ? '●' : lv === 'caution' ? '◆' : '■';
  };

  return html`
    <div class="eyebrow">Setup</div><h1 class="title">Dein Plan</h1>
    <p class="subtle">Ziel und Split bestimmen, was der Generator baut – abgestimmt auf Bouldern, Berg und Laufen.</p>
    <div class="settings-card" style="margin-top:16px">
      <div class="field"><div class="f-lbl">Ziel</div><div class="opt-row">
        ${Object.entries(GOAL_SCHEMES).map(([k, v]) => html`<button class="opt ${p.goal === k ? 'sel' : ''}" onClick=${() => actions.setGoal(k)}>${v.label}</button>`)}
      </div></div>
      <div class="field"><div class="f-lbl">Split</div><div class="opt-row">
        ${Object.entries(SPLITS).map(([k, v]) => html`<button class="opt ${p.split === k ? 'sel' : ''}" onClick=${() => actions.setSplit(k)}>${v.label}</button>`)}
      </div></div>
      <div class="field"><div class="f-lbl">Einheiten abwählen</div><div class="opt-row">
        ${SPLITS[p.split].units.map((u) => html`<button class="opt ${(p.disabledUnits || []).includes(u) ? 'sel-toggle' : ''}" onClick=${() => actions.toggleUnit(u)}>${u}</button>`)}
      </div></div>
      <div class="field"><div class="f-lbl">Constraints</div>
        <div class="c-list">${(p.constraints || []).length ? (p.constraints || []).map((c) => html`
          <span class="c-chip ${c.level}">${REGION_LABELS[c.region]}${c.region === 'knee' ? ' (Beugetiefe)' : ''} · ${c.level === 'red' ? 'rot' : 'gelb'}
            <button class="c-del" onClick=${() => actions.delConstraint(c.id)} aria-label="entfernen">✕</button></span>`)
        : html`<span class="subtle" style="font-size:12.5px">keine – Generator nutzt alle Übungen</span>`}</div>
        <div class="c-add">
          <select class="csel" value=${newCRegion} onChange=${(e) => setNewCRegion(e.target.value)}>
            ${Object.entries(REGION_LABELS).filter(([k]) => k !== 'systemic').map(([k, v]) => html`<option value=${k}>${v}</option>`)}
          </select>
          <button class="opt ${newCLevel === 'yellow' ? 'sel' : ''}" onClick=${() => setNewCLevel('yellow')}>gelb</button>
          <button class="opt ${newCLevel === 'red' ? 'sel' : ''}" onClick=${() => setNewCLevel('red')}>rot</button>
          <button class="opt" onClick=${() => actions.addConstraint(newCRegion, newCLevel)}>＋ anlegen</button>
        </div>
        <p class="subtle" style="font-size:12px;margin-top:8px">gelb = Alternative wählen (schwer belastende Übungen raus) · rot = Region sperren. Knie berücksichtigt zusätzlich die Beugetiefe der Übungen.</p>
      </div>
      <div class="gen-preview">
        <b>${units.length} Krafteinheit${units.length === 1 ? '' : 'en'}</b> · ${sc.sets}×${sc.reps} (${sc.label}) · geplant für morgen, berücksichtigt aktuelle Ermüdung ${'&'} Schmerz<br/>
        ${units.map((u) => html`<span><b>${u.unit}:</b> ${u.exercises.map((id) => mk(id) + ' ' + cat.exById[id].name).join(', ')}<br/></span>`)}
      </div>
      ${gaps.map((g) => html`<div class="gap-hint"><b>Lücke: ${g.label}</b><br/>${g.note} Vorschlag: ${g.fixIds.map((id) => cat.exById[id].name).join(', ')} in Push einstreuen.</div>`)}
      <button class="act-btn primary" onClick=${actions.regenerate}>Plan neu generieren</button>
    </div>
    <div class="eyebrow" style="margin-top:24px">Daten</div>
    <div class="settings-card">
      <div class="f-lbl">Daten</div>
      <button class="act-btn" onClick=${actions.exportData}>Als JSON exportieren</button>
      <button class="act-btn" onClick=${actions.loadDemo}>Demo-Woche laden (Referenz-Szenario)</button>
      <button class="act-btn danger" onClick=${actions.resetData}>Zurücksetzen</button>
    </div>`;
}
