import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { type AncientId, type RunState } from '@game/sim';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { canPlayDefs, playDef } from '../fx/playDef';
import { getDef } from '../fx/fxDefs';
import { gildArrivalMs } from '../gildTrailSources';
import { AncientFace } from './AncientFace';
import { AncientPreview, useAncientCycler, type PreviewAnchor } from './AncientPreview';
import { getAncientsConfig, subscribeAncientsConfig, type AncientsConfig } from './ancientsConfig';
import { markRingSettled, prefersReducedMotion, takePickSource, tickAllowed, useAwakenDemo } from './ancientsFx';
import './ancients.css';

/**
 * THE ANCIENTS METER + the AWAKENED hero power (proof of concept, owner rulings 2026-09-25 + the first-playable
 * direction: "fill the meter not deplete it", "cleaner and more minimalistic", "1 gradient bar not chunks").
 *
 * ── The meter ─────────────────────────────────────────────────────────────────────────────────────────────────
 * ONE thin continuous gradient arc around the hero-power button, filling clockwise from 12 o'clock over a faint
 * track, with a small "7/16" readout at its lower right. The SIM owns the number (`run.ancients.points`); this
 * only PRESENTS it, lagging the real value so each gain reads:
 *  · a refresh's point sweeps in as the refresh happens;
 *  · a combat's two sweep in on the return to the Shop, AFTER the wipe (the displayed value waits for the curtain);
 *  · a sweep is ONE eased `stroke-dashoffset` transition per change (one-shot, never looped), with a gap-gated tick;
 *  · at full the ring flashes once, and only then may the offer rise (`markRingSettled`).
 * Hovering (or focusing) the ring / the readout opens the preview card (`AncientPreview`).
 *
 * ── Awakened ──────────────────────────────────────────────────────────────────────────────────────────────────
 * The ring and readout are gone. The Ancient is simply the right HALF of the round hero-power button
 * (`AncientSplit`, rendered inside the button). Nothing else overlays it; its hover is the power's own tip, which
 * prints the combined text.
 *
 * PERF: loop-free. One layout read per hover open; everything else is a one-shot transition or WAAPI
 * transform/opacity.
 */
function useAncCfg(): AncientsConfig {
  return useSyncExternalStore(subscribeAncientsConfig, getAncientsConfig, getAncientsConfig);
}

