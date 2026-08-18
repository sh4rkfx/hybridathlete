// The rolling weekly account (kickoff step 5 and test 2, "Wochenkonto").
import { describe, it, expect } from 'vitest';
import {
  ledgerCorrectionKcal, redistribution, eveningReconcile, ledgerBalance, windowSummary, REASONS,
} from '../../src/nutrition/ledger.js';
import { dailyTarget, compensationKcal } from '../../src/nutrition/targets.js';
import { validate } from '../../src/nutrition/config.js';

const SEED_PROFILE = { birthDate: '1988-06-16', sex: 'male', heightCm: 173, bodyComp: { mode: 'bodyFatPct', value: 27.9 } };
const cfg = (over = {}) => validate({
  profile: SEED_PROFILE, goal: { mode: 'cut', target: { type: 'weight', valueKg: 75 } }, ...over,
}).normalized;
const iso = (day) => `2026-07-${String(day).padStart(2, '0')}`;

describe('morning correction', () => {
  it('works debt off by eating less, capped per day', () => {
    expect(ledgerCorrectionKcal(100, cfg())).toBe(-100);
    expect(ledgerCorrectionKcal(900, cfg())).toBe(-250);
  });

  it('never hands back credit', () => {
    expect(ledgerCorrectionKcal(0, cfg())).toBe(0);
    expect(ledgerCorrectionKcal(-500, cfg())).toBe(0);
    expect(ledgerCorrectionKcal(null, cfg())).toBe(0);
  });

  it('is inert when the ledger is disabled', () => {
    expect(ledgerCorrectionKcal(500, cfg({ ledger: { enabled: false } }))).toBe(0);
  });
});

describe('intra-day redistribution', () => {
  it('pulls 150 kcal forward out of the base rather than adding them', () => {
    const r = redistribution({ durationMinutes: 60 }, cfg());
    expect(r).toMatchObject({ preSessionKcal: 150, pulledFromBase: true });
  });

  it('adds no carbohydrate at or below 90 minutes', () => {
    for (const durationMinutes of [0, 45, 90]) {
      expect(redistribution({ durationMinutes }, cfg()).intraSessionCarbsG).toBe(0);
    }
  });

  it('covers from hour two on longer sessions', () => {
    expect(redistribution({ durationMinutes: 120 }, cfg()).intraSessionCarbsG).toBeCloseTo(40, 6);
    expect(redistribution({ durationMinutes: 180 }, cfg()).intraSessionCarbsG).toBeCloseTo(80, 6);
  });

  it('the 90-minute gate is a step, deliberately', () => {
    expect(redistribution({ durationMinutes: 90 }, cfg()).intraSessionCarbsG).toBe(0);
    expect(redistribution({ durationMinutes: 91 }, cfg()).intraSessionCarbsG).toBeCloseTo(20.67, 2);
  });

  it('handles a session without a duration', () => {
    expect(redistribution({}, cfg()).intraSessionCarbsG).toBe(0);
  });
});

