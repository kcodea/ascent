// @vitest-environment jsdom
/**
 * THE STANDS FOLLOW A SKIPPED FIGHT BACK TO THE SHOP, IN REAL TIME (owner 2026-10-20: "spectating combat when a player
 * skips breaks everything basically, if a player skips combat the spectator should follow their view back to shop in
 * real time"; R-SPECTATE-SKIP-01). Pinned:
 *  - THE TAP: the player's Skip press is tagged for the stands (nobody watching: nothing kept).
 *  - THE SKIP: the tag asks the watch screen to skip that fight; Recruit runs the same skip the player's button runs
 *    once the fight is playing there (a Skip landing during the entrance waits for it), never once it is done.
 *  - BACK TO THE SHOP: the player's shop view arriving while the spectator's replay is still mid-fight starts the exit
 *    at once (never a fight behind the player), and the shop actions they made meanwhile wait for the swap, then play
 *    on the shop as it stood before them (never presented over the fight).
 *  - R-SPECTATE-SAMEHERO-01: every lobby object the watch screen puts up has its authored seats' drivers rebuilt from it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createVersusRun, playerOpponent, versusLobby, type BoardCard, type RunState } from '@game/sim';
import type { CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { newPublisher, nextSpectatorMessage } from './spectatorView';
import type { PresentedAction } from '../actionPresenter';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const sp = await import('./spectate');
const tap = await import('./spectateTap');
const press = await import('../pressCue');
const presenter = await import('../actionPresenter');
const hover = await import('./spectatorHover');
const { DiscoverDialog } = await import('../discoverEntrance/DiscoverDialog');

const bc = (uid: string, cardId: string, tribe: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false }) as unknown as BoardCard;
const shopRun = (): RunState => {
  const r = createVersusRun(5, 'warden', 'set2');
  return { ...r, board: [bc('b1', 'dw_foreman', 'dwarf', 5, 7), bc('b2', 'dw_pimm', 'dwarf', 3, 1)], hand: [bc('h1', 'dw_pimm', 'dwarf', 3, 1)] } as RunState;
};
const fight = { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } };
const rounds = { 1: { round: 1, p1_result: fight, p2_result: fight } } as never;
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];
const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  sp.installSpectateIo(io);
});
afterEach(() => {
  sp.resetSpectate();
  sp.installSpectateIo(null);
  tap.setSpectatorTap(false, null, null);
  hover.watchLocalHover(false);
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Watch from the shop, then into the round-1 fight (seen from its start). */
async function watchIntoFight(id: string): Promise<{ pub: ReturnType<typeof newPublisher>; shop0: RunState }> {
  const shop0 = shopRun();
  const pub = newPublisher('p1');
  frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, shop0, 1, true) }];
  sp.spectateSync({ id, phase: 'shop', round: 1 } as never, rounds);
  await flush();
  sp.receiveSpectate(nextSpectatorMessage(pub, { ...shop0, phase: 'combat' } as RunState, 1)!);
  expect(useGame.getState().run.phase).toBe('combat');
  useGame.setState({ combatReplayDone: false });
  return { pub, shop0 };
}

describe('R-SPECTATE-SKIP-01: the tap', () => {
  it('the Skip press is tagged and wakes the publisher; with nobody watching nothing is kept', () => {
    tap.tapSkipCombat();
    expect(tap.takeActs()).toEqual([]);
    const wake = vi.fn();
    tap.setSpectatorTap(true, 'p1', vi.fn(), wake);
    tap.tapSkipCombat();
    expect(wake).toHaveBeenCalledOnce();
    expect(tap.takeActs()).toEqual([{ t: 'skipCombat' }]);
  });

  it('Recruit tags the player\'s own Skip and runs the same skip on the watch screen\'s cue', () => {
    const src = readFileSync(join(__dirname, '..', 'Recruit.tsx'), 'utf8');
    expect(src).toContain('if (!useGame.getState().replaying) tapSkipCombat();');
    expect(src).toContain('if (!replay.done) skipCombat();');
  });
});

describe('R-SPECTATE-SKIP-01: the spectator skips with the player', () => {
  it('the tag asks this screen to skip that fight (Recruit performs it once the fight plays); never from the shop', async () => {
    const { pub, shop0 } = await watchIntoFight('sk1');
    vi.useFakeTimers();
    const settled = { ...shop0, phase: 'combat', combatSettled: true } as RunState;
    const m = nextSpectatorMessage(pub, settled, 1, false, true)!;
    m.acts = [{ t: 'skipCombat' }];
    sp.receiveSpectate(m);
    vi.advanceTimersByTime(100);
    const first = sp.useSpectate.getState().skip;
    expect(first).toMatchObject({ wave: 1 });
    // a stray Skip tag on a shop view asks for nothing
    const shop = nextSpectatorMessage(pub, { ...shop0, wave: 2 } as RunState, 2, false, true)!;
    shop.acts = [{ t: 'skipCombat' }];
    sp.receiveSpectate(shop);
    sp.spectatorFightCovered();
    vi.advanceTimersByTime(100);
    expect(sp.useSpectate.getState().skip).toEqual(first);
  });
});

