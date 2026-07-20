// Garmin import panel (spec §6.7): file picker (FIT/TCX/ZIP) -> drafts with
// prefilled type/duration/hm; the user only adds sRPE (~10 s) and confirms.
// Re-importing the same activity never duplicates (garminActivityId).
import { html } from './html.js';
import { useState } from 'preact/hooks';
import { wdShort } from '../engine/time.js';
import { catalogOf } from '../engine/catalog.js';
import { sportUi } from './sportsUi.js';
import { rpeMeta, fmtDur } from './helpers.js';
import { parseFile, toDraftLog } from './garmin.js';
import * as store from './store.js';

function DraftRow({ log, cat, onConfirm, onDiscard }) {
  const [sRPE, setSRPE] = useState(5);
  const m = rpeMeta(sRPE);
  return html`<div class="session-card" style="margin-bottom:10px;flex-wrap:wrap">
    <span class="sc-icon">${sportUi(log.sportId).emoji}</span>
    <div style="flex:1;min-width:0">
      <div class="sc-t">${cat.sports[log.sportId].name} · Entwurf</div>
      <div class="sc-s">${wdShort(log.date)} · ${fmtDur(log.duration)}${log.elevationGain ? ' · ' + log.elevationGain + ' hm' : ''}${log.distance ? ' · ' + log.distance + ' km' : ''}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;width:100%;margin-top:10px">
      <button class="sbtn" onClick=${() => setSRPE(Math.max(1, sRPE - 1))}>−</button>
      <span style="font-family:var(--font-mono);color:${m.c};min-width:86px;text-align:center">sRPE ${sRPE} · ${m.w}</span>
      <button class="sbtn" onClick=${() => setSRPE(Math.min(10, sRPE + 1))}>+</button>
      <button class="opt sel" style="margin-left:auto" onClick=${() => onConfirm(log.id, sRPE)}>Bestätigen</button>
      <button class="opt" onClick=${() => onDiscard(log.id)}>✕</button>
    </div>
  </div>`;
}

export function GarminImport({ state, toast }) {
  const cat = catalogOf(state);
  const [busy, setBusy] = useState(false);
  const drafts = state.draftLogs ?? [];

  const onFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const activities = [];
      for (const f of files) activities.push(...await parseFile(f));
      if (!activities.length) { toast('Keine verwertbaren Aktivitäten gefunden', 'stop'); return; }
      const added = store.addDraftLogs(activities.map((a) => toDraftLog(a, store.uid)));
      const dup = activities.length - added;
      toast(`${added} Aktivität${added === 1 ? '' : 'en'} importiert` + (dup ? ` · ${dup} Duplikat${dup === 1 ? '' : 'e'} übersprungen` : '') + (added ? ' – sRPE ergänzen' : ''));
    } catch (err) {
      console.error(err);
      toast('Import fehlgeschlagen: ' + err.message, 'stop');
    } finally {
      setBusy(false);
    }
  };

  return html`<div>
    <p class="subtle" style="font-size:12.5px;margin-bottom:10px">Aktivitäten landen als <b>Entwurf</b> – erst mit sRPE-Bestätigung zählen sie. Doppelimporte werden erkannt.</p>
    <label class="act-btn" style="display:block;text-align:center;cursor:pointer">
      ${busy ? 'Import läuft …' : 'Dateien wählen'}
      <input type="file" multiple accept=".fit,.tcx,.zip" style="display:none" onChange=${onFiles} disabled=${busy} />
    </label>
    ${drafts.length ? html`
      <div class="f-lbl" style="margin-top:14px">Entwürfe (${drafts.length})</div>
      ${drafts.map((d) => html`<${DraftRow} key=${d.id} log=${d} cat=${cat}
        onConfirm=${(id, sRPE) => { store.confirmDraft(id, sRPE); toast('Übernommen – Woche neu bewertet'); }}
        onDiscard=${(id) => store.discardDraft(id)} />`)}` : ''}
  </div>`;
}
