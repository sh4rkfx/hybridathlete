# ADR 0003: 48 h pulley recovery as explicit expert-consensus

**Status:** accepted (spec v2.0, R3)

There is no validated study on the recovery duration of a *healthy* finger pulley
between training stimuli. R3 uses a conservative practitioner heuristic (≥ 48 h between
two high finger loads; Low, The Climbing Doctor, Hooper's Beta) and is labeled
`expert-consensus`, never presented as validated.

Because pulley overload is often not felt as fatigue before becoming symptomatic, the
explicit `hardFingerLoad` toggle in the boulder log is the rule's only reliable input;
without it R3 falls back to the static boulder profile and is marked lower-confidence.
