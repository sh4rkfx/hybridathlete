// Shared UI selectors/formatters on top of the engine (all pure).
import { addDays, dOnly, isSameDay, wdShort, SLOT_HOUR, SLOT_LABEL } from '../engine/time.js';
export { SLOT_HOUR, SLOT_LABEL };
import { srpeTL } from '../engine/load.js';
import { estPlannedTL, latestFatigue } from '../engine/planner.js';
import { catalogOf } from '../engine/catalog.js';
import { acwrZone } from '../engine/acwr.js';

export const MONTHS = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];

export const catalog = catalogOf; // convenience re-export

// Weekly-load headline (story #27): without a chronic base an ACWR of 0.00 is
// not "Untertrainiert" — it is simply no data yet.
export function zoneWording(a) {
  if (!a.chronicWk) return { zone: 'neutral', word: 'Noch keine Daten', ratioLabel: '–' };
  const zone = acwrZone(a.ratio);
  const word = {
    fresh: 'Im grünen Bereich',
    caution: a.ratio < 0.8 ? 'Untertrainiert' : 'Erhöht – aufpassen',
    stop: 'Überlast',
  }[zone];
  return { zone, word, ratioLabel: a.ratio.toFixed(2) };
}

// First-run detection (story #27): nothing planned (removed doesn't count) and
// nothing logged -> Home shows the onboarding block instead of empty sections.
export function needsOnboarding(state) {
  return state.logs.length === 0 && !state.planned.some((p) => p.status !== 'removed');
}

// Setup guidance (story #36): with no strength sessions planned, the advisor
// section opens as the guided default entry; otherwise everything starts
// collapsed and the status card is the map.
export function initialSetupSection(state) {
  const hasStrength = state.planned.some((p) => p.sportId === 'strength' && p.status !== 'removed');
  return hasStrength ? null : 'advisor';
}

export function nextLoggable(state, now) {
  const up = state.planned
    .filter((p) => p.status !== 'removed' && p.status !== 'skipped' && new Date(p.date) >= addDays(now, -0.3) && !p.loggedId)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return up[0] || null;
}

// Story #39: recovery strip shows SIGNAL only — non-fresh regions. All fresh
// -> empty list, the UI renders one positive chip instead of filler.
export function currentRegionStatus(state, now) {
  const regions = ['shoulder', 'fingers', 'forearm', 'elbow', 'quads', 'core', 'upper_back', 'lower_back', 'posterior_chain', 'calves', 'chest', 'triceps'];
  return regions
    .map((r) => ({ r, level: latestFatigue(state, r, now)?.level ?? 'fresh' }))
    .filter((x) => x.level !== 'fresh');
}

// Story #39: check-in state for today — done flag for the home card and the
// saved levels so reopening the check-in shows what was entered.
export function checkinDoneToday(state, now) {
  return state.fatigue.some((f) => f.context === 'morning_checkin' && isSameDay(f.ts, now));
}

export function todayCheckinLevels(state, now) {
  const levels = {};
  state.fatigue
    .filter((f) => f.context === 'morning_checkin' && isSameDay(f.ts, now))
    .sort((a, b) => new Date(a.ts) - new Date(b.ts))
    .forEach((f) => { levels[f.region] = f.level; });
  return levels;
}

export function upcomingSessions(state, now, n = 4) {
  return state.planned
    .filter((p) => new Date(p.date) >= dOnly(now))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, n);
}

// Ridge data: last 7 days + tomorrow of daily sRPE-TL (planned future estimated).
export function ridgeData(state, now) {
  const days = [];
  for (let i = 6; i >= -1; i--) days.push(addDays(dOnly(now), -i));
  const vals = days.map((d) => {
    let tl = 0;
    state.logs.forEach((l) => { if (isSameDay(l.date, d)) tl += srpeTL(l); });
    state.planned.forEach((p) => { if (p.status !== 'removed' && isSameDay(p.date, d) && new Date(p.date) > now) tl += estPlannedTL(p); });
    return tl;
  });
  const max = Math.max(...vals, 1);
  const W = 340, H = 118, top = 18, bot = 100;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, bot - (v / max) * (bot - top)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(0) + ',' + p[1].toFixed(0)).join(' ');
  return { days, pts, line, area: line + ` L${W},${H} L0,${H} Z`, W, H, top, todayIdx: 6 };
}

export function rpeMeta(v) {
  if (v <= 3) return { c: 'var(--fresh)', w: 'locker' };
  if (v <= 6) return { c: 'var(--brand-hi)', w: 'moderat' };
  if (v <= 8) return { c: 'var(--caution)', w: 'hart' };
  return { c: 'var(--stop)', w: v >= 10 ? 'maximal' : 'sehr hart' };
}

export function fmtDur(min) {
  return min >= 120
    ? Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0') + ' h'
    : min + ' min';
}

export function dayLabel(d, now) {
  return isSameDay(d, now) ? 'Heute' : wdShort(d) + ' ' + new Date(d).getDate() + '.';
}
