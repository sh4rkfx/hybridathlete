// v1 data source: the user types it in (kickoff step 7). Pure module.
//
// Reads the rows the entry mask wrote and hands them back as DayMetrics. It
// invents nothing — a field the user left blank stays null, which is what makes
// the calibration refuse to produce a factor rather than produce a bad one.
//
// `includesTef: false`: a hand-entered total comes off a watch or a scale, and
// those report expenditure without thermogenesis.
import { QUALITIES } from './contract.js';

export const MANUAL_ADAPTER_ID = 'manual';

const num = (value) => (Number.isFinite(value) ? value : null);

export function toDayMetrics(row) {
  return {
    date: row.date,
    totalKcal: num(row.totalKcal),
    exerciseKcal: num(row.exerciseKcal),
    exerciseMinutes: num(row.exerciseMinutes),
    steps: num(row.steps),
    restingHr: num(row.restingHr),
    weightKg: num(row.weightKg),
    bodyFatPct: num(row.bodyFatPct),
    estimateIncludesTef: false,
    quality: QUALITIES.includes(row.quality) ? row.quality : 'measured',
  };
}

export function createManualAdapter({ rows = [] } = {}) {
  return {
    id: MANUAL_ADAPTER_ID,
    capabilities: {
      totalKcal: true,
      exerciseKcal: true,
      exerciseMinutes: true,
      steps: false,
      restingHr: true,
      weight: true,
      bodyFat: true,
      includesTef: false,
    },
    async isAvailable() { return true; },
    async fetchRange(startDate, endDate) {
      return rows
        .filter((row) => row?.date != null && row.date >= startDate && row.date <= endDate)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map(toDayMetrics);
    },
  };
}