describe('R-SPECTATE-SKIP-01: back to the shop with the player', () => {
  it('the exit starts the moment the player is back, mid-replay; their shop actions wait for the swap, then play on the shop they were made in', async () => {
    const { pub } = await watchIntoFight('sk2');
    vi.useFakeTimers();
    const relight = vi.fn();
    const offPress = press.onPressCue('endCombat', relight);
    const seen: PresentedAction[] = [];
    const offPresent = presenter.setActionPresenter((a) => seen.push(a));
    // The player skipped and pressed End Combat: their shop (round 2) arrives, this screen's replay still mid-fight.
    const shop2 = { ...shopRun(), wave: 2 } as RunState;
    sp.receiveSpectate(nextSpectatorMessage(pub, shop2, 2, true)!);
    expect(relight).toHaveBeenCalledTimes(1); // the exit curtain starts NOW, not after this screen's replay + strike
    // ...and before the curtain is closed, they already play a card
    const played = { ...shop2, hand: [], board: [...shop2.board, shop2.hand[0]!] } as RunState;
    const m = nextSpectatorMessage(pub, played, 2)!;
    m.acts = [{ t: 'play', uid: 'h1' }];
    sp.receiveSpectate(m);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([]); // never presented over the fight
    expect(useGame.getState().run.phase).toBe('combat');
    sp.spectatorFightCovered(); // Recruit, at the curtain's full cover
    const after = useGame.getState().run;
    expect(after.phase).toBe('recruit');
    expect(after.wave).toBe(2);
    expect(after.hand.map((c) => c.uid)).toEqual(['h1']); // the shop as it stood BEFORE the play
    vi.advanceTimersByTime(200);
    expect(seen.map((a) => a.kind)).toEqual(['placing', 'played']); // then the play, on that shop
    expect(useGame.getState().run.hand).toEqual([]);
    offPresent();
    offPress();
  });
});

describe('R-SPECTATE-SAMEHERO-01: the watch screen rebuilds its lobby\'s authored seats', () => {
  it('two players on the same hero with the same name: switching seats shows each side its own opponent', async () => {
    const body = Object.keys(CARD_INDEX).find((id) => !CARD_INDEX[id]!.spell && !CARD_INDEX[id]!.token)!;
    const res = (atk: number): CombatResult => ({ events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [{ uid: 'e', cardId: body, attack: atk, health: 9, keywords: [], golden: false }] } } as unknown as CombatResult);
    const lobbyOf = (seat: 'p1' | 'p2', atk: number): RunState['lobby'] => versusLobby({
      matchSeed: 3, setId: 'set2', seat, wave: 2, inCombat: true, combatSettled: false,
      me: { label: 'Player', heroId: 'warden' }, foe: { label: 'Player', heroId: 'warden' },
      rounds: [{ round: 1, heartLostBy: null, mine: res(atk) }],
    });
    const two = { 1: { round: 1, p1_result: fight, p2_result: fight }, 2: { round: 2, p1_result: fight, p2_result: fight } } as never;
    const run1 = { ...shopRun(), wave: 2, lobby: lobbyOf('p1', 4) } as RunState;
    const run2 = { ...shopRun(), wave: 2, lobby: lobbyOf('p2', 6) } as RunState;
    const pub1 = newPublisher('p1');
    const pub2 = newPublisher('p2');
    frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub1, run1, 2, true) }, { seat: 'p2', frame: nextSpectatorMessage(pub2, run2, 2, true) }];
    sp.spectateSync({ id: 'sh1', phase: 'shop', round: 2 } as never, two);
    await flush();
    const foeOnScreen = (): number[] | undefined => playerOpponent(useGame.getState().run.lobby!)?.board.minions.map((m) => m.attack);
    expect(foeOnScreen()).toEqual([4]);
    sp.watchSeat('p2');
    expect(foeOnScreen()).toEqual([6]);
    sp.watchSeat('p1');
    expect(foeOnScreen()).toEqual([4]);
  });
});

describe('R-SPECTATE-DISCHOVER-01: a spectator hovers the watched player\'s Discover cards', () => {
  it('an offer card is a pressable card the watch screen\'s inert rule would take away; the stands give its hover back', () => {
    const host = document.createElement('div');
    host.className = 'app viewing spectating';
    document.body.appendChild(host);
    const root = createRoot(host);
    const id = Object.keys(CARD_INDEX).find((k) => !CARD_INDEX[k]!.token)!;
    const c = CARD_INDEX[id]!;
    act(() => {
      root.render(<DiscoverDialog ids={[id]} occasion={null} onPick={() => undefined}
        cards={[{ name: c.name, cardId: id, tribe: c.tribe, universalTribe: false, attack: c.attack, health: c.health, keywords: c.keywords, text: '', tier: c.tier, spell: !!c.spell, ruby: !!c.ruby }]} />);
    });
    const card = host.querySelector('.discover-ov .card')!;
    expect(card.getAttribute('role')).toBe('button'); // why `.app.viewing [role="button"]` made it inert
    expect(card.matches(hover.LOCAL_HOVER_SELECTOR)).toBe(true); // the spectator's own hover wins over the mirror
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    expect(css).toContain(".app.viewing.spectating .discover-ov .card { pointer-events: auto; cursor: url('/cursors/gauntlet_default.svg') 6 2, default; }");
    act(() => { root.unmount(); });
  });
});
