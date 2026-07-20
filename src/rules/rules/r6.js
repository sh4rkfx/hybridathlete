// R6 — Strength/endurance interference (meta-analysis, honestly weak effect,
// hence tier 5): same-day heavy-leg strength + endurance closer than 6 h.
import { hoursBetween, dOnly } from '../../engine/time.js';
import { futurePlanned, isHeavyLowerBody, sug } from '../../engine/planner.js';
import { ruleParams } from '../params.js';

export const TIER = 5;

const ENDURANCE = ['running', 'gravel_cycling'];

export function triggers(state, now, catalog) {
  const minGap = ruleParams('R6').minHoursBetweenStrengthEndurance;
  const byDay = groupByDay(state, now);
  return Object.values(byDay).some((list) => {
    const str = list.find((p) => p.sportId === 'strength' && isHeavyLowerBody(p, catalog) && !p.fixed);
    const end = list.find((p) => ENDURANCE.includes(p.sportId));
    return str && end && hoursBetween(str.date, end.date) < minGap;
  });
}

function groupByDay(state, now) {
  const byDay = {};
  futurePlanned(state, now).forEach((pl) => {
    const k = dOnly(pl.date).getTime();
    (byDay[k] = byDay[k] || []).push(pl);
  });
  return byDay;
}

export function run({ state, now, catalog, push, sugs }) {
  const minGap = ruleParams('R6').minHoursBetweenStrengthEndurance;
  Object.values(groupByDay(state, now)).forEach((list) => {
    const str = list.find((p) => p.sportId === 'strength' && isHeavyLowerBody(p, catalog));
    const end = list.find((p) => ENDURANCE.includes(p.sportId));
    if (str && end && !str.fixed) {
      const gap = hoursBetween(str.date, end.date);
      if (gap < minGap && !sugs.some((s) => s.targetId === str.id)) {
        push(sug('R6', TIER, 'move', str,
          `Beinkraft und Ausdauer liegen heute nah beieinander (${Math.round(gap)} h). Zieh die Krafteinheit in einen früheren Slot oder mach sie zuerst – das schützt die Kraftanpassung.`,
          'Interferenz tritt v. a. bei enger, gleichtägiger Kombination auf; ≥6 h Abstand und Kraft vor Ausdauer mildern das.'));
      }
    }
  });
}
