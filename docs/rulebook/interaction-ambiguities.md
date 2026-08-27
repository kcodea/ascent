# Interaction ambiguities — trigger-family compositions with no established ruling

Found by the trigger-family matrix scan (`packages/sim/src/docbot/interactionFamilyMatrix.test.ts`,
2026-08-26). Each pair below COMPOSES today in a way no code comment, owner ruling, skill doc or test pins —
so the current behaviour is documented verbatim and **nothing is changed or seeded**: these are owner
questions in the triage-card format. Every ruled pair is pinned by a fixture in the matrix test; these four
are the ones a fixture would have had to *invent* a semantics for.

---

## Q1 — Two DIFFERENT non-stacking multipliers of the same family collapse to best-of

- **Current behaviour (verbatim):** `extraTriggerFires` (packages/core/src/types.ts) sums the STACKING
  multipliers (Sylus) and takes the single BEST of the non-stacking ones (Drakko / Chronos / Uron / Zyff) —
  across *different cards*, not just copies. Two different non-stacking cards sharing a family therefore
  grant **+1 total**, not +1 each.
- **Card texts:** Drakko the Drummer — "Your **Battlecries** fire **1 more** time." · Zyff, the Betrayer —
  "Your **Battlecries** and **Deathrattles** trigger an additional time." · Chronos — "Your **End of Turn**
  effects trigger **1 more** time." · Uron, Oathbringer — "Your **Rallies**, **End of Turns** and **Start of
  Combats** trigger an additional time."
- **Concrete example:** Drakko AND Zyff on board; play Twilight Emissary (Battlecry +2/+2). It fires **2×**
  (best-of), while both texts together promise 3×. Same shape: Uron AND Chronos on board — End of Turn
  effects fire **2×**, not 3×.
- **Why it is debatable:** the "best copy" comments in types.ts and on Uron ("two Urons do not silently 3x")
  all describe *copies of the same card*; Zyff's own def comment even says it "**Stacks with Drakko**
  (battlecry)… the same way any two multipliers do", which the code contradicts for this pairing.
- **Click semantics:** ✓ Approve = best-of across different non-stacking cards is intended — the card texts
  should gain a clarifying word. ✎ Revise = your ruling, in a sentence (e.g. "different cards sum; only
  same-card copies best-of"). ✕ Reject = this is a bug — different non-stacking cards must sum.

## Q2 — Combat Shout re-fires ignore the Battlecry multipliers

- **Current behaviour (verbatim):** every combat-side Shout re-trigger (Parting Cry, Dawnclaw's Echo, Ryme,
  Thunderous Sovereign) routes through `replayCombatBattlecry` (packages/core/src/effects/factories.ts),
  which runs each `onPlay` effect exactly **once** — no `extraTriggerFires('battlecry', …)` fold. The SHOP
  replay path (`replayBattlecry`, packages/sim/src/recruit.ts) DOES fold Drakko in (`drummerRepeats`) —
  pinned by matrix fixture P1.
- **Concrete example:** Drakko on board, a minion with Parting Cry dies in combat: its Shout fires **once**.
  Sell the same minion under Rune of the Last Word in the shop: the identical Shout fires **twice**.
- **Why it is debatable:** the owner principle of 2026-08-20 ("trigger multipliers follow the trigger to
  whatever phase it fires in" — cited on `foldEchoExtraFires` / `socTwilightExtraFires`, and applied to the
  Echo and Start-of-Combat families in both phases) has NOT been applied to the Battlecry family's combat
  side; nothing documents whether that is an exemption or an omission.
- **Click semantics:** ✓ Approve = combat Shout re-fires are deliberately single-fire (Drakko is a
  shop-phase multiplier). ✎ Revise = your ruling, in a sentence. ✕ Reject = this is a bug — fold
  `extraTriggerFires('battlecry')` into `replayCombatBattlecry` like every other family.

## Q3 — Empty Graves' forced Echo fires once, ignoring every Echo multiplier

- **Current behaviour (verbatim):** the Empty Graves quest reward marks a body; each time it attacks it
  triggers the side's left-most living Echo (packages/core/src/combat/simulate.ts, the `emptyGravesRally`
  block) — the effects run exactly **once** inside one `asEcho` wrap. Every OTHER forced-Echo path
  multiplies: Rune of the Herald (`1 + playerEchoExtras`), Deathsayer / Echohorn / Hawkus
  (`(1 + echoExtras) × gild` in `triggerEchoOn`), and real deaths (`playerEchoExtras`).
- **Concrete example:** Sylus + Footman Captain (Echo: summon a Footman) + the Empty-Graves-marked body.
  The marked body attacks → **1** Footman. Deathsayer rallies the same Captain → **2** Footmen (matrix
  fixture P5). The Captain actually dies → 2 Footmen.
- **Why it is debatable:** the block's comment explains the `asEcho` wrap ("this fires on EVERY attack…")
  but says nothing about multipliers; given "an Echo trigger is an Echo trigger" everywhere else, the
  single-fire looks like an omission rather than a ruling.
- **Click semantics:** ✓ Approve = Empty Graves is deliberately flat (it already fires every attack —
  multiplying it too would runaway). ✎ Revise = your ruling, in a sentence. ✕ Reject = this is a bug —
  fold `playerEchoExtras` in like the Herald does.

## Q4 — A forced no-death Echo consumes the once-per-combat first-Echo bonus

- **Current behaviour (verbatim):** `playerEchoExtras` (packages/core/src/combat/simulate.ts) consumes the
  `echoFirstEachCombat` charge (Grave Contract / Last Rites / Rune of the Catacomb) on its FIRST call of the
  fight — and it is called by forced, no-death Echo triggers (Deathsayer's rally, Rune of the Herald's
  Start-of-Combat mass fire, Echohorn) exactly as by real deaths.
- **Concrete example:** Grave Contract complete; Rune of the Herald fires at Start of Combat. The
  first-Echo bonus is spent on the Herald's left-most forced Echo — the fight's first REAL death then fires
  without it.
- **Why it is debatable:** each source's text reads "the first Echo each combat" — nothing establishes
  whether a forced, deathless Echo is "an Echo" for this charge. The Herald consuming it at step 0 makes
  the bonus near-useless in any Herald build, which may or may not be intended.
- **Click semantics:** ✓ Approve = any Echo trigger (forced or death) may spend the charge — an Echo
  trigger is an Echo trigger. ✎ Revise = your ruling, in a sentence. ✕ Reject = this is a bug — only a
  real death's Echo may consume the first-Echo bonus.
