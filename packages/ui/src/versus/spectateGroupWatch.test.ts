// @vitest-environment jsdom
/**
 * VERSUS GROUP: WATCH OPENS THE LIVE MATCH (owner 2026-10-26: "i just jumped into this game and 'watch' isnt taking me
 * into the lobby to watch it"; R-VERSUS-GROUP-WATCH-01). The watched seat started at p1, and in a group match p1 can be a
 * player already out (their last frame is their end screen, never drawn) or a seat no one took: nothing rendered, Watch
 * re-rendered the same dead seat, and the bar that moves off an out player only mounts once the screen is open. Pinned:
 * a spectator joining mid-match lands on a player still in, Watch after Leave never goes back onto a player who went
 * out meanwhile, and a 1v1 / Duos match keeps its seat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, type RunState } from '@game/sim';
import { newPublisher, nextSpectatorMessage, type SpectatorMessage } from './spectatorView';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const sp = await import('./spectate');

type Seat = 'p1' | 'p2' | 'p3' | 'p4';
const seatRow = (seat: Seat, out: number | null) => ({ seat, userId: `u-${seat}`, name: `N${seat}`, hearts: out == null ? 5 : 0, eliminatedRound: out, placement: out == null ? null : 4 });
const groupMatch = (seats: ReturnType<typeof seatRow>[], p: Record<string, unknown> = {}) =>
  ({ id: 'g1', phase: 'shop', round: 10, p1_hearts: 7, p2_hearts: 7, group: { raw: { id: 'g1', round: 10, seats, winner_seat: null } }, ...p }) as never;

const runs: Record<Seat, RunState> = {
  p1: createVersusRun(11, 'warden', 'set2'),
  p2: createVersusRun(22, 'juggler', 'set2'),
  p3: createVersusRun(33, 'warden', 'set2'),
  p4: createVersusRun(44, 'juggler', 'set2'),
};
const keyOf = (seat: Seat, run: RunState): SpectatorMessage => nextSpectatorMessage(newPublisher(seat), run, run.wave, true)!;

let frames: { seat: Seat; frame: unknown }[] = [];
const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  io.latestFrames.mockClear(); io.requestKey.mockClear(); io.loadRounds.mockClear();
  sp.installSpectateIo(io);
  useGame.setState({ showTitle: true, replaying: false, inspect: null });
});
afterEach(() => { sp.resetSpectate(); sp.installSpectateIo(null); vi.unstubAllGlobals(); });

describe('Versus Group: Watch opens the live match (R-VERSUS-GROUP-WATCH-01)', () => {
  it('watchableSeat: keeps a living seat, moves off an out or missing one, leaves a 1v1 match alone', () => {
    const m = groupMatch([seatRow('p1', 6), seatRow('p2', null), seatRow('p3', 8), seatRow('p4', null)]);
    expect(sp.watchableSeat(m, 'p4')).toBe('p4');
    expect(sp.watchableSeat(m, 'p1')).toBe('p2');
    expect(sp.watchableSeat(m, 'p3')).toBe('p2');
    const three = groupMatch([seatRow('p2', null), seatRow('p3', null), seatRow('p4', null)]);
    expect(sp.watchableSeat(three, 'p1')).toBe('p2');
    expect(sp.watchableSeat({ group: undefined } as never, 'p1')).toBe('p1');
    expect(sp.watchableSeat(null, 'p2')).toBe('p2');
  });

  it('joining mid-match with p1 knocked out (its last frame its end screen) opens on a player still in', async () => {
    frames = [
      { seat: 'p1', frame: keyOf('p1', { ...runs.p1, phase: 'gameover' }) },
      { seat: 'p2', frame: keyOf('p2', runs.p2) },
      { seat: 'p4', frame: keyOf('p4', runs.p4) },
    ];
    sp.spectateSync(groupMatch([seatRow('p1', 6), seatRow('p2', null), seatRow('p3', 8), seatRow('p4', null)]), {});
    await flush();
    expect(sp.useSpectate.getState().seat).toBe('p2');
    expect(sp.useSpectate.getState().active).toBe(true);
    expect(useGame.getState().run.heroId).toBe('juggler');
    expect(useGame.getState().showTitle).toBe(false);
  });

  it('a group match no one sat p1 in still opens; Watch after Leave never returns to a player who went out', async () => {
    frames = [{ seat: 'p2', frame: keyOf('p2', runs.p2) }, { seat: 'p3', frame: keyOf('p3', runs.p3) }];
    const live = [seatRow('p2', null), seatRow('p3', null), seatRow('p4', null)];
    sp.spectateSync(groupMatch(live), {});
    await flush();
    expect(sp.useSpectate.getState().active).toBe(true);
    expect(sp.useSpectate.getState().seat).toBe('p2');
    sp.leaveSpectating();
    expect(sp.useSpectate.getState().active).toBe(false);
    // p2 goes out while this spectator is back in the room; the room's Watch button opens the match on p3.
    sp.spectateSync(groupMatch([seatRow('p2', 9), seatRow('p3', null), seatRow('p4', null)], { round: 11 }), {});
    sp.resumeSpectating();
    await flush();
    expect(sp.useSpectate.getState().seat).toBe('p3');
    expect(sp.useSpectate.getState().active).toBe(true);
    expect(useGame.getState().run.heroId).toBe('warden');
  });

  it('a seat with no frames yet asks the players for a keyframe (and re-reads the stored ones)', async () => {
    frames = [];
    sp.spectateSync(groupMatch([seatRow('p1', 4), seatRow('p2', null), seatRow('p3', null)]), {});
    await flush();
    expect(sp.useSpectate.getState().seat).toBe('p2');
    expect(io.requestKey).toHaveBeenCalled();
    expect(sp.useSpectate.getState().active).toBe(false);
    // The player's keyframe arrives over the channel: the screen opens.
    sp.receiveSpectate(keyOf('p2', runs.p2));
    await flush();
    expect(sp.useSpectate.getState().active).toBe(true);
  });

  it('1v1 regression: the room Watch still opens on p1', async () => {
    frames = [{ seat: 'p1', frame: keyOf('p1', runs.p1) }, { seat: 'p2', frame: keyOf('p2', runs.p2) }];
    sp.spectateSync({ id: 'm1', phase: 'shop', round: 3, p1_hearts: 7, p2_hearts: 7 } as never, {});
    await flush();
    sp.leaveSpectating();
    sp.resumeSpectating();
    expect(sp.useSpectate.getState().seat).toBe('p1');
    expect(sp.useSpectate.getState().active).toBe(true);
    expect(useGame.getState().run.heroId).toBe('warden');
  });
});
