// R7 — ACWR weekly load steering (cohort, contested — lowest tier). Projects
// the ratio at the planning-horizon end (today + 6 d, 23:00): logs still inside
// the 7-day window then + estimated load of everything still planned. Above the
// danger threshold it proposes removing a NON-FIXED add-on (typically running).
import { hoursBetween, dOnly, addDays, atHour, wdShort } from '../../engine/time.js';
import { srpeTL } from '../../engine/load.js';
import { acwr } from '../../engine/acwr.js';
import { futurePlanned, estPlannedTL, sug } from '../../engine/planner.js';
import { ruleParams } from '../params.js';

export const TIER = 6;
export const HORIZON_DAYS = 6; // rolling planning horizon (current week + 48 h overhang)

export function projectedRatio(state, now) {
  const base = acwr(state.logs, now);
  const horizonEnd = atHour(addDays(dOnly(now), HORIZON_DAYS), 23);
  let projAcute = 0;
  state.logs.forEach((l) => {
    const h = hoursBetween(l.date, horizonEnd);
    if (new Date(l.date) <= horizonEnd && h <= 24 * 7) projAcute += srpeTL(l);
  });
  futurePlanned(state, now).forEach((pl) => {
    if (new Date(pl.date) <= horizonEnd && pl.status !== 'removed') projAcute += estPlannedTL(pl);
  });
  return base.chronicWk > 0 ? projAcute / base.chronicWk : 0;
}

export function triggers(state, now) {
  return projectedRatio(state, now) > ruleParams('R7').zones.danger.min;
}

export function run({ state, now, push }) {
  const danger = ruleParams('R7').zones.danger.min;
  const projRatio = projectedRatio(state, now);
  if (projRatio <= danger) return;
  const run_ = futurePlanned(state, now).find((p) => p.sportId === 'running' && !p.fixed);
  if (run_) {
    push(sug('R7', TIER, 'remove', run_,
      `Deine Woche läuft nach der ruhigen Phase heiß: prognostizierte ACWR ≈ ${projRatio.toFixed(2)} (Sweet Spot 0.8–1.3). Bergtag und Boulderabende sind fix – der Lauf am ${wdShort(run_.date)} ist der einzige frei bewegliche Baustein. Streich ihn diese Woche und halte den Rest moderat.`,
      'Sweet Spot mit niedrigstem Risiko: 0,8–1,3. Über 1,5 steigt das Risiko deutlich (mit bekannter methodischer Kritik).'));
  }
}
