import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { canPlayDefs, playDef } from './fx/playDef';
import { diceRollParamsFor, type DiceVariant } from './diceRollConfig';
import {
  buildDiceTimeline, diceCosmetics, FACE_PIPS, FACE_TRANSFORM, shadowFor, type DieFace,
} from './diceRollTimeline';

/**
 * The DICE ROLL overlay — ONE top-down 3D CSS die shared by both callers (owner handoff 2026-09-17):
 *   • the Gambler's hero power (`variant="power"`) — the die lands on the power button, then hands off to
 *     the held face the button keeps for the rest of the turn (`StatusBar`'s `diceHeld`);
 *   • the Gamble spell (`variant="spell"`) — the die lands at the cast point, its face IS the tier pulled,
 *     and the prize card is withheld from the hand until `onLand` (`Recruit`'s `gambleHold`).
 * The differences are props (tint, preset, hold), never a fork of the animation.
 *
 * The component never rolls — `result` comes from the sim (see `diceRollTimeline.ts`). It mounts a fixed 0×0 GROUND
 * at `anchor` carrying the perspective (so the die is always seen dead-on), and the GSAP timeline writes
 * transform + opacity only: hop › yaw › cube › faces, with the shadow following the hop height. The landing
 * burst rides the FX pipeline (`dice-land`, recoloured by variant / tier) rather than hand-rolled divs, and
 * every cosmetic choice comes from `seed` — so the same event replays pixel-identical.
 *
 * Perf: no layout reads at all during the roll (the anchor is measured ONCE by the caller); four style
 * writes per frame on compositor-only properties. `prefers-reduced-motion` collapses it to a 250 ms
 * appearance with no hop, spins or burst.
 */
export interface DiceRollProps {
  /** 1–6, from the sim. For the spell this is the tier pulled. */
  result: DieFace;
  /** Screen px — the centre of the landing (or, for a THROW, the launch point). Measured once by the caller. */
  anchor: { x: number; y: number };
  /** A THROW (the Gamble spell): the die launches from `anchor` and bounces across the table to land at `to`
   *  (screen px, computed by the caller via `throwLanding`). The power path omits it and hops in place. It is a
   *  prop on the one shared component, not a fork — see `diceRollTimeline.ts`. */
  throwTo?: { x: number; y: number };
  variant: DiceVariant;
  /** Seeds the cosmetics (rest yaw, burst jitter). Key it off the EVENT — `diceSeed(...)`. */
  seed: number;
  /** ms to keep the settled die on screen before it fades; 0 = fade the moment it settles (the power hands
   *  off to the button's held face as the overlay goes). */
  holdMs?: number;
  /** First ground contact, t = 0.62. Also the sound hook (no clip yet). */
  onLand?: () => void;
  /** Settled, t = 1. */
  onComplete?: () => void;
  /** The overlay has faded out and can be unmounted. */
  onRetire?: () => void;
}

/** Die size in px (the handoff's 76). Faces sit at ±half on their axis. */
export const DIE_SIZE = 76;
const HALF = DIE_SIZE / 2;
const FACES: DieFace[] = [1, 2, 3, 4, 5, 6];

/** The GAME's tier ramp (styles.css `--tier-N`), as fallbacks when the token can't be read. */
const TIER_FALLBACK: Record<DieFace, string> = {
  1: '#74809a', 2: '#1f9d6b', 3: '#2b82d4', 4: '#7b54c8', 5: '#ef8a25', 6: '#e0395f',
};
/** The hero panel's frame gold (styles.css `--gold-lt`). */
const GOLD_FALLBACK = '#e6b45a';

/** Read a CSS custom property off :root, falling back when unset (tests, a detached document). */
function cssToken(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** The tint for a roll: gold for the power, the tier colour for the spell (face = tier). */
export function diceTint(variant: DiceVariant, result: DieFace): string {
  return variant === 'spell' ? cssToken(`--tier-${result}`, TIER_FALLBACK[result]) : cssToken('--gold-lt', GOLD_FALLBACK);
}

/** `#rrggbb` → the 4-stop rim→core palette `playDef`'s `recolor` takes (tint, two lighter mixes, white). */
export function tintPalette(hex: string): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const rgb = m ? parseInt(m[1]!, 16) : 0xe6b45a;
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  const mix = (t: number): number => {
    const c = (v: number): number => Math.round(v + (255 - v) * t);
    return (c(r) << 16) | (c(g) << 8) | c(b);
  };
  return [rgb, mix(0.35), mix(0.65), 0xffffff];
}

/** Where each variant's die came to rest last time (bare target, mod 360), so the next roll starts from an
 *  equivalent pose with no jump. Module-level: the component unmounts between rolls. */
const restPose: Record<DiceVariant, { rx: number; ry: number }> = {
  power: { rx: 0, ry: 0 },
  spell: { rx: 0, ry: 0 },
};

