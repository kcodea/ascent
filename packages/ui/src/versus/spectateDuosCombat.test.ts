// @vitest-environment jsdom
/**
 * SPECTATING A DUOS FIGHT (owner report 2026-11-17: "the spectator duo experience is mostly great but had some bugs: 1.
 * switching views in combat restarts combat, 2. the cards granted in combat and/or passed in combat dont happen or show
 * the animation until AFTER combat resolves"). Pinned:
 *  - R-SPECTATE-DUOS-SWITCH-01: a Duos round is ONE tag-team fight whose row names only each team's first board, so a
 *    switch to the TEAMMATE (or the foes' reserve) continues from the beat on screen, never from the first one. A switch
 *    to a seat in ANOTHER fight of a Versus Group round starts where that seat's player last reported.
 *  - R-SPECTATE-DUOS-LIVE-01: the watched player's own frames from INSIDE the fight (a pass or gift landing in their
 *    hand, the fight's held gifts) reach the screen as they arrive; only their SETTLE waits for this screen's strike.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, type RunState } from '@game/sim';
import { newPublisher, nextSpectatorMessage, type SpectatorMessage } from './spectatorView';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const sp = await import('./spectate');

type Seat = 'p1' | 'p2' | 'p3' | 'p4';
const SEATS: Seat[] = ['p1', 'p2', 'p3', 'p4'];
const seatRow = (seat: Seat) => ({ seat, userId: `u-${seat}`, name: `N${seat}`, health: 30, armor: 0, eliminatedRound: null, placement: null });
const match = (p: Record<string, unknown> = {}) =>
  ({ id: 'd1', phase: 'combat', round: 1, p1_hearts: 7, p2_hearts: 7, group: { raw: { id: 'd1', round: 1, seats: SEATS.map(seatRow), winner_seat: null } }, ...p }) as never;

const base: Record<Seat, RunState> = {
  p1: createVersusRun(11, 'warden', 'set2'),
  p2: createVersusRun(22, 'juggler', 'set2'),
  p3: createVersusRun(33, 'warden', 'set2'),
  p4: createVersusRun(44, 'juggler', 'set2'),
};
const inFight = (r: RunState): RunState => ({ ...r, phase: 'combat', combatSettled: false });
const pubs = {} as Record<Seat, ReturnType<typeof newPublisher>>;
const keyOf = (seat: Seat, run: RunState, cb?: { w: number; b: number }): SpectatorMessage => {
  pubs[seat] = newPublisher(seat);
  const k = nextSpectatorMessage(pubs[seat], run, run.wave, true)!;
  return cb ? { ...(k as Extract<SpectatorMessage, { kind: 'key' }>), cb } : k;
};

/** Each seat's own result (distinct objects, as `resultsOf` builds them: the member views of one team fight). */
const results: Record<Seat, unknown> = { p1: { tag: 'p1' }, p2: { tag: 'p2' }, p3: { tag: 'p3' }, p4: { tag: 'p4' } };
/** A Duos round row: ONE fight, naming only the first boards (p1 for team a, p3 for team b). */
const duosRound = (wave: number) => ({
  round: wave, results,
  group: { round: wave, vitals: {}, eliminated: [], fights: [{ round: wave, fight: 0, a_seat: 'p1', b_seat: 'p3', b_copy: false, a_result: { duosFirst: { a: 'p1', b: 'p3' } }, b_result: {} }] },
}) as never;
/** A Versus Group round row: two fights (p1 v p2, p3 v p4). */
const groupRound = (wave: number) => ({
  round: wave, results,
  group: { round: wave, vitals: {}, eliminated: [], fights: [
    { round: wave, fight: 0, a_seat: 'p1', b_seat: 'p2', b_copy: false, a_result: {}, b_result: {} },
    { round: wave, fight: 1, a_seat: 'p3', b_seat: 'p4', b_copy: false, a_result: {}, b_result: {} },
  ] },
}) as never;

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

async function enterFight(round: (w: number) => never): Promise<number> {
  const w = base.p1.wave;
  frames = SEATS.map((s) => ({ seat: s, frame: keyOf(s, inFight(base[s])) }));
  sp.spectateSync(match(), { [w]: round(w) });
  await flush();
  expect(sp.useSpectate.getState().active).toBe(true);
  expect(useGame.getState().run.lastCombat).toBe(results.p1);
  return w;
}

