import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RunState } from '@game/sim';
import { useGame } from '../store';
import { canPlayDefs, playDef } from '../fx/playDef';
import { wipeFx } from '../wipeFx';
import { wipeAspect, wipeCoverEllipse, wipeFrontScale } from '../wipeGeometry';
import { getAncientsConfig } from './ancientsConfig';
import { getAwakenStage, prefersReducedMotion, setAwakenStage, useAwakenStage, useGateDemo, useRingSettledSeq } from './ancientsFx';
import { duckForAwakening, playCue, warmAncientCues } from './ancientsSound';

/**
 * THE AWAKENING (owner 2026-09-25: "ominous exciting when the hero power erupts. it should be a moment that the player
 * is so excited for. delay the discover, and make the discover animation unique to the ancients in timing, sound and
 * appearance"). A sealed power breaking open, in five beats — every length a ✦ Ancients tuner dial, every sound a
 * named cue:
 *
 *   OMEN      the world holds its breath: music + other sounds duck, a low rumble swells, the screen's edges darken,
 *             arcane glyphs flicker around the hero power and embers drift up from it (`omenRumble`).
 *   ERUPTION  a deep boom and a violet/gold flash from the hero power, the burst def's shockwave, a column of light
 *             shooting upward, and the violet curtain blooming out in the go-to-combat wipe's language (the wipe's
 *             aspect-stretched ellipse, its seam ring — here carrying runes — and `wipeFx` stardust) (`eruptionBoom`,
 *             `eruptionFlash`).
 *   TITLE     "An Ancient Awakens" rises in the centre and HOLDS (`titleSting`).
 *   REVEAL    the curtain fades onto the Discover view's backdrop and the offer runs its OWN emergence
 *             (`AncientOffer`: one Ancient at a time out of a flash of its colour, `cardReveal` each).
 *   SETTLED   drifting motes behind the cards and a quiet hum under the (still ducked) music (`ambientHum`).
 *   PICK      the gate contracts back into the hero power with inhaling motes (`pickSeal`); the triple trail and the
 *             crack reveal play from `AncientSplit`.
 *
 * The hero-power button and its art NEVER change; every layer here is separate and only emanates from its position.
 * All one-shot WAAPI (transform / opacity, plus the curtain's one-shot clip, like the wipe's). A click steps it
 * forward (omen / eruption / title → reveal; the offer takes reveal → settled). Never under a curtain, in combat or
 * over another decision overlay. Reduced motion: the backdrop and offer fade, the sounds still play.
 */
type Phase = 'idle' | 'omen' | 'eruption' | 'title' | 'reveal' | 'settled' | 'closing';
interface Geo { x: number; y: number; rx: number; ry: number; r: number; hp: number }

const PALETTE = [0xb58cff, 0xffd98a, 0x7fe3d0, 0xffffff, 0xe6ccff] as const;
const EASE = [0.4, 0, 0.2, 1] as const;
/** Small runic marks (24-unit box) for the omen's glyph ring. */
const GLYPHS = [
  'M8 2 V22 M8 7 L16 2 M8 13 L16 8',
  'M12 2 V22 M5 7 L12 12 L19 7',
  'M6 2 V22 M18 2 V22 M6 12 L18 12',
  'M12 2 L20 12 L12 22 L4 12 Z',
  'M6 22 L12 2 L18 22 M8 15 H16',
  'M12 2 V22 M4 9 L20 15 M20 9 L4 15',
];
const N_GLYPHS = 10;
const N_EMBERS = 18;

