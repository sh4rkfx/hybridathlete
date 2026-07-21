import { html } from './html.js';
import { RULE_META } from '../engine/texts.js';

export function RulebookScreen({ state }) {
  return html`
    <div class="eyebrow">Vertrauen</div><h1 class="title">Regelwerk</h1>
    <p class="subtle">Jede Empfehlung kommt aus einer Regel mit Quelle und Evidenzgrad. Nichts ist erfunden.</p>
    <div style="margin-top:16px">
      ${Object.entries(RULE_META).map(([id, r]) => {
        const st = state.ruleStats[id] || { up: 0, down: 0 };
        return html`<div class="rule-item">
          <div class="ri-head"><span class="ri-id">${id}</span><span class="lvl-badge ${r.lvl}">${r.lvlLabel}</span></div>
          <div class="ri-name">${r.name}</div>
          <div class="ri-src">${r.src}</div>
          ${r.links?.length ? html`<div class="ri-links">
            ${r.links.map((l) => html`<a class="src-link" href=${l.url} target="_blank" rel="noopener noreferrer">${l.label} ↗</a>`)}
          </div>` : ''}
          <div class="ri-foot"><span class="vote">Angenommen <b>${st.up}</b> · Abgelehnt <b>${st.down}</b></span></div>
        </div>`;
      })}
    </div>`;
}
