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

// Plausible demo working weights so set prefill + R9 progression are
// experiencable immediately (story #50). Fallback 40 kg for anything else.
const DEMO_WEIGHTS = {
  barbell_bench_press: 62.5, incline_barbell_press: 55, dumbbell_bench_press: 26,
  overhead_barbell_press: 42.5, seated_dumbbell_shoulder_press: 20, close_grip_bench_press: 50,
  dumbbell_arnold_press: 18, dumbbell_lateral_raise: 10, db_overhead_triceps_extension: 22,
  box_squat: 85, goblet_squat: 24, romanian_deadlift: 90, standing_calf_raise: 60,
  conventional_deadlift: 100, barbell_hip_thrust: 80, seated_calf_raise: 50,
  plank: 0, hanging_leg_raise: 0, ab_wheel_rollout: 0, db_side_bend: 20, pallof_press_band: 0,
};

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

  // One past strength session per generated unit (a week ago) with real
  // per-set rows — feeds prefill and the R9 progression demo (story #50).
  state.setLogs = [];
  [{ unit: legsUnit, daysAgo: 6 }, { unit: pushUnit, daysAgo: 8 }].forEach(({ unit, daysAgo }) => {
    if (!unit) return;
    const when = atHour(addDays(now, -daysAgo), 17);
    const log = mkLog('strength', when, 60, 6, { sets: unit.exercises.map((exerciseId) => ({ exerciseId })) });
    state.logs.push(log);
    unit.exercises.forEach((exerciseId) => {
      const w = DEMO_WEIGHTS[exerciseId] ?? 40;
      [8, 7, 6].forEach((reps, i) => {
        state.setLogs.push({
          setId: uid(), logId: log.id, exerciseId, setIndex: i,
          weight: w, reps, date: log.date, ...(i === 2 ? { rir: 2 } : {}),
        });
      });
    });
  });
}
