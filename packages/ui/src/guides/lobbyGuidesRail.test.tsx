// @vitest-environment jsdom
/**
 * THE LOBBY RAIL'S GUIDES VIEW (owner ask 2026-10-09). Pins: the tab flips the rail between Opponents and Guides
 * (header follows); only this game's set + lobby tribes show; a card expands in place and shows real board
 * `Card` portraits in Core / Enablers rows; SIMPLE hides the write-up and FULL shows it, the mode persists in
 * localStorage and SIMPLE is the default; a new game starts on Opponents; the Tutorial has no tab; the tab goes
 * pointer-inert with the rail in combat; no `title=` anywhere in the guides view.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { LobbyPanel } from '../LobbyPanel';
import { useGame } from '../store';
import { guidesFor } from './guides';

let ui: Mounted | null = null;
beforeEach(() => { try { localStorage.removeItem('ascent.guidesMode'); } catch { /* ignore */ } });
afterEach(() => { ui?.unmount(); ui = null; });

const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

/** Flip to Guides (the view is remembered per run for the session, so a re-used seed may already be there). */
const openGuides = (c: HTMLElement): void => {
  const tab = c.querySelector('.lobbyrailtab')!;
  if (tab.getAttribute('aria-pressed') !== 'true') click(tab);
};

const mountRail = (seed = 4242, mode?: 'tutorial'): HTMLElement => {
  const run = createLobbyRun(seed, 'warden');
  if (mode) run.mode = mode;
  act(() => { useGame.setState({ run, combatStaged: false }); });
  ui = mount(<LobbyPanel lobby={run.lobby!} />);
  return ui.container;
};

describe('lobby rail guides view', () => {
  it('the tab flips the rail to Guides and back; header follows', () => {
    const c = mountRail(1111);
    const tab = c.querySelector('.lobbyrailtab')!;
    expect(tab.getAttribute('aria-pressed')).toBe('false');
    expect(c.querySelector('.lobbyround')!.textContent).toMatch(/^Round/);
    click(tab);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guidesview')).toBe(true);
    expect(c.querySelector('.lobbyround')!.textContent).toBe('Guides');
    expect(c.querySelector('.lobbyseat')).toBeNull();
    const run = useGame.getState().run;
    expect(c.querySelectorAll('.lobbyguide').length).toBe(guidesFor(run.setId, run.tribes).length);
    click(c.querySelector('.lobbyrailtab')!);
    expect(c.querySelector('.lobbyseat')).not.toBeNull();
    expect(c.querySelector('.lobbyguide')).toBeNull();
  });

  it('a guide expands in place to Core / Enablers rows of real board cards; SIMPLE hides the write-up', () => {
    const c = mountRail(2024);
    openGuides(c);
    const first = c.querySelector('.lobbyguide')!;
    const head = first.querySelector('.lobbyguide-head')!;
    click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(first.querySelectorAll('.lobbyguide-unitslabel').length).toBeGreaterThan(0);
    expect(first.querySelectorAll('.lobbyguide-unit .card').length).toBeGreaterThan(0);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-simple')).toBe(true);
    expect(first.querySelector('.lobbyguide-text')).toBeNull();
    click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });

  it("an open card's Detailed button widens the rail and shows the write-up; it is remembered; Simple folds back", () => {
    const c = mountRail(31337);
    openGuides(c);
    click(c.querySelector('.lobbyguide-head')!);
    const detailed = c.querySelector('.lobbyguide.open .lobbyguide-modebtn')!;
    expect(detailed.textContent).toBe('Detailed');
    click(detailed);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-full')).toBe(true);
    expect(c.querySelector('.lobbyguide.open .lobbyguide-text')).not.toBeNull();
    expect(localStorage.getItem('ascent.guidesMode')).toBe('full');
    // ...and back.
    expect(c.querySelector('.lobbyguide.open .lobbyguide-modebtn')!.textContent).toBe('Simple');
    click(c.querySelector('.lobbyguide.open .lobbyguide-modebtn')!);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-simple')).toBe(true);
    expect(c.querySelector('.lobbyguides-group')).toBeNull();
  });

  it('a new game starts on Opponents', () => {
    const c = mountRail(4242);
    click(c.querySelector('.lobbyrailtab')!);
    ui!.unmount();
    const c2 = mountRail(777);
    expect(c2.querySelector('.lobbyseat')).not.toBeNull();
    expect(c2.querySelector('.lobbyrailtab')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('the Tutorial has no Guides tab', () => {
    const c = mountRail(4242, 'tutorial');
    expect(c.querySelector('.lobbyrailtab')).toBeNull();
  });

  it('no native title tooltips; the tab goes inert with the rail in combat', () => {
    const c = mountRail(9001);
    openGuides(c);
    click(c.querySelector('.lobbyguide-head')!);
    expect(c.querySelector('[title]')).toBeNull();
    const css = readFileSync(join(__dirname, 'lobbyGuides.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.app\.staged \.lobbyrailtab \{[^}]*pointer-events: none;/);
    expect(css).not.toMatch(/cursor:/);
  });
});
