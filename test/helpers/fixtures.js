// Fixture builders ported 1:1 from the normative test dashboard
// (docs/prototype/HybridAthlete_Test_Dashboard.html). Differences to the
// snapshot, both behavior-preserving:
//  - `now` is injected instead of a module-level `const NOW` (determinism),
//  - exercise ids use the full seed catalog (docs mapping: the prototype's
//    embedded subset carried identical load profiles under short ids, e.g.
//    barbell_row -> barbell_bent_over_row, overhead_press ->
//    overhead_barbell_press, single_arm_row -> single_arm_dumbbell_row).
import { atHour, addDays, dOnly, slotOfHour } from '../../src/engine/time.js';
import { generateStrength } from '../../src/engine/generator.js';
import { uid, resetIds } from '../../src/engine/planner.js';

export function mkLog(sportId, when, dur, sRPE, extra = {}) {
  return Object.assign({
    id: uid(), sportId, date: new Date(when).toISOString(),
    slot: slotOfHour(new Date(when).getHours()),
    duration: dur, sRPE, source: 'manual', sets: [],
  }, extra);
}

export function mkFat(region, level, when) {
  return { id: uid(), region, level, ts: new Date(when).toISOString(), context: 'post_session' };
}

export function mkPlanned(sportId, when, slot, fixed, extra = {}) {
  return Object.assign({
    id: uid(), sportId, date: new Date(when).toISOString(), slot,
    fixed: !!fixed, status: 'planned', reduced: false,
  }, extra);
}

// Demo-seed week (dashboard `buildWeek`): the week was planned "blind" before
// the recent events — exactly that mismatch produces the inbox suggestions.
export function buildWeek(db, now) {
  const planned = [];
  const hr = (h) => { const x = new Date(now); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + h); return x; };
  const at = (dOff, hour) => atHour(addDays(dOnly(now), dOff), hour);

  // 1) Bouldering TODAY, fixed, in ~3 h — log CTA + R3 target (reduce)
  const boulderToday = hr(3);
  planned.push(mkPlanned('bouldering', boulderToday, slotOfHour(boulderToday.getHours()), true));

  // 2) Strength from the generator (PPL without pull -> push + legs)
  const strength = generateStrength(db.profile);
  const legsUnit = strength.find((u) => u.unit === 'legs');
  const pushUnit = strength.find((u) => u.unit === 'push');

  // Legs in ~12 h, NOT fixed, midday — R4 target (move): mountain day was 30 h
  // ago -> spacing 42 h < 48 h
  if (legsUnit) planned.push(mkPlanned('strength', hr(12), 'midday', false, { unit: 'legs', exercises: legsUnit.exercises }));
  // Push in 2 days evening, not fixed
  if (pushUnit) planned.push(mkPlanned('strength', at(2, 17), 'evening', false, { unit: 'push', exercises: pushUnit.exercises }));

  // 3) Second bouldering in 2 days, fixed
  planned.push(mkPlanned('bouldering', at(2, 18), 'evening', true));
  // 4) Run in 3 days, not fixed — R7 candidate
  planned.push(mkPlanned('running', at(3, 7), 'morning', false, { distance: 10 }));
  // 5) Next mountain day in 5 days, fixed — fixed sessions stay untouched
  planned.push(mkPlanned('mountain_day', at(5, 9), 'morning', true, { hm: 1200 }));

  return planned;
}

// Dashboard `seed()`: 28 days of reduced base load (rehab-return scenario) so
// the planned big week produces a REAL ACWR spike (textbook ramp after a break),
// plus hour-precise recent events that arm the R3/R4 windows.
export function seed(now) {
  const profile = {
    goal: 'sport_support', days: 3, split: 'PPL', disabledUnits: ['pull'],
    constraints: [{ id: 'knee_flexion', region: 'knee', level: 'yellow', note: 'Linkes Knie, ~80–90° Flexion unter Last' }],
  };
  const logs = [];
  const fatigue = [];
  for (let i = 28; i >= 3; i--) {
    const day = addDays(now, -i);
    const wd = day.getDay();
    if (wd === 2 || wd === 4) logs.push(mkLog('bouldering', atHour(day, 18), 75, 6, {}));
    if (wd === 1) logs.push(mkLog('running', atHour(day, 7), 40, 4, { distance: 7 }));
    if (wd === 6) logs.push(mkLog('gravel_cycling', atHour(day, 10), 120, 5, { distance: 55 }));
  }
  const hAgo = (h) => new Date(now.getTime() - h * 36e5);
  logs.push(mkLog('mountain_day', hAgo(30), 330, 7, { elevationGain: 1150 })); // R4: eccentric, 30 h ago
  logs.push(mkLog('bouldering', hAgo(20), 90, 7, { hardFingerLoad: true }));   // R3: hard fingers, 20 h ago
  fatigue.push(mkFat('quads', 'caution', hAgo(28)));
  fatigue.push(mkFat('calves', 'caution', hAgo(28)));
  fatigue.push(mkFat('fingers', 'caution', hAgo(18)));

  const db = {
    profile, logs, fatigue, pain: [], planned: [], suggestions: [],
    ruleStats: { R1: { up: 12, down: 1 }, R2: { up: 6, down: 0 }, R3: { up: 9, down: 2 }, R4: { up: 8, down: 3 }, R5: { up: 7, down: 1 }, R6: { up: 4, down: 2 }, R7: { up: 5, down: 4 } },
    rejected: {},
  };
  db.planned = buildWeek(db, now);
  return db;
}

// Dashboard `freshDb()`: resets the id counter so fixtures are reproducible.
export function freshDb(now = new Date()) {
  resetIds();
  return seed(now);
}