export const AncientMeter = memo(function AncientMeter({ run }: { run: RunState }) {
  const anc = run.ancientsEnabled ? run.ancients : undefined;
  const cfg = useAncCfg();
  const wipeIdle = useGame((s) => s.wipeIdle);
  const combatStaged = useGame((s) => s.combatStaged);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const total = Math.max(1, anc?.cost ?? 16);
  const target = anc ? (anc.picked ? total : anc.points) : 0;
  const [shown, setShown] = useState(target);
  const canAnimate = run.phase === 'recruit' && wipeIdle && !combatStaged;
  const [flashKey, setFlashKey] = useState(0);
  const enabled = !!anc;

  // FILL: follow the sim's value once the Shop is at rest (a gain under a curtain waits for it). A drop (a restart,
  // the rig lowering it) snaps without a sweep.
  const [sweep, setSweep] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    if (target < shown) { setSweep(false); setShown(target); return; }
    if (target === shown || !canAnimate) return;
    setSweep(true);
    setShown(target);
    if (cfg.tickGain > 0 && tickAllowed()) sfx.tallyCounter(cfg.tickGain);
  }, [enabled, target, shown, canAnimate, cfg.tickGain]);

  // FULL: the displayed ring completes with the offer open → one flash, then release the offer.
  const offerSeq = anc?.offerSeq ?? 0;
  const offerOpen = !!anc?.offer?.length;
  useEffect(() => {
    if (!offerOpen || shown < total || !canAnimate) return;
    if (prefersReducedMotion() || cfg.flashMs <= 0) { markRingSettled(offerSeq); return; }
    const land = sweep ? cfg.fillMs : 0; // let the sweep land first, then flash
    const t1 = window.setTimeout(() => {
      setFlashKey((k) => k + 1);
      if (cfg.revealGain > 0) sfx.goodLuckShine(cfg.revealGain);
    }, land);
    const t2 = window.setTimeout(() => markRingSettled(offerSeq), land + cfg.flashMs);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [offerOpen, offerSeq, shown, total, canAnimate, sweep, cfg.flashMs, cfg.fillMs, cfg.revealGain]);

  // PREVIEW (hover / focus): one anchor read per open; a short grace period lets the pointer cross to the card.
  const cycler = useAncientCycler('death');
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null);
  const closeTimer = useRef(0);
  const open = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    const r = rootRef.current?.querySelector('.anc-ring')?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }, []);
  const leave = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setAnchor(null), 180);
  }, []);
  const stay = useCallback(() => window.clearTimeout(closeTimer.current), []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  // The preview never outlives the Shop (a fight starting mid-hover), nor the meter (the awakening offer, a pick).
  const picked = !!anc?.picked;
  useEffect(() => { if (run.phase !== 'recruit' || picked || offerOpen) setAnchor(null); }, [run.phase, picked, offerOpen]);
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowRight') { e.preventDefault(); if (!anchor) open(); cycler.step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (!anchor) open(); cycler.step(-1); }
    else if (e.key === 'Escape') setAnchor(null);
  };

  if (!anc || anc.picked) return null;
  // Geometry in the SVG's 200-unit box: the button is radius 100/ringScale; the stroke sits just outside it.
  const k = 200 / (128 * cfg.ringScale);
  const sw = cfg.ringWidth * k;
  const r = Math.min(99 - sw / 2, 100 / cfg.ringScale + 3 * k + sw / 2);
  const C = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, shown / total));
  const label = `Ancient meter: ${shown} of ${total}. Refreshes and combats fill it; when it is full an Ancient awakens. Hover or use the arrow keys to preview the Ancients.`;

  return (
    <div ref={rootRef} className="anc-meter"
      style={{ '--anc-ring-s': String(cfg.ringScale), '--anc-fill-ms': `${sweep ? cfg.fillMs : 0}ms` } as CSSProperties}>
      <div className="anc-ring" aria-hidden="true">
        <svg viewBox="0 0 200 200" className="anc-ring-svg">
          <defs>
            <linearGradient id="anc-arc-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff6dc" />
              <stop offset="55%" stopColor="#f5d27a" />
              <stop offset="100%" stopColor="#e6a93a" />
            </linearGradient>
          </defs>
          <circle className="anc-ring-hit" cx="100" cy="100" r={r} strokeWidth={sw + 14}
            onPointerEnter={open} onPointerLeave={leave} onWheel={(e) => { open(); cycler.onWheel(e); }} />
          <circle className="anc-ring-track" cx="100" cy="100" r={r} strokeWidth={sw} />
          <circle className="anc-ring-fill" cx="100" cy="100" r={r} strokeWidth={sw}
            strokeDasharray={C.toFixed(2)} strokeDashoffset={(C * (1 - frac)).toFixed(2)} transform="rotate(-90 100 100)" />
        </svg>
        {flashKey > 0 && <Flash key={flashKey} ms={cfg.flashMs} />}
      </div>
      <button type="button" className="anc-chip" aria-label={label}
        onPointerEnter={open} onPointerLeave={leave} onFocus={open} onBlur={leave}
        onWheel={(e) => { open(); cycler.onWheel(e); }} onKeyDown={onKeyDown}>
        <b key={shown}>{shown}</b><span>/{total}</span>
      </button>
      {anchor && run.phase === 'recruit' && !offerOpen && (
        <AncientPreview heroId={run.heroId} anchor={anchor} index={cycler.index} dir={cycler.dir} step={cycler.step} go={cycler.go}
          onWheel={cycler.onWheel} onPointerEnter={stay} onPointerLeave={leave} />
      )}
    </div>
  );
});

/** The full-ring flash: a light halo blooms once. */
function Flash({ ms }: { ms: number }): JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    el.animate([
      { transform: 'scale(0.96)', opacity: 0 },
      { transform: 'scale(1.02)', opacity: 1, offset: 0.3 },
      { transform: 'scale(1.1)', opacity: 0 },
    ], { duration: ms, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' });
  }, [ms]);
  return <span ref={ref} className="anc-flash" />;
}

/**
 * THE SPLIT hero-power face (rendered INSIDE `.heropowerbtn`, over the art): the Ancient's face is the right HALF of
 * the round button, with a fine cream divider. On a fresh pick (or the tuner's ▶) it plays the pick beat:
 *   1. the chosen face flies from where it was clicked into the button — the TRIPLE's `gild-trail` def plus the face
 *      itself riding the same arc — while the right half waits hidden;
 *   2. at the trail's landing the half fades/slides in, the divider draws, one light shine sweeps, the cue plays.
 * A click anywhere during the flight skips straight to the settled split. Reduced motion: a plain fade.
 */
