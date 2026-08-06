import { useEffect, useState } from 'react';
import { alignmentsOf, boardHasCelestial } from '@game/sim';
import { AlignmentArcLayer } from './alignmentArcLayer';
import { alignArcColor, getAlignArcConfig, onAlignArcChange } from './alignArcConfig';
import type { ArcMarker } from './alignmentArcSync';
import { pixiFx } from './pixiFx';
import { useGame } from './store';

/**
 * Mounts the CELESTIAL ALIGNMENT ARC layer and keeps it in step with the board.
 *
 * Rendering lives in `alignmentArcLayer` (Pixi) and the bookkeeping in `alignmentArcSync` (pure); this is the
 * React seam that owns the lifetime and answers the only question those two can't: WHERE each card is.
 *
 * Positions come from a `getBoundingClientRect()` sweep of the warband cards, taken when the board changes or
 * the window resizes — never per frame, per the handoff's performance rules. The under-canvas is
 * `position: fixed; inset: 0`, so viewport coordinates ARE arc coordinates and no mapping is needed.
 *
 * The sweep is deferred to the next frame because the row animates: a card that has just been played or slid
 * is still mid-transition when React commits, so measuring immediately would pin the arc to where the card
 * WAS. One rAF lets layout settle first.
 *
 * IDLE: the under-canvas ticker is stopped and the main ticker idles when nothing has live work, so after any
 * sync we register a throwaway updater to force one presented frame and then drop straight back to idle. The
 * board never holds a permanent update loop for these indicators.
 */
export function AlignmentArcs() {
  const board = useGame((s) => s.run.board);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  // The live layer is STATE, not a ref, so the sync effect below depends on it. With a ref, React's
  // StrictMode double-invoke (mount -> destroy -> remount in dev) could leave a sync writing into a layer
  // that had already been destroyed, and the arcs silently never appeared — which is exactly what happened.
  const [layer, setLayer] = useState<AlignmentArcLayer | null>(null);

  useEffect(() => {
    const made = new AlignmentArcLayer();
    const unmount = pixiFx.mountLayer(made.container, 'under');
    setLayer(made);
    return () => {
      unmount();
      made.destroy();
      setLayer((cur) => (cur === made ? null : cur));
    };
  }, []);

  useEffect(() => {
    if (!layer) return;

    /** Present exactly one frame, then let the canvas idle again. */
    const present = (): void => {
      const stop = pixiFx.addUpdater(() => { /* nothing to animate — the registration is the wake */ });
      window.setTimeout(stop, 48);
    };

    const resync = (): void => {
      const cfg = getAlignArcConfig();
      // Alignment is a RECRUIT-phase property that LOCKS at combat start. Until the combat-side read is
      // wired, the arcs simply stand down in combat rather than showing a live value that would be wrong
      // (deaths and board compression must never re-centre the displayed alignment).
      if (!cfg.on || inCombat || !boardHasCelestial(board)) {
        if (layer.sync([])) present();
        return;
      }
      const aligns = alignmentsOf(board);
      const markers: ArcMarker[] = [];
      board.forEach((card, i) => {
        const el = document.querySelector<HTMLElement>(`.row.warband .card[data-uid="${CSS.escape(card.uid)}"]`);
        if (!el) return; // mid-animation or not mounted — skip rather than guess a position
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        markers.push({
          id: card.uid,
          x: r.left + r.width / 2,
          y: r.bottom + cfg.y,
          width: r.width * (cfg.width / 100),
          color: alignArcColor(aligns[i]!),
        });
      });
      if (layer.sync(markers)) present();
    };

    // Let the row's slide/pop transitions settle before measuring.
    const raf = window.requestAnimationFrame(resync);
    window.addEventListener('resize', resync);
    const offCfg = onAlignArcChange(() => { layer.refreshBlur(); resync(); });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resync);
      offCfg();
    };
  }, [board, inCombat, layer]);

  return null;
}
