// Pure time helpers shared by engine and UI. No DOM, no state.
export function atHour(d, h) { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function dOnly(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function hoursBetween(a, b) { return Math.abs(new Date(a) - new Date(b)) / 36e5; }
export function mondayOf(d) { const x = dOnly(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
export const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export function wdShort(d) { return WD[new Date(d).getDay()]; }
export function isSameDay(a, b) { return dOnly(a).getTime() === dOnly(b).getTime(); }
export function slotOfHour(h) { return h < 12 ? 'morning' : h < 18 ? 'midday' : 'evening'; }
