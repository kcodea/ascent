# Milestone hit FX — melee hits escalate with the Attack badge tier

**Owner ask (2026-09-24):** combat hit effects get more intense by the attacker's Attack milestone tier. Tiers
1–3 are untouched; the owner authors unique workbench defs for the pink (4, 500+), purple (5, 2000+) and blue
(6, 5000+) frames.

- New binding family `attackHitMilestone4/5/6` (`choreo/bindings.ts`), sibling to `statMilestone1..5`. Like
  that family it is fired directly (from `choreo/channels/impact.ts`), has no `SCORE_DEFAULTS` row, and is bound
  by hand in `bindings.json` — the workbench commit picker only offers moment kinds.
- The tier is read from the attacker's `.badge.atk[data-milestone]` AT CONTACT (`engine.ts`), so the hit
  follows the badge the player sees, including an on-attack buff that just rolled it over.
- Owner rulings: a bound tier def REPLACES the stock `strike-impact` sparks + `impactPulse` ring, the
  `impact-dust` billow stays (same as a crit). Execute > Cleave > Flurry > crit all still OUTRANK it. An
  unbound tier plays the standard hit, so the slots shipped empty. A per-card row shadows the tier default.
- Noticed, not changed: `hitPower(moment.primary.swing)` is fed the Windfury SWING INDEX (0/1), not damage, so
  the stock hit's `power` scaling is effectively flat.
