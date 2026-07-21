// Boulder session tracking (story #54): Font-scale math, session summary and
// the hardFingerLoad suggestion. Pure functions, no DOM/DB.
//
// The average grade uses the ordinal position on the Font scale — an honest
// simplification (grade distances are not equidistant), flagged as assumption.
// Only sent boulders (flash/top) enter the average; fails count as attempts.

export const FONT_GRADES = ['4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A'];

export const GRIPS = ['Jug', 'Sloper', 'Crimp', 'Pinch', 'Pocket'];
// Grips that primarily stress the pulleys (feeds the R3 suggestion).
export const FINGERY_GRIPS = ['Crimp', 'Pocket'];

export const gradeIndex = (g) => FONT_GRADES.indexOf(g);
export const indexGrade = (i) => FONT_GRADES[Math.max(0, Math.min(FONT_GRADES.length - 1, Math.round(i)))];

// boulders: [{ grade, grip?, seconds, result: 'flash'|'top'|'fail' }]
export function sessionSummary(boulders) {
  const counts = { flash: 0, top: 0, fail: 0 };
  boulders.forEach((b) => { counts[b.result] = (counts[b.result] ?? 0) + 1; });
  const sent = boulders.filter((b) => b.result === 'flash' || b.result === 'top');
  const avgGrade = sent.length
    ? indexGrade(sent.reduce((a, b) => a + gradeIndex(b.grade), 0) / sent.length)
    : null;
  const maxIdx = boulders.length ? Math.max(...boulders.map((b) => gradeIndex(b.grade))) : -1;
  return { avgGrade, counts, total: boulders.length, sent: sent.length, maxGrade: maxIdx >= 0 ? FONT_GRADES[maxIdx] : null };
}

// Best grade ever sent, from past session logs carrying boulders.
export function bestPastGrade(state) {
  let best = -1;
  for (const log of state.logs ?? []) {
    for (const b of log.boulders ?? []) {
      if ((b.result === 'flash' || b.result === 'top')) best = Math.max(best, gradeIndex(b.grade));
    }
  }
  return best >= 0 ? FONT_GRADES[best] : null;
}

// hardFingerLoad suggestion (R3 input). ASSUMPTION-level heuristic, always
// user-overridable in the finger step: fingery-grip share >= 1/3 of the
// session, or an attempt at/above the personal best sent grade (limit work).
export function suggestHardFingerLoad(boulders, priorBestGrade) {
  if (!boulders.length) return false;
  const fingery = boulders.filter((b) => FINGERY_GRIPS.includes(b.grip)).length;
  if (fingery / boulders.length >= 1 / 3) return true;
  if (priorBestGrade != null) {
    const maxIdx = Math.max(...boulders.map((b) => gradeIndex(b.grade)));
    if (maxIdx >= gradeIndex(priorBestGrade)) return true;
  }
  return false;
}
