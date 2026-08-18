// Source mandate, same contract src/rules/catalog.json carries for R1-R8 and
// test/engine/evidence.test.js enforces: every constant in the energy module
// names its literature and its evidence level, and anything that is judgement
// rather than evidence says so as 'assumption'.
//
// The second half is a drift guard: the numbers quoted in sources.json must be
// the numbers the code actually uses, or the citation is decoration.
import { describe, it, expect } from 'vitest';
import sources from '../../src/nutrition/sources.json' with { type: 'json' };
import { DEFAULT_CONFIG, MAX_RATE_BANDS } from '../../src/nutrition/config.js';
import { TEF_COEFFICIENTS, TEF_FALLBACK_FRACTION } from '../../src/nutrition/energy.js';

const LEVELS = ['meta-analysis', 'rct', 'cohort', 'expert-consensus', 'assumption'];
const byId = Object.fromEntries(sources.entries.map((e) => [e.id, e]));

describe('source mandate', () => {
  it.each(sources.entries.map((e) => [e.id, e]))('%s carries a source and a valid level', (id, entry) => {
    expect(entry.source, id).toBeTruthy();
    expect(entry.source.length, id).toBeGreaterThan(30);
    expect(LEVELS, id).toContain(entry.evidenceLevel);
    expect(entry.name, id).toBeTruthy();
  });

  it('declares its level scale and has unique ids', () => {
    expect(sources._meta.levels).toEqual(LEVELS);
    expect(Object.keys(byId).length).toBe(sources.entries.length);
  });

  it('the deliberately unvalidated extensions are labelled as assumptions', () => {
    for (const id of ['max_rate_body_fat_aware', 'max_deficit_fat_mass_aware', 'calibration_confidence',
      'auto_phase_rate', 'ea_threshold_taper']) {
      expect(byId[id].evidenceLevel, id).toBe('assumption');
    }
  });

  it('the two known gaps are written down rather than papered over', () => {
    expect(byId.tef_macros.gap).toMatch(/alcohol/i);
    // The body-fat-aware EA threshold is the kickoff's explicit departure from
    // the literature; the entry itself is rct-level, the departure is not.
    expect(byId.energy_availability.gap).toMatch(/NOT covered/);
  });

  it('a DOI is present wherever the source is a specific paper', () => {
    for (const id of ['bmr_mifflin', 'bmr_harris', 'bmr_cunningham', 'tef_macros', 'energy_density', 'energy_availability']) {
      expect(byId[id].doi, id).toMatch(/^10\.\d{4,}\//);
    }
  });
});

describe('quoted params match the code', () => {
  it('Atwater factors', () => {
    const p = byId.atwater.params;
    const at = DEFAULT_CONFIG.intake.atwater;
    expect([p.protein, p.carbs, p.fat, p.alcohol]).toEqual([at.protein, at.carbs, at.fat, at.alcohol]);
    expect([p.fiberEu, p.fiberUs]).toContain(at.fiber);
  });

  it('TEF coefficients and fallback', () => {
    const p = byId.tef_macros.params;
    expect(p.protein).toBe(TEF_COEFFICIENTS.protein);
    expect(p.carbs).toBe(TEF_COEFFICIENTS.carbs);
    expect(p.fat).toBe(TEF_COEFFICIENTS.fat);
    expect(p.alcohol).toBeNull(); // no coefficient given; code uses 0
    expect(p.fallbackOfIntake).toBe(TEF_FALLBACK_FRACTION);
  });

  it('energy density, rate bands, deficit ceiling and EA threshold', () => {
    expect(byId.energy_density.params.kcalPerKg).toBe(DEFAULT_CONFIG.calibration.energyDensityKcalPerKg);
    expect(byId.max_rate_body_fat_aware.params.bands).toEqual(MAX_RATE_BANDS.map((b) => b.maxPctBwPerWeek));
    expect(byId.max_deficit_fat_mass_aware.params.kcalPerKgFatMass).toBe(DEFAULT_CONFIG.safety.maxDeficit.kcalPerKgFatMass);
    expect(byId.energy_availability.params.thresholdKcalPerKgFfm).toBe(DEFAULT_CONFIG.flags.eaLowThreshold);
    expect(byId.energy_availability.params.bodyFatAware).toBe(DEFAULT_CONFIG.flags.eaBodyFatAware);
  });

  it('calibration confidence cut-offs', () => {
    const { highCoverage, highMaxGapDays, mediumCoverage, mediumMaxGapDays } = DEFAULT_CONFIG.calibration.confidence;
    expect(byId.calibration_confidence.params).toEqual({ highCoverage, highMaxGapDays, mediumCoverage, mediumMaxGapDays });
  });

  it('auto-phase fraction and EA taper anchors', () => {
    expect(byId.auto_phase_rate.params.capFraction).toBe(DEFAULT_CONFIG.phases.autoRate.capFraction);
    expect(byId.ea_threshold_taper.params).toEqual(DEFAULT_CONFIG.flags.eaThresholdTaper);
    // the taper's body-fat anchors are band edges, not new numbers
    const edges = MAX_RATE_BANDS.map((b) => b.minPct);
    for (const sex of ['male', 'female']) {
      expect(edges.map((e) => e[sex])).toContain(DEFAULT_CONFIG.flags.eaThresholdTaper.fullThresholdBelowBodyFatPct[sex]);
      expect(edges.map((e) => e[sex])).toContain(DEFAULT_CONFIG.flags.eaThresholdTaper.floorAtBodyFatPct[sex]);
    }
  });

  it('the compensation fraction matches the full-compensation rule', () => {
    expect(byId.full_compensation.params.fraction).toBe(1.0);
    expect(DEFAULT_CONFIG.compensation.rule).toBe('full');
  });
});
