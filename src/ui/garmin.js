// Garmin file import (spec §6.7, AC9): FIT/TCX (and the GDPR ZIP export)
// become DRAFT logs — type/duration/elevation prefilled, sRPE added by the
// user on confirmation. Only confirmed logs enter the load model.
// The TCX parser is string-based on purpose: no DOM dependency, Node-testable.

const TCX_SPORT = { running: 'running', biking: 'gravel_cycling', cycling: 'gravel_cycling', other: 'mountain_day', hiking: 'mountain_day', walking: 'mountain_day' };
const FIT_SPORT = { running: 'running', cycling: 'gravel_cycling', gravel_cycling: 'gravel_cycling', hiking: 'mountain_day', walking: 'mountain_day', mountaineering: 'mountain_day', rock_climbing: 'bouldering' };

export function mapSport(raw, table = FIT_SPORT) {
  return table[String(raw || '').toLowerCase()] ?? null;
}

function num(re, text, fold = (acc, v) => acc + v, init = 0) {
  let m;
  let acc = init;
  while ((m = re.exec(text)) !== null) acc = fold(acc, parseFloat(m[1]));
  return acc;
}

export function parseTcx(text) {
  const id = /<Id>([^<]+)<\/Id>/.exec(text)?.[1];
  const sportRaw = /<Activity[^>]*\bSport="([^"]+)"/.exec(text)?.[1];
  if (!id || !sportRaw) return null;
  const sportId = mapSport(sportRaw, TCX_SPORT);
  if (!sportId) return null;

  const durationSec = num(/<TotalTimeSeconds>([\d.]+)<\/TotalTimeSeconds>/g, text);
  const distanceM = num(/<DistanceMeters>([\d.]+)<\/DistanceMeters>/g, text, (acc, v) => Math.max(acc, v));
  // Elevation gain: sum of positive altitude deltas over the track.
  let gain = 0;
  let prev = null;
  const altRe = /<AltitudeMeters>(-?[\d.]+)<\/AltitudeMeters>/g;
  let m;
  while ((m = altRe.exec(text)) !== null) {
    const a = parseFloat(m[1]);
    if (prev != null && a > prev) gain += a - prev;
    prev = a;
  }

  return {
    garminActivityId: 'tcx-' + id,
    sportId,
    date: new Date(id).toISOString(),
    duration: Math.max(1, Math.round(durationSec / 60)),
    distance: distanceM ? Math.round(distanceM / 100) / 10 : undefined,
    elevationGain: gain ? Math.round(gain) : undefined,
  };
}

export function fromFitSession(activity) {
  const s = activity?.sessions?.[0] ?? activity;
  if (!s || !s.start_time) return null;
  const sportId = mapSport(s.sport);
  if (!sportId) return null;
  const start = new Date(s.start_time);
  return {
    garminActivityId: 'fit-' + start.toISOString(),
    sportId,
    date: start.toISOString(),
    duration: Math.max(1, Math.round((s.total_elapsed_time || s.total_timer_time || 60) / 60)),
    distance: s.total_distance ? Math.round(s.total_distance / 100) / 10 : undefined,
    elevationGain: s.total_ascent ? Math.round(s.total_ascent) : undefined,
  };
}

export async function parseFitBuffer(arrayBuffer) {
  const { default: FitParser } = await import('../../vendor/fit-file-parser/index.js');
  const parser = new FitParser({ force: true, mode: 'cascade', lengthUnit: 'm', speedUnit: 'm/s' });
  return new Promise((resolve) => {
    parser.parse(arrayBuffer, (err, data) => {
      if (err) { resolve(null); return; }
      resolve(fromFitSession(data.activity ?? data));
    });
  });
}

// One user-selected file -> activity drafts (ZIP fans out to its entries).
export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.tcx')) {
    const one = parseTcx(await file.text());
    return one ? [one] : [];
  }
  if (name.endsWith('.fit')) {
    const one = await parseFitBuffer(await file.arrayBuffer());
    return one ? [one] : [];
  }
  if (name.endsWith('.zip')) {
    const { default: JSZip } = await import('../../vendor/jszip/index.js');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const out = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const n = entry.name.toLowerCase();
      if (n.endsWith('.fit')) {
        const a = await parseFitBuffer(await entry.async('arraybuffer'));
        if (a) out.push(a);
      } else if (n.endsWith('.tcx')) {
        const a = parseTcx(await entry.async('string'));
        if (a) out.push(a);
      }
    }
    return out;
  }
  return [];
}

export function toDraftLog(activity, uid) {
  return {
    id: uid(),
    sportId: activity.sportId,
    date: activity.date,
    slot: new Date(activity.date).getHours() < 12 ? 'morning' : new Date(activity.date).getHours() < 18 ? 'midday' : 'evening',
    duration: activity.duration,
    sRPE: 0,
    source: 'garmin',
    draft: true,
    garminActivityId: activity.garminActivityId,
    sets: [],
    ...(activity.distance != null ? { distance: activity.distance } : {}),
    ...(activity.elevationGain != null ? { elevationGain: activity.elevationGain } : {}),
  };
}
