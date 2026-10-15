// @vitest-environment jsdom
/**
 * SPECTATORS GET THE FULL GAME (owner 2026-10-15: "make sure pixi effects are firing as well as sound effects. all
 * animations etc are important to be on there"). The watch screen drives the SAME presentation hooks the player's
 * screen does, never a spectator-only copy. Pinned:
 *  - CARD ACTIONS present through the ONE presenter (`actionPresenter.ts`) the player's input handlers use: the
 *    pick-up touch, the own play (placing + landing, not an arrival), a spell's cast (aimed at its target), a sale
 *    (its Gold), a reposition.
 *  - END TURN: the press cue, then the SAME recorded beats the replay viewer plays (`replayEotCue`, held for the next
 *    view); what comes after waits for them.
 *  - LEAVING A FIGHT: the End Combat press cue (the relight, Recruit's exit curtain); the shop swaps in only at the
 *    curtain's full cover.
 *  - THE TAP: the End Turn press is tagged when PREPARED, and a tag alone still goes out (an empty delta).
 *  - AUDIO: the watch screen has the game's music; the announcer (it speaks to "you") stays silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, sellValueWithBonus, type BoardCard, type RunState } from '@game/sim';
import { newPublisher, nextSpectatorMessage } from './spectatorView';
import type { PresentedAction } from '../actionPresenter';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const sp = await import('./spectate');
const tap = await import('./spectateTap');
const press = await import('../pressCue');
const presenter = await import('../actionPresenter');
const { isMusicWanted } = await import('../music');
const { isAnnouncerWanted } = await import('../announcer');

const bc = (uid: string, cardId: string, tribe: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false }) as unknown as BoardCard;
const base = (): RunState => {
  const r = createVersusRun(5, 'warden', 'set2');
  return { ...r, board: [bc('b1', 'dw_foreman', 'dwarf', 5, 7), bc('b2', 'dw_pimm', 'dwarf', 3, 1)], hand: [bc('h1', 'dw_pimm', 'dwarf', 3, 1), bc('h2', 'spiritfire', 'neutral', 0, 0)] } as RunState;
};
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  sp.installSpectateIo(io);
});
afterEach(() => { sp.resetSpectate(); sp.installSpectateIo(null); vi.unstubAllGlobals(); vi.useRealTimers(); tap.setSpectatorTap(false, null, null); });

/** Watch `run0` (its keyframe), with a spy presenter installed. */
async function watch(run0: RunState, id: string): Promise<{ pub: ReturnType<typeof newPublisher>; seen: PresentedAction[]; off: () => void }> {
  const pub = newPublisher('p1');
  frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, run0, run0.wave, true) }];
  sp.spectateSync({ id, phase: 'shop', round: run0.wave } as never, {});
  await flush();
  const seen: PresentedAction[] = [];
  const off = presenter.setActionPresenter((a) => seen.push(a));
  return { pub, seen, off };
}

describe('card actions present through the one presenter', () => {
  it('a play, an aimed cast, a sale and a reposition: what the player\'s input presented, in order', async () => {
    const run0 = base();
    const { pub, seen, off } = await watch(run0, 'pa');
    vi.useFakeTimers();
    // the player plays the minion h1
    const played = { ...run0, hand: run0.hand.filter((c) => c.uid !== 'h1'), board: [...run0.board, run0.hand[0]!] } as RunState;
    const m1 = nextSpectatorMessage(pub, played, 1)!;
    m1.acts = [{ t: 'play', uid: 'h1' }];
    sp.receiveSpectate(m1);
    vi.advanceTimersByTime(200);
    expect(seen.map((a) => a.kind)).toEqual(['placing', 'played']);
    expect(seen[0]).toMatchObject({ uid: 'h1' });
    // the spell h2 cast on b2
    seen.length = 0;
    const cast = { ...played, hand: [] } as RunState;
    const m2 = nextSpectatorMessage(pub, cast, 1)!;
    m2.acts = [{ t: 'play', uid: 'h2', targetUid: 'b2' }];
    sp.receiveSpectate(m2);
    vi.advanceTimersByTime(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'cast', cardId: 'spiritfire', targetUid: 'b2' });
    // b2 sold: its Gold, as the player's drop floated it
    seen.length = 0;
    const sold = { ...cast, board: cast.board.filter((c) => c.uid !== 'b2') } as RunState;
    const m3 = nextSpectatorMessage(pub, sold, 1)!;
    m3.acts = [{ t: 'sell', uid: 'b2' }];
    sp.receiveSpectate(m3);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([expect.objectContaining({ kind: 'sold', amount: sellValueWithBonus(cast.board.find((c) => c.uid === 'b2')!, cast) })]);
    // a reposition
    seen.length = 0;
    const moved = { ...sold, board: [...sold.board].reverse() } as RunState;
    const m4 = nextSpectatorMessage(pub, moved, 1)!;
    m4.acts = [{ t: 'reposition', uid: 'b1', index: 1 }];
    sp.receiveSpectate(m4);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([expect.objectContaining({ kind: 'repositioned', uid: 'b1' })]);
    off();
  });

  it('a dragged action\'s flight starts with the pick-up touch', async () => {
    const run0 = base();
    const { pub, seen, off } = await watch(run0, 'pb');
    vi.useFakeTimers();
    const offer = run0.shop[0]!;
    const bought = { ...run0, shop: run0.shop.slice(1), hand: [...run0.hand, bc(offer.uid, offer.cardId, 'neutral', 1, 1)] } as RunState;
    const m = nextSpectatorMessage(pub, bought, 1)!;
    m.acts = [{ t: 'buy', uid: offer.uid, drag: { cardId: offer.cardId, uid: offer.uid, durMs: 300, pts: [[0.5, 0.3], [0.5, 0.8]] } }];
    sp.receiveSpectate(m);
    expect(seen[0]).toEqual({ kind: 'touch' });
    expect(useGame.getState().replayDragGhost).not.toBeNull();
    off();
  });
});

