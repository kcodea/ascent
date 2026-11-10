// @vitest-environment jsdom
/**
 * THE RAIL'S NAME CLAMP NEVER MEASURES INSIDE A COMMIT (perf, the Duos audit of 2026-11-09).
 *
 * `ClampedName` fitted each seat name in its layout effect: write the text, read `clientHeight`, name after name. A commit
 * that rebuilt the rail (the Duos teammate-view swap) so forced a style + layout of the whole new screen inside its own
 * task (10.6 ms a swap on desktop, 224 ms on the throttled phone profile). The fit now runs in the ResizeObserver's
 * callback (after the frame's own layout), and a name whose text and box are unchanged is not measured again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { mount } = await import('./renderedText.mount');
const { ClampedName } = await import('./LobbyPanel');

/** The observer's callbacks, fired by hand: the browser runs them after layout, before the paint. */
let observers: Array<() => void> = [];
class FakeResizeObserver {
  private readonly cb: () => void;
  private on = true;
  constructor(cb: () => void) { this.cb = cb; observers.push(() => { if (this.on) this.cb(); }); }
  observe(): void {}
  disconnect(): void { this.on = false; }
}
const layoutPass = (): void => { for (const f of [...observers]) f(); };

// A fake box: 100 px wide, two 15 px lines; text over 16 characters wraps onto a third line (clipped by the clamp).
let width = 100;
let reads = 0; // every layout read the component makes
const FITS = 16;
const proto = HTMLElement.prototype;
const saved = ['clientWidth', 'clientHeight', 'scrollHeight'].map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const);
beforeEach(() => {
  observers = [];
  reads = 0;
  width = 100;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  const fits = (el: HTMLElement): number => Math.round((FITS * width) / 100);
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { reads++; return this.classList.contains('lrv-name-t') ? width : 0; } });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get(this: HTMLElement) { reads++; return this.classList.contains('lrv-name-t') ? 30 : 0; } });
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get(this: HTMLElement) { reads++; return (this.textContent ?? '').length > fits(this) ? 45 : 30; } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, d] of saved) { if (d) Object.defineProperty(proto, k, d); else delete (proto as unknown as Record<string, unknown>)[k]; }
});

const LONG = 'Bartholomew the Unreasonably Long';
const nameOf = (c: HTMLElement): string => c.querySelector('.lrv-name-t')!.textContent ?? '';

describe('ClampedName: fitted after layout, never inside the commit', () => {
  it('the commit only writes; the fit runs with the frame, and ends the name in an ellipsis', () => {
    const ui = mount(<ClampedName text={LONG} />);
    try {
      expect(reads).toBe(0); // no layout read inside the commit
      expect(nameOf(ui.container)).toBe(LONG);
      layoutPass();
      expect(reads).toBeGreaterThan(0);
      expect(nameOf(ui.container).endsWith('…')).toBe(true);
      expect(nameOf(ui.container).length).toBeLessThanOrEqual(FITS);
      expect(ui.container.querySelector('.lrv-name-t')!.getAttribute('aria-label')).toBe(LONG); // the whole name for readers
    } finally { ui.unmount(); }
  });

  it('a rebuilt rail (same name, same box) writes the last fit straight away and measures nothing', () => {
    const first = mount(<ClampedName text={LONG} />);
    layoutPass();
    const fitted = nameOf(first.container);
    first.unmount();
    observers = [];
    reads = 0;
    const again = mount(<ClampedName text={LONG} />);
    try {
      expect(reads).toBe(0);
      expect(nameOf(again.container)).toBe(fitted); // already fitted in the commit: no flash of the whole name
      layoutPass();
      expect(reads).toBe(2); // the box's width and height, read once with the layout clean; no fit
      expect(nameOf(again.container)).toBe(fitted);
    } finally { again.unmount(); }
  });

  it('a box that changed (the slice resized) is fitted again', () => {
    const ui = mount(<ClampedName text={LONG} />);
    try {
      layoutPass();
      const wide = nameOf(ui.container);
      width = 60;
      layoutPass();
      expect(nameOf(ui.container).length).toBeLessThan(wide.length);
      expect(nameOf(ui.container).endsWith('…')).toBe(true);
      // And a remount at the new width trusts the new fit, not the old one.
      const narrow = nameOf(ui.container);
      ui.render(<span />);
      observers = [];
      ui.render(<ClampedName text={LONG} />);
      expect(nameOf(ui.container)).toBe(narrow);
    } finally { ui.unmount(); }
  });

  it('a short name is left whole', () => {
    const ui = mount(<ClampedName text="Ann" />);
    try {
      layoutPass();
      expect(nameOf(ui.container)).toBe('Ann');
    } finally { ui.unmount(); }
  });
});
