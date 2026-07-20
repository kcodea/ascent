import gsap from 'gsap';
import { getLungeConfig, strikeEaseFor } from '../../lungeConfig';
import { getTrailConfig } from '../../trailConfig';
import { pixiFx } from '../../pixiFx';
import { sfx } from '../../sfx';

export interface LungeCtx {
  attacker: Element;
  /** Full attacker→defender vector (not normalized). */
  dx: number;
  dy: number;
  /** Strike target offset (surface contact + bite) from contactGeometry — replaces the center-overshoot. */
  strike: { x: number; y: number };
  /** Distance-scaled strike duration (s) from contactGeometry — replaces the fixed config value. */
  strikeDur: number;
  /** Surface-to-surface travel (px) from contactGeometry — selects the strike's EASE BAND, so a short jab
   *  and a long cross-board drive can carry different curves. Defaults to 0 (the short band). */
  travel?: number;
  /** Signed lead-tilt (deg) — the attacker rotates this to lead with a corner. */
  leadTilt: number;
  /** Attacker rotational rebound (deg) at contact, before the settle. */
  attackerRebound: number;
  speed: number;
  /** Fired at the CONTACT GSAP position (smack-lead before the strike completes) — the beat-clock advance
   *  is wired here (see `engine.ts`). Always at the contact point, regardless of the impact offset. */
  onContact: () => void;
  /** The impact FX/sfx/recoil, fired at `contact + impactOffsetMs`. Separate from `onContact` so the smack
   *  can be retimed (incl. NEGATIVE — fire before contact — the smack-lead) without moving the advance. */
  onImpact?: () => void;
  /** ms the impact fires relative to contact; negative = earlier (before connection), positive = later.
   *  Rides the lunge timeline, so it scales with `speed` like the rest of the lunge. Default 0 (on contact). */
  impactOffsetMs?: number;
  /** A RALLY fired as this unit attacks → hold this many ms at the top of the wind-up (a brief pause before
   *  the strike) and fire `onRallyPulse` at its start, so the yellow trigger pulse reads before the swing. */
  rallyPauseMs?: number;
  /** Fired at the wind-up pause (see `rallyPauseMs`) — the caller flashes the attacker's yellow Rally pulse. */
  onRallyPulse?: () => void;
  /** Fired at the wind-up pause AFTER `onRallyPulse` — the caller launches this attack's absorbed buff-other
   *  tendrils (on-attack / Rally buffers), so the sequence reads pulse → tendril → lunge. Its presence (like a
   *  rally) triggers the wind-up hold, so the tendril has time to land before the strike. */
  onWindupBuffs?: () => void;
  /** Fired at the CONTACT GSAP position — the caller shatters any Ward this exchange consumed (attacker/defender)
   *  so the gold break reads AT the clash, not on a fixed start-relative delay that drifts off the hit (which
   *  left the bubble lingering disjointed from the unit mid-recoil). Rides the (speed-scaled) lunge timeline. */
  onImpactAuras?: () => void;
  /** True when the attacker has Flurry (W) → play the `flurryLunge` gust just after the wind-up ends (as the
   *  strike drive launches), on EVERY swing so both hits whoosh with wind. The hit-sound layer fires from
   *  `impact.ts`; the wind-slash VISUAL is separate (extra swing only). */
  flurry?: boolean;
}

/**
 * The attack lunge motion (choreographer phase 3b) — wind up (lean back + tilt to lead a corner), strike to
 * the defender's surface contact point with that corner leading (curve from `strikeEaseFor(travel)` — the strike's
 * ease is a function of how far it travels), contact, then a rotational
 * rebound off the clack before an elastic settle. The strike offset + duration + lead-tilt come in from
 * `contactGeometry` (the attacker stops at the surface rather than overshooting center). GSAP owns the
 * attacker's transform for the whole lunge — React renders no transform on combat units, so they never fight.
 * The contact FX/sfx/recoil live in `channels/impact.ts`, invoked via `onContact` at the exact GSAP position.
 * Returns the built timeline (seekable via `.progress()` in tests, without needing real time to pass).
 */
/** Wrap a cue callback so it can only ever fire ONCE. Load-bearing for `onContact`: the beat-clock advance
 *  rides it, and a dying ATTACKER's pull-home (`runRiseReturn` → `gsap.killTweensOf(attacker)`) guts this
 *  timeline's tweens mid-playhead — GSAP's re-render of the mutilated timeline then RE-FIRES callbacks at the
 *  endpoint, double-advancing the clock ~8ms after contact and skipping the death beat entirely (cards blinked
 *  out with no fade). Advance/impact cues are semantically once-only, so enforce it here at the source. */
function once(fn: () => void): () => void;
function once(fn?: (() => void) | undefined): (() => void) | undefined;
function once(fn?: () => void): (() => void) | undefined {
  if (!fn) return undefined;
  let fired = false;
  return () => { if (!fired) { fired = true; fn(); } };
}

