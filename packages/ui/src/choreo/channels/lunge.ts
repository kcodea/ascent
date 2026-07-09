import gsap from 'gsap';
import { getLungeConfig } from '../../lungeConfig';
import { getTrailConfig } from '../../trailConfig';
import { pixiFx } from '../../pixiFx';

export interface LungeCtx {
  attacker: Element;
  /** Full attacker→defender vector (not normalized). */
  dx: number;
  dy: number;
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
 * The attack lunge motion (choreographer phase 3b) — wind up (lean back + tilt), strike toward the
 * defender (power3.in), then settle with an elastic overshoot. GSAP owns the attacker's transform for the
 * whole lunge — React renders no transform on combat units, so they never fight. Verbatim extraction of the
 * former `playAttackLunge` in `useCombatReplay.ts`, MINUS the contact FX/sfx/recoil (now
 * `channels/impact.ts`, invoked via `onContact` at the exact former GSAP position). Returns the built
 * timeline (seekable via `.progress()` in tests, without needing real time to pass).
 */
export function playLunge(ctx: LungeCtx): ReturnType<typeof gsap.timeline> {
  const { attacker, dx, dy, speed, onContact, onImpact, impactOffsetMs = 0 } = ctx;
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
  const trailCutoff = c.windupDur + c.strikeDur;
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
    .to(attacker, { x: -dx * c.windupDepth, y: -dy * c.windupDepth, rotation: -5, scale: c.windupScale, duration: c.windupDur, ease: 'power1.out' })  // wind up
    .to(attacker, { x: dx * 1.44, y: dy * 1.44, rotation: 0, scale: 1, duration: c.strikeDur, ease: 'power3.in' })                                     // strike (strikeDist retired; Task 3 replaces with contactGeometry)
    .add(onContact, `-=${c.smackLead}`)                                                                                                                // contact — fired smackLead seconds BEFORE the strike completes (the advance)
    .to(attacker, { x: 0, y: 0, rotation: 0, duration: c.settleDur, ease: 'elastic.out(1, 0.45)' });                                                    // settle
  // The impact (smack/FX/recoil) fires at contact + its offset — an ABSOLUTE timeline position so a negative
  // offset lands EARLIER than contact (the smack-lead), clamped to ≥ 0 (can't precede the timeline). It rides
  // this (speed-timeScaled) timeline, so the smack stays killed/seekable with the lunge and scales with speed.
  if (onImpact) {
    const contactAt = c.windupDur + c.strikeDur - c.smackLead;
    tl.add(onImpact, Math.max(0, contactAt + impactOffsetMs / 1000));
  }
  tl.timeScale(speed);
  return tl;
}
