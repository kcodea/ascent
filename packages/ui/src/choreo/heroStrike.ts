import { gsap } from 'gsap';
import { contactGeometry } from './contactGeometry';
import { getLungeConfig } from '../lungeConfig';
import { playLunge } from './channels/lunge';
import { playContactImpact, hitPower } from './channels/impact';

/**
 * THE HERO STRIKE — the winning hero lunges at the loser and hits them for the round's damage (owner ask
 * 2026-08-25), using the SAME wind-up, lunge, impact FX and sounds a minion attack uses.
 *
 * Deliberately built on the low-level channels (`playLunge` + `playContactImpact`) rather than on
 * `runAttackExchangeCues`: that entry point needs a combat `Moment`, and this swing happens AFTER the replay
 * has finished, so there is no moment to hang it on. Everything below the moment — the geometry, the wind-up,
 * the contact pose, the impact — is shared, so the hero blow reads as the same verb as a minion's.
 *
 * Simpler than the engine's minion path in one way, and it is safe to be: the two hero portraits are STATIC
 * when this runs (the board has stopped, nothing is dying or recovering), so there is no in-flight GSAP offset
 * to compensate for and no late re-solve — the rects measured here are the rects the blow lands on.
 */
export function playHeroStrike(opts: {
  attacker: Element;
  defender: Element;
  /** Damage this blow lands — scales the impact's weight, exactly like a minion's swing does. */
  damage: number;
  combatSpeed: number;
  /** Fired at contact: this is where the health drops and the defender recoils. */
  onImpact: () => void;
}): ReturnType<typeof gsap.timeline> | null {
  const { attacker, defender, damage, combatSpeed, onImpact } = opts;
  const atk = attacker.getBoundingClientRect();
  const def = defender.getBoundingClientRect();
  if (atk.width === 0 || def.width === 0) return null;

  const dx = (def.left + def.width / 2) - (atk.left + atk.width / 2);
  const dy = (def.top + def.height / 2) - (atk.top + atk.height / 2);
  const cfg = getLungeConfig();

  // SOLVE IN THE ATTACKER'S LOCAL SPACE. The foe's portrait sits inside a CSS-`scale()`d wrapper (the ⚔️ tuner's
  // size knob), so its rects come back in SCALED screen pixels — while the `x`/`y` GSAP writes are in the
  // element's own unscaled units and are magnified by that same scale when drawn. Feeding screen-space numbers
  // straight to the lunge therefore made the blow overshoot as the portrait grew and fall short as it shrank:
  // the hit destination moved with the size (owner report 2026-08-25). Dividing the vector and BOTH sizes by
  // the attacker's own scale puts everything in the frame GSAP actually animates in, so the destination is
  // size-independent. `offsetWidth` is the unscaled layout width, which is what makes the factor measurable.
  const atkW = (attacker as HTMLElement).offsetWidth || atk.width;
  const scale = atkW > 0 ? atk.width / atkW : 1;
  const inv = scale > 0 ? 1 / scale : 1;
  const geo = contactGeometry(
    dx * inv, dy * inv,
    { width: atk.width * inv, height: atk.height * inv },
    { width: def.width * inv, height: def.height * inv },
    cfg,
  );
  const power = hitPower(damage);
  // The impact FX stay in SCREEN space — Pixi positions them against the viewport, not the attacker's frame.
  const impactAt = { x: def.left + def.width / 2, y: def.top + def.height / 2 };
  const spinDeg = -Math.sign(geo.leadTilt || 1) * cfg.defenderSpin;

  return playLunge({
    attacker,
    // Local-frame vector, to match the local-frame strike offset solved above.
    dx: dx * inv, dy: dy * inv,
    strike: geo.strike,
    strikeDur: geo.strikeDur,
    travel: geo.travel,
    leadTilt: geo.leadTilt,
    attackerRebound: cfg.attackerRebound,
    speed: combatSpeed,
    // The beat clock is not running here (the replay is over), so contact only has to fire the consequence.
    onContact: onImpact,
    // `null` defender ON PURPOSE: that argument is what drives the defender's knockback/recoil tween, and the
    // hero portraits must not react (owner ruling 2026-08-25) — the FX still fire at `impactAt`, in screen space.
    onImpact: () => playContactImpact(null, dx, dy, power, combatSpeed, impactAt, spinDeg),
  });
}
