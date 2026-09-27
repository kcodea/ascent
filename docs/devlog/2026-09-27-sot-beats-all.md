# 2026-09-27: every Start of Turn effect gets its own beat

Owner ruling (verbatim): "yes they all need their own beat, and the timer/turn shouldnt start until after they
complete. also, they need to wait until the transition back from combat finishes."

Follows #1761 (Lord of the Risen x Ancient of Time, the first Start of Turn beat). R-SOT-BEAT-01 is now fully met, and
there is a new rule, R-SOT-TIMER-01 (triggers).

## Sim: one read-only recorder, every source wrapped

- `packages/sim/src/sotBeat.ts`: `recordSotBeat(s, source, run, { always })` snapshots the board stats, the hand, shop
  and board uids, Gold, open and queued Discovers, `runeProcs`, and the `recruitBuffFx` / `equipFx` lengths. It runs
  the source, then records ONE `SotBeatFx` holding the diff: gains, handGrants, summons, shopAdds, gilds, gold,
  discovers, procs, plus the buffFx and equipFx records the source stamped (the same objects). It never touches the
  RNG and writes nothing the sim reads back. The recorded run is unchanged (`sotBeatsAll.test.ts` compares wrapped
  and bare runs, and the RNG cursor).
- `SotBeatFx.source` is now a union: hero / minion / rune / quest / equipment / gift.
- `RunState.sotRuneProcs` counts the rune procs made inside beats (display only). The badges hold them back until the
  beat plays.
- `advanceCombat` wraps each source, in sim order:

| Source | Where | Beat shows |
|---|---|---|
| Cassen's Commission (hero) | payCommission | power button; Gold / spell / Discover |
| Rune of the Treasure Map (both shapes) | the per-turn reset block | rune ring + burst; Gold |
| Rune of the Long Shift | | rune; 2 Discovers (open after the beats) |
| Rune of Resonance | | rune; Ruby to hand |
| Rune of the Astral Draft / Traveling Festival | | rune; Discover / Revelers to hand |
| Merry Christmas / Happy Birthday | | rune; Gift Discover / Gift to hand |
| Royal Allowance (Gift) | | no node; Gold Pouch arrives |
| Gravetwin (each survivor) | fireGravetwinEchoes(wrap) | medallion; what its Echo made |
| Chaos / Gildmaster / Great Presence (hero) | | power button; token / Goldcrafter / Gift Discover |
| Banked quest repeats (pendingQuestRewards) | | quest badge (or rune); the reward |
| Recurring grants (Feed the Alpha, Hoardflame, Dragon Breath, Falling Embers) | recurringGrantSource | rune or quest badge; card to hand |
| Cadenced grants (Clockwork Promotion etc.) | | rune / quest; card to hand |
| Rune of the Deep, Basic/Epic tribe drips | | rune; card to hand |
| Rune of the Pendant | | rune; gild (the stat doubling is held) |
| Equipment rebuild (each source body) | pushSotBeat per re-equip cue | body + slot ring |
| Rune of the Grand Workshop / Copies / Summit | | rune; Amplify / copy to hand / Tier 7 Discover |
| Board minions with Start of Turn (Fel Conjurer, Jumpstart Jules, Forked Crown), left to right | applyStartOfTurn(wrap) | medallion; card to hand / charge |
| Lord of the Risen x Ancient of Time | ancientStartOfTurn (now via pushSotBeat) | power button; gains |
| Rune of First Light | | rune; the Starform arrives in the shop |
| Rune of the Strange Caravan / Fresh Pages | | rune; minion to hand / Discover |

Not beats, by design: the silent bookkeeping (Bloodbinder flip, Shifting Facets tick, Guiding Candle refill, the Rune
of Choices charges, the per-turn resets). The turn's shop roll and a Fodder eaten at the roll are a shop refresh, not
Start of Turn, so they keep their own FX. The modal openers (quest offer, Runeforge, Mimic/Void pick, the Ancients
meter) keep their own presentation. They open after the beats, because the overlays now wait for them.
`checkTriples` runs after the beats and is a consequence, so a triple made from a Start of Turn copy shows as a
normal triple.

## UI

