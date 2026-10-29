/**
 * SIDEWAYS: A PHONE HELD UPRIGHT PLAYS THE LANDSCAPE GAME TURNED 90 DEGREES (owner 2026-10-29, R-PHONE-SIDEWAYS-01:
 * "Make it so mobile only loads in landscape so it doesn't require a rotate").
 *
 * A phone has no portrait layout: before this, a phone held upright showed a "Rotate your device" screen. Now the stage
 * (stage.ts) lays the game out exactly as it would on that phone in landscape and turns the whole stage a quarter turn
 * clockwise, so the game fills the upright screen sideways and the player just turns the phone (or plays it as it is,
 * with the system's rotation lock on). Android Chrome also LOCKS the screen to landscape on the first tap
 * (`orientationLock.ts`), after which the phone is a real landscape screen and this never applies. iOS has no
 * orientation lock for web pages, so on an iPhone this turned render is the answer.
 *
 * THE VIRTUAL LANDSCAPE FRAME. The turn is ONE transform on `#stage` (`sidewaysTransform`), so it costs nothing per
 * frame. But every measured coordinate the browser hands out would now be in the upright SCREEN frame, while the game
 * lays out, positions and drags in its own (landscape) frame. Rather than convert at hundreds of call sites, the few
 * browser APIs that report screen geometry are wrapped ONCE, on phones only, so the whole game keeps seeing a landscape
 * window:
 *   - pointer / mouse / touch coordinates (`clientX/Y`, `x/y`, `pageX/Y`, `movementX/Y`) of TRUSTED events (the
 *     browser's own). An event the game builds itself (the long-press `contextmenu`, the replayed `pointerout`) is
 *     built from already-mapped values, so it is left alone;
 *   - `getBoundingClientRect` / `getClientRects`;
 *   - `elementFromPoint` / `elementsFromPoint` (they take game-frame points);
 *   - `innerWidth` / `innerHeight` (swapped). stage.ts reads the real ones through `realInnerSize`.
 * The browser's own hit testing already honours the transform, so a tap lands on what is drawn under the finger; the
 * wrappers keep every measured position consistent with it (drag ghosts, drop seats, ping fans, popovers, Pixi FX).
 * While the phone is not sideways each wrapper is one boolean check, and desktop never installs them.
 *
 * THE GEOMETRY. The upright document is `pw` CSS px wide (the stage's layout height). The stage (layout `lw` x `lh`) is
 * placed by `translateX(pw) rotate(90deg)` about its top-left, so a game point (x, y) is drawn at screen (pw - y, x):
 * the game's top runs down the screen's RIGHT edge, its left edge along the screen's TOP. That is the turn a player
 * makes naturally (phone rotated anticlockwise, the notch on the left).
 */

/** Pure: a SCREEN point (upright document, `pw` wide) in the game's landscape frame. */
export function screenToGame(x: number, y: number, pw: number): { x: number; y: number } {
  return { x: y, y: pw - x };
}
/** Pure: a game-frame point back to the upright screen. */
export function gameToScreen(x: number, y: number, pw: number): { x: number; y: number } {
  return { x: pw - y, y: x };
}
export interface PlainRect { left: number; top: number; width: number; height: number }
/** Pure: a screen rect (an axis-aligned box, as `getBoundingClientRect` reports) in the game frame. */
export function rectScreenToGame(r: PlainRect, pw: number): PlainRect {
  return { left: r.top, top: pw - r.left - r.width, width: r.height, height: r.width };
}
/** Pure: a screen motion delta in the game frame (a rotation only, no offset). */
export function deltaToGame(dx: number, dy: number): { x: number; y: number } {
  return { x: dy, y: -dx };
}
export interface Insets4 { top: number; right: number; bottom: number; left: number }
/** Pure: the upright safe area (notch on top, home indicator at the bottom) as the turned game sees it. */
export function sidewaysInsets(i: Insets4): Insets4 {
  // game top = screen right, game right = screen bottom, game bottom = screen left, game left = screen top
  return { top: i.right, right: i.bottom, bottom: i.left, left: i.top };
}
/** Pure: the transform that turns the stage onto an upright document `pw` CSS px wide (composed before any scale). */
export function sidewaysTransform(pw: number, scale = 1): string {
  return `translateX(${pw}px) rotate(90deg)${scale !== 1 ? ` scale(${scale})` : ''}`;
}
/** The shorter window side from which a touch device counts as a tablet (mirrors stage.ts `TABLET_MIN_SIDE`). */
const TABLET_SIDE = 700;
/** Pure: is the phone held upright, so the game must turn? A phone (never a tablet, desktop or laptop) whose window
 *  is taller than wide. */
export function sidewaysApplies(phone: boolean, w: number, h: number): boolean {
  return phone && h > w && Math.min(w, h) < TABLET_SIDE;
}

let on = false;
let pw = 0;
/** Is the game drawn sideways right now? */
export function sidewaysOn(): boolean { return on; }
/** The upright document's width (CSS px) the turn maps through; 0 when not sideways. */
export function sidewaysWidth(): number { return pw; }
/** stage.ts: the turn is on (or off) for an upright document `width` CSS px wide. Writes `data-sideways` on <html>. */
export function setSideways(next: boolean, width: number): void {
  on = next;
  pw = next ? width : 0;
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-sideways', next);
}

type Getter = (this: unknown) => number;
let realInnerW: (() => number) | null = null;
let realInnerH: (() => number) | null = null;
/** The REAL window size (CSS px), unswapped: what stage.ts fits to. */
export function realInnerSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  return { w: realInnerW ? realInnerW() : window.innerWidth, h: realInnerH ? realInnerH() : window.innerHeight };
}

