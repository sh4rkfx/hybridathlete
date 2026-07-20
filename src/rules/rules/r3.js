// R3 — Tendon/pulley recovery (expert-consensus, explicitly low evidence).
// >= 48 h between two high finger loads; fixed sessions get reduce, never move.
import { hoursBetween } from '../../engine/time.js';
import { futurePlanned, sessionLoadsRegion, sug } from '../../engine/planner.js';
import { ruleParams } from '../params.js';

export const TIER = 4;

function lastHardFingerLog(state, catalog) {
  return state.logs
    .filter((l) => catalog.sports[l.sportId].flags.tendonHeavy && l.hardFingerLoad)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

export function triggers(state, now, catalog) {
  const minGap = ruleParams('R3').minHoursBetweenHighFingerLoad;
  const last = lastHardFingerLog(state, catalog);
  if (!last) return false;
  return futurePlanned(state, now).some((pl) =>
    sessionLoadsRegion(pl, 'fingers', catalog) && hoursBetween(pl.date, last.date) < minGap);
}

export function run({ state, now, catalog, push }) {
  const minGap = ruleParams('R3').minHoursBetweenHighFingerLoad;
  const lastFinger = lastHardFingerLog(state, catalog);
  if (!lastFinger) return;
  futurePlanned(state, now).forEach((pl) => {
    if (!sessionLoadsRegion(pl, 'fingers', catalog)) return;
    const gap = hoursBetween(pl.date, lastFinger.date);
    if (gap < minGap) {
      if (pl.fixed) {
        push(sug('R3', TIER, 'reduce', pl,
          `Deine Finger hatten gestern harte Last und sind noch müde. ${catalog.sports[pl.sportId].name} bleibt (fix) – aber mach eine Volumen-Session statt am Limit zu crimpen. Offene Hand, große Griffe.`,
          `Sehnen/Ringbänder erholen langsamer als Muskeln. Zwischen zwei harten Finger-Reizen sollten ~48 h liegen (${Math.round(gap)} h geplant).`));
      } else {
        push(sug('R3', TIER, 'move', pl,
          `Zwischen deiner harten Finger-Session gestern und dieser hier liegen nur ${Math.round(gap)} h. Schieb sie etwas nach hinten, damit die Ringbänder nachkommen.`,
          '~48 h Erholung zwischen harten Finger-Reizen (konservativer Praxis-Richtwert).'));
      }
    }
  });
}
