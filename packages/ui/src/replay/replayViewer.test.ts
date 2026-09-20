/**
 * REPLAY VIEWER rework (owner handoff 2026-09-19): seek-to-phase, the per-round Win % table (stamped
 * odds + the idle backfill), the shop-action sounds fired per APPLIED frame, the held card during a ghost
 * flight, and the odds stamp on the capture side. Driven through the real store + player with fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BOT, combatFrameOf, createLobbyRun, createRun, deltaShopFrameOf, expandFrames, reduce, roundMarks, shopFrameOf,
  type DragPath, type ReplayFrame, type ReplayV2, type RunState, type ShopView,
} from '@game/sim';
import {
  endReplay, frameAction, ghostHoldFor, replayRoundInfo, replayRoundMarks, roundInfoOf, seekReplayPhase, startReplay,
  setReplaySounds, replayClockMs, replayCursorAt, setReplayCursor,
} from './replayPlayer';
import { useGame } from '../store';
import { dragStore } from '../dragStore';
import * as mockedSfxModule from '../sfx';

/** Every cue is a spy: the assertions are about WHICH cue fired for WHICH applied frame. */
vi.mock('../sfx', () => {
  const calls: Record<string, number> = {};
  const sfx = new Proxy({} as Record<string, (...a: unknown[]) => void>, {
    get: (_t, k: string) => (..._a: unknown[]) => { calls[k] = (calls[k] ?? 0) + 1; },
  });
  return { sfx, __calls: calls, stopAllAudio: () => {}, resumeAudio: () => {}, getVolume: () => 1, setVolume: () => {} };
});
/** vitest hoists the mock factory; its `__calls` tally is reached through the mocked module namespace. */
function require_calls(): Record<string, number> {
  return (mockedSfxModule as unknown as { __calls: Record<string, number> }).__calls;
}

/** A bot run captured under the store's exact rules, cut at `stopAtWave`'s shop opening. */
function captureBotRun(seed: number, heroId: string, stopAtWave: number): { frames: ReplayFrame[]; final: RunState } {
  let s = createLobbyRun(seed, heroId);
  const first = shopFrameOf(s, 'turnStart', 0);
  const frames: ReplayFrame[] = [first];
  let lastView: ShopView = first.view;
  let t = 0;
  let guard = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 4000) {
    if (s.wave >= stopAtWave && s.phase === 'recruit') break;
    const action = DEFAULT_BOT.act(s);
    const next = reduce(s, action);
    if (next === s) break;
    t += 100;
    if (action.type === 'faceOmen' && next.lastCombat) frames.push(combatFrameOf(s, next, t));
    else if (next.phase === 'recruit' && s.phase !== 'recruit') { const kf = shopFrameOf(next, 'turnStart', t); frames.push(kf); lastView = kf.view; }
    else if (next.phase === 'recruit' && s.phase === 'recruit') { const d = deltaShopFrameOf(lastView, next, action.type, t); frames.push(d.frame); lastView = d.view; }
    s = next;
  }
  return { frames, final: s };
}

const replayOf = (frames: ReplayFrame[], extra: Partial<ReplayV2> = {}): ReplayV2 => ({
  version: 2, seed: 4242, heroId: 'brackus', mode: 'lobby', author: 'brackus', patch: 'test', frames,
  result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null }, ...extra,
});

afterEach(() => { endReplay(); vi.useRealTimers(); });

describe('seekReplayPhase — the rail\'s two cells', () => {
  const cap = captureBotRun(4242, 'brackus', 4);

  it('Combat lands ON the round\'s combat frame (the fight plays from its start); Recruit on its shop opening', () => {
    startReplay(replayOf(cap.frames));
    const marks = replayRoundMarks();
    expect(marks.length).toBeGreaterThanOrEqual(3);
    seekReplayPhase(2, 'combat');
    let st = useGame.getState();
    expect(st.replaySession?.index).toBe(marks[1]!.combatIndex);
    expect(st.replaySession?.phase).toBe('combat');
    expect(st.replaySession?.round).toBe(2);
    expect(st.run.phase).toBe('combat');
    expect(st.run.combatSettled, 'unresolved → the arena animates it').toBe(false);
    seekReplayPhase(3, 'shop');
    st = useGame.getState();
    expect(st.replaySession?.index).toBe(marks[2]!.shopIndex);
    expect(st.replaySession?.phase).toBe('shop');
    expect(st.run.phase).toBe('recruit');
    expect(st.run.wave).toBe(3);
  });

  it('an unknown round, or a round without that phase, is a no-op', () => {
    startReplay(replayOf(cap.frames));
    seekReplayPhase(2, 'shop');
    const before = useGame.getState().replaySession?.index;
    seekReplayPhase(99, 'combat');
    expect(useGame.getState().replaySession?.index).toBe(before);
    // The final, open round (cut at its shop opening) recorded no fight.
    const last = replayRoundMarks()[replayRoundMarks().length - 1]!;
    expect(last.combatIndex).toBeUndefined();
    seekReplayPhase(last.wave, 'combat');
    expect(useGame.getState().replaySession?.index).toBe(before);
  });
});

