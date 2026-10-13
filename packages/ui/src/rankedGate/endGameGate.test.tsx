// @vitest-environment jsdom
/**
 * THE END-GAME GATE (owner 2026-10-13), verbatim: "when a player either loses or wins, when they hit the gem to end
 * the combat phase, i want the doors to slide closed and slam for a moment and then reopen to the end game stats
 * screen. basically the exact version we had in place yesterday before todays adjustments. do NOT touch the start
 * match screen we did today, t hough".
 *
 * Pinned here:
 *   - the `end` variant's one clock: close, slam, the swap behind the doors, a one second hold, shudder, open;
 *   - the real component playing it on fake timers: no crystal at any moment, nothing to press, the four door cues,
 *     and nothing left mounted;
 *   - the start-of-match gate is untouched: asked for the default way it still forms its crystal and waits;
 *   - `combatMayEndGame`: which fights are resolved at the press, and that an ordinary round is not;
 *   - the store seam: a last fight is resolved ONCE at the press, held, and committed behind the doors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const fx = vi.hoisted(() => ({
  warm: vi.fn(), slam: vi.fn(), shudder: vi.fn(), gather: vi.fn(), ambient: vi.fn(), stopAmbient: vi.fn(), shatter: vi.fn(),
  clear: vi.fn(), release: vi.fn(),
}));
vi.mock('./gateFx', () => ({ gateFx: fx }));
const snd = vi.hoisted(() => ({ gate: vi.fn(), warmGate: vi.fn(), gateHum: vi.fn() }));
vi.mock('../sfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sfx')>();
  return { ...actual, sfx: { ...actual.sfx, gate: snd.gate, warmGate: snd.warmGate, gateHum: snd.gateHum } };
});

import { DEFAULT_PRACTICE_CONFIG, createLobbyRun, playableHeroes, reduce, type RunState } from '@game/sim';
import { RankedGate, warmRankedGate } from './RankedGate';
import { registerRankedGate, requestRankedGate, resetRankedGateForTests } from './rankedGateController';
import { RANKED_GATE_TIMING, rankedGateCloseTimeline, rankedGateEndTimeline } from './rankedGateTiming';
import { END_GATE_MAX_RIVALS, combatMayEndGame, gateMotionAllowed, resolutionEndsGame } from './endGameGate';
import { useGame } from '../store';

let ui: Mounted | null = null;
const phaseOf = (): string | null => {
  const el = document.querySelector('.rgate');
  return el ? [...el.classList].find((c) => c.startsWith('is-'))!.slice(3) : null;
};
const advance = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
const cues = (): string[] => snd.gate.mock.calls.map((c) => c[0] as string);
const crystalEl = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('.rgate-crystal');
const reducedMotion = (on: boolean): void => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  resetRankedGateForTests();
  for (const f of [...Object.values(fx), snd.gate, snd.warmGate, snd.gateHum]) f.mockClear();
  reducedMotion(false);
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the end-game gate\'s one clock', () => {
  const t = RANKED_GATE_TIMING;
  const at = rankedGateEndTimeline();

  it('runs close, slam, the swap, the shudder, the open cue, open, in that order', () => {
    expect(at.closeAt).toBe(0);
    expect(at.slamAt).toBe(t.closeMs);
    expect(at.handoffAt).toBeGreaterThan(at.slamAt);
    expect(at.handoffAt).toBeLessThan(at.shudderAt);
    expect(at.openSoundAt).toBeGreaterThanOrEqual(at.shudderAt);
    expect(at.openSoundAt).toBeLessThan(at.openAt);
    expect(at.endAt).toBe(at.openAt + t.openMs);
  });

  it('is the gate of 2026-10-12: a 1.5 s close, a ONE SECOND hold, a 0.7 s shudder, a 1.5 s open', () => {
    expect(t.holdMs).toBe(1000);
    expect(at.shudderAt - at.slamAt, 'the owner\'s "brief 1 second delay"').toBe(1000);
    expect(at.openAt - at.shudderAt).toBe(700);
    expect(at).toMatchObject({ slamAt: 1500, shudderAt: 2500, openSoundAt: 2900, openAt: 3200, endAt: 4700 });
  });

  it('swaps the end screen in after the impact shake, and never once the doors start to part', () => {
    expect(at.handoffAt - at.slamAt).toBeGreaterThanOrEqual(t.slamShakeMs);
    const wild = rankedGateEndTimeline({ ...t, endHandoffMs: 99_999 });
    expect(wild.handoffAt).toBeLessThan(wild.openAt);
    const early = rankedGateEndTimeline({ ...t, endHandoffMs: -50 });
    expect(early.handoffAt).toBe(early.slamAt);
  });

  it('leaves the start-of-match clock exactly as it was', () => {
    expect(rankedGateCloseTimeline()).toEqual({ closeAt: 0, slamAt: 1500, handoffAt: 1720, formAt: 2150, armedAt: 3950 });
  });
});

describe('the seam passes the variant', () => {
  it('the default is the start-of-match gate; the combat screen asks for `end`', async () => {
    const plays = vi.fn((onShut: () => void, _variant: 'entry' | 'end') => { onShut(); return Promise.resolve(); });
    registerRankedGate(plays);
    await requestRankedGate(() => {});
    await requestRankedGate(() => {}, 'end');
    expect(plays.mock.calls.map((c) => c[1])).toEqual(['entry', 'end']);
  });

  it('with no gate mounted the swap still happens at once', async () => {
    const onShut = vi.fn();
    await requestRankedGate(onShut, 'end');
    expect(onShut).toHaveBeenCalledTimes(1);
  });
});

describe('the end-game gate plays', () => {
  const at = rankedGateEndTimeline();
  const start = (variant?: 'entry' | 'end'): { onShut: ReturnType<typeof vi.fn>; done: ReturnType<typeof vi.fn> } => {
    vi.useFakeTimers();
    ui = mount(<RankedGate />);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1672, bottom: 941, width: 1672, height: 941, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { value: 941, configurable: true });
    const onShut = vi.fn(), done = vi.fn();
    act(() => { void requestRankedGate(onShut, variant).then(done); });
    return { onShut, done };
  };

  it('closes with the grind, slams with smoke and sparks, and swaps the end screen in behind the shut doors', () => {
    const { onShut } = start('end');
    expect(phaseOf()).toBe('closing');
    expect(document.querySelectorAll('.rgate-door')).toHaveLength(2);
    expect(cues()).toEqual(['close']);
    advance(at.slamAt);
    expect(phaseOf()).toBe('shut');
    expect(cues()).toEqual(['close', 'slam']);
    expect(fx.slam).toHaveBeenCalledTimes(1);
    expect(fx.slam.mock.calls[0]![0]).toEqual({ x: 836, top: 0, bottom: 941 });
    expect(onShut, 'the fight is still what is behind the doors').not.toHaveBeenCalled();
    advance(at.handoffAt - at.slamAt);
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(phaseOf()).toBe('shut');
  });

  it('holds for a second, shudders with the rattle, then grinds open and leaves nothing behind', async () => {
    const { onShut, done } = start('end');
    advance(at.shudderAt - 1);
    expect(phaseOf(), 'the one second hold').toBe('shut');
    advance(1);
    expect(phaseOf()).toBe('shudder');
    expect(cues()).toEqual(['close', 'slam', 'rattle']);
    expect(fx.shudder).toHaveBeenCalledTimes(1);
    expect(fx.shudder.mock.calls[0]![1]).toBe(RANKED_GATE_TIMING.shudderMs);
    advance(at.openSoundAt - at.shudderAt);
    expect(cues()).toEqual(['close', 'slam', 'rattle', 'open']);
    advance(at.openAt - at.openSoundAt);
    expect(phaseOf()).toBe('opening');
    expect(done).not.toHaveBeenCalled();
    advance(at.endAt - at.openAt);
    expect(document.querySelector('.rgate'), 'the gate is gone').toBeNull();
    expect(fx.release).toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    expect(done).toHaveBeenCalledTimes(1);
    expect(onShut).toHaveBeenCalledTimes(1);
  });

  it('has no crystal at any moment: nothing forms, nothing hums, nothing shatters, nothing to press', () => {
    start('end');
    for (let ms = 0; ms <= at.endAt; ms += 50) {
      expect(crystalEl(), `at ${ms} ms`).toBeNull();
      advance(50);
    }
    expect(cues()).toEqual(['close', 'slam', 'rattle', 'open']);
    for (const cue of ['form', 'shatter', 'intro']) expect(cues()).not.toContain(cue);
    expect(fx.gather).not.toHaveBeenCalled();
    expect(fx.ambient).not.toHaveBeenCalled();
    expect(fx.shatter).not.toHaveBeenCalled();
    expect(snd.gateHum.mock.calls.every((c) => c[0] === false), 'the hum is only ever told to stop').toBe(true);
  });

  it('opens by itself: left alone it is over in under five seconds', () => {
    const { onShut } = start('end');
    advance(at.endAt);
    expect(document.querySelector('.rgate')).toBeNull();
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(at.endAt).toBeLessThan(5000);
  });

  it('unmounted mid-sequence it still makes the swap', () => {
    const { onShut } = start('end');
    advance(at.slamAt - 200);
    ui!.unmount(); ui = null;
    expect(onShut).toHaveBeenCalledTimes(1);
  });

  it('THE START-OF-MATCH GATE IS UNTOUCHED: asked for the default way it still forms its crystal and waits on it', () => {
    const close = rankedGateCloseTimeline();
    const { onShut } = start();
    advance(close.armedAt);
    expect(phaseOf()).toBe('armed');
    expect(crystalEl()).not.toBeNull();
    expect(cues()).toEqual(['close', 'slam', 'form']);
    expect(onShut).toHaveBeenCalledTimes(1);
    advance(60_000);
    expect(phaseOf(), 'it does not open by itself').toBe('armed');
  });

  it('warming it for a fight leaves the FX layer alone (the gate starts its own as it plays)', () => {
    warmRankedGate({ fx: false });
    expect(snd.warmGate).toHaveBeenCalledTimes(1);
    expect(fx.warm).not.toHaveBeenCalled();
    warmRankedGate();
    expect(fx.warm).toHaveBeenCalledTimes(1);
  });

  it('the stylesheet holds the doors shut through the shudder and shakes them with the same keyframes', () => {
    const css = readFileSync(join(__dirname, 'rankedGate.css'), 'utf8');
    expect(css).toMatch(/\.rgate:is\([^)]*\.is-shudder[^)]*\) \.rgate-door \{ transform: translateX\(0\); \}/);
    expect(css).toMatch(/\.rgate:is\(\.is-shatter, \.is-shudder\) \.rgate-doors \{ animation: rg-shudder var\(--rg-shudder, 700ms\) linear both; \}/);
  });
});

describe('which fights could end the game', () => {
  type Seat = { id: string; alive: boolean; armor: number; resolve: number; botDamageMult?: number };
  const seats = (rivals: number, me: Partial<Seat> = {}): Seat[] => [
    { id: 's0', alive: true, armor: 15, resolve: 30, ...me },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `s${i + 1}`, alive: i < rivals, armor: 0, resolve: 20 })),
  ];
  const run = (over: Record<string, unknown> = {}, lobby: Record<string, unknown> = {}): RunState => ({
    phase: 'combat', mode: 'lobby', wave: 4,
    lastCombat: { result: 'win', playerDamage: 0 },
    lobby: { finished: false, round: 4, rules: { maxRounds: 60 }, seats: seats(7), ...lobby },
    ...over,
  } as unknown as RunState);

  it('an ordinary round is not one: full health, a full table', () => {
    expect(combatMayEndGame(run())).toBe(false);
    // A loss that leaves the player standing, with the table still full.
    expect(combatMayEndGame(run({ lastCombat: { result: 'lose', playerDamage: 12 } }))).toBe(false);
    // Practice (Normal health) is the same game.
    expect(combatMayEndGame(run({ mode: 'practice', practiceConfig: { ...DEFAULT_PRACTICE_CONFIG, health: 'normal' } }))).toBe(false);
  });

  it('a fight whose damage can knock the player out is', () => {
    const lobby = { seats: seats(7, { armor: 0, resolve: 9 }) };
    expect(combatMayEndGame(run({ lastCombat: { result: 'lose', playerDamage: 9 } }, lobby))).toBe(true);
    expect(combatMayEndGame(run({ lastCombat: { result: 'lose', playerDamage: 30 } }, lobby))).toBe(true);
    expect(combatMayEndGame(run({ lastCombat: { result: 'lose', playerDamage: 8 } }, lobby))).toBe(false);
  });

  it('a table down to its last few rivals is (it could finish this round)', () => {
    for (let rivals = 1; rivals <= 7; rivals++) {
      expect(combatMayEndGame(run({}, { seats: seats(rivals) })), `${rivals} rivals`).toBe(rivals <= END_GATE_MAX_RIVALS);
    }
    expect(combatMayEndGame(run({}, { finished: true }))).toBe(true);
    expect(combatMayEndGame(run({}, { round: 60 }))).toBe(true);
  });

  it('an Unlimited-health Practice game is at its round-15 curtain, and cannot be knocked out before it', () => {
    const practice = { mode: 'practice', practiceConfig: { ...DEFAULT_PRACTICE_CONFIG, health: 'unlimited' } };
    const dying = { seats: seats(7, { armor: 0, resolve: 1 }) };
    expect(combatMayEndGame(run({ ...practice, wave: 14, lastCombat: { result: 'lose', playerDamage: 40 } }, dying))).toBe(false);
    expect(combatMayEndGame(run({ ...practice, wave: 15 }))).toBe(true);
  });

  it('never for the tutorial, the Gauntlet, a sandbox run, a run with no lobby, or outside a fight', () => {
    const last = { seats: seats(1) };
    expect(combatMayEndGame(run({}, last))).toBe(true);
    expect(combatMayEndGame(run({ mode: 'tutorial' }, last))).toBe(false);
    expect(combatMayEndGame(run({ mode: 'gauntlet' }, last))).toBe(false);
    expect(combatMayEndGame(run({ sandbox: true }, last))).toBe(false);
    expect(combatMayEndGame(run({ phase: 'recruit' }, last))).toBe(false);
    expect(combatMayEndGame(run({ lastCombat: null }, last))).toBe(false);
    expect(combatMayEndGame({ ...run(), lobby: undefined } as RunState)).toBe(false);
  });

  it('the answer is read off the resolved run: a lobby ends at gameover (a win is placement 1, never victory)', () => {
    expect(resolutionEndsGame({ phase: 'gameover' })).toBe(true);
    expect(resolutionEndsGame({ phase: 'victory' })).toBe(true);
    expect(resolutionEndsGame({ phase: 'recruit' })).toBe(false);
    expect(resolutionEndsGame({ phase: 'combat' })).toBe(false);
    expect(resolutionEndsGame(null)).toBe(false);
  });

  it('reduced motion: no gate (the fight leaves the usual way)', () => {
    expect(gateMotionAllowed()).toBe(true);
    reducedMotion(true);
    expect(gateMotionAllowed()).toBe(false);
  });
});

describe('a real last fight, through the store', { timeout: 120_000 }, () => {
  /** A Practice game on Normal health, taken into its round-1 fight with an empty board (a loss). */
  const lostFight = (): RunState => {
    const hero = playableHeroes()[0]!.id;
    const fresh = createLobbyRun(424242, hero, {}, 'practice', { ...DEFAULT_PRACTICE_CONFIG, health: 'normal' });
    const fought = reduce(fresh, { type: 'faceOmen' });
    expect(fought.phase).toBe('combat');
    expect(fought.lastCombat).toBeTruthy();
    return fought;
  };
  /** The same fight with the player's seat one point from the end. */
  const lastFight = (): RunState => {
    const fought = lostFight();
    const lobby = fought.lobby!;
    return { ...fought, resolve: 1, armor: 0, lobby: { ...lobby, seats: lobby.seats.map((s, i) => (i === 0 ? { ...s, resolve: 1, armor: 0 } : s)) } };
  };

  it('a round-1 loss at full health is an ordinary round: nothing is resolved at the press', () => {
    const fought = lostFight();
    expect(fought.lastCombat!.result).toBe('lose');
    expect(combatMayEndGame(fought)).toBe(false);
  });

  it('the fight that knocks the player out is resolved ONCE at the press, held, then committed behind the doors', () => {
    const fight = lastFight();
    expect((fight.lastCombat!.playerDamage ?? 0)).toBeGreaterThan(0);
    expect(combatMayEndGame(fight)).toBe(true);

    act(() => { useGame.setState({ run: fight, presentationTx: null, replaying: false, showTitle: false }); });
    const tx = useGame.getState().preparePresentationAction({ type: 'resolveCombat' })!;
    expect(tx.action.type).toBe('resolveCombat');
    expect(resolutionEndsGame(tx.after)).toBe(true);
    expect(tx.after.lobby!.seats[0]!.alive).toBe(false);
    // Held: the fight is still what is on screen, and a second ask returns the same resolution (never a second one).
    expect(useGame.getState().run.phase).toBe('combat');
    expect(useGame.getState().preparePresentationAction({ type: 'resolveCombat' })).toBe(tx);

    act(() => { useGame.getState().commitPresentationAction(); });
    expect(useGame.getState().run.phase).toBe('gameover');
    expect(useGame.getState().presentationTx).toBeNull();
    // A second commit is a no-op.
    act(() => { useGame.getState().commitPresentationAction(); });
    expect(useGame.getState().run.phase).toBe('gameover');
  });
});
