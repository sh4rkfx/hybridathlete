// ACWR (R7): systemic only in V1, simple rolling average (Gabbett 2016).
// Methodological criticism (Lolli 2019 coupling, Impellizzeri 2020 sensitivity)
// is documented in the rule catalog and shown openly in the rulebook screen.
import { hoursBetween } from './time.js';
import { srpeTL } from './load.js';

export function acwr(logs, refDate) {
  const ref = refDate ?? new Date();
  let acute = 0;
  let chronic = 0;
  logs.forEach((l) => {
    const h = hoursBetween(l.date, ref);
    const tl = srpeTL(l);
    if (new Date(l.date) <= ref) {
      if (h <= 24 * 7) acute += tl;
      if (h <= 24 * 28) chronic += tl;
    }
  });
  const chronicWk = chronic / 4;
  const ratio = chronicWk > 0 ? acute / chronicWk : 0;
  return { acute, chronicWk, ratio };
}

// Zones per R7: <0.8 detraining/caution, 0.8–1.3 sweet spot, 1.3–1.5 elevated, >1.5 danger.
export function acwrZone(r) { return r < 0.8 ? 'caution' : r <= 1.3 ? 'fresh' : r <= 1.5 ? 'caution' : 'stop'; }
