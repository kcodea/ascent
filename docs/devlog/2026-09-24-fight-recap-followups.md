# 2026-09-24: Fight Recap follow-ups (stuck Watch replay, odds bar, self hover in the rail)

Follow-ups to #1709 from the owner's first play.

## 1. "the watch replay gets me stuck in a screen here"

**Root cause.** In `useCombatReplay`, the final-hold effect sets `finished` (the replay's `done`). It only
re-armed when `replayComplete` (`beatIdx >= beats.length`) changed from false to true. An empty player board
resolves with ZERO events: `simulate([], four enemies)` returns `events: []`, a loss for 9 damage, which was
exactly the owner's round. So the replay has zero beats, and `replayComplete` is true both before and after a
seek. `seekTo(0)` ran `resetTo`, which cleared `finished`, and no effect ever set it again. Skip
(`setBeatIdx(beats.length)`, which is 0 again) was a same-value no-op. The arena sat on the enemy board with Skip
showing, forever.

**Fix.** A new `endNonce` is bumped by `seekTo` and `skip` and is a dependency of the final-hold effect, so
every seek and Skip re-arms the finish. A rewatch now also hands the player back to the recap when it ends
(`rewatchingRef` in `Recruit.tsx`); End Combat still settles once and returns to the shop.

**Regression test.** `replayRewatch.test.tsx` mounts the real hook under fake timers. It covers a zero-beat
fight reaching `done`, its rewatch reaching `done` again, a Skip mid-rewatch, and a normal fight's rewatch.
Registry rule **R-PRESENT-18**.

**Verified live** (headless Chrome on port 5288):
- Zero-event loss: the rewatch was back on the recap in about 250 ms. Skip during a second rewatch also came
  back. Run and seat health and history were unchanged. End Combat gave round 2 in the shop with the damage
  applied once.
- Normal fight: the rewatch came back to the recap after about 4.5 s, with the same checks passing.

**The hand.** The hand showing during the stuck screen is normal combat behaviour: the hand stays visible (and
hoverable) through every fight by owner design (`.app.combat .zone[data-zone='hand']`), so nothing changed there.

## 2. The odds bar, back and sleeker

The bar is always shown, 100/0 included. It is a thin rounded track with soft green, amber and rose segments,
a 2px gap between segments and a faint top highlight. There is no glow and nothing animates. Under the bar are
all three numbers, "30% Win / 0% Draw / 70% Loss". They are rounded by largest remainder, so they always sum
to 100.

The loss line is now a range, "A loss here usually costs 7-9 damage". The odds probe records each losing sim's
round-capped damage, and `lossDamageRangeOf` returns the 25th to 75th percentile (nearest rank), or min to max
when fewer than 8 sims lost. The range is stored as an optional `odds.lossDamageRange`. It is display-only and
never changes an outcome, and `odds.test.ts`'s byte-identical probe pins still pass. If the range collapses to
one number, only that number shows. Odds recorded before this change fall back to the rounded average.

Grammar: the line uses "an" before 8, 11, 18 and 80 to 89 ("You had an 8% chance to win").

## 3. Hover your own seat in the lobby rail

Owner: "add the same mouseover for self as we have for enemies". Your seat now opens the SAME `ScoutCard`: the
same markup, delay and position. It shows your name, your hero, shop tier, gilded units, build (dominant tribe),
your last three fights and your rune sockets. The table records no intel for the player's seat, so
`SelfScoutCard` computes it live from your run (`snapshotBoard` then `boardIntel`). It subscribes to the run
only while your seat is hovered. Clicking your seat does nothing (the owner asked for the hover only).
`lobbySelfHover.test.tsx` pins this.
