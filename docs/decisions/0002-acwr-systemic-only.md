# ADR 0002: ACWR is computed on the systemic axis only (V1)

**Status:** accepted (spec v2.0, decision O4)

ACWR (R7) uses the validated global sRPE×duration load (Foster 2001) with a simple
rolling average. A per-region ("leg axis") ACWR would multiply the assumption-level
regional decomposition (§3.1) with a metric that is itself methodologically contested
(mathematical coupling — Lolli 2019; sensitivity — Impellizzeri 2020).

Leg-specific steering is handled by R4 (eccentric window) and R5 (regional fatigue
traffic light) instead. R7 has the lowest tier; the criticism is shown openly in the
rulebook screen. EWMA/REDI variants are documented V2 options.