describe('the per-round Win % table', () => {
  const cap = captureBotRun(4242, 'brackus', 4);

  it('Win % reads a STAMPED odds verbatim; the table carries no Power (removed 2026-09-19)', () => {
    const frames = cap.frames.slice();
    const marks = roundMarks(frames);
    const ci = marks[0]!.combatIndex!;
    const combat = frames[ci]!;
    if (combat.kind !== 'combat') throw new Error('fixture');
    frames[ci] = { ...combat, odds: { win: 0.734, draw: 0.05, lose: 0.216, avgLossDamage: 3 } };
    const info = roundInfoOf(expandFrames(frames), marks);
    expect(info[0]).toEqual({ wave: 1, winPct: 73, winApprox: false });
    expect(info[0]).not.toHaveProperty('power');
    expect(info[1]!.winPct, 'round 2 carries no stamp → unknown until the backfill lands').toBeNull();
  });

  it('the idle-time backfill fills a missing Win % as an ESTIMATE (~) and bumps roundInfoTick', () => {
    vi.useFakeTimers();
    startReplay(replayOf(cap.frames));
    expect(replayRoundInfo().every((r) => r.winPct === null)).toBe(true);
    const tick0 = useGame.getState().replaySession?.roundInfoTick ?? 0;
    // No requestIdleCallback in node → the setTimeout fallback drives the slices.
    vi.advanceTimersByTime(60_000);
    const filled = replayRoundInfo().filter((r) => r.winPct !== null);
    expect(filled.length).toBeGreaterThan(0);
    for (const r of filled) { expect(r.winApprox).toBe(true); expect(r.winPct!).toBeGreaterThanOrEqual(0); expect(r.winPct!).toBeLessThanOrEqual(100); }
    expect(useGame.getState().replaySession?.roundInfoTick ?? 0).toBeGreaterThan(tick0);
  });

  it('endReplay stops a running backfill', () => {
    vi.useFakeTimers();
    startReplay(replayOf(cap.frames));
    endReplay();
    vi.advanceTimersByTime(60_000);
    expect(replayRoundInfo()).toEqual([]);
  });
});

describe('frameAction / ghostHoldFor — what a recorded frame stands for', () => {
  it('frameAction derives the played uid from the hand diff on an old recording, and takes it off the path on a new one', () => {
    const source = createRun(777);
    const withHand = { ...source, hand: [{ uid: 'h1', cardId: 'imp', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false }] } as RunState;
    const f0 = shopFrameOf(withHand, 'turnStart', 0);
    const f1 = shopFrameOf({ ...withHand, hand: [] } as RunState, 'play', 500);
    expect(frameAction(f0, f1)).toEqual({ type: 'play', uid: 'h1' });
    const f2 = { ...f1, drag: { cardId: 'imp', uid: 'h1', durMs: 100, pts: [[0, 0], [1, 1]] as [number, number][] } };
    expect(frameAction(f0, f2)).toEqual({ type: 'play', uid: 'h1' });
    const rolled = shopFrameOf(withHand, 'roll', 600);
    expect(frameAction(f0, rolled)).toEqual({ type: 'roll' });
    expect(frameAction(f0, shopFrameOf(withHand, 'turnStart', 700)), 'a shop opening is not an action').toBeNull();
  });

  it('ghostHoldFor names the held card + its zone, and opens the gap at the recorded destination', () => {
    const m = (uid: string) => ({ uid, cardId: 'imp', tribe: 'demon' as const, attack: 1, health: 1, keywords: [], golden: false });
    const prev = { board: [m('a'), m('b'), m('c')], hand: [], shop: [] } as unknown as ShopView;
    const next = { board: [m('b'), m('c'), m('a')], hand: [], shop: [] } as unknown as ShopView;
    const drag: DragPath = { cardId: 'imp', uid: 'a', durMs: 300, pts: [[0, 0], [1, 1]] };
    const hold = ghostHoldFor(prev, next, 'reposition', drag)!;
    expect(hold.uid).toBe('a');
    expect(hold.source).toBe('board');
    expect(hold.decision.gapIndex).toBe(2);
    // Old recording: no uid on the path — a same-zone reorder falls back to the first card of that id.
    expect(ghostHoldFor(prev, next, 'reposition', { ...drag, uid: undefined })!.uid).toBe('a');
    // A play from hand: the card that LEFT the hand, landing on the board at its index.
    const prevH = { board: [m('a')], hand: [m('x'), m('y')], shop: [] } as unknown as ShopView;
    const nextH = { board: [m('y'), m('a')], hand: [m('x')], shop: [] } as unknown as ShopView;
    const play = ghostHoldFor(prevH, nextH, 'play', { ...drag, uid: undefined })!;
    expect(play).toMatchObject({ uid: 'y', source: 'hand', overZone: 'warband' });
    expect(play.decision).toMatchObject({ gapIndex: 0, overWarband: true });
    // A sell collapses the row.
    expect(ghostHoldFor(prevH, { ...prevH, board: [] } as ShopView, 'sell', { ...drag, uid: undefined })!.decision.collapsedLift).toBe(true);
    expect(ghostHoldFor(prevH, nextH, 'roll', drag), 'not a drag cause').toBeNull();
  });
});