function getterOf(proto: object, key: string): { owner: object; get: Getter } | null {
  let o: object | null = proto;
  while (o) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (d) return d.get && d.configurable ? { owner: o, get: d.get as Getter } : null;
    o = Object.getPrototypeOf(o) as object | null;
  }
  return null;
}
/** Replace an accessor on the object that owns it. `make` receives the original getter. */
function wrapGetter(proto: object | undefined, key: string, make: (orig: Getter) => Getter): void {
  if (!proto) return;
  const g = getterOf(proto, key);
  if (!g) return;
  const d = Object.getOwnPropertyDescriptor(g.owner, key)!;
  Object.defineProperty(g.owner, key, { ...d, get: make(g.get) });
}

/** A screen-geometry DOMRect in the game frame. */
function gameRect(r: DOMRect): DOMRect {
  const g = rectScreenToGame(r, pw);
  return new DOMRect(g.left, g.top, g.width, g.height);
}

/** A browser event's screen point as the game frame's x / y, while turned (what the wrapped getters return). */
export function eventX(screenX: number, screenY: number): number { return screenToGame(screenX, screenY, pw).x; }
export function eventY(screenX: number, screenY: number): number { return screenToGame(screenX, screenY, pw).y; }

let installed = false;
/**
 * Wrap the screen-geometry APIs (see the header). Once, phones only (stage.ts). Each wrapper passes straight through
 * while `sidewaysOn()` is false.
 */
export function installSideways(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  // The real window size first, before anything is swapped.
  const iw = getterOf(window, 'innerWidth');
  const ih = getterOf(window, 'innerHeight');
  if (iw && ih) {
    realInnerW = () => iw.get.call(window);
    realInnerH = () => ih.get.call(window);
    const dw = Object.getOwnPropertyDescriptor(iw.owner, 'innerWidth')!;
    const dh = Object.getOwnPropertyDescriptor(ih.owner, 'innerHeight')!;
    Object.defineProperty(iw.owner, 'innerWidth', { ...dw, get(this: unknown) { return (on ? ih.get : iw.get).call(this); } });
    Object.defineProperty(ih.owner, 'innerHeight', { ...dh, get(this: unknown) { return (on ? iw.get : ih.get).call(this); } });
  }

  // Event coordinates. x and y swap through the transform, so each getter reads the OTHER axis's original.
  const coordPairs: Array<[string, string]> = [['clientX', 'clientY'], ['x', 'y'], ['pageX', 'pageY']];
  const evProtos: Array<object | undefined> = [
    typeof MouseEvent !== 'undefined' ? MouseEvent.prototype : undefined,
    typeof Touch !== 'undefined' ? Touch.prototype : undefined,
  ];
  for (const proto of evProtos) {
    if (!proto) continue;
    const isTouch = typeof Touch !== 'undefined' && proto === Touch.prototype;
    for (const [kx, ky] of coordPairs) {
      const gx = getterOf(proto, kx);
      const gy = getterOf(proto, ky);
      if (!gx || !gy) continue;
      // Built by the game (untrusted): already in the game frame. A Touch has no isTrusted; the game never builds one.
      const mapped = (self: unknown): boolean => on && (isTouch || (self as Event).isTrusted === true);
      wrapGetter(proto, kx, () => function (this: unknown) { return mapped(this) ? eventX(gx.get.call(this), gy.get.call(this)) : gx.get.call(this); });
      wrapGetter(proto, ky, () => function (this: unknown) { return mapped(this) ? eventY(gx.get.call(this), gy.get.call(this)) : gy.get.call(this); });
    }
  }
  if (typeof MouseEvent !== 'undefined') {
    const mx = getterOf(MouseEvent.prototype, 'movementX');
    const my = getterOf(MouseEvent.prototype, 'movementY');
    if (mx && my) {
      wrapGetter(MouseEvent.prototype, 'movementX', () => function (this: unknown) { return on && (this as Event).isTrusted ? my.get.call(this) : mx.get.call(this); });
      wrapGetter(MouseEvent.prototype, 'movementY', () => function (this: unknown) { return on && (this as Event).isTrusted ? -mx.get.call(this) : my.get.call(this); });
    }
  }

  // Element geometry.
  const EP = Element.prototype;
  const bcr = EP.getBoundingClientRect;
  EP.getBoundingClientRect = function (this: Element): DOMRect {
    const r = bcr.call(this);
    return on ? gameRect(r) : r;
  };
  const gcr = EP.getClientRects;
  EP.getClientRects = function (this: Element): DOMRectList {
    const list = gcr.call(this);
    if (!on) return list;
    const out = Array.from(list, gameRect) as unknown as DOMRectList & DOMRect[];
    (out as unknown as { item: (i: number) => DOMRect | null }).item = (i: number) => out[i] ?? null;
    return out;
  };

  // Hit tests take a game-frame point.
  const DP = Document.prototype;
  const efp = DP.elementFromPoint;
  DP.elementFromPoint = function (this: Document, x: number, y: number): Element | null {
    if (!on) return efp.call(this, x, y);
    const s = gameToScreen(x, y, pw);
    return efp.call(this, s.x, s.y);
  };
  const esfp = DP.elementsFromPoint;
  if (esfp) {
    DP.elementsFromPoint = function (this: Document, x: number, y: number): Element[] {
      if (!on) return esfp.call(this, x, y);
      const s = gameToScreen(x, y, pw);
      return esfp.call(this, s.x, s.y);
    };
  }
}
