/**
 * THE COMBAT HOLD (R-COMBAT-HARDSTOP-01, owner 2026-10-30): the one flag that says "the player pressed End Combat /
 * Return to Shop, nothing from the fight may sound or draw any more". Dependency-free so the sound engine
 * (`sfx.ts`) and the FX chokepoint (`fx/playDef.ts`) can both read it without an import cycle.
 *
 * It is SET by `hardStopCombat()` (combatHardStop.ts) at the gem press and RELEASED just before the shop (or the
 * end screen) is put on screen, so the shop's own sounds and FX are never caught by it. While it holds:
 * - every new sound on a non-`ui` bus (combat, voice, hero, equipment) is dropped (`sfx.ts` `heldBack`);
 *   the `ui` bus stays open for the gem's own pulse, the return wipe, the end gate and the placement tone;
 * - every new authored FX play (`playDef`) is declined.
 * So a late timer from the fight (a delayed beat, a hero-attack cue, a GSAP callback) finds nothing to play, and new
 * combat cues are covered by default without touching their call sites.
 */
let held = false;

export function combatHeld(): boolean {
  return held;
}

/** Internal: set by `hardStopCombat`, cleared by `releaseCombatHold` (both in combatHardStop.ts). */
export function setCombatHeld(v: boolean): void {
  held = v;
}
