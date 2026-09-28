# 2026-09-27: repeating End-of-Turn effects accelerate (R-REPEAT-04)

Owner report (verbatim): "kringle and other end of turn effects that REPEAT, need to go extremely fast, this is going
to take me minutes to finish." The screenshot showed Kringle at x106.

## Why it was slow

R-REPEAT-01 gives every repeat its own ROOT trigger in the End-of-Turn batch, and the Choreographer compiled each
one as a full own beat (delivery 120, completion 540, recovery 170 ms). 107 ticks came to about 76 seconds.

## The fix (presentation only)

- `packages/ui/src/choreographer/repeatPacing.ts`: `repeatChainSchedule(count, fullSpanMs)` is a pure schedule.
  With the shipped 710 ms beat:
  - lead-in: 710, 497, 320 ms (100 %, 70 %, 45 %)
  - accelerate: 160 ms x 0.6^k (160, 96, 58, 35, 21) down to a 20 ms floor
  - batch: whatever does not fit is packed several ticks per 20 ms slot, spread evenly
  - settle: the final tick holds 240 ms
  - hard cap 2.5 s per chain. Measured: N=5 1.93 s, N=10 2.16 s, N=50 / 107 / 200 2.50 s (27 visual slots).
  - a plain effect is untouched and a Chronos double (N=2) keeps both beats at full pace.
  - accents: lead-in, final tick, and slot starts at least 130 ms apart (9 accents for any long chain).
- `compileTimeline.ts`: End of Turn only. A root own-beat carrying `repeat.count >= 2` is paced: its timing is
  scaled by one factor (delivery, completion, recovery, stagger, markers, so the SHAPE is kept), reactions inside it
  are scaled with it, and a batched tick starts together with the previous one. `CompiledBeat.pace` carries
  `{ scale, accent, sharesSlot }`. Every tick keeps its own beat and deliveries; the projection folds every delivery,
  so the stats still roll and land on the exact committed values.
- `Recruit.tsx`: a quiet (non-accent) tick skips the source cue, the trigger sound and its `statsChanged` /
  `spellResolved` presenters (ribbons, cast flourish). Other consequence types still present on every tick.

Covered: Kringle, Striker, Mother Moss, Rope Wrangler (cast Lasso per 10 Gold), Rune of Action, and any Chronos or
rune repeat of an End-of-Turn trigger (Combat Prowess replays, recurring runes), because they all ride
`repeatIndex/repeatCount` on the End-of-Turn batch.

## Not changed

- Combat: `combatMomentAdapter` never sets `repeat`, and the pacing is gated on the `endOfTurn` phase.
- Shop plays with repeats (Squirl Scout, the Dragon-count spell, the Celestial shop-spell Shout) replay through
  `replayBuffFxEvents`, already capped by `waveMaxCount` / `waveGapFor`. Not the slow path.
- Start of Turn beats use their own recorder (`sotBeat.ts`), not this path.
- The legacy End-of-Turn path (`localStorage ascent.choreo = '0'`, 760 + 170 ms per beat) is the rollback valve only
  and is not paced.

## Verification

`packages/ui/src/choreographer/fastRepeatPacing.test.ts` pins the curve (N = 5, 50, 200, 1000 under the cap, lead-in,
settle, monotonic tail, accent spacing) and plays Kringle's real batch at 5, 50 and 200 ticks: one beat per tick,
every delivery lands, the chain is at most 2.5 s, the first tick shows exactly one grant, and the final projection
equals the committed board. `repeatPerTickBeats.test.ts` now asserts paced growth instead of three full beats.
Oracle: R-REPEAT-04 in `packages/rules/src/registry/approved/triggers.ts`.
