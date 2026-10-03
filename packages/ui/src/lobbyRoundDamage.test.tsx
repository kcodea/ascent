// @vitest-environment jsdom
/**
 * THE ROUND'S DAMAGE ON THE LOBBY RAIL (owner ask 2026-10-03: "remove the -x number here. when the player gets back
 * to lobby, they can have the damage dealt to players show and float/fade, but dont leave it on the rail. players
 * can mouse over for the combat detail from last round").
 * Pins: no seat row prints a persistent round-damage number; each seat that lost Health last round gets ONE float
 * (never on a re-render, never again on a remount or reload, nothing for an unhurt or fallen seat); and the seat's
 * hover card carries last round's fight with its damage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun, type RunLobby } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { roundDamageFloats } from './lobbyDamageFx';

const fx = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('./lobbyDamageFx', async (orig) => ({
  ...(await orig<typeof import('./lobbyDamageFx')>()),
  floatLobbyDamageOnSeat: (id: string, amount: number) => { fx.calls.push(`${id}:${amount}`); return true; },
}));
// The knockout FX is not under test here; keep it off the Pixi layer.
vi.mock('./lobbyKnockoutFx', async (orig) => ({
  ...(await orig<typeof import('./lobbyKnockoutFx')>()),
  playLobbyKnockoutOnSeat: () => true,
}));

const { LobbyPanel } = await import('./LobbyPanel');
const { useGame } = await import('./store');

let ui: Mounted | null = null;
beforeEach(() => { fx.calls = []; });
afterEach(() => { ui?.unmount(); ui = null; });

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 40)); }); };

/** Round 1 settled: you (s0) lost 5 to s1, s3 lost 7 to s2, s4 and s5 drew, s6 knocked s7 out for 9. */
function settled(base: RunLobby): RunLobby {
  return {
    ...base,
    round: 2,
    seats: base.seats.map((s) => (s.id === 's7' ? { ...s, alive: false, resolve: 0, armor: 0, placement: 8 } : s)),
    encounters: [
      { round: 1, a: 's0', b: 's1', outcome: 'lose', damageToA: 5, damageToB: 0, fought: true },
      { round: 1, a: 's2', b: 's3', outcome: 'win', damageToA: 0, damageToB: 7, fought: true },
      { round: 1, a: 's4', b: 's5', outcome: 'draw', damageToA: 0, damageToB: 0, fought: true },
      { round: 1, a: 's6', b: 's7', outcome: 'win', damageToA: 0, damageToB: 9, fought: true },
    ],
  };
}

describe('roundDamageFloats', () => {
  it('lists every standing seat that lost Health, and nobody else', () => {
    const seats = [{ id: 'a', alive: true }, { id: 'b', alive: true }, { id: 'c', alive: false }, { id: 'd', alive: true }];
    expect(roundDamageFloats(seats, { a: { taken: 4 }, b: { taken: 0 }, c: { taken: 9 } })).toEqual([{ id: 'a', amount: 4 }]);
  });
});

describe('lobby rail round damage', () => {
  it('prints no persistent round-damage number on any row, in either look', () => {
    const run = createLobbyRun(4242, 'warden');
    const lobby = settled(run.lobby!);
    act(() => { useGame.setState({ run: { ...run, lobby } }); });
    ui = mount(<LobbyPanel lobby={lobby} />);
    for (const look of ['gem', 'classic']) {
      document.documentElement.setAttribute('data-lobby-rail', look);
      expect(ui.container.querySelector('.lobbydmg')).toBeNull();
      for (const row of ui.container.querySelectorAll('.lobbyseat')) expect(row.textContent).not.toMatch(/[−-]\d/);
    }
    document.documentElement.removeAttribute('data-lobby-rail');
  });

  it('floats each hurt seat once per round, never on a re-render or a remount', async () => {
    const run = createLobbyRun(4242, 'warden');
    act(() => { useGame.setState({ run }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    await flush();
    expect(fx.calls).toEqual([]);

    const l2 = settled(run.lobby!);
    ui.render(<LobbyPanel lobby={l2} />);
    await flush();
    // You and s3 lost Health; the draw, the winners and the fallen s7 say nothing.
    expect([...fx.calls].sort()).toEqual(['s0:5', 's3:7']);

    ui.render(<LobbyPanel lobby={{ ...l2 }} />); // a lobby update inside the same round
    await flush();
    ui.render(<LobbyPanel lobby={l2} />); // a plain re-render
    await flush();
    expect(fx.calls).toHaveLength(2);

    ui.unmount(); // a remount (or a reload) with the round already settled replays nothing
    ui = mount(<LobbyPanel lobby={l2} />);
    await flush();
    expect(fx.calls).toHaveLength(2);

    // The next round's damage floats again, for its own seats only.
    const l3: RunLobby = {
      ...l2, round: 3,
      encounters: [...l2.encounters, { round: 2, a: 's1', b: 's2', outcome: 'win', damageToA: 0, damageToB: 3, fought: true }],
    };
    ui.render(<LobbyPanel lobby={l3} />);
    await flush();
    expect(fx.calls.slice(2)).toEqual(['s2:3']);
  });

  it('the hover card shows last round\'s fight and its damage', () => {
    const run = createLobbyRun(4242, 'warden');
    const lobby = settled(run.lobby!);
    act(() => { useGame.setState({ run: { ...run, lobby } }); });
    ui = mount(<LobbyPanel lobby={lobby} />);
    const row = ui.container.querySelector('[data-seat="s3"]')!;
    act(() => { row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
    const card = document.body.querySelector('.lobbyscout')!;
    expect(card).not.toBeNull();
    const fight = card.querySelector('.lobbyscout-row')!;
    expect(fight.querySelector('.lobbyscout-round')!.textContent).toBe('1');
    expect(fight.querySelector('.lobbyscout-result')!.textContent).toBe('LOST');
    expect(fight.querySelector('.lobbyscout-dmg')!.textContent).toBe('−7');
  });
});
