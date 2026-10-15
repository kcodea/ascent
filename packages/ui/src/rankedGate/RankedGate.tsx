import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { sfx } from '../sfx';
import { gateFx, type GateCrystal, type GateSeam } from './gateFx';
import { registerRankedGate, type RankedGateOptions } from './rankedGateController';
import {
  RANKED_GATE_TIMING, rankedGateCloseTimeline, rankedGateCrystalAt, rankedGateCssVars, rankedGateEndTimeline, rankedGateOpenTimeline,
  type RankedGatePhase,
} from './rankedGateTiming';
import './rankedGate.css';

// BASE_URL-relative, NOT root-absolute: itch serves the game from a CDN sub-path, where '/frames/...' 404s
// (publicAssetPaths.test.ts). The stylesheet's own `url('/frames/...')` is rewritten by Vite at build time.
const CRYSTAL_SRC = `${import.meta.env.BASE_URL}frames/ranked-gate-crystal.webp`;

/**
 * THE RANKED GATE (owner 2026-10-12): the transition from "Yes, let's go." to hero select. Two painted doors grind
 * in from the sides and slam shut over the mode picker, with smoke, sparks and blue embers off the impact.
 *
 * THE CRYSTAL (owner 2026-10-13): the shut gate then WAITS. Its centre diamond forms a blue crystal, which pulses
 * until the player presses it; the press shatters it, the doors shudder, and they grind open on hero select. So
 * the sequence is two clocks with the player's own hand between them (rankedGateTiming.ts).
 *
 * THE END-GAME GATE (owner 2026-10-13): the same doors for the fight that ends a game, as the `end` variant, which
 * is the gate of 2026-10-12: close, slam, a one second hold, shudder, open, with no crystal and nothing to press.
 * The end screen is what is swapped in behind them (endGameGate.ts; asked for by the combat screen's End Combat gem).
 *
 * Mounted in Game, above every screen, because it must outlive the Title: the swap to hero select (`onShut`)
 * happens BEHIND the shut doors and unmounts the Title. The Title only ever calls `requestRankedGate`
 * (rankedGateController.ts); this component registers the function that plays it.
 *
 * The motion is CSS, keyed off the root's `is-<phase>` class, `transform` + `opacity` only (rankedGate.css). The
 * particles are the gate's own Pixi layer (gateFx.ts), fed screen positions measured ONCE per cue. The sounds are
 * `sfx.gate`; audio never blocks the sequence.
 *
 * It renders nothing between gates. While it plays it covers the screen and takes every pointer event, so the
 * only thing that can be pressed is the crystal, and only once it is armed. The crystal is a real button: it takes
 * focus when it arms, so Enter or Space opens the gate too. Reduced motion skips the gate entirely: the swap
 * happens at once, with no crystal to press.
 */
