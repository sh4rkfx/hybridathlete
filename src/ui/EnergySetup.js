// Setup panel for the energy module — the profile the domain needs before it
// can compute anything, plus the data source and the demo seeder. Rendered
// inside a SettingsScreen accordion section, like GarminImport.
//
// Config edits go straight through to actions on change, matching how the rest
// of Setup works; there is no local form state to get out of sync.
import { html } from './html.js';
import { nutritionConfig, setupGaps, parseNumber } from './energyHelpers.js';
import { errorMessage, warningMessage } from './nutritionText.js';
import { validate } from '../nutrition/config.js';

const SEX = [['male', 'männlich'], ['female', 'weiblich'], ['unspecified', 'keine Angabe']];
const GOALS = [['cut', 'Abnehmen'], ['maintain', 'Halten'], ['gain', 'Aufbauen']];
const SOURCES = [
  ['manual', 'Manuell', 'Du trägst Umsatz und Gewicht selbst ein.'],
  ['formula', 'Formel', 'BMR × PAL plus gemessene Trainingsminuten aus deinen Logs.'],
];

const GAP_LABEL = {
  birthDate: 'Geburtsdatum', heightCm: 'Größe', sex: 'Geschlecht',
  bodyComp: 'Körperfett oder fettfreie Masse', goalWeight: 'Zielgewicht',
};

function Field({ label, unit, value, onInput, type = 'text', placeholder }) {
  return html`<label class="nf">
    <span class="nf-l">${label}${unit ? html` <small>${unit}</small>` : ''}</span>
    <input class="nf-i" type=${type} inputmode=${type === 'date' ? undefined : 'decimal'}
      value=${value ?? ''} placeholder=${placeholder ?? '—'}
      onInput=${(e) => onInput(type === 'date' ? (e.target.value || null) : parseNumber(e.target.value))} />
  </label>`;
}

export function EnergySetup({ state, actions }) {
  const config = nutritionConfig(state);
  const gaps = setupGaps(config);
  const result = validate(state?.nutrition?.config ?? {});
  const p = config.profile;

  return html`<div>
    ${gaps.length ? html`<div class="gap-hint"><b>Noch offen:</b> ${gaps.map((g) => GAP_LABEL[g]).join(', ')}.
      Ohne diese Angaben gibt es keinen Ruheumsatz und damit keine Zielzufuhr.</div>` : ''}

    <div class="nf-grid">
      <${Field} label="Geburtsdatum" type="date" value=${p.birthDate} onInput=${(v) => actions.setProfileField({ birthDate: v })} />
      <${Field} label="Größe" unit="cm" value=${p.heightCm} onInput=${(v) => actions.setProfileField({ heightCm: v })} />
    </div>

    <div class="field"><div class="f-lbl">Geschlecht</div><div class="opt-row">
      ${SEX.map(([k, label]) => html`<button class="opt ${p.sex === k ? 'sel' : ''}"
        onClick=${() => actions.setProfileField({ sex: k })}>${label}</button>`)}
    </div></div>

    <div class="field"><div class="f-lbl">Körperzusammensetzung</div><div class="opt-row">
      ${[['bodyFatPct', 'Körperfett %'], ['ffm', 'FFM kg'], ['none', 'unbekannt']].map(([mode, label]) => html`
        <button class="opt ${p.bodyComp.mode === mode ? 'sel' : ''}"
          onClick=${() => actions.setProfileField({ bodyComp: { mode, value: mode === 'none' ? null : p.bodyComp.value } })}>${label}</button>`)}
    </div></div>
    ${p.bodyComp.mode !== 'none' ? html`<div class="nf-grid">
      <${Field} label=${p.bodyComp.mode === 'ffm' ? 'Fettfreie Masse' : 'Körperfett'} unit=${p.bodyComp.mode === 'ffm' ? 'kg' : '%'}
        value=${p.bodyComp.value} onInput=${(v) => actions.setProfileField({ bodyComp: { mode: p.bodyComp.mode, value: v } })} />
    </div>` : html`<p class="s-hint">Ohne Körperzusammensetzung fallen Katch und Cunningham weg und das Proteinziel greift auf die Untergrenze pro kg Körpergewicht zurück.</p>`}

    <div class="field"><div class="f-lbl">Ziel</div><div class="opt-row">
      ${GOALS.map(([k, label]) => html`<button class="opt ${config.goal.mode === k ? 'sel' : ''}"
        onClick=${() => actions.setGoalField({ mode: k })}>${label}</button>`)}
    </div></div>
    ${config.goal.mode !== 'maintain' ? html`<div class="nf-grid">
      <${Field} label="Zielgewicht" unit="kg" value=${config.goal.target?.valueKg}
        onInput=${(v) => actions.setGoalField({ target: { type: 'weight', valueKg: v } })} />
    </div>` : ''}

    <div class="field"><div class="f-lbl">Datenquelle</div><div class="opt-row">
      ${SOURCES.map(([k, label]) => html`<button class="opt ${config.energy.adapterId === k ? 'sel' : ''}"
        onClick=${() => actions.setAdapter(k)}>${label}</button>`)}
    </div></div>
    <p class="s-hint">${SOURCES.find(([k]) => k === config.energy.adapterId)?.[2]}</p>

    ${result.errors.map((e) => html`<div class="gap-hint"><b>Fehler:</b> ${errorMessage(e)}</div>`)}
    ${result.warnings.filter((w) => w.code !== 'CONFIG_UNKNOWN_FIELDS').map((w) => html`<p class="s-hint">${warningMessage(w)}</p>`)}

    <button class="act-btn" onClick=${actions.loadDemoEnergy}>Demo-Energiedaten laden (70 Tage Referenzprofil)</button>
  </div>`;
}
