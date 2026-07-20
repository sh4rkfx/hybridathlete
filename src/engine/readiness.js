// Per-exercise, date-dependent feasibility (spec §3.6): fresh | caution | stop
// plus ALL reasons (not just the first). Fed by the same signals as the rules:
// R2 constraints, R1 pain (36 h), R5 fatigue (48/72 h relative to the target
// date), R4 eccentric window. Consumers: session editor, log flow, generator,
// settings preview.
import { hoursBetween } from './time.js';
import { REGION_LABELS } from './texts.js';
import { catalogOf } from './catalog.js';
import { latestFatigue } from './planner.js';

export const READY_RANK = { fresh: 0, caution: 1, stop: 2 };

export function lastEccLog(state, catalog = catalogOf(state)) {
  return state.logs
    .filter((l) => catalog.sports[l.sportId].flags.eccentric)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

export function exerciseReadiness(exId, when, state, now = new Date()) {
  const catalog = catalogOf(state);
  const e = catalog.exById[exId];
  if (!e) return { level: 'fresh', reasons: [] };
  let level = 'fresh';
  const reasons = [];
  const bump = (lv, why) => { if (READY_RANK[lv] > READY_RANK[level]) level = lv; reasons.push(why); };

  // R2 — constraints (structural, time-independent). Knee uses the flexion tag,
  // every other region the load matrix (red >= 2 -> stop, yellow >= 3 -> caution).
  (state.profile.constraints || []).forEach((c) => {
    if (c.region === 'knee') {
      if (e.knee == null) return;
      if (c.level === 'red') bump('stop', 'Knie gesperrt (Constraint)');
      else if (e.knee === 'deep') bump('stop', 'Beugetiefe zu tief fürs Knie');
      else bump('caution', 'Knie-Constraint: moderate Beugetiefe');
    } else {
      const L = e.load[c.region] || 0;
      if (L >= 2 && c.level === 'red') bump('stop', REGION_LABELS[c.region] + ' gesperrt (Constraint)');
      else if (L >= 3 && c.level === 'yellow') bump('caution', REGION_LABELS[c.region] + '-Constraint (gelb)');
    }
  });

  // R1 — pain, 36 h window from the entry.
  state.pain.filter((p) => hoursBetween(p.ts, now) <= 36).forEach((p) => {
    const L = e.load[p.region] || 0;
    if (L < 2) return;
    if (p.nrs > 5) bump('stop', 'Schmerz ' + REGION_LABELS[p.region] + ' (NRS ' + p.nrs + ')');
    else if (p.nrs >= 3) bump('caution', 'Schmerz ' + REGION_LABELS[p.region] + ' (NRS ' + p.nrs + ')');
  });

  // R5 — fatigue: müde 48 h / platt 72 h relative to the TARGET date.
  Object.keys(e.load).forEach((region) => {
    if ((e.load[region] || 0) < 2 || region === 'systemic') return;
    const f = latestFatigue(state, region, now);
    if (!f || f.level === 'fresh') return;
    const h = hoursBetween(when, f.ts);
    if (f.level === 'stop' && h <= 72) bump('stop', REGION_LABELS[region] + ' platt');
    else if (f.level === 'caution' && h <= 48) bump('caution', REGION_LABELS[region] + ' müde');
  });

  // R4 — eccentric window (mountain day): leg regions until 48 h after descent.
  const ecc = lastEccLog(state, catalog);
  if (ecc) {
    const after = (new Date(when) - new Date(ecc.date)) / 36e5;
    if (after >= 0 && after < 48) {
      const legL = Math.max(e.load.quads || 0, e.load.posterior_chain || 0, e.load.calves || 0);
      if (legL >= 3) bump('stop', 'Bergtag vor ' + Math.round(after) + ' h – Beine im DOMS-Fenster');
      else if (legL >= 2) bump('caution', 'Bergtag vor ' + Math.round(after) + ' h');
    }
  }
  return { level, reasons };
}
