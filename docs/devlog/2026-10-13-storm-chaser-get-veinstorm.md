# 2026-10-13 · Storm Chaser gets a Veinstorm again

Owner: "storm chaser needs to change from: Cast a Veinstorm to Get a Veinstorm. So it should add a veinstorm to hand
instead of casting it directly."

## What changed

| Card | Before | After |
|---|---|---|
| Storm Chaser | Shout: Cast Veinstorm (gilded twice) | Shout: Get a Veinstorm (gilded 2). It goes to hand; nothing is cast |

This is the pre-2026-10-10 card: `battlecryGrantSpell { spellId: 'veinstorm', count: 1 }`. No engine change.

- **Shop:** the Veinstorm lands in hand. The Shop is not gemmed until the player casts it.
- **Combat:** a re-fired Shout grants through the live combat hand channel (`grantToHand`), so the Veinstorm is in
  hand after the fight. It is not a cast: no Shop half is banked and nothing defers.
- **Shrieker** (End of Turn: trigger Shouts) grants one more.

## What it leaves behind

- `battlecryCastNamedSpell` (the 10-10 "Cast Veinstorm" Shout and its real-time combat split) now has one card:
  Shardluck's Choose One branch. Its tests in `koboldBalance1010.test.ts` / `koboldBalance1013.test.ts` used Storm
  Chaser as the fixture; they ride a probe def that is the 10-10 Storm Chaser now.
- R-STORMCHASER-01 is amended: it describes the cast-Veinstorm Shout (Shardluck), and says Storm Chaser is no longer
  covered. The id is kept (ids are never recycled).
- The 2026-10-13 patch note that said "Storm Chaser and Gemling gem the Shop" is corrected to Gemling only.

## Verification

- New `packages/sim/src/stormChaser1013.test.ts` (8 tests): Shop play (plain and gilded), the granted spell is the
  real Veinstorm, Shrieker's re-fire, the combat re-fire and its settle.
- Re-pinned `set2Dragons.test.ts` (Storm Chaser hands one over; the Shop bank does not move).
