// @vitest-environment jsdom
/**
 * R-VERSUS-RELIABLE-06 (found on the bench prod build 2026-10-27: "`measureDock` never produced a geometry (its inline
 * style stayed empty in shop and fight), so it sat at its CSS fallback spot and the tag-in copy over your own hero never
 * mounted"). The cause: at the design size and above the stage is unscaled and `#stage` is `display: contents`, which
 * has no box, so its rect is all zeros and the mirror refused it. An unscaled stage IS the viewport, so the dock now
 * measures against the window there. Pinned with an all-zero stage rect, exactly what a browser returns for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./teammateView', () => ({ enterTeammateView: vi.fn(), exitTeammateView: vi.fn() }));

const { mount } = await import('../renderedText.mount');
const { DuosMateDock, stageBox, fitDock } = await import('./DuosMateDock');
const { useVersus } = await import('./versusStore');
const { stageHost } = await import('../stage');

const seat = (s: string, userId: string, name: string) => ({ seat: s, userId, name, hero: 'warden' });
const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

let bar: HTMLElement;
beforeEach(() => {
  useVersus.setState({
    room: { members: [] },
    match: { group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } }, raw: { seats: [
      seat('p1', 'u1', 'Ann'), seat('p2', 'u2', 'Bob'), seat('p3', 'u3', 'Cy'), seat('p4', 'u4', 'Di'),
    ] } } },
  } as never);
  // My own hero bottom left, as the status bar lays it out (screen px on a 1920 x 1080 window).
  bar = document.createElement('div');
  bar.className = 'statusbar';
  bar.innerHTML = '<div class="hero"><div class="f"><img class="heroimg" /></div><div class="hpbox"></div></div>';
  document.body.appendChild(bar);
  bar.querySelector<HTMLElement>('.heroimg')!.getBoundingClientRect = () => rect(140, 700, 270, 270);
  bar.querySelector<HTMLElement>('.hpbox')!.getBoundingClientRect = () => rect(170, 960, 210, 60);
  Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
  // `#stage` is `display: contents` at this size: no box at all.
  stageHost().getBoundingClientRect = () => rect(0, 0, 0, 0);
});
afterEach(() => {
  bar.remove();
  useVersus.setState({ room: null, match: null } as never);
});

describe('R-VERSUS-RELIABLE-06: the teammate dock is placed on a full-size window', () => {
  it('stageBox: a stage with no box is the window; a real box is kept', () => {
    expect(stageBox(rect(0, 0, 0, 0), { w: 1920, h: 1080 })).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
    const scaled = rect(0, 0, 1280, 720);
    expect(stageBox(scaled, { w: 1280, h: 720 })).toBe(scaled);
    // Before: the zero box was handed to the fit, which (rightly) refuses it.
    expect(fitDock(rect(140, 700, 270, 270), rect(170, 960, 210, 60), null, rect(0, 0, 0, 0), (v) => v)).toBeNull();
  });

  it('the dock mounts with its measured geometry (inline style, `placed`), mirrored off my own hero', async () => {
    const ui = mount(<DuosMateDock watching={false} />);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      const dock = ui.container.querySelector<HTMLElement>('.duosdock')!;
      expect(dock.classList.contains('placed')).toBe(true);
      expect(dock.style.right).toBe('140px'); // the same distance in from the right as my hero has from the left
      expect(dock.style.getPropertyValue('--duos-d')).toBe('270px');
      expect(dock.style.bottom).toBe('60px'); // its bottom on my Health box's bottom (1080 - 1020)
    } finally { ui.unmount(); }
  });
});
