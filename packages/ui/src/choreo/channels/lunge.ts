import gsap from 'gsap';
import { getLungeConfig } from '../../lungeConfig';
import { getTrailConfig } from '../../trailConfig';
import { pixiFx } from '../../pixiFx';

export interface LungeCtx {
  attacker: Element;
  /** Full attacker→defender vector (not normalized). */
  dx: number;
  dy: number;
  /** Strike target offset (surface contact + bite) from contactGeometry — replaces the center-overshoot. */
  strike: { x: number; y: number };
  /** Distance-scaled strike duration (s) from contactGeometry — replaces the fixed config value. */
  strikeDur: number;
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
}

/**
 * The attack lunge motion (choreographer phase 3b) — wind up (lean back + tilt to lead a corner), strike to
 * the defender's surface contact point with that corner leading (power3.in), contact, then a short rotational
 * rebound off the clack before an elastic settle. The strike offset + duration + lead-tilt come in from
 * `contactGeometry` (the attacker stops at the surface rather than overshooting center). GSAP owns the
 * attacker's transform for the whole lunge — React renders no transform on combat units, so they never fight.
 * The contact FX/sfx/recoil live in `channels/impact.ts`, invoked via `onContact` at the exact GSAP position.
 * Returns the built timeline (seekable via `.progress()` in tests, without needing real time to pass).
 */
export function playLunge(ctx: LungeCtx): ReturnType<typeof gsap.timeline> {
  const { attacker, dx, dy, speed, strike, strikeDur, leadTilt, attackerRebound, onContact, onImpact, impactOffsetMs = 0 } = ctx;
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
  let trailLast = { x: cx0, y: cy0 };
  const trailCutoff = c.windupDur + strikeDur;
  gsap.killTweensOf(attacker); // a re-attacker (Windfury / Gnasher swinging again) restarts clean
  gsap.set(attacker, { zIndex: 12 }); // ride above its neighbours for the duration
  const tl = gsap
    .timeline({
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
    })
    .to(attacker, { x: -dx * c.windupDepth, y: -dy * c.windupDepth, rotation: leadTilt, scale: c.windupScale, duration: c.windupDur, ease: 'power1.out' })  // wind up, tilt to lead a corner
    .to(attacker, { x: strike.x, y: strike.y, rotation: leadTilt, scale: 1, duration: strikeDur, ease: 'power3.in' })                                       // strike to the surface, corner leading
    .add(onContact, `-=${c.smackLead}`)                                                                                                                      // contact — the beat advance, smackLead before the strike completes
    .to(attacker, { rotation: -Math.sign(leadTilt) * attackerRebound, duration: 0.06, ease: 'power2.out' })                                                 // rotational rebound off the clack (leadTilt 0 → no lead, no rebound)
    .to(attacker, { x: 0, y: 0, rotation: 0, duration: c.settleDur, ease: 'elastic.out(1, 0.45)' });                                                        // settle
  // The impact (smack/FX/recoil) fires at contact + its offset — an ABSOLUTE timeline position so a negative
  // offset lands EARLIER than contact (the smack-lead), clamped to ≥ 0 (can't precede the timeline). It rides
  // this (speed-timeScaled) timeline, so the smack stays killed/seekable with the lunge and scales with speed.
  if (onImpact) {
    const contactAt = c.windupDur + strikeDur - c.smackLead;
    tl.add(onImpact, Math.max(0, contactAt + impactOffsetMs / 1000));
  }
  tl.timeScale(speed);
  return tl;
}
