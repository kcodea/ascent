import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ANCIENTS, type AncientId, type RunState } from '@game/sim';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { canPlayDefs, playDef } from '../fx/playDef';
import { getDef } from '../fx/fxDefs';
import { gildArrivalMs } from '../gildTrailSources';
import { AncientFace } from './AncientFace';
import { ancientPowerArt } from '../art';
import { AncientPreview, useAncientCycler, type PreviewAnchor } from './AncientPreview';
import { ancientColor, getAncientsConfig, subscribeAncientsConfig, type AncientsFullConfig } from './ancientsConfig';
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
 * ONLY the "Ancients 7/16" pill opens the preview card (`AncientPreview`) on hover / focus (owner 2026-09-25: "that
 * be the mouseover for the ancient previews, not the hero power progress bar"). The ring takes no pointer events,
 * so the hero power keeps its own tip.
 *
 * ── Awakened ──────────────────────────────────────────────────────────────────────────────────────────────────
 * The ring and readout are gone. The Ancient is simply the right HALF of the round hero-power button
 * (`AncientSplit`, rendered inside the button). Nothing else overlays it; its hover is the power's own tip, which
 * prints the combined text.
 *
 * PERF: loop-free. One layout read per hover open; everything else is a one-shot transition or WAAPI
 * transform/opacity.
 */
function useAncCfg(): AncientsFullConfig {
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
  // In: slide + fade (`pvInMs`). Leave: after a short grace (`pvGraceMs`, the ring → card bridge) it slides + fades
  // out quickly (`pvOutMs`) and then really unmounts; re-entering at any point cancels the leave.
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null);
  const [leaving, setLeaving] = useState(false);
  const closeTimer = useRef(0);
  const goneTimer = useRef(0);
  const cancelLeave = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(goneTimer.current);
    setLeaving(false);
  }, []);
  const open = useCallback(() => {
    cancelLeave();
    const r = rootRef.current?.querySelector('.anc-ring')?.getBoundingClientRect();
    if (r) setAnchor((a) => a ?? { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }, [cancelLeave]);
  const leave = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(goneTimer.current);
    const c = getAncientsConfig();
    closeTimer.current = window.setTimeout(() => {
      setLeaving(true);
      goneTimer.current = window.setTimeout(() => { setAnchor(null); setLeaving(false); }, prefersReducedMotion() ? 80 : c.pvOutMs);
    }, c.pvGraceMs);
  }, []);
  const stay = cancelLeave;
  useEffect(() => () => { window.clearTimeout(closeTimer.current); window.clearTimeout(goneTimer.current); }, []);
  // The preview never outlives the Shop (a fight starting mid-hover), nor the meter (the awakening offer, a pick).
  const picked = !!anc?.picked;
  useEffect(() => { if (run.phase !== 'recruit' || picked || offerOpen) setAnchor(null); }, [run.phase, picked, offerOpen]);
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowRight') { e.preventDefault(); if (!anchor) open(); cycler.step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (!anchor) open(); cycler.step(-1); }
    else if (e.key === 'Escape') setAnchor(null);
  };

  if (!anc || anc.picked) return null;
  // Geometry in DESIGN PX (the SVG box is sized in --u, so its user units ARE design px): the button is a 128 circle,
  // and the ring sits `ringOffset` outside its edge so it never merges with the power's own frame.
  const sw = Math.max(1, cfg.ringWidth);
  const r = 64 + cfg.ringOffset + sw / 2;
  const cap = cfg.capSize > 0 ? (sw * cfg.capSize) / 2 : 0;
  const pad = Math.max(sw / 2, cap) + 3;
  const D = 2 * (r + pad);
  const c = D / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, shown / total));
  const label = `Ancient meter: ${shown} of ${total}. Refreshes and combats fill it; when it is full an Ancient awakens. Hover or use the arrow keys to preview the Ancients.`;

  return (
    <div ref={rootRef} className="anc-meter"
      style={{ '--anc-ring-d': String(D), '--anc-ring-r': String(r + sw / 2), '--anc-fill-ms': `${sweep ? cfg.fillMs : 0}ms` } as CSSProperties}>
      <div className="anc-ring" aria-hidden="true">
        <svg viewBox={`0 0 ${D} ${D}`} className="anc-ring-svg">
          <defs>
            {/* Tail (12 o'clock) → the bottom of the ring: warm gold into amber. */}
            <linearGradient id="anc-arc-grad" gradientUnits="userSpaceOnUse" x1={c} y1={c - r} x2={c} y2={c + r}>
              <stop offset="0%" stopColor={cfg.fillFrom} />
              <stop offset="100%" stopColor={cfg.fillTo} />
            </linearGradient>
          </defs>
          <circle className="anc-ring-track" cx={c} cy={c} r={r} strokeWidth={sw} stroke={cfg.trackColor} strokeOpacity={cfg.trackAlpha} />
          {cfg.ticks > 0 && [0.25, 0.5, 0.75].map((q) => {
            const a = q * Math.PI * 2 - Math.PI / 2;
            const i = r - sw / 2 + 1, o = r + sw / 2 - 1;
            return <line key={q} className="anc-ring-tick" x1={c + i * Math.cos(a)} y1={c + i * Math.sin(a)} x2={c + o * Math.cos(a)} y2={c + o * Math.sin(a)} />;
          })}
          <circle className="anc-ring-fill" cx={c} cy={c} r={r} strokeWidth={sw}
            strokeDasharray={C.toFixed(2)} strokeDashoffset={(C * (1 - frac)).toFixed(2)} transform={`rotate(-90 ${c} ${c})`}
            style={{ opacity: frac > 0 ? 1 : 0 }} />
        </svg>
        {/* The leading-edge cap: a bright dot riding the head. The layer ROTATES (a one-shot transform transition in
            step with the arc's sweep), so the dot is never repainted. */}
        {cap > 0 && frac > 0 && (
          <div className="anc-ring-headrot" style={{ transform: `rotate(${frac * 360}deg)` }}>
            <span className="anc-ring-cap" style={{ width: `calc(${cap * 2} * var(--u))`, height: `calc(${cap * 2} * var(--u))`, top: `calc(${c - r} * var(--u))` }} />
          </div>
        )}
        {flashKey > 0 && <Flash key={flashKey} ms={cfg.flashMs} />}
      </div>
      <button type="button" className="anc-chip" aria-label={label}
        onPointerEnter={open} onPointerLeave={leave} onFocus={open} onBlur={leave}
        onWheel={(e) => { open(); cycler.onWheel(e); }} onKeyDown={onKeyDown}>
        <span className="anc-chip-lbl">Ancients</span><b key={shown}>{shown}</b><span>/{total}</span>
      </button>
      {anchor && run.phase === 'recruit' && !offerOpen && (
        <AncientPreview heroId={run.heroId} anchor={anchor} leaving={leaving} inMs={cfg.pvInMs} outMs={cfg.pvOutMs} index={cycler.index} dir={cycler.dir} step={cycler.step} go={cycler.go}
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
 *   1. the TRIPLE's reward animation (the `gild-trail` def) flies from the chosen card into the button, and nothing
 *      else (owner 2026-09-25: "dont send the art of the ancient, just send the triple reward animation");
 *   2. at the trail's landing the half fades/slides in, the divider draws, one light shine sweeps, the cue plays.
 * A click anywhere during the flight skips straight to the settled split. Reduced motion: a plain fade.
 */
export const AncientSplit = memo(function AncientSplit({ run }: { run: RunState }) {
  const anc = run.ancientsEnabled ? run.ancients : undefined;
  const demo = useAwakenDemo();
  const cfg = useAncCfg();
  const picked = anc?.picked;
  // The tuner's ▶ shows its Ancient for the length of the demo, then the run's own (if any) comes back.
  const id: AncientId | undefined = demo?.id ?? picked;
  const pickSeq = anc?.pickSeq ?? 0;
  const demoSeq = demo?.seq ?? 0;
  const btnRef = useRef<HTMLSpanElement | null>(null);
  const halfRef = useRef<HTMLSpanElement | null>(null);
  const seamRef = useRef<SVGSVGElement | null>(null);
  const shineRef = useRef<HTMLSpanElement | null>(null);
  // Mounting on an already-picked run (a reload, a remount) shows the settled split: no beat (the refs start at the
  // current seqs). Only a pick or a ▶ that happens while mounted plays it.
  const lastPick = useRef(pickSeq);
  const lastDemo = useRef(demoSeq);
  const [hidden, setHidden] = useState(false);

  const reveal = useCallback(() => {
    setHidden(false);
    const cfg = getAncientsConfig();
    const reduced = prefersReducedMotion();
    const half = halfRef.current, seam = seamRef.current, shine = shineRef.current;
    // 1. THE CRACK OPENS: its edge draws top to bottom (a one-shot dash sweep on a static path).
    const openMs = reduced ? 0 : Math.max(0, cfg.crackOpenMs);
    if (openMs > 0 && seam) {
      for (const line of Array.from(seam.querySelectorAll<SVGPolylineElement>('polyline'))) {
        if (typeof line.animate === 'function') line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: openMs, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'backwards' });
      }
    }
    // 2. ...and the Ancient shows through it.
    if (half && typeof half.animate === 'function') {
      half.animate(reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateX(4%)' }, { opacity: 1, transform: 'translateX(0)' }],
      { duration: reduced ? 200 : cfg.splitMs, delay: openMs * 0.6, easing: 'cubic-bezier(0.16, 0.9, 0.24, 1)', fill: 'backwards' });
    }
    if (!reduced && cfg.shineMs > 0 && shine && typeof shine.animate === 'function') {
      shine.animate([
        { transform: 'translateX(-130%) skewX(-18deg)', opacity: 0 },
        { transform: 'translateX(-20%) skewX(-18deg)', opacity: 1, offset: 0.35 },
        { transform: 'translateX(140%) skewX(-18deg)', opacity: 0 },
      ], { duration: cfg.shineMs, delay: openMs * 0.6 + cfg.splitMs * 0.35, easing: 'cubic-bezier(0.4, 0, 0.3, 1)', fill: 'backwards' });
    }
    if (cfg.revealGain > 0) { sfx.runeSelectImplosion(cfg.revealGain); sfx.equipmentSheen(cfg.revealGain, (openMs * 0.6 + cfg.splitMs * 0.35) / 1000); }
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
    if (canPlayDefs()) playDef('gild-trail', { source: { x: from.x, y: from.y }, target: { x: to.x, y: to.y }, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } }, { index: 0 });
    let done = false;
    const finish = (): void => { if (done) return; done = true; window.clearTimeout(t); window.removeEventListener('pointerdown', skip, true); reveal(); };
    const skip = (): void => finish();
    const t = window.setTimeout(finish, ms);
    window.addEventListener('pointerdown', skip, true);
    return () => { window.clearTimeout(t); window.removeEventListener('pointerdown', skip, true); };
  }, [id, pickSeq, demoSeq, reveal]);

  if (!id) return <span ref={btnRef} className="anc-split-anchor" aria-hidden="true" />;
  const art = crackGeometry(cfg, id);
  const hasPowerArt = !!ancientPowerArt(id);
  return (
    <>
      <span ref={btnRef} className="anc-split" aria-hidden="true">
        {/* The Ancient's half: its hero-power art at the SAME size and place as the power's own art (the power's
            --hpb-art-* fit, then this Ancient's tuner fit), clipped to the right of the crack. */}
        <span ref={halfRef} className="anc-split-half" style={{ clipPath: art.clip, ...(hidden ? { opacity: 0 } : {}) }}>
          {hasPowerArt
            ? <span className="anc-split-art" style={art.fit}><AncientFace id={id} variant="power" /></span>
            : <AncientFace id={id} className="anc-split-emblem" />}
        </span>
        {/* The crack's edge: a soft shadow just inside it, then the thin bright highlight. Static paths. */}
        <svg ref={seamRef} className="anc-split-crack" viewBox="0 0 100 100" preserveAspectRatio="none" style={hidden ? { opacity: 0 } : undefined}>
          {cfg.crackShadow > 0 && <polyline className="anc-crack-shadow" points={art.shadowPts} pathLength={1} strokeDasharray="1" style={{ opacity: cfg.crackShadow, strokeWidth: `calc(${Math.max(1, cfg.crackEdge) * 2.5} * var(--u))` }} />}
          {cfg.crackEdge > 0 && <polyline className="anc-crack-edge" points={art.pts} pathLength={1} strokeDasharray="1" style={{ opacity: cfg.crackEdgeAlpha, strokeWidth: `calc(${cfg.crackEdge} * var(--u))` }} />}
        </svg>
        <span className="anc-split-shinewrap"><span ref={shineRef} className="anc-split-shine" /></span>
      </span>
    </>
  );
});

