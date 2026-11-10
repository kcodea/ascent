# 2026-11-10: the armed call on counting hero powers

Owner, after seeing Magician's hat glow while active: "perfect, add it to those too" (Re-Pete, Gorr, Juggler, Pete, Ayse,
Drakko). Then: "add it to quillen when his is at 2/3 too".

## The rule

The glow means exactly: **your next action, or the end of this turn, fires this power.** Never "something happens next
turn".

One predicate carries it: `heroPowerArmed(run, slot)` in `packages/sim/src/powerArmed.ts`. It is a read. Each arm
restates the gate its own fire site checks, from the same run fields:

| Power (kind) | Armed when | Fire site |
|---|---|---|
| Magician `magicHat` | `magicHatView(run).active` | `magicHatBuy` |
| Re-Pete `secondHand` | `wave % ancientSecondHandEvery === 0` and `ancientSecondHandSources` is not empty | `endRecruitTurn` |
| Gorr `fourPeat` | `gorrBuys.length === 2` | `gorrQuestBuy` |
| Juggler `baldgecoin` | `jugglerBuys === 2` | `jugglerBuy` |
| Pete `contraband` | `refreshCount % 3 === 2` | the `roll` case |
| Ayse `luckySeat` | `ciaEnchantedBought === 2` | `ciaBuyEnchanted` |
| Drakko `quest` | `drakkoBuys === ancientDrumlineNeed - 1` and the holding slot's latch is not spent | `drakkoQuestBuy` |
| Quillen `archive` (active) | banked types + one press's worth `>= ancientArchiveNeed`, and Archive is not passive | the `heroPower` case |

Where the code is wider than the owner's table, the predicate follows the code:

- **Re-Pete** is armed only while Second Hand has something to copy (a card in hand; with the Ancient of Bonds, a minion
  on the board). With nothing to copy the end of the turn fires nothing, so a glow would promise a copy that does not
  come. The cadence reads `ancientSecondHandEvery`, so the Ancient of Time's every 2nd turn is right too. (The existing
  counter above the power still reads a fixed 3-turn cadence. That is older than this PR and was left alone.)
- **Gorr** fires on exactly the 3rd minion buy of a turn and never again that turn, so 3 or more is not armed.
- **Drakko** with the Ancient of Genesis needs 5, then 4, then 3, so "one short" follows `ancientDrumlineNeed`.
- **Quillen**: one press banks more than one type with Rune of Empowerment or Wishbone (the reducer's `reps`), so 1 of 3
  can already be one press from full. `archiveReps` restates that one expression, with a test that the press then fires.

It follows the HELD power per slot (`activePowers`): Mimic's disguise, a Power Shifter swap, either of Void's two. A kind
held in both slots fires once, so only the first slot that holds it shows armed.

## The screen (`packages/ui/src/powerArmedUi.ts`, `StatusBar.tsx`)

- `passivePowerReady(run, slot)`: a passive power is armed and the run is in the Shop. `StatusBar` adds the existing
  `ready` class to the panel and the button on top of `passive`, which is exactly what Magician's branch did with
  `hatReady`. That one flag replaced it, so Magician now runs through the shared path. The READY CALL CSS, the one-shot
  bloom on the rising edge and the counter pill's ready colours are all the authored ones, untouched.
- No glow in combat (Shop only) and none while the End of Turn sequence plays.
- A passive second power (Void) gets the same classes from slot 1.
- **Quillen is pressable**, and a pressable power already wears the full ready call at every count (owner 2026-10-23), so
  the glow cannot carry "about to pay out". The counter does: the pill takes `.payout` (the same pill, filled with the
  ready call's gold; static paint, one CSS rule, nothing loops) while the power is armed AND pressable. At 2 of 3 but
  already used this turn it shows no call and a plain pill, the existing rule for any active power that cannot be
  pressed. This one rule is the only new styling in the PR. It was a judgement call: nothing that already existed
  distinguished 2 of 3 from 1 of 3 on a pressable power.

All seven heroes already had a counter above the power. None was added.

## Performance

The flag is a few field reads on the run `StatusBar` already renders from. It adds no subscription, no state and no
effect, so it cannot add a render: the class string changes only on the action that changes the count. The loop that
plays while armed is the authored ready call (opacity and transform only).

## Tests

- `packages/sim/src/powerArmed.test.ts`: every hero through the real reducer. Armed at the right count, not before,
  cleared by the fire, reset across turns where the power resets, a finished Drakko never armed, Quillen's next cycle,
  Mimic and Void.
- `packages/ui/src/powerArmedGlow.test.tsx`: the mounted status bar. The ready classes exactly while armed, the counter
  kept, nothing in combat, a save and restore, and Quillen's gold pill.
- With the six arms switched off, 34 of these tests fail and Magician's own tests still pass.
