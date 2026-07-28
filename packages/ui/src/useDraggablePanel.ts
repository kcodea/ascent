import {
  createContext, useCallback, useContext, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * Lets a floating DEV panel close itself. DevMenu (which owns the open/closed set) provides `close`; every panel
 * gets a ✕ button + click-outside-to-close for free through `useDraggablePanel`, keyed by its panel id.
 */
export const DevPanelContext = createContext<{ close: (key: string) => void }>({ close: () => { /* no-op */ } });

/**
 * Drag-by-header + resize for the floating DEV panels (SFX mixer, Lunge tuner). Position (left/top) is
 * React-controlled via the returned `panelStyle` (set on header drag); size is left to the browser's native
 * CSS `resize: both` and only *recorded* (never re-applied by React), so the two never fight. Both persist to
 * `localStorage['ascent.devpanel.<key>']` and restore when the panel re-opens.
 *
 * Also injects a top-right ✕ close button into every panel and tags its root `data-devpanel="<key>"` so the
 * shared click-outside handler (DevMenu) can tell a click landed inside SOME panel. Both go through this hook so
 * every tuner gets them with no per-panel wiring — the panel just needs `ref={panelRef}` on its root.
 *
 * Usage: `const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('sfx');` then
 *   `<div className="sfxmix" ref={panelRef} style={panelStyle}>`
 *   `  <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>…</div>`
 */
interface Saved { left?: number; top?: number; width?: number; height?: number; }

export function useDraggablePanel(key: string): {
  panelRef: (el: HTMLDivElement | null) => void;
  headerPointerDown: (e: ReactPointerEvent) => void;
  panelStyle: CSSProperties;
} {
  const { close } = useContext(DevPanelContext);
  const closeRef = useRef(close);
  closeRef.current = close;

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
    // Tag the root so the shared click-outside handler can detect clicks inside ANY dev panel, and inject a
    // top-right ✕ close button once (idempotent). Done imperatively here so every tuner gets it via the hook
    // alone — no per-panel JSX. The button is appended as a trailing child (outside React's fiber tree, so
    // reconciliation leaves it alone) and rides along when React removes the root on close.
    el.dataset.devpanel = key;
    if (!el.querySelector(':scope > .devpanel-close')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'devpanel-close';
      btn.title = 'Close panel';
      btn.setAttribute('aria-label', 'Close panel');
      btn.textContent = '✕';
      btn.addEventListener('pointerdown', (ev) => ev.stopPropagation()); // don't start a header drag
      btn.addEventListener('click', () => closeRef.current(key));
      el.appendChild(btn);
    }
    const s = read();
    if (s.width) el.style.width = `${s.width}px`;     // restore size imperatively → native CSS resize owns it
    if (s.height) el.style.height = `${s.height}px`;  //   afterward, with no React style fighting the grip
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => write({ width: el.offsetWidth, height: el.offsetHeight }));
      ro.observe(el);
      roRef.current = ro;
    }
  }, [read, write, key]);

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
  return { panelRef, headerPointerDown, panelStyle };
}
