import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';

/** Map an attack's swing damage → the impact's `power` scale (1 = baseline). Ramps gently: a 1-3 dmg chip
 *  stays at the familiar burst, ~8 dmg reads clearly heavier, and it caps at 2× so a 40-damage finisher
 *  doesn't whiteout the board. */
export const hitPower = (swing: number): number => Math.max(0.9, Math.min(2, 0.8 + swing / 10));

/**
 * Impact channel (choreographer phase 3b) — the melee "smack": the hit sound, a WebGL flash + spark spray
 * at the defender fired along the blow direction, and the defender's knockback-and-recover tween. Fired
 * from the lunge's `contact` GSAP position (see `engine.ts`) — a verbatim extraction of the former inline
 * callback inside `playAttackLunge`. `dx`/`dy` is the attacker→defender vector; `power` scales the FX +
 * knockback with the swing's damage (see `hitPower`). No-op FX/recoil when there's no defender (still
 * fires the hit sound).
 */
export function playContactImpact(defender: Element | null, dx: number, dy: number, power: number, speed: number): void {
  sfx.hit();
  if (!defender) return;
  const r = defender.getBoundingClientRect();
  pixiFx.impact(r.left + r.width / 2, r.top + r.height / 2, dx, dy, power);
  gsap.killTweensOf(defender);
  const kb = 0.14 * (0.75 + 0.25 * power);
  gsap.fromTo(defender, { x: 0, y: 0 }, {
    x: dx * kb, y: dy * kb, duration: 0.1 / speed, yoyo: true, repeat: 1, ease: 'power2.out',
    onComplete: () => gsap.set(defender, { clearProps: 'transform' }),
  });
}