describe('End Turn plays the same recorded beats, then the queue goes on', () => {
  it('the press cue, the held recorded beats, and nothing lands until they are done', async () => {
    const run0 = base();
    const { pub, off } = await watch(run0, 'pc');
    vi.useFakeTimers();
    const strike = vi.fn();
    const offPress = press.onPressCue('endTurn', strike);
    const batch = { phase: 'endOfTurn', events: [{ kind: 'statChanged' }] } as never;
    const m1 = nextSpectatorMessage(pub, run0, 1, false, true)!; // the press changes nothing visible: an empty delta
    expect(m1.kind).toBe('delta');
    m1.acts = [{ t: 'endTurn', eot: { batch } }];
    sp.receiveSpectate(m1);
    expect(strike).toHaveBeenCalledTimes(1);
    const cue = useGame.getState().replayEotCue;
    expect(cue?.eot.batch).toBe(batch);
    expect(cue?.hold).toBe(true);
    // the next view arrives while the beats play: it waits
    const after = { ...run0, frozen: !run0.frozen } as RunState;
    const m2 = nextSpectatorMessage(pub, after, 1)!;
    m2.acts = [{ t: 'freeze' }];
    sp.receiveSpectate(m2);
    vi.advanceTimersByTime(500);
    expect(!!useGame.getState().run.frozen).toBe(!!run0.frozen);
    // Recruit reports the beats done: the queue goes on
    useGame.setState({ replayEotDone: cue!.key });
    vi.advanceTimersByTime(200);
    expect(!!useGame.getState().run.frozen).toBe(!!after.frozen);
    expect(useGame.getState().replayEotCue).toBeNull();
    offPress();
    off();
  });
});

describe('leaving a fight', () => {
  it('the End Combat press cue starts the exit; the shop swaps in only at the curtain\'s full cover', async () => {
    const run0 = { ...base(), phase: 'combat' } as RunState;
    const pub = newPublisher('p1');
    const fight = { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } };
    const rounds = { 1: { round: 1, p1_result: fight, p2_result: fight } } as never;
    frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, run0, 1, true) }];
    sp.spectateSync({ id: 'pd', phase: 'combat', round: 1 } as never, rounds);
    await flush();
    vi.useFakeTimers();
    expect(useGame.getState().run.phase).toBe('combat');
    const relight = vi.fn();
    const offPress = press.onPressCue('endCombat', relight);
    // the player is back in the shop
    const shop = { ...base(), phase: 'recruit', wave: 2 } as RunState;
    sp.receiveSpectate(nextSpectatorMessage(pub, shop, 2)!);
    // the spectator's own replay finishes, then the strike's time
    useGame.setState({ combatReplayDone: true });
    vi.advanceTimersByTime(3000);
    expect(relight).toHaveBeenCalledTimes(1);
    expect(useGame.getState().run.phase).toBe('combat'); // held under the closing curtain
    sp.spectatorFightCovered(); // Recruit, at full cover
    expect(useGame.getState().run.phase).toBe('recruit');
    offPress();
  });
});

describe('the tap', () => {
  it('the End Turn press is tagged with its beats, and wakes the publisher', () => {
    const wake = vi.fn();
    tap.setSpectatorTap(true, 'p1', vi.fn(), wake);
    const batch = { phase: 'endOfTurn', events: [] } as never;
    tap.tapEndTurn({ batch });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(tap.hasPendingActs()).toBe(true);
    expect(tap.takeActs()).toEqual([{ t: 'endTurn', eot: { batch } }]);
    tap.tapEndTurn(null);
    expect(tap.takeActs()).toEqual([{ t: 'endTurn' }]);
  });
});

describe('audio on the watch screen', () => {
  const s = (patch: object) => ({ showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: true, run: { mode: 'versus', seed: 0 }, ...patch });
  it('the game\'s music plays; the announcer stays silent; a recorded replay keeps both off', () => {
    expect(isMusicWanted(s({ replaySession: null }))).toBe(true);
    expect(isAnnouncerWanted(s({ replaySession: null }) as never)).toBe(false);
    expect(isMusicWanted(s({ replaySession: {} }))).toBe(false);
    expect(isMusicWanted(s({}))).toBe(false); // no session field: a replay, as before
  });
});
