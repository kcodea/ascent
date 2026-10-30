// @vitest-environment jsdom
/**
 * R-VERSUS-CF-CONNECT-01 (live 2026-10-29, prod 6c135033a: with `versus_host_config` ranked_duos = 'cf', Duo + Play showed
 * "MODES / RANKED DUOS ... Opening your party..." for good).
 *
 * Root cause: on the Cloudflare host a room socket's `connect()` had no deadline and never failed on a refused upgrade
 * (a room that is gone answers 404; a browser only sees a dropped socket, so the client retried for ever). Duo + Play is
 * the one entry that first READS the room the account still holds (`myRoomId` → `room`) before opening a party, so an
 * account whose Cloudflare room list still named a room no socket could open waited on that read for ever, with no error
 * and no way out but Back. These tests drive the REAL Cloudflare transport:
 *  - a room socket that never opens fails at the deadline with `timeout`, and NOTHING else is tried (Versus is Cloudflare
 *    only, R-VERSUS-CF-ONLY-01: before 2026-10-29 the cutover router made a Supabase room here instead); the party door
 *    then says the connection failed, with Try again;
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
const { createDuosParty } = await import('./versusStore');
type Room = import('./versusRemote').VersusRoom;

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

  it('a party whose room socket never opens fails at the deadline, and no other backend is tried (R-VERSUS-CF-ONLY-01)', async () => {
    // The Worker answers the create (the room exists) but its socket is refused on every attempt.
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).endsWith('/rooms') ? party('cf-room') : { roomId: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', RefusedSocket);
    const cf = makeCfVersusRemote({ baseUrl: 'http://worker', getClient: () => null, currentUserId: () => 'kev', makeError: (c, m) => new VersusError(c, m) });
    const w = watch(cf.createRoom("Kev's party", { displayName: 'Kev', profile: {}, setId: 'set1', contentRevision: 'c' }, RANKED));
    await vi.advanceTimersByTimeAsync(VERSUS_CF_CONNECT_TIMEOUT_MS - 1_000);
    expect(w.state()).toBe('pending'); // still trying to open the room's socket
    expect(RefusedSocket.made).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(2_000);
    // Before R-VERSUS-CF-CONNECT-01 this stayed pending for ever; before R-VERSUS-CF-ONLY-01 the router then made a
    // Supabase room. Now it is a plain failure, and every request went to the Worker.
    expect(w.state()).toBe('rejected:timeout');
    expect(fetchMock.mock.calls.every(([u]) => String(u).startsWith('http://worker'))).toBe(true);
  });

  it('the party door shows the failure with Try again when the Worker cannot open the party', async () => {
    setIdentity({ userId: 'kev' } as never);
    const create = vi.spyOn(versusRemote, 'createRoom').mockRejectedValue(new VersusError('timeout'));
    act(() => { useGame.getState().setTitleView('versus'); });
    useVersus.setState({ room: null, screen: 'browser', area: 'duos', error: null } as never);
    await act(async () => { await createDuosParty("Kev's party"); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(useVersus.getState()).toMatchObject({ room: null, error: 'Connection problem. Try again.' });
    const view = mount(<DuosDoor />);
    expect(view.container.querySelector('[role="alert"] button')?.textContent).toBe('Try again');
    view.unmount();
    act(() => { useGame.getState().setTitleView('modes'); });
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
