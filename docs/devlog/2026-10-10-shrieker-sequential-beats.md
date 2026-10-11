# 2026-10-10 · Shrieker: one beat per triggered Shout, left to right, one dragon tendril each

Owner ask: "every shout minion that triggers an effect gets their own beat from left to right. they do not all
happen at the same time ... the tendrils will fire 1 at a time as each shout triggers". Oracle: R-SHRIEKER-BEATS-01
(foundation.ts).

## Why it played all at once

The engine was already right. `endOfTurnTriggerShouts` (recruit.ts) resolves the roster left to right and wraps each
re-fired Shout in its own nested trigger (`factory:<its Shout>:onPlay`, `discardIfEmpty`). The compiler then placed
every nested trigger as a REACTION at its parent's delivery (`placeChildren`), so all the Shout beats started on the
same millisecond and every buff landed together.

## The fix (presentation only)

- **Registry flag.** `PresentationPolicyEntry.children?: 'sequential'` (core/presentation/types.ts), set on
  `factory:endOfTurnTriggerShouts:endOfTurn`. The adapter reads it off the registry by the stamped `policyKey` into
  `TimelineSourceNode.childOrder`, so recorded End-of-Turn batches (replays) get it too. No event-schema change.
- **Compiler.** A sequential parent places its non-silent children end to end (each starts at the previous one's
  `recoveryEndMs`), stamps `CompiledBeat.chainLink { index, count, from }`, and stretches the parent over the chain so
  the next root waits. Any other parent is untouched.
- **Chain pacing** (`CHAIN_LINK_PACING`): delivery 230 ms (the dragon ribbon lands at 210), completion 420,
  recovery 60, about 480 ms per Shout vs a plain own beat's 710. Six Shouts about 2.9 s, gilded about 5.8 s. Delivery
  is a floor and hold/recovery are ceilings, so a Beat Lab tune of a Shout still applies.
- **Tendril.** `Recruit.tsx` `onBeatActivate`: a `chainLink` beat fires `fireBuffFx` from the parent to the beat's
  source with the parent's tribe, which is `tendril-trail-dragon` for Shrieker. One ribbon per beat, no loops.

Gilded order stays A, B, C, A, B, C: that is the engine's order (the gild loop wraps the roster loop, Moira's
precedent), and presentation must not reorder. Orivax / Drakko repeats run inside `replayBattlecry`, so they stay
inside that minion's one beat.

## Follow-up on the same PR: Dawnclaw and High King Mykel (owner: "dawnclaw and mykel should also do one at a time")

- **Engine (presentation only).** `deathrattleReplayAdjacentBattlecry` (Dawnclaw, Ryme) and
  `spellCastTriggerAdjacentShouts` (Mykel) now route their fires through `replayShoutsAsChain` (recruit.ts). It
  calls `replayBattlecry` once per fire, in the same order as before, inside a parent trigger (the trigger-er,
  `factory:<do>:<on>`) with one nested trigger per Shout, both `discardIfEmpty`. It skips opening the parent when
  the caller already opened that same trigger for that minion (`recruitTriggerSpecs`). Both registry entries get
  `children: 'sequential'`. With no collector, the fires are byte-for-byte the old loop.
- **Order.** Left neighbour first. Gilded Dawnclaw is L, L, R, R: the shop loop was already per-neighbour-then-repeat,
  and so is the combat factory, so both phases agree. Mykel gilded is L, R; plain picks one seeded neighbour.
- **Shop (mid-turn).** Mid-turn actions never play the beat batch (only End of Turn does; the batch is DEV-only
  elsewhere), so the sim also stamps `shoutLinkFx` (`{ fromUid, fromCardId, toUid, fxStart, fxEnd }`, per action,
  reset in `reduce` beside `questTendrilFx`) + `shoutLinkFxSeq`. `choreo/shoutChain.ts` `planShoutChain` lays link k
  at `k x 480 ms` and that fire's `recruitBuffFx` slice at its delivery (+230 ms), the same `CHAIN_LINK_PACING` as
  End of Turn. Recruit draws the tendril per link (`shoutLinkFxSeq` watcher, the trigger-er's last slot if it has
  left the board) and the `recruitFxSeq` watcher holds each fire's buff records for its link. Under the arena or the
  curtain the chain is skipped and the records play in the normal settle wave. The End-of-Turn commit advances
  `prevShoutLinkSeq` (eotCommitSeqs ADVANCED).
- **Combat.** Already one moment per `shout` fire (`channels/shoutFired.ts`), left neighbour first
  (`livingNeighbours`). `useCombatReplay` `onShoutProc` now draws the trigger-er's tribe tendril on that moment when
  `isShoutChainTrigger(card)` (read off the same registry flag), streaming from the fallen Echo body's last slot.
  Combat moment timing is unchanged, so the combat tendril starts with that fire's moment rather than strictly
  before its buffs. Mykel has no combat factory (Shop only).

## Not changed (different code paths)

- Moira (archived) shares the factory, so she gets the same chain (with a beast tendril).
- Roomworks (one targeted End of Turn), Echoing Roar, Rune of the Crucible Choir, Drakko x Time: one Shout each, so
  there is no chain to split.
- Dawnclaw and Mykel: done in the follow-up above.
