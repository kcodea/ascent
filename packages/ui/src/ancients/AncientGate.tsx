import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RunState } from '@game/sim';
import { useGame } from '../store';
import { playTailedClip } from '../sfx';
import { canPlayDefs, playDef } from '../fx/playDef';
import { getAncientsConfig } from './ancientsConfig';
import { markGateOpen, prefersReducedMotion, useGateDemo, useRingSettledSeq, setGateActive } from './ancientsFx';

/**
 * THE GATE (owner 2026-09-25: "make it feel like the hero power opens up this view … almost like the hero power
 * exploded and opened this gate to the ancients"). A smaller, faster cousin of the combat/shop screen wipe that
 * ORIGINATES FROM THE HERO POWER, played between the meter's full-ring ping (kept as-is) and the offer:
 *
 *   1. CHARGE  the hero-power button swells (WAAPI `scale`, which composes with its own transform);
 *   2. BURST   it snaps back as the `ancient-gate-burst` Pixi def fires from it (a gold/violet shockwave + sparks),
 *              with a quick screen flash and the boom cue;
 *   3. OPEN    a luminous iris grows from the hero power: a tinted, semi-transparent backdrop revealed by an expanding
 *              `clip-path: circle()` (sized from the LIVE viewport's farthest corner, so ultrawide is covered) with a
 *              soft glowing ring riding its edge (transform + opacity). The board stays faintly visible. The offer is
 *              released a beat into the opening (`markGateOpen`), so the cards rise out of the gate;
 *   4. CLOSE   when the offer is answered, the iris contracts back INTO the hero power (the triple trail and the crack
 *              reveal play from `AncientSplit`).
 *
 * Every step is one-shot (WAAPI, transform/opacity; the iris is a one-shot clip-path, like the wipe's). A click during
 * the charge/burst skips to the open gate. Never plays under a curtain or in combat, nor over another decision
 * overlay (it waits, like the offer). Reduced motion: the backdrop simply fades in and out.
 */
type Phase = 'idle' | 'charging' | 'open' | 'closing';
interface Geo { x: number; y: number; r: number }

