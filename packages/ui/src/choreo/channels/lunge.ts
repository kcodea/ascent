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
  /** Fired at the smack-lead GSAP position — the moment of contact. See `engine.ts` for how this is wired
   *  to the impact channel + the beat-clock advance. */
  onContact: () => void;
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
  const { attacker, dx, dy, speed, onContact } = ctx;
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
    .to(attacker, { x: dx * c.strikeDist, y: dy * c.strikeDist, rotation: 0, scale: 1, duration: c.strikeDur, ease: 'power3.in' })                    // strike
    .add(onContact, `-=${c.smackLead}`)                                                                                                                // contact — fired smackLead seconds BEFORE the strike completes
    .to(attacker, { x: 0, y: 0, rotation: 0, duration: c.settleDur, ease: 'elastic.out(1, 0.45)' });                                                    // settle
  tl.timeScale(speed);
  return tl;
}
