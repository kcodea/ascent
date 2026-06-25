import { useEffect, useRef } from 'react';
import { pixiFx } from './pixiFx';

/** Mounts the PixiJS WebGL effects overlay (see `pixiFx`) into a fixed, full-viewport,
 *  pointer-events:none div so it draws over the board without intercepting input. The
 *  controller is a singleton, so the combat replay can fire `pixiFx.impact(...)` regardless
 *  of where this lives in the tree. */
export function PixiFxLayer(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    pixiFx.attach(el);
    return () => pixiFx.detach();
  }, []);
  return <div ref={ref} className="pixifx" aria-hidden="true" />;
}
