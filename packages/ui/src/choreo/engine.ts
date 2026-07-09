import gsap from 'gsap';
import type { Moment } from './compile';
import { getScore } from './score';
import { playLunge } from './channels/lunge';
import { hitPower, playContactImpact } from './channels/impact';
import { getLungeConfig } from '../lungeConfig';
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
}

/** ms the lunge holds at the top of the wind-up when a Rally fires, so its yellow pulse reads before the strike. */
const RALLY_PAUSE_MS = 240;

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
  const atkRect = attacker.getBoundingClientRect();
  const defRect = defender?.getBoundingClientRect() ?? { width: 0, height: 0 };
  const geo = contactGeometry(dx, dy, atkRect, defRect, cfg);
  // The impact FX originates at the real clack point — the attacker's leading corner (rest center + the
  // geometry's contact offset) — instead of the defender's center, so the spark sprays from where the two
  // corners meet.
  const impactAt = {
    x: atkRect.left + atkRect.width / 2 + geo.contact.x,
    y: atkRect.top + atkRect.height / 2 + geo.contact.y,
  };
  return playLunge({
    attacker, dx, dy, speed: ctx.combatSpeed,
    strike: geo.strike, strikeDur: geo.strikeDur, leadTilt: geo.leadTilt, attackerRebound: cfg.attackerRebound,
    onContact: () => ctx.advance(),
    onImpact: impact ? () => playContactImpact(defender, dx, dy, power, ctx.combatSpeed, geo.leadTilt, impactAt) : undefined,
    impactOffsetMs: impact?.offset ?? 0,
    onRallyPulse: ctx.onRallyPulse,
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
