// CSV / JSON import with column mapping (kickoff step 7, FileImportAdapter).
// Pure module: string in, records out. The File-taking shell lives in the UI,
// exactly like src/ui/garmin.js — that split is what makes this testable in
// Node, where there is no File and no DOM.
//
// FIT and TCX are self-describing, so the Garmin importer needs no mapping
// step. A CSV is not: the header row is whatever the user's app exported, so
// the mapping is proposed here and confirmed by the user.
import { dateKey } from '../engine/time.js';

// What a row can be mapped onto. Everything else in the file is ignored rather
// than guessed at.
export const IMPORT_FIELDS = [
  { key: 'date', label: 'Datum', kind: 'date', required: true },
  { key: 'weightKg', label: 'Gewicht (kg)', kind: 'number' },
  { key: 'bodyFatPct', label: 'Körperfett (%)', kind: 'number' },
  { key: 'kcal', label: 'Kalorien', kind: 'number' },
  { key: 'proteinG', label: 'Protein (g)', kind: 'number' },
  { key: 'fatG', label: 'Fett (g)', kind: 'number' },
  { key: 'carbsG', label: 'Kohlenhydrate (g)', kind: 'number' },
  { key: 'fiberG', label: 'Ballaststoffe (g)', kind: 'number' },
  { key: 'alcoholG', label: 'Alkohol (g)', kind: 'number' },
  { key: 'totalKcal', label: 'Tagesumsatz', kind: 'number' },
  { key: 'exerciseKcal', label: 'Aktivkalorien', kind: 'number' },
  { key: 'exerciseMinutes', label: 'Trainingsminuten', kind: 'number' },
  { key: 'restingHr', label: 'Ruhepuls', kind: 'number' },
];

export const FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key);

// Header aliases, lower-cased and stripped of non-letters before matching, so
// "Gewicht (kg)", "gewicht_kg" and "Weight" all land on weightKg. Deliberately
// conservative: an unrecognised header maps to null and is dropped, because a
// wrong guess writes wrong data into the calibration.
const ALIASES = {
  date: ['date', 'datum', 'tag', 'day', 'zeitpunkt'],
  weightKg: ['weight', 'weightkg', 'gewicht', 'gewichtkg', 'koerpergewicht', 'bodyweight', 'masse'],
  bodyFatPct: ['bodyfat', 'bodyfatpct', 'koerperfett', 'kfa', 'fatpercent', 'fett'],
  kcal: ['kcal', 'calories', 'kalorien', 'energy', 'energie', 'energiezufuhr', 'intake'],
  proteinG: ['protein', 'proteing', 'eiweiss', 'eiweissg'],
  fatG: ['fat', 'fatg', 'fettg'],
  carbsG: ['carbs', 'carbsg', 'carbohydrates', 'kohlenhydrate', 'kh'],
  fiberG: ['fiber', 'fibre', 'fiberg', 'ballaststoffe'],
  alcoholG: ['alcohol', 'alcoholg', 'alkohol'],
  totalKcal: ['totalkcal', 'tdee', 'tagesumsatz', 'totalenergy', 'gesamtumsatz', 'expenditure'],
  exerciseKcal: ['activekcal', 'exercisekcal', 'aktivkalorien', 'activeenergy', 'trainingskalorien'],
  exerciseMinutes: ['exerciseminutes', 'trainingsminuten', 'duration', 'dauer', 'minutes', 'activeminutes'],
  restingHr: ['restinghr', 'ruhepuls', 'rhr', 'restingheartrate'],
};

// Umlauts are transliterated BEFORE non-letters are stripped, or "Körperfett"
// would arrive as "krperfett" and match nothing.
const normalizeHeader = (header) => String(header ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z]/g, '');

// --- parsing ---------------------------------------------------------------

// Delimiter is sniffed from the header line rather than assumed: German
// exports use semicolons, and a comma-delimited file with German decimals
// would otherwise split numbers in half.
export function detectDelimiter(headerLine) {
  const counts = [[';', 0], [',', 0], ['\t', 0]];
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    const hit = counts.find(([d]) => d === ch);
    if (hit) hit[1]++;
  }
  const [best] = counts.sort((a, b) => b[1] - a[1]);
  return best[1] ? best[0] : ',';
}

// A small RFC-4180 reader: quoted fields may contain the delimiter, newlines
// and doubled quotes.
export function splitCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function parseCsv(text) {
  const clean = String(text ?? '').replace(/^﻿/, ''); // strip the BOM Excel writes
  if (!clean.trim()) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(clean.split('\n')[0]);
  const table = splitCsv(clean, delimiter);
  if (!table.length) return { headers: [], rows: [] };
  const headers = table[0].map((h) => h.trim());
  const rows = table.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, i) => [header, (cells[i] ?? '').trim()]),
  ));
  return { headers, rows, delimiter };
}

