// @vitest-environment jsdom
/**
 * THE SPECTATOR'S END + WATCH XP (owner 2026-10-24: "watching a player's game rewards 50% of the xp at the end of the
 * match ... when the game ends for the player, have the gates shut for the spectator and open up at the play menu with
 * the same 'X player came in 1st' or w/e it shows"; R-SPECTATE-END-01, R-PROG-SPECTATE-XP-01). Pinned:
 *  - an open watch screen beats the server at once and every SPECTATE_BEAT_MS; one game at a time; stops on leave;
 *  - the end: one last beat, THEN the settlement is queued (watch:<kind>:<game>, no facts, no amount), the end gate
 *    closes, and behind it the watch screen is left and the notice set (name, place, the XP panel's key); once per game;
 *  - a Versus match: a concede ends the watch at once; a match won on hearts waits for its last fight on screen (or the
 *    cap), then the gate opens on the room.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const queued: Array<{ localKey: string; runId: string }> = [];
vi.mock('../progression/progressionStore', async (orig) => ({
  ...(await orig<typeof import('../progression/progressionStore')>()),
  beginSpectateProgression: (localKey: string, runId: string) => { queued.push({ localKey, runId }); return true; },
}));

const end = await import('./spectatorEnd');
const gate = await import('../rankedGate/rankedGateController');
const { useGame } = await import('../store');
const sp = await import('../versus/spectate');
const { newPublisher, nextSpectatorMessage } = await import('../versus/spectatorView');

const M = '0a1b2c3d-0000-4000-8000-00000000abcd';
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
let beats: string[] = [];
let order: string[] = [];

beforeEach(() => {
  beats = []; order = []; queued.length = 0;
  end.resetSpectatorEndForTests();
  end.setSpectateBeatForTests(async (kind, target) => { beats.push(`${kind}:${target}`); order.push('beat'); return true; });
  gate.resetRankedGateForTests();
});
afterEach(() => { end.setSpectateBeatForTests(null); end.resetSpectatorEndForTests(); gate.resetRankedGateForTests(); vi.useRealTimers(); });

describe('the watch record', () => {
  it('beats at once and every few seconds while the screen is open; one game at a time; nothing after leaving', () => {
    vi.useFakeTimers();
    end.startSpectatorBeat('lobby', 'g1');
    end.startSpectatorBeat('lobby', 'g1'); // idempotent
    expect(beats).toEqual(['lobby:g1']);
    vi.advanceTimersByTime(end.SPECTATE_BEAT_MS * 2 + 10);
    expect(beats).toEqual(['lobby:g1', 'lobby:g1', 'lobby:g1']);
    end.startSpectatorBeat('versus', M); // another game: the first stops
    vi.advanceTimersByTime(end.SPECTATE_BEAT_MS + 10);
    expect(beats.slice(3)).toEqual([`versus:${M}`, `versus:${M}`]);
    end.stopSpectatorBeat();
    vi.advanceTimersByTime(end.SPECTATE_BEAT_MS * 3);
    expect(beats).toHaveLength(5);
  });
});

describe('the end', () => {
  it('last beat, then the settlement, then the gate: behind its shut doors the screen is left and the notice set; once', async () => {
    end.startSpectatorBeat('lobby', 'g2');
    let shut = false;
    const leave = vi.fn(() => { order.push('leave'); });
    // a mounted gate: onShut runs when the doors are shut
    gate.registerRankedGate(async (onShut, variant) => { expect(variant).toBe('end'); shut = true; onShut(); });
    const p = end.endWatchedGame({ kind: 'lobby', target: 'g2', name: 'Wanda', placement: 1, leave });
    await p;
    await flush();
    expect(shut).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(beats.at(-1)).toBe('lobby:g2');
    expect(queued).toEqual([{ localKey: 'watch:lobby:g2', runId: 'watch:lobby:g2' }]);
    expect(end.useSpectatorEnd.getState().notice).toEqual({ name: 'Wanda', placement: 1, xpKey: 'watch:lobby:g2' });
    expect(end.spectatorBeatTarget()).toBeNull();
    await end.endWatchedGame({ kind: 'lobby', target: 'g2', name: 'Wanda', placement: 1, leave });
    expect(leave).toHaveBeenCalledTimes(1);
    expect(queued).toHaveLength(1);
  });

  it('a final beat refused after the server window still settles when an earlier beat saw the game end (live test 2026-10-24)', async () => {
    let n = 0;
    // The first beat sees the match ended; the end beat (past the 45 s window) is refused.
    end.setSpectateBeatForTests(async () => (n++ === 0 ? { ok: true, ended: true } : { ok: false }));
    end.startSpectatorBeat('group', 'g3');
    await flush();
    gate.registerRankedGate(async (onShut) => { onShut(); });
    await end.endWatchedGame({ kind: 'group', target: 'g3', name: 'Ann', placement: 1, leave: () => undefined });
    await flush();
    expect(queued).toEqual([{ localKey: 'watch:group:g3', runId: 'watch:group:g3' }]);
  });

  it('a final beat refused with no beat that saw the end settles nothing', async () => {
    end.setSpectateBeatForTests(async () => ({ ok: false }));
    gate.registerRankedGate(async (onShut) => { onShut(); });
    await end.endWatchedGame({ kind: 'group', target: 'g4', name: 'Ann', placement: 1, leave: () => undefined });
    await flush();
    expect(queued).toEqual([]);
  });
});

describe('a Versus match on the watch screen', () => {
  const run0 = createVersusRun(5, 'warden', 'set2');
  let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];
  const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
  const match = (over: Record<string, unknown>) => ({ id: M, phase: 'shop', round: 3, p1_name: 'Ann', p2_name: 'Bob', winner_seat: null, end_reason: null, ...over }) as never;
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    sp.installSpectateIo(io);
    useGame.setState({ showTitle: true, titleView: 'versus', replaying: false });
  });
  afterEach(() => { sp.resetSpectate(); sp.installSpectateIo(null); vi.unstubAllGlobals(); });

  async function watching(): Promise<void> {
    frames = [{ seat: 'p1', frame: { ...nextSpectatorMessage(newPublisher('p1'), run0, 3, true)!, m: M } }];
    sp.spectateSync(match({}), {});
    await flush();
    expect(sp.useSpectate.getState().active).toBe(true);
    expect(end.spectatorBeatTarget()).toEqual({ kind: 'versus', target: M });
  }

  it('a concede: the gate closes at once and opens on the room with the watched player\'s result', async () => {
    await watching();
    sp.spectateSync(match({ phase: 'complete', winner_seat: 'p2', end_reason: 'forfeit' }), {});
    await flush();
    expect(sp.useSpectate.getState().active).toBe(false);
    expect(useGame.getState().titleView).toBe('versus');
    expect(useGame.getState().showTitle).toBe(true);
    expect(end.useSpectatorEnd.getState().notice).toMatchObject({ name: 'Ann', placement: 2 });
    expect(queued.map((q) => q.runId)).toEqual([`watch:versus:${M}`]);
    // The winner still publishes frames from their last fight: the closed watch screen never reopens on one
    // (Versus Group live test 2026-10-24).
    sp.receiveSpectate({ ...nextSpectatorMessage(newPublisher('p1'), run0, 3, true)!, m: M });
    await flush();
    expect(sp.useSpectate.getState().active).toBe(false);
  });

  it('won on hearts: the screen waits for the last fight to play out (or the cap) before the gate', async () => {
    await watching();
    vi.useFakeTimers();
    sp.spectateSync(match({ phase: 'complete', winner_seat: 'p1', end_reason: 'hearts' }), {});
    await vi.advanceTimersByTimeAsync(10);
    expect(sp.useSpectate.getState().active).toBe(true); // still on the watch screen
    expect(end.useSpectatorEnd.getState().notice).toBeNull();
    await vi.advanceTimersByTimeAsync(sp.VERSUS_END_HOLD_MAX_MS);
    expect(sp.useSpectate.getState().active).toBe(false);
    expect(end.useSpectatorEnd.getState().notice).toMatchObject({ name: 'Ann', placement: 1 });
  });

  it('leaving the watch screen (Leave) stops the beats: no XP evidence while not watching', async () => {
    await watching();
    sp.leaveSpectating();
    expect(end.spectatorBeatTarget()).toBeNull();
    sp.spectateSync(match({}), {});
    expect(end.spectatorBeatTarget()).toBeNull();
  });
});
