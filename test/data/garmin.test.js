// Garmin import (AC9): parsing, sport mapping, draft semantics.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { parseTcx, fromFitSession, toDraftLog, mapSport } from '../../src/ui/garmin.js';
import { openDatabase } from '../../src/data/db.js';
import { loadEngineState, seedIfEmpty } from '../../src/data/repositories.js';

const TCX = `<?xml version="1.0"?>
<TrainingCenterDatabase>
  <Activities><Activity Sport="Running">
    <Id>2026-07-18T07:12:00.000Z</Id>
    <Lap StartTime="2026-07-18T07:12:00.000Z">
      <TotalTimeSeconds>1500.0</TotalTimeSeconds>
      <DistanceMeters>4900.0</DistanceMeters>
      <Track>
        <Trackpoint><AltitudeMeters>410.0</AltitudeMeters></Trackpoint>
        <Trackpoint><AltitudeMeters>431.5</AltitudeMeters></Trackpoint>
        <Trackpoint><AltitudeMeters>425.0</AltitudeMeters></Trackpoint>
        <Trackpoint><AltitudeMeters>446.0</AltitudeMeters></Trackpoint>
      </Track>
    </Lap>
    <Lap StartTime="2026-07-18T07:37:00.000Z">
      <TotalTimeSeconds>1200.0</TotalTimeSeconds>
      <DistanceMeters>8800.0</DistanceMeters>
    </Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`;

describe('parseTcx', () => {
  it('extracts id, sport, duration, distance and positive-delta elevation gain', () => {
    const a = parseTcx(TCX);
    expect(a.garminActivityId).toBe('tcx-2026-07-18T07:12:00.000Z');
    expect(a.sportId).toBe('running');
    expect(a.duration).toBe(45);          // (1500 + 1200) s
    expect(a.distance).toBe(8.8);         // max cumulative DistanceMeters
    expect(a.elevationGain).toBe(43);     // +21.5 +21 (drops ignored)
  });

  it('returns null for unmappable sports or missing id', () => {
    expect(parseTcx(TCX.replace('Running', 'Swimming'))).toBeNull();
    expect(parseTcx(TCX.replace(/<Id>[^<]+<\/Id>/, ''))).toBeNull();
  });
});

describe('fromFitSession / sport mapping', () => {
  it('maps FIT session fields to an activity', () => {
    const a = fromFitSession({ sessions: [{ sport: 'hiking', start_time: '2026-07-11T09:00:00Z', total_elapsed_time: 19800, total_ascent: 950, total_distance: 14200 }] });
    expect(a.sportId).toBe('mountain_day');
    expect(a.duration).toBe(330);
    expect(a.elevationGain).toBe(950);
    expect(a.garminActivityId).toMatch(/^fit-2026-07-11/);
  });

  it('maps common Garmin sports to V1 sport ids', () => {
    expect(mapSport('running')).toBe('running');
    expect(mapSport('cycling')).toBe('gravel_cycling');
    expect(mapSport('mountaineering')).toBe('mountain_day');
    expect(mapSport('yoga')).toBeNull();
  });
});

describe('draft semantics (AC9)', () => {
  it('toDraftLog marks the log as draft with sRPE 0 and keeps the activity id', () => {
    let n = 0;
    const log = toDraftLog(parseTcx(TCX), () => 'id' + (++n));
    expect(log.draft).toBe(true);
    expect(log.sRPE).toBe(0);
    expect(log.source).toBe('garmin');
    expect(log.garminActivityId).toBe('tcx-2026-07-18T07:12:00.000Z');
  });

  it('loadEngineState keeps drafts out of the engine logs until confirmed', async () => {
    const db = await openDatabase('garmin-draft-test');
    await seedIfEmpty(db);
    await db.put('sessionLogs', { logId: 'l1', id: 'l1', sportId: 'running', date: '2026-07-18T07:12:00Z', duration: 45, sRPE: 6 });
    await db.put('sessionLogs', { logId: 'l2', id: 'l2', sportId: 'running', date: '2026-07-19T07:12:00Z', duration: 45, sRPE: 0, draft: true, garminActivityId: 'g-1' });

    const state = await loadEngineState(db);
    expect(state.logs.map((l) => l.logId)).toEqual(['l1']);
    expect(state.draftLogs.map((l) => l.logId)).toEqual(['l2']);
  });
});