describe('the held card during a ghost flight (owner report 2026-09-19: the original stayed on the board)', () => {
  function makeDragReplay(): { replay: ReplayV2; uid: string } {
    const source = createRun(781);
    // A board card reordered: a `reposition` drag frame.
    const a = { uid: 'ra', cardId: 'sandbag', tribe: 'neutral', attack: 4, health: 4, keywords: [], golden: false };
    const b = { uid: 'rb', cardId: 'sandbag', tribe: 'neutral', attack: 4, health: 4, keywords: [], golden: false };
    const before = { ...source, board: [a, b] } as RunState;
    const after = { ...source, board: [b, a] } as RunState;
    const f0 = shopFrameOf(before, 'turnStart', 0);
    const d = deltaShopFrameOf(f0.view, after, 'reposition', 800);
    d.frame.drag = { cardId: 'sandbag', uid: 'ra', durMs: 400, pts: [[0.1, 0.2], [0.5, 0.5]] };
    return { uid: 'ra', replay: replayOf([f0, d.frame], { seed: source.seed, heroId: source.heroId }) };
  }

  beforeEach(() => dragStore.reset());

  it('marks the source uid HELD (the live drag slice, flagged ghost) while the ghost flies, and releases it on landing', () => {
    vi.useFakeTimers();
    const { replay, uid } = makeDragReplay();
    startReplay(replay);
    expect(dragStore.get().drag).toBeNull();
    vi.advanceTimersByTime(400); // the ghost launches
    expect(useGame.getState().replayDragGhost).not.toBeNull();
    const held = dragStore.get().drag;
    expect(held?.uid).toBe(uid);
    expect(held?.active).toBe(true);
    expect(held?.ghost).toBe(true);
    expect(held?.source).toBe('board');
    expect(dragStore.get().decision.gapIndex, 'the row gap opens at the recorded destination').toBe(1);
    vi.advanceTimersByTime(400); // the frame lands
    expect(useGame.getState().replayDragGhost).toBeNull();
    expect(dragStore.get().drag, 'the hold releases with the landing — the real card is now in its new slot').toBeNull();
    expect(useGame.getState().run.board.map((m) => m.uid)).toEqual(['rb', 'ra']);
  });

  it('endReplay mid-flight releases the hold too', () => {
    vi.useFakeTimers();
    startReplay(makeDragReplay().replay);
    vi.advanceTimersByTime(400);
    expect(dragStore.get().drag?.ghost).toBe(true);
    endReplay();
    expect(dragStore.get().drag).toBeNull();
  });
});

