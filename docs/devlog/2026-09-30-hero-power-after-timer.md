# 2026-09-30 · Hero powers and Equipment lock at 0:00

Owner bug report (2026-09-30), verbatim: *"goldspring is usable after timer ends. make sure hero powers cant be used
after timer ends"*. Rule: **R-TIMER-LOCK-01** (`packages/rules/src/registry/approved/actions.ts`).

## Why it happened

The Shop clock is UI-only (`turnClock.ts`); at 0:00 nothing auto-ends, the shop just "locks". That lock lived only in
Recruit's `timeUp` checks: Refresh / Upgrade buttons, drags from hand or Shop, the sell drop, the aim-target pick.
The StatusBar's hero-power button, Void's second power, the Equipment slot and the Henchman chip never read it, and
the reducer had no notion of the clock at all. So an **untargeted** power or Equipment (Nadja's Goldspring, any
`targetMode: 'none'` Equipment) dispatched straight through at 0:00. Targeted ones could still be armed but the
pick was refused by `timeUp`.

## The fix (both layers, one predicate)

- **Engine**: a new action `shopClockExpired`, dispatched by Recruit's tick the moment the clock lands on 0 (same
  pattern as Thymepiece's `discountWindowExpired`; the reducer still never reads a clock). It sets
  `RunState.shopClockExpired`, cleared at combat entry (`endRecruitTurn`) and at the turn flip.
- `packages/sim/src/shopClock.ts`: `SHOP_CLOCK_POLICY` is a `Record<Action['type'], 'open' | 'locked'>`, so a new
  action that is not classified is a type error. `blockedByShopClock(state, action)` is checked once at the top of
  `reduceCore`, before the clone. Locked: buy, buyHenchman, play, sell, roll, upgrade, heroPower, activateEquipment.
  Open: End Turn, Freeze (owner 2026-07-21), arrangement, selectEquipment, modal answers (the clock is paused while a
  modal is open), automatic transitions, previews, dev tools.
- **UI**: StatusBar reads `shopLocked(run)` into `canHero`, `ready2`, `equipReady` and the Henchman chip: disabled, no
  `.ready` glow, no press. Recruit drops an armed power / Equipment when time runs out.

## Not affected

- **Untimed runs** (tutorial, God sandbox, Practice unlimited): their clock is 99999 s, so the expiry never dispatches.
- **End of Turn triggers / passives**: they are not player actions; `faceOmen` is open and resolves them identically
  (test compares End Turn from a locked and an unlocked Shop).
- **Replays**: replay v2 plays recorded frames (no reduce). Action-stream re-reduction (replay harness, board
  reconstruction) stays deterministic because the expiry is itself a recorded action: a new stream replays the lock
  where it was lived, and an old stream has no expiry, so nothing locks and it reduces exactly as before.

Tests: `packages/sim/src/shopClock.test.ts` (reducer), `packages/ui/src/shopClockLock.test.tsx` (buttons).
