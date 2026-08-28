# Interaction ambiguities — trigger-family compositions with no established ruling

Found by the trigger-family matrix scan (`packages/sim/src/docbot/interactionFamilyMatrix.test.ts`,
2026-08-26). Each pair below COMPOSES today in a way no code comment, owner ruling, skill doc or test pins —
so the current behaviour is documented verbatim and **nothing is changed or seeded**: these are owner
questions in the triage-card format. Every ruled pair is pinned by a fixture in the matrix test; these four
are the ones a fixture would have had to *invent* a semantics for.

---

## Q1 — Two DIFFERENT non-stacking multipliers of the same family collapse to best-of — **RESOLVED 2026-08-28**

**Owner rulings: `q-interact-nonstack-best-of` (REVISE 2026-08-27) → standing rule R-MULT-01, and
`q-interact2-32aa654f` / `q-interact2-faeb3c44` (APPROVE 2026-08-28) → standing rule R-MULT-02.** Best-of
across different non-stacking cards is CORRECT, and it is the law in *every* trigger family — the owner
approved the reading that End of Turn and Start of Combat "fold like the ruled ones: additive within a
family, best-of across non-stacking cards". So Uron + Chronos make End-of-Turn effects fire 2×, not 3×, and
rune/one-shot extras add on top of that fold. Pinned by matrix fixtures P12 (endOfTurn, incl. gild and the
one-shot extra) and P13 (startOfCombat in real combat); `endOfTurn`/`startOfCombat` joined the anomaly
oracle's `RULED_MULTIPLIER_FAMILIES`, so the unruled-composition detector no longer asks. The card texts
still promise "+1" each — the owner's planned non-stacker terminology pass ("Twice") is the follow-up, not a
code change. Original write-up below.

### Original write-up

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

## Q2 — Combat Shout re-fires ignore the Battlecry multipliers — **RESOLVED 2026-08-27**

**Owner ruling (`q-interact-combat-shout-multipliers`, APPROVE 2026-08-27): fixed.** By the triage round the
flat set had already narrowed — Ryme, Dawnclaw, Thunderous Sovereign and Chorus Drake folded `drakkoRepeats`;
Parting Cry and the arena `replayShout` consumers (Embercrest, Rune of Ancestral Roar, Rune of Shared
Scripture, Rune of the War Chorus) fired flat. Every combat Shout re-fire now folds the Battlecry
multipliers: the fold lives inside the combat arena `replayShout` verb (mirroring the shop's
`replayBattlecry` → `drummerRepeats` boundary) and at the Parting Cry / rune dispatch sites in `simulate.ts`.
Pinned by matrix fixtures P9–P10 plus the rune-batch tests (Ancestral Roar, Shared Scripture, War Chorus).

## Q3 — Empty Graves' forced Echo fires once, ignoring every Echo multiplier — **RESOLVED 2026-08-27**

**Owner ruling (`q-interact-empty-graves-flat`, APPROVE 2026-08-27): fixed.** The `emptyGravesRally` attack
branch now fires the forced Echo `(1 + playerEchoExtras) × the marked body's gild` times — one `asEcho` wrap
per proc, deaths deferred across all procs — like every other forced-Echo path (Rune of the Herald,
`triggerEcho`). Pinned by matrix fixture P11. The quest's stale player-facing reward line (it still described
the pre-2026-07-21 Gravebody design) was rewritten in the same PR (`packages/ui/src/questText.ts`).

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