- `sotBeats.ts`: `planSotBeats` now plays pulse, then gains (70 ms apart), then arrivals (board, hand, shop; 120 ms
  apart), then a 420 ms tail. A pulse-only beat gets a 380 ms tail. `durationMs` is when the turn may start, and it
  is 0 for an empty batch. `holdSotBeats` / `releaseSotCue` / `sotHolding` cover the new card holds.
- `Recruit.tsx`: the holds are DERIVED DURING RENDER on `sotBeatFxSeq` (the `heldConsume` pattern). No frame shows the
  raised stats or the new cards, and the hand, board and shop rows filter the held uids. The player waits for
  `sotBeatsMayPlay` (wipe idle) + 300 ms. Per source kind: the hero gets the power button burst and sound; a minion gets
  its medallion pulse (`battlecryUids`) and the trigger sound; a rune or quest gets a `.sotflash` ring on its badge,
  and the rune burst is released from `sotRuneHold.ts`; Equipment gets body and slot rings. Gains fire the buff
  tendril from the source. Arrivals get the plate coalesce once rendered.
- The per-action buff wave and the equip cue pass skip the records a beat owns, so nothing plays twice or under the
  curtain.
- `sotPlaying` lasts from the batch's arrival to its last tail. It gates `turnClockMayTick` (new `startOfTurnPlaying`,
  plus `transitionPlaying` = the wipe is not idle) and `overlaysHeld`.
- **Input choice:** the Shop is NOT blocked while the beats play (blocking read as sluggish). Only the clock waits.
  The holds are deltas and uid sets over the live run, so a mid-beat action still reads right. A card that goes
  away mid-beat just releases into nothing.
- **Lobby / replay:** the timer is the local player's presentation clock (the engine is untimed). Bots, the other
  seats, the recorded actions and replays are unchanged. Delaying the local clock only delays when the local player's
  seconds start counting.

## A race caught on the prod build

The first cut reset the holds and `sotPlaying` in the "left the Shop" branch on EVERY effect run. That branch re-runs
on each wipe step. The reset queued at `coveredOut` landed after the render-phase hold for the batch that
`resolveCombat` brought in the same tick, so the hold was dropped and the clock started under the beats. Now the
branch resets only when there is a queue or timers to drop. It is pinned in the source and was re-measured.

## Measured

- Engine (tsx, heavy turn: 3 runes, Pourman, 2 Fel Conjurer, 2 Jumpstart Jules, 8 beats): `resolveCombat` 0.18 ms/op
  with the recorder. The recorder itself costs about 1 us per source.
- Prod build (vite preview :5198, practice save, 4-5 beats incl. an overflowing 15-card hand): wipe rests at about
  1.95 s after End Combat, beats from +300 ms, batch done about 2.2 s later. The first clock tick came exactly 1 s
  after the batch ended. Frame p50 / p95 / p99 were 12.5 / 12.6 / 12.6 ms, with no long tasks. The two worst frames
  (29 ms, 21 ms) were the two hand arrivals into the 16-card hand (hand relayout + coalesce). No looping paint
  animation: `.sotflash` is one-shot transform + opacity.

## Tests

- `packages/sim/src/sotBeatsAll.test.ts`: one beat per source in sim order, each with its own consequences; no beats on
  an empty turn; the Pendant's gild; the recorder is read-only (wrapped equals bare, same RNG cursor).
- `packages/ui/src/sotBeats.test.ts`: sequence and timing (pulse, gains, arrivals, tails; no overlap); an empty batch
  plans nothing and adds no delay; holds and releases; the rune hold; `turnClockMayTick` holds for the wipe and the
  beats; source pins for the render-phase holds, the player, the timer and overlay gates, and the owned records.


## Revision (same day, owner review of PR #1765)

"start of turn stuff looks fine for now - maybe just start the clock as normal though since you can play right away".
The turn clock no longer waits for the Start of Turn beats (`startOfTurnPlaying` is no longer passed to
`turnClockMayTick`); it still waits for the return wipe to come to rest, since nothing is playable under the curtain.
Offers raised at Start of Turn still open after the beats (`overlaysHeld`). R-SOT-TIMER-01 is rewritten to match.
