# 2026-10-02: Ancients × Xerox

Xerox's six Ancient pairings (hero id `xerox`, power **Copy Machine**: "Summon an exact copy of a friendly minion. Needs
a free board slot. Once per game."), in the owner's words, built on the Ancients proof of concept and mirroring the Frank
and Hunch pairings ([2026-09-30](2026-09-30-ancients-frank.md)). Still dev-only (the Scene Builder's Set 3 Ancients flag),
so there is no patch note, like the Frank and Albus PRs.

"A copy" means Copy Machine's EXACT copy everywhere (owner ruling 2026-08-15, R-COPY-02): current stats, the buff
breakdown, keywords, gilding, accrued counters, under a fresh uid, never a pool body. The Shop builder is now one helper,
`exactBoardCopy` (recruit.ts), shared by Copy Machine and the Ancients (Copy Machine's output is byte-identical). In combat
the equivalent is the body's current stats with its Ward / Rise state and its keywords (the Mirror March `copyStats` path).

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Avenge (5): Summon a copy of your highest attack minion" | A hero Avenge (5) on ONE running count of friendly deaths across Shop and combat (`AncientsState.xeroxDeaths`). Every 5th death copies the highest-Attack minion (ties: left-most) beside it. Full board: nothing. Rune of Fury fires the combat half again. |
| Fortune | "Gain 4g next turn for every pair you have on board" | End of Turn (virtual recurring entry `ancientXeroxPairs`): +4 Gold next turn per pair, floor(n / 2) per card, Gilded and plain the same card. |
| War | "Start of Combat: Summon a copy of your highest health minion" | Start of Combat: an exact copy of the highest-Health living minion (ties: left-most). Combat-only body. |
| Genesis | "Gain another charge of Copy Machine" | The pick banks 1 more Copy Machine use (`xeroxCharges`). Copy Machine is once per GAME, so this is 2 uses for the game, not per turn. |
| Time | "Start of Turn: Get a copy of a minion you control." | Start of Turn: an exact copy of a random board minion (seeded) to hand, on its own Start of Turn beat. |
| Bonds | "The copy and the original are bound. Stats one gains, the other gains too. * if this triples, the effect breaks" | Copy Machine binds copy + original (`xeroxBond`). Gains mirror one hop, real time, both phases. The bond breaks for good on a triple, a sale, a Shop death, or the end leaving the run. |

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): an `xerox` block, six new `AncientEffect` variants and the Xerox hooks
  (`ancientXeroxShopDeath`, `ancientRunXeroxPairs` + `boardPairs`, `ancientCopyCharges` / `ancientSpendCopyCharge`,
  `xeroxStartOfTurn`, `ancientOnCopyMachine` / `ancientXeroxBondValidate` / `ancientXeroxBondTripled`). New
  `AncientsState` fields: `xeroxDeaths`, `xeroxPairGold`, `xeroxCharges`, `xeroxBond`, `xeroxBondBroken`.
- **Shop**: Death ticks at `fireOnFriendDeath` (every Shop death path once; a sale never). The dying body is excluded and
  its vacated slot counts as room. Bonds mirrors through `addBuff`, stamped like Sable's Soulbind (`stampXeroxBond`, at the
  reducer entry, on Copy Machine, after a triple, and on the End-of-Turn projection's clone with the live stamp restored
  after). The stamp validates the bond, so an end that vanished by any path breaks it.
- **Reducer**: Copy Machine calls `exactBoardCopy` then `ancientOnCopyMachine`; the `heroPower` gate grew `chargeUse`
  (a spent Copy Machine with a banked Genesis charge is available, and the use spends the charge). `combineIntoGolden`
  breaks a bond whose end was consumed.
- **Combat** (`@game/core`): `QuestCombatMods.ancientXeroxAvenge` (avenge-bus listener on `tick + count`),
  `ancientXeroxSoc` (Start-of-Combat pass beside Indy's Time gild), `ancientXeroxBond` (in `ctx.buff`, matched on
  `sourceUid`, with its own one-hop guard). The mirrored combat grant never accrues Engraved `permaGain`: a permanent gain
  on one end carries back through settle's `addBuff`, which the Shop half mirrors once. No new carry-back field (Death's
  count settles from `playerDeaths`, as Body Counting does).
- **Live text**: `{xDeathLeft}` (folds the fight's friendly deaths), `{pairs}` / `{pairGold}`, `{charges}` (uses left),
  `{bond}` (who is bound, or "The bond is broken."). Death's countdown also takes the shared centre disc
  (`ancientAvengeCountdown`, now including Copy Machine). The button reads ready while a Genesis charge is banked.
- **Doc Bot**: the combat-mod scanner arms `ancientXeroxAvenge` (Avenge 1) and `ancientXeroxBond` (the Soulbind fixture
  pair), so both act in the staged fight and the inert pin stays at 101.
- **Oracle**: R-ANCXEROX-01..06 in `packages/rules/src/registry/approved/heroes.ts`. **Tests**:
  `packages/sim/src/ancientsXerox.test.ts`.

## Judgement calls (open for the owner)

- **Genesis is per game**, because Copy Machine is once per game: two uses in total (or one more if it was already spent
  at the pick). No turn gate, so both can be used the same turn.
- **Death counts one running total across Shop and combat** (cross-phase by default), instead of resetting per fight
  like every other Avenge. The countdown therefore reads the same number in both phases.
- **Bonds "dies"**: a COMBAT death does not break the bond (the run card survives every fight); a Shop death does.
- **Bonds mirrors gains only** (the positive part), one hop, and binds only the FIRST copy (a Wishbone extra copy is
  unbound). Gains that bypass `addBuff` (a few direct stat writes, e.g. a Ruby's hand-card growth) do not mirror, the
  same scope Sable's Soulbind has.
- **Time** copies the exact body (Copy Machine's meaning), not a plain pool copy like the Rune of Copies.
- **FX**: no new beats. Combat copies emit an `sc` narration (Death's stamped `heroPower`, like Hunch's Death) and a
  normal summon; Time rides the Start of Turn beat; Shop copies and mirrored gains use the existing board diff.
