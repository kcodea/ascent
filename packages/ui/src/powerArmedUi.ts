/**
 * THE ARMED CALL ON A COUNTING HERO POWER (owner 2026-11-10: Magician's hat first, then "perfect, add it to those too":
 * Re-Pete, Gorr, Juggler, Pete, Ayse, Drakko; then "add it to quillen when his is at 2/3 too").
 *
 * It means exactly: "your next action, or the end of this turn, fires this power." The rule itself is the sim's
 * `heroPowerArmed` (one predicate, per held power, per slot). This adds what only the screen knows:
 *
 *  - `passivePowerReady`: a PASSIVE power wears the existing READY call (the classes, as authored) while it is armed,
 *    in the Shop only. No card is bought, no refresh pressed and no turn ended in combat, so a glow there would be stale.
 *  - `activePowerPayout`: a PRESSABLE power (Quillen) already wears that same call whenever it can be pressed, at any
 *    count. So its armed state is carried by the counter instead: the pill reads gold (`.hpb-pill.payout`, colour
 *    only) while the power is armed AND pressable right now. Not pressable (used this turn, locked) = no call and a
 *    plain pill, the existing rule for any active power.
 *
 * Pure and cheap (a few field reads on the run the status bar already renders from), so every screen that draws the
 * power agrees: my Shop, my teammate's view of my board, a spectator's, and a restored run.
 */
import { activePowers, heroPowerArmed, type RunState } from '@game/sim';

export function passivePowerReady(run: RunState, slot: 0 | 1 = 0): boolean {
  return run.phase === 'recruit' && !!activePowers(run)[slot]?.passive && heroPowerArmed(run, slot);
}

/** `pressable`: the button's own ready state for that slot (`canHero` / `ready2`). */
export function activePowerPayout(run: RunState, slot: 0 | 1, pressable: boolean): boolean {
  return pressable && run.phase === 'recruit' && !activePowers(run)[slot]?.passive && heroPowerArmed(run, slot);
}