export const AncientSplit = memo(function AncientSplit({ run }: { run: RunState }) {
  const anc = run.ancientsEnabled ? run.ancients : undefined;
  const demo = useAwakenDemo();
  const picked = anc?.picked;
  // The tuner's ▶ shows its Ancient for the length of the demo, then the run's own (if any) comes back.
  const id: AncientId | undefined = demo?.id ?? picked;
  const pickSeq = anc?.pickSeq ?? 0;
  const demoSeq = demo?.seq ?? 0;
  const btnRef = useRef<HTMLSpanElement | null>(null);
  const halfRef = useRef<HTMLSpanElement | null>(null);
  const seamRef = useRef<HTMLSpanElement | null>(null);
  const shineRef = useRef<HTMLSpanElement | null>(null);
  // Mounting on an already-picked run (a reload, a remount) shows the settled split: no beat (the refs start at the
  // current seqs). Only a pick or a ▶ that happens while mounted plays it.
  const lastPick = useRef(pickSeq);
  const lastDemo = useRef(demoSeq);
  const [hidden, setHidden] = useState(false);
  const [ghost, setGhost] = useState<{ id: AncientId; from: { x: number; y: number; w: number }; to: { x: number; y: number; w: number }; ms: number } | null>(null);

  const reveal = useCallback(() => {
    setHidden(false);
    setGhost(null);
    const cfg = getAncientsConfig();
    const reduced = prefersReducedMotion();
    const half = halfRef.current, seam = seamRef.current, shine = shineRef.current;
    if (half && typeof half.animate === 'function') {
      half.animate(reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateX(10%)' }, { opacity: 1, transform: 'translateX(0)' }],
      { duration: reduced ? 200 : cfg.splitMs, easing: 'cubic-bezier(0.16, 0.9, 0.24, 1)' });
    }
    if (!reduced && seam && typeof seam.animate === 'function') {
      seam.animate([{ transform: 'translateX(-50%) scaleY(0)' }, { transform: 'translateX(-50%) scaleY(1)' }],
        { duration: cfg.splitMs * 0.7, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    }
    if (!reduced && cfg.shineMs > 0 && shine && typeof shine.animate === 'function') {
      shine.animate([
        { transform: 'translateX(-130%) skewX(-18deg)', opacity: 0 },
        { transform: 'translateX(-20%) skewX(-18deg)', opacity: 1, offset: 0.35 },
        { transform: 'translateX(140%) skewX(-18deg)', opacity: 0 },
      ], { duration: cfg.shineMs, delay: cfg.splitMs * 0.35, easing: 'cubic-bezier(0.4, 0, 0.3, 1)', fill: 'backwards' });
    }
    if (cfg.revealGain > 0) { sfx.runeSelectImplosion(cfg.revealGain); sfx.equipmentSheen(cfg.revealGain, cfg.splitMs * 0.35 / 1000); }
  }, []);

  useLayoutEffect(() => {
    const fresh = pickSeq > lastPick.current || demoSeq > lastDemo.current;
    lastPick.current = pickSeq;
    lastDemo.current = Math.max(lastDemo.current, demoSeq);
    if (!id || !fresh) return;
    const btn = btnRef.current?.closest('.heropowerbtn');
    const r = btn?.getBoundingClientRect();
    const from = takePickSource() ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.46, w: 180 };
    if (!r || r.width <= 0 || prefersReducedMotion()) { reveal(); return; }
    const to = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    const ms = Math.max(420, gildArrivalMs(getDef('gild-trail'), 0) || 700);
    setHidden(true);
    setGhost({ id, from, to, ms });
    if (canPlayDefs()) playDef('gild-trail', { source: { x: from.x, y: from.y }, target: { x: to.x, y: to.y }, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } }, { index: 0 });
    let done = false;
    const finish = (): void => { if (done) return; done = true; window.clearTimeout(t); window.removeEventListener('pointerdown', skip, true); reveal(); };
    const skip = (): void => finish();
    const t = window.setTimeout(finish, ms);
    window.addEventListener('pointerdown', skip, true);
    return () => { window.clearTimeout(t); window.removeEventListener('pointerdown', skip, true); };
  }, [id, pickSeq, demoSeq, reveal]);

  if (!id) return <span ref={btnRef} className="anc-split-anchor" aria-hidden="true" />;
  return (
    <>
      <span ref={btnRef} className="anc-split" aria-hidden="true">
        <span ref={halfRef} className="anc-split-half" style={hidden ? { opacity: 0 } : undefined}><AncientFace id={id} /></span>
        <span ref={seamRef} className="anc-split-seam" style={hidden ? { opacity: 0 } : undefined} />
        <span className="anc-split-shinewrap"><span ref={shineRef} className="anc-split-shine" /></span>
      </span>
      {ghost && <FlyingFace {...ghost} />}
    </>
  );
});

/** The chosen face riding the trail's arc into the hero power (portal; transform + opacity only). */
function FlyingFace({ id, from, to, ms }: { id: AncientId; from: { x: number; y: number; w: number }; to: { x: number; y: number; w: number }; ms: number }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const s1 = to.w / Math.max(1, from.w);
    const lift = Math.min(220, Math.hypot(dx, dy) * 0.28);
    el.animate([
      { transform: 'translate(-50%, -50%) translate(0px, 0px) scale(1)', opacity: 1 },
      { transform: `translate(-50%, -50%) translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${(1 + s1) / 2})`, opacity: 1, offset: 0.5 },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${s1})`, opacity: 0.2 },
    ], { duration: ms, easing: 'cubic-bezier(0.45, 0, 0.35, 1)', fill: 'forwards' });
  }, [from, to, ms]);
  return createPortal(
    <div ref={ref} className="anc-flyface" style={{ left: from.x, top: from.y, width: from.w, height: from.w }} aria-hidden="true"><AncientFace id={id} /></div>,
    document.body,
  );
}
