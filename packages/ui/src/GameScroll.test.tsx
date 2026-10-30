// @vitest-environment jsdom
/**
 * THE GAME SCROLLBAR (R-UI-SCROLLBAR-01): the thumb's size / travel maths, and the rendered bar: the view keeps its
 * class and props, the native bar is hidden by the view's class, the bar shows only while the content overflows, a
 * scroll moves the thumb by transform, and a press on the track jumps there. jsdom has no layout, so the sizes are
 * stubbed per element.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameScroll, MIN_THUMB, scrollForTrackPress, thumbMetrics, thumbOffset } from './GameScroll';
import { mount, type Mounted } from './renderedText.mount';

describe('thumb maths', () => {
  it('no bar when the content fits', () => {
    expect(thumbMetrics(300, 300, 290)).toBeNull();
    expect(thumbMetrics(300, 200, 290)).toBeNull();
  });
  it('thumb length is the visible share of the track, never under the minimum', () => {
    expect(thumbMetrics(300, 600, 300)).toEqual({ size: 150, travel: 150, range: 300 });
    expect(thumbMetrics(100, 100000, 300)?.size).toBe(MIN_THUMB);
  });
  it('offset follows the scroll and clamps at the ends', () => {
    const m = thumbMetrics(300, 600, 300)!;
    expect(thumbOffset(0, m)).toBe(0);
    expect(thumbOffset(150, m)).toBe(75);
    expect(thumbOffset(300, m)).toBe(150);
    expect(thumbOffset(9999, m)).toBe(150);
  });
  it('a track press centres the thumb there', () => {
    const m = thumbMetrics(300, 600, 300)!;
    expect(scrollForTrackPress(150, m)).toBe(150);
    expect(scrollForTrackPress(0, m)).toBe(0);
    expect(scrollForTrackPress(300, m)).toBe(300);
  });
});

describe('<GameScroll>', () => {
  let ui: Mounted | null = null;
  const restore: Array<() => void> = [];
  const stub = (prop: 'clientHeight' | 'scrollHeight', pick: (el: HTMLElement) => number): void => {
    const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get(this: HTMLElement) { return pick(this); } });
    restore.push(() => { if (was) Object.defineProperty(HTMLElement.prototype, prop, was); });
  };
  afterEach(() => { ui?.unmount(); ui = null; restore.splice(0).forEach((f) => f()); });

  const sizes = { content: 600 };
  const setup = (): void => {
    stub('clientHeight', (el) => (el.classList.contains('gscroll-view') ? 300 : el.classList.contains('gscroll-track') ? 300 : 0));
    stub('scrollHeight', (el) => (el.classList.contains('gscroll-view') ? sizes.content : 0));
  };

  it('keeps the view\x27s class and props, and shows the bar only while it overflows', () => {
    setup();
    sizes.content = 600;
    ui = mount(<GameScroll className="my-list" outerClassName="my-wrap" role="log" aria-label="Conversation"><p>hi</p></GameScroll>);
    const view = ui.container.querySelector<HTMLElement>('.gscroll-view.my-list')!;
    expect(view.getAttribute('role')).toBe('log');
    expect(view.getAttribute('aria-label')).toBe('Conversation');
    const outer = ui.container.querySelector<HTMLElement>('.gscroll.my-wrap')!;
    expect(outer.classList.contains('over')).toBe(true);
    const thumb = ui.container.querySelector<HTMLElement>('.gscroll-thumb')!;
    expect(thumb.style.height).toBe('150px');
    // A scroll writes the thumb's transform.
    view.scrollTop = 150;
    act(() => { view.dispatchEvent(new Event('scroll')); });
    expect(thumb.style.transform).toBe('translateY(75px)');
    ui.unmount();
    sizes.content = 200;
    ui = mount(<GameScroll className="my-list"><p>hi</p></GameScroll>);
    expect(ui.container.querySelector('.gscroll')!.classList.contains('over')).toBe(false);
  });

  it('a press on the track jumps there', () => {
    setup();
    sizes.content = 600;
    ui = mount(<GameScroll className="my-list"><p>hi</p></GameScroll>);
    const view = ui.container.querySelector<HTMLElement>('.gscroll-view')!;
    const track = ui.container.querySelector<HTMLElement>('.gscroll-track')!;
    track.getBoundingClientRect = () => ({ top: 100, left: 0, width: 7, height: 300, right: 7, bottom: 400, x: 0, y: 100, toJSON: () => ({}) });
    act(() => { track.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 400 })); });
    expect(view.scrollTop).toBe(300);
  });

  it('the bar uses the gauntlet cursors and hides the native scrollbar', () => {
    const css = readFileSync(join(__dirname, 'gameScroll.css'), 'utf8');
    expect(css).toMatch(/\.gscroll-view \{ scrollbar-width: none/);
    expect(css).toMatch(/\.gscroll-thumb \{[^}]*cursor: url\('\/cursors\/gauntlet_open\.svg'\) 6 2, grab/);
    expect(css).not.toMatch(/cursor:\s*(pointer|grab|grabbing)\s*;/);
  });
});
