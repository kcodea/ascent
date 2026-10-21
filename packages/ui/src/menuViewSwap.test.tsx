// @vitest-environment jsdom
/**
 * THE MODE SCREEN'S VIEW SWAP (owner 2026-10-21, R-MENU-VIEW-SWAP-01), verbatim: "clicking into gauntlet, learn, and
 * versus all have a glitchy flash of the 'play modes' before entering their view. practice does a quick fade out/in
 * of the full ui. I don't want the full fade out/in, but i want the janky flash of the old ui gone, too. it should be a
 * clean, seamless menu shift going into the different views."
 *
 * Pinned against the real Title + store:
 *   - the mode home and every view (Gauntlet, Learn, Versus, Practice) live in ONE host that never remounts, so the
 *     sidebar and backdrop never re-fade (the old code mounted a second full-screen host that faded in whole over a
 *     home whose content had just remounted and replayed its entrance: the flash);
 *   - Practice is a view too: choosing it keeps the title mounted (no full fade out and in), and its crumb lands on
 *     the home in ONE store write (never the main menu for a frame);
 *   - on a change the outgoing view is the SAME DOM node it was (nothing inside it replays), wears `.mpv-out` and
 *     leaves after `VIEW_EXIT_MS`; the incoming one wears `.mpv-in`. The CSS makes the incoming start transparent and
 *     the outgoing inert, so no frame shows the old view at full opacity over the new one;
 *   - reduced motion: an instant switch with no outgoing layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type Mounted } from './renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('./remoteBoards')>()), remoteEnabled: () => false }));

import { Title } from './Title';
import { useGame } from './store';
import { VIEW_EXIT_MS } from './MenuViewSwap';

let ui: Mounted | null = null;
const hosts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.modepick.sb-host')];
const layers = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.mp-shell > .mpview')];
const layer = (view: string): HTMLElement | null => document.querySelector<HTMLElement>(`.mp-shell > .mpview[data-view="${view}"]`);

function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
  useGame.setState({ showTitle: true, titleView: 'modes', practiceSetupOpen: false, savedRun: null });
});
afterEach(() => {
  ui?.unmount(); ui = null;
  useGame.setState({ titleView: 'menu', practiceSetupOpen: false, showTitle: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R-MENU-VIEW-SWAP-01: the mode screen shifts its content, never the whole screen', () => {
  for (const view of ['gauntlet', 'learn', 'versus'] as const) {
    it(`Modes -> ${view} -> Modes: one host the whole way, the home leaves as the same node, the view rises in`, () => {
      ui = mount(<Title onSettings={() => {}} />);
      const host = hosts()[0];
      const home = layer('modes')!;
      expect(hosts()).toHaveLength(1);
      expect(home.className).not.toMatch(/mpv-(in|out)/); // first open: the host's own entrance, no swap

      act(() => { useGame.getState().setTitleView(view); });
      expect(hosts()).toEqual([host]); // never a second full-screen host fading in over the home
      expect(layer('modes')).toBe(home); // the outgoing home is not remounted, so it replays nothing
      expect(home.classList.contains('mpv-out')).toBe(true);
      expect(home.getAttribute('aria-hidden')).toBe('true');
      expect(layer(view)!.classList.contains('mpv-in')).toBe(true);
      expect(layers()).toHaveLength(2);

      act(() => { vi.advanceTimersByTime(VIEW_EXIT_MS); });
      expect(layers().map((l) => l.dataset.view)).toEqual([view]);

      // Back through the crumb: the same shift the other way.
      const crumb = [...document.querySelectorAll<HTMLButtonElement>('.mpcrumb')].find((b) => b.textContent === 'Modes')!;
      act(() => { crumb.click(); });
      expect(hosts()).toEqual([host]);
      expect(layer(view)!.classList.contains('mpv-out')).toBe(true);
      expect(layer('modes')!.classList.contains('mpv-in')).toBe(true);
      act(() => { vi.advanceTimersByTime(VIEW_EXIT_MS); });
      expect(layers().map((l) => l.dataset.view)).toEqual(['modes']);
    });
  }

  it('Practice is a view of the same host: the title stays mounted (no full fade), and its crumb lands on the home in one write', () => {
    ui = mount(<Title onSettings={() => {}} />);
    const host = hosts()[0];
    const title = document.querySelector('.titlescreen');
    act(() => { document.querySelector<HTMLElement>('.modecard[data-mp="practice"]')!.click(); });
    expect(useGame.getState().practiceSetupOpen).toBe(true);
    expect(useGame.getState().showTitle).toBe(false);
    expect(document.querySelector('.titlescreen')).toBe(title); // the old path unmounted the whole title here
    expect(hosts()).toEqual([host]);
    expect(layer('practice')!.classList.contains('mpv-in')).toBe(true);
    expect(layer('practice')!.querySelector('.pomodes')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(VIEW_EXIT_MS); });

    // Every store state the crumb passes through keeps the mode screen up (the old path wrote showTitle + 'menu' first).
    const seen: string[] = [];
    const off = useGame.subscribe((s) => { seen.push(s.practiceSetupOpen ? 'practice' : s.showTitle ? s.titleView : 'closed'); });
    const crumb = [...document.querySelectorAll<HTMLElement>('.mpcrumb')].find((b) => b.textContent === 'Modes')!;
    act(() => { crumb.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    off();
    expect(seen).toEqual(['modes']);
    expect(hosts()).toEqual([host]);
    expect(layer('practice')!.classList.contains('mpv-out')).toBe(true);
    expect(layer('modes')!.classList.contains('mpv-in')).toBe(true);
  });

  it('reduced motion: an instant switch, no outgoing layer', () => {
    setReducedMotion(true);
    ui = mount(<Title onSettings={() => {}} />);
    act(() => { useGame.getState().setTitleView('gauntlet'); });
    expect(layers().map((l) => l.dataset.view)).toEqual(['gauntlet']);
    expect(layer('gauntlet')!.className).not.toMatch(/mpv-in/);
  });

  it('the CSS: the incoming view starts transparent, the outgoing one fades out inert, transform + opacity only', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    const kf = (name: string): string => css.match(new RegExp(`@keyframes ${name} \\{([^\\n]*)\\}`))?.[1] ?? '';
    expect(kf('mpv-in')).toMatch(/from \{ opacity: 0;/);
    expect(kf('mpv-out')).toMatch(/to \{ opacity: 0;/);
    for (const k of [kf('mpv-in'), kf('mpv-out')]) for (const prop of k.matchAll(/([a-z-]+):/g)) expect(['opacity', 'transform']).toContain(prop[1]);
    expect(css).toMatch(/\.mpview\.mpv-out \{ pointer-events: none; \}/);
    // The incoming view waits a beat at opacity 0 (backwards fill) while the outgoing one is already fading.
    expect(css).toMatch(/\.mpview\.mpv-in > \* \{ animation: mpv-in [\d.]+s [^;]* [\d.]+s backwards; \}/);
  });
});