describe('evening reconciliation', () => {
  const day = { date: iso(1), plannedDeficitKcal: 513, actualTdeeKcal: 2334, actualIntakeKcal: 1821 };

  it('books nothing when the day landed on plan', () => {
    const r = eveningReconcile(day, cfg());
    expect(r.actualDeficitKcal).toBe(513);
    expect(r.shortfallKcal).toBe(0);
    expect(r.bookedKcal).toBe(0);
  });

  it('books an overshoot as debt', () => {
    const r = eveningReconcile({ ...day, actualIntakeKcal: 2121 }, cfg());
    expect(r.shortfallKcal).toBe(300);
    expect(r.bookedKcal).toBe(300);
  });

  it('lets a shortfall expire — no eating back credit', () => {
    const r = eveningReconcile({ ...day, actualIntakeKcal: 1521 }, cfg());
    expect(r.shortfallKcal).toBe(-300);
    expect(r.bookedKcal).toBe(0);
    expect(r.reasons).toContain(REASONS.SHORTFALL_EXPIRED);
  });

  it('uses the actual TDEE, not the planned one', () => {
    // A bigger day than planned means the same intake produced a bigger deficit.
    const r = eveningReconcile({ ...day, actualTdeeKcal: 2900 }, cfg());
    expect(r.actualDeficitKcal).toBe(1079);
    expect(r.bookedKcal).toBe(0);
  });

  it('drops the deficit above noDeficitAboveActiveKcal, and only in the evening', () => {
    // 1000 kcal active x 0.95 = 950 > 800: the day's target deficit becomes 0,
    // so the difference flows onto the account rather than changing the base
    // intake that was already fixed that morning.
    const r = eveningReconcile({ ...day, exerciseKcal: 1000, factor: 0.95 }, cfg());
    expect(r.calibratedActiveKcal).toBe(950);
    expect(r.reasons).toContain(REASONS.NO_DEFICIT_LONG_SESSION);
    expect(r.targetDeficitKcal).toBe(0);
    expect(r.bookedKcal).toBe(0); // the day beat a target of zero
  });

  it('judges the 800 threshold on calibrated energy', () => {
    // 850 raw would trip it; 850 x 0.9 = 765 does not.
    expect(eveningReconcile({ ...day, exerciseKcal: 850, factor: 1 }, cfg()).targetDeficitKcal).toBe(0);
    expect(eveningReconcile({ ...day, exerciseKcal: 850, factor: 0.9 }, cfg()).targetDeficitKcal).toBe(513);
  });

  it('books nothing at all without expenditure or intake data', () => {
    expect(eveningReconcile({ ...day, actualTdeeKcal: null }, cfg())).toMatchObject({ bookedKcal: 0, shortfallKcal: null });
    expect(eveningReconcile({ ...day, actualTdeeKcal: null }, cfg()).reasons).toContain(REASONS.NO_EXPENDITURE_DATA);
    expect(eveningReconcile({ ...day, actualIntakeKcal: null }, cfg()).reasons).toContain(REASONS.NO_INTAKE_DATA);
  });
});

describe('balance', () => {
  const entry = (day, bookedKcal, correctionAppliedKcal = 0) => ({ date: iso(day), bookedKcal, correctionAppliedKcal });

  it('sums debt and subtracts what has been worked off', () => {
    const r = ledgerBalance([entry(1, 300), entry(2, 0, -100), entry(3, 0, -50)], iso(4), cfg());
    expect(r.balanceKcal).toBe(150);
    expect(r.nEntries).toBe(3);
  });

  it('never goes negative — overpaying does not create credit', () => {
    expect(ledgerBalance([entry(1, 100), entry(2, 0, -250)], iso(3), cfg()).balanceKcal).toBe(0);
  });

  it('expires debt older than surplusExpiresAfterDays', () => {
    const old = { date: '2026-06-01', bookedKcal: 400, correctionAppliedKcal: 0 };
    const r = ledgerBalance([old, entry(1, 100)], iso(4), cfg());
    expect(r.balanceKcal).toBe(100);
    expect(r.expiredKcal).toBe(400);
  });

  it('caps at capKcal and says so', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(i + 1, 400));
    const r = ledgerBalance(many, iso(11), cfg());
    expect(r.balanceKcal).toBe(1200);
    expect(r.saturated).toBe(true);
    expect(r.reasons).toContain(REASONS.LEDGER_SATURATED);
  });

  it('is zero when disabled, and copes with junk', () => {
    expect(ledgerBalance([entry(1, 300)], iso(2), cfg({ ledger: { enabled: false } })).balanceKcal).toBe(0);
    expect(ledgerBalance([null, {}, { date: iso(1) }], iso(2), cfg()).balanceKcal).toBe(0);
    expect(ledgerBalance(null, iso(2), cfg()).balanceKcal).toBe(0);
  });
});

