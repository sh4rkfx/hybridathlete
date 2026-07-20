import { html } from './html.js';
import { useState } from 'preact/hooks';
import { wdShort } from '../engine/time.js';
import { catalogOf } from '../engine/catalog.js';
import { exNames } from '../engine/swap.js';

const OP_COLOR = { swap: 'var(--fresh)', reduce: 'var(--caution)', move: 'var(--brand)', remove: 'var(--stop)' };
const OP_LABEL = { swap: 'Anpassen', reduce: 'Abschwächen', move: 'Verschieben', remove: 'Streichen' };

function SugCard({ s, state, onAccept, onReject }) {
  const [showSrc, setShowSrc] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const cat = catalogOf(state);
  const target = state.planned.find((p) => p.id === s.targetId);
  const when = target ? wdShort(target.date) : '';
  const names = (ids) => exNames(ids, cat);
  const leave = (fn) => { setLeaving(true); setTimeout(fn, 300); };

  return html`
    <article class="sug ${leaving ? 'leaving' : ''}" style="--op-color:${OP_COLOR[s.operation]};${leaving ? 'opacity:0;transform:translateX(40px);transition:opacity .3s ease, transform .3s ease' : ''}" data-key=${s.key}>
      <span class="op"><span class="dot"></span>${OP_LABEL[s.operation]}${when ? ' · ' + when : ''}</span>
      <p class="coach">${s.coach}</p>
      ${s.swap ? html`<div class="swap-box">
        <div class="sw-row out"><span class="sw-k">Raus</span><span>${names(s.swap.drop)}</span></div>
        ${s.swap.repl.length
          ? html`<div class="sw-row in"><span class="sw-k">Rein</span><span>${names(s.swap.repl)}</span></div>`
          : html`<div class="sw-row"><span class="sw-k">Ersatz</span><span>keiner nötig – Einheit wird kürzer</span></div>`}
        <div class="sw-row"><span class="sw-k">Bleibt</span><span>${names(s.swap.keep)}</span></div>
      </div>` : ''}
      <div class="why"><div class="wl">Warum</div><div class="wt">${s.why}</div>
        <div class="evi"><span class="rule">${s.ruleId} · ${s.ruleName}</span>
          <span class="lvl ${s.lvl}">${s.lvlLabel}</span>
          <button class="src-toggle" onClick=${() => setShowSrc(!showSrc)}>${showSrc ? 'Quelle ausblenden' : 'Quelle'}</button></div>
        <div class="src-full ${showSrc ? 'show' : ''}">${s.src}</div>
      </div>
      <div class="sug-actions">
        <button class="btn btn-accept" onClick=${() => leave(() => onAccept(s.key))}>Übernehmen</button>
        <button class="btn btn-reject" onClick=${() => setShowReasons(true)}>Ablehnen</button>
      </div>
      <div class="reasons ${showReasons ? 'show' : ''}">
        <span class="reason-chip" onClick=${() => leave(() => onReject(s.key, 'fit'))}>Fühle mich fit genug</span>
        <span class="reason-chip" onClick=${() => leave(() => onReject(s.key, 'fix'))}>Passt mir nicht</span>
        <span class="reason-chip" onClick=${() => leave(() => onReject(s.key, 'nc'))}>Nicht nachvollziehbar</span>
      </div>
    </article>`;
}

export function SuggestionInbox({ state, onAccept, onReject }) {
  const sugs = state.suggestions;
  return html`
    <div class="eyebrow">Vorschläge</div><h1 class="title">Dein Coach meldet sich</h1>
    <p class="subtle">${sugs.length} Anpassung${sugs.length === 1 ? '' : 'en'} für den Rest der Woche. Jede mit Begründung – du entscheidest.</p>
    <div class="fixed-note"><span class="fn-i">📌</span><span class="fn-t"><b>Fixe Einheiten</b> (Boulderabende, Bergtag) werden nie verschoben oder gestrichen – höchstens abgeschwächt.</span></div>
    <div id="sug-list">
      ${sugs.map((s) => html`<${SugCard} key=${s.key} s=${s} state=${state} onAccept=${onAccept} onReject=${onReject} />`)}
    </div>
    <div class="empty ${sugs.length === 0 ? 'show' : ''}"><div class="e-i">✓</div><div class="e-t">Alles entschieden</div><div class="e-s">Neue Vorschläge erscheinen nach dem nächsten Log oder Check-in.</div></div>`;
}
