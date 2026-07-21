// Week planner (story #55): declare the week once — fixed/variable sessions
// per sport plus the strength wish — and get a complete, rule-conform weekly
// plan proposal. Pure and deterministic; the caller applies it explicitly.
//
// Planning principles (each carried as rationale with source):
// - one session per day (proposal-level simplification; the user can still
//   stack manually in the week view)
// - leg-loaded strength units never land on or directly after a mountain day
//   (R4 window, < 48 h after the descent)
// - strength and endurance avoid sharing a day entirely (R6: >= 6 h — solved
//   by separation at proposal level)
// - runs marked "wenn möglich" fill remaining capacity LAST and are the first
//   to be sacrificed (R7 semantics: non-fixed add-on load)
import { recommendPlan } from './advisor.js';

const SPORT_SLOT = { bouldering: 'evening', mountain_day: 'morning', running: 'morning', gravel_cycling: 'morning', strength: 'evening' };
const LEGGY_UNITS = ['legs', 'lower', 'full'];

const SOURCES = {
  r4: { rule: 'R4', source: 'DOMS nach exzentrischem Abstieg peakt 24–72 h (Eston 1995; Reviews) — schwere Beinarbeit frühestens 48 h nach dem Bergtag.', evidenceLevel: 'cohort' },
  r6: { rule: 'R6', source: 'Interferenz v. a. bei enger, gleichtägiger Kombination (Schumann 2022, Meta-Analyse) — der Vorschlag trennt Kraft und Ausdauer auf Tagesebene.', evidenceLevel: 'meta-analysis' },
  r7: { rule: 'R7', source: 'Zusatzlast wird zuerst geopfert (Gabbett 2016): optionale Läufe füllen nur freie Kapazität.', evidenceLevel: 'cohort' },
  split: { rule: 'R8/R9', source: 'Split-Verteilung aus dem Plan-Berater (Ramos-Campo 2024: Split ist Präferenz bei gleichem Volumen).', evidenceLevel: 'meta-analysis' },
};

// weekday (0=So..6=Sa) -> offset in the coming 7 days (0 = today)
export const weekdayOffset = (weekday, now) => (weekday - now.getDay() + 7) % 7;

export function recommendWeek(profile, wishes, state, now = new Date()) {
  const sessions = [];
  const conflicts = [];
  const rationale = [];
  const used = new Set(); // one session per day (proposal principle)

  const place = (sportId, dayOffset, fixed, extra = {}) => {
    sessions.push({ sportId, dayOffset, slot: SPORT_SLOT[sportId] ?? 'evening', fixed, ...extra });
    used.add(dayOffset);
  };
  const freeDays = () => Array.from({ length: 7 }, (_, i) => i).filter((d) => !used.has(d));

  // 1) Fixed wishes claim their days first.
  const order = ['mountain_day', 'bouldering', 'gravel_cycling', 'running'];
  for (const sportId of order) {
    const w = wishes[sportId];
    if (!w?.count) continue;
    for (const wd of (w.fixedDays ?? []).slice(0, w.count)) {
      const d = weekdayOffset(wd, now);
      if (used.has(d)) {
        conflicts.push({ sportId, reason: `Fixer Wunschtag ist bereits belegt (Tag +${d}).`, rule: 'Kapazität' });
      } else {
        place(sportId, d, true);
      }
    }
  }

  // 2) Variable non-strength wishes (preferred days first), runs LAST (step 4).
  for (const sportId of order) {
    if (sportId === 'running') continue;
    const w = wishes[sportId];
    if (!w?.count) continue;
    let remaining = w.count - sessions.filter((s) => s.sportId === sportId).length;
    for (const wd of (w.preferredDays ?? [])) {
      if (remaining <= 0) break;
      const d = weekdayOffset(wd, now);
      if (!used.has(d)) { place(sportId, d, false); remaining--; }
    }
    for (const d of freeDays()) {
      if (remaining <= 0) break;
      place(sportId, d, false);
      remaining--;
    }
    if (remaining > 0) conflicts.push({ sportId, reason: `${remaining} Einheit(en) nicht untergebracht – Woche voll.`, rule: 'Kapazität' });
  }

  // 3) Strength via the plan advisor, placed around the fixed structure.
  const rec = recommendPlan(profile, state);
  const mountainDays = sessions.filter((s) => s.sportId === 'mountain_day').map((s) => s.dayOffset);
  const legBlocked = new Set(mountainDays.flatMap((d) => [d, d + 1]));
  const strengthDays = [];
  for (const unit of rec.assignment) {
    const leggy = LEGGY_UNITS.includes(unit);
    const candidates = freeDays().filter((d) => !(leggy && legBlocked.has(d)));
    // prefer a day that is not adjacent to an already chosen strength day
    const spread = candidates.find((d) => strengthDays.every((s) => Math.abs(s - d) > 1)) ?? candidates[0];
    if (spread == null) {
      conflicts.push({ sportId: 'strength', reason: `Kraft-Einheit (${unit}) nicht untergebracht${leggy ? ' – R4-Fenster nach dem Bergtag blockiert die Resttage' : ' – Woche voll'}.`, rule: leggy ? 'R4' : 'Kapazität' });
      continue;
    }
    place('strength', spread, false, { unit });
    strengthDays.push(spread);
  }
  if (mountainDays.length) rationale.push({ text: 'Beinlastige Kraft frühestens 2 Tage nach dem Bergtag.', ...SOURCES.r4 });
  rationale.push({ text: 'Kraft und Ausdauer liegen auf getrennten Tagen.', ...SOURCES.r6 });
  rationale.push({ text: `Kraft: ${rec.assignment.join(' / ')}${rec.coveredUnits.length ? ` — ohne ${rec.coveredUnits.join('/')}` : ''}.`, ...SOURCES.split });
  rationale.push(...rec.rationale);

  // 4) Optional runs fill what is left — sacrificed first when the week is full.
  const runWish = wishes.running;
  if (runWish?.count) {
    let remaining = runWish.count - sessions.filter((s) => s.sportId === 'running').length;
    for (const d of freeDays()) {
      if (remaining <= 0) break;
      place('running', d, false);
      remaining--;
    }
    if (remaining > 0) {
      conflicts.push({ sportId: 'running', reason: `${remaining} Lauf${remaining === 1 ? '' : 'e'} nicht untergebracht – ${runWish.optional ? 'optionale Zusatzlast wird zuerst geopfert' : 'Woche voll'}.`, rule: 'R7' });
    }
    rationale.push({ text: 'Läufe füllen freie Kapazität und werden bei voller Woche zuerst geopfert.', ...SOURCES.r7 });
  }

  sessions.sort((a, b) => a.dayOffset - b.dayOffset);
  return { sessions, conflicts, rationale, strength: { assignment: rec.assignment, coveredUnits: rec.coveredUnits, gaps: rec.gaps } };
}
