# 2026-09-11 — Doc Bot: entry-path + fire-path lanes (two derived enumerations), and the Rally watcher set unified

Two September player bugs slipped past Doc Bot's 67 lanes (Bug Board round 2, PR #1374) for the same reason:
an enumeration was hand-listed where it should have been derived. Two new lanes close both classes, and the
second one found — and this PR fixes — two more defects of the Hawkus shape on its first run.

## `entryPaths` (`packages/sim/src/docbot/entryPaths.ts` + `.test.ts`)

**The miss:** Kindness's four targeted Gifts (Unbridled Might, Ironclad Favor, Champion's Regalia, Parting
Gifts) no-oped for a month — `applyCastEffects` sent `{ minion }` while the factories read `payload.target`.

**What the lane derives:**
- **Entry sites.** Every `hand`/`board` write in `reducer.ts` + `recruit.ts` (push / unshift / inserting
  splice) is scanned and keyed by file + enclosing scope + zone (`reducer.ts#buy#hand`,
  `recruit.ts#conjureToHand#hand`, …) and each must carry an `ENTRY_SITES` classification (shop-buy, play,
  discover, hero-grant, rune-grant, hand-mint, triple, token-summon, combat-carry, …). Unclassified → fail
  ("classify me"); an entry with no site → fail (rot). The count is printed by `npm run docbot`, not written
  here.
- **The non-shop worklist.** Every card in no set (Gifts, Tower Shield, Clue, tokens, henchmen) is looked up
  backwards: which active card names it in a param or def field (`ascendInto`), which rune, hero, quest,
  Equipment, or engine scope (`grantRandomGift` → one caller hop → `case 'runeHappyBirthday'`). Cards named
  by nothing are ORPHANS with a required reason (one today: the tutorial's `b2_ninjapal`).
- **Staged arrival + cast differential.** Every cast-shaped item is driven into the hand THROUGH THE REAL
  `reduce`: the minting Shout is played (Tower Shield), the rune is bought and its Discover picked (all 15
  Gifts via Merry Christmas), the Equipment is activated (Clue via the Magnifying Glass), a Ruby-granting
  rune is bought. Then it is cast, and the post-cast state must differ from the post-arrival state beyond
  hand-consumption, cast counters and cost. Refusals and unstaged paths are two-sided pins (one unstaged
  today: `warding-ruby`).

**Sabotage proof:** reverting `applyCastEffects` to `{ minion }` makes the lane report INERT =
`gift_ironclad, gift_unbridled, gift_regalia, gift_parting_gifts` — the four, by name.

**Instrument finding (not fixed here — scope):** the play lane's spell sub-lane DID cast every Gift; it
missed the bug because it diffs the post-cast state against the PRE-REDUCE fixture, and `reduce` lazily
initialises ~14 fields on every action (`lastRallyFires`, `fodderEaten`, `cardsPlayedTotal`, …), so every
cast reads as effectful and `playDifferential`'s "inert spells" gate is vacuously green. The new lane
compares two post-`reduce` states and proves in-file that it can call a cast inert. Re-baselining
`playScan`'s spell lane is a follow-up (it will surface a queue that needs triage).

## `firePaths` (`packages/sim/src/docbot/firePaths.ts` + `.test.ts`)

**The miss:** the Rune of Rallying's free Start-of-Combat Rally (`fireFreeRally`) ran only the rallier's own
effects; Hawkus / Paragon / Mineral Master lit on real swings and stayed dark on the rune's Rally.

**What the lane derives:**
- **Synthetic fire sites.** In combat the natural emitter is the `CombatBus` (`registerEffect`). Every other
  direct `FACTORIES[…]` dispatch in core — free Rallies, multiplier re-fire loops, Echo procs, combat Shout
  replays, Start-of-Combat, on-kill re-fires, Ruby replays — is scanned, keyed by file + enclosing scope +
  trigger, and must be classified in `SYNTHETIC_FIRE_SITES` (kind + which behavioural pair covers it, or the
  natural counterpart a future pair should compare against).
- **The Rally derivation pair.** For every `onAttack` factory in active content, the card is staged as a
  watcher and as a rallier under a natural Rally, a natural plain swing, a free Rally (read in the pre-attack
  window, so it is the only Rally in it) and a multiplied Rally (Uron, spy-counted invocations). Classes fall
  out behaviourally — self-rally, rally-watcher (Hawkus, Paragon, Mineral Master), attack-watcher (Crypt
  Drake, Skald, Warflame — verified by reacting to a plain swing, which is the documented excuse from free
  Rallies), unobserved (each with a checkable reason). The derivation: free reach = natural reach minus
  attack-watchers; multiplied = exactly 2× invocations. A registry↔behaviour test reads the engine's
  `RALLY_WATCHER_EFFECTS` literal out of simulate.ts and demands it EQUAL the derived rally-watcher class.

**Sabotage proof:** emptying `fireFreeRally`'s watcher loop (the pre-#1374 shape) yields three divergences
(Hawkus, Mineral Master, Paragon: "not reached by a free Rally — the Hawkus class").

## Two engine fixes the fire lane found on its first run (`packages/core/src/combat/simulate.ts`)

1. **`RALLY_WATCHER_EFFECTS` named Paragon alone** (the 2026-08-14 fix) while the free-Rally set from #1374
   named all three RL-gated watchers — so with Uron ("your Rallies trigger an additional time") on the board a
   real Rally re-fired Paragon and left Hawkus and Mineral Master at ×1. One set now serves both paths.
2. **The watcher loops walked the LIVE board.** Once Hawkus was in the set, its proc'd Echo summoned a token
   that shifted Hawkus right under the `for…of`, and it fired AGAIN (3 fires for a ×2 Rally). Both loops now
   iterate a snapshot, like the bus's fixed subscriber list. Pinned in
   `packages/core/src/combat/rallyMultiplierWatchers.test.ts` (spy-counted, including "Crypt Drake is NOT
   doubled").

Player-facing: Hawkus and Mineral Master now fire twice per Rally under Uron (patch notes entry added).

## Wiring

- `npm run docbot` narrates both lanes (site counts, the worklist buckets, the Rally classes) and lists them
  in the existsSync roll-call; `docs/docbot.md` cites them; `docs/docbot2/final-report.md` regenerated.
- The two scanners read source with `node:fs`, so the CLI imports them relatively (the `build-pool.ts`
  precedent) rather than through the `@game/sim` entrypoint that rides the web bundle.
