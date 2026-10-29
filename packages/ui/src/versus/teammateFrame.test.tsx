// @vitest-environment jsdom
/**
 * VERSUS DUOS — WATCHING YOUR TEAMMATE HAS NO TOP PLATE (owner 2026-10-25: "You can remove the 'watching xyz' and 'back
 * to your board' info up top because it's pretty obvious from our view change/color etc"; R-DUOS-VIEW-01). While I watch
 * my teammate the team-colour vignette stays, there is no "Watching <Name>" plate and no "Back to your board" button, and
 * the bottom-right portrait (mine, while watching) is still the way back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./teammateView', async (orig) => ({ ...(await orig<typeof import('./teammateView')>()), enterTeammateView: vi.fn(), exitTeammateView: vi.fn() }));

const { mount } = await import('../renderedText.mount');
const { DuosMateDock } = await import('./DuosMateDock');
const { useVersus } = await import('./versusStore');
const { useSpectate } = await import('./spectate');
const view = await import('./teammateView');

const seat = (s: string, userId: string, name: string, hero: string) => ({ seat: s, userId, name, hero });
beforeEach(() => {
  useVersus.setState({
    room: { members: [] },
    match: { group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } }, raw: { seats: [
      seat('p1', 'u1', 'Ann', 'warden'), seat('p2', 'u2', 'Bob', 'warden'), seat('p3', 'u3', 'Cy', 'warden'), seat('p4', 'u4', 'Di', 'warden'),
    ] } } },
  } as never);
  useSpectate.setState({ teammate: true });
});
afterEach(() => {
  vi.clearAllMocks();
  useSpectate.setState({ teammate: false });
  useVersus.setState({ room: null, match: null } as never);
});

describe('watching my teammate: no plate up top', () => {
  it('the vignette stays; no "Watching <Name>" plate, no "Back to your board" button; my portrait still returns', () => {
    const ui = mount(<><view.TeammateFrame /><DuosMateDock watching /></>);
    try {
      expect(ui.container.querySelector('.duosview-vignette')).not.toBeNull();
      expect(ui.container.querySelector('.duosview-bar')).toBeNull();
      expect(ui.container.querySelector('.duosview-back')).toBeNull();
      // Nothing up top says it: outside the bottom-right portrait (whose own cap reads "Back to your board") there is
      // no text and no button at all.
      const top = [...ui.container.children].filter((el) => !el.classList.contains('duosdock') && !el.querySelector('.duosdock'));
      for (const el of top) {
        expect(el.textContent ?? '').toBe('');
        expect(el.querySelector('button')).toBeNull();
      }
      expect(ui.container.querySelectorAll('button')).toHaveLength(0);
      // The bottom-right portrait is mine while watching, and a click on it comes back.
      expect(ui.container.querySelector('.duosdock.self .duosdock-name')?.textContent).toBe('Ann');
      act(() => { ui.container.querySelector('[data-duos-mate]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.exitTeammateView).toHaveBeenCalledTimes(1);
    } finally { ui.unmount(); }
  });

  it('clicking MY portrait anywhere (cap, disc or name pill) comes back; one tap is one swap; keyboard too', () => {
    // Owner 2026-10-25: "Clicking your portrait should take you back to your board from viewing your teammates".
    const ui = mount(<><view.TeammateFrame /><DuosMateDock watching /></>);
    const pointerUp = (el: Element, pointerType: string): void => {
      const ev = new Event('pointerup', { bubbles: true });
      Object.defineProperty(ev, 'pointerType', { value: pointerType });
      el.dispatchEvent(ev);
    };
    const click = (el: Element): void => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
    try {
      const dock = ui.container.querySelector('.duosdock.self')!;
      expect(dock.getAttribute('role')).toBe('button');
      for (const part of ['.duosdock-cap', '.duosdock-disc', '.duosdock-name']) {
        vi.mocked(view.exitTeammateView).mockClear();
        act(() => { click(ui.container.querySelector(part)!); });
        expect(view.exitTeammateView).toHaveBeenCalledTimes(1);
      }
      // A mouse release is not a tap (its click does the work); a touch tap swaps on release and its click is ignored.
      vi.mocked(view.exitTeammateView).mockClear();
      act(() => { pointerUp(dock, 'mouse'); });
      expect(view.exitTeammateView).not.toHaveBeenCalled();
      act(() => { pointerUp(ui.container.querySelector('.duosdock-disc')!, 'touch'); click(ui.container.querySelector('.duosdock-disc')!); });
      expect(view.exitTeammateView).toHaveBeenCalledTimes(1);
      vi.mocked(view.exitTeammateView).mockClear();
      act(() => { dock.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      expect(view.exitTeammateView).toHaveBeenCalledTimes(1);
      expect(view.enterTeammateView).not.toHaveBeenCalled();
    } finally { ui.unmount(); }
  });

  it('on my own board the dock is my teammate: only the disc opens their view (the pass target is unchanged)', () => {
    useSpectate.setState({ teammate: false });
    const ui = mount(<DuosMateDock watching={false} />);
    try {
      expect(ui.container.querySelector('.duosdock')!.getAttribute('role')).toBeNull();
      act(() => { ui.container.querySelector('.duosdock-name')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.enterTeammateView).not.toHaveBeenCalled();
      act(() => { ui.container.querySelector('[data-duos-mate]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.enterTeammateView).toHaveBeenCalledTimes(1);
      expect(view.exitTeammateView).not.toHaveBeenCalled();
    } finally { ui.unmount(); }
  });

  it("the watch screen's inert-controls rule never out-ranks MY portrait (it did: the click back did nothing)", () => {
    // `.app.viewing [role="button"] { pointer-events: none }` (styles.css) is 0,3,0; the portrait must answer above it.
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    expect(css).toMatch(/\.app\.viewing \.duosdock\.self\[role="button"\][^{]*\{\s*pointer-events:\s*auto;/);
    expect(css).not.toMatch(/\.duosview-bar|\.duosview-name/);
  });

  // R-DUOS-VIEW-05 (owner bug 2026-10-29: "going to a teammates screen while they are in runeforge makes it so i cant do
  // anything"). The teammate's Runeforge / Discover / Quest / power offer / Choose One / scouted board is the full-screen
  // `.discover-ov` scrim; the Ancients gate covers the screen too. MY portrait (the way back) must sit over all of them,
  // and under the swap's ghost so the cross-fade still covers it.
  it("MY portrait sits over every overlay the teammate's screen can open, so the way back is always clickable", () => {
    const z = (css: string, sel: RegExp): number => Number(css.match(sel)![1]);
    const vs = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    const main = readFileSync(join(__dirname, '../styles.css'), 'utf8');
    const anc = readFileSync(join(__dirname, '../ancients/ancients.css'), 'utf8');
    const self = z(vs, /\.duosdock\.self \{ z-index: (\d+)/);
    expect(self).toBeGreaterThan(z(main, /\.discover-ov \{[^}]*?z-index: (\d+)/)); // Runeforge, Discover, Quest, power, Choose One, scout
    expect(self).toBeGreaterThan(z(anc, /\.anc-gate \{[^}]*?z-index: (\d+)/)); // the Ancients gate
    expect(self).toBeLessThan(z(vs, /\.duosghost \{[^}]*?z-index: (\d+)/)); // the cross-fade still covers it
  });

  // R-DUOS-VIEW-04 (owner bug 2026-10-26): the teal haze washed the bottom-left hero plate (name pill + Health box) while a
  // teammate's hand card popped. The vignette stays a static layer UNDER every HUD plate and the hand pop, over the board.
  it('the team vignette sits under the hero cluster, the teammate portrait and the hand pop, over the board', () => {
    const z = (css: string, sel: RegExp): number => Number(css.match(sel)![1]);
    const vs = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    const main = readFileSync(join(__dirname, '../styles.css'), 'utf8');
    const vignette = z(vs, /\.duosview-vignette \{[^}]*?z-index: (\d+)/);
    expect(vignette).toBeLessThan(z(main, /\.statusbar \{ position: fixed;[^}]*?z-index: (\d+)/)); // portrait, name, Health, power
    expect(vignette).toBeLessThan(z(vs, /\.duosdock \{[^}]*?z-index: (\d+)/)); // the teammate portrait + its Health box
    expect(vignette).toBeLessThan(z(main, /\.app:has\(\.row\.hand \.card:hover\) \.zone\[data-zone='hand'\] \{ z-index: (\d+)/)); // the hand pop
    expect(vignette).toBeGreaterThan(z(main, /^\.app \{ position: relative; z-index: (\d+)/m)); // still over the board
    // Static paint: only the one-shot fade-in, never a looping animation.
    expect(vs.match(/\.duosview-vignette \{[^}]*\}/)![0]).not.toMatch(/infinite/);
  });

  it('not watching: nothing at all', () => {
    useSpectate.setState({ teammate: false });
    const ui = mount(<view.TeammateFrame />);
    try { expect(ui.container.querySelector('.duosview-vignette')).toBeNull(); } finally { ui.unmount(); }
  });
});
