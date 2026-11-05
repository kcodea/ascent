// @vitest-environment jsdom
/**
 * A SPECTATOR'S EVERY FIGHT STARTS (owner 2026-11-04: "it loads the fight and then no unit starts attacking. and i cant
 * fast forward the combat, i have to leave spectating entirely and load back in"; R-SPECTATE-FIGHT-SWAP-01).
 *
 * Recruit starts a fight (its entry curtain, then the replay) only when the screen goes INTO combat: a run swapped from
 * one fight straight to the next never left combat, so its replay never armed and Skip had nothing to skip. The watch
 * screen therefore never swaps fight to fight: the next fight leaves the one on screen through the exit curtain, puts the
 * shop up under it, and only then goes into the new fight, whatever order the frames came in. Pinned:
 *  - (b) the screen is a shop behind: the next fight's view arrives straight after this one (no shop frame between).
 *  - (a) the next fight's view arrives while the exit curtain (after the player's End Combat) is still closing.
 *  - the Recruit backstop: a new fight landing while the arena is already up re-arms the replay.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, type BoardCard, type RunState } from '@game/sim';
import { newPublisher, nextSpectatorMessage } from './spectatorView';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const sp = await import('./spectate');
const press = await import('../pressCue');

const bc = (uid: string, cardId: string, tribe: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false }) as unknown as BoardCard;
const shopRun = (wave: number): RunState => {
  const r = createVersusRun(5, 'warden', 'set2');
  return { ...r, wave, board: [bc('b1', 'dw_foreman', 'dwarf', 5, 7), bc('b2', 'dw_pimm', 'dwarf', 3, 1)], hand: [bc('h1', 'dw_pimm', 'dwarf', 3, 1)] } as RunState;
};
const fightOf = (n: number): unknown => ({ events: [], result: 'win', playerDamage: n, initial: { player: [], enemy: [] } });
const f1 = fightOf(1);
const f2 = fightOf(2);
const rounds = { 1: { round: 1, p1_result: f1, p2_result: f1 }, 2: { round: 2, p1_result: f2, p2_result: f2 } } as never;
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
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Watch from the round-1 shop into the round-1 fight. */
async function watchIntoFight(id: string): Promise<ReturnType<typeof newPublisher>> {
  const pub = newPublisher('p1');
  frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, shopRun(1), 1, true) }];
  sp.spectateSync({ id, phase: 'shop', round: 1 } as never, rounds);
  await flush();
  sp.receiveSpectate(nextSpectatorMessage(pub, { ...shopRun(1), phase: 'combat' } as RunState, 1)!);
  expect(useGame.getState().run).toMatchObject({ phase: 'combat', wave: 1 });
  expect(useGame.getState().run.lastCombat).toBe(f1);
  return pub;
}

/** The phases the store showed, in order (each distinct run object once). */
function trackPhases(): { seen: string[]; off: () => void } {
  const seen: string[] = [];
  const off = useGame.subscribe((st, prev) => { if (st.run !== prev.run) seen.push(`${st.run.phase}:${st.run.wave}`); });
  return { seen, off };
}

/** Recruit's exit curtain: full cover (its spectator callback), then the reveal back to idle. */
function curtainCoversThenReveals(): void {
  useGame.setState({ wipeIdle: false });
  sp.spectatorFightCovered();
  vi.advanceTimersByTime(50);
  useGame.setState({ wipeIdle: true });
  vi.advanceTimersByTime(50);
}

describe('R-SPECTATE-FIGHT-SWAP-01: the next fight never swaps in over the one on screen', () => {
  it('(b) a fight straight after a fight: the screen leaves through the shop, then goes into the new fight', async () => {
    const pub = await watchIntoFight('fs1');
    vi.useFakeTimers();
    const exit = vi.fn();
    const offPress = press.onPressCue('endCombat', exit);
    const t = trackPhases();
    // The round-2 fight's view arrives with no shop frame before it (a stale shop dropped, or End Turn merged into it).
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...shopRun(2), phase: 'combat' } as RunState, 2)!);
    vi.advanceTimersByTime(50);
    expect(exit).toHaveBeenCalledTimes(1); // the exit curtain, as the player's End Combat ran it
    expect(useGame.getState().run).toMatchObject({ phase: 'combat', wave: 1 }); // never swapped fight-to-fight
    curtainCoversThenReveals();
    // Out of the fight (Recruit leaves combat), then into the new one (Recruit enters it: curtain, replay, Skip).
    expect(t.seen).toEqual(['recruit:2', 'combat:2']);
    expect(useGame.getState().run.lastCombat).toBe(f2);
    t.off();
    offPress();
  });

  it('(a) the next fight arrives while the exit curtain is still closing: it waits for the cover, then the shop goes up first', async () => {
    const pub = await watchIntoFight('fs2');
    vi.useFakeTimers();
    const exit = vi.fn();
    const offPress = press.onPressCue('endCombat', exit);
    const t = trackPhases();
    // The player's End Combat: their round-2 shop arrives, the exit curtain starts closing here.
    sp.receiveSpectate(nextSpectatorMessage(pub, shopRun(2), 2)!);
    vi.advanceTimersByTime(50);
    expect(exit).toHaveBeenCalledTimes(1);
    // Before it covers, they end their turn: the round-2 fight arrives mid-curtain.
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...shopRun(2), phase: 'combat' } as RunState, 2)!);
    vi.advanceTimersByTime(50);
    expect(useGame.getState().run).toMatchObject({ phase: 'combat', wave: 1 }); // still the old fight, under the curtain
    expect(exit).toHaveBeenCalledTimes(1); // one exit, not a second
    curtainCoversThenReveals();
    expect(t.seen).toEqual(['recruit:2', 'combat:2']);
    expect(useGame.getState().run.lastCombat).toBe(f2);
    t.off();
    offPress();
  });

  it('a screen nobody draws (no curtain answers) still reaches the new fight, through the shop', async () => {
    const pub = await watchIntoFight('fs3');
    vi.useFakeTimers();
    const t = trackPhases();
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...shopRun(2), phase: 'combat' } as RunState, 2)!);
    vi.advanceTimersByTime(10_000);
    expect(t.seen).toEqual(['recruit:2', 'combat:2']);
    t.off();
  });
});

describe('R-SPECTATE-FIGHT-SWAP-01: the Recruit backstop', () => {
  it('a new fight landing while the arena is up re-arms the replay (the fight starts; Skip has a replay to skip)', () => {
    const src = readFileSync(join(__dirname, '..', 'Recruit.tsx'), 'utf8');
    expect(src).toMatch(/setCombatStage\('fighting'\), 800\);\s*return \(\) => window\.clearTimeout\(t\);(\s*\/\/[^\n]*)*\s*\}, \[inCombat, wipe, run\.lastCombat\]\);/);
  });
});
