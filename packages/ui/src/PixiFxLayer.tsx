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
    // `.pixifx` (z110) hosts the particle/burst layer — over the cards. `.pixifx-under` (z3) hosts the
    // persistent shield/reborn bubbles — over the card art but BELOW the badge/tier/effect chrome.
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
