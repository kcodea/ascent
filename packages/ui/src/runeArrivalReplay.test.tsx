// @vitest-environment jsdom
/**
 * R-RUNE-ARRIVAL-ONCE-01 (owner report 2026-11-02, live Versus Duos): "going back and forth sometimes causes runes to
 * trigger as if they were just equipped. like ninefold broker's keeps triggering".
 *
 * The rune lock-in ceremony hands its rune over with an ARRIVAL beat on the badge (the `rune-select-implosion` def,
 * its sound, and the `rune-arrived` art pop). The cue for it stays in the store after it plays, and the badge row
 * remounts whenever the StatusBar does: it is keyed on the run identity, so the Duos teammate view (their run, their
 * seed and hero) remounts it on the way in AND on the way back, and so does a replay seek. The "already played" memory
 * lived in the component, so every remount replayed the arrival of the last rune bought. These tests remount and swap
 * the way the game does and assert the arrival plays exactly once.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRun, reduce, type RunState } from '@game/sim';

vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
// Frames are queued and run by hand (`frame()`), so the beat's next-frame measurement is deterministic.
const frames = vi.hoisted(() => {
  const q = new Map<number, FrameRequestCallback>();
  let n = 0;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { q.set(++n, cb); return n; }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => { q.delete(id); }) as typeof cancelAnimationFrame;
  return q;
});
const plays = vi.hoisted(() => ({ defs: [] as string[], sfx: 0 }));
vi.mock('./fx/playDef', async (orig) => ({
  ...(await orig<typeof import('./fx/playDef')>()),
  playDef: (id: string) => { plays.defs.push(id); },
}));
vi.mock('./runeTriggerFx', async (orig) => ({
  ...(await orig<typeof import('./runeTriggerFx')>()),
  // jsdom lays nothing out, so every badge measures 0x0. Any badge that exists anchors the beat.
  badgeCenterOf: (id: string) => (document.querySelector(`.questbadges .runebadge[data-source-id="${id}"]`) ? { x: 1, y: 1 } : null),
}));
vi.mock('./runeLockInConfig', async (orig) => {
  const m = await orig<typeof import('./runeLockInConfig')>();
  return { ...m, getRuneLockInConfig: () => ({ ...m.getRuneLockInConfig(), arriveDelayMs: 0 }) };
});
vi.mock('./sfx', async (orig) => {
  const m = await orig<typeof import('./sfx')>();
  return { ...m, sfx: new Proxy(m.sfx, { get: (t, k) => (k === 'runeSelectImplosion' ? () => { plays.sfx++; } : Reflect.get(t, k)) }) };
});

const { useGame } = await import('./store');
const { QuestBadges } = await import('./QuestBadges');
const { mount } = await import('./renderedText.mount');

const RUNE = 'rune_ninefold_commerce';
const withRune = (seed: number, hero?: string): RunState =>
  reduce({ ...createRun(seed, hero), wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: [RUNE] } as RunState, { type: 'buyRune', index: 0 }) as RunState;
const runKeyOf = (r: RunState): string => `${r.seed}:${r.heroId}`;
/** Run one frame's worth of callbacks (only those queued before it, like a real frame). */
const frame = (): void => act(() => { const due = [...frames.entries()]; for (const [id, cb] of due) { frames.delete(id); cb(0); } });
const arrivals = (): number => plays.defs.filter((d) => d === 'rune-select-implosion').length;

