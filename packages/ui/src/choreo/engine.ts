import gsap from 'gsap';
import type { Moment } from './compile';
import { getScore } from './score';
import { playLunge } from './channels/lunge';
import { hitPower, playContactImpact } from './channels/impact';

export interface AttackCueCtx {
  combatSpeed: number;
  /** Advance the beat clock to the next moment — called from the SAME GSAP position as the impact channel
   *  (the `contact` anchor), retiring the former `clock.ts` smack-lead weld (two independently-computed
   *  formulas that merely agreed in value; now there is exactly one timeline event both key off). */
  advance: () => void;
}

/**
 * The choreo playback engine (phase 3b) — runs an `attackExchange` moment's cues: score-driven (reads
 * `SCORE['attackExchange']`), it composes the lunge motion + the contact-anchored impact channel + the
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
  return playLunge({
    attacker, dx, dy, speed: ctx.combatSpeed,
    onContact: () => {
      if (impact) {
        // Positive offset delays the smack after connection; 0 = at contact. Negative (fire BEFORE contact —
        // the smack-lead) is deferred: it needs playLunge to expose the contact position as a tunable, so we
        // clamp to ≥ 0 here (a noted follow-up, not this slice).
        const off = Math.max(0, impact.offset ?? 0) / 1000 / (impact.scaled === false ? 1 : (ctx.combatSpeed > 0 ? ctx.combatSpeed : 1));
        const fire = (): void => playContactImpact(defender, dx, dy, power, ctx.combatSpeed);
        if (off > 0) gsap.delayedCall(off, fire); else fire();
      }
      ctx.advance();
    },
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