/** Test/dev hook: read the pose the next roll of a variant will start from. */
export function diceRestPose(variant: DiceVariant): { rx: number; ry: number } {
  return { ...restPose[variant] };
}

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function DiceRoll(props: DiceRollProps): JSX.Element {
  const { result, anchor, variant, seed, holdMs = 0, throwTo } = props;
  const groundRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  const yawRef = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  // Latest callbacks without re-running the roll effect when a parent re-renders mid-tumble.
  const cbs = useRef(props);
  cbs.current = props;

  useLayoutEffect(() => {
    const ground = groundRef.current, shadow = shadowRef.current, hop = hopRef.current, yaw = yawRef.current, cube = cubeRef.current;
    if (!ground || !shadow || !hop || !yaw || !cube) return;
    const reduced = reducedMotion();
    const params = diceRollParamsFor(variant);
    const cosmetics = diceCosmetics(seed);
    const tint = diceTint(variant, result);
    const palette = tintPalette(tint);
    let fade: gsap.core.Tween | null = null;
    let holdTimer = 0;
    const thrown = throwTo && params.throw
      ? { dx: throwTo.x - anchor.x, dy: throwTo.y - anchor.y, bounceCount: params.throw.bounceCount, bounceDecay: params.throw.bounceDecay }
      : undefined;
    const burst = (at: { x: number; y: number }, scale: number): void => {
      if (reduced || !canPlayDefs()) return;
      const p = { x: at.x + cosmetics.jitter.x, y: at.y + cosmetics.jitter.y };
      playDef('dice-land', { source: p, target: p, cursor: p }, { recolor: palette, scale });
    };

    const built = buildDiceTimeline({
      result,
      from: restPose[variant],
      tumbleTime: params.tumbleTime,
      hopHeight: params.hopHeight,
      spinCount: params.spinCount,
      settleBounce: params.settleBounce,
      restAngle: cosmetics.restAngle,
      reducedMotion: reduced,
      throw: thrown,
      onUpdate: (s) => {
        // Five transform writes, no reads. The shadow follows the hop height — the top-down depth cue.
        if (thrown) ground.style.transform = `translate(${s.tx}px, ${s.ty}px)`;
        hop.style.transform = `translateZ(${s.z}px) scale(${s.scale})`;
        yaw.style.transform = `rotateZ(${s.yaw}deg)`;
        cube.style.transform = `rotateX(${s.rx}deg) rotateY(${s.ry}deg)`;
        const sh = shadowFor(s.z);
        shadow.style.opacity = String(sh.opacity);
        shadow.style.transform = `translate(${sh.tx}px, ${sh.ty}px) scale(${sh.scale})`;
      },
      // An intermediate bounce of a throw: a smaller burst where it touched down.
      onBounce: (_i, at) => { burst({ x: anchor.x + at.x, y: anchor.y + at.y }, 0.55); },
      onLand: () => {
        // The landing burst — ring + 12 particles — through the authored def, tinted by variant / tier. Skipped
        // under reduced motion (the handoff: just show the face). Sound hook: an `sfx` cue belongs HERE when a
        // clip exists (none yet). For a throw this is the FINAL touchdown, at the landing spot.
        burst(throwTo ?? anchor, 1);
        cbs.current.onLand?.();
      },
      onComplete: () => {
        restPose[variant] = built.rest;
        cbs.current.onComplete?.();
        const go = (): void => {
          fade = gsap.to(ground, { opacity: 0, duration: reduced ? 0.12 : 0.22, ease: 'power1.in', onComplete: () => { cbs.current.onRetire?.(); } });
        };
        if (holdMs > 0) holdTimer = window.setTimeout(go, holdMs); else go();
      },
    });
    // Draw the first frame before the first tick so the die never flashes at the DOM's default pose.
    built.tl.progress(0).play();
    return () => {
      built.tl.kill();
      fade?.kill();
      window.clearTimeout(holdTimer);
    };
    // A roll is one event: the props that identify it are fixed for the component's life.
  }, [result, variant, seed, anchor.x, anchor.y, throwTo?.x, throwTo?.y]);

  const tint = diceTint(variant, result);
  const style = { left: anchor.x, top: anchor.y, '--dice-tint': tint } as CSSProperties;
  return createPortal(
    <div ref={groundRef} className={`diceroll diceroll-${variant}`} style={style} aria-hidden="true" data-face={result}>
      <div ref={shadowRef} className="diceroll-shadow" />
      <div ref={hopRef} className="diceroll-hop">
        <div ref={yawRef} className="diceroll-yaw">
          <div ref={cubeRef} className="diceroll-cube">
            {FACES.map((f) => (
              <div key={f} className="diceroll-face" data-face={f} style={{ transform: `${FACE_TRANSFORM[f]} translateZ(${HALF}px)` }}>
                {Array.from({ length: 9 }, (_, i) => (
                  <span key={i} className={FACE_PIPS[f].includes(i) ? 'diceroll-pip on' : 'diceroll-pip'} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
