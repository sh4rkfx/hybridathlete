// The rolling weekly account (kickoff step 5, "Wochenkonto"). Pure module.
//
// Two stages a day, because the two numbers become known at different times:
//   morning   plan    base intake, corrected by the standing balance (max +/-250)
//   during    shift   150 kcal pulled FORWARD out of the base, plus intra-session
//                     carbohydrate on long sessions
//   evening   actual  real TDEE from the source -> real deficit -> difference
//                     onto the account
//
// The asymmetry principle is the design, not a detail. Every rule here is bent
// so that error falls on the same side every time rather than on average:
//
//   compensation rounds DOWN              -> systematically under-compensated
//   an overshoot is repaid, a shortfall   -> no eating back "credit"
//     expires on the spot
//   no expenditure data -> nothing booked -> no estimate, no assumption
//
// Sign convention, matching targets.js: a positive `shortfallKcal` means the day
// missed its planned deficit — ate too much — and goes on the account as debt to
// be worked off. A negative one means the day beat its deficit, and that simply
// evaporates.
//
// Reason codes are internal; flags.js (step 6) gives the user-facing ones their
// wording.
import { DEFAULT_CONFIG } from './config.js';
import { daysBetween } from './trend.js';

export const REASONS = {
  NO_EXPENDITURE_DATA: 'NO_EXPENDITURE_DATA',
  NO_INTAKE_DATA: 'NO_INTAKE_DATA',
  NO_DEFICIT_LONG_SESSION: 'NO_DEFICIT_LONG_SESSION',
  SHORTFALL_EXPIRED: 'SHORTFALL_EXPIRED',
  LEDGER_SATURATED: 'LEDGER_SATURATED',
};

// What the morning target should be adjusted by. Debt on the account is worked
// off by eating less, so the correction is negative; targets.dailyTarget caps it
// again and refuses to push the intake through the hard floor.
//
// A structural limit worth knowing about: the account can only ever reduce
// intake down to the hard floor, so its real daily headroom is
// (restDayTdee - hardFloor) - phaseDeficit, not maxDailyCorrectionKcal. For the
// reference profile that is about 31 kcal/day against a 250 kcal cap, i.e. the
// cap never binds and tuning it changes nothing. Asserted in the ledger tests.
export function ledgerCorrectionKcal(balanceKcal, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  if (!cfg.ledger.enabled || !Number.isFinite(balanceKcal) || balanceKcal <= 0) return 0;
  return -Math.min(balanceKcal, cfg.ledger.maxDailyCorrectionKcal);
}

// Intra-day redistribution. The 150 kcal are moved forward out of the base, not
// added to it: if the session falls through, the user has still eaten only
// their base, so the risk of over-eating on a cancelled session is structurally
// zero rather than merely small.
//
// The carbohydrate rule is a gate, and deliberately discontinuous: it applies
// only to sessions over 90 minutes, and then covers from hour two onward. A
// 91-minute session therefore jumps straight to ~21 g. That is the kickoff's
// literal reading — the gate exists so short sessions never trigger it at all.
export function redistribution(session, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const minutes = Number.isFinite(session?.durationMinutes) ? session.durationMinutes : 0;
  const intraSessionCarbsG = minutes > 90
    ? cfg.compensation.intraSessionCarbsGPerHour * ((minutes - 60) / 60)
    : 0;
  return {
    preSessionKcal: cfg.compensation.preSessionRedistributionKcal,
    pulledFromBase: true,
    intraSessionCarbsG,
  };
}

