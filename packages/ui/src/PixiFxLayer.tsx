import { useEffect, useRef } from 'react';
import { pixiFx } from './pixiFx';

/** Mounts the PixiJS WebGL effects overlay (see `pixiFx`) into a fixed, full-viewport,
 *  pointer-events:none div so it draws over the board without intercepting input. The
 *  controller is a singleton, so the combat replay can fire `pixiFx.impact(...)` regardless
 *  of where this lives in the tree. */
export function PixiFxLayer(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const under = underRef.current;
    if (!el || !under) return;
    // `.pixifx` (z110) hosts the particle/burst layer. `.pixifx-under` (z3) hosts the second canvas the
    // persistent shield/reborn bubbles were designed for.
    //
    // NOTE, because the old comment here claimed otherwise: `.pixifx-under` does NOT draw below the cards.
    // Both divs are siblings of `.app`, and `.app` is `position: relative; z-index: 1` — a stacking context —
    // so z3 outranks EVERYTHING inside it, chrome included. The "below the badge/tier chrome" behaviour it
    // documented has not been true since `.app` took a z-index; it went unnoticed because the bubbles became
    // CSS (see Recruit's aura tracker) and that canvas has drawn nothing since. Verified with
    // `document.elementFromPoint`, not by reading the CSS.
    //
    // A def that wants to draw genuinely BENEATH the cards uses `slot: 'under'`, which mounts on a third
    // canvas inside `.app` — see `FxUnderSlot` below.
    pixiFx.attach(el, under);
    return () => pixiFx.detach();
  }, []);
  return (
    <>
      <div ref={underRef} className="pixifx-under" aria-hidden="true" />
      <div ref={ref} className="pixifx" aria-hidden="true" />
    </>
  );
}

/**
 * The host for the UNDER-CARD effects canvas (`slot: 'under'` defs).
 *
 * It has to live INSIDE `.app`, and early in its child list, and that placement is the whole trick — it is
 * the same one `.chargeglyph` uses, for the same reason: `.app` is a stacking context (`z-index: 1`), so a
 * fixed sibling of `.app` at ANY z-index is either wholly above the board or wholly below `.boardbg` (i.e.
 * invisible behind the board art). Only a CHILD of `.app` can sit between the two. `z-index: 0` puts it
 * above `.boardbg` (also z0, but earlier in the tree) and tree order puts it below the zones — so it lands
 * above the board backdrop and beneath every card and its drop shadow.
 *
 * Rendered by `Recruit` rather than by `PixiFxLayer` for that reason alone; the canvas itself is owned by the
 * `pixiFx` singleton, so it survives the `.app` remount a new run causes and simply re-homes here.
 */
export function FxUnderSlot(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pixiFx.setUnderHost(ref.current);
    return () => pixiFx.setUnderHost(null);
  }, []);
  return <div ref={ref} className="pixifx-below" aria-hidden="true" />;
}
