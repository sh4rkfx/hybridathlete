// CSV / JSON import panel for the energy module (kickoff step 7). Sits inside
// the Setup energy section, like GarminImport.
//
// Deviation from the Garmin flow, deliberately: that importer writes parsed
// activities straight to the store as `draft: true` rows, because the rule
// engine loads everything and must not see unconfirmed data. Here nothing but
// this component holds the parsed rows until the user confirms, so the preview
// needs no draft store and an abandoned import leaves nothing behind.
import { html } from './html.js';
import { useState } from 'preact/hooks';
import {
  parseText, detectMapping, mapRows, mappingProblems, IMPORT_FIELDS,
} from '../adapters/FileImportAdapter.js';

const PROBLEM_TEXT = {
  NO_DATE_COLUMN: 'Keine Datumsspalte zugeordnet – ohne Datum lässt sich kein Tag zuordnen.',
  NOTHING_TO_IMPORT: 'Außer dem Datum ist nichts zugeordnet.',
  INVALID_JSON: 'Die Datei ist kein gültiges JSON.',
  NO_ROWS: 'In der Datei steht keine Liste von Tagen.',
};

const problemText = (code) => PROBLEM_TEXT[code]
  ?? (code.startsWith('DUPLICATE:') ? `Doppelt zugeordnet: ${code.slice(10)}.` : code);

const preview = (day) => Object.entries(day)
  .filter(([key]) => key !== 'date')
  .map(([key, value]) => `${IMPORT_FIELDS.find((f) => f.key === key)?.label ?? key}: ${value}`)
  .join(' · ');

export function EnergyImport({ actions, toast }) {
  const [parsed, setParsed] = useState(null);   // { headers, rows, filename }
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);

  const onFiles = async (e) => {
    const [file] = [...e.target.files];
    // Reset immediately so picking the same file again re-fires the change.
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const result = parseText(await file.text(), file.name);
      if (result.error || !result.rows.length) {
        toast(problemText(result.error ?? 'NO_ROWS'), 'stop');
        setParsed(null);
        return;
      }
      setParsed({ ...result, filename: file.name });
      setMapping(detectMapping(result.headers));
    } catch (err) {
      console.error(err);
      toast('Import fehlgeschlagen: ' + err.message, 'stop');
    } finally {
      setBusy(false);
    }
  };

  const problems = parsed ? mappingProblems(mapping) : [];
  const result = parsed && !problems.length ? mapRows(parsed.rows, mapping) : null;

  const confirm = () => {
    actions.importDays(result.days);
    toast(`${result.days.length} Tag${result.days.length === 1 ? '' : 'e'} importiert`);
    setParsed(null);
    setMapping({});
  };

  return html`<div>
    <p class="s-hint">CSV oder JSON aus einer anderen App. Die Spalten werden vorgeschlagen und du bestätigst sie –
      vorhandene Tage werden ergänzt, nicht überschrieben.</p>

    <label class="act-btn" style="display:block;text-align:center;cursor:pointer">
      ${busy ? 'Lese Datei …' : 'Datei wählen'}
      <input type="file" accept=".csv,.tsv,.txt,.json" style="display:none" onChange=${onFiles} disabled=${busy} />
    </label>

    ${!parsed ? '' : html`<div class="imp">
      <div class="imp-head">${parsed.filename} · ${parsed.rows.length} Zeile${parsed.rows.length === 1 ? '' : 'n'}</div>

      ${parsed.headers.map((header) => html`<div class="c-add">
        <span class="imp-col">${header}</span>
        <select class="csel" value=${mapping[header] ?? ''}
          onChange=${(e) => setMapping({ ...mapping, [header]: e.target.value || null })}>
          <option value="">– ignorieren –</option>
          ${IMPORT_FIELDS.map((f) => html`<option value=${f.key}>${f.label}</option>`)}
        </select>
      </div>`)}

      ${problems.map((code) => html`<div class="gap-hint">${problemText(code)}</div>`)}

      ${result ? html`
        <div class="imp-head">Vorschau · ${result.days.length} Tag${result.days.length === 1 ? '' : 'e'}
          ${result.skipped.noDate ? ` · ${result.skipped.noDate} ohne Datum übersprungen` : ''}
          ${result.skipped.empty ? ` · ${result.skipped.empty} ohne Werte übersprungen` : ''}</div>
        ${result.days.slice(0, 5).map((day) => html`<div class="imp-row">
          <b>${day.date}</b><span>${preview(day)}</span>
        </div>`)}
        ${result.days.length > 5 ? html`<div class="imp-row subtle">… und ${result.days.length - 5} weitere</div>` : ''}
        <button class="act-btn primary" disabled=${!result.days.length} onClick=${confirm}>
          ${result.days.length} Tag${result.days.length === 1 ? '' : 'e'} übernehmen
        </button>` : ''}

      <button class="act-btn" onClick=${() => { setParsed(null); setMapping({}); }}>Abbrechen</button>
    </div>`}
  </div>`;
}
