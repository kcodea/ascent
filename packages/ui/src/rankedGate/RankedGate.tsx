import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { sfx } from '../sfx';
import { gateFx, type GateSeam } from './gateFx';
import { registerRankedGate } from './rankedGateController';
import { RANKED_GATE_TIMING, rankedGateCssVars, rankedGateTimeline, type RankedGatePhase } from './rankedGateTiming';
import './rankedGate.css';

/**
 * THE RANKED GATE (owner 2026-10-12): the transition from "Yes, let's go." to hero select. Two painted doors grind
 * in from the sides and slam shut over the mode picker, with smoke and sparks off the impact; a second later they
 * shudder, then grind open on hero select.
 *
 * Mounted in Game, above every screen, because it must outlive the Title: the swap to hero select (`onShut`)
 * happens BEHIND the shut doors and unmounts the Title. The Title only ever calls `requestRankedGate`
 * (rankedGateController.ts); this component registers the function that plays it.
 *
 * THE CLOCK is `rankedGateTimeline` (rankedGateTiming.ts): plain timers set once per sequence. The motion is CSS,
 * keyed off the root's `is-<phase>` class, `transform` + `opacity` only (rankedGate.css). The smoke and sparks are
 * the gate's own Pixi layer (gateFx.ts), fed the seam's screen position, measured ONCE at the slam. The sounds are
 * the owner's four recorded cues (`sfx.gate`); audio never blocks the sequence.
 *
 * It renders nothing between gates. While it plays it covers the screen and takes every pointer event, so nothing
 * under it can be pressed mid-sequence. Reduced motion skips the gate entirely: the swap happens at once.
 */
export function RankedGate(): JSX.Element | null {
  const [phase, setPhase] = useState<RankedGatePhase | null>(null);
  const doorsRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  /** The sequence in flight: its `onShut` (until it has run) and the promise's resolver. */
  const live = useRef<{ onShut: (() => void) | null; done: () => void } | null>(null);

  useEffect(() => {
    const clearTimers = (): void => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
    /** The doors' seam on screen, read once per cue (never per frame). Null before the doors have painted. */
    const seam = (): GateSeam | null => {
      const r = doorsRef.current?.getBoundingClientRect();
      if (!r || r.width === 0) return null;
      return { x: r.left + r.width / 2, top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) };
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
      shut(); // a sequence cut short still owes the swap
      const cur = live.current;
      live.current = null;
      setPhase(null);
      cur?.done();
    };

    registerRankedGate((onShut) => new Promise<void>((resolve) => {
      if (live.current) { resolve(); return; } // the controller already joins a gate in flight; belt and braces
      live.current = { onShut, done: resolve };
      const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) { finish(); return; }

      const t = RANKED_GATE_TIMING;
      const at = rankedGateTimeline(t);
      const later = (ms: number, fn: () => void): void => { timers.current.push(window.setTimeout(fn, ms)); };
      gateFx.warm();
      setPhase('closing');
      sfx.gate('close');
      later(at.slamAt, () => {
        setPhase('shut');
        sfx.gate('slam');
        const s = seam();
        if (s) gateFx.slam(s);
      });
      later(at.handoffAt, shut);
      later(at.shudderAt, () => {
        setPhase('shudder');
        sfx.gate('rattle');
        const s = seam();
        if (s) gateFx.shudder(s, t.shudderMs);
      });
      later(at.openSoundAt, () => sfx.gate('open'));
      later(at.openAt, () => setPhase('opening'));
      later(at.endAt, finish);
    }));

    return () => {
      registerRankedGate(null);
      // Unmounted mid-sequence (a dev hot reload): stop the clock, drop the FX, and still make the swap.
      const cur = live.current;
      clearTimers();
      gateFx.clear();
      if (cur) { shut(); live.current = null; cur.done(); }
    };
  }, []);

  if (!phase) return null;
  return (
    <div className={`rgate is-${phase}`} style={rankedGateCssVars() as CSSProperties} aria-hidden="true">
      <div className="rgate-doors" ref={doorsRef}>
        <div className="rgate-door rgate-door-l"><div className="rgate-face" /></div>
        <div className="rgate-door rgate-door-r"><div className="rgate-face" /></div>
        <div className="rgate-flash" />
      </div>
    </div>
  );
}

/** Get the gate ready before it is asked for (the ranked confirmation calls this as it opens): decode the two door
 *  images and the four cues, and start the FX layer, so the first gate of a session has its art, sound and sparks. */
export function warmRankedGate(): void {
  if (typeof window === 'undefined') return;
  for (const src of ['/frames/ranked-gate-left.webp', '/frames/ranked-gate-right.webp']) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }
  sfx.warmGate();
  gateFx.warm();
}
