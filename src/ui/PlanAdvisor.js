// Plan advisor card (story #32): pick active sports + available strength days,
// get a justified split recommendation, accept it explicitly — the app never
// changes the plan unasked.
import { html } from './html.js';
import { useState } from 'preact/hooks';
import { recommendPlan } from '../engine/advisor.js';
import { recommendWeek } from '../engine/week.js';
import { addDays, dOnly, WD } from '../engine/time.js';
import { catalogOf, SPLITS } from '../engine/catalog.js';
import { sportUi, SportGlyph } from './sportsUi.js';

const LVL_LABEL = { 'meta-analysis': 'Meta-Analyse', rct: 'RCT', cohort: 'Kohorte', 'expert-consensus': 'Experten-Konsens', assumption: 'Annahme' };
const LVL_CLASS = { 'meta-analysis': 'meta', rct: 'rct', cohort: 'cohort', 'expert-consensus': 'expert', assumption: 'assumption' };

export function PlanAdvisor({ state, now, actions, toast }) {
  const cat = catalogOf(state);
  const p = state.profile;
  const active = p.activeSports ?? [];
  const days = Math.max(1, Math.min(5, p.trainingDays ?? 3));
  const [rec, setRec] = useState(null);

  const otherSports = Object.values(cat.sports).filter((s) => s.id !== 'strength');

  return html`<div>
    <div class="field"><div class="f-lbl">Ich mache außerdem</div><div class="opt-row">
      ${otherSports.map((s) => html`<button class="opt ${active.includes(s.id) ? 'sel' : ''}" onClick=${() => { actions.toggleActiveSport(s.id); setRec(null); }}><${SportGlyph} id=${s.id} /> ${s.name}</button>`)}
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

    <${WeekWizard} state=${state} now=${now} actions=${actions} />
  </div>`;
}

/* ---------- Story #55: declare the whole week, the coach builds the plan ---------- */
const WISHABLE = ['bouldering', 'mountain_day', 'running', 'gravel_cycling'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mo..So

function WeekWizard({ state, now, actions }) {
  const cat = catalogOf(state);
  const p = state.profile;
  const [wishes, setWishes] = useState(() => structuredClone(p.weekWishes ?? {}));
  const [week, setWeek] = useState(null);

  const wishOf = (id) => wishes[id] ?? { count: 0, fixedDays: [], preferredDays: [], optional: id === 'running' };
  const patchWish = (id, fn) => {
    const w = structuredClone(wishOf(id));
    fn(w);
    setWishes({ ...wishes, [id]: w });
    setWeek(null);
  };
  const toggleDay = (id, wd) => patchWish(id, (w) => {
    const key = w.fixed ? 'fixedDays' : 'preferredDays';
    // days live in ONE list depending on the fix switch
    const list = w.fixed ? (w.fixedDays ?? []) : (w.preferredDays ?? []);
    w[key] = list.includes(wd) ? list.filter((x) => x !== wd) : [...list, wd];
  });

  const sports = WISHABLE.filter((id) => (p.activeSports ?? []).includes(id));

  return html`<div class="field" style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
    <div class="f-lbl">Ganze Woche planen</div>
    <p class="subtle" style="font-size:12.5px;margin-bottom:10px">Beschreib deine Woche einmal – der Coach platziert alles regelkonform: fixe Termine zuerst, Kraft in die Fenster, optionale Läufe zuletzt.</p>
    ${sports.map((id) => {
      const w = wishOf(id);
      const selDays = w.fixed ? (w.fixedDays ?? []) : (w.preferredDays ?? []);
      return html`<div class="wish-row">
        <div class="wish-head">
          <span class="wish-name"><${SportGlyph} id=${id} /> ${cat.sports[id]?.name ?? id}</span>
          <div class="opt-row" style="gap:4px">${[0, 1, 2, 3].map((n) => html`
            <button class="opt sm ${w.count === n ? 'sel' : ''}" onClick=${() => patchWish(id, (x) => { x.count = n; })}>${n}×</button>`)}</div>
        </div>
        ${w.count > 0 ? html`<div class="wish-days">
          ${WD_ORDER.map((wd) => html`<button class="opt sm ${selDays.includes(wd) ? 'sel' : ''}" onClick=${() => toggleDay(id, wd)}>${WD[wd]}</button>`)}
          <button class="opt sm ${w.fixed ? 'sel-toggle' : ''}" title="Gewählte Tage sind fixe Termine" onClick=${() => patchWish(id, (x) => {
            x.fixed = !x.fixed;
            // move the chosen days into the matching list
            if (x.fixed) { x.fixedDays = [...(x.preferredDays ?? []), ...(x.fixedDays ?? [])]; x.preferredDays = []; }
            else { x.preferredDays = [...(x.fixedDays ?? []), ...(x.preferredDays ?? [])]; x.fixedDays = []; }
          })}>📌 fix</button>
        </div>` : ''}
      </div>`;
    })}
    <button class="act-btn primary" onClick=${() => setWeek(recommendWeek(p, wishes, state, now))}>Wochenplan berechnen</button>

    ${week ? html`<div class="why" style="margin-top:12px">
      <div class="wl">Wochen-Vorschlag</div>
      <div class="week-preview">
        ${Array.from({ length: 7 }, (_, d) => {
          const day = addDays(dOnly(now), d);
          const s = week.sessions.find((x) => x.dayOffset === d);
          return html`<div class="wp-day ${s ? '' : 'empty'}">
            <div class="wp-lbl">${WD[day.getDay()]}</div>
            ${s ? html`<${SportGlyph} id=${s.sportId} size=${16} />
              <div class="wp-meta">${s.sportId === 'strength' ? s.unit : ''}${s.fixed ? ' 📌' : ''}</div>` : html`<div class="wp-meta">–</div>`}
          </div>`;
        })}
      </div>
      ${week.conflicts.map((c) => html`<div class="gap-hint" style="margin-top:8px"><b>${c.rule}:</b> ${c.reason}</div>`)}
      <div style="margin-top:10px">
        ${week.rationale.slice(0, 4).map((r) => html`<div style="margin-bottom:7px">
          <div class="wt" style="font-size:12.5px">${r.text}</div>
          <div class="evi" style="margin-top:2px"><span class="lvl ${LVL_CLASS[r.evidenceLevel] ?? ''}">${LVL_LABEL[r.evidenceLevel] ?? r.evidenceLevel}</span>
            <span class="subtle" style="font-size:11px">${r.source}</span></div>
        </div>`)}
      </div>
      <div class="sug-actions" style="margin-top:10px">
        <button class="btn btn-accept" onClick=${() => { actions.applyWeekPlan(week, wishes); setWeek(null); }}>Woche übernehmen</button>
        <button class="btn btn-reject" onClick=${() => setWeek(null)}>Verwerfen</button>
      </div>
    </div>` : ''}
  </div>`;
}
