import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type MutableRefObject } from 'react';
import { getHero, heroTip, SHOW_HERO_TIPS } from '@game/sim';
import { heroArt } from '../art';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import {
  ceremonyReduce, ceremonyCanLaunch, CEREMONY_ORDER,
  type HeroCeremonyState, type HeroCeremonyEvent, type HeroCeremonyPhase, type RectSnapshot,
} from './heroCeremonyMachine';
import { destinationRect, exitVector, focusKeyframes, snapshotRect, stageScale, transformTo } from './heroCeremonyGeometry';
import { ceremonyAdvanceSchedule, ceremonyTiming } from './heroCeremonyTiming';
import { requestLaunch } from './heroLaunchController';
import { getHeroCeremonyConfig } from './heroCeremonyTunerConfig';
import ringArt from './heroportrait.png';
import { createHeroCeremonyFx, type HeroCeremonyFxController } from './HeroCeremonyPixi';
import './heroCeremony.css';

/**
 * HERO SELECT CEREMONY — the post-click presentation (hero-select-ceremony-blueprint.md §6, §8–§10, §13–§14).
 *
 * Mounted by HeroSelect the moment the machine leaves `idle` and unmounted when HeroSelect goes (pickHero
 * clears heroChoices under the launch curtain). Owns:
 *   - the ONE sequence runner: every phase advance is a timer read from `ceremonyTiming()`, gated on a
 *     single AbortController — unmounting mid-ceremony cancels every timer AND every WAAPI animation;
 *   - the fixed-position CLONE of the selected card (the original never leaves the flex layout — §8);
 *   - the unselected cards' exit animations (their DOM stays owned by HeroSelect; we only animate);
 *   - the backdrop scrim + hero-accent glow, the materializing clean portrait, the identity block and the
 *     Start Game button.
 *
 * Perf contract (repo + §9/§18): transform/opacity only in animations; geometry is read once per card at
 * commit and once per debounced resize — never per frame.
 */

/** The §9 focus/settle easing — arrival momentum with a slight overshoot baked into the curve. */
const FOCUS_EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1.08)';
/** Natural width of the big herocard the clone re-renders at (styles.css `.herocard.big`). The clone's
 *  inner card renders at this size and is statically scaled down to the source rect, so its metrics match
 *  the real card regardless of the `.hsbox` zoom or the browse grid's fractional widths. */
const BIG_CARD_W = 300;
/** The Pixi layer's accent — `--acc` (styles.css) as a number. Heroes have no per-hero accent field yet, so
 *  every ceremony burns gold; when one is added, thread it through here and the curtain glow together. */
const ACCENT = 0xc4a05c;

const phaseIndex = (p: HeroCeremonyPhase): number => CEREMONY_ORDER.indexOf(p);

/** el.animate with the §19 fallback: environments without WAAPI (jsdom) snap straight to the final
 *  keyframe's transform/opacity so the ceremony still ends in the right visual state. */
function animateEl(
  el: HTMLElement | null,
  keyframes: Keyframe[],
  opts: KeyframeAnimationOptions,
  sink: Animation[],
): Animation | null {
  if (!el) return null;
  if (typeof el.animate !== 'function') {
    const last = keyframes[keyframes.length - 1] as Record<string, unknown>;
    if (typeof last.transform === 'string') el.style.transform = last.transform;
    if (last.opacity !== undefined) el.style.opacity = String(last.opacity);
    return null;
  }
  const anim = el.animate(keyframes, opts);
  sink.push(anim);
  return anim;
}

/** The materialized artwork's final bounds: the measured card-art crop grown 18%, then shaped by the 🎭
 *  tuner's Hero-art knobs — scale around center + x/y nudge. Prod uses the shipped defaults (1 / 0 / 0). */
function portraitBoundsOf(crop: RectSnapshot): RectSnapshot {
  const fx = getHeroCeremonyConfig();
  const k = stageScale(window.innerWidth, window.innerHeight); // offsets are REFERENCE px, like the rest of the UI
  const grow = 1.18 * fx.portraitScale;
  const w = crop.width * grow;
  const h = crop.height * grow;
  return {
    left: crop.left + crop.width / 2 - w / 2 + fx.portraitX * k,
    top: crop.top + crop.height / 2 - h / 2 + fx.portraitY * k,
    width: w,
    height: h,
  };
}

interface Props {
  state: HeroCeremonyState;
  dispatch: Dispatch<HeroCeremonyEvent>;
  /** HeroSelect's card buttons, by choice index (the ceremony animates them out but never owns them). */
  cardEls: MutableRefObject<(HTMLButtonElement | null)[]>;
}