function hpCentre(): { x: number; y: number } {
  const el = document.querySelector('.statusbar .heropanel .heropowerbtn');
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth * 0.2, y: window.innerHeight * 0.55 };
}
function coverRadius(x: number, y: number): number {
  return Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 40;
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
  const ringRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const played = useRef(0); // the offerSeq (or demo seq, negated) the gate last opened for
  const clearTimers = (): void => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; };
  useEffect(() => () => clearTimers(), []);

  const reveal = useCallback((seq: number) => {
    clearTimers();
    setPhase('open');
    markGateOpen(seq);
  }, []);

  /** Charge → burst → open. `seq` > 0 is an offer; < 0 a tuner demo. */
  const play = useCallback((seq: number) => {
    const c = getAncientsConfig();
    const { x, y } = hpCentre();
    setGeo({ x, y, r: coverRadius(x, y) });
    played.current = seq;
    setGateActive(true);
    if (prefersReducedMotion()) { reveal(seq); return; }
    setPhase('charging');
    const btn = document.querySelector<HTMLElement>('.statusbar .heropanel .heropowerbtn');
    if (btn && typeof btn.animate === 'function') {
      btn.animate([{ scale: '1' }, { scale: String(c.gateChargeScale) }], { duration: c.gateChargeMs, easing: 'cubic-bezier(0.3, 0, 0.7, 1)' });
      btn.animate([{ scale: String(c.gateChargeScale) }, { scale: '1' }], { duration: 180, delay: c.gateChargeMs, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.4)', fill: 'backwards' });
    }
    timers.current.push(window.setTimeout(() => {
      if (canPlayDefs()) playDef('ancient-gate-burst', { target: { x, y } }, { scale: c.gateBurstScale });
      cue(c.gateBoomClip, c.gateBoomGain, c.gateBoomOffset);
      cue(c.gateShimmerClip, c.gateShimmerGain, c.gateShimmerOffset);
      reveal(seq);
    }, c.gateChargeMs));
    // A click during the charge skips straight to the open gate.
    const skip = (): void => { window.removeEventListener('pointerdown', skip, true); if (played.current === seq) reveal(seq); };
    window.addEventListener('pointerdown', skip, true);
    timers.current.push(window.setTimeout(() => window.removeEventListener('pointerdown', skip, true), c.gateChargeMs + 20));
  }, [reveal]);

  // OPEN for a fresh offer, once the ring has pinged and nothing else holds the screen.
  useEffect(() => {
    if (!offerOpen || blocked || settled < offerSeq || played.current === offerSeq) return;
    play(offerSeq);
  }, [offerOpen, blocked, settled, offerSeq, play]);

  // CLOSE when the offer is answered (or a demo runs out).
  const close = useCallback(() => {
    clearTimers();
    setPhase('closing');
    const c = getAncientsConfig();
    timers.current.push(window.setTimeout(() => { setPhase('idle'); setGeo(null); setGateActive(false); }, prefersReducedMotion() ? 160 : c.gateCloseMs));
  }, []);
  useEffect(() => {
    if (played.current > 0 && !offerOpen && (phase === 'open' || phase === 'charging')) close();
  }, [offerOpen, phase, close]);
  // Never over a fight or a curtain: a gate caught by a phase change just goes.
  useEffect(() => { if (run.phase !== 'recruit' && phase !== 'idle') { clearTimers(); setPhase('idle'); setGeo(null); setGateActive(false); } }, [run.phase, phase]);

  // The tuner's ▶ Play gate: open, hold, close — no run state involved.
  useEffect(() => {
    if (!demo || blocked) return;
    play(-demo.seq);
    const t = window.setTimeout(() => close(), getAncientsConfig().gateChargeMs + getAncientsConfig().gateOpenMs + 1400);
    return () => window.clearTimeout(t);
  }, [demo, blocked, play, close]);

  // The iris + ring + flash, one-shot per phase change (before paint, so nothing flashes at rest).
  useLayoutEffect(() => {
    const c = getAncientsConfig();
    const reduced = prefersReducedMotion();
    const bg = bgRef.current, ring = ringRef.current, flash = flashRef.current;
    if (!geo || !bg) return;
    const at = (r: number): string => `circle(${Math.max(0, r)}px at ${geo.x}px ${geo.y}px)`;
    const ease = 'cubic-bezier(0.22, 0.8, 0.26, 1)';
    if (phase === 'open') {
      if (reduced) { bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' }); return; }
      bg.animate([{ clipPath: at(0) }, { clipPath: at(geo.r) }], { duration: c.gateOpenMs, easing: ease, fill: 'forwards' });
      ring?.animate([{ transform: 'translate(-50%, -50%) scale(0.02)', opacity: c.gateGlow }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }], { duration: c.gateOpenMs, easing: ease, fill: 'forwards' });
      if (c.gateFlash > 0) flash?.animate([{ opacity: 0 }, { opacity: c.gateFlash, offset: 0.25 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
    } else if (phase === 'closing') {
      if (reduced) { bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }); return; }
      bg.animate([{ clipPath: at(geo.r) }, { clipPath: at(0) }], { duration: c.gateCloseMs, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)', fill: 'forwards' });
      ring?.animate([{ transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(0.02)', opacity: c.gateGlow }], { duration: c.gateCloseMs, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)', fill: 'forwards' });
    }
  }, [phase, geo]);

  if (!geo || phase === 'idle' || phase === 'charging') return null;
  const c = getAncientsConfig();
  return createPortal(
    <div className="anc-gate" aria-hidden="true"
      style={{ '--gx': `${geo.x}px`, '--gy': `${geo.y}px`, '--gate-dim': String(c.gateDim), '--gate-tint': String(c.gateTint), '--gate-d': `${geo.r * 2}px` } as CSSProperties}>
      <div ref={bgRef} className="anc-gate-bg" style={prefersReducedMotion() ? { opacity: 0 } : { clipPath: `circle(0px at ${geo.x}px ${geo.y}px)` }} />
      <div ref={ringRef} className="anc-gate-ring" />
      <div ref={flashRef} className="anc-gate-flash" />
    </div>,
    document.body,
  );
});
