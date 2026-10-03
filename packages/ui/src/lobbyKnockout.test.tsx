// @vitest-environment jsdom
/**
 * THE LOBBY RAIL KNOCKOUT + GHOST MARKER (owner asks 2026-10-02: "can you add a simple animation for when a player is
 * knocked out? some pixi smoke/burst as their card fades. then, if the player is facing a ghost, make the target
 * highlight greenish blue instead of red").
 * Pins: the knockout FX fires exactly ONCE per new elimination (not on re-render, not again on a later lobby update),
 * NEVER for a seat that was already out when the rail mounted; and a ghost pairing marks the foe row `ghost` (the
 * teal `--ui-ghost` marker in lobbyRail.css) while a live pairing does not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun, type RunLobby, type RunState } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { newlyKnockedOut } from './lobbyKnockoutFx';

const ko = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('./lobbyKnockoutFx', async (orig) => ({
  ...(await orig<typeof import('./lobbyKnockoutFx')>()),
  playLobbyKnockoutOnSeat: (id: string) => { ko.calls.push(id); return true; },
}));
const ghost = vi.hoisted(() => ({ on: false }));
vi.mock('@game/sim', async (orig) => {
  const real = await orig<typeof import('@game/sim')>();
  return {
    ...real,
    playerOpponent: (lobby: RunLobby) => {
      if (!ghost.on) return real.playerOpponent(lobby);
      const dead = lobby.seats.find((s) => !s.alive)!;
      return { seat: dead, board: real.playerOpponent({ ...lobby, seats: lobby.seats.map((s) => ({ ...s, alive: true })) })!.board, ghost: true };
    },
  };
});

const { LobbyPanel } = await import('./LobbyPanel');
const { useGame } = await import('./store');

let ui: Mounted | null = null;
beforeEach(() => { ko.calls = []; ghost.on = false; });
afterEach(() => { ui?.unmount(); ui = null; });

const baseRun = (): RunState => createLobbyRun(4242, 'warden');
const kill = (lobby: RunLobby, ids: string[]): RunLobby => ({
  ...lobby,
  seats: lobby.seats.map((s, i) => (ids.includes(s.id) ? { ...s, alive: false, resolve: 0, armor: 0, placement: 8 - i } : s)),
});
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 40)); }); };

describe('newlyKnockedOut', () => {
  const seats = [{ id: 'a', alive: true }, { id: 'b', alive: false }, { id: 'c', alive: false }];
  it('announces nothing on the first sight of a table', () => expect(newlyKnockedOut(null, seats)).toEqual([]));
  it('announces only seats that were alive last time', () => expect(newlyKnockedOut(new Set(['a', 'b']), seats)).toEqual(['b']));
});

describe('lobby rail knockout', () => {
  it('fires once per new elimination, and never again on later updates', async () => {
    const run = baseRun();
    act(() => { useGame.setState({ run }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    await flush();
    expect(ko.calls).toEqual([]);

    const l1 = kill(run.lobby!, ['s7']);
    ui.render(<LobbyPanel lobby={l1} />);
    await flush();
    expect(ko.calls).toEqual(['s7']);
    expect(ui.container.querySelector('[data-seat="s7"]')!.classList.contains('ko')).toBe(true);

    ui.render(<LobbyPanel lobby={{ ...l1 }} />); // a lobby update with the same table
    await flush();
    ui.render(<LobbyPanel lobby={l1} />); // a plain re-render
    await flush();
    expect(ko.calls).toEqual(['s7']);

    ui.render(<LobbyPanel lobby={kill(l1, ['s6'])} />); // the next knockout fires for that seat only
    await flush();
    expect(ko.calls).toEqual(['s7', 's6']);
  });

  it('a seat already out when the rail mounts shows the static dead row with no effect', async () => {
    const run = baseRun();
    const lobby = kill(run.lobby!, ['s5', 's7']);
    act(() => { useGame.setState({ run: { ...run, lobby } }); });
    ui = mount(<LobbyPanel lobby={lobby} />);
    await flush();
    ui.render(<LobbyPanel lobby={{ ...lobby }} />);
    await flush();
    expect(ko.calls).toEqual([]);
    const row = ui.container.querySelector('[data-seat="s7"]')!;
    expect(row.classList.contains('dead')).toBe(true);
    expect(row.classList.contains('ko')).toBe(false);
  });
});

describe('lobby rail ghost marker', () => {
  it('a ghost pairing marks the foe row with the teal ghost class', () => {
    ghost.on = true;
    const run = baseRun();
    const lobby = kill(run.lobby!, ['s7']);
    act(() => { useGame.setState({ run: { ...run, lobby } }); });
    ui = mount(<LobbyPanel lobby={lobby} />);
    const row = ui.container.querySelector('[data-seat="s7"]')!;
    expect(row.className).toMatch(/\bfoe\b/);
    expect(row.className).toMatch(/\bghost\b/);
    expect(ui.container.querySelectorAll('.lobbyseat.ghost')).toHaveLength(1);
  });

  it('a live pairing keeps the red marker (no ghost class)', () => {
    const run = baseRun();
    act(() => { useGame.setState({ run }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    expect(ui.container.querySelector('.lobbyseat.foe')).not.toBeNull();
    expect(ui.container.querySelector('.lobbyseat.ghost')).toBeNull();
  });
});
