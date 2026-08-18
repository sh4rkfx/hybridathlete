// CSV / JSON import with column mapping (kickoff step 7). String in, records
// out — no File, no DOM, exactly like test/data/garmin.test.js.
import { describe, it, expect } from 'vitest';
import {
  parseCsv, parseJson, parseText, detectDelimiter, splitCsv,
  detectMapping, mapRows, mappingProblems, parseImportDate, parseImportNumber,
  createFileImportAdapter, IMPORT_FIELDS, FIELD_KEYS,
} from '../../src/adapters/FileImportAdapter.js';
import { assertAdapterContract } from '../../src/adapters/contract.js';

describe('delimiters', () => {
  it.each([
    ['Datum;Gewicht;Kalorien', ';'],
    ['date,weight,kcal', ','],
    ['date\tweight\tkcal', '\t'],
    ['onlyonecolumn', ','],
  ])('%o -> %o', (line, expected) => { expect(detectDelimiter(line)).toBe(expected); });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"Datum, lang";Gewicht;Kalorien')).toBe(';');
  });
});

describe('splitCsv', () => {
  it('handles quoted fields, embedded delimiters and doubled quotes', () => {
    const rows = splitCsv('a,b\n"x,1","he said ""hi"""\n', ',');
    expect(rows).toEqual([['a', 'b'], ['x,1', 'he said "hi"']]);
  });

  it('handles newlines inside quotes and CRLF between rows', () => {
    expect(splitCsv('a,b\r\n"two\nlines",2\r\n', ',')).toEqual([['a', 'b'], ['two\nlines', '2']]);
  });

  it('drops blank lines', () => {
    expect(splitCsv('a,b\n\n1,2\n\n', ',')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseCsv', () => {
  it('reads a German semicolon export with a BOM', () => {
    const text = '﻿Datum;Gewicht (kg);Kalorien;Protein\n17.08.2026;89,5;2100;155\n';
    const { headers, rows, delimiter } = parseCsv(text);
    expect(delimiter).toBe(';');
    expect(headers).toEqual(['Datum', 'Gewicht (kg)', 'Kalorien', 'Protein']);
    expect(rows).toEqual([{ Datum: '17.08.2026', 'Gewicht (kg)': '89,5', Kalorien: '2100', Protein: '155' }]);
  });

  it('reads a plain comma export', () => {
    const { headers, rows } = parseCsv('date,weight,kcal\n2026-08-17,89.5,2100\n');
    expect(headers).toEqual(['date', 'weight', 'kcal']);
    expect(rows[0].kcal).toBe('2100');
  });

  it('pads short rows rather than shifting columns', () => {
    const { rows } = parseCsv('date,weight,kcal\n2026-08-17,89.5\n');
    expect(rows[0]).toEqual({ date: '2026-08-17', weight: '89.5', kcal: '' });
  });

  it('copes with empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv(null)).toEqual({ headers: [], rows: [] });
    expect(parseCsv('   \n')).toEqual({ headers: [], rows: [] });
  });
});

describe('parseJson', () => {
  it('reads an array of objects', () => {
    const { headers, rows } = parseJson('[{"date":"2026-08-17","kcal":2100},{"date":"2026-08-18","kcal":2050}]');
    expect(headers).toEqual(['date', 'kcal']);
    expect(rows.length).toBe(2);
  });

  it('finds the array inside a wrapper object', () => {
    const { headers, rows } = parseJson('{"exportedAt":"x","days":[{"date":"2026-08-17","kcal":2100}]}');
    expect(headers).toEqual(['date', 'kcal']);
    expect(rows[0].kcal).toBe(2100);
  });

  it('unions keys across rows so a sparse file still offers every column', () => {
    const { headers } = parseJson('[{"date":"a","kcal":1},{"date":"b","weight":2}]');
    expect(headers.sort()).toEqual(['date', 'kcal', 'weight']);
  });

  it('reports rather than throws on junk', () => {
    expect(parseJson('not json').error).toBe('INVALID_JSON');
    expect(parseJson('[]').error).toBe('NO_ROWS');
    expect(parseJson('{"a":1}').error).toBe('NO_ROWS');
  });

  it('parseText dispatches on the filename, and on a leading bracket', () => {
    expect(parseText('[{"date":"2026-08-17"}]', 'x.json').rows.length).toBe(1);
    expect(parseText('[{"date":"2026-08-17"}]', 'x.txt').rows.length).toBe(1);
    expect(parseText('date,kcal\n2026-08-17,2100', 'x.csv').headers).toEqual(['date', 'kcal']);
  });
});

describe('column detection', () => {
  it('maps German and English headers alike', () => {
    expect(detectMapping(['Datum', 'Gewicht (kg)', 'Kalorien', 'Protein', 'Ruhepuls']))
      .toEqual({ Datum: 'date', 'Gewicht (kg)': 'weightKg', Kalorien: 'kcal', Protein: 'proteinG', Ruhepuls: 'restingHr' });
    expect(detectMapping(['date', 'weight', 'calories', 'resting_hr']))
      .toEqual({ date: 'date', weight: 'weightKg', calories: 'kcal', resting_hr: 'restingHr' });
  });

  it('leaves an unrecognised header unmapped rather than guessing', () => {
    const mapping = detectMapping(['Datum', 'Stimmung', 'Notiz']);
    expect(mapping.Stimmung).toBeNull();
    expect(mapping.Notiz).toBeNull();
  });

  it('never claims one field twice', () => {
    const mapping = detectMapping(['Kalorien', 'kcal', 'calories']);
    const claimed = Object.values(mapping).filter(Boolean);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('separates the two energy columns that look alike', () => {
    const mapping = detectMapping(['Datum', 'Kalorien', 'Tagesumsatz', 'Aktivkalorien']);
    expect(mapping).toMatchObject({ Kalorien: 'kcal', Tagesumsatz: 'totalKcal', Aktivkalorien: 'exerciseKcal' });
  });

  it('every declared field has at least one alias', () => {
    for (const field of IMPORT_FIELDS) {
      expect(detectMapping([field.key])[field.key], field.key).toBe(field.key);
    }
  });
});

describe('value parsing', () => {
  it.each([
    ['2026-08-17', '2026-08-17'],
    ['2026-08-17T09:30:00Z', '2026-08-17'],
    ['17.08.2026', '2026-08-17'],
    ['7.8.2026', '2026-08-07'],
    ['', null],
    ['irgendwann', null],
  ])('date %o -> %o', (raw, expected) => { expect(parseImportDate(raw)).toBe(expected); });

  it.each([
    ['2100', 2100], ['89,5', 89.5], ['89.5', 89.5], ['1.234', 1.234],
    ['1,234.5', 1234.5], [2100, 2100], ['', null], ['abc', null], [null, null],
  ])('number %o -> %o', (raw, expected) => { expect(parseImportNumber(raw)).toBe(expected); });
});

describe('mapping rows', () => {
  const mapping = { Datum: 'date', Gewicht: 'weightKg', Kalorien: 'kcal', Notiz: null };

  it('produces day records and ignores unmapped columns', () => {
    const { days } = mapRows([
      { Datum: '17.08.2026', Gewicht: '89,5', Kalorien: '2100', Notiz: 'gut geschlafen' },
    ], mapping);
    expect(days).toEqual([{ date: '2026-08-17', weightKg: 89.5, kcal: 2100 }]);
  });

  it('drops a row with no usable date, and counts it', () => {
    const { days, skipped } = mapRows([{ Datum: '', Gewicht: '89,5' }, { Datum: 'x', Kalorien: '2100' }], mapping);
    expect(days).toEqual([]);
    expect(skipped.noDate).toBe(2);
  });

  it('drops a row that carries only a date', () => {
    const { days, skipped } = mapRows([{ Datum: '2026-08-17' }], mapping);
    expect(days).toEqual([]);
    expect(skipped.empty).toBe(1);
  });

  it('merges two rows for the same day', () => {
    const { days } = mapRows([
      { Datum: '2026-08-17', Gewicht: '89,5' },
      { Datum: '2026-08-17', Kalorien: '2100' },
    ], mapping);
    expect(days).toEqual([{ date: '2026-08-17', weightKg: 89.5, kcal: 2100 }]);
  });

  it('sorts by date regardless of file order', () => {
    const { days } = mapRows([
      { Datum: '2026-08-17', Kalorien: '2100' },
      { Datum: '2026-08-01', Kalorien: '2000' },
    ], mapping);
    expect(days.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-17']);
  });

  it('a blank cell leaves the field absent, so a later merge cannot be wiped', () => {
    // putDay merges, so an absent key preserves whatever is already stored;
    // a null would overwrite it.
    const { days } = mapRows([{ Datum: '2026-08-17', Gewicht: '', Kalorien: '2100' }], mapping);
    expect('weightKg' in days[0]).toBe(false);
  });

  it('survives empty and malformed input', () => {
    expect(mapRows([], mapping).days).toEqual([]);
    expect(mapRows(null, null).days).toEqual([]);
  });
});

describe('mapping problems', () => {
  it('needs a date column and something to put on it', () => {
    expect(mappingProblems({ a: 'date', b: 'kcal' })).toEqual([]);
    expect(mappingProblems({ a: 'kcal' })).toContain('NO_DATE_COLUMN');
    expect(mappingProblems({ a: 'date' })).toContain('NOTHING_TO_IMPORT');
    expect(mappingProblems({ a: 'date', b: 'kcal', c: 'kcal' })).toContain('DUPLICATE:kcal');
    expect(mappingProblems(null)).toContain('NO_DATE_COLUMN');
  });
});

describe('the adapter', () => {
  const days = [
    { date: '2026-08-16', weightKg: 89.6, kcal: 2080 },
    { date: '2026-08-17', weightKg: 89.5, totalKcal: 2500, restingHr: 53 },
  ];

  it('conforms to the same contract as the other sources', () => {
    expect(() => assertAdapterContract(createFileImportAdapter({ days }))).not.toThrow();
  });

  it('reports imported figures as measured and TEF-free', async () => {
    const rows = await createFileImportAdapter({ days }).fetchRange('2026-08-16', '2026-08-17');
    expect(rows[1]).toMatchObject({ totalKcal: 2500, restingHr: 53, quality: 'measured', estimateIncludesTef: false });
    expect(rows[0].totalKcal).toBeNull();
  });

  it('is unavailable with nothing imported', async () => {
    expect(await createFileImportAdapter().isAvailable()).toBe(false);
    expect(await createFileImportAdapter({ days }).isAvailable()).toBe(true);
  });
});

describe('end to end', () => {
  it('takes a realistic German export through to day records', () => {
    const text = [
      '﻿Datum;Gewicht (kg);Körperfett;Kalorien;Protein (g);Ruhepuls;Notiz',
      '15.08.2026;89,8;28,1;2050;152;53;',
      '16.08.2026;89,6;;2180;;52;"Bouldern, lang"',
      ';;;;;;kaputte Zeile',
      '17.08.2026;89,5;27,9;2100;155;53;',
    ].join('\n');

    const { headers, rows } = parseCsv(text);
    const mapping = detectMapping(headers);
    expect(mappingProblems(mapping)).toEqual([]);
    const { days, skipped } = mapRows(rows, mapping);

    expect(skipped.noDate).toBe(1);
    expect(days.length).toBe(3);
    expect(days[0]).toEqual({ date: '2026-08-15', weightKg: 89.8, bodyFatPct: 28.1, kcal: 2050, proteinG: 152, restingHr: 53 });
    expect('bodyFatPct' in days[1]).toBe(false); // blank cell, not zero
    expect(FIELD_KEYS).toContain('proteinG');
  });
});