// Evening reconciliation for one day.
//
// `noDeficitAboveActiveKcal` lands here rather than in the morning target: the
// day's active energy is not known when the base intake is set, so the only
// honest place to drop the deficit is afterwards. The day then goes onto the
// account with a target deficit of zero and the difference flows out over the
// following days.
export function eveningReconcile(day, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const {
    date, plannedDeficitKcal = 0, actualIntakeKcal, actualTdeeKcal, exerciseKcal, factor = 1,
  } = day ?? {};
  const reasons = [];

  const calibratedActiveKcal = Number.isFinite(exerciseKcal)
    ? exerciseKcal * (Number.isFinite(factor) ? factor : 1)
    : null;

  if (!Number.isFinite(actualTdeeKcal)) reasons.push(REASONS.NO_EXPENDITURE_DATA);
  if (!Number.isFinite(actualIntakeKcal)) reasons.push(REASONS.NO_INTAKE_DATA);
  if (reasons.length) {
    return {
      date, shortfallKcal: null, bookedKcal: 0, actualDeficitKcal: null,
      targetDeficitKcal: plannedDeficitKcal, calibratedActiveKcal, reasons,
    };
  }

  let targetDeficitKcal = plannedDeficitKcal;
  if (calibratedActiveKcal != null && calibratedActiveKcal > cfg.compensation.noDeficitAboveActiveKcal) {
    targetDeficitKcal = 0;
    reasons.push(REASONS.NO_DEFICIT_LONG_SESSION);
  }

  const actualDeficitKcal = actualTdeeKcal - actualIntakeKcal;
  const shortfallKcal = targetDeficitKcal - actualDeficitKcal;
  // Only an overshoot is booked. Beating the deficit expires immediately —
  // the account never hands back credit to eat.
  const bookedKcal = shortfallKcal > 0 ? shortfallKcal : 0;
  if (shortfallKcal < 0) reasons.push(REASONS.SHORTFALL_EXPIRED);

  return { date, shortfallKcal, bookedKcal, actualDeficitKcal, targetDeficitKcal, calibratedActiveKcal, reasons };
}

// The standing balance: everything booked but not yet worked off, ignoring
// anything older than `surplusExpiresAfterDays` — an overshoot from three weeks
// ago is not a debt worth carrying. Capped at `capKcal`, which is reported
// rather than silently swallowed.
//
// Entries: { date, bookedKcal, correctionAppliedKcal }, the second being how
// much of the balance a later day actually worked off.
export function ledgerBalance(entries, now, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const reasons = [];
  if (!cfg.ledger.enabled) return { balanceKcal: 0, nEntries: 0, expiredKcal: 0, saturated: false, reasons };

  let balance = 0;
  let expired = 0;
  let counted = 0;
  for (const entry of entries ?? []) {
    if (entry?.date == null) continue;
    const age = daysBetween(entry.date, now);
    const booked = Number.isFinite(entry.bookedKcal) ? entry.bookedKcal : 0;
    const worked = Number.isFinite(entry.correctionAppliedKcal) ? Math.abs(entry.correctionAppliedKcal) : 0;
    if (age > cfg.ledger.surplusExpiresAfterDays) { expired += booked; continue; }
    balance += booked - worked;
    counted++;
  }

  balance = Math.max(0, balance);
  const saturated = balance > cfg.ledger.capKcal;
  if (saturated) { balance = cfg.ledger.capKcal; reasons.push(REASONS.LEDGER_SATURATED); }

  return { balanceKcal: balance, nEntries: counted, expiredKcal: expired, saturated, reasons };
}

// Rolling assessment window (kickoff: rolling, not the calendar week). Used to
// check that the week landed on its intended deficit.
export function windowSummary(entries, now, config) {
  const cfg = config ?? DEFAULT_CONFIG;
  const inWindow = (entries ?? []).filter((entry) => entry?.date != null
    && daysBetween(entry.date, now) < cfg.ledger.windowDays);
  const sum = (key) => inWindow.reduce((total, entry) => total + (Number.isFinite(entry[key]) ? entry[key] : 0), 0);
  return {
    days: inWindow.length,
    targetDeficitKcal: sum('targetDeficitKcal'),
    actualDeficitKcal: sum('actualDeficitKcal'),
    shortfallKcal: sum('targetDeficitKcal') - sum('actualDeficitKcal'),
  };
}