describe('a week with one unexpectedly long session (test 2)', () => {
  const config = cfg();
  const BODY = { restTdeeKcal: 2334, bmrKcal: 1790, weightKg: 89.5, bodyFatPct: 27.9, ffmKg: 64.53 };
  const PLANNED_DEFICIT = dailyTarget(BODY, config).deficitKcal; // ~513

  // Seven days driven through the real two-stage cycle: morning plan corrected
  // by the standing balance, evening reconciliation against the actual TDEE.
  function runWeek({ overshootOnDay = null, overshootKcal = 0, longSessionOnDay = null } = {}) {
    const entries = [];
    const corrections = [];
    for (let day = 1; day <= 7; day++) {
      const balance = ledgerBalance(entries, iso(day), config).balanceKcal;
      const plan = dailyTarget({ ...BODY, ledgerCorrectionKcal: ledgerCorrectionKcal(balance, config) }, config);
      // What the correction actually achieved once the floor had its say.
      const appliedKcal = plan.baseIntakeKcal - plan.targetIntakeKcal;
      corrections.push(appliedKcal);

      const long = day === longSessionOnDay;
      const exerciseKcal = long ? 1600 : 0;
      const compensation = long ? compensationKcal(exerciseKcal, 0.95, config).kcal : 0;
      const overshoot = day === overshootOnDay ? overshootKcal : 0;

      const reconciled = eveningReconcile({
        date: iso(day),
        plannedDeficitKcal: PLANNED_DEFICIT,
        actualTdeeKcal: BODY.restTdeeKcal + exerciseKcal * 0.95,
        actualIntakeKcal: plan.targetIntakeKcal + compensation + overshoot,
        exerciseKcal,
        factor: 0.95,
      }, config);
      entries.push({ ...reconciled, correctionAppliedKcal: appliedKcal });
    }
    return { entries, corrections, summary: windowSummary(entries, iso(7), config) };
  }

  it('no day is ever corrected by more than maxDailyCorrectionKcal', () => {
    for (const scenario of [{ overshootOnDay: 2, overshootKcal: 600 }, { longSessionOnDay: 4 }]) {
      for (const applied of runWeek(scenario).corrections) {
        expect(Math.abs(applied)).toBeLessThanOrEqual(config.ledger.maxDailyCorrectionKcal);
      }
    }
  });

  it('but the real limit is the intake floor, not that cap', () => {
    // Worth stating outright: for this profile the 250 kcal/day cap never
    // binds. The rest-day TDEE is 544 kcal above the hard floor and the phase
    // already spends 513 of that, so the account has 31 kcal/day of room to
    // work with. Anyone tuning maxDailyCorrectionKcal to change ledger
    // behaviour here would be turning a knob that is not connected.
    const headroom = BODY.restTdeeKcal - config.safety.intakeFloor.hardFloorBmrMultiple * BODY.bmrKcal - PLANNED_DEFICIT;
    expect(headroom).toBeCloseTo(30.98, 2);
    expect(headroom).toBeLessThan(config.ledger.maxDailyCorrectionKcal);

    const { corrections } = runWeek({ overshootOnDay: 1, overshootKcal: 600 });
    expect(Math.max(...corrections)).toBeCloseTo(headroom, 6);
  });

  it('a long session compensates rather than creating debt', () => {
    // 1600 kcal x 0.95 = 1520 active, past noDeficitAboveActiveKcal, so the
    // day's target deficit drops to zero and nothing goes on the account.
    const { entries } = runWeek({ longSessionOnDay: 4 });
    const mountainDay = entries[3];
    expect(mountainDay.reasons).toContain(REASONS.NO_DEFICIT_LONG_SESSION);
    expect(mountainDay.targetDeficitKcal).toBe(0);
    expect(entries.every((e) => e.bookedKcal === 0)).toBe(true);
  });

  it('a modest overshoot is worked off inside the week and the deficit is met exactly', () => {
    const { corrections, summary } = runWeek({ overshootOnDay: 1, overshootKcal: 150 });
    expect(corrections[0]).toBe(0);
    expect(corrections.slice(1).filter((c) => c > 0).length).toBe(5); // spread, not one hit
    expect(summary.shortfallKcal).toBeCloseTo(0, 6);
  });

  it('a large overshoot outlives the week — reported, not smoothed away', () => {
    // 600 kcal against 31 kcal/day of room takes about three weeks. The honest
    // answer is that the week misses its target, and the balance says by how
    // much; pretending otherwise would need a correction through the floor.
    const { summary, entries } = runWeek({ overshootOnDay: 2, overshootKcal: 600 });
    expect(summary.shortfallKcal).toBeCloseTo(445.11, 1);
    expect(ledgerBalance(entries, iso(8), config).balanceKcal).toBeCloseTo(445.11, 1);
  });

  it('a clean week books nothing at all', () => {
    const { entries, corrections, summary } = runWeek();
    expect(entries.every((e) => e.bookedKcal === 0)).toBe(true);
    expect(corrections.every((c) => c === 0)).toBe(true);
    expect(summary.shortfallKcal).toBeCloseTo(0, 6);
  });

  it('the window rolls rather than following the calendar week', () => {
    const { entries } = runWeek({ overshootOnDay: 1, overshootKcal: 150 });
    expect(windowSummary(entries, iso(7), config).days).toBe(7);
    expect(windowSummary(entries, iso(10), config).days).toBe(4);
  });
});
