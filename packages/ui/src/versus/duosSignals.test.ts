// @vitest-environment jsdom
/**
 * THE SMALL DUOS SIGNALS and the Ranked Duos announcer hook: the cues
 * hang off state the stores already publish, and each fires once, on the change it is about.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const announcer = await import('../announcer');
const { sfx } = await import('../sfx');
const { resetIdentityForTests, setIdentity } = await import('../identity');
const { useSpectate } = await import('./spectate');
const { useVersus } = await import('./versusStore');
const { duosRoundClosing, installDuosSignals, mateJoined, partyMate, roundClosed, teamResultLine } = await import('./duosSignals');

const member = (userId: string, role: string) => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
const room = (mode: string, members: ReturnType<typeof member>[], id = 'r1') => ({ id, name: 'r', options: { v: 1, mode, modifiers: [] }, members });
const seat = (s: string, userId: string, served = false) => ({ seat: s, userId, name: userId, hero: 'indy', eliminatedRound: null, placement: null, ...(served ? { served: true } : {}) });
const match = (mode: string, phase: string, round = 3, id = 'm1') => ({
  id, phase, round,
  group: { duos: mode === 'group' ? null : { mate: 'p2' }, raw: { id, phase, options: { v: 1, mode, modifiers: [] }, seats: [seat('p1', 'kev'), seat('p2', 'lem'), seat('p3', 'x', mode === 'ranked_duos'), seat('p4', 'y', mode === 'ranked_duos')] } },
});
const set = (patch: Record<string, unknown>): void => { useVersus.setState(patch as never); };

let off: (() => void) | null = null;
const spy = {} as Record<'swap' | 'joined' | 'locked', ReturnType<typeof vi.spyOn>>;
let say: MockInstance<typeof announcer.announceTeamResult>;
let rankUp: MockInstance<typeof announcer.announceTeamRankUp>;
let stopLine: MockInstance<typeof announcer.cancelTeamResultLine>;
let table: MockInstance<typeof announcer.setAnnouncerDuosTable>;
beforeEach(() => {
  setIdentity({ userId: 'kev', displayName: 'Kevin', anonymous: false, email: null } as never);
  spy.swap = vi.spyOn(sfx, 'duosViewSwap').mockImplementation(() => undefined);
  spy.joined = vi.spyOn(sfx, 'duosMateJoined').mockImplementation(() => undefined);
  spy.locked = vi.spyOn(sfx, 'duosLockedIn').mockImplementation(() => undefined);
  say = vi.spyOn(announcer, 'announceTeamResult').mockImplementation(() => null);
  rankUp = vi.spyOn(announcer, 'announceTeamRankUp').mockImplementation(() => true);
  stopLine = vi.spyOn(announcer, 'cancelTeamResultLine').mockImplementation(() => undefined);
  table = vi.spyOn(announcer, 'setAnnouncerDuosTable').mockImplementation(() => undefined);
  set({ room: null, match: null, knockout: null, duosResult: null, endTurnWave: null });
  useSpectate.setState({ teammate: false } as never);
});
afterEach(() => {
  off?.(); off = null;
  vi.restoreAllMocks();
  resetIdentityForTests();
  set({ room: null, match: null, knockout: null, duosResult: null, endTurnWave: null });
  useSpectate.setState({ teammate: false } as never);
});

describe('the pure reads', () => {
  it('partyMate: the seat beside mine in a Duos room, null when it is empty, and nothing outside Duos', () => {
    expect(partyMate({ room: room('ranked_duos', [member('kev', 'p1')]), match: null } as never, 'kev')).toEqual({ room: 'r1', mate: null });
    expect(partyMate({ room: room('ranked_duos', [member('kev', 'p1'), member('lem', 'p2')]), match: null } as never, 'kev')).toEqual({ room: 'r1', mate: 'lem' });
    // Versus Duos: p3's teammate is p4, never p1
    expect(partyMate({ room: room('duos', [member('a', 'p1'), member('kev', 'p3')]), match: null } as never, 'kev')).toEqual({ room: 'r1', mate: null });
    expect(partyMate({ room: room('duos', [member('kev', 'p3'), member('z', 'p4')]), match: null } as never, 'kev')?.mate).toBe('z');
    expect(partyMate({ room: room('1v1', [member('kev', 'p1'), member('lem', 'p2')]), match: null } as never, 'kev')).toBeNull();
    expect(partyMate({ room: room('duos', [member('kev', 'spectator'), member('lem', 'p2')]), match: null } as never, 'kev')).toBeNull();
    expect(partyMate({ room: null, match: null } as never, 'kev')).toBeNull();
  });

  it('mateJoined: only an empty seat filling in the SAME room', () => {
    expect(mateJoined({ room: 'r1', mate: null }, { room: 'r1', mate: 'lem' })).toBe(true);
    expect(mateJoined({ room: 'r1', mate: 'lem' }, { room: 'r1', mate: 'lem' })).toBe(false);
    expect(mateJoined(null, { room: 'r1', mate: 'lem' })).toBe(false); // I walked into a room they were already in
    expect(mateJoined({ room: 'r0', mate: null }, { room: 'r1', mate: 'lem' })).toBe(false);
    expect(mateJoined({ room: 'r1', mate: 'lem' }, { room: 'r1', mate: null })).toBe(false);
  });

  it('roundClosed: the store marks this round as closed (its fight is in) for a seated Duos player, whatever the row says', () => {
    const at = (mode: string, endTurnWave: number | null, user = 'kev'): string => duosRoundClosing({ room: null, match: match(mode, 'shop'), endTurnWave } as never, user);
    expect(at('duos', null)).toBe('');
    // the match row still reads "shop" while the fight is already on screen (found live): the mark alone decides
    expect(roundClosed(at('duos', null), at('duos', 3))).toBe(true);
    expect(roundClosed(at('ranked_duos', 3), at('ranked_duos', 3))).toBe(false);
    expect(roundClosed(at('ranked_duos', 3), at('ranked_duos', 4))).toBe(true);
    expect(roundClosed(at('duos', 3), at('duos', null))).toBe(false);
    expect(at('group', 3)).toBe(''); // not a Duos table
    expect(at('duos', 3, 'stranger')).toBe(''); // not seated
  });

  it('teamResultLine: the result once per match, RankUp once, a Ranked Duos knockout as a loss', () => {
    const res = (promoted: boolean) => ({ matchId: 'm1', placement: 1, result: promoted ? { promoted: true } : null });
    expect(teamResultLine({ match: null, knockout: null, duosResult: res(false) } as never, null, null)).toEqual({ match: 'm1', placement: 1, rankUp: false });
    expect(teamResultLine({ match: null, knockout: null, duosResult: res(false) } as never, 'm1', null)).toBeNull();
    expect(teamResultLine({ match: null, knockout: null, duosResult: res(true) } as never, 'm1', null)).toEqual({ match: 'm1', placement: null, rankUp: true });
    expect(teamResultLine({ match: null, knockout: null, duosResult: res(true) } as never, 'm1', 'm1')).toBeNull();
    const ko = { matchId: 'm1', placement: null, of: 4 };
    expect(teamResultLine({ match: match('ranked_duos', 'shop'), knockout: ko, duosResult: null } as never, null, null)).toEqual({ match: 'm1', placement: 4, rankUp: false });
    expect(teamResultLine({ match: match('duos', 'shop'), knockout: ko, duosResult: null } as never, null, null)).toBeNull(); // Versus Duos: no table lines
    expect(teamResultLine({ match: match('ranked_duos', 'shop'), knockout: ko, duosResult: null } as never, 'm1', null)).toBeNull();
  });
});

describe('the listener', () => {
  it('the teammate view rings up on the way in and down on the way out, never for a finished match', () => {
    set({ match: match('duos', 'shop') });
    off = installDuosSignals();
    useSpectate.setState({ teammate: true } as never);
    expect(spy.swap).toHaveBeenLastCalledWith(true);
    useSpectate.setState({ teammate: true, seat: 'p2' } as never); // an unrelated field: no second ring
    expect(spy.swap).toHaveBeenCalledTimes(1);
    useSpectate.setState({ teammate: false } as never);
    expect(spy.swap).toHaveBeenLastCalledWith(false);
    useSpectate.setState({ teammate: true } as never);
    set({ match: match('duos', 'complete') });
    useSpectate.setState({ teammate: false } as never); // the match ended: the view closing is not a swap
    expect(spy.swap).toHaveBeenCalledTimes(3);
  });

  it('my teammate sitting down rings once; a heartbeat, or me joining them, does not', () => {
    set({ room: room('ranked_duos', [member('kev', 'p1')]) });
    off = installDuosSignals();
    set({ room: room('ranked_duos', [member('kev', 'p1')]) });
    expect(spy.joined).not.toHaveBeenCalled();
    set({ room: room('ranked_duos', [member('kev', 'p1'), member('lem', 'p2')]) });
    expect(spy.joined).toHaveBeenCalledTimes(1);
    set({ room: room('ranked_duos', [member('kev', 'p1'), member('lem', 'p2')]) });
    expect(spy.joined).toHaveBeenCalledTimes(1);
    // a different room where the mate already sits (I joined them): first sight, no ring
    set({ room: room('ranked_duos', [member('kev', 'p2'), member('zed', 'p1')], 'r2') });
    expect(spy.joined).toHaveBeenCalledTimes(1);
  });

  it('the round closing on us plays the locked-in note once per round', () => {
    set({ match: match('ranked_duos', 'shop'), endTurnWave: null });
    off = installDuosSignals();
    set({ match: match('ranked_duos', 'shop') }); // a heartbeat
    expect(spy.locked).not.toHaveBeenCalled();
    set({ endTurnWave: 3 }); // the fight is in: the real End Turn starts
    expect(spy.locked).toHaveBeenCalledTimes(1);
    set({ match: match('ranked_duos', 'combat') });
    set({ match: match('ranked_duos', 'shop', 4) }); // the next shop: the mark still names round 3
    expect(spy.locked).toHaveBeenCalledTimes(1);
    set({ endTurnWave: 4 });
    expect(spy.locked).toHaveBeenCalledTimes(2);
  });

  it('a session that starts inside a closed round (a reload) does not ring for it', () => {
    set({ match: match('duos', 'combat'), endTurnWave: 3 });
    off = installDuosSignals();
    set({ match: match('duos', 'combat') });
    expect(spy.locked).not.toHaveBeenCalled();
  });

  it('tells the announcer when the table is a Ranked Duos game, and speaks the team result once per match', () => {
    off = installDuosSignals();
    expect(table).toHaveBeenLastCalledWith(false);
    set({ match: match('ranked_duos', 'shop') });
    expect(table).toHaveBeenLastCalledWith(true);
    set({ match: match('duos', 'shop') });
    expect(table).toHaveBeenLastCalledWith(false);

    set({ match: match('ranked_duos', 'complete'), duosResult: { matchId: 'm1', placement: 2, result: null } });
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(2);
    set({ duosResult: { matchId: 'm1', placement: 2, result: { promoted: true } } }); // the rating row lands
    expect(say).toHaveBeenCalledTimes(1);
    expect(rankUp).toHaveBeenCalledTimes(1);
    set({ duosResult: { matchId: 'm1', placement: 2, result: { promoted: true } } });
    expect(rankUp).toHaveBeenCalledTimes(1);
    expect(stopLine).not.toHaveBeenCalled();
    set({ duosResult: null }); // Continue
    expect(stopLine).toHaveBeenCalledTimes(1);
  });

  it('a Ranked Duos knockout speaks the loss line as the team goes to the stands, and not again at the result', () => {
    set({ match: match('ranked_duos', 'shop') });
    off = installDuosSignals();
    set({ knockout: { matchId: 'm1', placement: 3, of: 4 } });
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(3);
    set({ knockout: null, duosResult: { matchId: 'm1', placement: 3, result: null } });
    expect(say).toHaveBeenCalledTimes(1);
  });
});