/** Fixed pseudo-random numbers in [0, 1): deterministic, so the crack never changes shape between renders. */
const rnd = (i: number, salt: number): number => (((Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453) % 1) + 1) % 1;

/**
 * The crack's zig-zag (in % of the button), its right-side clip polygon, and the Ancient art's fit.
 *
 * JAGGED END TO END (owner 2026-09-25: "the bottom half of it loses the crack aspect"). Every vertex swings the FULL
 * amplitude (never a taper), sides alternate so each segment is a sharp zig, the vertical spacing is irregular, and
 * every long segment gets a small kink so no stretch reads as a smooth line. Only the two end points sit off-circle
 * (beyond the button edge), so nothing near the rim flattens.
 */
function crackGeometry(cfg: AncientsFullConfig, id: AncientId): { pts: string; shadowPts: string; clip: string; fit: CSSProperties } {
  const k = cfg as unknown as Record<string, number>;
  const x0 = cfg.crackX + (k[`${id}Crack`] ?? 0);
  const n = Math.max(2, Math.round(cfg.crackSegs));
  const amp = cfg.crackJag;
  // Irregular row heights spanning -4% .. 104%.
  const weights = Array.from({ length: n }, (_, i) => 0.7 + 0.6 * rnd(i, 1));
  const total = weights.reduce((t, w) => t + w, 0);
  const pts: [number, number][] = [];
  let y = -4;
  for (let i = 0; i <= n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    pts.push([x0 + side * amp * (0.75 + 0.25 * rnd(i, 2)), y]);
    if (i < n) {
      const h = (108 * weights[i]!) / total;
      // A small kink partway down this zig, off the straight line between its two vertices.
      const t = 0.35 + 0.3 * rnd(i, 3);
      const nextSide = -side;
      const xa = x0 + side * amp * (0.75 + 0.25 * rnd(i, 2));
      const xb = x0 + nextSide * amp * (0.75 + 0.25 * rnd(i + 1, 2));
      pts.push([xa + (xb - xa) * t + (rnd(i, 4) - 0.5) * amp * 0.6, y + h * t]);
      y += h;
    }
  }
  const fmt = (p: [number, number][]): string => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const clip = `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(', ')}, 102% 102%, 102% -2%)`;
  const X = k[`${id}X`] ?? 0, Y = k[`${id}Y`] ?? 0, S = k[`${id}S`] ?? 1, R = k[`${id}R`] ?? 0;
  const fit: CSSProperties = {
    transform: `translate(calc((var(--hpb-art-x, 0) + ${X}) * var(--u)), calc((var(--hpb-art-y, 0) + ${Y}) * var(--u))) scale(calc(var(--hpb-art-s, 1.03) * ${S})) rotate(${R}deg)`,
  };
  return { pts: fmt(pts), shadowPts: fmt(pts.map(([x, y]) => [x + 1.2, y])), clip, fit };
}


/**
 * THE ANCIENT PILL (owner 2026-09-25: "show a pill for the ancient selected below the hero power, coloured to match
 * the style of the ancient"): a small pill naming the chosen Ancient, stacked under the power's name pill. Taken out
 * of the flow (absolute), so its arrival never shifts the layout. Its colour is the Ancient's (the sim's colour table,
 * or the tuner's override).
 */
export const AncientPill = memo(function AncientPill({ run }: { run: RunState }) {
  useAncCfg(); // re-render on a colour change in the tuner
  const id = run.ancientsEnabled ? run.ancients?.picked : undefined;
  if (!id) return null;
  return (
    <div className="anc-pill" style={{ '--anc-c': ancientColor(id) } as CSSProperties}>
      <span className="anc-pill-dot" aria-hidden="true" />{ANCIENTS[id].name}
    </div>
  );
});
