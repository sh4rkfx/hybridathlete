# ADR 0006: Weight-loss energy density is a fixed, configurable 7700 kcal/kg

**Status:** accepted (kickoff, "Offene Entscheidungen")

The calibration solves `TDEE_real = mean intake - weight trend x energy density`, so the
density constant sits directly in the measured result. The alternative — modelling the
fat/FFM composition of the loss (Forbes) and deriving a body-fat-dependent density — is
physiologically closer, but it puts a second unvalidated model inside the one number the
feature exists to measure.

Sensitivity is real but bounded: at -0.45 kg/week, 7700 vs 9000 kcal/kg is about 110
kcal/day in the recovered TDEE. Against that, the reference athlete is at 27.9 % body
fat, where the loss is predominantly fat and 7700 is close; and the calibration factor
absorbs part of any residual bias anyway.

So: 7700 stays the default, `calibration.energyDensityKcalPerKg` keeps it configurable,
and Forbes-based modelling is a documented V2 option rather than a hidden assumption.
