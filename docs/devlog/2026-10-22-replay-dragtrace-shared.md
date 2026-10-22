# 2026-10-22 — One drag path for both the replay and the spectators

**Bug.** In a ranked lobby game that is both recorded (replay frames) and watched (the spectator tap), every
drag-driven action (buy, play, sell, reposition, shop/hand reorder) gave its drag path to only one of the two. The
store's commit ran the replay recorder first, and it called `takeDragTrace()` (take-and-clear). Then `tapAct` ran
after the commit and called `takeDragTrace()` again, which found nothing. So the spectator tag had no `drag`, and the
stands saw the card jump to its slot instead of travel along the player's path.

**Fix.** `dragTraceOf(action)` in `packages/ui/src/replay/dragTrace.ts`. The first call for an action object takes
the park (the staleness rule still applies). Every later call for the same object returns the same path. A non-drag
action never touches the park. `dispatch` and `commitPresentationAction` hand the same action object to the commit
and to `tapAct`, so both consumers agree. Cost: one reference compare per call.

**Verified.** `packages/ui/src/replay/dragTraceShared.test.ts` drives a real store dispatch with the tap on and a
parked trace, and checks the replay frame and the spectator tag carry the same path. It fails on the old code (the
tag's `drag` is undefined). Oracle rule R-REPLAY-DRAG-SHARED-01 (foundation).

This is PR 1 of bringing replays up to live spectating quality (owner 2026-10-22). PR 2 records the spectator
stream into the replay; PR 3 plays replays through the spectator pipeline.
