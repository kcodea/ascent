// @vitest-environment jsdom
/**
 * A RANKED DUOS CONCEDE IS FOR GOOD (R-RANKED-DUOS-CONCEDE-01, owner report 2026-11-01: "i was in a duos ranked game w/
 * mike and i conceded, but then in scene builder it looked like i was still in a duos game with him and then i reloaded
 * the game and it put me in a lobby where i faced opponents until the game ended").
 *
 * A Ranked Duos concede never knocks the team out: the teammate plays on, my board on auto. So the room stays in game
 * with my player seat in it, and the seat only carries `leftAt`. Three leaks came out of that:
 *  1. the client still projected the match from MY seat (only `eliminatedRound` counted as out), so the Versus store held
 *     a live Duos match with my teammate in it;
 *  2. the Scene Builder's teammate portrait read that held match before its own placeholder (Mike's face in the rig);
 *  3. a reload re-entered the room at boot (`resumeVersusMatch`: I still hold a player seat) and rebuilt a playable run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const net = vi.hoisted(() => ({ roomCalls: 0, forfeits: [] as string[] }));
vi.mock('../identity', async (importOriginal) => ({ ...(await importOriginal<typeof import('../identity')>()), currentUserId: () => 'u1' }));
vi.mock('./teammateView', () => ({ enterTeammateView: vi.fn(), exitTeammateView: vi.fn() }));
vi.mock('./versusRemote', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./versusRemote')>();
  return {
    ...orig,
    versusRemote: {
      ...orig.versusRemote,
      myRoomId: async () => 'room1',
      room: async () => {
        net.roomCalls++;
        return { id: 'room1', status: 'in_game', current_match_id: 'm1', options: { v: 1, mode: 'ranked_duos', modifiers: [] }, members: [{ userId: 'u1', role: 'p1' }, { userId: 'u2', role: 'p2' }] };
      },
      forfeit: async (id: string) => { net.forfeits.push(id); throw new orig.VersusError('network'); },
    },
  };
});

const { groupSeatGone, groupViewerOf } = await import('./versusGroupView');
const { concededHere, markConceded, resetConcededCache, CONCEDED_KEEP } = await import('./concededMatches');
const { useVersus, resumeVersusMatch, forfeitMatch } = await import('./versusStore');
const { mount } = await import('../renderedText.mount');
const { DuosMateDock } = await import('./DuosMateDock');
const { useLocalMate } = await import('./localMate');

const row = (over: Record<string, unknown> = {}) => ({
  seat: 'p1', userId: 'u1', name: 'Kevin', health: 30, armor: 0, hero: 'warden', locked: false, ready: false, intro: true,
  auto: false, missed: 0, eliminatedRound: null, outReason: null, placement: null, ...over,
}) as never;

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  resetConcededCache();
  Object.assign(net, { roomCalls: 0, forfeits: [] });
});
afterEach(() => {
  useVersus.setState({ room: null, match: null, error: null } as never);
  useLocalMate.setState({ me: null, mate: null });
});

describe('R-RANKED-DUOS-CONCEDE-01: a seat that conceded or left is out of the match for good', () => {
  it('a Ranked Duos seat with leftAt is gone (on the seat row or the match json map), like a knocked-out seat', () => {
    expect(groupSeatGone({}, row())).toBe(false);
    expect(groupSeatGone({}, row({ eliminatedRound: 3 }))).toBe(true);
    expect(groupSeatGone({}, row({ leftAt: '2026-11-01T12:00:00Z' }))).toBe(true);
    expect(groupSeatGone({ leftAt: { p1: '2026-11-01T12:00:00Z' } }, row())).toBe(true);
    expect(groupSeatGone({ leftAt: { p2: '2026-11-01T12:00:00Z' } }, row())).toBe(false); // my teammate left, not me
  });

  it('a conceded seat sees the match from the stands once its run is off screen (never rebuilt as a player)', () => {
    const left = { leftAt: { p1: '2026-11-01T12:00:00Z' }, seats: [row(), row({ seat: 'p2', userId: 'u2', name: 'Mike' })] };
    const live = { seats: [row(), row({ seat: 'p2', userId: 'u2', name: 'Mike' })] };
    expect(groupViewerOf(live, 'u1', false, false)).toBe('u1');
    expect(groupViewerOf(left, 'u1', false, false)).toBeNull(); // a reload: a spectator, so no run is built
    expect(groupViewerOf(left, 'u1', true, false)).toBe('u1'); // the end gate is still closing over my run
    expect(groupViewerOf(live, 'u1', false, true)).toBeNull(); // conceded here, before the server's answer landed
    expect(groupViewerOf(left, 'u2', false, false)).toBe('u2'); // my teammate plays on
  });

  it('the concede is remembered across a reload, and only the last few are kept', () => {
    expect(concededHere('m1')).toBe(false);
    markConceded('m1');
    resetConcededCache(); // a reload: the memory comes back from storage
    expect(concededHere('m1')).toBe(true);
    expect(concededHere(null)).toBe(false);
    for (let i = 0; i < CONCEDED_KEEP; i++) markConceded(`x${i}`);
    expect(concededHere('m1')).toBe(false);
    expect(concededHere(`x${CONCEDED_KEEP - 1}`)).toBe(true);
  });

  it('Concede remembers the match before it asks the server (a lost request still keeps me out)', async () => {
    useVersus.setState({ match: { id: 'm1', phase: 'shop', round: 4, revision: 1, p1_user: 'u1', p2_user: 'u9' } } as never);
    await forfeitMatch();
    expect(net.forfeits).toEqual(['m1']);
    expect(concededHere('m1')).toBe(true);
  });

  it('a reload never re-enters a conceded match at boot, though I still hold a player seat in its room', async () => {
    markConceded('m1');
    await resumeVersusMatch();
    expect(net.roomCalls).toBe(1); // the room was read: in game, me in a player seat
    expect(useVersus.getState().room).toBeNull(); // ...and not entered
  });

  it('the Scene Builder portrait shows its placeholder, never a Duos match still held in the Versus store', () => {
    // The conceded match, still in the Versus store with my teammate Mike in it.
    useVersus.setState({
      room: { members: [] },
      match: { group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } }, raw: { seats: [
        { seat: 'p1', userId: 'u1', name: 'Kevin', hero: 'warden' }, { seat: 'p2', userId: 'u2', name: 'Mike', hero: 'warden' },
      ] } } },
    } as never);
    useLocalMate.setState({ me: { hero: 'warden', name: 'You' }, mate: { hero: 'warden', name: 'Placeholder' } });
    const ui = mount(<DuosMateDock watching={false} />);
    try {
      const label = ui.container.querySelector('[data-duos-mate]')?.getAttribute('aria-label') ?? '';
      expect(label).toContain('Placeholder');
      expect(label).not.toContain('Mike');
    } finally { ui.unmount(); }
  });
});
