// Demo-week loader (UI dev aid + reviewable walkthrough): reproduces the
// reference scenario from the prototype/dashboard — 4 weeks of reduced base
// load, a mountain day 30 h ago, a hard finger session 20 h ago, and a week
// planned "blind" before those events. The engine then produces the three
// textbook suggestions (R3 reduce, R4 move, R7 remove).
import { atHour, addDays, dOnly, slotOfHour } from '../engine/time.js';
import { generateStrength } from '../engine/generator.js';
import { uid } from '../engine/planner.js';

const mkLog = (sportId, when, dur, sRPE, extra = {}) => ({
  id: uid(), sportId, date: new Date(when).toISOString(), slot: slotOfHour(new Date(when).getHours()),
  duration: dur, sRPE, source: 'manual', sets: [], ...extra,
});
const mkFat = (region, level, when) => ({ id: uid(), region, level, ts: new Date(when).toISOString(), context: 'post_session' });
const mkPlanned = (sportId, when, slot, fixed, extra = {}) => ({
  id: uid(), sportId, date: new Date(when).toISOString(), slot, fixed: !!fixed, status: 'planned', reduced: false, ...extra,
});

export function loadDemoWeek(state, now) {
  state.logs = [];
  state.fatigue = [];
  state.pain = [];
  for (let i = 28; i >= 3; i--) {
    const day = addDays(now, -i);
    const wd = day.getDay();
    if (wd === 2 || wd === 4) state.logs.push(mkLog('bouldering', atHour(day, 18), 75, 6));
    if (wd === 1) state.logs.push(mkLog('running', atHour(day, 7), 40, 4, { distance: 7 }));
    if (wd === 6) state.logs.push(mkLog('gravel_cycling', atHour(day, 10), 120, 5, { distance: 55 }));
  }
  const hAgo = (h) => new Date(now.getTime() - h * 36e5);
  state.logs.push(mkLog('mountain_day', hAgo(30), 330, 7, { elevationGain: 1150 }));
  state.logs.push(mkLog('bouldering', hAgo(20), 90, 7, { hardFingerLoad: true }));
  state.fatigue.push(mkFat('quads', 'caution', hAgo(28)));
  state.fatigue.push(mkFat('calves', 'caution', hAgo(28)));
  state.fatigue.push(mkFat('fingers', 'caution', hAgo(18)));

  const hr = (h) => { const x = new Date(now); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + h); return x; };
  const at = (dOff, hour) => atHour(addDays(dOnly(now), dOff), hour);
  const planned = [];
  const boulderToday = hr(3);
  planned.push(mkPlanned('bouldering', boulderToday, slotOfHour(boulderToday.getHours()), true));
  const strength = generateStrength(state.profile);
  const legsUnit = strength.find((u) => u.unit === 'legs');
  const pushUnit = strength.find((u) => u.unit === 'push');
  // Slot derived from the actual hour so card time and week-view column match.
  const legsAt = hr(12);
  if (legsUnit) planned.push(mkPlanned('strength', legsAt, slotOfHour(legsAt.getHours()), false, { unit: 'legs', exercises: legsUnit.exercises }));
  if (pushUnit) planned.push(mkPlanned('strength', at(2, 17), slotOfHour(17), false, { unit: 'push', exercises: pushUnit.exercises }));
  planned.push(mkPlanned('bouldering', at(2, 18), 'evening', true));
  planned.push(mkPlanned('running', at(3, 7), 'morning', false, { distance: 10 }));
  planned.push(mkPlanned('mountain_day', at(5, 9), 'morning', true, { hm: 1200 }));
  state.planned = planned;
  state.rejected = {};
}
