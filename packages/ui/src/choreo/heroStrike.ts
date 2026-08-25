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
  const geo = contactGeometry(dx, dy, { width: atk.width, height: atk.height }, { width: def.width, height: def.height }, cfg);
  const power = hitPower(damage);
  const impactAt = { x: def.left + def.width / 2, y: def.top + def.height / 2 };
  const spinDeg = -Math.sign(geo.leadTilt || 1) * cfg.defenderSpin;

  return playLunge({
    attacker,
    dx, dy,
    strike: geo.strike,
    strikeDur: geo.strikeDur,
    travel: geo.travel,
    leadTilt: geo.leadTilt,
    attackerRebound: cfg.attackerRebound,
    speed: combatSpeed,
    // The beat clock is not running here (the replay is over), so contact only has to fire the consequence.
    onContact: onImpact,
    onImpact: () => playContactImpact(defender, dx, dy, power, combatSpeed, impactAt, spinDeg),
  });
}
