// @vitest-environment jsdom
/**
 * THE ROUND HEADER ABOVE THE LOBBY RAIL (owner ask 2026-10-02: "move the Round text to be above the lobby rail.
 * move the max dmg next to the new round location above the rail. make both larger. add a mouseover tooltip for
 * the heart explaining this means the max dmg for that round").
 * Pins: the round and the max-damage readout render in `.lobbyrailhead`, a SIBLING of `.lobbyrail` (outside the
 * rail, which scrolls and would clip them); the seats-left count stays inside the rail; the readout prints the
 * live cap and its hover tip says the same number, or the uncapped wording. The tip is the game's standard HUD
 * tip panel (`.herotip`, the hero-power / Equipment hover; owner 2026-10-02 "fix this tooltip, it's unreadable"
 * about the small `.gtip` bubble), never a native `title=`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun, lossDamageCap, type RunState } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { LobbyPanel } from './LobbyPanel';
import { useGame } from './store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const atRound = (round: number): RunState => {
  const base = createLobbyRun(4242, 'warden');
  return { ...base, wave: round, lobby: { ...base.lobby!, round } };
};

const render = (round: number): HTMLElement => {
  const run = atRound(round);
  act(() => { useGame.setState({ run }); });
  ui = mount(<LobbyPanel lobby={run.lobby!} />);
  return ui.container;
};

describe('lobby rail header (above the rail)', () => {
  it('sits outside the rail: Round N and the max damage in the header, seats-left stays in the rail', () => {
    const c = render(1);
    const head = c.querySelector('.lobbyrailhead')!;
    const rail = c.querySelector('.lobbyrail')!;
    expect(head).not.toBeNull();
    expect(rail.contains(head)).toBe(false);
    expect(head.querySelector('.lobbyround')!.textContent).toBe('Round 1');
    expect(head.querySelector('.lobbymax')).not.toBeNull();
    expect(rail.querySelector('.lobbyround')).toBeNull();
    expect(rail.querySelector('.lobbymax')).toBeNull();
    expect(rail.querySelector('.lobbyhead .lobbyalive')!.textContent).toBe('8 left');
  });

  const tipOf = (max: Element): { title: string; rule: string; aria: string | null } => {
    const tip = max.nextElementSibling!;
    expect(tip.matches('.herotip.lobbymax-tip')).toBe(true);
    expect(tip).not.toBeNull();
    expect(tip.getAttribute('role')).toBe('tooltip');
    return { title: tip.querySelector('b')!.textContent!, rule: tip.querySelector('.herotip-rule')!.textContent!, aria: max.getAttribute('aria-label') };
  };
  const readout = (max: Element): string => max.textContent!;

  it.each([1, 4, 8, 12, 14])('round %i prints the live cap and the tooltip says the same number', (round) => {
    const cap = lossDamageCap(round);
    const max = render(round).querySelector('.lobbyrailhead .lobbymax')!;
    expect(readout(max)).toBe(`Max dmg ${cap}`);
    const tip = tipOf(max);
    expect(tip.title).toBe('Max damage this round');
    expect(tip.rule).toBe(`A loss this round costs at most ${cap} Health.`);
    expect(tip.aria).toBe(`Max damage this round. A loss this round costs at most ${cap} Health.`);
    expect(max.hasAttribute('title')).toBe(false);
    expect(max.hasAttribute('data-tip')).toBe(false);
  });

  it('round 15 on is uncapped: "No cap" and the full-damage tip', () => {
    for (const round of [15, 16, 30]) {
      const max = render(round).querySelector('.lobbyrailhead .lobbymax')!;
      expect(readout(max)).toBe('No cap');
      const tip = tipOf(max);
      expect(tip.title).toBe('No max damage this round');
      expect(tip.rule).toBe('A loss deals full damage.');
      ui?.unmount(); ui = null;
    }
  });

  it('player text has no em dash and no native tooltip anywhere in the header', () => {
    const head = render(3).querySelector('.lobbyrailhead')!;
    expect(head.querySelector('[title]')).toBeNull();
    expect(head.textContent).not.toMatch(/—|--/);
  });
});
