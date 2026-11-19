# 2026-11-18: Beardsley improves +2/+1, and its combat text is live

Owner report: "beardsley's text isnt updating live in combat, and should improve by +2/+1 not +1/+1."

**Balance.** `onSummonTribeBuffFlat` takes an optional `improveHealth` (the Health step when it differs from
`improve`, the Attack step). Beardsley is `attack 2, health 1, improve 2, improveHealth 1, every 1`: the grant runs
+2/+1, +4/+2, +6/+3. Gilded still doubles the grant and the step. Both phases (core factory + the recruit twin) and
`summonEscalatingText` read the new param.

**Bug, root cause.** The text chain was fine: `Unit.tsx` already passes the frame's `summonBonus` to `liveCardText`,
which calls `summonEscalatingText`. The gap was in the engine: the combat factory bumped `self.summonBonus` but never
logged an `improve` event, and the replay only moves a body's `summonBonus` on that event. So the card printed the
start-of-fight grant until settle carried the real count back. The factory now logs `improve` (amount 1) on the
beat, for either side. The fold at the end of the log equals `playerSummonBonus`, so settle does not jump.

**Siblings.** Vicious (`b2_florida`) uses the same factory and had the same gap; fixed by the same line.
`buffShopPermanent`'s `improve` param had the same missing event (no live card uses the param today); it logs too.
Every other `summonBonus` writer in core already logged.

**Also.** With Rune of the Zoo the escalating text now folds the next summon's ordinal (it used to be shadowed:
`summonEscalatingText` returned first, so `summonFlatZooText` never ran for Beardsley).

Rule: R-IMPROVE-LIVE-TEXT-01. Test: `packages/ui/src/beardsleyLiveCombatText.test.ts`.
