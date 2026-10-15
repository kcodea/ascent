import { beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { snapshotBoard } from '../snapshot';
import { registerOpponents } from '../opponents';
import { createRun } from '../state';
import {
  EMOTE_COOLDOWN_MS, MAX_RECORDED_EMOTES, emoteCooldownLeft, emoteReady, emoteReplayDelays, emoteScheduleOf, parseRecordedEmotes,
  recordEmoteOnBoards, recordedOf, withRecordedEmotes, type EmoteMessage, type RecordedEmote,
} from '../emotes';
import { createRunLobby, seatEmoteSchedule } from './runLobby';
import { playerRunsFrom, snapshotSeat } from './snapshotSeats';

/**
 * EMOTES IN THE SNAPSHOT LOBBY (owner spec 2026-10-13): "record each emote the player uses with its time offset ...
 * store it with the seat's recorded snapshot for that round, and when that recorded seat is served to other players,
 * replay the emote at that same offset beside that seat's rail portrait ... Bots/generated seats: no emotes."
 *
 * The sim's half: the board shape and its tolerant parser, the cooldown, recording onto captured boards, the served
 * seat's per-round schedule and the replay timing. Registers boards into the module-global pool, so it lives apart.
 */

const board = (author: string, heroId: string, seed: number, wave: number, emotes?: unknown): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0,
  tribes: ['beast', 'undead', 'mech', 'dragon', 'demon'], threat: 'glass', power: 4,
  minions: [{ cardId: 'pack', attack: 2, health: 2, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: 'set1', ...(emotes !== undefined ? { emotes } : {}),
} as BoardSnapshot);

// Chatty: emotes on rounds 1 and 3 (shop and combat). Quiet: a run from before emotes, no field anywhere.
// Its combat emote is Angry Mushy, RETIRED 2026-10-15: an old recording keeps the id verbatim (the sim never judges
// liveness); the UI's `emoteOf` gate is what makes a retired emote play nothing.
const CHATTY = Array.from({ length: 6 }, (_, i) => board('Chatty', 'albus', 5151, i + 1,
  i === 0 ? [{ id: 'emote_zen_brian', phase: 'shop', at: 4200 }, { id: 'emote_angry_mushy', phase: 'combat', at: 1500 }]
    : i === 2 ? [{ id: 'emote_flirty_midas', phase: 'shop', at: 30_000 }, { id: 'emote_nervous_jensen', phase: 'shop', at: 9_000 }]
    : undefined));
const QUIET = Array.from({ length: 6 }, (_, i) => board('Quiet', 'warden', 5252, i + 1));

beforeAll(() => { registerOpponents([...CHATTY, ...QUIET]); });

describe('the cooldown (owner: "20 seconds between emotes ... No per-turn cap")', () => {
  it('is 20 s; ready before any use, cooling for exactly 20 s after one, ready again after', () => {
    expect(EMOTE_COOLDOWN_MS).toBe(20_000);
    expect(emoteCooldownLeft(null, 1000)).toBe(0);
    expect(emoteReady(null, 1000)).toBe(true);
    expect(emoteCooldownLeft(1000, 1000)).toBe(20_000);
    expect(emoteCooldownLeft(1000, 13_000)).toBe(8_000);
    expect(emoteReady(1000, 20_999)).toBe(false);
    expect(emoteReady(1000, 21_000)).toBe(true);
    // no cap: any number of emotes, one per 20 s
    let last: number | null = null;
    let said = 0;
    for (let t = 0; t <= 200_000; t += 1000) if (emoteReady(last, t)) { last = t; said++; }
    expect(said).toBe(11);
  });

  it('a clock that went backwards never locks longer than one cooldown', () => {
    expect(emoteCooldownLeft(50_000, 0)).toBe(20_000);
  });
});

describe('the recorded field: shape, parse and old boards', () => {
  it('parses tolerantly: junk dropped, offsets rounded, capped, time-ordered per phase; none = undefined', () => {
    expect(parseRecordedEmotes(undefined)).toBeUndefined();
    expect(parseRecordedEmotes('x')).toBeUndefined();
    expect(parseRecordedEmotes([])).toBeUndefined();
    expect(parseRecordedEmotes([
      { id: 'emote_zen_brian', phase: 'combat', at: 900.4 }, null, { id: 'BAD ID', phase: 'shop', at: 1 },
      { id: 'emote_zen_brian', phase: 'lobby', at: 1 }, { id: 'emote_zen_brian', phase: 'shop', at: -5 },
      { id: 'emote_zen_brian', phase: 'shop', at: 99_999_999 }, { id: 'emote_angry_mushy', phase: 'shop', at: 300 }, // retired 2026-10-15: kept, like any id
      { id: 'emote_newer_client_only', phase: 'shop', at: 100 },
    ])).toEqual([
      { id: 'emote_newer_client_only', phase: 'shop', at: 100 }, { id: 'emote_angry_mushy', phase: 'shop', at: 300 },
      { id: 'emote_zen_brian', phase: 'combat', at: 900 },
    ]);
    const many = Array.from({ length: 100 }, (_, i) => ({ id: 'emote_zen_brian', phase: 'shop', at: i }));
    expect(parseRecordedEmotes(many)).toHaveLength(MAX_RECORDED_EMOTES);
  });

  it('a board without emotes (every board from before emotes) loads and schedules nothing', () => {
    const old = QUIET[0]!;
    expect('emotes' in old).toBe(false);
    expect(emoteScheduleOf(old, 1, 'shop')).toEqual([]);
    expect(JSON.parse(JSON.stringify(old)).emotes).toBeUndefined();
  });

  it('snapshotBoard never writes the field (it stays pure); adding nothing keeps the SAME board', () => {
    const snap = snapshotBoard(createRun(7, 'albus'));
    expect('emotes' in snap).toBe(false);
    expect(withRecordedEmotes(snap, [])).toBe(snap);
    const said = withRecordedEmotes(snap, [{ id: 'emote_zen_brian', phase: 'shop', at: 1200 }]);
    expect(said).not.toBe(snap);
    expect(said.emotes).toEqual([{ id: 'emote_zen_brian', phase: 'shop', at: 1200 }]);
    expect('emotes' in snap).toBe(false); // the input is never mutated
    // and it survives the JSON round trip a save / upload / pool fetch takes
    expect(JSON.parse(JSON.stringify(said)).emotes).toEqual(said.emotes);
  });
});

describe('recording onto the captured boards', () => {
  const msg = (round: number, phase: 'shop' | 'combat', offsetMs: number, emoteId = 'emote_zen_brian'): EmoteMessage =>
    ({ emoteId, seat: 's0', phase, offsetMs, round });

  it('a combat emote lands on the board captured for its round (the last one), a copy; no board yet = unchanged', () => {
    const b1 = board('Me', 'albus', 1, 1);
    const b2 = board('Me', 'albus', 1, 2);
    const boards = [b1, b2];
    const out = recordEmoteOnBoards(boards, msg(2, 'combat', 2345.6));
    expect(out).not.toBe(boards);
    expect(out[0]).toBe(b1);
    expect(out[1]!.emotes).toEqual([{ id: 'emote_zen_brian', phase: 'combat', at: 2346 }]);
    expect(b2.emotes).toBeUndefined();
    expect(recordEmoteOnBoards(boards, msg(3, 'shop', 10))).toBe(boards);
  });

  it('recordedOf keeps only what a board needs (emote, phase, offset), clamped', () => {
    expect(recordedOf(msg(4, 'shop', -20))).toEqual({ id: 'emote_zen_brian', phase: 'shop', at: 0 });
  });
});

describe('a served recording replays its emotes (and nobody else does)', () => {
  it('the reassembled player run keeps each board\'s emotes; the seat serves them on that round only', () => {
    const run = playerRunsFrom().find((r) => r.author === 'Chatty')!;
    expect(run.snaps[0]!.emotes).toEqual(CHATTY[0]!.emotes);
    const seat = snapshotSeat(run);
    expect(seat.realPlayer).toBe(true);
    expect(emoteScheduleOf(seat.prepare(1)?.snapshot, 1, 'shop')).toEqual([{ id: 'emote_zen_brian', phase: 'shop', at: 4200 }]);
    expect(emoteScheduleOf(seat.prepare(1)?.snapshot, 1, 'combat')).toEqual([{ id: 'emote_angry_mushy', phase: 'combat', at: 1500 }]);
    // round 3's two shop emotes, in time order
    expect(emoteScheduleOf(seat.prepare(3)?.snapshot, 3, 'shop').map((e) => e.at)).toEqual([9_000, 30_000]);
    // a recording served past its end (round 9 gets the wave-6 board) says nothing
    expect(emoteScheduleOf(seat.prepare(9)?.snapshot, 9, 'shop')).toEqual([]);
  });

  it('in a lobby: the snapshot seat of that run schedules them; bots, generated and the player seat never do', () => {
    const lobby = createRunLobby(4321, 'cia');
    const chatty = lobby.seats.find((s) => s.kind === 'snapshot' && s.heroId === 'albus');
    expect(chatty).toBeDefined();
    expect(lobby.round).toBe(1);
    expect(seatEmoteSchedule(lobby, chatty!.id, 'shop')).toEqual([{ id: 'emote_zen_brian', phase: 'shop', at: 4200 }]);
    expect(seatEmoteSchedule(lobby, chatty!.id, 'combat')).toEqual([{ id: 'emote_angry_mushy', phase: 'combat', at: 1500 }]);
    for (const s of lobby.seats.filter((x) => x.kind !== 'snapshot')) {
      expect(seatEmoteSchedule(lobby, s.id, 'shop'), s.id).toEqual([]);
      expect(seatEmoteSchedule(lobby, s.id, 'combat'), s.id).toEqual([]);
    }
    // a fallen seat is quiet
    const dead = { ...lobby, seats: lobby.seats.map((s) => (s.id === chatty!.id ? { ...s, alive: false } : s)) };
    expect(seatEmoteSchedule(dead, chatty!.id, 'shop')).toEqual([]);
    expect(seatEmoteSchedule(lobby, 'nope', 'shop')).toEqual([]);
  });
});

describe('replay timing: the same offset into the live phase', () => {
  const sched: RecordedEmote[] = [{ id: 'a', phase: 'shop', at: 4200 }, { id: 'b', phase: 'shop', at: 9000 }];

  it('scheduled at the phase start, each waits exactly its recorded offset', () => {
    expect(emoteReplayDelays(sched, 10_000, 10_000).map((x) => x.waitMs)).toEqual([4200, 9000]);
  });

  it('scheduled late, each waits the remainder; one whose moment passed is dropped (a small slip still plays at once)', () => {
    expect(emoteReplayDelays(sched, 10_000, 15_000).map((x) => [x.emote.id, x.waitMs])).toEqual([['b', 4000]]);
    expect(emoteReplayDelays(sched, 10_000, 14_300).map((x) => [x.emote.id, x.waitMs])).toEqual([['a', 0], ['b', 4700]]);
  });
});
