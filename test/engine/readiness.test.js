// exerciseReadiness: all 5 signal classes + date dependence (spec §3.6, story 12).
import { describe, it, expect } from 'vitest';
import { exerciseReadiness } from '../../src/engine/readiness.js';
import { freshDb, mkLog } from '../helpers/fixtures.js';
import { resetIds } from '../../src/engine/planner.js';

const H = (now, h) => new Date(now.getTime() + h * 36e5);

function bareDb(profile = { constraints: [] }) {
  resetIds();
  return { profile, logs: [], fatigue: [], pain: [], planned: [] };
}

describe('exerciseReadiness signals', () => {
  const now = new Date('2026-07-20T12:00:00');

  it('R2 generic constraint: red locks load >= 2, yellow cautions load >= 3', () => {
    const db = bareDb({ constraints: [{ id: 's', region: 'shoulder', level: 'red' }] });
    expect(exerciseReadiness('overhead_barbell_press', now, db, now).level).toBe('stop');
    db.profile.constraints = [{ id: 's', region: 'shoulder', level: 'yellow' }];
    expect(exerciseReadiness('overhead_barbell_press', now, db, now).level).toBe('caution');
    expect(exerciseReadiness('barbell_bench_press', now, db, now).level).toBe('fresh'); // shoulder 2 < 3
  });

  it('R2 knee constraint: yellow stops deep flexion, cautions low/mid; red stops all tagged', () => {
    const db = bareDb({ constraints: [{ id: 'k', region: 'knee', level: 'yellow' }] });
    expect(exerciseReadiness('back_squat', now, db, now).level).toBe('stop');
    expect(exerciseReadiness('box_squat', now, db, now).level).toBe('caution');
    db.profile.constraints = [{ id: 'k', region: 'knee', level: 'red' }];
    expect(exerciseReadiness('box_squat', now, db, now).level).toBe('stop');
    expect(exerciseReadiness('plank', now, db, now).level).toBe('fresh'); // untagged unaffected
  });

  it('R1 pain: NRS > 5 stops, NRS 3–5 cautions, only within 36 h', () => {
    const db = bareDb();
    db.pain.push({ id: 'p1', region: 'shoulder', nrs: 7, ts: now.toISOString() });
    expect(exerciseReadiness('overhead_barbell_press', now, db, now).level).toBe('stop');
    db.pain[0].nrs = 4;
    expect(exerciseReadiness('overhead_barbell_press', now, db, now).level).toBe('caution');
    db.pain[0].nrs = 7;
    db.pain[0].ts = H(now, -40).toISOString(); // outside the 36 h window
    expect(exerciseReadiness('overhead_barbell_press', now, db, now).level).toBe('fresh');
  });

  it('R5 fatigue: platt stops <= 72 h, müde cautions <= 48 h — relative to the target date', () => {
    const db = bareDb();
    db.fatigue.push({ id: 'f1', region: 'chest', level: 'stop', ts: now.toISOString(), context: 'post_session' });
    expect(exerciseReadiness('barbell_bench_press', H(now, 24), db, now).level).toBe('stop');
    db.fatigue[0].level = 'caution';
    expect(exerciseReadiness('barbell_bench_press', H(now, 24), db, now).level).toBe('caution');
    // Target date beyond the caution window -> free again
    expect(exerciseReadiness('barbell_bench_press', H(now, 60), db, now).level).toBe('fresh');
  });

  it('R4 eccentric window: leg load >= 3 stops, = 2 cautions, until 48 h after descent', () => {
    const db = bareDb();
    db.logs.push(mkLog('mountain_day', H(now, -30), 330, 7, { elevationGain: 1150 }));
    expect(exerciseReadiness('back_squat', H(now, 12), db, now).level).toBe('stop');       // quads 3, 42 h after
    expect(exerciseReadiness('box_squat', H(now, 12), db, now).level).toBe('caution');     // quads 2
    expect(exerciseReadiness('back_squat', H(now, 96), db, now).level).toBe('fresh');      // outside window
  });

  it('unknown exercise id is fresh with no reasons', () => {
    expect(exerciseReadiness('nope', now, bareDb(), now)).toEqual({ level: 'fresh', reasons: [] });
  });
});

describe('date dependence on the seeded state (AC13 shape)', () => {
  it('collects ALL reasons, not only the first', () => {
    const now = new Date('2026-07-20T12:00:00');
    const db = freshDb(now);
    const r = exerciseReadiness('back_squat', H(now, 12), db, now);
    expect(r.level).toBe('stop');
    expect(r.reasons.length).toBeGreaterThanOrEqual(2); // knee constraint + mountain window (+ quads müde)
    expect(r.reasons.join(' ')).toMatch(/Bergtag/);
    expect(r.reasons.join(' ')).toMatch(/Knie|Beugetiefe/);
  });
});
