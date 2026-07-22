import gsap from 'gsap';
import type { Moment } from './compile';
import { getScore } from './score';
import { playLunge, setTransition } from './channels/lunge';
import { getCleaveFxConfig } from '../cleaveFxConfig';
import { hitPower, playContactImpact } from './channels/impact';
import { getLungeConfig, strikeBandFor, strikeEaseFor } from '../lungeConfig';
import { contactGeometry } from './contactGeometry';
import { recordLunge } from '../lungeProbe';

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
  /** Set when this swing is a CRITICAL STRIKE → fired at the lunge's real contact (alongside the crit burst)
   *  so the board SHAKE lands ON the hit, not at the wind-up. Absent = a normal swing. */
  onCritImpact?: () => void;
  /** True when the attacker has Flurry (W) — the engine fires the wind-slash sparkle at contact on the EXTRA
   *  swing (swing ≥ 1), so the bonus hit reads as a gust. The swing gate lives here (the event knows it). */
  flurry?: boolean;
  /** True when an EXECUTE proc (`poison` event) landed inside this exchange — the strike replaces the standard
   *  hit FX at contact. Set from the event, not the attacker's keyword: `V` is spent after one kill, so a
   *  keyword check would keep slashing on later swings that execute nothing. */
  execute?: boolean;
  /** True when the attacker has Cleave (C) — the lunge holds a hit-stop at contact and the impact plays the
   *  claw rake instead of the standard burst. Read from the unit's LIVE keywords, so a mid-combat grant
   *  counts. Outranked by `execute` (see the precedence note in `playContactImpact`). */
  cleave?: boolean;
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
  const crit = moment.primary.crit === true; // Critical Strike this swing → the impact plays the crit sound
  const hasFlurry = ctx.flurry === true;   // attacker has Flurry (W) → the wind sounds + slash on EVERY swing (both hits)
  const hasCleave = ctx.cleave === true;   // Cleave (C) -> hit-stop at contact, then the red gash
  const flurrySlash = hasFlurry;           // owner note 2026-07-17: the wind-slash visual rides both strikes, not just the extra
  // The advance always fires AT contact (the beat clock stays welded to connection); the smack fires at
  // contact + the impact cue's offset — negative fires it BEFORE contact (the smack-lead), positive after.
  // playLunge places it on its own timeline, so it stays killed/seekable with the lunge and scales with speed.
  const cfg = getLungeConfig();
  const atkRect = attacker.getBoundingClientRect();
  const defRect = defender?.getBoundingClientRect();
  // LAYOUT-FRAME COMPENSATION (owner report 2026-07-21: "some attacks land dead centre, others go off
  // early"): the caller's dx/dy come from live rects, which include any IN-FLIGHT transform — a defender
  // still recovering from the previous exchange's knockback, or an attacker still mid-elastic-settle
  // (Windfury's second swing; attacking right after being hit). GSAP's x/y drive relative to LAYOUT rest,
  // and the defender recovers to rest during the ~700ms wind-up, so a strike solved against displaced rects
  // lands where the card USED to be. Subtract both cards' current GSAP offsets so the strike is solved in
  // the layout frame — the defender's TRUE rest centre — regardless of what's still moving when we measure.
  // (The tightened attackGap makes overlapping motion the common case, which is why this surfaced now.)
  const curOf = (el: Element | null | undefined): { x: number; y: number } => ({
    x: el ? Number(gsap.getProperty(el, 'x')) || 0 : 0,
    y: el ? Number(gsap.getProperty(el, 'y')) || 0 : 0,
  });
  const atkCur = curOf(attacker);
  const defCur = curOf(defender);
  const ldx = dx - defCur.x + atkCur.x;
  const ldy = dy - defCur.y + atkCur.y;
  // The measured rect also inflates under a mid-wind-up scale — divide the attacker's dims back to rest size.
  const atkScale = Number(gsap.getProperty(attacker, 'scaleX')) || 1;
  const atkSize = { width: atkRect.width / atkScale, height: atkRect.height / atkScale };
  const geo = contactGeometry(ldx, ldy, atkSize, defRect ?? { width: 0, height: 0 }, cfg);
  // The geometry places the attacker so its FIXED leading corner (top corner for a player swing, mirrored
  // bottom corner for an enemy swing, right/left picked by dx) lands on the DEFENDER'S CENTRE — `geo.strike`
  // is the card-centre offset that achieves it, `geo.contact` is that centre, where the impact FX originate.
  // (The former `strikePoint` surface↔centre blend is retired: centre impact is the spec, not a dial.)
  const atkLayoutC = { x: atkRect.left + atkRect.width / 2 - atkCur.x, y: atkRect.top + atkRect.height / 2 - atkCur.y };
  const strikeOffset = geo.strike;
  const impactAt = { x: atkLayoutC.x + geo.contact.x, y: atkLayoutC.y + geo.contact.y };
  const spinDeg = -Math.sign(geo.leadTilt || 1) * cfg.defenderSpin;
  // LATE RESOLUTION (owner report 2026-07-21: impact rings firing "wayyyy before" the defender): everything
  // above measures at SWING START, but the strike lands ~0.9s later (700ms wind-up + strike, +440ms more
  // under a rally pause) — and the board keeps moving through that window. A neighbour's death collapse is a
  // LAYOUT slide (`dyingcollapse` shrinks its width over 320ms, re-centring the whole row), invisible to the
  // GSAP-offset compensation above. So the build-time numbers keep only what must be committed early (the
  // duration the beat clock is welded to, the tilt already animating in the wind-up, the ease band), and the
  // POSITIONS re-solve late, the same way the ward shatter already does:
  //   - the strike target re-measures both cards when the strike TWEEN starts (see `resolveStrike`);
  //   - the impact FX point re-measures the defender when the impact FIRES (its visual centre — the ring
  //     lands on the card wherever it actually is).
  const posedCorner = { x: geo.contact.x - geo.strike.x, y: geo.contact.y - geo.strike.y };
  const layoutC = (el: Element): { x: number; y: number } => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - (Number(gsap.getProperty(el, 'x')) || 0),
      y: r.top + r.height / 2 - (Number(gsap.getProperty(el, 'y')) || 0),
    };
  };
  const resolveStrike = defender
    ? (): { x: number; y: number } => {
        const a = layoutC(attacker);
        const d = layoutC(defender);
        if (!Number.isFinite(a.x) || !Number.isFinite(d.x)) return strikeOffset;
        // Fresh layout vector, build-time pose: the corner offset was committed when the wind-up tilted the
        // card, so only the TRANSLATION re-solves — the posed corner still lands exactly on the centre.
        return { x: d.x - a.x - posedCorner.x, y: d.y - a.y - posedCorner.y };
      }
    : undefined;
  const liveImpactAt = (): { x: number; y: number } => {
    const r = defender?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : impactAt;
  };
  // DEV probe (no-op unless the Lunge tuner is open): record what the distance→duration / distance→ease /
  // angle→tilt functions produced for THIS vector. There is no stable per-pairing key to inspect instead —
  // the rows re-centre as units die — so the tuner reads the functions' real outputs.
  recordLunge({
    dist: geo.dist, travel: geo.travel, strikeDur: geo.strikeDur, clamped: geo.clamped,
    approachDeg: geo.approachDeg, leadTilt: geo.leadTilt,
    band: strikeBandFor(geo.travel), ease: strikeEaseFor(geo.travel),
  });
  return playLunge({
    // The layout-frame vector everywhere: the wind-up leans back along it, the blow direction rides it, and
    // the strike target was solved from it — one frame, no mixed-measurement drift.
    attacker, dx: ldx, dy: ldy, speed: ctx.combatSpeed, flurry: hasFlurry,
    strike: strikeOffset, resolveStrike, strikeDur: geo.strikeDur, travel: geo.travel, leadTilt: geo.leadTilt, attackerRebound: cfg.attackerRebound,
    onContact: () => ctx.advance(),
    onImpact: impact ? () => { playContactImpact(defender, ldx, ldy, power, ctx.combatSpeed, liveImpactAt(), spinDeg, crit, hasFlurry, flurrySlash, ctx.execute === true, hasCleave); if (crit) ctx.onCritImpact?.(); } : undefined,
    impactOffsetMs: impact?.offset ?? 0,
    hitStopMs: hasCleave ? getCleaveFxConfig().hitStopMs : 0,
    returnDelayMs: hasCleave ? getCleaveFxConfig().returnDelayMs : 0,
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
  // Suspend the `.unit` transform-transition for the pull-home (see the lunge.ts note) — killing the lunge
  // above also skipped its restore, so set-and-restore here keeps the element clean either way.
  setTransition(el, 'none');
  const tl = gsap.timeline();
  tl.to(el, {
    x: 0, y: 0, rotation: 0, scale: 1,
    delay: 0.1 / combatSpeed, duration: 0.24 / combatSpeed, ease: 'power2.out',
    onComplete: () => {
      setTransition(el, '');
      gsap.set(el, { clearProps: 'transform,zIndex' });
    },
  });
  tl.add(onLanded); // landed → fire the spirit burst in the unit's own slot
  return tl;
}
