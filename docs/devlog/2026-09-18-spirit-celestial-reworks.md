# 2026-09-18 — Spirit + Celestial reworks (owner handoff) and Collapse back to 3

Seven Set 3 cards rewritten to the owner's 2026-09-18 directives (ids unchanged), plus the Collapse number.

## What changed

- **Kindled Sprite** 1/3 — *Rally: gain +1 Attack permanently for every Spirit played this turn.* The combat
  factory now books the gain as `permaGain` (the Target Dummy channel) so `playerPermaBuffs` carries it home;
  a new `permaLabel` on the combat Minion / carry-back record lets the settle ledger name the Sprite instead of
  the legacy "Flowing Monk" label. The shop-triggered Rally was already permanent. `spiritText` prints the total.
- **Stardust Peddler** 2/5 — *When you spend 5 Gold, create a Starform, or give it +3/+3.* Moved from `onBuy`
  to the `goldSpent` family (`goldSpentCreateStarformOrBuff`, `every: 5`): the per-instance `goldTick` meter
  the Coinfire Forewoman / Billings use, so the step counter shows N/5 (the shared tracker rule, owner
  2026-09-11) and the remainder carries. Note the buy order: `spendGold` runs before the token leaves on the
  token's own buy, so a 5-Gold step crossed by that buy feeds the token +3/+3 first and the buyer consumes it
  at 4/4 — the old `onBuy` re-seed is gone with its trigger.
- **Sugarnova** 4/2 — *Shout: give your next Shop spell +4/+4.* Same `nextSpellBonus` field (a run field, so it
  already survived the turn boundary and the JSON save); now pinned by tests: (a) carries through
  faceOmen → settle → resolve and is spent by the first Shop spell of the new turn, (b) `spellDisplayText` /
  `shopView` / `instView` print the boosted number green in place for offers and hand spells while a Gift
  stays flat, (c) exactly the next Shop-spell cast consumes it.
- **Aspect** — *When you play a Spirit, give 3 random Spirits +2/+2. Improves every 3 times this triggers.*
  Step 2 (was 1); `spiritText` prints the live grant; the countdown stays on the step counter.
- **Crash Course** — *The first Star Crash you cast on this each turn casts an additional time.* New factory
  `onSpellCastOnThisRecastNamed`: Mirrorwing's full re-cast (scaled by `spellCasts`) gated to the named spell,
  once per turn per copy via the existing `namedSpreadUsedThisTurn` latch (set before the re-casts, which is
  what terminates the recursion). The Adept's spread factory `onSpellCastOnThisSpreadTribeNamed` is deleted.
- **Roundabout** — *End of Turn: create a Starform and give it +10/+10.* New factory
  `endOfTurnCreateStarformThenBuff`; with a token already out the create is the primitive's usual no-op and only
  the +10/+10 lands. `endOfTurnStarformConsumeAllShop` / `startOfTurnCreateStarform` deleted.
- **Old Timber** — *Start of Combat: give your Spirits +3/+2. Improves for every Spirit played.*
  `scBuffTribePerTally` gained a `base` param (steps = base + tally) on both phases; the tally scope is
  unchanged (Spirits played since it was played, per instance).
- **Collapse** — `COLLAPSE_ORIGINALS = 3` in `starform.ts` (was 2): `collapseHits`' default, Solburn's factory,
  the Collapse glossary pill, Rune of the Supernova's "instead of three", GAME-RULES.

Dead factories were removed rather than kept dormant — the presentation-policy registry test refuses ghosts.

## Verified

`npm run typecheck && npm run lint && npm test && npm run build:web` green (693 files / 9771 tests);
`contracts:extract` re-run; `docbot:report -- --check` agrees on all 26 headline numbers (report bumped:
1810 / 5656 / 141136 / 155). Two Pixi FX tests (`prewarm`, `prodPlayback`) time out only under the full-suite
load and pass alone — pre-existing.
