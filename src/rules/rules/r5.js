// R5 — General muscular recovery (expert-consensus). Fatigue traffic light per
// region: müde (caution) -> 24–48 h reduced reloading, platt (stop) -> 48–72 h
// no heavy reloading. Strength sessions try exercise-level swap first (also on
// fixed sessions — fixed protects timing, not content).
import { hoursBetween } from '../../engine/time.js';
import { REGION_LABELS } from '../../engine/texts.js';
import { futurePlanned, latestFatigue, sessionLoadsRegion, sug } from '../../engine/planner.js';
import { swapProposal, exNames } from '../../engine/swap.js';
import { ruleParams } from '../params.js';

export const TIER = 4;

// Regions the rule watches (regions that carry meaningful load >= 2 in V1 sports).
export const R5_REGIONS = ['quads', 'posterior_chain', 'shoulder', 'upper_back', 'fingers', 'forearm'];

export function triggers(state, now) {
  return R5_REGIONS.some((r) => {
    const f = latestFatigue(state, r, now);
    return f && f.level !== 'fresh';
  });
}

export function run({ state, now, catalog, push, sugs }) {
  const p = ruleParams('R5');
  const cautionWindow = p.yellowReloadHours[1]; // 48 h
  const stopWindow = p.redReloadHours[1]; // 72 h
  R5_REGIONS.forEach((region) => {
    const f = latestFatigue(state, region, now);
    if (!f || f.level === 'fresh') return;
    futurePlanned(state, now).forEach((pl) => {
      if (hoursBetween(pl.date, f.ts) > (f.level === 'stop' ? stopWindow : cautionWindow)) return;
      if (!sessionLoadsRegion(pl, region, catalog)) return;
      if (sugs.some((s) => s.targetId === pl.id)) return; // dedupe with higher tiers

      // Exercise level first: swap affected exercises instead of touching the session.
      if (pl.sportId === 'strength') {
        const sw = swapProposal(pl, [region], state.profile, catalog);
        if (sw) {
          const names = (ids) => exNames(ids, catalog);
          const lvlWord = f.level === 'stop' ? 'platt' : 'müde';
          push(sug('R5', TIER, 'swap', pl,
            `Dein ${REGION_LABELS[region]} ist noch ${lvlWord}. Bau die Einheit leicht um: ${names(sw.drop)} raus${sw.repl.length ? `, dafür ${names(sw.repl)}` : ''}. Timing und Rest bleiben.`,
            (f.level === 'stop' ? 'Platt = die Region braucht 48–72 h. ' : 'Müde = 24–48 h mit reduzierter Last. ')
              + `Nur die Übungen, die ${REGION_LABELS[region]} schwer belasten, werden getauscht.`,
            { exercises: sw.proposed, adjusted: true }, sw));
          return;
        }
      }
      if (pl.fixed) return; // fixed sessions are handled by the R3/R4 reduce paths
      if (f.level === 'stop') {
        push(sug('R5', TIER, 'move', pl,
          `Dein ${REGION_LABELS[region]} ist noch platt. Gib der Region 2–3 Tage, bevor du sie wieder schwer belastest – schieb die Einheit.`,
          'Platt = die Region braucht 48–72 h, bevor sie wieder schwer belastet wird.'));
      } else {
        push(sug('R5', TIER, 'reduce', pl,
          `Dein ${REGION_LABELS[region]} ist noch müde. Diese Einheit belastet ihn – nimm heute das Volumen etwas raus.`,
          'Müde = 24–48 h mit reduzierter Last wiederbelasten.'));
      }
    });
  });
}
