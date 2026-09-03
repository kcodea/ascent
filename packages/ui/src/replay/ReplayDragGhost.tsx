/**
 * REPLAY VIEWER — the drag ghost (owner ask 2026-08-19: "1:1 hands").
 *
 * When playback advances into a frame produced by a drag, the player parks the recorded `DragPath` on
 * `store.replayDragGhost` and holds the frame back for the recorded drag duration. This layer renders the
 * ghost: a small card plate (art + name) with the game's closed-fist drag cursor riding its centre,
 * following the recorded polyline via ONE Web Animations API transform animation — compositor-only, no
 * per-frame JS, no layout reads (the viewport is measured once per ghost). The frame then lands exactly
 * where (and when) the real drop did; the player clears the store slice, which unmounts the ghost.
 *
 * Self-gates on `replayDragGhost` (null outside a flight) and never intercepts pointer events.
 */
import React, { useLayoutEffect, useRef } from 'react';
import { Card } from '../Card';
import { useGame } from '../store';

// BASE_URL-relative, NOT root-absolute — itch serves the game from a CDN sub-path where '/cursors/…' 404s.
const FIST_SRC = `${import.meta.env.BASE_URL}cursors/hand_closed.svg`;

export function ReplayDragGhost(): React.ReactElement | null {
  const ghost = useGame((s) => s.replayDragGhost);
  const moverRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = moverRef.current;
    if (!ghost || !el || typeof el.animate !== 'function') return undefined;
    // Fractions → pixels ONCE per ghost (the viewport can't change mid-flight in any way worth chasing).
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pts = ghost.pts.map(([fx, fy]) => [fx * w, fy * h] as const);
    // Keyframe offsets are DISTANCE-proportional: capture sampled at a fixed rate, so equal time ≈ equal
    // per-segment weight — but simplification merges collinear runs, and distance weighting reconstructs
    // constant speed along them (closest recoverable approximation without per-point timestamps).
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    }
    const total = cum[cum.length - 1]!;
    const frames = pts.map((p, i) => ({
      offset: total > 0 ? Math.min(1, cum[i]! / total) : i / (pts.length - 1),
      transform: `translate3d(${p[0]}px, ${p[1]}px, 0)`,
    }));
    // A zero-length path (grab == drop after rounding) still shows the ghost holding in place for durMs.
    const anim = el.animate(frames, { duration: Math.max(1, ghost.durMs), easing: 'linear', fill: 'both' });
    return () => anim.cancel();
  }, [ghost]);

  if (!ghost) return null;
  return (
    <div className="replay-dragghost" aria-hidden="true">
      <div className="ghostmover" ref={moverRef} key={ghost.key}>
        {/* The REAL card plate at in-game size (the wrapper defines the same --cw/--ch every zone uses), so
            the ghost is literally what the player was holding (owner report 2026-08-19 - the first version
            was a tiny generic tile). Falls back to nothing rather than a wrong plate when no view resolved. */}
        {ghost.view ? (
          <div className="ghostcardwrap">
            <Card card={ghost.view} suppressPop />
          </div>
        ) : null}
        <img decoding="sync" className="ghostfist" src={FIST_SRC} alt="" draggable={false} />
      </div>
    </div>
  );
}