function hpBox(): { x: number; y: number; w: number } {
  const el = document.querySelector('.statusbar .heropanel .heropowerbtn');
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } : { x: window.innerWidth * 0.2, y: window.innerHeight * 0.55, w: 110 };
}
// Presentation-only jitter (Math.random is banned in core/content/sim, not here).
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export const AncientGate = memo(function AncientGate({ run }: { run: RunState }) {
  const anc = run.ancientsEnabled ? run.ancients : undefined;
  const offerSeq = anc?.offerSeq ?? 0;
  const offerOpen = !!anc?.offer?.length;
  const settled = useRingSettledSeq();
  const demo = useGateDemo();
  const stage = useAwakenStage();
  const wipeIdle = useGame((s) => s.wipeIdle);
  const combatStaged = useGame((s) => s.combatStaged);
  const otherModal = !!(run.discover || run.questOffer || run.powerOffer || run.runeforgeOffer || run.pendingTarget || run.chooseOne || run.scoutedNextOpponent?.length);
  const blocked = run.phase !== 'recruit' || !wipeIdle || combatStaged || otherModal;

  const [phase, setPhase] = useState<Phase>('idle');
  const [geo, setGeo] = useState<Geo | null>(null);
  const bgRef = useRef<HTMLDivElement | null>(null);
  const curtainRef = useRef<HTMLDivElement | null>(null);
  const frontRef = useRef<HTMLDivElement | null>(null);
  const runesRef = useRef<HTMLDivElement | null>(null);
  const omenRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const seqRef = useRef(0);
  const rumble = useRef<{ stop: (ms?: number) => void } | null>(null);
  const hum = useRef<{ stop: (ms?: number) => void } | null>(null);
  const clearTimers = (): void => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; };
  const go = useCallback((p: Phase, seq: number) => { setPhase(p); setAwakenStage(p, seq); }, []);
  useEffect(() => { wipeFx.warm(); warmAncientCues(); }, []);
  useEffect(() => () => { clearTimers(); rumble.current?.stop(200); hum.current?.stop(200); duckForAwakening(false); }, []);

  /** REVEAL: the curtain gives way to the offer's own emergence. */
  const toReveal = useCallback((seq: number) => {
    clearTimers();
    rumble.current?.stop(500); rumble.current = null;
    go('reveal', seq);
  }, [go]);

  /** Start the sequence for offer `seq` (< 0: a tuner demo). `fromReveal` jumps straight to the Ancients. */
  const start = useCallback((seq: number, fromReveal = false) => {
    const c = getAncientsConfig();
    const { x, y, w } = hpBox();
    const vw = window.innerWidth, vh = window.innerHeight;
    const { rx, ry } = wipeCoverEllipse(x, y, vw, vh, wipeAspect(vw, vh, 1));
    setGeo({ x, y, rx, ry, r: Math.max(rx, ry), hp: w });
    seqRef.current = seq;
    duckForAwakening(true);
    if (fromReveal || prefersReducedMotion()) {
      if (prefersReducedMotion() && !fromReveal) { playCue('eruptionBoom'); playCue('titleSting', 200); }
      toReveal(seq);
      return;
    }
    go('omen', seq);
    rumble.current = playCue('omenRumble', 0, { fadeInMs: Math.min(600, c.omenMs) });
    wipeFx.charge(x, y, c.omenMs, PALETTE);
    timers.current.push(window.setTimeout(() => {
      go('eruption', seq);
      rumble.current?.stop(900); rumble.current = null;
      playCue('eruptionBoom');
      playCue('eruptionFlash');
      wipeFx.bloom(x, y, rx, ry, c.eruptionMs, EASE, PALETTE);
      if (canPlayDefs()) playDef('ancient-gate-burst', { target: { x, y } }, { scale: c.burstScale });
    }, c.omenMs));
    timers.current.push(window.setTimeout(() => { go('title', seq); playCue('titleSting'); }, c.omenMs + c.eruptionMs));
    timers.current.push(window.setTimeout(() => toReveal(seq), c.omenMs + c.eruptionMs + c.titleHoldMs));
  }, [go, toReveal]);

  // While the awakening is up, the page is in its modal layering (`.app`'s stacking context dissolved, as every Discover
  // does, so the offer sorts above this layer) and the Shop row steps back. Also covers a tuner demo (no run offer).
  useEffect(() => {
    document.body.classList.toggle('ancgate', phase !== 'idle');
    return () => document.body.classList.remove('ancgate');
  }, [phase]);

  // A click steps the cinematic forward: omen / eruption / title → reveal. (The offer handles reveal → settled.)
  useEffect(() => {
    if (phase !== 'omen' && phase !== 'eruption' && phase !== 'title') return;
    const skip = (e: PointerEvent): void => { e.stopPropagation(); toReveal(seqRef.current); };
    window.addEventListener('pointerdown', skip, true);
    return () => window.removeEventListener('pointerdown', skip, true);
  }, [phase, toReveal]);

  // OPEN for a fresh offer once the ring has pinged and nothing else holds the screen.
  useEffect(() => {
    if (!offerOpen || blocked || settled < offerSeq || seqRef.current === offerSeq) return;
    start(offerSeq);
  }, [offerOpen, blocked, settled, offerSeq, start]);

  // SETTLED (reported by the offer once its Ancients have landed): the ambient hum comes in under the music.
  useEffect(() => {
    if (stage.stage === 'settled' && stage.seq === seqRef.current && phase !== 'settled' && phase !== 'closing') {
      setPhase('settled');
      hum.current?.stop(100);
      hum.current = playCue('ambientHum', 0, { loop: true, fadeInMs: 900 });
    }
  }, [stage, phase]);

  const close = useCallback(() => {
    clearTimers();
    rumble.current?.stop(300); rumble.current = null;
    hum.current?.stop(500); hum.current = null;
    playCue('pickSeal');
    setPhase('closing');
    setAwakenStage('closing', seqRef.current);
    const c = getAncientsConfig();
    timers.current.push(window.setTimeout(() => {
      duckForAwakening(false);
      setPhase('idle'); setGeo(null); setAwakenStage('idle', 0); seqRef.current = seqRef.current > 0 ? seqRef.current : 0;
    }, prefersReducedMotion() ? 160 : c.closeMs));
  }, []);
  // The real offer answered → close. A demo's pick asks for it through the stage.
  useEffect(() => {
    if (seqRef.current > 0 && !offerOpen && phase !== 'idle' && phase !== 'closing') close();
  }, [offerOpen, phase, close]);
  useEffect(() => {
    if (stage.stage === 'closing' && phase !== 'closing' && phase !== 'idle') close();
  }, [stage, phase, close]);
  // Never over a fight or a curtain.
  useEffect(() => {
    if (run.phase !== 'recruit' && phase !== 'idle') {
      clearTimers(); rumble.current?.stop(150); hum.current?.stop(150); duckForAwakening(false);
      setPhase('idle'); setGeo(null); setAwakenStage('idle', 0);
    }
  }, [run.phase, phase]);

  // The tuner's ▶ Play full sequence / ▶ Play from reveal.
  useEffect(() => {
    if (!demo || blocked || offerOpen) return;
    start(-demo.seq, demo.mode === 'reveal');
    // Auto-close a demo that nobody picks from, after a while.
    const t = window.setTimeout(() => { if (getAwakenStage().seq === -demo.seq) setAwakenStage('closing', -demo.seq); }, 14000);
    return () => window.clearTimeout(t);
  }, [demo, blocked, offerOpen, start]);

  // One-shot animations per beat, before paint.
  useLayoutEffect(() => {
    const c = getAncientsConfig();
    const reduced = prefersReducedMotion();
    if (!geo) return;
    const bg = bgRef.current, curtain = curtainRef.current, front = frontRef.current, runes = runesRef.current;
    const ease = `cubic-bezier(${EASE.join(', ')})`;
    const ell = (k: number): string => `ellipse(${Math.max(0, geo.rx * k)}px ${Math.max(0, geo.ry * k)}px at ${geo.x}px ${geo.y}px)`;
    if (phase === 'omen') {
      const om = omenRef.current;
      om?.querySelector('.anc-omen-vignette')?.animate([{ opacity: 0 }, { opacity: c.omenDark }], { duration: c.omenMs, easing: 'ease-in', fill: 'forwards' });
      om?.querySelectorAll<HTMLElement>('.anc-omen-glyph').forEach((g) => {
        const d = rnd(0, c.omenMs * 0.55);
        g.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0.25, offset: 0.3 }, { opacity: 1, offset: 0.45 }, { opacity: 0.4, offset: 0.7 }, { opacity: 0.9, offset: 0.85 }, { opacity: 0 }],
          { duration: Math.max(200, c.omenMs - d), delay: d, fill: 'both' });
      });
      om?.querySelectorAll<HTMLElement>('.anc-omen-ember').forEach((e) => {
        const d = rnd(0, c.omenMs * 0.6);
        e.animate([{ opacity: 0, transform: 'translate(-50%, -50%)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: `translate(calc(-50% + ${rnd(-30, 30)}px), calc(-50% - ${rnd(110, 240)}px))` }],
          { duration: rnd(700, 1200), delay: d, easing: 'ease-out', fill: 'both' });
      });
    } else if (phase === 'eruption') {
      omenRef.current?.querySelector('.anc-omen-vignette')?.animate([{ opacity: c.omenDark }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
      flashRef.current?.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.3)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.18 }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' }],
        { duration: 520, easing: 'ease-out', fill: 'forwards' });
      if (c.columnMs > 0) {
        columnRef.current?.animate([{ opacity: 0, transform: 'translateX(-50%) scaleY(0)' }, { opacity: 1, transform: 'translateX(-50%) scaleY(1)', offset: 0.25 }, { opacity: 0, transform: 'translateX(-50%) scaleY(1.05) scaleX(0.4)' }],
          { duration: c.columnMs, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' });
      }
      curtain?.animate([{ clipPath: ell(0) }, { clipPath: ell(1) }], { duration: c.eruptionMs, easing: ease, fill: 'forwards' });
      // The backdrop rides the curtain's own ellipse, so nothing leads the seam.
      bg?.animate([{ clipPath: ell(0) }, { clipPath: ell(1) }], { duration: c.eruptionMs, easing: ease, fill: 'forwards' });
      const sx = wipeFrontScale(geo.rx), sy = wipeFrontScale(geo.ry);
      for (const el of [front, runes]) {
        el?.animate([
          { transform: 'scale(0.004) rotate(0deg)', opacity: c.seamGlow },
          { transform: `scale(${sx}, ${sy}) rotate(40deg)`, opacity: c.seamGlow, offset: 0.85 },
          { transform: `scale(${sx}, ${sy}) rotate(46deg)`, opacity: 0 },
        ], { duration: c.eruptionMs, easing: ease, fill: 'forwards' });
      }
    } else if (phase === 'reveal') {
      if (bg) bg.style.clipPath = 'none';
      if (reduced) { bg?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'forwards' }); }
      if (curtain) {
        curtain.getAnimations().forEach((a) => a.finish());
        curtain.animate([{ opacity: 1 }, { opacity: 0 }], { duration: c.revealFadeMs, easing: 'ease-out', fill: 'forwards' });
        curtain.querySelector('.anc-gate-title')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
      }
    } else if (phase === 'closing') {
      if (reduced) { bg?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }); return; }
      bg?.animate([{ clipPath: ell(1) }, { clipPath: ell(0) }], { duration: c.closeMs, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)', fill: 'forwards' });
      wipeFx.inhale(geo.x, geo.y, geo.r, c.closeMs, PALETTE);
    }
  }, [phase, geo]);

  // Ember starts, fixed per awakening (not per render, so nothing jumps between beats).
  const embers = useMemo(() => (geo ? Array.from({ length: N_EMBERS }, () => ({ left: geo.x + rnd(-geo.hp * 0.45, geo.hp * 0.45), top: geo.y + rnd(-geo.hp * 0.2, geo.hp * 0.35) })) : []), [geo]);
  if (!geo || phase === 'idle') return null;
  const reduced = prefersReducedMotion();
  const curtainOn = !reduced && (phase === 'eruption' || phase === 'title' || phase === 'reveal');
  const ring = geo.hp * 0.85;
  return createPortal(
    <div className="anc-gate" aria-hidden="true" style={{ '--gx': `${geo.x}px`, '--gy': `${geo.y}px` } as CSSProperties}>
      {/* The Discover view's backdrop: what the awakening ends on, under the offer. */}
      {phase !== 'omen' && (
        <div ref={bgRef} className="anc-gate-bg" style={reduced || phase === 'reveal' || phase === 'settled' ? (reduced ? { opacity: 0 } : undefined) : { clipPath: `ellipse(0px 0px at ${geo.x}px ${geo.y}px)` }} />
      )}
      {/* OMEN: darkening edges, glyphs flickering around the hero power, embers drifting up from it. */}
      {(phase === 'omen' || phase === 'eruption') && !reduced && (
        <div ref={omenRef} className="anc-omen">
          <div className="anc-omen-vignette" />
          {Array.from({ length: N_GLYPHS }, (_, i) => {
            const a = (i / N_GLYPHS) * Math.PI * 2 - Math.PI / 2;
            return (
              <svg key={`g${i}`} className="anc-omen-glyph" viewBox="0 0 24 24" style={{ left: geo.x + Math.cos(a) * ring, top: geo.y + Math.sin(a) * ring }}>
                <path d={GLYPHS[i % GLYPHS.length]} />
              </svg>
            );
          })}
          {embers.map((e, i) => <span key={`e${i}`} className="anc-omen-ember" style={{ left: e.left, top: e.top }} />)}
        </div>
      )}
      {/* ERUPTION: the flash + the column of light, from the hero power. */}
      {phase === 'eruption' && !reduced && (
        <>
          <div ref={flashRef} className="anc-erupt-flash" style={{ left: geo.x, top: geo.y }} />
          <div ref={columnRef} className="anc-erupt-column" style={{ left: geo.x, height: geo.y }} />
        </>
      )}
      {curtainOn && (
        <div ref={curtainRef} className="anc-gate-curtain" style={phase === 'reveal' ? undefined : { clipPath: `ellipse(0px 0px at ${geo.x}px ${geo.y}px)` }}>
          <div className={`anc-gate-title${phase === 'title' || phase === 'reveal' ? ' in' : ''}`}>
            <span className="anc-gate-label">An Ancient Awakens</span>
          </div>
        </div>
      )}
      {phase === 'eruption' && !reduced && (
        <>
          <div ref={frontRef} className="anc-gate-front" />
          <div ref={runesRef} className="anc-gate-runes">
            <svg viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="482" /></svg>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
});
