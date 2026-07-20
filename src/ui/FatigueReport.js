// Manual fatigue report (story #39): a small dialog to flag a region as müde/
// platt outside the check-in/log flows — feeds R5 like any other entry.
import { html } from './html.js';
import { useOverlayA11y } from './overlayA11y.js';
import { useState } from 'preact/hooks';
import { REGION_LABELS, FAT_LABELS } from '../engine/texts.js';

const REPORTABLE = Object.keys(REGION_LABELS).filter((r) => r !== 'systemic' && r !== 'knee');

export function FatigueReport({ onClose, onSave }) {
  const a11yRef = useOverlayA11y(onClose);
  const [region, setRegion] = useState('fingers');
  const [level, setLevel] = useState('caution');

  return html`<div class="overlay show" role="dialog" aria-modal="true" tabindex="-1" ref=${a11yRef} aria-hidden="false">
    <div class="ov-head"><button class="oh-close" onClick=${onClose} aria-label="Abbrechen">✕</button><span class="oh-title">Ermüdung melden</span><span style="width:38px"></span></div>
    <div class="ov-body">
      <div class="s-k">Zwischenstand</div><h2>Was meldet sich?</h2>
      <p class="s-hint">Für alles außerhalb von Log und Check-in – die Engine plant sofort damit.</p>
      <div class="region-block"><div class="rb-name">Region</div>
        <select class="csel" style="width:100%" value=${region} onChange=${(e) => setRegion(e.target.value)}>
          ${REPORTABLE.map((r) => html`<option value=${r}>${REGION_LABELS[r]}</option>`)}
        </select>
      </div>
      <div class="region-block" style="margin-top:14px"><div class="rb-name">Zustand</div>
        <div class="segmented">
          ${['fresh', 'caution', 'stop'].map((v) => html`
            <div class="seg ${level === v ? 'sel v-' + v : ''}" onClick=${() => setLevel(v)}>
              <span class="seg-mark m-${v}"></span><span class="seg-lbl">${FAT_LABELS[v]}</span>
            </div>`)}
        </div>
        <p class="s-hint" style="margin-top:8px">müde → nächste Einheit lockerer · platt → Region erst mal raus.</p>
      </div>
    </div>
    <div class="ov-foot"><button class="next-btn" onClick=${() => onSave(region, level)}>Speichern</button></div>
  </div>`;
}
