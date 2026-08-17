// Deterministic synthetic day series for the calibration recovery test.
// No Math.random: the repo's tests are reproducible by construction, and a
// statistical assertion that shifts between runs is not an assertion.
//
// mulberry32 is a small, well-distributed 32-bit PRNG; Box-Muller turns its
// uniform output into the Gaussian noise the kickoff specifies.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand) {
  // Box-Muller; the guard keeps log(0) out.
  const u = Math.max(rand(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Builds `nDays` of tracked days for a person whose true TDEE is known.
// The weight path follows the true energy balance exactly; the noise sits on
// the observation, which is what a bathroom scale actually does.
export function syntheticDays({
  seed,
  nDays = 30,
  trueTdeeKcal = 2600,
  meanIntakeKcal = 2100,
  intakeSigmaKcal = 110,
  weightSigmaKg = 0.35,
  startWeightKg = 89.5,
  energyDensityKcalPerKg = 7700,
  estimateBiasFactor = 1.0,
  startDate = '2026-06-01',
} = {}) {
  const rand = mulberry32(seed);
  const days = [];
  let trueWeight = startWeightKg;
  const origin = new Date(startDate);

  for (let i = 0; i < nDays; i++) {
    const intakeKcal = meanIntakeKcal + gaussian(rand) * intakeSigmaKcal;
    const date = new Date(origin);
    date.setDate(origin.getDate() + i);
    days.push({
      date: date.toISOString().slice(0, 10),
      intakeKcal,
      // What the data source reports. estimateBiasFactor 1.05 means the source
      // overstates by 5 %, which the calibration should recover as 1/1.05.
      estimateKcal: trueTdeeKcal * estimateBiasFactor,
      weightKg: trueWeight + gaussian(rand) * weightSigmaKg,
    });
    trueWeight += (intakeKcal - trueTdeeKcal) / energyDensityKcalPerKg;
  }
  return days;
}
