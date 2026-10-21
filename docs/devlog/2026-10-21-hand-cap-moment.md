# 2026-10-21 — Rune grants over-cap the hand only at the moment of acquisition

Owner, on #2183's assumption that the whole turn of acquiring a rune counts: "seems fine, but whole turn shouldnt
count, only the moment when rune is selected/rewards granted i think". R-HAND-RUNE-TURN-01 updated in place
(`packages/rules/src/registry/approved/runes.ts`).

## What changed

- The turn window is gone. `RunState.runeAcquiredWave` and `markRuneAcquired` are removed.
- `withRuneAcquisition(fn)` in `packages/sim/src/state.ts` is a synchronous, re-entrant, exception-safe scope marker
  (a module-level depth counter, like the cast-actor and collector scopes). `runeGrantOverflow()` (no argument now)
  is true only inside it.
- It wraps exactly the rune's reward application at the four acquisition sites in `reducer.ts`: `buyRune` (including
  Rune of Duplication's second application), the `grantRune` reward, the DEV grant and the God Mode grant. Nothing
  after the reward (closing the forge, triples, the next queued modal) is inside it.
- Every rune grant call site (`recruit.ts`, `reducer.ts`, `starform.ts`) calls `runeGrantOverflow()`. So a rune's own
  pickup grant over-caps; an End of Turn drip, a trigger, a meter, combat or a delayed repeat later the same turn does
  not.
- Unchanged: quest rewards keep their unconditional overflow; the 20-card cap while the Runeforge is open; cards
  already past the cap are kept.

## Persistence and replays

The flag is never stored, so nothing new is saved. An old save that still carries `runeAcquiredWave` loads as before;
the field is simply never read (pinned by a test). A replay of a run recorded under the 2026-10-20 rule that hit a
same-turn rune grant on a full hand would now resolve that grant under the narrower rule, like any rule change.

## Verification

`packages/sim/src/handCapRuneMoment.test.ts` (renamed from `handCapRuneTurn.test.ts`): 8 tests, 4 fail on the old
code (the scope marker, a later same-turn rune grant, already-over-cap cards are kept without more being added, and
an old save's stamp granting no over-cap).
