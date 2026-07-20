import { useState } from 'react';
import type { RiftDef } from '@game/sim';

/**
 * The RIFT button — a purple, slowly-swirling plaque pinned directly ABOVE the End Turn diamond, mounted
 * only while a rift is active on this run. Hovering reveals the rift's rules; clicking PINS them open (the
 * touch path, where there is no hover).
 *
 * It shares the End Turn diamond's stage anchor (`--etb-x/--etb-y`), so it rides the tuner's position the
 * same way the combat Summary pill does. Summary is combat-only and this is recruit-only, so they never
 * co-exist even though they occupy the same slot.
 *
 * Self-contained by design: it owns its open state rather than threading another `useState` through
 * `Recruit.tsx`, which is one of the repo's declared conflict chokepoints.
 *
 * PERF: the swirl is a LOOPING animation, so per `docs/performance.md` it animates **transform only** — a
 * rotating conic-gradient layer behind the plaque, clipped by the border-radius. No looping `filter`,
 * `box-shadow` or `background-position`, all of which repaint every frame.
 */
export function RiftButton({ rift }: { rift: RiftDef }) {
  const [pinned, setPinned] = useState(false);
  return (
    <button
      className={`riftbtn${pinned ? ' pinned' : ''}`}
      onClick={() => setPinned((v) => !v)}
      aria-label={`Rift: ${rift.name} — ${rift.blurb}`}
      aria-expanded={pinned}
    >
      {/* The swirl lives in its own layer so the label never re-rasterises with it. */}
      <span className="riftbtn-swirl" aria-hidden="true" />
      <span className="riftbtn-label">Rift</span>
      <div className="riftbtn-tip" role="tooltip">
        <b>{rift.name}</b>
        <span className="riftbtn-tip-body">{rift.blurb}</span>
      </div>
    </button>
  );
}
