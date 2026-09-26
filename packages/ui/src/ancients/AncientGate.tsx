import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RunState } from '@game/sim';
import { useGame } from '../store';
import { playTailedClip } from '../sfx';
import { canPlayDefs, playDef } from '../fx/playDef';
import { wipeFx } from '../wipeFx';
import { wipeAspect, wipeCoverEllipse, wipeFrontScale } from '../wipeGeometry';
import { getAncientsConfig } from './ancientsConfig';
import { markGateOpen, prefersReducedMotion, useGateDemo, useRingSettledSeq, setGateActive } from './ancientsFx';

/**
 * THE GATE (owner 2026-09-25: "make it feel like the hero power … exploded and opened this gate to the ancients",
 * then "make the hero power explosion thing look more like our go to combat animation except give it this ancient
 * vibe"). The go-to-combat SCREEN WIPE's language (Recruit's curtain + `.wipefront` ring + `wipeFx` motes), in a
 * shorter, gentler cut that ORIGINATES FROM THE HERO POWER and wears a mystic violet / gold / teal palette:
 *
 *   1. CHARGE  motes spiral INTO the hero power (`wipeFx.charge`). The button and its art NEVER change (owner:
 *              "the hero power's art should not pop or grow or change"); everything is a separate layer.
 *   2. BLOOM   a violet curtain blooms out of it as an ellipse sized from the LIVE viewport (`wipeCoverEllipse` +
 *              `wipeAspect`, so it reaches an ultrawide's sides with its top and bottom), an energy ring riding the
 *              seam (the wipe's 1000px texture scaled on the compositor), stardust along the seam (`wipeFx.bloom`),
 *              the `ancient-gate-burst` def at the source and the boom cue;
 *   3. TITLE   "An Ancient Awakens" settles in the centre of the curtain (the wipe's "Now Facing" moment);
 *   4. REVEAL  the curtain fades off, leaving EXACTLY the Discover view's backdrop (`--dcl-*`), and the offer rises;
 *   5. CLOSE   on the pick the backdrop's iris contracts back into the hero power while motes stream into it
 *              (`wipeFx.inhale`) and the triple trail lands (`AncientSplit`).
 *
 * All one-shot: WAAPI transform / opacity, and the curtain's one-shot clip (like the wipe's). A click during the
 * charge/bloom/title skips to the reveal. Never under a curtain, in combat or over another decision overlay.
 * Reduced motion: the backdrop fades in and out.
 */
type Phase = 'idle' | 'charging' | 'cover' | 'open' | 'closing';
interface Geo { x: number; y: number; rx: number; ry: number; r: number }

const PALETTE = [0xb58cff, 0xffd98a, 0x7fe3d0, 0xffffff, 0xe6ccff] as const;
const EASE = [0.4, 0, 0.2, 1] as const;

function hpCentre(): { x: number; y: number } {
  const el = document.querySelector('.statusbar .heropanel .heropowerbtn');
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth * 0.2, y: window.innerHeight * 0.55 };
}
function cue(clip: string, gain: number, offsetMs: number): void {
  if (clip && gain > 0) playTailedClip(clip, 'ancientGate', { gain, delayMs: Math.max(0, offsetMs) });
}