export function playLunge(ctx: LungeCtx): ReturnType<typeof gsap.timeline> {
  const { attacker, dx, dy, speed, strike, strikeDur, travel = 0, leadTilt, attackerRebound, impactOffsetMs = 0, rallyPauseMs = 0, flurry = false } = ctx;
  const onContact = once(ctx.onContact);
  const onImpact = once(ctx.onImpact);
  const onImpactAuras = once(ctx.onImpactAuras);
  const onRallyPulse = once(ctx.onRallyPulse);
  const onWindupBuffs = once(ctx.onWindupBuffs);
  const c = getLungeConfig();
  const rest = attacker.getBoundingClientRect();
  const cx0 = rest.left + rest.width / 2;
  const cy0 = rest.top + rest.height / 2;
  // NB: in combat `findEl` resolves the `.unit` WRAPPER (its data-uid matches first), so the marker classes
  // live on the `.card` DESCENDANT — the querySelector is the live path, not a dead fallback.
  const variant = attacker.classList.contains('dscard') || attacker.querySelector('.dscard')
    ? 'gold'
    : attacker.classList.contains('reborncard') || attacker.querySelector('.reborncard')
      ? 'blue'
      : 'wind';
  // A Rally OR absorbed wind-up buffs (on-attack/Rally buff-others) hold the wound-up pose briefly, so the
  // yellow pulse + the buff tendril read before the strike (sequence: pulse → tendril → lunge).
  const windupPauseS = (onRallyPulse || onWindupBuffs) ? rallyPauseMs / 1000 : 0;
  let trailLast = { x: cx0, y: cy0 };
  const trailCutoff = c.windupDur + windupPauseS + strikeDur;
  gsap.killTweensOf(attacker); // a re-attacker (Windfury / Gnasher swinging again) restarts clean
  gsap.set(attacker, { zIndex: 12 }); // ride above its neighbours for the duration
  const tl = gsap.timeline({
    onComplete: () => gsap.set(attacker, { clearProps: 'transform,zIndex' }),
    onUpdate: () => {
      if (tl.time() > trailCutoff) return; // no trail on the elastic settle
      const cx = cx0 + Number(gsap.getProperty(attacker, 'x'));
      const cy = cy0 + Number(gsap.getProperty(attacker, 'y'));
      const tdx = cx - trailLast.x;
      const tdy = cy - trailLast.y;
      if (Math.hypot(tdx, tdy) >= getTrailConfig().emitSpacing) {
        pixiFx.trail(cx, cy, tdx, tdy, variant);
        trailLast = { x: cx, y: cy };
      }
    },
  });
  tl.to(attacker, { x: -dx * c.windupDepth, y: -dy * c.windupDepth, rotation: leadTilt, scale: c.windupScale, duration: c.windupDur, ease: 'power1.out' }); // wind up, tilt to lead a corner
  if (windupPauseS > 0) {
    if (onRallyPulse) tl.call(onRallyPulse);   // fire the yellow Rally pulse at the top of the wind-up (rally only)…
    if (onWindupBuffs) tl.call(onWindupBuffs);  // …then launch the buff tendrils (pulse → tendril order)…
    tl.to({}, { duration: windupPauseS });      // …then hold the wound-up pose so they read before the strike
  }
  // Flurry (W) extra swing: the wind-up has ended and the strike is about to drive → whoosh the gust here.
  if (flurry) tl.call(() => sfx.flurryLunge());
  tl.to(attacker, { x: strike.x, y: strike.y, rotation: leadTilt, scale: 1, duration: strikeDur, ease: strikeEaseFor(travel) })                                     // strike to the surface, corner leading
    .add(onContact, `-=${c.smackLead}`)                                                                                                                      // contact — the beat advance, smackLead before the strike completes
    .to(attacker, { rotation: -Math.sign(leadTilt) * attackerRebound, duration: 0.06, ease: 'power2.out' })                                                 // rotational rebound off the clack (leadTilt 0 → no lead, no rebound)
    .to(attacker, { x: 0, y: 0, rotation: 0, duration: c.settleDur, ease: 'elastic.out(1, 0.45)' });                                                        // settle
  // The impact (smack/FX/recoil) fires at contact + its offset — an ABSOLUTE timeline position so a negative
  // offset lands EARLIER than contact (the smack-lead), clamped to ≥ 0 (can't precede the timeline). It rides
  // this (speed-timeScaled) timeline, so the smack stays killed/seekable with the lunge and scales with speed.
  const contactAt = c.windupDur + windupPauseS + strikeDur - c.smackLead;
  if (onImpact) {
    tl.add(onImpact, Math.max(0, contactAt + impactOffsetMs / 1000));
  }
  // The Ward shatter for this exchange fires AT contact (offset 0) so the gold break lands with the smack — the
  // bubble tracks the lunge until here, then pops at the hit instead of drifting off mid-recoil.
  if (onImpactAuras) tl.add(onImpactAuras, Math.max(0, contactAt));
  tl.timeScale(speed);
  return tl;
}
