# 2026-09-24 — Kobold / Dwarf batch: Goldilox, Striker repeats, retiers, two archives, Beggy back

Owner card batch of 2026-09-24, built on `feat/kobold-dwarf-batch`.

## Content

- **Pickles** (set 3 Kobold) T3 5/3 → **T2 3/3**. **Flagrunner** T4 4/6 → **T3 5/4**. **Tromboneer** (set 3 Dwarf)
  T4 6/3 → **T3 4/3**. **Brunni** (set 2 Dwarf, shared into set 3) T3 → **T2**, stats unchanged.
- **Kurse** is now **Kobold/Undead** (`tribe2: 'undead'`). No engine change was needed: every tribe count reads the
  shared helpers (`isTribe` / `defIsTribe` / `boardTribeCounts` / `playedThisTurnFor`), the combat Undead checks all
  read `tribe2`, and the Runeforge board-fit counts it for both. Pinned in `koboldDwarfBatch.test.ts` (board tally,
  Undead-played tally, the rune board-fit tags, the set-3 Undead generation pool, and a combat Lantern of Souls cast
  reaching it).
- **Gemsmith** (`k3_forkvein`) and **Double Dealer** (`k3_forkedcrown`) moved verbatim to `cards/archive.ts`
  (in no set, still resolvable by id). Nothing generated either by id.
- **Beggy** (`k_beggy`) opted back into `SET2_KOBOLDS_IN_SET3` — shared, still a set-2 card. Pool order: it sits at
  its set-2 position, between Boulderdash and Blazer.
- **Goldilox** (`dw3_goldilox`, set 3 Dwarf/Spirit, T3 2/2) appended to `SET3_DWARVES`: "When you cast a Shop spell,
  gain +3/+2. Gains 2x while in hand." Art wired from `Set 3 Minions/Dwarves/Goldilox.png`.

## Striker → the REPEAT form (R-REPEAT-03)

"End of Turn: give adjacent minions +1 Attack. Repeat for every card played this turn." `endOfTurnBuffAdjacentPerCard`
now runs Kringle's path (`forEachTick` + `eotRepeatTick`) and `eotTickCount` returns `1 + cards played` for it, so the
commit, the projection and the beat list agree. A turn with nothing played now pays +1 once (the lump form paid 0).
The old itemizer `eotPerCardWaves` had no other caller and is deleted. Live text: per-tick grant + `(×N)`.

## Goldilox — a new cross-phase "Shop spell identity" hook (R-SHOPSPELL-01)

Owner: *"shop spells cast from anywhere count, not rubies, clues or generic spells … ales ARE shop spells … this should
work in combat … those stats are permanent per our rules for hand granted stats in combat."*

- **What counts** — `isShopPoolSpell(def, pool)` (core): a spell in the set's Shop-spell pool, never a Ruby, a Gift
  (Clue) or a token. Pool membership is what shuts out "generic" spells.
- **One number** — `shopSpellGrowth(params, golden, inHand)` (core) is used by the shop factory, the combat factory,
  the combat hand dispatch and the live text.
- **Shop** — `shopSpellCastGrowSelf` (recruit) on `spellCast`. `noteSpellCast` now also dispatches HAND watchers that
  opt in with `alsoInHand: true` (board-only `spellCast` watchers stay asleep in hand). Every shop cast path funnels
  through `noteSpellCast` EXCEPT the three legacy End-of-Turn minion casts (`castSpell`, `endOfTurnCastSpellOnSelf`,
  `endOfTurnCastSpellEscalating`), which bump the tallies by hand; they now call `fireShopSpellGrowers`, which pays
  Goldilox only. Routing them through `noteSpellCast` would change every watcher and rune at once, so it is left as a
  follow-up (the other `spellCast` watchers still miss those casts).
- **Combat** — the bus `spellCast` fires before a cast's body and has no spell id. `castInCombat` now opens a
  per-repetition identity probe (`ctx.castProbe`), named by an explicit `spellId` argument or by the first
  `withCastingSpell` mark inside the body; when the repetition ends it calls `ctx.spellResolved(side, spellId)`.
  `simulate` checks the spell against the side's pool, then pays the board (`shopSpellCastGrowSelf`, permanent via
  permaGain + `permaLabel`) and the hand (`ctx.buffHand`, R-HAND-02, live `handBuff` event). The factory ignores the
  id-less bus emit, so each cast pays once. The four casts whose bodies never mark a window (the Lantern tribe-aura
  cast, Hoardbreaker's Growth, Spell Drummer, Spark Capacitor) pass their id explicitly.
- Settle now names a hand buff whose source is the hand card itself after that card ("Goldilox"), not "Combat".
- **Live text** — `shopSpellGrowthText`: in the HAND the card prints `{{+6/+4}} (2x while in hand)`; the board, shop and
  combat keep the exact printed text. `LiveTextParams.inHand` is new, set by the Recruit hand row.

## Doc Bot / tooling touched

- `firePaths.ts`: `simulate.ts#spellResolved#spellCast` classified (natural-dispatch).
- `beatConservation.ts`: a BORROWED hand card (Funeral on Loan) that lands now counts as a board arrival. The builder
  sweep hit its first borrowed play after this batch shifted the pools, and the checker wrongly flagged the
  `cardSummoned` beat `landBorrowed` emits. This was a checker gap, not an engine bug.
- `renderedText.registry.ts`: Goldilox excused (its only live value is hand-only); `docbotLiveText` RICH bag sets `inHand`.
- `contracts:extract` / `docbot:sync` regenerated; the set-3 self-play aggregate snapshot regenerated (pool changed).

## Judgement calls (flag to the owner)

- A **board** Goldilox's combat gain is **permanent** (like Kindled's), reading "those stats are permanent" as covering
  both locations, not only the hand.
- A spell cast by the ENEMY side never grows your Goldilox (only your own casts are "you cast").
- Striker text uses the owner's wording "Repeat for every card played this turn" (Kringle says "you played").
