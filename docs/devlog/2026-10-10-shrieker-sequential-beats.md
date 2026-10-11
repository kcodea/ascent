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

## Not changed (different code paths)

- Moira (archived) shares the factory, so she gets the same chain (with a beast tendril).
- Roomworks (one targeted End of Turn), Echoing Roar, Rune of the Crucible Choir, Drakko x Time: one Shout each, so
  there is no chain to split.
- Dawnclaw's Shop Echo (`deathrattleReplayAdjacentBattlecry`) and High King Mykel (`spellCastTriggerAdjacentShouts`)
  fire two Shouts inside one beat with no per-Shout nested trigger. They could opt in by wrapping each fire in a
  nested trigger and adding `children: 'sequential'` to their registry entry.
