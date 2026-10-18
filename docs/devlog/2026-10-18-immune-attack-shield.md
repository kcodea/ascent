# 2026-10-18 — Immune-while-attacking shield FX

Owner ask: *"make an immune while attacking effect. this would apply to iggy and bounty bot as an example. they
should gain a blue/gold shield when they wind up to attack that dissipates when they settle"*.

**Engine (presentation marker only).** `attack` events now carry `immune?: true` when the swing is covered by the
attacker's immunity. It is stamped at the emit from the same `attackImmuneLeft` the clash reads, so it covers Immune
Iggy / Bounty Bot (per-combat charges), Mauron (always on) and a Bloodlust swing, and a spent charge never carries it.
No gameplay change: retaliation is skipped exactly as before. Note the charge is only SPENT when the clash happens (a
swing whose target dies in the wind-up keeps it), so the flag, not a UI swing count, is the truth for the FX.

**Presentation.** `choreo/channels/immuneShield.ts` + two new lunge anchors (`onWindupStart` at t=0, `onSettle`
35% into the elastic settle). The shell is a DOM layer (`.immshield`) appended to the attacker's `.card` for the one
swing, so it rides the GSAP transform with no per-frame reads; static paint, one-shot transform/opacity form, flinch
and fade. Pixi defs `immune-shield-form` / `-deflect` / `-dissipate` (shockwave + burst primitives). The deflect only
plays when the defender's Attack badge shows a counterblow (> 0). A watchdog retires a shell whose lunge was killed
(skip/reset) unless the lunge is parked (Echohorn hold). Sized just outside the Ward shell so a Warded immune attacker
shows both.

**Live text.** Bounty Bot's "(first **2** attacks each combat)" now counts down in combat like Immune Iggy.

**Perf (prod bench build, Iggy + Bounty Bot + Mauron on both sides, 14-17 shields a fight).** A/B against the same
fight with the flags stripped: medians 4.2 ms both, p95 4.3-8.3 ms both, frames-over counts within run-to-run noise
(shield runs 285/236/158, control 281/151/206). No measurable cost.

Rule: R-IMMUNE-SHIELD-01 (`packages/rules/src/registry/approved/combat.ts`).