describe('the rune arrival plays once per rune, whatever remounts the badge row', () => {
  const m = mount(null);
  afterAll(() => m.unmount());
  const badge = (): HTMLElement | null => m.container.querySelector(`.runebadge[data-source-id="${RUNE}"]`);
  // The StatusBar is keyed on the run identity (Game.tsx), so a different key is exactly the remount the game does.
  const show = (key: string): void => { m.render(<QuestBadges key={key} />); frame(); };

  /** Buy the rune and play its ceremony out: pending while it runs, arrived as the board comes back. */
  const buyAndArrive = (run: RunState): void => {
    act(() => useGame.setState({ run }));
    show(`sb:${runKeyOf(run)}`);
    act(() => useGame.getState().setRuneArrival({ runeId: RUNE, occurrence: 0, phase: 'pending', runKey: runKeyOf(run) }));
    act(() => useGame.getState().setRuneArrival({ runeId: RUNE, occurrence: 0, phase: 'arrived', runKey: runKeyOf(run) }));
    frame();
  };

  beforeEach(() => { plays.defs.length = 0; plays.sfx = 0; m.render(null); });

  it('plays on the arrival itself, once', () => {
    buyAndArrive(withRune(11));
    expect(arrivals()).toBe(1);
    expect(plays.sfx).toBe(1);
    expect(badge()?.className).toContain('rune-arrived');
    // Any later re-render of the same mount is not a new arrival.
    act(() => useGame.setState({ run: { ...useGame.getState().run, embers: 9 } }));
    frame();
    expect(arrivals()).toBe(1);
  });

  it('a REMOUNT of the badge row does not replay it (no implosion, no sound, no art pop)', () => {
    const mine = withRune(12);
    buyAndArrive(mine);
    expect(arrivals()).toBe(1);
    m.render(null);
    show(`sb:${runKeyOf(mine)}:1`); // a replay seek bumps the epoch in the key
    expect(arrivals()).toBe(1);
    expect(plays.sfx).toBe(1);
    expect(badge()).not.toBeNull();
    expect(badge()!.className).not.toContain('rune-arrived');
  });

  it('Duos: swapping to my teammate and back, again and again, never replays it, on their badges or on mine', () => {
    const mine = withRune(13);
    // My teammate owns the same rune at the same slot: the stale cue would match their badge too.
    const mate = withRune(14); // their own seed: a different run identity, so the StatusBar remounts on every swap
    expect(runKeyOf(mate)).not.toBe(runKeyOf(mine));
    buyAndArrive(mine);
    expect(arrivals()).toBe(1);
    for (let i = 0; i < 4; i++) {
      act(() => useGame.setState({ run: mate }));
      show(`sb:${runKeyOf(mate)}`);
      expect(badge()!.className).not.toContain('rune-arrived');
      act(() => useGame.setState({ run: mine }));
      show(`sb:${runKeyOf(mine)}`);
      expect(badge()!.className).not.toContain('rune-arrived');
    }
    expect(arrivals()).toBe(1);
    expect(plays.sfx).toBe(1);
  });

  it('a cue for another run never lights this run\'s badge, even on a first sight', () => {
    const mine = withRune(15);
    act(() => useGame.setState({ run: mine }));
    act(() => useGame.getState().setRuneArrival({ runeId: RUNE, occurrence: 0, phase: 'pending', runKey: 'someone:else' }));
    act(() => useGame.getState().setRuneArrival({ runeId: RUNE, occurrence: 0, phase: 'arrived', runKey: 'someone:else' }));
    show(`sb:${runKeyOf(mine)}`);
    expect(arrivals()).toBe(0);
    expect(badge()!.className).not.toContain('rune-arrived');
  });

  it('a NEW arrival still plays after an old one was suppressed', () => {
    const mine = withRune(16);
    buyAndArrive(mine);
    m.render(null);
    show(`sb:${runKeyOf(mine)}:2`);
    expect(arrivals()).toBe(1);
    act(() => useGame.getState().setRuneArrival({ runeId: RUNE, occurrence: 0, phase: 'pending', runKey: runKeyOf(mine) }));
    act(() => useGame.getState().setRuneArrival({ runeId: RUNE, occurrence: 0, phase: 'arrived', runKey: runKeyOf(mine) }));
    frame();
    expect(arrivals()).toBe(2);
    expect(badge()!.className).toContain('rune-arrived');
  });
});
