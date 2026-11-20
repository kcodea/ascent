/**
 * THE FPS COUNTER (Settings > Video > Show FPS counter, R-SETTINGS-FPS-01, 2026-11-20). Off by default. A small fixed
 * readout in the top right corner: frames drawn over the last half second.
 *
 * COSTS NOTHING MEASURABLE (docs/performance.md): React renders it once; the number is a `textContent` write on a ref
 * twice a second, its own requestAnimationFrame loop only counts frames, and it runs only while the switch is on (the
 * component is not mounted otherwise). No layout reads, no animation, `pointer-events: none`, so it never takes a click.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import './fpsCounter.css';

const KEY = 'ascent.fpsCounter';
const listeners = new Set<() => void>();
let on: boolean | null = null;

export function fpsCounterOn(): boolean {
  if (on === null) { try { on = localStorage.getItem(KEY) === '1'; } catch { on = false; } }
  return on;
}
export function setFpsCounterOn(v: boolean): void {
  on = v;
  try { if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* lasts this session */ }
  for (const l of listeners) l();
}
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useFpsCounterOn = (): boolean => useSyncExternalStore(subscribe, fpsCounterOn, fpsCounterOn);

/** Mounted once by Game; renders nothing while the switch is off. */
export function FpsCounter(): JSX.Element | null {
  const show = useFpsCounterOn();
  return show ? <FpsReadout /> : null;
}

function FpsReadout(): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frames = 0;
    let from = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      frames++;
      const dt = now - from;
      if (dt >= 500) {
        if (ref.current) ref.current.textContent = `${Math.round((frames * 1000) / dt)} FPS`;
        frames = 0;
        from = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span ref={ref} className="fps-counter" aria-hidden="true">FPS</span>;
}
