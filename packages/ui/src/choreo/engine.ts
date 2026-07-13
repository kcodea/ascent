import gsap from 'gsap';
import type { Moment } from './compile';
import { getScore } from './score';
import { playLunge } from './channels/lunge';
import { hitPower, playContactImpact } from './channels/impact';
import { getLungeConfig } from '../lungeConfig';
import { getStrikeFxConfig } from '../strikeFxConfig';
import { contactGeometry } from './contactGeometry';

export interface AttackCueCtx {
  combatSpeed: number;
  /** Advance the beat clock to the next moment — called from the SAME GSAP position as the impact channel
   *  (the `contact` anchor), retiring the former `clock.ts` smack-lead weld (two independently-computed
   *  formulas that merely agreed in value; now there is exactly one timeline event both key off). */
  advance: () => void;
  /** Set when a RALLY fires as this unit attacks → the lunge holds a beat at the top of the wind-up and calls
   *  this (flash the attacker's yellow Rally trigger pulse) before the strike. Absent = a normal swing. */
  onRallyPulse?: () => void;
  /** Set when this attack's moment absorbed buff-other casts (on-attack / Rally buffers) → the lunge holds at the
   *  top of the wind-up and calls this (launch the buff tendrils) after `onRallyPulse`, before the strike, so the
   *  beat reads pulse → tendril → lunge. Absent = no absorbed buffs. */
  onWindupBuffs?: () => void;
  /** Set when this exchange consumed a Ward (a `shield` event on attacker/defender) → shatter it at the lunge's
   *  real contact position instead of a fixed start-relative delay, so the gold break reads AT the hit. */
  onImpactAuras?: () => void;
}

/** ms the lunge holds at the top of the wind-up when a Rally fires, so its bright yellow pulse has time to
 *  flare + release before the strike (a longer beat than a normal swing — the Rally is worth reading). */
const RALLY_PAUSE_MS = 440;

/**
 * The choreo playback engine (phase 3b) — runs an `attackExchange` moment's cues: score-driven (reads
 * `getScore()['attackExchange']`), it composes the lunge motion + the contact-anchored impact channel + the
 * caller's `advance` into ONE GSAP timeline. Returns the built timeline (null for a non-attack moment, or
 * when the score has dropped the `lunge` cue), so a caller/test can seek it synchronously.
 */
export function runAttackExchangeCues(
  moment: Moment,
  attacker: Element,
  defender: Element | null,
  dx: number,
  dy: number,
  ctx: AttackCueCtx,
): ReturnType<typeof gsap.timeline> | null {
  if (moment.primary.type !== 'attack') return null;
  const cues = getScore()[moment.kind];
  if (!cues.some((c) => c.ch === 'lunge' && c.enabled !== false)) return null;
  const impact = cues.find((c) => c.ch === 'impact' && c.at === 'contact' && c.enabled !== false);
  const power = hitPower(moment.primary.swing);
  // The advance always fires AT contact (the beat clock stays welded to connection); the smack fires at
  // contact + the impact cue's offset — negative fires it BEFORE contact (the smack-lead), positive after.
  // playLunge places it on its own timeline, so it stays killed/seekable with the lunge and scales with speed.
  const cfg = getLungeConfig();
  const sp = getStrikeFxConfig().strikePoint; // 0 = corner meets defender surface, 1 = corner drives to defender CENTRE
  const atkRect = attacker.getBoundingClientRect();
  const defRect = defender?.getBoundingClientRect();
  const geo = contactGeometry(dx, dy, atkRect, defRect ?? { width: 0, height: 0 }, cfg);
  // The attacker always leads with its tilted corner; `strikePoint` sets how DEEP that corner drives — from
  // the defender's near SURFACE (geo.contact, 0) to the defender's TRUE CENTRE (the full attacker→defender
  // vector dx/dy, 1). We translate the attacker so its leading corner lands on that target, and fire the
  // impact FX there. `cornerLocal` is the tilted corner's offset from the attacker's own centre, so
  // `strike = target − cornerLocal` puts the corner (not the card centre) on the target.
  const atkC = { x: atkRect.left + atkRect.width / 2, y: atkRect.top + atkRect.height / 2 };
  const cornerLocal = { x: geo.contact.x - geo.strike.x, y: geo.contact.y - geo.strike.y };
  const targetOffset = { x: geo.contact.x + (dx - geo.contact.x) * sp, y: geo.contact.y + (dy - geo.contact.y) * sp };
  const strikeOffset = { x: targetOffset.x - cornerLocal.x, y: targetOffset.y - cornerLocal.y };
  const impactAt = { x: atkC.x + targetOffset.x, y: atkC.y + targetOffset.y };
  const spinDeg = -Math.sign(geo.leadTilt || 1) * cfg.defenderSpin;
  return playLunge({
    attacker, dx, dy, speed: ctx.combatSpeed,
    strike: strikeOffset, strikeDur: geo.strikeDur, leadTilt: geo.leadTilt, attackerRebound: cfg.attackerRebound,
    onContact: () => ctx.advance(),
    onImpact: impact ? () => playContactImpact(defender, dx, dy, power, ctx.combatSpeed, impactAt, spinDeg) : undefined,
    impactOffsetMs: impact?.offset ?? 0,
    onRallyPulse: ctx.onRallyPulse,
    onWindupBuffs: ctx.onWindupBuffs,
    onImpactAuras: ctx.onImpactAuras,
    rallyPauseMs: RALLY_PAUSE_MS,
  });
}

/**
 * The Rise pull-back (choreographer phase 3c) — a Rise ATTACKER that died to retaliation mid-lunge is pulled
 * straight back to its slot (a short hold so the contact reads, then a quick pull), so its spirit burst lands
 * in its own slot, not mid-flight. `onLanded` fires at the tween's end — the `landed` anchor that replaces the
 * former `data-rising` DOM-flag weld (the replay's syncShields used to poll that flag; now the engine's
 * timeline fires the burst directly). Returns the timeline (seekable in tests).
 */
export function runRiseReturn(el: Element, combatSpeed: number, onLanded: () => void): ReturnType<typeof gsap.timeline> {
  gsap.killTweensOf(el);
  const tl = gsap.timeline();
  tl.to(el, {
    x: 0, y: 0, rotation: 0, scale: 1,
    delay: 0.1 / combatSpeed, duration: 0.24 / combatSpeed, ease: 'power2.out',
    onComplete: () => gsap.set(el, { clearProps: 'transform,zIndex' }),
  });
  tl.add(onLanded); // landed → fire the spirit burst in the unit's own slot
  return tl;
}
