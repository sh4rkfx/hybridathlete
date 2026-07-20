// R1 — Pain-monitoring model (Silbernagel 2007, rct). Tier 1: overrides all
// lower rules. Strength sessions try exercise-level swap first; fixed sessions
// are never moved/removed (reduce instead).
import { hoursBetween } from '../../engine/time.js';
import { REGION_LABELS } from '../../engine/texts.js';
import { futurePlanned, sessionLoadsRegion, sug } from '../../engine/planner.js';
import { swapProposal, exNames } from '../../engine/swap.js';
import { ruleParams } from '../params.js';

export const TIER = 1;

export function triggers(state, now) {
  const p = ruleParams('R1');
  return state.pain.some((e) => hoursBetween(e.ts, now) <= p.painWindowHours && e.nrs > p.nrsGreenMax);
}

export function run({ state, now, catalog, push }) {
  const p = ruleParams('R1');
  state.pain.filter((e) => hoursBetween(e.ts, now) <= p.painWindowHours).forEach((pain) => {
    const region = pain.region;
    const nrs = pain.nrs;
    if (nrs <= p.nrsGreenMax) return;
    futurePlanned(state, now).forEach((pl) => {
      if (!sessionLoadsRegion(pl, region, catalog)) return;
      // Exercise level first: plan the painful exercises out, keep the rest.
      if (pl.sportId === 'strength') {
        const sw = swapProposal(pl, [region], state.profile, catalog);
        if (sw) {
          const names = (ids) => exNames(ids, catalog);
          push(sug('R1', TIER, 'swap', pl,
            nrs > p.redAbove
              ? `Dein ${REGION_LABELS[region]} meldet klaren Schmerz (NRS ${nrs}). ${names(sw.drop)} fliegt aus dem Plan${sw.repl.length ? ` – dafür ${names(sw.repl)}` : ''}. ${names(sw.keep)} kannst du schmerzfrei trainieren.`
              : `Dein ${REGION_LABELS[region]} zwickt (NRS ${nrs}). Plan ${names(sw.drop)} diesmal raus${sw.repl.length ? `, dafür ${names(sw.repl)}` : ''} – der Rest der Einheit ist frei.`,
            (nrs > p.redAbove
              ? 'Über NRS 5 ist die Region für Belastung gesperrt (Pain-Monitoring-Model). '
              : 'NRS 3–5 ist im Rahmen, solange der Schmerz nicht steigt. ')
              + `Nur Übungen, die ${REGION_LABELS[region]} schwer belasten, werden getauscht.`,
            { exercises: sw.proposed, adjusted: true }, sw));
          return;
        }
      }
      if (nrs > p.redAbove) {
        if (pl.fixed) {
          push(sug('R1', TIER, 'reduce', pl,
            `Dein ${REGION_LABELS[region]} meldet klaren Schmerz (NRS ${nrs}). ${catalog.sports[pl.sportId].name} ist fix – geh's heute deutlich zurück, große Griffe, kein Limit.`,
            'NRS >5 bedeutet: die Region rausnehmen. Da die Einheit fix ist, statt streichen: stark abschwächen.'));
        } else {
          push(sug('R1', TIER, 'remove', pl,
            `Bei NRS ${nrs} im ${REGION_LABELS[region]} gehört diese Einheit gestrichen. Gib der Struktur Ruhe, bevor du sie wieder belastest.`,
            'Über NRS 5 ist die Region für Belastung gesperrt (Pain-Monitoring-Model).'));
        }
      } else {
        push(sug('R1', TIER, 'reduce', pl,
          `Dein ${REGION_LABELS[region]} zwickt leicht (NRS ${nrs}). Trainier ruhig, aber halt's unter der Schmerzgrenze – und schau, dass es morgen nicht schlimmer ist.`,
          'NRS 3–5 ist im Rahmen, solange der Schmerz danach nicht steigt und am Folgetag zurück ist.'));
      }
    });
  });
}
