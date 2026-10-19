import { memo, useEffect, useRef } from 'react';
import { discoverFx, pixiFx, resetDiscoverWarm, warmDiscoverFx } from './pixiFx';
import { PHONE_GPU } from './phoneDiag';
import { crumb } from './crashLog';
import { wipeFx } from './wipeFx';

/** Mounts the PixiJS WebGL effects overlay (see `pixiFx`) into a fixed, full-viewport,
 *  pointer-events:none div so it draws over the board without intercepting input. The
 *  controller is a singleton, so the combat replay can fire `pixiFx.impact(...)` regardless
 *  of where this lives in the tree. */
export function PixiFxLayer({ gameplay = true, inRun = true }: { gameplay?: boolean; inRun?: boolean }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // PHONE (R-TOUCH-GPU-MEMORY-01): the FX canvases exist only while they can be seen. `gameplay` is hero select or a
  // run: the main board layer comes up there (its shader warm-up runs during hero select). `inRun` is the run itself:
  // the under / above slots and the Discover layer come up only then. On the title, the mode home and every menu page
  // all of them are torn down, WebGL contexts and all, so a phone menu holds no FX context. The cost is the warm-up
  // once per run. Desktop ignores both props and keeps the always-mounted layer.
  const phoneActive = PHONE_GPU ? gameplay : true;
  const wanted = useRef(phoneActive);
  wanted.current = phoneActive;
  useEffect(() => {
    const el = ref.current;
    if (!el || !phoneActive) return;
    if (PHONE_GPU) {
      crumb('fx canvases up');
      void pixiFx.attach(el).then(() => { if (!wanted.current) pixiFx.detach(); }); // left gameplay mid-init
      return () => {
        pixiFx.detach();
        discoverFx.detach();
        resetDiscoverWarm();
        wipeFx.release();
        crumb('fx canvases down');
      };
    }
    // `.pixifx` (z110) hosts the particle/burst layer, over the cards.
    //
    // The `.pixifx-under` (z3) canvas that used to mount here is GONE. It existed for the persistent
    // shield/reborn bubbles, which are CSS domes now, so it had drawn nothing for a long time — and its
    // premise was wrong anyway: it never drew below the cards. Both divs were siblings of `.app`, and `.app`
    // is `position: relative; z-index: 1` — a stacking context — so z3 outranked EVERYTHING inside it, chrome
    // included (#792 verified that with `document.elementFromPoint` rather than by reading the CSS).
    //
    // A def that wants to draw genuinely BENEATH the cards uses `slot: 'under'`, which mounts on its own
    // canvas INSIDE `.app` — see `FxUnderSlot` below. That one is unrelated to this deletion.
    pixiFx.attach(el);
    return () => pixiFx.detach();
  }, [phoneActive]); // always true on desktop: one attach for the session, as before
  const phoneRun = PHONE_GPU && gameplay && inRun;
  useEffect(() => {
    if (!phoneRun) return;
    // In the run: the slot canvases (the desktop pre-warm makes them as the main renderer comes up; a phone defers
    // them past hero select) and the Discover layer, on idle.
    void pixiFx.attach(ref.current ?? document.body).then(() => {
      if (!wanted.current) return;
      void pixiFx.ensureUnderSlot();
      void pixiFx.ensureAboveSlot();
    });
    warmDiscoverFx();
  }, [phoneRun]);
  return <div ref={ref} className="pixifx" aria-hidden="true" />;
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
export const FxUnderSlot = memo(function FxUnderSlot(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pixiFx.setUnderHost(ref.current);
    return () => pixiFx.setUnderHost(null);
  }, []);
  return <div ref={ref} className="pixifx-below" aria-hidden="true" />;
});