describe('spectating a Duos fight: a seat switch continues the fight (R-SPECTATE-DUOS-SWITCH-01)', () => {
  it('every seat of the one tag-team fight is in the same fight, whoever the row names', () => {
    const r = duosRound(3);
    for (const a of SEATS) for (const b of SEATS) expect(sp.sameFightAt(r, a, b), `${a}-${b}`).toBe(true);
    const g = groupRound(3);
    expect(sp.sameFightAt(g, 'p1', 'p2')).toBe(true);
    expect(sp.sameFightAt(g, 'p1', 'p3')).toBe(false);
  });

  it('switching to the teammate mid-fight resumes at the beat on screen, not at the first beat', async () => {
    const w = await enterFight(duosRound);
    sp.noteSpectatorBeat(w, 7);
    sp.watchSeat('p2');
    expect(useGame.getState().run.lastCombat).toBe(results.p2);
    // Pending until Recruit takes it (it keeps the fight running through the swap instead of replaying the intro).
    expect(sp.spectatorResumePending(w)).toBe(true);
    expect(sp.takeSpectatorResume(w)).toBe(7);
    expect(sp.spectatorResumePending(w)).toBe(false);
    // ...and on to the foes' reserve (the other team's second board), still the same moment.
    sp.noteSpectatorBeat(w, 9);
    sp.watchSeat('p4');
    expect(useGame.getState().run.lastCombat).toBe(results.p4);
    expect(sp.takeSpectatorResume(w)).toBe(9);
  });

  it('a Versus Group switch into the OTHER fight starts at that player\'s last reported beat', async () => {
    const w = await enterFight(groupRound);
    sp.noteSpectatorBeat(w, 4);
    // p3's player answered some spectator's keyframe request mid-fight: their fight was on beat 12.
    sp.receiveSpectate(keyOf('p3', inFight(base.p3), { w, b: 12 }));
    sp.watchSeat('p3');
    expect(useGame.getState().run.lastCombat).toBe(results.p3);
    expect(sp.takeSpectatorResume(w)).toBe(12);
  });
});

describe('spectating a Duos fight: the fight\'s own changes land live (R-SPECTATE-DUOS-LIVE-01)', () => {
  it('a card passed into the watched hand mid-fight shows at once; their settle still waits for the strike', async () => {
    const w = await enterFight(duosRound);
    const fight = useGame.getState().run.lastCombat;
    const before = useGame.getState().run.hand.length;
    // The teammate's gift lands in p1's hand while the fight plays (their client receives it on the sender's beat).
    const run1 = inFight(base.p1);
    const gift = { ...(run1.shop[0] as unknown as Record<string, unknown>), uid: 'gift-1' } as unknown as RunState['hand'][number];
    const withGift: RunState = { ...run1, hand: [...run1.hand, gift] };
    sp.receiveSpectate(nextSpectatorMessage(pubs.p1, withGift, w)!);
    const now = useGame.getState().run;
    expect(now.hand.length).toBe(before + 1);
    expect(now.hand.some((c) => c.uid === 'gift-1')).toBe(true);
    // The same fight object: the replay on screen is never restarted by it.
    expect(now.lastCombat).toBe(fight);
    expect(now.phase).toBe('combat');
    expect(now.combatSettled).toBeFalsy();
    // Their SETTLE (the blow taken) is still held for this screen's own strike (R-SPECTATE-STRIKE-01).
    const settled: RunState = { ...withGift, combatSettled: true, resolve: withGift.resolve - 5 };
    sp.receiveSpectate(nextSpectatorMessage(pubs.p1, settled, w)!);
    expect(useGame.getState().run.combatSettled).toBeFalsy();
    expect(useGame.getState().run.resolve).toBe(withGift.resolve);
    sp.spectatorStrikeStarted();
    sp.spectatorStrikeLanded();
    expect(useGame.getState().run.combatSettled).toBe(true);
    expect(useGame.getState().run.resolve).toBe(withGift.resolve - 5);
  });
});
