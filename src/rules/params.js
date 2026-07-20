// Access to the declarative rule catalog. Rules read their thresholds from
// here — nothing is hardcoded in the rule modules (catalog _meta contract).
// Suggestions carry the short rule id (R1..R8); catalog ids are R1_pain etc.
import catalog from './catalog.json' with { type: 'json' };

const byShortId = Object.fromEntries(catalog.rules.map((r) => [r.ruleId.split('_')[0], r]));

export function ruleDef(shortId) { return byShortId[shortId]; }
export function ruleParams(shortId) { return byShortId[shortId]?.params ?? {}; }
export function ruleActive(shortId) { return byShortId[shortId]?.active !== false; }
export const CATALOG = catalog;