export function HeroSelectCeremony({ state, dispatch, cardEls }: Props) {
  const heroId = state.heroId!;
  const source = state.sourceRect!;
  const hero = getHero(heroId);
  const art = heroArt(heroId);
  const tip = heroTip(heroId);
  const pi = phaseIndex(state.phase);
  const crossed = (p: HeroCeremonyPhase): boolean => pi >= phaseIndex(p);

  const cloneWrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const portraitRef = useRef<HTMLDivElement | null>(null);
  const startBtnRef = useRef<HTMLButtonElement | null>(null);
  /** Every WAAPI animation we start, for wholesale cancel on unmount (§19 "unmounts unexpectedly"). */
  const animsRef = useRef<Animation[]>([]);
  /** The clone's travel animation alone — the resize snap cancels THIS, never the card exits. */
  const focusAnimRef = useRef<Animation | null>(null);
  /** Unselected-card rects, snapshotted ONCE at commit (§8) — the dismiss beat reuses them. */
  const cardRectsRef = useRef<{ el: HTMLButtonElement; rect: RectSnapshot; index: number }[]>([]);
  const launchedRef = useRef(false);
  /* One-shot latches for the phase-CROSSING effects below. The advance timers can land 20ms apart
     (dismissing@100 / focusing@120), and React 18 coalesces dispatches that close into ONE render — the
     transient phase then never renders, and an effect guarded `phase !== 'dismissing'` silently skips its
     work (found live 2026-08-21: the unselected cards simply never left). So every one-shot beat instead
     fires when the phase index has been REACHED-OR-PASSED, latched by a ref. A backgrounded tab (timers
     clamped to 1s, all five advances collapsing into one render) degrades to "everything catches up at
     once" instead of "half the ceremony never happens". */
  const didExitsRef = useRef(false);
  const didFocusRef = useRef(false);
  const layerRef = useRef<HTMLDivElement | null>(null);
  /** The dedicated Pixi controller (§11-§12). Best-effort by contract: a failed init leaves an inert no-op,
   *  and every call below is safe against that — the DOM ceremony IS the fallback (§19). */
  const fxRef = useRef<HeroCeremonyFxController | null>(null);

  const [dest, setDest] = useState(() => destinationRect(window.innerWidth, window.innerHeight, source));
  /** The circular-portrait FLASH has fired: the ring is on stage and the art clips to a circle inside it. */
  const [flashed, setFlashed] = useState(false);
  /** The clone's travel has actually FINISHED. The portrait's bounds are measured off the settled clone, and
   *  measuring it mid-flight yields a rect at the card's old position and size — which is how the whole
   *  presentation ends up off-centre. Normally the transform beat lands well after the travel, so this is
   *  already true; it matters when frames are dropped or timers coalesce (a backgrounded tab, a slow machine),
   *  where the beat can arrive before the movement has visually happened. */
  const [travelDone, setTravelDone] = useState(false);
  /** Set when materializing begins (and art exists): the portrait's start crop + final bounds. */
  const [portrait, setPortrait] = useState<{ crop: RectSnapshot; bounds: RectSnapshot } | null>(null);

  const t = useMemo(() => ceremonyTiming(), []);

  /* ---- Commit: snapshot the grid ONCE, hide the original under the painted clone, press-acknowledge. */
  useLayoutEffect(() => {
    const els = cardEls.current;
    const snaps: { el: HTMLButtonElement; rect: RectSnapshot; index: number }[] = [];
    els.forEach((el, index) => {
      if (!el || index === state.sourceIndex) return;
      snaps.push({ el, rect: snapshotRect(el.getBoundingClientRect()), index });
    });
    cardRectsRef.current = snaps;

    // §8 step 4: hide the original only AFTER the clone has painted — one rAF later. The card keeps its
    // slot (visibility, not display), so the exiting neighbours never reflow.
    const original = els[state.sourceIndex];
    let raf = 0;
    if (typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(() => { if (original) original.style.visibility = 'hidden'; });
    } else if (original) {
      original.style.visibility = 'hidden';
    }

    // §4 "presses into the surface" — a one-shot scale dip on the clone wrapper before travel begins.
    animateEl(cloneWrapRef.current, [
      { transform: 'scale(1)' }, { transform: 'scale(0.98)' }, { transform: 'scale(1)' },
    ], { duration: t.pressMs, easing: 'ease-out' }, animsRef.current);

    const anims = animsRef.current;
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (original) original.style.visibility = ''; // a reset mid-ceremony must leave the grid intact
      anims.forEach((a) => a.cancel());
      anims.length = 0;
    };
    // Commit-time effect: runs exactly once for the ceremony's lifetime.
    // (deps intentionally omitted — see the comment above)
  }, []);

  /* ---- Pixi lifecycle (§11): its own Application, mounted after commit, destroyed with the ceremony.
     Geometry flows one way (setGeometry); the controller never reads the DOM. */
  useEffect(() => {
    const fx = createHeroCeremonyFx();
    fxRef.current = fx;
    if (layerRef.current) void fx.mount(layerRef.current);
    return () => { fxRef.current = null; fx.destroy(); };
    // Mount-once, like the sequence runner.
    // (deps intentionally omitted — see the comment above)
  }, []);
  useEffect(() => {
    fxRef.current?.setGeometry({
      heroId,
      accentColor: ACCENT,
      center: { x: dest.left + dest.width / 2, y: dest.top + dest.height / 2 },
      cardBounds: dest,
      portraitBounds: portrait?.bounds ?? dest,
    });
  }, [heroId, dest, portrait]);

  /* ---- THE sequence runner (§5): one AbortController owns every timed advance. sfx.heroSelect fires
     here, at the voice beat, exactly once — it left the card click on purpose (§15). */
  useEffect(() => {
    const ac = new AbortController();
    const at = (ms: number, fn: () => void) => {
      const id = setTimeout(() => { if (!ac.signal.aborted) fn(); }, ms);
      ac.signal.addEventListener('abort', () => clearTimeout(id));
    };
    // Phase advances come from the MONOTONIC schedule (ceremonyAdvanceSchedule): the machine only accepts
    // single forward steps, and five independent sliders could order the advance timers illegally — sliding
    // the voiceline past the transform wedged the whole ceremony (hit live 2026-08-21). Equal marks fire in
    // registration order, which is phase order.
    const sched = ceremonyAdvanceSchedule(t);
    at(sched.dismissAt, () => dispatch({ type: 'advance', to: 'dismissing' }));
    at(sched.focusAt, () => dispatch({ type: 'advance', to: 'focusing' }));
    at(sched.voicePhaseAt, () => dispatch({ type: 'advance', to: 'voicing' }));
    at(sched.materializeAt, () => dispatch({ type: 'advance', to: 'materializing' }));
    at(sched.readyAt, () => dispatch({ type: 'advance', to: 'ready' }));
    // The voiceline is AUDIO, not a phase driver — it plays at the raw mark wherever the owner slides it;
    // missing audio stays silent and never alters the timeline (§15).
    // CEREMONY STINGERS + the circular-portrait FLASH + the NAMED PIXI CUES (owner asks 2026-08-21). Config,
    // not timing-object: each sound and each effect has its own gate/mark(/duration) in the 🎭 tuner; prod
    // plays the shipped defaults. All §15-safe — a missing clip or a failed Pixi init never touches the
    // visual timeline.
    const fx = getHeroCeremonyConfig();
    if (fx.ring1On >= 1) at(fx.ring1AtMs, () => fxRef.current?.playRingBurst1(fx.ring1Ms));
    if (fx.sparksOn >= 1) at(fx.sparksAtMs, () => fxRef.current?.playSparks(fx.sparksMs));
    if (fx.motesOn >= 1) at(fx.motesAtMs, () => fxRef.current?.beginAmbient());
    if (fx.sweepOn >= 1) at(fx.sweepAtMs, () => fxRef.current?.playSweep(fx.sweepMs));
    if (fx.dustOn >= 1) at(fx.dustAtMs, () => fxRef.current?.playDust(fx.dustMs));
    if (fx.ring2On >= 1) at(fx.ring2AtMs, () => fxRef.current?.playRingBurst2(fx.ring2Ms));
    if (fx.songOn >= 1) at(fx.songAtMs, () => sfx.ceremony('asiansong', fx.songVol));
    if (fx.woosh1On >= 1) at(fx.woosh1AtMs, () => sfx.ceremony('woosh1', fx.woosh1Vol));
    if (fx.woosh2On >= 1) at(fx.woosh2AtMs, () => sfx.ceremony('woosh2', fx.woosh2Vol));
    if (fx.revealOn >= 1) at(fx.revealAtMs, () => sfx.ceremony('ceremonyrevealsound', fx.revealVol));
    at(fx.flashAtMs, () => setFlashed(true));
    at(t.voiceAtMs, () => sfx.heroSelect(heroId));
    return () => ac.abort();
    // (deps intentionally omitted — see the comment above)
  }, []);

  /* ---- Dismissing: the unselected cards yield the stage (§9), each along its own exitVector. Rects were
     snapshotted at commit; rows are derived from the snapshots, so this beat does zero layout reads. */
  useEffect(() => {
    if (!crossed('dismissing') || didExitsRef.current) return;
    didExitsRef.current = true;
    const snaps = cardRectsRef.current;
    // Row = rank of distinct tops (10px tolerance) — drives the small vertical drift per row (§9).
    const tops: number[] = [];
    for (const s of snaps) {
      if (!tops.some((v) => Math.abs(v - s.rect.top) < 10)) tops.push(s.rect.top);
    }
    tops.sort((a, b) => a - b);
    for (const s of snaps) {
      const row = tops.findIndex((v) => Math.abs(v - s.rect.top) < 10);
      const v = exitVector(s.rect, source, s.index, row, t.optionStaggerMs);
      animateEl(s.el, [
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${v.x.toFixed(1)}px, ${v.y.toFixed(1)}px) rotate(${v.rotateDeg.toFixed(2)}deg) scale(${v.scale})`, opacity: 0 },
      ], { duration: t.optionExitMs, delay: v.delayMs, easing: 'ease-in', fill: 'forwards' }, animsRef.current);
    }
  }, [state.phase, source, t]);

  /* ---- Focusing: the clone travels to center with the §9 overshoot-settle keyframes. */
  useEffect(() => {
    if (!crossed('focusing') || didFocusRef.current) return;
    didFocusRef.current = true;
    focusAnimRef.current = animateEl(cloneWrapRef.current, focusKeyframes(source, dest), {
      duration: t.focusMs + t.settleMs,
      easing: FOCUS_EASE,
      fill: 'forwards',
    }, animsRef.current);
    // Mark the travel done when it REALLY is. Without WAAPI (jsdom) `animateEl` applied the final state
    // synchronously, so resolve immediately there too.
    const anim = focusAnimRef.current;
    if (anim) anim.finished.then(() => setTravelDone(true)).catch(() => setTravelDone(true));
    else setTravelDone(true);
    // `dest` is deliberately the value at focus time; a later resize corrects via snap, never a restart.
    // (deps intentionally omitted — see the comment above)
  }, [state.phase]);

  /* ---- Materializing (§13): measure the settled frame ONCE (the art crop), derive the portrait bounds
     (a gentle expansion beyond the card crop — "the art escapes the card"), and let render + the effect
     below run the crossfade. No art → skip entirely and keep the framed clone (§19). */
  useEffect(() => {
    if (!crossed('materializing') || portrait || !art || !travelDone) return;
    const frame = frameRef.current;
    if (!frame) return;
    const crop = snapshotRect(frame.getBoundingClientRect());
    if (crop.width <= 0) return; // degenerate (hidden/unstyled test env): keep the framed fallback
    setPortrait({ crop, bounds: portraitBoundsOf(crop) });
  }, [state.phase, art, travelDone, portrait]);

  /* ---- Portrait entrance: from the card-art crop to the final bounds, opacity 0.35 → 1 (§13). */
  useEffect(() => {
    if (!portrait) return;
    const el = portraitRef.current;
    const from = transformTo(portrait.bounds, portrait.crop);
    animateEl(el, [
      { transform: from, opacity: 0.35 },
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
    ], { duration: t.transformMs, easing: FOCUS_EASE, fill: 'forwards' }, animsRef.current);
    // (deps intentionally omitted — see the comment above)
  }, [portrait]);

  /* ---- Ready: keyboard focus moves to Start Game only once it is fully interactive (§14, §16). */
  useEffect(() => {
    if (state.phase === 'ready') startBtnRef.current?.focus();
  }, [state.phase]);

  /* ---- Debounced resize (§17): recompute the destination and SNAP the clone + portrait to it. Never
     restarts the sequence or the voice — the timers above don't know resize exists. */
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(id);
      id = setTimeout(() => {
        const next = destinationRect(window.innerWidth, window.innerHeight, source);
        setDest(next);
        const wrap = cloneWrapRef.current;
        // Only correct once travel is over (post-focus phases); mid-travel the running animation still
        // targets the old center and the settle lands close enough for the snap below to be jarring.
        if (wrap && phaseIndex(state.phase) >= phaseIndex('voicing')) {
          // Cancel only the travel animation (its fill would fight the inline snap); card exits keep theirs.
          focusAnimRef.current?.cancel();
          focusAnimRef.current = null;
          wrap.style.transform = transformTo(source, next);
          // Portrait correction: re-measure the snapped frame once and rebuild the (already faded-in)
          // portrait bounds around it. The entrance animation is long finished by any realistic resize.
          if (portrait && frameRef.current) {
            const crop = snapshotRect(frameRef.current.getBoundingClientRect());
            if (crop.width > 0) {
              setPortrait({ crop, bounds: portraitBoundsOf(crop) });
              const p = portraitRef.current;
              if (p) { p.style.transform = 'translate(0px, 0px) scale(1)'; p.style.opacity = '1'; }
            }
          }
        }
      }, 150);
    };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(id); window.removeEventListener('resize', onResize); };
  }, [source, state.phase, portrait]);

  /* ---- Start Game: reducer first (only `ready` may launch, `launching` is once-only — §5), then the
     curtain seam. The curtain lives in Game and survives our unmount (§7). */
  const onStart = () => {
    const next = ceremonyReduce(state, { type: 'startGame' });
    if (next === state || launchedRef.current) return; // not ready, or already launched
    launchedRef.current = true;
    dispatch({ type: 'startGame' });
    sfx.pulse();
    // §12.5: particles pull home + one outward pulse while the curtain covers. Fire-and-forget on purpose —
    // the curtain owns the pacing, and a hung/absent Pixi layer must never delay run creation.
    fxRef.current?.stopAmbient();
    void fxRef.current?.playLaunch();
    void requestLaunch({ heroId, accent: 'var(--acc)' });
  };

  const materialized = pi >= phaseIndex('materializing');
  const k = source.width > 0 ? source.width / BIG_CARD_W : 1; // static adapter: natural card → source rect

  // The identity/button entrances are pure CSS animations whose delays are timing-object offsets from the
  // materializing beat (they mount with it) — no extra timers to abort.
  const vars = {
    '--hsc-transform-ms': `${t.transformMs}ms`,
    '--hsc-identity-delay': `${Math.max(0, t.identityAtMs - t.transformAtMs)}ms`,
    '--hsc-ready-delay': `${Math.max(0, t.readyAtMs - t.transformAtMs)}ms`,
    '--hsc-ready-ms': `${t.readyMs}ms`,
    '--hsc-glow-x': `${dest.left + dest.width / 2}px`,
    '--hsc-glow-y': `${dest.top + dest.height / 2}px`,
    '--hsc-glow-r': `${Math.max(dest.width, dest.height) * 0.9}px`,
  } as CSSProperties;

  return (
    <div ref={layerRef} className="hsc-layer" style={vars}>
      {/* §10: a slightly deepened scrim + a localized hero-accent light source behind center stage.
          Both are STATIC gradients — only their opacity (and the glow's transform) animate. */}
      <div className="hsc-scrim" aria-hidden="true" />
      <div className="hsc-glow" aria-hidden="true" />

      {/* The selected-card clone (§8): outer wrapper = fixed at the source rect, the WAAPI travel target
          (all keyframes are viewport-px transforms); inner card = the real big-herocard markup at natural
          size, statically scaled to fit the source. `hsc-chrome-out` starts the §13 chrome dissolve;
          `hsc-done` hides the whole card once the clean portrait owns the stage (art only). */}
      <div
        ref={cloneWrapRef}
        className={`hsc-clone${materialized && art ? ' hsc-chrome-out' : ''}${state.phase === 'ready' || state.phase === 'launching' ? (art ? ' hsc-done' : '') : ''}`}
        style={{ left: source.left, top: source.top, width: source.width, height: source.height }}
        aria-hidden="true"
      >
        <div className="herocard big hsc-clone-card" style={{ width: BIG_CARD_W, transform: `scale(${k})` }}>
          <div ref={frameRef} className="hcframe">
            <div className="hcname">{hero.name}</div>
            {art ? <img decoding="sync" className="hcframe-art" src={art} alt="" draggable={false} /> : <Icon name="anvil" />}
            <div className="hchp">
              <Icon name="heart" />
              {hero.resolve}
              {hero.armor > 0 && <span className="hcarmor">+{hero.armor}</span>}
            </div>
          </div>
          {/* The resting face only (difficulty + tip) — the hover face never shows on a clone nobody can
              hover, and it dissolves with the rest of the chrome. */}
          <div className="hcbelow">
            {tip && (
              <div className="hcmeta">
                <span className={`hcdiff d-${tip.difficulty.toLowerCase()}`}>{tip.difficulty}</span>
                {SHOW_HERO_TIPS && <span className="hctip">{tip.tip}</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Layer B (§13): the clean portrait — same art file, soft-masked edges, no chrome. Fixed at its
          FINAL bounds; the entrance animation shrinks it back to the card crop and releases. */}
      {art && portrait && (() => {
        // The RING + circular clip (owner ask 2026-08-21): at the flash the artwork snaps to a circle sitting
        // just inside the heroportrait ring. Both are anchored on the portrait's center + the tuner's Ring
        // nudges; the clip circle is computed in the PORTRAIT's own coordinate space so ring and clip can
        // never drift apart, whatever the knobs say. RING_INSET keeps the art under the ring's inner edge.
        const fx = getHeroCeremonyConfig();
        // Ring offsets AND diameter are reference px at the 1440 stage — scaled so the ring keeps its exact
        // relationship to the portrait at every resolution (owner report: sizing off on other monitors).
        const k = stageScale(window.innerWidth, window.innerHeight);
        const ringSize = fx.ringSize * k;
        const cx = portrait.bounds.left + portrait.bounds.width / 2 + fx.ringX * k;
        const cy = portrait.bounds.top + portrait.bounds.height / 2 + fx.ringY * k;
        const RING_INSET = 10 * k;
        // The circle is the SMALLER of "just inside the ring" and the artwork's own inscribed circle. Found
        // live on the owner's tuned look (704px ring around ~400px art): a ring-derived radius larger than
        // the element contains the whole rectangle and clips nothing — the art stayed square in the ring.
        const clipR = Math.max(20, Math.min(
          ringSize / 2 - RING_INSET,
          Math.min(portrait.bounds.width, portrait.bounds.height) / 2,
        ));
        return (
          <>
            <div
              ref={portraitRef}
              className={`hsc-portrait${flashed ? ' hsc-circular' : ''}`}
              style={{
                left: portrait.bounds.left, top: portrait.bounds.top,
                width: portrait.bounds.width, height: portrait.bounds.height,
                transform: transformTo(portrait.bounds, portrait.crop), opacity: 0.35,
                ...(flashed
                  ? { clipPath: `circle(${clipR.toFixed(1)}px at ${(cx - portrait.bounds.left).toFixed(1)}px ${(cy - portrait.bounds.top).toFixed(1)}px)` }
                  : {}),
              }}
              aria-hidden="true"
            >
              <img decoding="sync" src={art} alt="" draggable={false} />
            </div>
            {flashed && (
              <>
                <img decoding="sync"
                  className="hsc-ring"
                  src={ringArt}
                  alt=""
                  draggable={false}
                  style={{ left: cx - ringSize / 2, top: cy - ringSize / 2, width: ringSize, height: ringSize }}
                  aria-hidden="true"
                />
                {/* The FLASH itself: one-shot, mounts with the ring and burns out via CSS animation. */}
                <div
                  className="hsc-flash"
                  style={{ left: cx, top: cy, '--hsc-flash-r': `${(ringSize * 0.75).toFixed(0)}px` } as CSSProperties}
                  aria-hidden="true"
                />
              </>
            )}
          </>
        );
      })()}

      {/* §14: identity + confirmation, anchored under the portrait. Mounted at the materializing beat;
          the staggered entrances are CSS animations delayed by timing-object offsets. */}
      {materialized && (
        <div className="hsc-identity" style={{ top: dest.top + dest.height + 18 }}>
          {/* The PLATE (owner ask 2026-08-21): a dark gradient pill the name + power sit inside. It takes the
              tuner's Name offsets — moving "the name" moves the plate with both lines riding it — while the
              Power offsets position the power line WITHIN the plate. */}
          <div className="hsc-plate">
            <div className="hsc-name">{hero.name}</div>
            <div className="hsc-power">{hero.power.name}</div>
          </div>
          <button
            ref={startBtnRef}
            className="hsc-start pressable"
            disabled={!ceremonyCanLaunch(state)}
            onClick={onStart}
          >
            Start Game
          </button>
        </div>
      )}

      {/* §16: announce readiness to assistive tech. Visually hidden, polite. */}
      <div className="hsc-live" aria-live="polite">
        {pi >= phaseIndex('ready') ? `${hero.name} selected. Start Game is ready.` : ''}
      </div>
    </div>
  );
}
