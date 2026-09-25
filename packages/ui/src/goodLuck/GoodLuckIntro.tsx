import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useGame } from '../store';
import { canPlayDefs, playDef } from '../fx/playDef';
import { sfx, type SfxHandle } from '../sfx';
import { goodLuckIntro, useGoodLuckIntroActive, useGoodLuckIntroSeq } from './goodLuckIntroStore';
import { GLI_DEFAULTS, GLI_REPLAY_EVENT, getGoodLuckIntroConfig, goodLuckTail, goodLuckTimeline } from './goodLuckIntroConfig';
import './goodLuckIntro.css';

/**
 * THE "GOOD LUCK" INTRO — the overlay (owner ask 2026-09-24).
 *
 * Mounted once in Game, just under the launch curtain. It renders nothing until `goodLuckIntro.begin()` (the
 * curtain calls it right after `pickHero` builds a lobby / Practice run), then plays ONE pass:
 *
 *   dim the live first shop  →  "Good Luck" fades and grows in, the flourishes draw outward, gold sparks burst
 *   →  a single shine sweeps the words left to right  →  hold  →  words + dim fade to the live board  →  end.
 *
 * `end()` releases the shop clock (Recruit's countdown gate reads the same store), so the turn starts at full
 * time on the first frame of the live board. Esc or a click anywhere skips straight there.
 *
 * Perf contract: every animation is transform / opacity on a composited layer, scheduled up front through WAAPI
 * with delays, so there is no per-frame JS at all. The glow is a STATIC filter on the words, rasterized once.
 * The shine is two counter-moving transforms (a soft-edged window sliding right over a bright copy of the words
 * sliding left by the same amount), so the bright copy stays pinned to the glyphs with no paint property
 * animated. Layout is read exactly once per play (the words' box, for the shine distance and the spark anchor).
 */

/** The committed `good-luck-intro` def's authored spark count; the tuner's count becomes an `intensity` multiplier on it. */
const DEF_SPARKS = 70;

function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** WAAPI when available; jsdom (tests) has none, and the intro still ends on its timer there. */
function anim(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  (el as HTMLElement).animate(frames, opts);
}

/** One ornamental arm: a filigree line with a scroll curl at its outer end and a double chevron pointing in
 *  at the words. Drawn for the LEFT side; the right arm is the same art mirrored by its wrapper. Also worn, at
 *  heading size, by the Discover / Choose One title banner (`discoverEntrance/OfferBanner.tsx`). */
export function Flourish(): JSX.Element {
  return (
    <svg className="gli-flour-svg" viewBox="0 0 260 48" aria-hidden="true">
      <path className="gli-flour-line" d="M34 24 H214" />
      <path className="gli-flour-line thin" d="M60 31 H196" />
      <path className="gli-flour-line" d="M34 24 C 20 24, 12 16, 18 9 C 24 3, 34 8, 30 15 C 27 20, 20 18, 21 14" />
      <path className="gli-flour-line thin" d="M34 24 C 22 26, 16 34, 22 40 C 27 44, 34 39, 31 34" />
      <path className="gli-flour-fill" d="M214 16 L232 24 L214 32 L220 24 Z" />
      <path className="gli-flour-fill" d="M232 18 L246 24 L232 30 L236 24 Z" />
      <circle className="gli-flour-fill" cx="48" cy="24" r="3.2" />
      <circle className="gli-flour-fill" cx="200" cy="24" r="2.4" />
    </svg>
  );
}

