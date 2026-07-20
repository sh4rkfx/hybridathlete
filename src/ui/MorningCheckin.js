// Morning check-in (~30 s): fatigue traffic light only for regions with load
// in the last 72 h (spec §6.3).
import { html } from './html.js';
import { useState, useMemo } from 'preact/hooks';
import { hoursBetween } from '../engine/time.js';
import { regionLoad } from '../engine/load.js';
import { REGION_LABELS, FAT_LABELS } from '../engine/texts.js';
import { catalogOf } from '../engine/catalog.js';

export function MorningCheckin({ state, now, onClose, onSave }) {
  const cat = catalogOf(state);
  const regions = useMemo(() => {
    const set = new Set();
    state.logs.forEach((l) => {
      if (hoursBetween(l.date, now) <= 72) {
        Object.keys(regionLoad(l, cat)).forEach((r) => { if (r !== 'systemic' && r !== 'knee') set.add(r); });
      }
    });
    return [...set].slice(0, 6);
  }, [state.logs]);

  const [levels, setLevels] = useState(() => Object.fromEntries(regions.map((r) => [r, 'fresh'])));

  return html`<div class="overlay show" aria-hidden="false">
    <div class="ov-head"><button class="oh-close" onClick=${onClose} aria-label="Abbrechen">✕</button><span class="oh-title">Morgen-Check-in</span><span style="width:38px"></span></div>
    <div class="ov-body">
      <div class="step"><div class="s-k">Guten Morgen</div><h2>Wie fühlst du dich?</h2>
      <p class="s-hint">Nur Regionen mit Last aus den letzten 72 h. Ein Tap pro Region.</p>
      ${regions.length ? regions.map((r) => html`
        <div class="region-block"><div class="rb-name">${REGION_LABELS[r]}</div><div class="segmented">
          ${['fresh', 'caution', 'stop'].map((v) => html`
            <div class="seg ${levels[r] === v ? 'sel v-' + v : ''}" onClick=${() => setLevels({ ...levels, [r]: v })}>
              <span class="seg-mark m-${v}"></span><span class="seg-lbl">${FAT_LABELS[v]}</span>
            </div>`)}
        </div></div>`) : html`<div class="subtle">Keine relevante Last in den letzten 72 h – alles frisch.</div>`}
      </div>
    </div>
    <div class="ov-foot"><button class="next-btn" onClick=${() => onSave(levels)}>Fertig</button></div>
  </div>`;
}
