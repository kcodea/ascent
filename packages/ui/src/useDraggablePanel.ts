import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/**
 * Drag-by-header + resize for the floating DEV panels (SFX mixer, Lunge tuner). Position (left/top) is
 * React-controlled via the returned `panelStyle` (set on header drag); size is left to the browser's native
 * CSS `resize: both` and only *recorded* (never re-applied by React), so the two never fight. Both persist to
 * `localStorage['ascent.devpanel.<key>']` and restore when the panel re-opens.
 *
 * Usage: `const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('sfx');` then
 *   `<div className="sfxmix" ref={panelRef} style={panelStyle}>`
 *   `  <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>…</div>`
 */
interface Saved { left?: number; top?: number; width?: number; height?: number; }

export function useDraggablePanel(key: string): {
  panelRef: (el: HTMLDivElement | null) => void;
  /** The attached panel element. `panelRef` is a CALLBACK ref (it has no `.current`), so a caller that needs
   *  to measure its own panel — e.g. a tuner's "demo" button placing the FX beside the panel — reads it here. */
  panelElRef: RefObject<HTMLDivElement | null>;
  headerPointerDown: (e: ReactPointerEvent) => void;
  panelStyle: CSSProperties;
} {
  const storageKey = `ascent.devpanel.${key}`;
  const read = useCallback((): Saved => {
    try { return (JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Saved | null) ?? {}; } catch { return {}; }
  }, [storageKey]);
  const write = useCallback((patch: Saved): void => {
    try { localStorage.setItem(storageKey, JSON.stringify({ ...read(), ...patch })); } catch { /* ignore */ }
  }, [read, storageKey]);

  // Position is React state (so the panel re-renders as it's dragged); clamp a saved off-screen panel back in.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(() => {
    const s = read();
    if (s.left == null || s.top == null) return null;
    return { left: Math.min(s.left, window.innerWidth - 60), top: Math.min(s.top, window.innerHeight - 30) };
  });
  const posRef = useRef(pos);
  posRef.current = pos;

  const elRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  // Callback ref: runs when the panel div attaches (open) / detaches (close), so size restore + the
  // ResizeObserver are set up each time it opens — not just on first parent mount (the panel unmounts on close).
  const panelRef = useCallback((el: HTMLDivElement | null): void => {
    elRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const s = read();
    if (s.width) el.style.width = `${s.width}px`;     // restore size imperatively → native CSS resize owns it
    if (s.height) el.style.height = `${s.height}px`;  //   afterward, with no React style fighting the grip
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => write({ width: el.offsetWidth, height: el.offsetHeight }));
      ro.observe(el);
      roRef.current = ro;
    }
  }, [read, write]);

  const headerPointerDown = useCallback((e: ReactPointerEvent): void => {
    if (e.button !== 0) return;
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const startLeft = r.left, startTop = r.top, startX = e.clientX, startY = e.clientY;
    setPos({ left: startLeft, top: startTop }); // pin to current spot (switch from the CSS bottom-right anchor)
    const move = (ev: globalThis.PointerEvent): void => {
      const left = Math.min(window.innerWidth - 60, Math.max(0, startLeft + ev.clientX - startX));
      const top = Math.min(window.innerHeight - 30, Math.max(0, startTop + ev.clientY - startY));
      setPos({ left, top });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (posRef.current) write(posRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  }, [write]);

  const panelStyle: CSSProperties = pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : {};
  return { panelRef, panelElRef: elRef, headerPointerDown, panelStyle };
}
