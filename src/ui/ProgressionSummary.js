// Post-log coach moment (story #50): per-exercise R9 verdicts right after a
// strength session — next weight / hold / build reps, with why and e1RM.
import { html } from './html.js';
import { useOverlayA11y } from './overlayA11y.js';
import { catalogOf } from '../engine/catalog.js';

const fmtW = (w) => (Math.round(w * 100) / 100).toString().replace('.', ',');

export function ProgressionSummary({ state, items, onClose }) {
  const a11yRef = useOverlayA11y(onClose);
  const cat = catalogOf(state);
  return html`<div class="overlay show" role="dialog" aria-modal="true" tabindex="-1" ref=${a11yRef} aria-hidden="false">
    <div class="ov-head"><button class="oh-close" onClick=${onClose} aria-label="Schließen">✕</button><span class="oh-title">Coach · Progression</span><span style="width:38px"></span></div>
    <div class="ov-body">
      <div class="s-k">Nach deinem Krafttag</div>
      <h2>So geht's weiter</h2>
      <p class="s-hint" style="margin-bottom:14px">Vorschläge nach R9 (double progression, RIR-skaliert, Geräteschritt). Sie befüllen dein nächstes Training vor – ändern kannst du dort immer.</p>
      ${items.map((a) => {
        const e = cat.exById[a.exerciseId];
        const up = a.action === 'increase';
        const title = up
          ? html`${e.name}: <b style="color:var(--fresh)">${fmtW(a.nextWeight)} kg</b> nächstes Mal (+${fmtW(a.deltaKg)})`
          : a.action === 'hold'
            ? html`${e.name}: <b>${fmtW(a.nextWeight)} kg</b> halten`
            : html`${e.name}: Wiederholungen ausbauen`;
        return html`<div class="prog-card ${up ? 'up' : ''}">
          <div class="pc-t">${title}</div>
          <div class="pc-s">${a.why}</div>
          <div class="pc-m">e1RM ≈ ${fmtW(a.e1rm)} kg (Epley, bester Satz) · ${a.equipment} · Schritt ${fmtW(a.stepKg)} kg</div>
        </div>`;
      })}
      <div class="evi" style="margin-top:6px"><span class="lvl expert">Experten-Konsens</span>
        <span class="subtle" style="font-size:11px">R9: Autoregulations-Prinzip meta-analytisch gestützt; Schrittgrößen = Gerätepraxis. e1RM ist eine Schätzung.</span></div>
    </div>
    <div class="ov-foot"><button class="next-btn" onClick=${onClose}>Verstanden</button></div>
  </div>`;
}
