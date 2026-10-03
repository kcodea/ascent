# 2026-10-03: Kobe's Pummel badge shows (the badge gate now derives from the damage-meter registry)

Owner approved the fix ("yes") after an agent found Kobe's Pummel (15) progress badge never showed.

- **Root cause.** `stepProgress` in `packages/ui/src/cardText.ts` gated the Pummel badge on a hand-kept list of
  damage-meter factory ids (`dealtDamageAleMeter`, `dealtDamageGoldNextTurn`, `dealtDamageGrantRandomTribe`). Kobe's
  `dealtDamageGetRandomRuby` was registered in core's `DAMAGE_METER_MARKERS` (so combat counted and paid it, and the
  combat frame folded its `damageDealt`) but never added to that list, so the badge returned null on every surface.
  The list existed only so the rendered-text lane, which scrapes `e.do === '...'` literals from `cardText.ts`, would
  see the Pummel cards as subjects.
- **Fix.** The gate is now `damageMeterOf(def)`, the same registry read the combat fold (`useCombatReplay`), the
  shop zero-reading exception (`instView`), the Pummel glossary pill (`mechanics.ts`) and `Card.tsx` already used.
  `renderedText.test.tsx` mirrors it structurally (`structuralSubject` adds `damageMeterOf(c)`), so the Pummel cards
  stay subjects; Kobe joins `RENDER_EXCUSED` beside its peers (accurate at any value, the meter is the badge).
- **Guard.** `packages/ui/src/pummelBadge.test.ts` re-derives every card printing "Pummel (X)" and fails if one lacks
  a registered meter with the same X, if a registered marker has no card, or if any Pummel card's badge is missing
  from the shop chain (`instView`, including a fresh 0/X) or the combat chain. Kobe's combat badge reads 0/15, 5/15,
  10/15, 0/15 across three 5-damage hits. Verified failing (Kobe, both surfaces) with the old gate.
- **Pummel roster at fix time:** Han Gover (40), Goldvein (6), Maestro Lux (12), Kobe (15); Tauntbreaker (25) lands
  with PR #1939 and needs no badge edit now. The Ancients hero Pummels (Albus x War: Pummel (80), Gorr x War: Pummel (200))
  are hero powers that print `{pummelNow}/{pummelEvery}` in their power text, not a minion badge.
- Oracle: `R-PUMMEL-BADGE-01` in `packages/rules/src/registry/approved/keywords.ts`. Patch note added.