describe('shop-action sounds during playback (actionSfx fired per APPLIED frame)', () => {
  function makeReplay(): ReplayV2 {
    const source = createRun(777);
    const f0 = shopFrameOf(source, 'turnStart', 0);
    const after = reduce(source, { type: 'roll' });
    const d = deltaShopFrameOf(f0.view, after, 'roll', 800);
    const frozen = reduce(after, { type: 'freeze' });
    const d2 = deltaShopFrameOf(d.view, frozen, 'freeze', 1600);
    return replayOf([f0, d.frame, d2.frame], { seed: source.seed, heroId: source.heroId });
  }
  const calls = (): Record<string, number> => require_calls();
  const reset = (): void => { for (const k of Object.keys(calls())) delete calls()[k]; };

  it('fires the same cue table the live dispatch uses, once per frame the clock applies', () => {
    vi.useFakeTimers();
    reset();
    setReplaySounds(true);
    startReplay(makeReplay());
    expect(calls().roll ?? 0).toBe(0);
    vi.advanceTimersByTime(800);
    expect(calls().roll, 'the roll frame landed → the roll cue').toBe(1);
    vi.advanceTimersByTime(800);
    expect(calls().freeze, 'the freeze frame → the freeze cue (next.frozen)').toBe(1);
  });

  it('a SEEK is silent, and the Sounds toggle mutes playback (persisted)', () => {
    vi.useFakeTimers();
    reset();
    setReplaySounds(false);
    startReplay(makeReplay());
    expect(useGame.getState().replaySession?.sounds).toBe(false);
    vi.advanceTimersByTime(800);
    expect(calls().roll ?? 0).toBe(0);
    setReplaySounds(true);
    expect(useGame.getState().replaySession?.sounds).toBe(true);
    seekReplayPhase(1, 'shop');
    expect(calls().roll ?? 0, 'a jump is not an action').toBe(0);
  });
});

describe('the recorded cursor on the replay clock', () => {
  it('replayCursorAt follows the trail between frames, hides in combat, and honours the toggle', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const cap = captureBotRun(4242, 'brackus', 3);
    const marks = roundMarks(cap.frames);
    const t0 = cap.frames[0]!.tMs;
    const t1 = cap.frames[1]!.tMs;
    setReplayCursor(true);
    startReplay(replayOf(cap.frames, { cursorTrail: [[t0, 0, 0], [t1, 1, 1]] }));
    expect(useGame.getState().replaySession?.hasCursorTrail).toBe(true);
    expect(replayClockMs()).toBe(t0);
    expect(replayCursorAt()).toMatchObject({ x: 0, y: 0 });
    vi.advanceTimersByTime((t1 - t0) / 2);
    expect(replayClockMs()).toBeCloseTo(t0 + (t1 - t0) / 2, 0);
    expect(replayCursorAt()!.x).toBeCloseTo(0.5, 2);
    seekReplayPhase(1, 'combat');
    expect(replayCursorAt(), 'combat frames show no cursor').toBeNull();
    expect(marks[0]!.combatIndex).toBe(useGame.getState().replaySession?.index);
    seekReplayPhase(1, 'shop');
    setReplayCursor(false);
    expect(replayCursorAt()).toBeNull();
    setReplayCursor(true);
  });
});

describe('stampReplayOdds — the capture side of Win %', () => {
  it('stamps the live probe\'s odds onto the current fight\'s frame exactly once, never during playback', () => {
    let s = createLobbyRun(4242, 'brackus');
    const frames: ReplayFrame[] = [shopFrameOf(s, 'turnStart', 0)];
    let guard = 0;
    while (s.phase === 'recruit' && guard++ < 200) {
      const action = DEFAULT_BOT.act(s);
      const next = reduce(s, action);
      if (next === s) break;
      if (action.type === 'faceOmen' && next.lastCombat) frames.push(combatFrameOf(s, next, 100));
      s = next;
    }
    expect(s.phase).toBe('combat');
    const before = useGame.getState();
    useGame.setState({ run: s, replayFrames: frames, replaying: false });
    try {
      const odds = { win: 0.6, draw: 0.1, lose: 0.3, avgLossDamage: 2 };
      useGame.getState().stampReplayOdds(odds);
      const stamped = useGame.getState().replayFrames.at(-1)!;
      expect(stamped.kind).toBe('combat');
      if (stamped.kind === 'combat') expect(stamped.odds).toEqual(odds);
      useGame.getState().stampReplayOdds({ ...odds, win: 0.1 });
      const again = useGame.getState().replayFrames.at(-1)!;
      if (again.kind === 'combat') expect(again.odds?.win, 'a second stamp does not overwrite').toBe(0.6);
      useGame.setState({ replayFrames: frames, replaying: true });
      useGame.getState().stampReplayOdds(odds);
      expect(useGame.getState().replayFrames).toBe(frames);
    } finally {
      useGame.setState({ run: before.run, replayFrames: before.replayFrames, replaying: before.replaying });
    }
  });
});