// JSON: either an array of objects, or an object with an array under a likely
// key. Anything else is not something we can map, and says so.
export function parseJson(text) {
  let data;
  try { data = JSON.parse(String(text ?? '')); } catch { return { headers: [], rows: [], error: 'INVALID_JSON' }; }
  const list = Array.isArray(data)
    ? data
    : Object.values(data ?? {}).find((value) => Array.isArray(value) && value.every((v) => v && typeof v === 'object'));
  if (!Array.isArray(list) || !list.length) return { headers: [], rows: [], error: 'NO_ROWS' };
  const headers = [...new Set(list.flatMap((row) => Object.keys(row ?? {})))];
  return { headers, rows: list.map((row) => ({ ...row })) };
}

export function parseText(text, filename = '') {
  return /\.json$/i.test(filename) || String(text ?? '').trimStart().startsWith('[')
    ? parseJson(text)
    : parseCsv(text);
}

// --- mapping ---------------------------------------------------------------

// Proposes a target field per header. First match wins and a field is only
// claimed once, so two similar headers cannot both become `kcal`.
export function detectMapping(headers) {
  const mapping = {};
  const taken = new Set();
  for (const header of headers ?? []) {
    const normalized = normalizeHeader(header);
    const hit = FIELD_KEYS.find((key) => !taken.has(key)
      && (ALIASES[key] ?? []).some((alias) => normalized === alias))
      ?? FIELD_KEYS.find((key) => !taken.has(key)
        && (ALIASES[key] ?? []).some((alias) => normalized.startsWith(alias)));
    mapping[header] = hit ?? null;
    if (hit) taken.add(hit);
  }
  return mapping;
}

// Accepts ISO, German dd.mm.yyyy and anything Date can read; returns the
// canonical day key or null. Null is a dropped row, never a guessed date.
export function parseImportDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const german = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (german) return `${german[3]}-${german[2].padStart(2, '0')}-${german[1].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : dateKey(parsed);
}

export function parseImportNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw ?? '').trim().replace(/\s/g, '');
  if (!text) return null;
  // German decimal comma, and thousands separators from either convention.
  const normalized = text.includes(',') && !text.includes('.')
    ? text.replace(',', '.')
    : text.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// Applies a mapping and returns day records plus a per-reason count of what was
// dropped. Rows without a usable date cannot be placed on a calendar and are
// skipped; rows that map to a date and nothing else carry no information and
// are skipped too.
export function mapRows(rows, mapping) {
  const days = [];
  const skipped = { noDate: 0, empty: 0 };
  const byDate = new Map();

  for (const row of rows ?? []) {
    const record = {};
    for (const [header, field] of Object.entries(mapping ?? {})) {
      if (!field || !(header in (row ?? {}))) continue;
      const raw = row[header];
      const value = field === 'date' ? parseImportDate(raw) : parseImportNumber(raw);
      if (value != null) record[field] = value;
    }
    if (!record.date) { skipped.noDate++; continue; }
    if (Object.keys(record).length < 2) { skipped.empty++; continue; }

    // A file with two rows for one day is merged, last value wins per field.
    const existing = byDate.get(record.date);
    if (existing) Object.assign(existing, record);
    else { byDate.set(record.date, record); days.push(record); }
  }

  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { days, skipped };
}

export function mappingProblems(mapping) {
  const targets = Object.values(mapping ?? {}).filter(Boolean);
  const problems = [];
  if (!targets.includes('date')) problems.push('NO_DATE_COLUMN');
  if (targets.length < 2) problems.push('NOTHING_TO_IMPORT');
  const duplicates = targets.filter((t, i) => targets.indexOf(t) !== i);
  if (duplicates.length) problems.push(`DUPLICATE:${[...new Set(duplicates)].join(',')}`);
  return problems;
}

// --- adapter ---------------------------------------------------------------

export const FILE_IMPORT_ADAPTER_ID = 'file';

// Conforms to the same DataSourceAdapter contract as the other two, so an
// imported file is just another source rather than a special case.
export function createFileImportAdapter({ days = [] } = {}) {
  return {
    id: FILE_IMPORT_ADAPTER_ID,
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
    async isAvailable() { return days.length > 0; },
    async fetchRange(startDate, endDate) {
      return days
        .filter((day) => day?.date >= startDate && day.date <= endDate)
        .map((day) => ({
          date: day.date,
          totalKcal: day.totalKcal ?? null,
          exerciseKcal: day.exerciseKcal ?? null,
          exerciseMinutes: day.exerciseMinutes ?? null,
          steps: null,
          restingHr: day.restingHr ?? null,
          weightKg: day.weightKg ?? null,
          bodyFatPct: day.bodyFatPct ?? null,
          estimateIncludesTef: false,
          quality: 'measured',
        }));
    },
  };
}
