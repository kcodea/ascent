import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useGame } from '../store';
import { canPlayDefs, playDef } from '../fx/playDef';
import { playTailedClip, sfx, type SfxHandle } from '../sfx';
import { locationOfSet } from '../locationReveal/locations';
import { REVEAL_FLIGHT_WHOOSH, REVEAL_LOCK_SHIMMER } from '../lobbyReveal/lobbyRevealConfig';
import { goodLuckIntro, useGoodLuckIntroActive, useGoodLuckIntroSeq } from './goodLuckIntroStore';
import { useLobbyRevealActive } from '../lobbyReveal/lobbyRevealStore';
import { GLI_DEFAULTS, GLI_FADE_MS, GLI_REPLAY_EVENT, getGoodLuckIntroConfig, goodLuckTail, goodLuckTimeline } from './goodLuckIntroConfig';
import { glyphPoints, LuckStar, passAt, type LuckScene, type LuckTimes, type Pt } from './luckStar';
import './goodLuckIntro.css';

/**
 * THE "GOOD LUCK" INTRO: the overlay (owner ask 2026-09-24; remade 2026-11-24, R-GOODLUCK-STAR-01).
 *
 * Mounted once in Game, just under the launch curtain. It renders nothing until `goodLuckIntro.begin()` (the curtain calls it right
 * after `pickHero` builds a lobby / Practice run), waits behind the lobby reveal, then plays ONE pass:
 *
 *   a comet of the location's magic leaves the player's hero in one arc  ->  crosses the board, setting "Good Luck" alight letter by
 *   letter  ->  turns under the words and draws a line of light there; they hold  ->  they come apart into dust that streams into
 *   the End Turn crystal: end.
 *
 * `end()` releases the shop clock (Recruit's countdown gate reads the same store), so the turn starts at full time as the light
 * reaches the crystal that counts it. UNSKIPPABLE (owner 2026-10-31: "make the start game text unskippable"): a click or Esc does nothing
 * while it plays (Esc is swallowed so the menu does not open under it). It is short.
 *
 * Perf contract: every DOM animation is transform / opacity on a composited layer, ONE a letter, scheduled up front through WAAPI, so
 * there is no per-frame JS for the words; the comet's canvas is drawn from the time alone (luckStar.ts). Layout is
 * read exactly once per play.
 */

/** The committed `good-luck-intro` def's authored spark count; the tuner's count becomes an `intensity` multiplier on it. */
const DEF_SPARKS = 70;
const WORDS = 'Good Luck';
const LETTERS = [...WORDS].map((ch, i) => ({ ch, gap: WORDS[i - 1] === ' ' })).filter((l) => l.ch !== ' ');
/** How much the words have grown by the time they go (a slow push in), and how many motes of dust they are made of. */
const GROWN = 1.03;
const MOTES = 1700;

function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** WAAPI when available; jsdom (tests) has none, and the intro still ends on its timer there. */
function anim(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  (el as HTMLElement).animate(frames, opts);
}
/** Offsets in order, whatever the tuner does to the beats (out of order they throw). */
function inOrder(frames: Keyframe[]): Keyframe[] {
  let last = 0;
  return frames.map((f) => { last = Math.min(1, Math.max(last, f.offset ?? last)); return { ...f, offset: last }; });
}

