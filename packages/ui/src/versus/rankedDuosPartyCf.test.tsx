// @vitest-environment jsdom
/**
 * R-VERSUS-CF-CONNECT-01 (live 2026-10-29, prod 6c135033a: with `versus_host_config` ranked_duos = 'cf', Duo + Play showed
 * "MODES / RANKED DUOS ... Opening your party..." for good).
 *
 * Root cause: on the Cloudflare host a room socket's `connect()` had no deadline and never failed on a refused upgrade
 * (a room that is gone answers 404; a browser only sees a dropped socket, so the client retried for ever). Duo + Play is
 * the one entry that first READS the room the account still holds (`myRoomId` → `room`) before opening a party, so an
 * account whose Cloudflare room list still named a room no socket could open waited on that read for ever, with no error
 * and no way out but Back. These tests drive the REAL Cloudflare transport through the REAL cutover router:
 *  - a room socket that never opens fails at the deadline; creating a room then falls back to Supabase (the router's
 *    existing "Cloudflare unreachable" rule), so a Worker problem never blocks the party;
 *  - Duo + Play gives up after its own deadline with a reason and Try again, never an endless "Opening";
 *  - losing the party while its door is on screen says so (Try again), instead of an endless "Opening".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../fx/playDef', async (orig) => ({ ...(await orig<typeof import('../fx/playDef')>()), playDef: () => null }));
vi.mock('../remoteBoards', async (orig) => {
  const real = await orig<typeof import('../remoteBoards')>();
  const query = () => { const q = { select: () => q, in: () => q, eq: () => q, or: () => q, limit: () => Promise.resolve({ data: [], error: null }) }; return q; };
  return { ...real, supabaseClient: () => ({ rpc: () => Promise.resolve({ data: [], error: null }), from: () => query() }) };
});

const { mount } = await import('../renderedText.mount');
const { setIdentity } = await import('../identity');
const { sfx } = await import('../sfx');
const { useGame } = await import('../store');
const { DuosDoor } = await import('./VersusTitle');
const { enterDuosParty, leaveRoom, useVersus, DUOS_OPEN_DEADLINE_MS } = await import('./versusStore');
const { versusRemote, VersusError } = await import('./versusRemote');
const { makeCfVersusRemote, VERSUS_CF_CONNECT_TIMEOUT_MS } = await import('./versusCfRemote');
const { makeRoutedVersusRemote } = await import('./versusRouter');
const { makeRoomHostMemory } = await import('./versusHost');
type Room = import('./versusRemote').VersusRoom;
type Remote = import('./versusRemote').VersusRemote;

const RANKED = { v: 1 as const, mode: 'ranked_duos' as const, modifiers: [] };
const party = (id: string): Room =>
  ({ id, name: "Kev's party", host_user_id: 'kev', status: 'open', members: [{ userId: 'kev', role: 'p1', displayName: 'Kev', profile: {}, lastSeenAt: '' }], current_match_id: null, options: RANKED, options_rev: 1, serverNow: new Date().toISOString() } as unknown as Room);

/** A browser's view of a refused WebSocket upgrade (the room is gone: 404): an error, then close 1006. Every attempt. */
class RefusedSocket {
  static made = 0;
  readyState = 0;
  private on: Record<string, ((e: unknown) => void)[]> = {};
  constructor() {
    RefusedSocket.made++;
    setTimeout(() => { for (const f of this.on.error ?? []) f({}); for (const f of this.on.close ?? []) f({ code: 1006 }); }, 20);
  }
  addEventListener(t: string, f: (e: unknown) => void): void { (this.on[t] ??= []).push(f); }
  send(): void { /* never open */ }
  close(): void { this.readyState = 3; }
}

/** Settles `p` into a tag, so a test can tell "still pending". */
function watch<T>(p: Promise<T>): { state: () => string; value: () => T | undefined } {
  let state = 'pending';
  let value: T | undefined;
  p.then((v) => { state = 'resolved'; value = v; }, (e: { code?: string }) => { state = `rejected:${e?.code ?? e}`; });
  return { state: () => state, value: () => value };
}

