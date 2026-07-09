import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';
import { getLungeConfig } from '../../lungeConfig';

/** Map an attack's swing damage → the impact's `power` scale (1 = baseline). Ramps gently: a 1-3 dmg chip
 *  stays at the familiar burst, ~8 dmg reads clearly heavier, and it caps at 2× so a 40-damage finisher
 *  doesn't whiteout the board. */
export const hitPower = (swing: number): number => Math.max(0.9, Math.min(2, 0.8 + swing / 10));

/**
 * Impact channel (choreographer phase 3b) — the melee "smack": the hit sound, a WebGL flash + spark spray
 * fired along the blow direction, and the defender's knockback-and-recover tween — now with a counter-rotation
 * away from the contact corner (opposite the attacker's lead-tilt) folded into that recoil. The spark
 * originates at `contact` (the attacker's leading-corner clack point, computed in `engine.ts`) when provided,
 * falling back to the defender's center otherwise. Fired from the lunge's `contact` GSAP position (see
 * `engine.ts`). `dx`/`dy` is the attacker→defender vector; `power` scales the FX + knockback with the swing's
 * damage (see `hitPower`). No-op FX/recoil when there's no defender (still fires the hit sound).
 */
export function playContactImpact(defender: Element | null, dx: number, dy: number, power: number, speed: number, leadTilt = 0, contact?: { x: number; y: number }): void {
  sfx.hit();
  if (!defender) return;
  const r = defender.getBoundingClientRect();
  const fx = contact ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  pixiFx.impact(fx.x, fx.y, dx, dy, power);
  gsap.killTweensOf(defender);
  const kb = 0.14 * (0.75 + 0.25 * power);
  // Counter-rotate away from the lead corner. Keep the `|| 1` fallback here (unlike the lunge rebound's plain
  // Math.sign) so a leadTilt-0 strike still gives the defender some reaction — this dial governs the ATTACKER's
  // lead, not the defender's jolt, so don't "harmonize" the two sites or the defender stops reacting at tilt 0.
  const spin = -Math.sign(leadTilt || 1) * getLungeConfig().defenderSpin;
  gsap.fromTo(defender, { x: 0, y: 0, rotation: 0 }, {
    x: dx * kb, y: dy * kb, rotation: spin, duration: 0.1 / speed, yoyo: true, repeat: 1, ease: 'power2.out',
    onComplete: () => gsap.set(defender, { clearProps: 'transform' }),
  });
}