/** One ornamental arm: a filigree line with a scroll curl at its outer end and a double chevron pointing in
 *  at the words. Drawn for the LEFT side; the right arm is the same art mirrored by its wrapper. Worn by the Discover /
 *  Choose One title banner (`discoverEntrance/OfferBanner.tsx`). */
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
  // THE LOBBY REVEAL (owner 2026-10-31: "the start game text should happen after the animation is complete"): while the
  // heroes are shown and fly to the rail, the words wait (and the shop clock with them: this store stays active). They
  // then play over a board the reveal has already brought back to light, so their dim fades IN instead of standing.
  const revealing = useLobbyRevealActive();
  const afterReveal = useRef(false);
  const seenSeq = useRef(-1);
  if (seenSeq.current !== seq) { seenSeq.current = seq; afterReveal.current = false; }
  if (active && revealing) afterReveal.current = true;
  const waiting = active && revealing;

  const dimRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wordRef = useRef<HTMLDivElement | null>(null);
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const hotRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // The comet, made as soon as there is an intro to play (behind the lobby reveal), so it is ready when the words are.
  const starRef = useRef<{ seq: number; star: LuckStar | null } | null>(null);
  useEffect(() => {
    if (!active) return;
    const star = LuckStar.make(locationOfSet(useGame.getState().run?.setId ?? 'set1'));
    starRef.current = { seq, star };
    return () => { if (!star?.flying) star?.destroy(); if (starRef.current?.star === star) starRef.current = null; };
  }, [active, seq]);

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

  // Unskippable: Esc is swallowed (capture phase + stopPropagation) so it neither ends the words nor opens the Esc menu
  // underneath. Leaving to the title (above) and a dev replay are the only early ends.
  useEffect(() => {
    if (!active || waiting) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, waiting]);

  // THE ONE PASS. Layout effect so every animation is scheduled before the overlay's first paint (the words must
  // never flash at full opacity for a frame). Keyed on `seq` so a replay restarts it cleanly.
  useLayoutEffect(() => {
    if (!active || waiting) return;
    const c = getGoodLuckIntroConfig();
    const reduced = prefersReducedMotion();
    const t = goodLuckTimeline(c, reduced);
    const timers: number[] = [];
    // The sounds are queued up front on the AUDIO clock (like the WAAPI animations), so they cannot drift from the picture. Each ends
    // on its own soft tail. An early end (replay / leaving) fades whatever is still sounding; the natural end lets them ring out.
    const sounds: (SfxHandle | null)[] = [];
    let endedNaturally = false;
    let star: LuckStar | null = null;

    sounds.push(sfx.goodLuckShine(c.shineSoundGain, t.shineSoundAt, goodLuckTail(c, 'shine')));
    if (afterReveal.current) anim(dimRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: GLI_FADE_MS, delay: t.inAt, easing: 'ease-out', fill: 'backwards' });
    anim(dimRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: t.endAt - t.outAt, delay: t.outAt, easing: 'ease-in', fill: 'forwards' });

    if (reduced) {
      for (const el of letterRefs.current) if (el) el.style.opacity = '1';
      anim(stageRef.current, [{ opacity: 0, easing: 'ease-out' }, { opacity: 1, offset: GLI_FADE_MS / (t.endAt - t.inAt) }, { opacity: 1, offset: 1 - GLI_FADE_MS / (t.endAt - t.inAt), easing: 'ease-in' }, { opacity: 0 }],
        { duration: t.endAt - t.inAt, delay: t.inAt, fill: 'both' });
    } else {
      const s = (ms: number): number => (ms - t.inAt) / 1000;
      const times: LuckTimes = { write: s(t.writeAt), burst: s(t.shineAt), gather: s(t.outAt), dive: s(t.diveAt), land: s(t.endAt) };
      const centre = (el: Element | null): Pt | null => { const r = el?.getBoundingClientRect(); return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
      // The one layout read: the letters' places, the hero, the crystal.
      const n = LETTERS.length;
      const spots = letterRefs.current.slice(0, n).map((el) => centre(el) ?? { x: innerWidth / 2, y: innerHeight / 2 });
      const mid = { x: innerWidth / 2, y: (spots[0]?.y ?? innerHeight / 2) };
      const size = wordRef.current?.offsetHeight ?? 130;
      const from = centre(document.querySelector('.statusrow .hero .heroimg')) ?? { x: innerWidth * 0.1, y: innerHeight * 0.8 };
      const to = centre(document.querySelector('.etbwrap .etb-gembox') ?? document.querySelector('.etbwrap')) ?? { x: innerWidth * 0.9, y: innerHeight * 0.5 };
      const scene: LuckScene = {
        from, to, letters: spots, burst: { x: mid.x, y: mid.y + size * 0.62 }, times, grown: GROWN,
        glyphs: starRef.current?.seq === seq || !afterReveal.current ? glyphPoints(letterRefs.current.slice(0, n).filter((el): el is HTMLSpanElement => el !== null), MOTES) : new Float32Array(0),
      };
      anim(stageRef.current, [{ transform: 'scale(1)' }, { transform: `scale(${GROWN})` }], { duration: t.outAt - t.writeAt, delay: t.writeAt, easing: 'linear', fill: 'both' });

      // Each letter's whole life is ONE animation (two on one property are run by the page): alight as the comet passes, settling; and
      // gone to dust, the side nearest the crystal first.
      for (let i = 0; i < n; i++) {
        const at = t.inAt + passAt(scene, spots[i]!.x) * 1000 - 30;
        const go = t.outAt + 40 + (n - 1 - i) * 20;
        const span = go + 190 - at;
        const o = (ms: number): number => Math.min(1, Math.max(0, (ms - at) / span));
        anim(letterRefs.current[i] ?? null, inOrder([
          { opacity: 0, transform: 'translate(0, 0) scale(1.26)', offset: 0, easing: 'ease-out' },
          { opacity: 1, transform: 'translate(0, 0) scale(1.15)', offset: o(at + 90), easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
          { opacity: 1, transform: 'translate(0, 0) scale(1)', offset: o(at + 620) },
          { opacity: 1, transform: 'translate(0, 0) scale(1)', offset: o(go) },
          { opacity: 0, transform: 'translate(0.05em, -0.02em) scale(1.02)', offset: 1 },
        ]), { duration: span, delay: at, fill: 'both' });
        // Its light: white hot, cooling to the gold; a breath of it as the line is drawn under the words; and again as it goes.
        anim(hotRefs.current[i] ?? null, inOrder([
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: o(at + 90), easing: 'ease-out' },
          { opacity: 0, offset: o(Math.min(at + 620, t.shineAt)) },
          { opacity: 0, offset: o(Math.max(at + 621, t.shineAt - 60)), easing: 'ease-out' },
          { opacity: 0.45, offset: o(Math.max(at + 640, t.shineAt + 60)), easing: 'ease-in-out' },
          { opacity: 0, offset: o(Math.max(at + 900, t.shineAt + 420)) },
          { opacity: 0, offset: o(go - 60), easing: 'ease-in' },
          { opacity: 1, offset: 1 },
        ]), { duration: span, delay: at, fill: 'both' });
      }
      const clip = (l: { clip: string }, gain: number, delayMs: number, rate: number, fadeOutMs: number, reverbMix: number): void => { sounds.push(playTailedClip(l.clip, 'ceremony', { gain, delayMs: Math.max(0, delayMs), rate, tail: { fadeOutMs, reverbMix, reverbSec: 0.9 } })); };
      clip(REVEAL_FLIGHT_WHOOSH, c.whooshSoundGain, t.inAt, 0.9, 260, 0.1);
      clip(REVEAL_FLIGHT_WHOOSH, c.whooshSoundGain, t.diveAt - 120, 1, 200, 0.1);
      clip(REVEAL_LOCK_SHIMMER, c.landSoundGain, t.endAt, 1, 400, 0.25);
      sounds.push(sfx.goodLuckSpark(c.sparkSoundGain, t.sparkAt, goodLuckTail(c, 'spark')));

      const t0 = performance.now() + t.inAt;
      timers.push(window.setTimeout(() => {
        const made = starRef.current?.seq === seq ? starRef.current.star : null;
        if (made?.ok) { star = made; made.play(scene, t0); } else made?.destroy();
      }, Math.max(0, t.inAt - 40)));
      // Where the star cannot be drawn the burst still throws the authored sparks.
      if (c.sparkCount > 0) {
        timers.push(window.setTimeout(() => {
          if (star || !canPlayDefs()) return;
          playDef('good-luck-intro', { source: mid, target: mid, cursor: mid }, { intensity: c.sparkCount / DEF_SPARKS });
        }, t.shineAt));
      }
      // The crystal takes it: a nudge of the whole button as it lands (the light is the canvas's).
      timers.push(window.setTimeout(() => {
        anim(document.querySelector('.etbwrap .etb-gembox'), [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: 460, easing: 'ease-out', composite: 'add' });
      }, t.endAt - 10));
    }

    timers.push(window.setTimeout(() => { endedNaturally = true; goodLuckIntro.end(); }, t.endAt));
    return () => {
      if (endedNaturally) return; // what is left (the landing's light, the crystal's nudge, the tails) plays out over the live board
      for (const id of timers) window.clearTimeout(id);
      for (const h of sounds) h?.stop();
      star?.destroy();
    };
  }, [active, seq, waiting]);

  if (!active || waiting) return null;
  const c = getGoodLuckIntroConfig();
  const vars = {
    '--gli-dim': String(c.dimOpacity),
    '--gli-size': String(c.textSize || GLI_DEFAULTS.textSize),
  } as CSSProperties;

  return (
    // Clicks land on this layer and do nothing (the words are unskippable). No cursor rule here: the game's gauntlet
    // (body default) stays in charge.
    <div className="gli" style={vars} role="presentation" key={seq}>
      <div className="gli-dim" ref={dimRef} />
      <div className="gli-stage" ref={stageRef}>
        <div className="gli-word" ref={wordRef} aria-label={WORDS}>
          {LETTERS.map(({ ch, gap }, i) => (
            <span key={i} className={`gli-g${gap ? ' gap' : ''}`} ref={(el) => { letterRefs.current[i] = el; }} aria-hidden="true">
              {ch}
              <span className="gli-gold">{ch}</span>
              <span className="gli-hot" ref={(el) => { hotRefs.current[i] = el; }}>{ch}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
