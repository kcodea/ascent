// @vitest-environment jsdom
/**
 * THE CUTOVER, THROUGH THE STORE (R-VERSUS-CF-CUTOVER-01): a room never changes backend. A Cloudflare room whose host
 * switches it to a mode the server switch still keeps on Supabase is remade on Supabase when the host is alone in it,
 * and refused with a plain reason when others are in it. Supabase rooms (and same-host changes) just set the options.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../fx/playDef', async (orig) => ({ ...(await orig<typeof import('../fx/playDef')>()), playDef: () => null }));
vi.mock('../remoteBoards', async (orig) => {
  const real = await orig<typeof import('../remoteBoards')>();
  const query = () => { const q = { select: () => q, in: () => q, eq: () => q, or: () => q, limit: () => Promise.resolve({ data: [], error: null }) }; return q; };
  return { ...real, supabaseClient: () => ({ rpc: () => Promise.resolve({ data: [], error: null }), from: () => query() }) };
});

const { setIdentity } = await import('../identity');
const { useVersus, setRoomOptions, leaveRoom } = await import('./versusStore');
const { versusRemote } = await import('./versusRemote');
type Room = import('./versusRemote').VersusRoom;
type Opts = import('@game/sim').VersusRoomOptions;

const member = (userId: string, role: 'p1' | 'spectator') => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
const roomOf = (id: string, members: ReturnType<typeof member>[]): Room =>
  ({ id, name: 'Room', host_user_id: 'host', status: 'open', members, current_match_id: null, options: { v: 1, mode: 'duel', modifiers: [] }, options_rev: 1, serverNow: new Date().toISOString() } as unknown as Room);
const GROUP = { v: 1, mode: 'group', modifiers: [] } as unknown as Opts;
const DUEL_MOD = { v: 1, mode: 'duel', modifiers: ['fast'] } as unknown as Opts;

let spies: ReturnType<typeof stubNetwork>;
function stubNetwork(roomHost: 'cf' | 'supabase', groupHost: 'cf' | 'supabase') {
  vi.spyOn(versusRemote, 'hostOf').mockImplementation(() => roomHost);
  vi.spyOn(versusRemote, 'hostForMode').mockImplementation((m) => (m === 'group' ? groupHost : 'cf'));
  vi.spyOn(versusRemote, 'subscribeRoom').mockImplementation(() => ({ send: () => undefined, close: () => Promise.resolve() }));
  vi.spyOn(versusRemote, 'heartbeat').mockImplementation(async () => ({ serverNow: new Date().toISOString() }));
  vi.spyOn(versusRemote, 'listRooms').mockImplementation(async () => []);
  vi.spyOn(versusRemote, 'room').mockImplementation(async () => useVersus.getState().room);
  return {
    setOptions: vi.spyOn(versusRemote, 'setOptions').mockImplementation(async (id, o) => ({ ...roomOf(id, []), options: o })),
    createRoom: vi.spyOn(versusRemote, 'createRoom').mockImplementation(async (_n, _me, o) => ({ ...roomOf('s-new', [member('host', 'p1')]), options: o ?? null })),
    takeSeat: vi.spyOn(versusRemote, 'takeSeat').mockImplementation(async (id) => roomOf(id, [member('host', 'spectator')])),
    leaveRoom: vi.spyOn(versusRemote, 'leaveRoom').mockImplementation(async () => ({ left: true })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  setIdentity({ userId: 'host' } as never);
});
afterEach(async () => {
  await leaveRoom();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useVersus.setState({ room: null, error: null, screen: 'browser' } as never);
  setIdentity(null);
});

const inRoom = (members: ReturnType<typeof member>[]): void => { useVersus.setState({ screen: 'room', room: roomOf('c-1', members), error: null } as never); };

describe('Versus cutover in the room (R-VERSUS-CF-CUTOVER-01)', () => {
  it('alone in a Cloudflare room: switching to a Supabase-only mode remakes the room on Supabase', async () => {
    spies = stubNetwork('cf', 'supabase');
    inRoom([member('host', 'spectator')]);
    await setRoomOptions(GROUP);
    expect(spies.setOptions).not.toHaveBeenCalled();
    expect(spies.createRoom).toHaveBeenCalledWith('Room', expect.anything(), GROUP);
    expect(spies.takeSeat).toHaveBeenCalledWith('s-new', 'spectator');
    expect(spies.leaveRoom).toHaveBeenCalledWith('c-1');
    expect(useVersus.getState().room?.id).toBe('s-new');
  });

  it('with others in the Cloudflare room the switch is refused, plainly', async () => {
    spies = stubNetwork('cf', 'supabase');
    inRoom([member('host', 'spectator'), member('b', 'p1')]);
    await setRoomOptions(GROUP);
    expect(spies.createRoom).not.toHaveBeenCalled();
    expect(spies.setOptions).not.toHaveBeenCalled();
    expect(useVersus.getState().error).toBe('This mode needs a new room. Make one from the Versus menu.');
    expect(useVersus.getState().room?.id).toBe('c-1');
  });

  it('a mode Cloudflare plays, a modifier change, or a Supabase room: the options just change', async () => {
    spies = stubNetwork('cf', 'cf');
    inRoom([member('host', 'spectator'), member('b', 'p1')]);
    await setRoomOptions(GROUP);
    expect(spies.setOptions).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    spies = stubNetwork('cf', 'supabase');
    inRoom([member('host', 'spectator'), member('b', 'p1')]);
    await setRoomOptions(DUEL_MOD);
    expect(spies.setOptions).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    spies = stubNetwork('supabase', 'cf');
    inRoom([member('host', 'spectator')]);
    await setRoomOptions(GROUP);
    expect(spies.setOptions).toHaveBeenCalledTimes(1);
    expect(spies.createRoom).not.toHaveBeenCalled();
  });
});