describe('Ranked Duos on the Cloudflare host never hangs (R-VERSUS-CF-CONNECT-01)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (Element.prototype as { animate?: unknown }).animate = function () { return { finish() {}, cancel() {} }; };
    for (const k of ['deny', 'play', 'sell', 'cardTouch', 'pulse', 'gate', 'tick'] as const) vi.spyOn(sfx, k).mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useVersus.setState({ room: null, rooms: [], seatMove: null, error: null, screen: 'browser', area: 'versus', duosResult: null } as never);
    setIdentity(null);
  });

  it('a party created on Cloudflare whose socket never opens falls back to Supabase at the deadline (real transport + router)', async () => {
    // The Worker answers the create (the room exists) but its socket is refused on every attempt.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).endsWith('/rooms') ? party('cf-room') : { roomId: null }), { status: 200 })));
    vi.stubGlobal('WebSocket', RefusedSocket);
    const cf = makeCfVersusRemote({ baseUrl: 'http://worker', getClient: () => null, currentUserId: () => 'kev', makeError: (c, m) => new VersusError(c, m) });
    const supaCreate = vi.fn(async () => party('supa-room'));
    const supabase = { createRoom: supaCreate } as unknown as Remote;
    const routed = makeRoutedVersusRemote({
      supabase, cf, memory: makeRoomHostMemory(null),
      readConfig: async () => ({ duel: 'cf', group: 'cf', duos: 'cf', ranked_duos: 'cf' }),
    });
    const w = watch(routed.createRoom("Kev's party", { displayName: 'Kev', profile: {}, setId: 'set1', contentRevision: 'c' }, RANKED));
    await vi.advanceTimersByTimeAsync(VERSUS_CF_CONNECT_TIMEOUT_MS - 1_000);
    expect(w.state()).toBe('pending'); // still trying to open the room's socket
    expect(RefusedSocket.made).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(2_000);
    // Before the fix this stayed pending for ever (Duo + Play's "Opening your party..." never ended).
    expect(w.state()).toBe('resolved');
    expect(w.value()?.id).toBe('supa-room');
    expect(routed.hostOf('supa-room')).toBe('supabase');
    expect(supaCreate).toHaveBeenCalledWith("Kev's party", expect.anything(), RANKED);
  });

  it('Duo + Play stuck on reading the held room gives up with a reason and Try again (the door never waits forever)', async () => {
    setIdentity({ userId: 'kev' } as never);
    vi.spyOn(versusRemote, 'myRoomId').mockResolvedValue('gone-room');
    vi.spyOn(versusRemote, 'room').mockImplementation(() => new Promise(() => undefined)); // the stuck read
    const create = vi.spyOn(versusRemote, 'createRoom');
    const view = mount(<DuosDoor />);
    void enterDuosParty("Kev's party");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(view.container.textContent).toContain('Opening your party...');
    await act(async () => { await vi.advanceTimersByTimeAsync(DUOS_OPEN_DEADLINE_MS); });
    expect(useVersus.getState().error).toBe('Your party did not open. Try again.');
    expect(view.container.textContent).not.toContain('Opening your party...');
    expect(view.container.querySelector('[role="alert"] button')?.textContent).toBe('Try again');
    expect(create).not.toHaveBeenCalled();
    view.unmount();
  });

  it('losing my party while its door is on screen says so, never an endless "Opening your party..."', async () => {
    setIdentity({ userId: 'kev' } as never);
    vi.spyOn(versusRemote, 'leaveRoom').mockResolvedValue({ left: true });
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([]);
    act(() => { useGame.getState().setTitleView('versus'); });
    useVersus.setState({ room: party('p'), screen: 'room', area: 'duos', error: null } as never);
    await act(async () => { await leaveRoom(); }); // e.g. the heartbeat said I am no longer a member
    expect(useVersus.getState()).toMatchObject({ room: null, screen: 'browser', area: 'duos', error: 'Your party closed.' });
    const view = mount(<DuosDoor />);
    expect(view.container.textContent).not.toContain('Opening your party...');
    expect(view.container.textContent).toContain('Try again');
    view.unmount();
    act(() => { useGame.getState().setTitleView('modes'); });
  });
});
