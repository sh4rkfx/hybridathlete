# ADR 0004: Conservative DOMS window, no repeated-bout modeling (V1)

**Status:** accepted (spec v2.0, decision O5)

R4 applies the full 24–72 h eccentric recovery window after mountain descents, scaled
by elevation gain (the scaling itself is an `assumption`). The repeated-bout effect
(habitual mountain athletes show attenuated DOMS) is real but not modeled in V1.

Rationale: error costs are asymmetric — a superfluous warning is cheap, a missed one is
expensive. The 👍/👎 feedback loop collects the data needed to calibrate a dynamic
repeated-bout model in V2.
