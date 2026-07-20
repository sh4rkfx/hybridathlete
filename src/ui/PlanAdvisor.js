// Plan advisor card (story #32): pick active sports + available strength days,
// get a justified split recommendation, accept it explicitly — the app never
// changes the plan unasked.
import { html } from './html.js';
import { useState } from 'preact/hooks';
import { recommendPlan } from '../engine/advisor.js';
import { catalogOf, SPLITS } from '../engine/catalog.js';
import { sportUi } from './sportsUi.js';
import { WD } from '../engine/time.js';
import { addDays, dOnly } from '../engine/time.js';

const LVL_LABEL = { 'meta-analysis': 'Meta-Analyse', rct: 'RCT', cohort: 'Kohorte', 'expert-consensus': 'Experten-Konsens', assumption: 'Annahme' };
const LVL_CLASS = { 'meta-analysis': 'meta', rct: 'rct', cohort: 'cohort', 'expert-consensus': 'expert', assumption: 'assumption' };

export function PlanAdvisor({ state, now, actions, toast }) {
  const cat = catalogOf(state);
  const p = state.profile;
  const active = p.activeSports ?? [];
  const days = Math.max(1, Math.min(5, p.trainingDays ?? 3));
  const [rec, setRec] = useState(null);

  const otherSports = Object.values(cat.sports).filter((s) => s.id !== 'strength');

  return html`<div class="settings-card" style="margin-top:16px">
    <div class="f-lbl">Plan-Berater</div>
    <p class="subtle" style="font-size:12.5px;margin-bottom:10px">Sag, was du sonst machst und wie oft du Kraft trainieren kannst — die Empfehlung rechnet ein, was deine anderen Sportarten schon abdecken.</p>
    <div class="field"><div class="f-lbl">Ich mache außerdem</div><div class="opt-row">
      ${otherSports.map((s) => html`<button class="opt ${active.includes(s.id) ? 'sel' : ''}" onClick=${() => { actions.toggleActiveSport(s.id); setRec(null); }}>${sportUi(s.id).emoji} ${s.name}</button>`)}
    </div></div>
    <div class="field"><div class="f-lbl">Krafttage pro Woche</div><div class="opt-row">
      ${[1, 2, 3, 4, 5].map((n) => html`<button class="opt ${days === n ? 'sel' : ''}" onClick=${() => { actions.setTrainingDays(n); setRec(null); }}>${n}</button>`)}
    </div></div>
    <button class="act-btn primary" onClick=${() => setRec(recommendPlan(p, state))}>Empfehlung berechnen</button>

    ${rec ? html`<div class="why" style="margin-top:14px">
      <div class="wl">Empfehlung</div>
      <div class="wt" style="font-weight:600">
        ${SPLITS[rec.split].label} · ${rec.trainingDays} Tag${rec.trainingDays === 1 ? '' : 'e'}/Woche ·
        ${rec.assignment.map((u, i) => `${WD[addDays(dOnly(now), rec.dayOffsets[i]).getDay()]} ${u}`).join(' · ')}
      </div>
      <div class="wt" style="margin-top:6px">
        ${rec.coveredUnits.length ? `Ohne ${rec.coveredUnits.join('/')}-Unit — abgedeckt durch deine Sportarten. ` : ''}
        Frequenz je Unit ≈ ${rec.perUnitFrequency}×/Woche.
      </div>
      ${rec.gaps.map((g) => html`<div class="gap-hint" style="margin-top:8px"><b>Lücke: ${g.label}</b><br/>${g.note}. Einstreu-Vorschlag: ${g.fixIds.map((id) => cat.exById[id]?.name ?? id).join(', ')}.</div>`)}
      <div style="margin-top:10px">
        ${rec.rationale.map((r) => html`<div style="margin-bottom:8px">
          <div class="wt" style="font-size:12.5px">${r.text}</div>
          <div class="evi" style="margin-top:3px"><span class="lvl ${LVL_CLASS[r.evidenceLevel] ?? ''}">${LVL_LABEL[r.evidenceLevel] ?? r.evidenceLevel}</span>
            <span class="subtle" style="font-size:11px">${r.source}</span></div>
        </div>`)}
      </div>
      <div class="sug-actions" style="margin-top:10px">
        <button class="btn btn-accept" onClick=${() => { actions.applyRecommendation(rec); setRec(null); }}>Übernehmen</button>
        <button class="btn btn-reject" onClick=${() => setRec(null)}>Verwerfen</button>
      </div>
    </div>` : ''}
  </div>`;
}
