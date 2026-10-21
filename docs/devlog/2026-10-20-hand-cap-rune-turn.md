# 2026-10-20 — Rune grants over-cap the hand only on a rune turn

Owner report: "the extending of the hand past 10 cards should only happen on turns where a rune is acquired, not
from rune sources on every turn."

## The original intent

- 2026-08-04 rune-turn hand grace: `handCap` is 20 (`CONFIG.handMaxRuneTurn`) while the Runeforge is open ("at the
  start of rune turns the player should be allowed to have up to 20 cards only one time").
- The quest/rune reward overflow (archive devlog, "quest/rune reward cards overflow the hand"): reward cards skip the
  cap so an earned reward is never dropped. That entry said every other path, recurring ones included, stays capped.

## The cause

Later rune work reused the reward `overflow = true` flag for every rune grant, including the ones that pay every
turn or on a trigger: Rune of the Deep, the tribe and Reveler drips, the threshold meters (Hoardcalling, Dragon's
Pantry, Deep Feast), Last Rites, Body Counting, Afterglow, Closing Time, Festival Circuit, Foundry, Voicekeeper,
Collector, Draconic Curiosity, Strange Caravan, Meteor Shower, Quick Study, Facetwright, Recollection, Mountain
Trade, Stolen Constellations, the counted-spell copies, rune cadence grants and a rune's banked delayed repeat. Each
of those grew the hand past 10 on any turn.

## The fix

- `RunState.runeAcquiredWave`, stamped by `markRuneAcquired` at every place a rune joins `ownedRunes` (Runeforge buy,
  a reward that grants a rune, DEV and God Mode grants), before the rune's reward applies.
- `runeGrantOverflow(state)` is true only when that stamp is the current turn. Every rune grant site passes it in
  place of `true`. The quest reward engine passes it only when the def is a rune, so quest rewards keep the
  unconditional overflow and a rune's own pickup still over-caps.
- The 20-card cap while the forge is open is unchanged.
- Test: `packages/sim/src/handCapRuneTurn.test.ts` (fails on the old code). Rule: R-HAND-RUNE-TURN-01.

## Assumptions for the owner

- "Acquired" = bought at any Runeforge (Basic, Epic, hero, scheduled) or granted by a reward; the whole turn counts,
  including that turn's End of Turn and combat settle.
- Quest rewards are not rune sources and still over-cap on any turn.
- Cards already over the cap are kept; nothing is discarded next turn.
