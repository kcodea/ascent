# 2026-09-09 — R-HAND-02: a card buffed in hand keeps the buff, in every phase, shown live

Owner ruling (verbatim in the oracle): *"cards buffed in hand are always permanent. so if something buffs a
card in hand during combat, that card in hand retains the buff. the buff also needs to show in real time
like all of our other effects do."*

## What existed

Combat could reach the hand only through run-wide channels (Ruby strength, card-type buffs), which already
persisted. There was no way for a combat effect to buff *a specific hand card* at all — so the rule had no
channel to be true or false on. The audit of hand-touching shop effects (Flagship, Scales, the tribe-target
rune payout, the Ruby-strength factories) found nothing that fires mid-fight either.

## The channel

- **Core** — `ctx.buffHand(uid, a, h, side, source)`: grows the start-of-fight hand snapshot (so a later
  hand-summon fields the buffed body), logs a `handBuff` event, and accumulates `playerHandBuffs` on the
  result. Player-only for the same structural reason as `grantToHand`: a served board has no hand.
- **Arena** — `handMinions()` / `buffHand(t, a, h)`, so an effect body is written once; the shop adapter
  reads the live hand (minions only, matching the combat snapshot) and calls `addBuff`. The first body on it
  is `deathrattleBuffHandTribe` ("Echo: give the <tribe> minions in your hand +a/+h"), unused by content
  today — it is what the scenario drives through `simulate()` with an injected probe card.
- **Settle** — applies the carry-back with `addBuff`, attributed to the granting body's card name when its
  combat uid resolves against the fight's initial snapshot.
- **UI** — `handBuffsShownThrough(events, beats, beatIdx)` sums the deltas the replay has reached per hand
  uid; the hand row adds them through the same stat-override slot the End-of-Turn animation uses, and drops
  them at settle when the buff is in the run hand itself. The event is wired through every beat/choreo list
  (`toHand` was the template), narration, the bug-report scenario text, the harness, and the trace coverage.

## Oracle

`R-HAND-02` in `approved.ts` (not `-01`: `main` already held `R-HAND-01`, the hand-gain watchers ruling).
Enforcement: `packages/sim/src/handBuffInCombat.test.ts` (event, carry-back, golden, enemy-side no-op, the
settle permanence through the reducer, and the shop half via a per-instance copied Echo) and the replay
helper's case in `useCombatReplay.test.ts`. Rules doc section added beside the hand-gain rule; report totals
129 / 45.

## Not player-facing yet

No shipped card buffs the hand mid-fight, so there is no patch note; the first card to do so inherits every
guarantee above. Not verified live in the browser for the same reason.
