// German wording for the energy module, looked up by code (kickoff: messages
// belong in a locale file, not in the domain). The domain emits
// { code, params } and nothing else; this is where that becomes a sentence.
//
// First runtime consumer of src/i18n/de.json — until now the file was precached
// and asserted by tests but never read by the app.
import de from '../i18n/de.json' with { type: 'json' };

const N = de.nutrition;

// Numbers arrive as raw floats from the domain. Rounding here rather than at
// every call site keeps "23.999999999 %" out of the UI.
function fmt(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    if (Number.isInteger(value)) return String(value);
    return Math.abs(value) >= 100 ? String(Math.round(value)) : value.toFixed(2).replace(/\.?0+$/, '');
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
}

function interpolate(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in params ? fmt(params[key]) : whole));
}

function lookup(bucket, code, params) {
  const template = N?.[bucket]?.[code];
  // A missing key is a bug the messages test should have caught; showing the
  // raw code beats showing nothing, and it is obvious in review.
  return template ? interpolate(template, params) : code;
}

export const flagMessage = (flag) => lookup('flags', flag.code, { ...flag.params, path: flag.path });
export const flagAction = (flag) => lookup('actions', flag.suggestedAction, {});
export const errorMessage = (issue) => lookup('errors', issue.code, { ...issue.params, path: issue.path });
export const warningMessage = (issue) => lookup('warnings', issue.code, { ...issue.params, path: issue.path });

export const LEVEL_LABEL = { stop: 'Stopp', warn: 'Achtung', info: 'Hinweis' };
export const LEVEL_CLASS = { stop: 'v-stop', warn: 'v-caution', info: 'v-fresh' };
