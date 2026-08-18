// Adapter contracts for the energy module (kickoff step 7). Pure module.
//
// The kickoff sketches these as `class DataSourceAdapter { ... }`. This repo has
// no classes anywhere — everything is a function returning an object literal —
// so the sketch is read as a shape description, not as a language construct.
// The shape is what matters and `assertAdapterContract` is what enforces it.
//
// DataSourceAdapter — supplies expenditure and body data:
//   id            string
//   capabilities  { totalKcal, exerciseKcal, exerciseMinutes, steps, restingHr,
//                   weight, bodyFat, includesTef }   all booleans
//   fetchRange(startDate, endDate) -> Promise<DayMetrics[]>
//   isAvailable() -> Promise<boolean>
//
// DayMetrics — one calendar day, keyed 'YYYY-MM-DD':
//   { date, totalKcal, exerciseKcal, exerciseMinutes, steps, restingHr,
//     weightKg, bodyFatPct, quality: 'measured'|'estimated'|'interpolated' }
//
// IntakeAdapter — supplies what was eaten:
//   id, capabilities { kcal, protein, fat, carbs, fiber, alcohol },
//   fetchRange(startDate, endDate) -> Promise<IntakeEntry[]>
//
// `includesTef` is the one capability that changes arithmetic rather than
// availability: PAL-based estimates already contain thermogenesis, wearable
// active-energy figures do not, and adding it twice is worth about 240 kcal/day.
// It travels on every DayMetrics row as `estimateIncludesTef` so a consumer
// never has to go back and ask the adapter.

export const DATA_SOURCE_CAPABILITIES = [
  'totalKcal', 'exerciseKcal', 'exerciseMinutes', 'steps', 'restingHr',
  'weight', 'bodyFat', 'includesTef',
];

export const INTAKE_CAPABILITIES = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'alcohol'];

export const QUALITIES = ['measured', 'estimated', 'interpolated'];

function assertShape(adapter, kind, capabilityKeys) {
  const problems = [];
  if (!adapter || typeof adapter !== 'object') return [`${kind}: not an object`];
  if (typeof adapter.id !== 'string' || !adapter.id) problems.push(`${kind}: missing id`);
  if (typeof adapter.fetchRange !== 'function') problems.push(`${adapter.id}: fetchRange is not a function`);
  if (!adapter.capabilities || typeof adapter.capabilities !== 'object') {
    problems.push(`${adapter.id}: missing capabilities`);
    return problems;
  }
  // Every key must be present and boolean — an absent capability reads as
  // "unknown" at the call site, which is exactly the ambiguity to avoid.
  for (const key of capabilityKeys) {
    if (typeof adapter.capabilities[key] !== 'boolean') {
      problems.push(`${adapter.id}: capability '${key}' must be a boolean`);
    }
  }
  for (const key of Object.keys(adapter.capabilities)) {
    if (!capabilityKeys.includes(key)) problems.push(`${adapter.id}: unknown capability '${key}'`);
  }
  return problems;
}

export function dataSourceProblems(adapter) {
  const problems = assertShape(adapter, 'DataSourceAdapter', DATA_SOURCE_CAPABILITIES);
  if (adapter && typeof adapter.isAvailable !== 'function') {
    problems.push(`${adapter.id}: isAvailable is not a function`);
  }
  return problems;
}

export function intakeProblems(adapter) {
  return assertShape(adapter, 'IntakeAdapter', INTAKE_CAPABILITIES);
}

export function assertAdapterContract(adapter, kind = 'dataSource') {
  const problems = kind === 'intake' ? intakeProblems(adapter) : dataSourceProblems(adapter);
  if (problems.length) throw new Error(`adapter contract violated — ${problems.join('; ')}`);
  return adapter;
}
