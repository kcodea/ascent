# 2026-09-12 — Thymepiece: "all cards cost −1 Gold for the next 8 seconds" (the first clock-window effect)

The owner reworked Thymes / Thymepiece (set-3 Dwarves): the "+30 seconds on next turn's clock" bank is gone;
using the Thymepiece now makes **every card in the Shop cost 1 less Gold (gilded 2) for the next 8 seconds**,
and while it runs every price shows the green discounted coin. Rulings: the 8 seconds run on the **turn
clock** (paused with it, replayable), **cards only** (minion offers, the spell slot, spell offers in the row;
Shop upgrade and refresh untouched), prices floor at 0, cost 3 and no target unchanged.

## The mechanism — the engine never reads a clock

The reducer is deterministic and untimed, so "8 seconds" had to become two recorded actions:

1. **The activation carries the clock.** `activateEquipment` gained an optional `clockSeconds`. The store's
   `dispatch` stamps it from `turnClock.get()` (raw seconds-left; Practice's multiplier and the sandbox's
   frozen clock only change how long a clock-second lasts, the window is 8 clock-seconds in every mode). It is
   stamped *before* the action is recorded, so a recording carries it. The reducer threads it through
   `fireEquipmentTriggers` → the factory payload.
2. **`equipmentCardDiscountWindow`** (params `{ amount, seconds }`) writes
   `RunState.cardDiscountWindow = { amount, untilClock: clockSeconds − seconds }`. The clock counts down, so the
   window is live while `turnClock > untilClock`. No reading (a headless test, a legacy recording) →
   `untilClock: null` = live until the turn ends. A re-use while a window is open keeps the later close and the
   larger amount — the design is a rate, not a bank, so an extra trigger never stacks it to −2.
3. **Expiry is the `discountWindowExpired` action**, dispatched by the Recruit tick loop on the same tick that
   moves the clock past `untilClock` — so everything that pauses the clock (Discover, Choose One, aim, hero
   select, frozen modals) pauses the window, replay pacing divides both, and a recording replays the expiry
   where the player lived it. The window is read through a ref inside the tick, *not* an effect dep: adding it
   to the deps would restart the self-scheduling loop on every activation and hand the player a free partial
   second. A stray expiry with no window is a pre-clone no-op.
4. **Price fold.** `offerBuyPrice` subtracts `windowOff` for every non-held minion offer (after the free
   first buy, alongside Cadence / Trade-In / Treasurer / the Gift, floored at 0; the Starform's early return
   keeps it at 0). `spellCostReduction` adds the amount — that one helper prices both the spell slot and a
   spell offer in the row (Spell Cart), so both buy paths follow. `derivations.test.ts`'s coin ↔ charge fuzz
   now rolls the window into its inputs.
5. **Lifecycle.** Cleared in `faceOmen` (the clock stops in combat), inside the `PER-TURN-RESET` block (with a
   `CARRY_OVER_EXCUSED` entry for Doc Bot's carry-over scan), and by `deserialize(json, { turnRemaining })` —
   `loadSave` now hands it the saved clock, so a Continue at clock 30 with `untilClock 32` resumes cleared and
   one at 34 resumes with 2 seconds left.
6. **Retired:** `equipmentBonusTurnTime`, `bonusTurnSeconds`, `bonusTurnSecondsNextTurn`, the reducer's turn-flip
   hand-off and Recruit's clock addition. Nothing else used them; `deserialize` drops them off old saves.

## UI

- The minion coin already greens through `costChanged` when the charged price is below base; the spell
  slot's coin flags `cost < base` from `spellCostReduction`, so it greens the same way. Both shop-view memos
  take `run.cardDiscountWindow` as a dep — the price changes on expiry with no shop rebuild (the Treasurer
  lesson).
- `DiscountWindowReadout` under the Equipment slot prints "−1 Gold · 6s" while a window is open. It is its own
  leaf because it subscribes to `useTurnSeconds()` — the per-second tick must never reach the StatusBar or the
  recruit tree — and the seconds left are derived from the clock, never a second timer.
- The Equipment rule text stays static ("…for the next **8 seconds**"): the amount never varies at runtime and
  the readout carries the countdown, so no `{{5s left}}` fold was added.

## Tests

`packages/sim/src/thymepiece.test.ts` (18): the window at clock 40 → `untilClock 32`; minion coin + charge −1
while open and base after expiry; the spell slot and a row spell through the real buy; gilded −2; floors at 0
(a 1-Gold spell → 0, the Starform stays 0); free first buy overrides; upgrade + refresh unchanged; cleared at
combat entry / turn flip; the Continue cases; legacy fields dropped. The Dwarves describe was rewritten to the
new contract. Doc Bot lanes green; `docbot:sync` produced no registry diff.
