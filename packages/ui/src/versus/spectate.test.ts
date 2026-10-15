// @vitest-environment jsdom
/**
 * VERSUS PHASE 2 — SPECTATING (owner 2026-10-14). Pinned:
 *  - a seatless member enters the watch screen on a live match, rendered from the watched seat's projected view, with
 *    `replaying` armed: every live action is swallowed, the hero-power aim does not arm, and nothing persists;
 *  - switching seats is instant from the cached views (no fetch), in the shop and in a fight, where the fight is that
 *    seat's own committed result;
 *  - a sequence gap re-reads the keyframes and asks the players for a fresh one;
 *  - Leave restores the store as it was and stays out until Watch; the match ending leaves on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, reduce, type RunState } from '@game/sim';
import { newPublisher, nextSpectatorMessage, VERSUS_SPECTATOR_SECRET_KEYS, type SpectatorMessage } from './spectatorView';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const sp = await import('./spectate');

const match = (p: Record<string, unknown> = {}) => ({ id: 'm1', phase: 'shop', round: 1, p1_hearts: 7, p2_hearts: 7, ...p }) as never;

const p1Run = createVersusRun(11, 'warden', 'set2');
const p2Run = createVersusRun(22, 'juggler', 'set2');
const keyOf = (seat: 'p1' | 'p2', run: RunState): { pub: ReturnType<typeof newPublisher>; key: SpectatorMessage } => {
  const pub = newPublisher(seat);
  return { pub, key: nextSpectatorMessage(pub, run, run.wave, true)! };
};

let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];
const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; }); // synchronous: the coalescer sees no pending frame
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  io.latestFrames.mockClear(); io.requestKey.mockClear(); io.loadRounds.mockClear();
  sp.installSpectateIo(io);
  useGame.setState({ showTitle: true, replaying: false, inspect: null });
});
afterEach(() => { sp.resetSpectate(); sp.installSpectateIo(null); vi.unstubAllGlobals(); });

describe('Versus spectating', () => {
  it('enters the watch screen from the keyframes, inert, showing the watched seat; 1 / 2 switch instantly', async () => {
    const a = keyOf('p1', p1Run), b = keyOf('p2', p2Run);
    frames = [{ seat: 'p1', frame: a.key }, { seat: 'p2', frame: b.key }];
    const before = useGame.getState().run;
    sp.spectateSync(match(), {});
    await flush();
    const g = useGame.getState();
    expect(sp.useSpectate.getState().active).toBe(true);
    expect(g.replaying).toBe(true);
    expect(g.showTitle).toBe(false);
    expect(g.run.heroId).toBe('warden');
    expect(g.run.mode).toBe('versus');
    for (const k of VERSUS_SPECTATOR_SECRET_KEYS.filter((x) => x !== 'seed' && x !== 'runId' && x !== 'pool' && x !== 'rngCursor' && x !== 'pendingTavern')) {
      expect((g.run as unknown as Record<string, unknown>)[k], k).toBeUndefined();
    }
    // inert: a live action is swallowed, the hero-power aim does not arm
    const shown = g.run;
    g.dispatch({ type: 'roll' });
    g.armHero();
    expect(useGame.getState().run).toBe(shown);
    expect(useGame.getState().heroArmed).toBe(false);
    // switch: instant, no fetch
    const fetches = io.latestFrames.mock.calls.length;
    sp.watchSeat('p2');
    expect(useGame.getState().run.heroId).toBe('juggler');
    expect(io.latestFrames.mock.calls.length).toBe(fetches);
    sp.watchSeat('p1');
    expect(useGame.getState().run.heroId).toBe('warden');
    // Leave: the store comes back, and a later sync does not re-enter until Watch
    sp.leaveSpectating();
    expect(useGame.getState().replaying).toBe(false);
    expect(useGame.getState().showTitle).toBe(true);
    expect(useGame.getState().run).toBe(before);
    sp.spectateSync(match(), {});
    expect(sp.useSpectate.getState().active).toBe(false);
    sp.resumeSpectating();
    expect(sp.useSpectate.getState().active).toBe(true);
  });

  it('deltas update the watched screen; a gap re-reads the keyframes and asks the players for one', async () => {
    const a = keyOf('p1', p1Run);
    frames = [{ seat: 'p1', frame: a.key }];
    sp.spectateSync(match(), {});
    await flush();
    const bought = reduce(p1Run, { type: 'buy', uid: p1Run.shop[0]!.uid });
    const d1 = nextSpectatorMessage(a.pub, bought, 1)!;
    sp.receiveSpectate(d1);
    expect(useGame.getState().run.hand.length).toBe(bought.hand.length);
    const fetches = io.latestFrames.mock.calls.length;
    const played = reduce(bought, { type: 'play', uid: bought.hand[0]!.uid });
    nextSpectatorMessage(a.pub, played, 1); // lost on the wire
    const d3 = nextSpectatorMessage(a.pub, reduce(played, { type: 'freeze' }), 1)!;
    sp.receiveSpectate(d3);
    expect(io.requestKey).toHaveBeenCalledTimes(1);
    expect(io.latestFrames.mock.calls.length).toBe(fetches + 1);
  });

  it('in a fight, the watched seat plays its own committed result; switching shows the other side', async () => {
    const inFight = (run: RunState): RunState => ({ ...run, phase: 'combat' });
    const a = keyOf('p1', inFight(p1Run)), b = keyOf('p2', inFight(p2Run));
    frames = [{ seat: 'p1', frame: a.key }, { seat: 'p2', frame: b.key }];
    const r1 = { tag: 'p1 side' }, r2 = { tag: 'p2 side' };
    // Not committed yet: nothing to play, the rounds are asked for.
    sp.spectateSync(match({ phase: 'combat' }), {});
    await flush();
    expect(io.loadRounds).toHaveBeenCalled();
    sp.spectateSync(match({ phase: 'combat' }), { 1: { round: 1, p1_result: r1, p2_result: r2 } as never });
    await flush();
    expect(useGame.getState().run.lastCombat).toBe(r1);
    sp.watchSeat('p2');
    expect(useGame.getState().run.lastCombat).toBe(r2);
  });

  it('the match ending leaves the watch screen', async () => {
    frames = [{ seat: 'p1', frame: keyOf('p1', p1Run).key }];
    sp.spectateSync(match(), {});
    await flush();
    expect(sp.useSpectate.getState().active).toBe(true);
    sp.spectateSync(match({ phase: 'complete' }), {});
    expect(sp.useSpectate.getState().active).toBe(false);
    expect(useGame.getState().replaying).toBe(false);
  });

  it('ONE ROOM, MANY MATCHES: a new match drops the last one (views, screen), and frames of another match are ignored', async () => {
    const a = keyOf('p1', p1Run);
    frames = [{ seat: 'p1', frame: { ...a.key, m: 'm1' } }];
    sp.spectateSync(match(), {});
    await flush();
    expect(sp.useSpectate.getState().active).toBe(true);
    // a late frame from ANOTHER match never lands
    const stale = nextSpectatorMessage(a.pub, reduce(p1Run, { type: 'freeze' }), 1)!;
    sp.receiveSpectate({ ...stale, m: 'old-match' });
    expect(!!useGame.getState().run.frozen).toBe(!!p1Run.frozen);
    // the room's next match: the old views are gone until the new match's keyframes arrive
    frames = [];
    sp.spectateSync(match({ id: 'm2' }), {});
    expect(sp.spectatorViewOf('p1')).toBeNull();
    expect(sp.useSpectate.getState().active).toBe(false);
  });
});
