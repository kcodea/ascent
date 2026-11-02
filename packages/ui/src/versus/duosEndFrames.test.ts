// @vitest-environment jsdom
/**
 * A SEATED DUOS PLAYER NEVER BECOMES A SPECTATOR OF THEIR OWN FINISHED MATCH (R-RANKED-DUOS-END-01; reproduced in two
 * headless browsers on the local Worker 2026-11-02, matching both live reports: "combat seemingly restarted, then when it
 * finished just sat at the end combat state and 'returning to shop' just returned to combat", and Lemon frozen on his
 * teammate's last shop). At the match's end the store stopped tracking the Duos match for the player
 * (`trackDuosMatch(null)`), which made the spectate module treat the player as the stands: the teammate's next frame
 * (their deciding fight, still publishing) opened the watch screen over the player's own game. The default watched seat
 * is p1, so it hit the p2 teammate (Lemon) unless p1 had opened the teammate view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, type RunState } from '@game/sim';
import { newPublisher, nextSpectatorMessage } from './spectatorView';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const sp = await import('./spectate');

const fight = { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } };
const rounds = { 1: { round: 1, p1_result: fight, p2_result: fight } } as never;
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const io = { latestFrames: vi.fn(async () => []), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
const duosMatch = (id: string, phase: string) => ({ id, phase, round: 1, group: { me: 'p2', duos: { team: 'a', mate: 'p1' }, raw: { seats: [] } } }) as never;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  sp.installSpectateIo(io);
});
afterEach(() => {
  sp.resetSpectate();
  sp.installSpectateIo(null);
  vi.unstubAllGlobals();
});

describe('R-RANKED-DUOS-END-01: my teammate\'s last frames never take over my screen', () => {
  it('the match ends while my teammate\'s deciding fight still publishes: their frames stay cached, my run stays mine', async () => {
    const mine = { ...createVersusRun(7, 'warden', 'set2'), runId: 'mine', phase: 'combat' } as RunState;
    useGame.setState({ run: mine, replaying: false });
    sp.trackDuosMatch(duosMatch('end-a', 'combat'), rounds);
    await flush();
    sp.trackDuosMatch(duosMatch('end-a', 'complete'), rounds); // the server ended it
    const pub = newPublisher('p1'); // my teammate (p1, the default watched seat)
    const theirs = { ...createVersusRun(9, 'warden', 'set2'), phase: 'combat' } as RunState;
    sp.receiveSpectate(nextSpectatorMessage(pub, theirs, 1, true)!);
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...theirs, combatSettled: true } as RunState, 1)!);
    await flush();
    expect(sp.useSpectate.getState().active).toBe(false);
    expect(useGame.getState().run.runId).toBe('mine');
    expect(useGame.getState().replaying).toBe(false);
  });

  it('back in the room after the end (no seat): a trailing frame of the finished match never opens it either', async () => {
    useGame.setState({ run: { ...createVersusRun(7, 'warden', 'set2'), runId: 'room' } as RunState, replaying: false });
    sp.trackDuosMatch(null, rounds);
    sp.spectateSync(duosMatch('end-b', 'complete'), rounds);
    const pub = newPublisher('p1');
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...createVersusRun(9, 'warden', 'set2'), phase: 'combat' } as RunState, 1, true)!);
    await flush();
    expect(sp.useSpectate.getState().active).toBe(false);
    expect(useGame.getState().run.runId).toBe('room');
  });
});
