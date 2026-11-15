/**
 * THE ANNOUNCER'S DECK (owner 2026-11-15): a moment's takes are dealt like a shuffled deck that carries over between
 * games, so a take is not heard again until every take of that moment has been (R-PRESENT-ANNOUNCER-DECK-01).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dealTake, parseDeck, type AnnouncerDeck } from './announcerDeck';
import {
  __setAnnouncerDepsForTests, ANNOUNCER_GAME_START_DELAY_MS, ANNOUNCER_LINES, resetAnnouncerForTests, syncAnnouncer,
  type AnnouncerHandle, type AnnouncerRunLike, type AnnouncerStateLike,
} from './announcer';
import { emptyAnnounced, withAnnounced, type AnnouncedSlice } from './announcerSlice';

const TAKES = ['a-1', 'a-2', 'a-3', 'a-4'];
/** A roll sequence that cycles, so "random" picks are varied but repeatable. */
const rolls = (): (() => number) => { let i = 0; const seq = [0.71, 0.05, 0.93, 0.4, 0.62, 0.18, 0.99, 0.33]; return () => seq[i++ % seq.length]!; };

describe('dealTake', () => {
  it('deals every take once before any take is dealt again, for every roll', () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      let deck: AnnouncerDeck = {};
      const seen: string[] = [];
      for (let i = 0; i < TAKES.length; i++) {
        const d = dealTake(deck, 'a', TAKES, TAKES, roll);
        seen.push(d.take);
        deck = d.deck;
      }
      expect([...seen].sort()).toEqual(TAKES);
    }
  });
  it('after the first pass a take always waits out at least half the deck: no line bounces back', () => {
    const roll = rolls();
    let deck: AnnouncerDeck = {};
    const seen: string[] = [];
    for (let i = 0; i < TAKES.length * 5; i++) {
      const d = dealTake(deck, 'a', TAKES, TAKES, roll());
      seen.push(d.take);
      deck = d.deck;
    }
    expect([...seen.slice(0, 4)].sort()).toEqual(TAKES); // the first pass is the whole deck
    // Any 3 deals in a row (half the deck held back, plus the one dealt) are 3 different takes.
    for (let i = 0; i + 3 <= seen.length; i++) expect(new Set(seen.slice(i, i + 3)).size, `window at ${i}`).toBe(3);
  });
  it('a moment with one take is dealt that take every time', () => {
    let deck: AnnouncerDeck = {};
    for (let i = 0; i < 3; i++) {
      const d = dealTake(deck, 'solo', ['solo-1'], ['solo-1'], 0.5);
      expect(d.take).toBe('solo-1');
      deck = d.deck;
    }
    expect(deck.solo).toEqual(['solo-1']);
  });
  it('only deals a candidate: takes already heard this game are never picked, even when the deck would prefer them', () => {
    // a-1 and a-2 were dealt in earlier games; this game already heard a-3 and a-4, so only a-1 / a-2 may play.
    const d = dealTake({ a: ['a-1', 'a-2'] }, 'a', ['a-1', 'a-2'], TAKES, 0);
    expect(['a-1', 'a-2']).toContain(d.take);
    expect(d.take).toBe('a-1'); // a-2 was heard more recently, so it is held back
    expect(d.deck.a).toEqual(['a-2', 'a-1']);
  });
  it('a keyed moment reshuffles only its own takes: another key\'s dealt takes stay out', () => {
    const d = dealTake({ hero: ['x-1', 'y-1'] }, 'hero', ['y-1'], ['x-1', 'y-1'], 0);
    expect(d.take).toBe('y-1');
    expect(d.deck.hero).toEqual(['x-1', 'y-1']);
  });
  it('forgets a take that no longer exists, and leaves other moments alone', () => {
    const d = dealTake({ a: ['a-9', 'a-1'], b: ['b-1'] }, 'a', TAKES, TAKES, 0);
    expect(d.take).toBe('a-2');
    expect(d.deck).toEqual({ a: ['a-1', 'a-2'], b: ['b-1'] });
  });
});

describe('parseDeck', () => {
  it('reads a stored deck and survives anything else', () => {
    expect(parseDeck('{"a":["a-1","a-2"]}')).toEqual({ a: ['a-1', 'a-2'] });
    for (const bad of [null, undefined, '', 'nope', '[]', '42', 'null', '{"a":7}']) {
      const d = parseDeck(bad);
      expect(Array.isArray(d)).toBe(false);
      expect(Object.values(d).every((v) => Array.isArray(v))).toBe(true);
    }
    expect(parseDeck('{"a":["a-1",3,null]}')).toEqual({ a: ['a-1'] });
  });
});

describe('across games (the announcer wired to the deck)', () => {
  let plays: string[] = [];
  let stored: AnnouncerDeck = {};
  let announced: AnnouncedSlice;
  let cur: AnnouncerStateLike | null = null;

  class Handle implements AnnouncerHandle { stop(): void { /* a line that never ends on its own */ } }
  const run = (seed: number): AnnouncerRunLike => ({
    seed, mode: 'lobby', wave: 1, phase: 'recruit', resolve: 30, tier: 1, history: [], board: [], hand: [],
    combatSettled: false, lobby: { seats: Array.from({ length: 8 }, () => ({ alive: true })) },
  });
  const state = (seed: number): AnnouncerStateLike => ({
    showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false,
    run: run(seed), announced, combatOdds: null,
    markAnnounced: (event, wave, take, reshuffle) => { announced = withAnnounced(announced, event, wave, take, reshuffle); },
  });
  /** One whole game's opening: a fresh run lands on turn 1 and GameStart speaks. Returns the take played. */
  const playGame = async (seed: number): Promise<string> => {
    resetAnnouncerForTests(); // a new game: the machine is fresh, the deck store (the device) is not
    announced = emptyAnnounced(seed);
    cur = null;
    const before = plays.length;
    const s = state(seed);
    syncAnnouncer(s, cur);
    cur = s;
    await vi.advanceTimersByTimeAsync(ANNOUNCER_GAME_START_DELAY_MS + 50);
    expect(plays.length, `game ${seed} spoke once`).toBe(before + 1);
    return plays[plays.length - 1]!;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    plays = [];
    stored = {};
    const roll = rolls();
    __setAnnouncerDepsForTests({
      now: () => Date.now(),
      setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id),
      random: roll,
      foe: () => null,
      play: (url) => { plays.push(url.split('/').pop()!.replace('.mp3', '')); return Promise.resolve(new Handle()); },
      deck: { load: () => stored, save: (d) => { stored = d; } },
    });
  });
  afterEach(() => {
    __setAnnouncerDepsForTests(null);
    vi.useRealTimers();
  });

  it('game after game, GameStart plays every one of its takes before it repeats any', async () => {
    const n = ANNOUNCER_LINES.gameStart.length;
    expect(n).toBeGreaterThan(3);
    const first: string[] = [];
    for (let g = 0; g < n; g++) first.push(await playGame(1000 + g));
    expect([...first].sort()).toEqual([...ANNOUNCER_LINES.gameStart].sort());
    // …and the next game opens on a line from the OLDER half, never one heard in the last few games.
    const next = await playGame(5000);
    expect(first.slice(0, n - Math.floor(n / 2))).toContain(next);
  });
  it('the deck is read from storage: takes dealt on an earlier day are still out today', async () => {
    const all = ANNOUNCER_LINES.gameStart;
    stored = { gameStart: all.slice(0, all.length - 1) };
    expect(await playGame(77)).toBe(all[all.length - 1]);
  });
});
