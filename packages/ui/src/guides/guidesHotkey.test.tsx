// @vitest-environment jsdom
/**
 * R-GUIDES-KEY-01 + R-GUIDES-QUICKLOOK-01 (owner 2026-11-27: "add "g" as a keybind to open guides. Make the guides overlay look
 * like the new in game compendium overlay"). Pins: G opens the Guides overlay and G closes it; it is ignored while typing, with
 * Ctrl held, on a held key's repeats, in combat and in the Tutorial; it is a Settings binding like the rest; the overlay is
 * built from the quick Compendium's own classes, and its X and a press outside close it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { LobbyPanel } from '../LobbyPanel';
import { useGame } from '../store';
import { KEY_ACTION_INDEX, keysOf } from '../keybinds/keybinds';
import { resetGuidesForTests } from './guidesStore';

let ui: Mounted | null = null;
afterEach(() => {
  act(() => { resetGuidesForTests(); });
  act(() => { useGame.setState({ showBook: false, combatStaged: false }); });
  ui?.unmount(); ui = null;
  document.querySelectorAll('input').forEach((el) => el.remove());
});

const mountRail = (seed: number, mode?: 'tutorial'): HTMLElement => {
  const run = createLobbyRun(seed, 'warden');
  if (mode) run.mode = mode;
  act(() => { useGame.setState({ run, combatStaged: false, heroChoices: null }); });
  ui = mount(<LobbyPanel lobby={run.lobby!} />);
  return document.body; // the overlay is portaled to the stage (R-GUIDES-QUICKLOOK-01)
};
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); });
  return e;
};
const open = (c: HTMLElement): boolean => c.querySelector('.guidesdock:not(.closing)') !== null;
const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

describe('G opens the guides', () => {
  it('is a Settings binding, G by default', () => {
    expect(KEY_ACTION_INDEX.guides).toMatchObject({ label: 'Guides', group: 'game', defaults: ['g'] });
    expect(keysOf('guides')).toEqual(['g']);
  });

  it('G opens the overlay and G closes it again; the square says so', () => {
    const c = mountRail(7101);
    expect(open(c)).toBe(false);
    const e = press('g');
    expect(e.defaultPrevented).toBe(true);
    expect(open(c)).toBe(true);
    expect(c.querySelector('.guidesbtn')!.getAttribute('aria-pressed')).toBe('true');
    press('g', { repeat: true }); // a held key never toggles it again
    expect(open(c)).toBe(true);
    press('G', { shiftKey: true }); // Shift is allowed, like every binding
    expect(open(c)).toBe(false);
    expect(c.querySelector('.guidesdock.closing')).not.toBeNull();
  });

  it('is ignored while typing, with Ctrl held, in combat and in the Tutorial', () => {
    const c = mountRail(7102);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press('g', {}, input);
    expect(open(c)).toBe(false);
    input.blur();
    press('g', { ctrlKey: true });
    expect(open(c)).toBe(false);
    act(() => { useGame.setState({ combatStaged: true }); });
    press('g');
    expect(c.querySelector('.guidesdock')).toBeNull();
    act(() => { useGame.setState({ combatStaged: false }); });
    press('g');
    expect(open(c)).toBe(true);
    ui!.unmount(); ui = null;
    const t = mountRail(7103, 'tutorial');
    press('g');
    expect(t.querySelector('.guidesdock')).toBeNull();
  });

  it('wears the quick Compendium overlay: its dim, place, head, line and X; the X and a press outside close it', () => {
    const c = mountRail(7104);
    press('g');
    const ov = c.querySelector('.guidesdock')!;
    expect(ov.classList.contains('qb')).toBe(true);
    for (const part of ['.qb-dim', '.qb-place', '.qb-panel', '.qb-head .qb-title h2', '.qb-count', '.qb-line', '.qb-x']) expect(ov.querySelector(part)).not.toBeNull();
    expect(ov.querySelector('.qb-title h2')!.textContent).toBe('Guides');
    expect(ov.getAttribute('aria-label')).toBe('Build guides. Press Esc or G to close.');
    expect(ov.querySelector('[title]')).toBeNull();
    click(ov.querySelector('.qb-x')!);
    expect(open(c)).toBe(false);
    press('g');
    expect(open(c)).toBe(true);
    click(c.querySelector('.guidesdock .qb-dim')!);
    expect(open(c)).toBe(false);
  });

  it('opening the Compendium puts the guides away, and G from the Compendium swaps back to them', () => {
    const c = mountRail(7105);
    press('g');
    act(() => { useGame.getState().toggleBook(); });
    expect(open(c)).toBe(false);
    press('g');
    expect(useGame.getState().showBook).toBe(false);
    expect(open(c)).toBe(true);
  });
});
