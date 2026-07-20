// R4 — Eccentric fatigue / DOMS after mountain descents (cohort). Recovery
// window 48–72 h scaled by elevation gain (the scaling is an ASSUMPTION, spec
// §3.1/O5; repeated-bout effect deliberately not modeled — full window applies).
// Strength sessions in the window: swap leg loaders first; hollow-out guard
// falls back to move (non-fixed) / reduce (fixed).
import { hoursBetween } from '../../engine/time.js';
import { futurePlanned, isHeavyLowerBody, sug } from '../../engine/planner.js';
import { swapProposal, exNames } from '../../engine/swap.js';
import { ruleParams } from '../params.js';

export const TIER = 4;

function lastEccentricLog(state, catalog) {
  return state.logs
    .filter((l) => catalog.sports[l.sportId].flags.eccentric)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

export function recoveryWindowHours(elevationGain) {
  const f = ruleParams('R4').windowFormula;
  const hm = elevationGain || f.hmBase;
  return f.baseHours + Math.min(f.maxExtraHours, ((hm - f.hmBase) / f.hmRange) * f.maxExtraHours);
}

export function triggers(state, now, catalog) {
  const last = lastEccentricLog(state, catalog);
  if (!last) return false;
  return hoursBetween(now, last.date) <= recoveryWindowHours(last.elevationGain);
}

export function run({ state, now, catalog, push }) {
  const p = ruleParams('R4');
  const lastEcc = lastEccentricLog(state, catalog);
  if (!lastEcc) return;
  const hm = lastEcc.elevationGain || p.windowFormula.hmBase;
  const windowH = recoveryWindowHours(lastEcc.elevationGain);
  const sinceEcc = hoursBetween(now, lastEcc.date);
  if (sinceEcc > windowH) return;
  const minSpacing = p.typicalMoveSpacingHours[0];

  futurePlanned(state, now).forEach((pl) => {
    if (pl.sportId !== 'strength' || !isHeavyLowerBody(pl, catalog)) return;
    const afterEcc = hoursBetween(pl.date, lastEcc.date);
    if (afterEcc >= minSpacing) return;

    const sw = swapProposal(pl, p.affectedRegions, state.profile, catalog);
    if (sw) {
      const names = (ids) => exNames(ids, catalog);
      push(sug('R4', TIER, 'swap', pl,
        `Dein Bergtag (${hm} hm) steckt noch in den Beinen. Lass ${names(sw.drop)} diesmal weg${sw.repl.length ? ` – dafür ${names(sw.repl)}` : ''}. Der Rest der Einheit bleibt, wie er ist.`,
        'Exzentrischer Abstieg trifft vor allem Quads, hintere Kette und Waden (Peak 24–72 h). Statt die ganze Einheit zu verschieben, tauscht HybridAthlete nur die betroffenen Übungen.',
        { exercises: sw.proposed, adjusted: true }, sw));
    } else if (!pl.fixed) {
      push(sug('R4', TIER, 'move', pl,
        `Dein Bergtag (${hm} hm) steckt noch in den Beinen. Leg die schwere Beineinheit auf ≥48 h nach dem Abstieg – deine Quads brauchen das Fenster wirklich.`,
        'Exzentrischer Abstieg verursacht Muskelschaden mit Peak 24–72 h. Training obendrauf bringt wenig und erhöht das Risiko.'));
    } else {
      push(sug('R4', TIER, 'reduce', pl,
        `Nach ${hm} hm Abstieg sind die Beine noch nicht erholt. Diese Einheit ist fix – nimm Volumen und Last runter.`,
        'DOMS peakt 24–72 h nach exzentrischer Last.'));
    }
  });
}
