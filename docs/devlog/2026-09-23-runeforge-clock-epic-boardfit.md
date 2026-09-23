# 2026-09-23 — Runeforge batch: the Clock pays, two Epic forges on turn 8, the board-fit thresholds, current rune docs

Four owner rulings from 2026-09-22, shipped together on `feat/runeforge-clock-epic-boardfit`. A previous
session had banked a WIP commit when the PC restarted; this session reviewed it, finished it and squashed it.

## 1. Rune of the Ornate Clock pays its 2 Gold

Owner: "fix rune of ornate clock". The reward `{ kind: 'scheduleRuneforge', forge: 'epic', gold: 2 }` carried
the Gold, but `applyQuestRewardInner`'s Epic branch only armed the deferred forge and set `epicForgeClaimed`;
only the Basic branch (The Runeforge quest) ever read `r.gold`. The Epic branch now pays `r.gold` through
`gainGold` on resolve, exactly once (nothing is banked for the turn the forge opens; a duplicate Clock is
ruled-unique and does nothing). The text-as-oracle economy check (`textOracleEconomy.ts`,
`runeEconomySubjects`) now reads an Epic-branch `scheduleRuneforge` Gold as an IMMEDIATE promise, so the
Clock GRADUATED from the excluded list (pin 7 → 6, plus an explicit "the Clock is in the oracle" assertion).
`economyScan.test.ts`'s `scheduleRuneforge` checker also asserts the Gold delta on that branch.

## 2. Guardian + Rune of the Epic Forge: two Epic forges on turn 8

Owner: "can we just book 2 runeforges here" → yes. Before, `epicForgeWave` was one slot and
`pendingEpicRuneforge` a boolean: a Guardian (turn 8 booked at creation) buying the rune (turn 8) found the
slot taken and got a deferred next-turn forge instead (audit find 2026-08-06), and any two arms on one turn
collapsed into one forge.

Now:
- `pendingEpicRuneforge` is a **count** (`pendingEpicForges(s)` reads it; a pre-count save's `true` reads
  as 1). `openNextStartOfTurnModal` opens ONE Epic forge per pass and decrements; `buyRune` / `skipRuneforge`
  drain back through it, so the second opens the moment the first closes, on the same turn, ahead of the
  Basic forge and any Discover (order: power pick → Epic forges → Basic forge → Discovers).
- `epicForgeWave` + new `epicForgeCount`: `bookEpicForge(s, wave)` counts a second booking for the held wave
  instead of overwriting or sliding. Guardian's creation-time write stays a plain `epicForgeWave = 8`; the
  rune (`Math.max(onWave, wave + 1)`) and an adopted Guardian power (`Math.max(8, wave + 1)`) book through it.
- Each forge draws from its own stream: the first keeps `mixSeed(seed, wave, TAG.QUEST, 2)` (older replays
  reproduce), the second adds its index, and it passes the first forge's offer as the `avoid` set so the two
  offers differ. New `epicForgesOpened: { wave, offers }` records what opened this turn; persisted, so a save
  mid-way through the first forge restores the second's stream.
- Unchanged: Runesmith turn 5, universal Basic 6 / Epic 9, the Clock's move, the once-per-game re-roll.

Open edge, unchanged in kind: an ADOPTED Guardian power (Void, Power Shifter) books a forge each time it is
adopted. The old `!epicForgeWave` guard only suppressed a re-adoption while a booking was still ahead, so a
second adoption after turn 8 already booked again; Mimic excludes Guardian. Flagged, not changed.

## 3. The "fits the board" rule

Owner, verbatim: "what is the logic for a rune that 'fits the board' though? for basic, it should be at
least 2 of a tribe type, and for epic it should be at least 3 of a tribe type. make sure all types count as
1 of everything."

`boardSynergyTags(s, epic)` now tags a TRIBE only when `boardTribeCounts(s)` reaches
`BASIC_FORGE_TRIBE_FIT` (2) at a Basic forge or `EPIC_FORGE_TRIBE_FIT` (3) at an Epic forge (`epic`
defaults to the forge that is open, `!!s.runeforgeEpic`). Counting goes through the shared `isTribe` helper,
so an All-types body (`universalTribe` / per-instance `allTribes`) is one of every tribe, a dual-tribe card
counts for each tribe, and a spell-added tribe counts too. The same tag set drives the guarantee and the
pivot discount in `drawRuneOffer`, so both moved together.

Decisions stated in the PR:
- **The hand does not count.** Only the 7 board slots: the hand is uncommitted (it may be sold or never
  played), and a forge opens at the start of a turn, when the board is what just fought.
- **Mechanic tags stay presence tags** (one card carrying Rally / Echo / Shout / Avenge / Consume / Ruby /
  Ale / spells / Gold / summon is enough). The owner's rule speaks of "a tribe type"; a mechanic threshold
  would be a separate ruling.
- Spirit / Celestial / Starform / Reveler are NOT added to `runeSynergy.ts` yet (owner: "thats fine for now,
  but flag it for when set 3 is live") — one roadmap line under *Rune build-out*. Note the module lives at
  `packages/content/src/runeSynergy.ts`, not under `sim` as the handoff said.

## 4. Stale docs and comments

`docs/GAME-RULES.md`'s rune section was rewritten from the code (it said "random 3", "re-roll once for 2
Gold", "Verified turn = 7", and never mentioned the universal turn-6 / turn-9 forges): 4 per visit (tutorial
3), the full schedule, the pool filters in order, equal weighting, the board-fit thresholds, the pivot and
hero discounts, the one free re-roll per game, the seeding. Comments fixed in `state.ts` (turn 6 / 2 Gold),
`heroes.ts` (random 3 / turn-6 advance), `reducer.ts` (random 3, turn-7, and the hero-discount design comment
that contradicted `forgeDiscount.test.ts` — the discount applies at EVERY forge the hero visits, owner: fine),
`runes.ts` (2 Gold re-roll), `core/types.ts` (random 5), and `playerReport.ts` (forge = the rune's POOL, which
is exact; the TURN is not in telemetry — `offeredRunes` is a deduplicated id set — so "survived to its forge"
is an approximation of the survival floor, stated as such).

Ruled out, not touched: the tutorial re-roll serving the same runes; Runesmith + Clock making Duplication a
dead buy; the hero discount at every forge.

## Verification

- `packages/sim/src/runeforgeClockEpicBoardfit.test.ts` (18 tests): the Clock's text/data agreement and
  pay-once; Guardian + rune → two turn-8 forges with distinct Epic offers, both buyable, skip opens the
  second, turn 9 unaffected; non-Guardian → one; save/restore mid-way; legacy boolean; determinism; the
  thresholds (1 / 2 / 3 Beasts, All-types + 1, dual-tribe, hand excluded); the guarantee on a 2-Pup board;
  a Beast rune CAN be discounted on a 1-Pup board and NEVER on a 2-Pup board. 14 of the 18 fail against
  `origin/main`'s reducer + state (the 4 that pass are the pure data pins).
- Oracle: `R-RUNE-01` (Clock payout), `R-RUNE-02` (two booked Epic forges both open), `R-RUNE-03`
  (board-fit thresholds) in `packages/rules/src/registry/approved.ts`; `final-report.md` counts 179/93 →
  182/96.
- Gate: `npm run typecheck && npm run lint && npm test && npm run build:web`; `npm run docbot`;
  `npm run docbot:report -- --check`.
