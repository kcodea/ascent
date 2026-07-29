import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject,
} from 'react';

/**
 * Lets a floating DEV panel close itself. DevMenu (which owns the open/closed set) provides `close`; every panel
 * gets a ✕ button for free through `useDraggablePanel`, keyed by its panel id.
 */
export const DevPanelContext = createContext<{ close: (key: string) => void }>({ close: () => { /* no-op */ } });

// --- Stacking + open-placement, shared across all open panels ---------------------------------------------
// Bring-to-front: a monotonic z counter; opening a panel or clicking anywhere in it stamps the next value so it
// rises above the others. Base 600 sits above the panels' CSS z-index (≤520) and well below toast/HUD (9999+).
let zTop = 600;
// Cascade placement: each open panel holds a "slot" (0,1,2…); panel N opens at top-left + slot*step so a second
// panel lands slightly down-right of the first, etc. Slots are freed on close and re-used lowest-first, so a lone
// panel always opens at the top-left corner. Keyed by panel id → claim/release is idempotent (StrictMode-safe).
const slotByKey = new Map<string, number>();
function claimSlot(key: string): number {
  const existing = slotByKey.get(key);
  if (existing !== undefined) return existing;
  const used = new Set(slotByKey.values());
  let i = 0; while (used.has(i)) i++;
  slotByKey.set(key, i);
  return i;
}
function releaseSlot(key: string): void { slotByKey.delete(key); }
const CASCADE_BASE = 16, CASCADE_STEP = 34, CASCADE_WRAP = 12;
function slotPos(slot: number): { left: number; top: number } {
  const off = (slot % CASCADE_WRAP) * CASCADE_STEP; // wrap so a long stack never marches off-screen
  return { left: CASCADE_BASE + off, top: CASCADE_BASE + off };
}

/**
 * Drag-by-header + resize + stacking for the floating DEV panels (SFX mixer, Lunge tuner, …). Position (left/top)
 * and z-index are React-controlled via the returned `panelStyle`; size is left to the browser's native CSS
 * `resize: both` and only *recorded* (never re-applied by React), so the two never fight. Size persists to
 * `localStorage['ascent.devpanel.<key>']`; POSITION does not persist — a panel opens at a top-left cascade slot
 * each time (see slot helpers above), and rises to the front on open and on any click inside it.
 *
 * Also injects a top-right ✕ close button into every panel and tags its root `data-devpanel="<key>"`. All of this
 * goes through the hook so every tuner gets it with no per-panel wiring — the panel just needs `ref={panelRef}`.
 *
 * Usage: `const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('sfx');` then
 *   `<div className="sfxmix" ref={panelRef} style={panelStyle}>`
 *   `  <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>…</div>`
 */
interface Saved { width?: number; height?: number; }

export function useDraggablePanel(key: string): {
  panelRef: (el: HTMLDivElement | null) => void;
  /** The attached panel element. `panelRef` is a CALLBACK ref (it has no `.current`), so a caller that needs
   *  to measure its own panel — e.g. a tuner's "demo" button placing the FX beside the panel — reads it here. */
  panelElRef: RefObject<HTMLDivElement | null>;
  headerPointerDown: (e: ReactPointerEvent) => void;
  panelStyle: CSSProperties;
  raise: () => void;
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

  // Position (React state so the panel re-renders as it's dragged) starts at this panel's cascade slot; z-index
  // starts at the front. slotRef is claimed on first render so the very first paint is already positioned (the
  // effect below re-claims + frees to stay StrictMode-safe).
  const slotRef = useRef<number | null>(null);
  if (slotRef.current === null) slotRef.current = claimSlot(key);
  const [pos, setPos] = useState<{ left: number; top: number }>(() => slotPos(slotRef.current!));
  const [z, setZ] = useState<number>(() => ++zTop);
  const raise = useCallback((): void => setZ(++zTop), []);
  const raiseRef = useRef(raise);
  raiseRef.current = raise;

  // Claim a slot + rise to front on open; free the slot on close. Keyed claim/release is idempotent, so
  // StrictMode's mount→unmount→mount doesn't leak or drop a slot.
  useEffect(() => {
    const slot = claimSlot(key);
    slotRef.current = slot;
    setPos(slotPos(slot));
    setZ(++zTop);
    return () => releaseSlot(key);
  }, [key]);

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
    // Bring-to-front on ANY click inside the panel (the ✕ stops propagation, so closing doesn't also raise).
    el.addEventListener('pointerdown', () => raiseRef.current());
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
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  }, []);

  const panelStyle: CSSProperties = { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto', zIndex: z };
  return { panelRef, panelElRef: elRef, headerPointerDown, panelStyle, raise };
}
