import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';

/** Map an attack's swing damage → the impact's `power` scale (1 = baseline). Ramps gently: a 1-3 dmg chip
 *  stays at the familiar burst, ~8 dmg reads clearly heavier, and it caps at 2× so a 40-damage finisher
 *  doesn't whiteout the board. */
export const hitPower = (swing: number): number => Math.max(0.9, Math.min(2, 0.8 + swing / 10));

/**
 * Impact channel (choreographer phase 3b) — the melee "smack": the hit sound, the WebGL flash + spark spray +
 * dust billow + energy pulse fired along the blow direction, and the defender's knockback-and-recover tween
 * (with `spinDeg` of counter-rotation folded in). The FX originate at `contact` — the strike-impact point the
 * engine blends between the defender's centre and the attacker's leading corner (`strikePoint`) — falling back
 * to the defender's centre otherwise. Fired from the lunge's `contact` GSAP position (see `engine.ts`).
 * `dx`/`dy` is the attacker→defender vector; `power` scales the FX + knockback with the swing's damage (see
 * `hitPower`); `spinDeg` is the defender's counter-spin (already scaled to strikePoint by the engine). `crit`
 * (Critical Strike this swing) swaps the smack for the dedicated crit sound AND the normal burst for the
 * amplified crimson-gold crit flourish (`pixiFx.critImpact` — bold ring, "CRIT!" pop, red card flash), plus a
 * heftier knockback. No-op FX/recoil when there's no defender (still fires the hit/crit sound).
 */
export function playContactImpact(defender: Element | null, dx: number, dy: number, power: number, speed: number, contact?: { x: number; y: number }, spinDeg = 0, crit = false): void {
  if (crit) sfx.critHit(); else sfx.hit();
  if (!defender) return;
  const r = defender.getBoundingClientRect();
  const fx = contact ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  if (crit) {
    // The crit REPLACES the normal impact burst with its own amplified flourish; the dust billow still reads.
    pixiFx.critImpact(fx.x, fx.y, dx, dy, { x: r.left, y: r.top, w: r.width, h: r.height });
    pixiFx.impactDust(fx.x, fx.y, power);
  } else {
    pixiFx.impact(fx.x, fx.y, dx, dy, power);
    pixiFx.impactDust(fx.x, fx.y, power); // card-drop-style tan billow from the strike point
    pixiFx.impactPulse(fx.x, fx.y, power); // expanding energy ring(s) from the strike point
  }
  gsap.killTweensOf(defender);
  const kb = 0.14 * (0.75 + 0.25 * power) * (crit ? 1.4 : 1); // a crit knocks the defender harder
  gsap.fromTo(defender, { x: 0, y: 0, rotation: 0 }, {
    x: dx * kb, y: dy * kb, rotation: spinDeg, duration: 0.1 / speed, yoyo: true, repeat: 1, ease: 'power2.out',
    onComplete: () => gsap.set(defender, { clearProps: 'transform' }),
  });
}
