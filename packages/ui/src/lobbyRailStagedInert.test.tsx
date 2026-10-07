// @vitest-environment jsdom
/**
 * THE LOBBY RAIL IS INERT WHILE IT IS SLID AWAY (owner bug 2026-10-06: "the lobby rail shouldnt be able to be moused
 * over here", a combat screenshot with a seat's scout card open over the foe's portrait).
 * Root cause: `.app.staged .lobbyrail { pointer-events: none }` never reached the seats, because `.lobbyrail > *`
 * sets `pointer-events: auto` on the rail's children. `.app` is a 16:9 box, so on a wider window the slid-away rail
 * sits at opacity 0 in the visible right margin and its seats kept catching the cursor.
 * Pins: (1) while `combatStaged` is on, hovering or clicking a rail seat opens no scout card; (2) a card already open
 * (hovered or pinned) when staging starts closes at once; (3) hover works normally once the rail is back; (4) the
 * stylesheet makes every descendant of the staged rail, its header and the Gauntlet foe pointer-inert.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { LobbyPanel } from './LobbyPanel';
import { useGame } from './store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; act(() => { useGame.setState({ combatStaged: false }); }); });

const hover = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); }); };
const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const card = (): Element | null => document.body.querySelector('.lobbyscout');
const setStaged = (v: boolean): void => { act(() => { useGame.setState({ combatStaged: v }); }); };

const mountRail = (): HTMLElement => {
  const run = createLobbyRun(4242, 'warden');
  act(() => { useGame.setState({ run, combatStaged: false }); });
  ui = mount(<LobbyPanel lobby={run.lobby!} />);
  return ui.container;
};

describe('lobby rail: no hover while staged (combat)', () => {
  it('hovering or clicking any rail seat during the staged window opens nothing', () => {
    const c = mountRail();
    setStaged(true);
    const seats = [...c.querySelectorAll('.lobbyseat')];
    expect(seats.length).toBeGreaterThan(1);
    for (const s of seats) {
      hover(s);
      expect(card()).toBeNull();
    }
    click(c.querySelector('.lobbyseat:not(.you)')!);
    expect(card()).toBeNull();
  });

  it('a hovered card open when staging starts closes immediately', () => {
    const c = mountRail();
    hover(c.querySelector('.lobbyseat:not(.you)')!);
    expect(card()).not.toBeNull();
    setStaged(true);
    expect(card()).toBeNull();
  });

  it('a pinned card open when staging starts closes immediately', () => {
    const c = mountRail();
    click(c.querySelector('.lobbyseat:not(.you)')!);
    expect(document.body.querySelector('.lobbyscout.pinned')).not.toBeNull();
    setStaged(true);
    expect(card()).toBeNull();
  });

  it('hover works again once the rail returns', () => {
    const c = mountRail();
    setStaged(true);
    setStaged(false);
    hover(c.querySelector('.lobbyseat:not(.you)')!);
    expect(card()).not.toBeNull();
  });

  it('the stylesheet makes every descendant of the slid-away rail, header and Gauntlet foe pointer-inert', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.app\.staged \.lobbyrail \*, \.app\.staged \.lobbyrailhead \* \{ pointer-events: none; \}/);
    expect(css).toMatch(/\.app\.staged \.gauntletfoe \* \{ pointer-events: none; \}/);
  });
});
