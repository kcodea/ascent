import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';
import { playDef } from '../../fx/playDef';
import { setTransition } from './lunge';

/** Map an attack's swing damage → the impact's `power` scale (1 = baseline). Ramps gently: a 1-3 dmg chip
 *  stays at the familiar burst, ~8 dmg reads clearly heavier, and it caps at 2× so a 40-damage finisher
 *  doesn't whiteout the board. */
export const hitPower = (swing: number): number => Math.max(0.9, Math.min(2, 0.8 + swing / 10));

/**
 * How a swing's `power` reaches the `impact-dust` def: as `playDef`'s per-call **`intensity`**, i.e. the
 * particle COUNT. Exactly what the hand-written `pixiFx.impactDust` did with it — `impDustCount * (0.8 +
 * 0.2 * power)` — with the base count now authored in the def (22, the old `impDustCount` default), so this
 * is only the multiplier. A baseline hit is 1.0 and the 2× damage cap lands at 1.2.
 */
export const dustIntensity = (power: number): number => 0.8 + 0.2 * power;

/**
 * How a swing's `power` reaches the `strike-impact` def's COUNTS: `playDef`'s per-call `intensity`. The
 * hand-written `pixiFx.impact` scaled its two counts by two slightly different ramps — sparks by
 * `0.7 + 0.3 * power`, smoke puffs by `0.75 + 0.25 * power`. `intensity` is one dial for the whole def, so
 * the spark ramp wins (it is 40 particles against 3, i.e. what the eye actually reads as "a heavier hit
 * threw more"); the smoke rides it and ends up a hair thicker at the 2× damage cap than it used to be.
 *
 * The GEOMETRY half of `power` goes on `scale` — see `strikeScale`.
 */
export const strikeIntensity = (power: number): number => 0.7 + 0.3 * power;

/**
 * How a swing's `power` reaches the `strike-impact` def's SIZES: `playDef`'s per-call `scale`.
 *
 * Straight through, because that is what the hand-written method did with its dominant read — flash and
 * shockwave `toScale` were literally `cfg × power`, so a 2× hit's flash was twice the size. `scale` also
 * reaches the def's `speed` params, which the old code ramped more gently (sparks at `0.85 + 0.15 * power`).
 * That mostly cancels: the sparks layer is authored at `burst`'s `speed` ceiling of 800, and `transformParams`
 * clamps to the slider range, so at any `power ≥ 1` the sparks fly at exactly 800 either way.
 */
export const strikeScale = (power: number): number => power;

/** The tan billow at a strike point — the authored `impact-dust` def, migrated out of `pixiFx.impactDust`.
 *  Three of the four branches below fire it, so it is one call rather than three. */
function strikeDust(x: number, y: number, power: number): void {
  playDef('impact-dust', { source: { x, y }, target: { x, y } }, { intensity: dustIntensity(power) });
}

/**
 * The melee strike burst — the authored `strike-impact` def, migrated out of `pixiFx.impact`.
 *
 * DIRECTION is the reason this needed `burst`'s `sourceToTarget` aim: the sparks fan along the blow, and the
 * blow is `dx/dy`, which only exists at fire time. `playDef` has no per-call angle and must not grow one (a
 * def that four callers each bend differently stops being a committed composition), so the direction is
 * expressed as GEOMETRY instead — the two anchors this fire stages. `target` is the contact point, where every
 * layer sits; `source` is that point walked BACK along the blow, i.e. where the attacker swung from. The
 * def's sparks layer reads exactly that vector.
 *
 * `dx/dy` may be any magnitude (the caller passes a raw attacker→defender delta), and it does not matter: the
 * primitive normalises to an angle. A zero vector — attacker and defender coincident — leaves the two anchors
 * on the same spot, which `setAim` rejects as degenerate, and the cone falls back to `travel` (a static-point
 * burst's 0 rad, i.e. fanning right). The hand-written method's own fallback there was "up"; the difference is
 * unobservable, because two units on the same pixel never happens on a real board.
 */
function strikeBurst(x: number, y: number, dx: number, dy: number, power: number): void {
  playDef(
    'strike-impact',
    { source: { x: x - dx, y: y - dy }, target: { x, y } },
    { scale: strikeScale(power), intensity: strikeIntensity(power) },
  );
}

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
    strikeDust(fx.x, fx.y, power);
  } else if (flurrySlash) {
    // Flurry REPLACES the standard strike VFX with the wind-slash gust so a Flurry attacker's hits read as
    // wind — and it WINS even on a CRIT (a Flurry crit shows the wind-slash, not the crimson flourish; owner
    // note 2026-07-17). Non-Flurry crits fall through to the standard crit effect below. The smack/crit SOUND
    // and the crit board-shake still fire (a Flurry crit is still a crit) — see the engine's onCritImpact.
    pixiFx.windSlash(fx.x, fx.y, dx, dy);
  } else if (crit) {
    // The crit REPLACES the normal impact burst with its own amplified flourish; the dust billow still reads.
    pixiFx.critImpact(fx.x, fx.y, dx, dy, { x: r.left, y: r.top, w: r.width, h: r.height });
    strikeDust(fx.x, fx.y, power);
  } else {
    strikeBurst(fx.x, fx.y, dx, dy, power);
    strikeDust(fx.x, fx.y, power); // card-drop-style tan billow from the strike point
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