export function RankedGate(): JSX.Element | null {
  const [phase, setPhase] = useState<RankedGatePhase | null>(null);
  const doorsRef = useRef<HTMLDivElement | null>(null);
  const crystalRef = useRef<HTMLButtonElement | null>(null);
  const timers = useRef<number[]>([]);
  /** The sequence in flight: its `onShut` (until it has run) and the promise's resolver. */
  const live = useRef<{ onShut: (() => void) | null; done: () => void; opts?: RankedGateOptions; held?: boolean; cancelled?: boolean } | null>(null);
  /** The press on the armed crystal. Set by the sequence; null whenever the crystal cannot be pressed. */
  const pressRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const clearTimers = (): void => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
    const later = (ms: number, fn: () => void): void => { timers.current.push(window.setTimeout(fn, ms)); };
    /** The doors' box on screen, read once per cue (never per frame). Null before the doors have painted. */
    const doorsBox = (): DOMRect | null => {
      const r = doorsRef.current?.getBoundingClientRect();
      return r && r.width > 0 ? r : null;
    };
    const seam = (): GateSeam | null => {
      const r = doorsBox();
      return r ? { x: r.left + r.width / 2, top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) } : null;
    };
    const crystal = (): GateCrystal | null => {
      const r = doorsBox();
      return r ? rankedGateCrystalAt(r) : null;
    };
    const shut = (): void => {
      const cur = live.current;
      if (!cur?.onShut) return;
      const fn = cur.onShut;
      cur.onShut = null;
      try { fn(); } catch (err) { console.error('[rankedGate] the swap behind the gate failed', err); }
    };
    const finish = (): void => {
      clearTimers();
      pressRef.current = null;
      shut(); // a sequence cut short still owes the swap
      const cur = live.current;
      live.current = null;
      setPhase(null);
      gateFx.release(); // whatever is still drifting fades out, then the layer frees its WebGL context
      cur?.done();
    };
    const t = RANKED_GATE_TIMING;

    /** VERSUS: open the doors with no shatter (the gate window closed, or the press was refused). */
    const openQuiet = (): void => {
      const cur = live.current;
      if (!cur) return;
      pressRef.current = null;
      cur.held = false;
      clearTimers();
      sfx.gateHum(false, 60);
      gateFx.stopAmbient();
      const at = rankedGateOpenTimeline(t);
      sfx.gate('open');
      setPhase('opening');
      later(at.endAt - at.openAt, finish);
    };

    /** THE SECOND CLOCK: the crystal was pressed. It shatters, the doors shudder, then grind open. */
    const open = (): void => {
      if (!pressRef.current) return;
      pressRef.current = null;
      // VERSUS: the press is the player's "ready". The crystal holds (armed, no longer pressable) until the match
      // answers, then shatters onto what was swapped in, or the doors part quietly if the window closed.
      const onPress = live.current?.opts?.onPress;
      if (onPress && live.current) {
        const cur = live.current;
        cur.held = true;
        void onPress().catch(() => false).then((ok) => {
          if (live.current !== cur || !cur.held) return;
          cur.held = false;
          if (ok) breakOpen(); else openQuiet();
        });
        return;
      }
      breakOpen();
    };
    const breakOpen = (): void => {
      const at = rankedGateOpenTimeline(t);
      setPhase('shatter');
      sfx.gateHum(false, 60); // the hum is gone under the break
      sfx.gate('shatter');
      // The cinematic hit (`intro`): first played on the press of "Yes, let's go." (2026-10-12), moved here the
      // next day (owner: "move the 'ding' tone to when the crystal explodes, not upon clicking 'yes continue'").
      sfx.gate('intro');
      sfx.gate('rattle');
      gateFx.stopAmbient();
      const c = crystal();
      if (c) gateFx.shatter(c);
      const s = seam();
      if (s) gateFx.shudder(s, t.shudderMs);
      later(at.openSoundAt, () => sfx.gate('open'));
      later(at.openAt, () => setPhase('opening'));
      later(at.endAt, finish);
    };

    registerRankedGate((onShut, variant, opts) => new Promise<void>((resolve) => {
      if (live.current) { resolve(); return; } // the controller already joins a gate in flight; belt and braces
      live.current = { onShut, done: resolve, ...(opts ? { opts } : {}) };
      const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) { finish(); return; }

      gateFx.warm();
      setPhase('closing');
      sfx.gate('close');
      const slam = (): void => {
        setPhase('shut');
        sfx.gate('slam');
        const s = seam();
        if (s) gateFx.slam(s);
      };

      // THE END-GAME GATE: one clock, no crystal. Slam, the end screen swapped in behind the doors, a one second
      // hold, the shudder, open.
      if (variant === 'end') {
        const end = rankedGateEndTimeline(t);
        later(end.slamAt, slam);
        later(end.handoffAt, shut);
        later(end.shudderAt, () => {
          shut(); // belt and braces: the doors never part on a screen that has not been swapped
          setPhase('shudder');
          sfx.gate('rattle');
          const s = seam();
          if (s) gateFx.shudder(s, t.shudderMs);
        });
        later(end.openSoundAt, () => sfx.gate('open'));
        later(end.openAt, () => setPhase('opening'));
        later(end.endAt, finish);
        return;
      }

      // THE FIRST CLOCK: from the press of "Yes" to the crystal being ready.
      const at = rankedGateCloseTimeline(t);
      later(at.slamAt, slam);
      later(at.handoffAt, shut);
      later(at.formAt, () => {
        setPhase('forming');
        sfx.gate('form', 0, { atMs: t.formSoundFadeAtMs, overMs: t.formSoundFadeMs }); // it eases off as the gem cools
        const c = crystal();
        if (c) gateFx.gather(c, t.crystalFormMs);
      });
      later(at.armedAt, () => {
        shut(); // belt and braces: the gate is never openable onto a screen that has not been swapped
        if (live.current?.cancelled) { openQuiet(); return; } // VERSUS: the window closed while the doors shut
        pressRef.current = open;
        setPhase('armed');
        const c = crystal();
        if (c) gateFx.ambient(c);
      });
    }), () => {
      // VERSUS: cancelled from outside. Before the crystal is armed, it opens quietly the moment it would have armed.
      const cur = live.current;
      if (!cur) return;
      cur.cancelled = true;
      if (pressRef.current || cur.held) openQuiet();
    });

    return () => {
      registerRankedGate(null);
      // Unmounted mid-sequence (a dev hot reload): stop the clock, drop the FX, and still make the swap.
      const cur = live.current;
      clearTimers();
      pressRef.current = null;
      sfx.gateHum(false, 60);
      gateFx.clear();
      gateFx.release();
      if (cur) { shut(); live.current = null; cur.done(); }
    };
  }, []);

  // The armed crystal takes focus, so the keyboard can open the gate (a pointer press does not need it).
  useEffect(() => {
    if (phase === 'armed') crystalRef.current?.focus({ preventScroll: true });
  }, [phase]);

  // THE HUM (owner 2026-10-13): the armed crystal hums for as long as the mouse is on it. The button's own
  // enter / leave drive it. Two cases they cannot see are covered here: the crystal ARMING under a mouse that is
  // already resting on it (no enter fires for a pointer that did not move), and the window losing focus or the
  // tab being hidden while the mouse is still there (no leave fires). Whenever the crystal stops being armed the
  // hum stops.
  useEffect(() => {
    if (phase !== 'armed') { sfx.gateHum(false); return undefined; }
    if (crystalRef.current?.matches(':hover')) sfx.gateHum(true);
    const quiet = (): void => sfx.gateHum(false);
    const hidden = (): void => { if (document.hidden) sfx.gateHum(false); };
    window.addEventListener('blur', quiet);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', quiet);
      document.removeEventListener('visibilitychange', hidden);
      sfx.gateHum(false);
    };
  }, [phase]);

  if (!phase) return null;
  const armed = phase === 'armed';
  const press = (): void => { pressRef.current?.(); };
  return (
    <div className={`rgate is-${phase}`} style={rankedGateCssVars() as CSSProperties}>
      <div className="rgate-doors" ref={doorsRef}>
        <div className="rgate-door rgate-door-l" aria-hidden="true"><div className="rgate-face" /></div>
        <div className="rgate-door rgate-door-r" aria-hidden="true"><div className="rgate-face" /></div>
        <div className="rgate-flash" aria-hidden="true" />
        {/* THE CRYSTAL: there from the moment the diamond starts to form it until it has shattered. It acts on the
            PRESS (pointer down), like "Yes, let's go."; `onClick` is the keyboard's path, and `pressRef` going null
            on the first of the two makes the second a no-op. */}
        {(phase === 'forming' || armed || phase === 'shatter') && (
          <button
            ref={crystalRef}
            className="rgate-crystal"
            // No menu hover tick or click thock on the crystal (owner 2026-10-13: "remove the UI highlight click
            // sound when highlighting the gem"): it has its own hum under the pointer and its own shatter on the
            // press. `data-nohoversfx` is the app-wide opt-out both delegated listeners in Game.tsx honour.
            data-nohoversfx=""
            aria-label="Shatter the crystal to open the gate"
            aria-disabled={!armed}
            tabIndex={armed ? 0 : -1}
            onPointerDown={(e) => { if (e.button === 0) press(); }}
            onClick={press}
            // The hum is a MOUSE hover's: a finger's touch is already the press.
            onPointerEnter={(e) => { if (armed && e.pointerType === 'mouse') sfx.gateHum(true); }}
            onPointerLeave={() => sfx.gateHum(false)}
          >
            {/* The light behind it: the pulsing glow in its `-pulse` wrapper, and its steady twin, fixed at the
                pulse's peak, which a hover cross-fades to (owner 2026-10-13). */}
            <span className="rgate-crystal-pulse" aria-hidden="true"><span className="rgate-crystal-glow" /></span>
            <span className="rgate-crystal-glow-hi" aria-hidden="true" />
            {/* THE GEM: the image and everything painted on it. It alone carries a transform (growing from a point
                as it forms, flying apart as it shatters); while it waits it is perfectly still (owner 2026-10-13),
                and the pulse is light: the glow behind, and a brightened copy fading in and out. */}
            <span className="rgate-crystal-gem">
              {/* Its heat while it forms: a soft white bloom in the crystal's own shape, behind the body. */}
              <span className="rgate-crystal-heat" aria-hidden="true" />
              <span className="rgate-crystal-body"><img decoding="sync" src={CRYSTAL_SRC} alt="" draggable={false} /></span>
              <span className="rgate-crystal-pulse" aria-hidden="true"><span className="rgate-crystal-lit" /></span>
              <span className="rgate-crystal-lit-hi" aria-hidden="true" />
              {/* White-hot while it forms, cooling to the blue beneath. */}
              <span className="rgate-crystal-hot" aria-hidden="true">
                {/* Three plies, each blurred differently and warping on its own loop: a soft edge that swims. */}
                <span className="rgate-crystal-ply" /><span className="rgate-crystal-ply" /><span className="rgate-crystal-ply" />
              </span>
              <span className="rgate-crystal-glint" aria-hidden="true"><span className="rgate-crystal-twinkle" /></span>
            </span>
            <span className="rgate-crystal-burst" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Get the gate ready before it is asked for (the ranked confirmation calls this as it opens): decode the door and
 *  crystal images and the cues, and start the FX layer, so the first gate of a session has its art, sound and
 *  sparks. `fx: false` leaves the FX layer alone (the gate starts it itself as it plays): the combat screen warms
 *  the END-GAME gate that way, since most fights it warms for do not end the game and a started layer would sit
 *  holding a WebGL context. */
export function warmRankedGate(opts: { fx?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  for (const art of ['ranked-gate-left.webp', 'ranked-gate-right.webp', 'ranked-gate-crystal.webp']) {
    const img = new Image();
    img.decoding = 'async';
    img.src = `${import.meta.env.BASE_URL}frames/${art}`;
  }
  sfx.warmGate();
  if (opts.fx !== false) gateFx.warm();
}