export const AncientGate = memo(function AncientGate({ run }: { run: RunState }) {
  const anc = run.ancientsEnabled ? run.ancients : undefined;
  const offerSeq = anc?.offerSeq ?? 0;
  const offerOpen = !!anc?.offer?.length;
  const settled = useRingSettledSeq();
  const demo = useGateDemo();
  const wipeIdle = useGame((s) => s.wipeIdle);
  const combatStaged = useGame((s) => s.combatStaged);
  const otherModal = !!(run.discover || run.questOffer || run.powerOffer || run.runeforgeOffer || run.pendingTarget || run.chooseOne || run.scoutedNextOpponent?.length);
  const blocked = run.phase !== 'recruit' || !wipeIdle || combatStaged || otherModal;

  const [phase, setPhase] = useState<Phase>('idle');
  const [geo, setGeo] = useState<Geo | null>(null);
  const bgRef = useRef<HTMLDivElement | null>(null);
  const curtainRef = useRef<HTMLDivElement | null>(null);
  const frontRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const played = useRef(0);
  const clearTimers = (): void => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; };
  useEffect(() => () => clearTimers(), []);
  useEffect(() => { wipeFx.warm(); }, []);

  const reveal = useCallback((seq: number) => {
    clearTimers();
    setPhase('open');
    markGateOpen(seq);
  }, []);

  /** Charge → bloom → title → reveal. `seq` > 0 is an offer; < 0 a tuner demo. */
  const play = useCallback((seq: number) => {
    const c = getAncientsConfig();
    const { x, y } = hpCentre();
    const vw = window.innerWidth, vh = window.innerHeight;
    const { rx, ry } = wipeCoverEllipse(x, y, vw, vh, wipeAspect(vw, vh, 1));
    setGeo({ x, y, rx, ry, r: Math.max(rx, ry) });
    played.current = seq;
    setGateActive(true);
    if (prefersReducedMotion()) { reveal(seq); return; }
    setPhase('charging');
    wipeFx.charge(x, y, c.gateChargeMs + 80, PALETTE);
    timers.current.push(window.setTimeout(() => {
      setPhase('cover');
      wipeFx.bloom(x, y, rx, ry, c.gateOpenMs, EASE, PALETTE);
      if (canPlayDefs()) playDef('ancient-gate-burst', { target: { x, y } }, { scale: c.gateBurstScale });
      cue(c.gateBoomClip, c.gateBoomGain, c.gateBoomOffset);
      cue(c.gateShimmerClip, c.gateShimmerGain, c.gateShimmerOffset);
    }, c.gateChargeMs));
    timers.current.push(window.setTimeout(() => reveal(seq), c.gateChargeMs + c.gateOpenMs + c.gateHoldMs));
    const skip = (): void => { window.removeEventListener('pointerdown', skip, true); if (played.current === seq) reveal(seq); };
    window.addEventListener('pointerdown', skip, true);
    timers.current.push(window.setTimeout(() => window.removeEventListener('pointerdown', skip, true), c.gateChargeMs + c.gateOpenMs + c.gateHoldMs + 20));
  }, [reveal]);

  useEffect(() => {
    if (!offerOpen || blocked || settled < offerSeq || played.current === offerSeq) return;
    play(offerSeq);
  }, [offerOpen, blocked, settled, offerSeq, play]);

  const close = useCallback(() => {
    clearTimers();
    setPhase('closing');
    const c = getAncientsConfig();
    timers.current.push(window.setTimeout(() => { setPhase('idle'); setGeo(null); setGateActive(false); }, prefersReducedMotion() ? 160 : c.gateCloseMs));
  }, []);
  useEffect(() => {
    if (played.current > 0 && !offerOpen && phase !== 'idle' && phase !== 'closing') close();
  }, [offerOpen, phase, close]);
  useEffect(() => { if (run.phase !== 'recruit' && phase !== 'idle') { clearTimers(); setPhase('idle'); setGeo(null); setGateActive(false); } }, [run.phase, phase]);

  useEffect(() => {
    if (!demo || blocked) return;
    play(-demo.seq);
    const c = getAncientsConfig();
    const t = window.setTimeout(() => close(), c.gateChargeMs + c.gateOpenMs + c.gateHoldMs + 1400);
    return () => window.clearTimeout(t);
  }, [demo, blocked, play, close]);

  // One-shot animations per phase change, before paint.
  useLayoutEffect(() => {
    const c = getAncientsConfig();
    const reduced = prefersReducedMotion();
    const bg = bgRef.current, curtain = curtainRef.current, front = frontRef.current;
    if (!geo) return;
    const ease = `cubic-bezier(${EASE.join(', ')})`;
    const ell = (k: number): string => `ellipse(${Math.max(0, geo.rx * k)}px ${Math.max(0, geo.ry * k)}px at ${geo.x}px ${geo.y}px)`;
    const circ = (r: number): string => `circle(${Math.max(0, r)}px at ${geo.x}px ${geo.y}px)`;
    if (phase === 'cover') {
      curtain?.animate([{ clipPath: ell(0) }, { clipPath: ell(1) }], { duration: c.gateOpenMs, easing: ease, fill: 'forwards' });
      const sx = wipeFrontScale(geo.rx), sy = wipeFrontScale(geo.ry);
      front?.animate([
        { transform: 'scale(0.004)', opacity: c.gateGlow },
        { transform: `scale(${sx}, ${sy})`, opacity: c.gateGlow, offset: 0.85 },
        { transform: `scale(${sx}, ${sy})`, opacity: 0 },
      ], { duration: c.gateOpenMs, easing: ease, fill: 'forwards' });
      bg?.animate([{ clipPath: circ(0) }, { clipPath: circ(geo.r * 1.5) }], { duration: c.gateOpenMs, easing: ease, fill: 'forwards' });
    } else if (phase === 'open') {
      if (reduced) { bg?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' }); return; }
      if (bg) bg.style.clipPath = 'none';
      curtain?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: c.gateRevealMs, easing: 'ease-out', fill: 'forwards' });
      // The curtain's title hands off to the offer's own banner: it goes first, so the two never read through each other.
      curtain?.querySelector('.anc-gate-title')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
    } else if (phase === 'closing') {
      if (reduced) { bg?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }); return; }
      bg?.animate([{ clipPath: circ(geo.r * 1.5) }, { clipPath: circ(0) }], { duration: c.gateCloseMs, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)', fill: 'forwards' });
      wipeFx.inhale(geo.x, geo.y, geo.r, c.gateCloseMs, PALETTE);
    }
  }, [phase, geo]);

  if (!geo || phase === 'idle' || phase === 'charging') return null;
  const reduced = prefersReducedMotion();
  const showCurtain = !reduced && (phase === 'cover' || phase === 'open');
  return createPortal(
    <div className="anc-gate" aria-hidden="true" style={{ '--gx': `${geo.x}px`, '--gy': `${geo.y}px` } as CSSProperties}>
      {/* The Discover view's backdrop: what the gate ends on, under the offer. */}
      <div ref={bgRef} className="anc-gate-bg" style={reduced ? { opacity: 0 } : { clipPath: `circle(0px at ${geo.x}px ${geo.y}px)` }} />
      {showCurtain && (
        <div ref={curtainRef} className="anc-gate-curtain" style={{ clipPath: `ellipse(0px 0px at ${geo.x}px ${geo.y}px)` }}>
          <div className="anc-gate-title">
            <span className="anc-gate-label">An Ancient Awakens</span>
          </div>
        </div>
      )}
      {showCurtain && <div ref={frontRef} className="anc-gate-front" />}
    </div>,
    document.body,
  );
});
