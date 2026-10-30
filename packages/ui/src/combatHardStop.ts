/**
 * THE COMBAT HARD STOP (R-COMBAT-HARDSTOP-01, owner 2026-10-30: "how can we ensure that absolutely everything stops
 * the moment that gem is clicked?").
 *
 * Pressing End Combat / Return to Shop calls `hardStopCombat()` ONCE, before the return wipe starts. It is central on
 * purpose, so a combat cue added later is covered without its call site doing anything:
 * - SOUND: every voice already playing or scheduled is cut (the epoch fade in `sfx.ts`), the announcer's queue and
 *   line are cancelled (its `onStopAllAudio` hook), and a Skip's whir stops;
 * - FX: every one-shot Pixi play is retired (`retireTransientPlays`) and the transient particles cleared;
 * - THE HOLD (combatHold.ts): until `releaseCombatHold()`, new non-`ui` sounds and every `playDef` are dropped, so a
 *   late combat timer (a delayed beat, a GSAP callback) finds nothing to play;
 * - HOOKS: whatever owns a running combat sequence (the hero strike, the replay clock) registers with
 *   `onCombatHardStop` and is stopped here.
 * The `ui` bus stays open for the gem's own pulse, the wipe, the end gate and the placement tone, and the hold is
 * released just before the shop (or the end screen) is put on screen.
 */
import { setCombatHeld, combatHeld } from './combatHold';
import { hardStopSfx } from './sfx';
import { retireTransientPlays } from './fx/fxBudget';
import { pixiFx } from './pixiFx';

const hooks = new Set<() => void>();

/** Run `cb` at every hard stop (the strike's cancel, the replay's clock). Returns the unsubscribe. */
export function onCombatHardStop(cb: () => void): () => void {
  hooks.add(cb);
  return () => { hooks.delete(cb); };
}

/** Injectable for tests: the engine pieces the stop drives. */
export interface HardStopDeps {
  sfx: () => void;
  retireFx: () => number;
  clearParticles: () => void;
}
const liveDeps: HardStopDeps = {
  sfx: hardStopSfx,
  retireFx: retireTransientPlays,
  clearParticles: () => pixiFx.clearParticles(),
};

/** Stop EVERYTHING from the fight now, and hold new combat sounds / FX until `releaseCombatHold()`. Idempotent. */
export function hardStopCombat(deps: HardStopDeps = liveDeps): void {
  setCombatHeld(true);
  // Owners first, so a sequence that tears itself down (its voices, its DOM) does it before the blanket cut.
  for (const cb of [...hooks]) { try { cb(); } catch (e) { console.error('[combat] a hard-stop hook threw:', e); } }
  try { deps.sfx(); } catch (e) { console.error('[combat] hard-stop sound cut threw:', e); }
  try { deps.retireFx(); } catch (e) { console.error('[combat] hard-stop FX retire threw:', e); }
  try { deps.clearParticles(); } catch { /* no FX layer here */ }
}

/** Lift the hold: the shop (or the end screen) is about to be shown. A no-op when nothing holds. */
export function releaseCombatHold(): void {
  if (combatHeld()) setCombatHeld(false);
}