export function GoodLuckIntro(): JSX.Element | null {
  const active = useGoodLuckIntroActive();
  const seq = useGoodLuckIntroSeq();
  const showTitle = useGame((s) => s.showTitle);

  const dimRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wordRef = useRef<HTMLDivElement | null>(null);
  const shineRef = useRef<HTMLSpanElement | null>(null);
  const shineTextRef = useRef<HTMLSpanElement | null>(null);
  const flourLRef = useRef<HTMLDivElement | null>(null);
  const flourRRef = useRef<HTMLDivElement | null>(null);

  // DEV ▶ replay from the tuner: replay over whatever board is up. Never from the title (nothing to dim).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onReplay = (): void => {
      const st = useGame.getState();
      if (st.run && !st.showTitle) goodLuckIntro.begin();
    };
    window.addEventListener(GLI_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(GLI_REPLAY_EVENT, onReplay);
  }, []);

  // Leaving to the title mid-intro (or Game unmounting) must never strand the clock held.
  useEffect(() => { if (active && showTitle) goodLuckIntro.end(); }, [active, showTitle]);
  useEffect(() => () => goodLuckIntro.end(), []);

  // Esc skips. Capture phase + stopPropagation so the same press does not also open the Esc menu underneath.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      goodLuckIntro.end();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // THE ONE PASS. Layout effect so every animation is scheduled before the overlay's first paint (the words must
  // never flash at full opacity for a frame). Keyed on `seq` so a replay restarts it cleanly.
  useLayoutEffect(() => {
    if (!active) return;
    const c = getGoodLuckIntroConfig();
    const reduced = prefersReducedMotion();
    const t = goodLuckTimeline(c, reduced);
    const timers: number[] = [];
    // The sounds are queued up front on the AUDIO clock (like the WAAPI animations), so they cannot drift from
    // the sweep. Each ends on its own soft tail (a fade over its last few hundred ms plus a light reverb; see
    // audio/tailFade). A skip (Esc / click / replay / leaving) fades whatever is still sounding in ~120 ms; the
    // natural end does not touch them, so the tails ring out over the live board.
    const sounds: (SfxHandle | null)[] = [];
    let endedNaturally = false;

    // The shine sound plays under reduced motion too: it is audio, and the words still arrive. Only the sweep's
    // motion is dropped there, so it lands as the words finish fading in, exactly where the sweep would start.
    sounds.push(sfx.goodLuckShine(c.shineSoundGain, t.shineSoundAt, goodLuckTail(c, 'shine')));

    // The dim is already at full strength (static CSS), so the curtain lifts onto a dimmed board. It only fades OUT.
    anim(dimRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: c.fadeOutMs, delay: t.outAt, easing: 'ease-in', fill: 'forwards' });

    const stage = stageRef.current;
    if (reduced) {
      anim(stage, [{ opacity: 0 }, { opacity: 1 }], { duration: c.fadeInMs, delay: t.inAt, easing: 'ease-out', fill: 'both' });
      anim(stage, [{ opacity: 1 }, { opacity: 0 }], { duration: c.fadeOutMs, delay: t.outAt, easing: 'ease-in', fill: 'forwards' });
    } else {
      anim(stage, [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: c.fadeInMs, delay: t.inAt, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.05)', fill: 'both' });
      anim(stage, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.04)' }],
        { duration: c.fadeOutMs, delay: t.outAt, easing: 'ease-in', fill: 'forwards' });

      // The flourishes draw OUTWARD from the words (transform-origin sits on their inner end — see the CSS).
      const drawIn = { duration: Math.round(c.fadeInMs * 1.1), delay: t.inAt + Math.round(c.fadeInMs * 0.25), easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' as const };
      const drawFrames = [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'scaleX(1)' }];
      anim(flourLRef.current, drawFrames, drawIn);
      anim(flourRRef.current, drawFrames, drawIn);

      // The shine: ONE layout read, for how far the window has to travel.
      const word = wordRef.current;
      const band = shineRef.current;
      if (word && band) {
        // offsetWidth, not the rect: the stage is mid-scale here, and the sweep runs at full size.
        const w = word.offsetWidth;
        const bw = band.offsetWidth || w * 0.3;
        const shineOpts = { duration: c.shineMs, delay: t.shineAt, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'both' as const };
        anim(band, [{ transform: `translateX(${-bw}px)` }, { transform: `translateX(${w}px)` }], shineOpts);
        anim(shineTextRef.current, [{ transform: `translateX(${bw}px)` }, { transform: `translateX(${-w}px)` }], shineOpts);
      }

      // The sparks, off the words' centre, a beat into the fade-in so they burst as the words bloom.
      if (c.sparkCount > 0) {
        sounds.push(sfx.goodLuckSpark(c.sparkSoundGain, t.sparkAt, goodLuckTail(c, 'spark')));
        timers.push(window.setTimeout(() => {
          const el = wordRef.current;
          if (!el || !canPlayDefs()) return;
          const r = el.getBoundingClientRect();
          const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          playDef('good-luck-intro', { source: p, target: p, cursor: p }, { intensity: c.sparkCount / DEF_SPARKS });
        }, t.sparkAt));
      }
    }

    timers.push(window.setTimeout(() => { endedNaturally = true; goodLuckIntro.end(); }, t.endAt));
    return () => {
      for (const id of timers) window.clearTimeout(id);
      if (!endedNaturally) for (const h of sounds) h?.stop();
    };
  }, [active, seq]);

  if (!active) return null;
  const c = getGoodLuckIntroConfig();
  const vars = {
    '--gli-dim': String(c.dimOpacity),
    '--gli-size': String(c.textSize || GLI_DEFAULTS.textSize),
  } as CSSProperties;

  return (
    // A click anywhere skips. No cursor rule here: the game's gauntlet (body default) stays in charge.
    <div className="gli" style={vars} onPointerDown={() => goodLuckIntro.end()} role="presentation" key={seq}>
      <div className="gli-dim" ref={dimRef} />
      <div className="gli-stage" ref={stageRef}>
        <div className="gli-row">
          <div className="gli-flour gli-flour-l"><div className="gli-flour-in" ref={flourLRef}><Flourish /></div></div>
          <div className="gli-word" ref={wordRef}>
            <span className="gli-text">Good Luck</span>
            <span className="gli-shine" ref={shineRef} aria-hidden="true">
              <span className="gli-shine-text" ref={shineTextRef}>Good Luck</span>
            </span>
          </div>
          <div className="gli-flour gli-flour-r"><div className="gli-flour-in" ref={flourRRef}><Flourish /></div></div>
        </div>
      </div>
    </div>
  );
}
