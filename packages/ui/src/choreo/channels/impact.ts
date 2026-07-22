import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';
import { setTransition } from './lunge';

/** Map an attack's swing damage → the impact's `power` scale (1 = baseline). Ramps gently: a 1-3 dmg chip
 *  stays at the familiar burst, ~8 dmg reads clearly heavier, and it caps at 2× so a 40-damage finisher
 *  doesn't whiteout the board. */
export const hitPower = (swing: number): number => Math.max(0.9, Math.min(2, 0.8 + swing / 10));

/**
 * Impact channel (choreographer phase 3b) — the melee "smack": the hit sound, the WebGL flash + spark spray +
 * dust billow + energy pulse fired along the blow direction, and the defender's knockback-and-recover tween
 * (with `spinDeg` of counter-rotation folded in). The FX originate at `contact` — the DEFENDER'S CENTRE,
 * where the attacker's leading corner always lands (owner spec 2026-07-21; see `contactGeometry.ts`) —
 * falling back to the defender's live rect centre otherwise. Fired from the lunge's `contact` GSAP position
 * (see `engine.ts`). `dx`/`dy` is the attacker→defender vector; `power` scales the FX + knockback with the
 * swing's damage (see `hitPower`); `spinDeg` is the defender's counter-spin. `crit`
 * (Critical Strike this swing) swaps the smack for the dedicated crit sound AND the normal burst for the
 * amplified crimson-gold crit flourish (`pixiFx.critImpact` — bold ring, "CRIT!" pop, red card flash), plus a
 * heftier knockback. No-op FX/recoil when there's no defender (still fires the hit/crit sound).
 */
export function playContactImpact(defender: Element | null, dx: number, dy: number, power: number, speed: number, contact?: { x: number; y: number }, spinDeg = 0, crit = false, flurryHit = false, flurrySlash = false, executeSlash = false, cleave = false): void {
  if (crit) sfx.critHit(); else sfx.hit();
  if (flurryHit) sfx.flurryHit(); // the Flurry hit layers OVER the smack on EVERY swing (owner note 2026-07-17)
  if (!defender) return;
  const r = defender.getBoundingClientRect();
  const fx = contact ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // PRECEDENCE for "which effect replaces the standard strike burst" — first match wins:
  //   Execute > Cleave > Flurry > crit.
  // Execute is a KILL, the biggest beat available, so it outranks everything (a Flurry/crit/Cleave execute
  // should still read as the execution). Cleave comes next: it is the keyword's whole read, and a Cleave crit
  // showing the rake is the intended behaviour. In every case the smack/crit SOUND and the crit board-shake
  // still fire, so a crit is always audibly a crit.
  if (executeSlash) {
    // EXECUTE REPLACES the standard strike VFX with the execution crescent (owner 2026-07-22: the standard
    // burst was playing INSTEAD of it).
    pixiFx.executeStrike(fx.x, fx.y, dx, dy);
  } else if (cleave) {
    // CLEAVE replaces it with the claw rake, and `sfx.cleave` layers over the smack.
    //
    // The rake is a FIXED length (`spanPx`) centred on the defender — not derived from the struck group, nor
    // from the card's width. Both of those made the same dial mean different things in different situations
    // (a three-target cleave drew a far wider cut than a one-target one; and the tuner's Test, which fires
    // over a fixed box, drew a far wider cut than any real hit). Now every cleave draws the same cut.
    sfx.cleave();
    // The defender's CARD CENTRE, not the contact point: the cut must sit on the middle of what it hit, and
    // this is the same anchoring the tuner's Test uses (screen centre), so the two draw identically. The rake
    // takes no direction — it plays the same left→right animation whichever way the attacker swung, because
    // mirroring it would flip the claws' hook (see cleaveSlash).
    pixiFx.cleaveSlash(r.left + r.width / 2, r.top + r.height / 2);
    pixiFx.impactDust(fx.x, fx.y, power);
  } else if (flurrySlash) {
    // Flurry REPLACES the standard strike VFX with the wind-slash gust so a Flurry attacker's hits read as
    // wind — and it WINS even on a CRIT (a Flurry crit shows the wind-slash, not the crimson flourish; owner
    // note 2026-07-17). Non-Flurry crits fall through to the standard crit effect below. The smack/crit SOUND
    // and the crit board-shake still fire (a Flurry crit is still a crit) — see the engine's onCritImpact.
    pixiFx.windSlash(fx.x, fx.y, dx, dy);
  } else if (crit) {
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
  // Suspend the `.unit` CSS transform-transition for the knockback (same probe finding as the lunge — see
  // lunge.ts): it re-interpolates every GSAP write over 160ms, which smeared this 100ms-per-leg snap into a
  // soft drift. Restored on completion so reposition slides keep their transition.
  setTransition(defender, 'none');
  gsap.fromTo(defender, { x: 0, y: 0, rotation: 0 }, {
    x: dx * kb, y: dy * kb, rotation: spinDeg, duration: 0.1 / speed, yoyo: true, repeat: 1, ease: 'power2.out',
    onComplete: () => {
      setTransition(defender, '');
      gsap.set(defender, { clearProps: 'transform' });
    },
  });
}
