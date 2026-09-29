import { beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponents } from '../opponents';
import { createRunLobby, driverFor, type RunLobby } from './runLobby';
import { createPracticeBotLobby } from './practiceBots';
import {
  MATCH_DETAILS_MAX_BYTES, buildMatchDetails, matchDetailsBytes, matchEndRound, orderMatchSeats, parseMatchDetails, seatBoardRound,
  type MatchDetails, type MatchSeat,
} from './matchDetails';

/**
 * MATCH DETAILS (owner ask 2026-09-28): the whole table at the moment YOUR game ended, recorded once at run end.
 * The boards must be the ones the lobby actually fielded (never recomputed), from the right round: your end round
 * for a seat still standing, its own knockout round for a seat that fell earlier.
 *
 * Registers boards into the module-global pool, so it lives in its own file.
 */

const HEROES = ['albus', 'warden', 'indy', 'myra', 'soren', 'nadja', 'cassen'];
const AUTHORS = ['Skye', 'Olde', 'Rook', 'Pim', 'Juno', 'Vex', 'Tam'];
/** A board whose Attack encodes (author, wave), so a test can tell exactly which recorded board was served. */
const board = (a: number, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: HEROES[a]!, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0,
  tribes: ['beast', 'undead', 'mech', 'dragon', 'demon'], threat: 'glass', power: 4,
  minions: [
    { cardId: 'pack', attack: wave * 10 + a, health: 5, keywords: [], golden: false, text: 'Live text '.repeat(3), buffs: [{ source: 'x', attack: 1, health: 1 }] },
    { cardId: 'blackbelt', attack: 3, health: 4, keywords: ['taunt'], golden: true },
  ],
  seed: 5000 + a, origin: 'self', author: AUTHORS[a], setId: 'set1',
  ...(a === 0 ? { cosmetics: { heroSkinByHeroId: { albus: 'skin_albus_1' } } } : {}),
  ...(a === 1 ? { runes: wave >= 6 ? ['rune_broodpit', 'rune_epic_forge'] : ['rune_broodpit'] } : {}),
} as unknown as BoardSnapshot);

beforeAll(() => {
  const all: BoardSnapshot[] = [];
  for (let a = 0; a < AUTHORS.length; a++) for (let w = 1; w <= 20; w++) all.push(board(a, w));
  registerOpponents(all);
});

/** A snapshot lobby at round `round + 1` (round `round` just settled) with the given knockouts. */
function lobbyAt(round: number, knockouts: Record<string, { round: number; placement: number }>, player?: { round: number; placement: number }): RunLobby {
  const lobby = createRunLobby(4242, 'cia');
  lobby.round = round + 1;
  for (const s of lobby.seats) {
    const k = s.id === 's0' ? player : knockouts[s.id];
    if (k) { s.alive = false; s.eliminatedRound = k.round; s.placement = k.placement; s.resolve = -3; s.armor = 0; }
  }
  return lobby;
}

const input = (placement: number) => ({ name: 'Kev', placement, selfBoard: { tier: 4, minions: [{ cardId: 'pack', attack: 9, health: 9 }], runes: ['rune_slaying'] }, titleId: 'alpha_tester' });
const seatOf = (d: MatchDetails, id: string): MatchSeat => d.seats.find((s) => s.id === id)!;

describe('the recorded moment', () => {
  it('your end round is your knockout round, else the last settled round', () => {
    expect(matchEndRound({ round: 12, seats: [{ eliminatedRound: 11 } as never] })).toBe(11);
    expect(matchEndRound({ round: 12, seats: [{} as never] })).toBe(11);
  });

  it('a seat that fell earlier shows its knockout round; everyone else your end round', () => {
    expect(seatBoardRound({ alive: false, eliminatedRound: 6 }, 11)).toBe(6);
    expect(seatBoardRound({ alive: false, eliminatedRound: 11 }, 11)).toBe(11);
    expect(seatBoardRound({ alive: true }, 11)).toBe(11);
  });
});

describe('buildMatchDetails', () => {
  it('LOSS: standing seats show the board they fielded in your knockout round; fallen seats their knockout board', () => {
    const lobby = lobbyAt(11, { s1: { round: 5, placement: 8 }, s2: { round: 8, placement: 7 } }, { round: 11, placement: 6 });
    const d = buildMatchDetails(lobby, input(6));
    expect(d.endRound).toBe(11);
    expect(d.eliminated).toBe(true);
    for (const seat of lobby.seats.filter((s) => s.id !== 's0')) {
      const round = seat.eliminatedRound !== undefined && seat.eliminatedRound < 11 ? seat.eliminatedRound : 11;
      // EXACTLY the board the lobby fields for that seat and round (the same driver call the settle makes).
      const fielded = driverFor(seat, lobby.setId)!.prepare(round)!;
      const rec = seatOf(d, seat.id);
      expect(rec.board!.round, seat.id).toBe(round);
      expect(rec.board!.minions.map((m) => m.attack)).toEqual(fielded.minions.map((m) => m.attack));
    }
    expect(seatOf(d, 's1').board!.round).toBe(5);
    expect(seatOf(d, 's2').board!.round).toBe(8);
    expect(seatOf(d, 's3').board!.round).toBe(11);
    // your own seat: your name + title, your end board, your placement
    const me = seatOf(d, 's0');
    expect(me).toMatchObject({ self: true, name: 'Kev', titleId: 'alpha_tester', placement: 6, health: 0, armor: 0 });
    expect(me.board!.minions[0]!.attack).toBe(9);
  });

  it('WIN: every other seat shows its knockout board, and you top the table', () => {
    const k: Record<string, { round: number; placement: number }> = {};
    ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].forEach((id, i) => { k[id] = { round: 3 + i, placement: 8 - i }; });
    const lobby = lobbyAt(9, k);
    lobby.seats[0]!.placement = 1;
    const d = buildMatchDetails(lobby, input(1));
    expect(d.eliminated).toBe(false);
    expect(d.endRound).toBe(9);
    expect(d.seats.map((s) => s.placement)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(d.seats[0]!.self).toBe(true);
    expect(seatOf(d, 's1').board!.round).toBe(3);
    expect(seatOf(d, 's7').board!.round).toBe(9); // knocked out in the final round itself: that round's board
  });

  it('records who knocked you out (the seat you fought in your knockout round)', () => {
    const lobby = lobbyAt(11, {}, { round: 11, placement: 8 });
    lobby.encounters.push({ round: 11, a: 's4', b: 's0', outcome: 'win', damageToA: 0, damageToB: 20, fought: true });
    expect(buildMatchDetails(lobby, input(8)).knockedOutBy).toBe('s4');
  });

  it('carries the seat owner\'s recorded skins, compacts the minions and drops the inspect breakdown', () => {
    const lobby = lobbyAt(4, {});
    const d = buildMatchDetails(lobby, input(1));
    const skye = d.seats.find((s) => s.name === 'Skye')!;
    expect(skye.cosmetics).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' } });
    const m = skye.board!.minions[0]!;
    expect(m.buffs).toBeUndefined();
    expect(m.text).toContain('Live text');
    expect(skye.board!.minions[1]).toMatchObject({ cardId: 'blackbelt', golden: true, keywords: ['taunt'] });
    expect(d.seats.find((s) => s.name === 'Olde')!.cosmetics).toBeUndefined();
  });

  it('RUNES (owner 2026-09-28): each board carries the runes its seat owned at that moment; yours from your end board', () => {
    const late = buildMatchDetails(lobbyAt(9, {}), input(1));
    expect(late.seats.find((s) => s.name === 'Olde')!.board!.runes).toEqual(['rune_broodpit', 'rune_epic_forge']);
    const early = buildMatchDetails(lobbyAt(4, {}), input(1));
    expect(early.seats.find((s) => s.name === 'Olde')!.board!.runes).toEqual(['rune_broodpit']); // the round-4 board had one
    expect(early.seats.find((s) => s.name === 'Rook')!.board!.runes).toBeUndefined(); // none owned: no field
    expect(early.seats.find((s) => s.self)!.board!.runes).toEqual(['rune_slaying']);
    // an older stored record without runes still reads, and junk ids are dropped
    const d = parseMatchDetails({ v: 1, seats: [{ id: 's0', heroId: 'cia', board: { round: 3, tier: 2, minions: [], runes: ['rune_x', 7, 'bad id!'] } }, { id: 's1', heroId: 'cia', board: { round: 3, tier: 2, minions: [] } }] })!;
    expect(d.seats[0]!.board!.runes).toEqual(['rune_x']);
    expect(d.seats[1]!.board!.runes).toBeUndefined();
  });

  it('stays small: a full 8-seat table is well under the cap', () => {
    const d = buildMatchDetails(lobbyAt(12, {}), input(1));
    expect(d.seats).toHaveLength(8);
    expect(matchDetailsBytes(d)).toBeLessThan(MATCH_DETAILS_MAX_BYTES);
  });

  it('practice bots (authored seats) record their omen boards and are marked as bots', () => {
    const lobby = createPracticeBotLobby(77, 'cia', 5);
    lobby.round = 7;
    lobby.seats[0]!.alive = false; lobby.seats[0]!.eliminatedRound = 6; lobby.seats[0]!.placement = 8;
    const d = buildMatchDetails(lobby, input(8));
    const bot = d.seats.find((s) => !s.self)!;
    expect(bot.bot).toBe(true);
    const fielded = driverFor(lobby.seats.find((s) => s.id === bot.id)!, lobby.setId)!.prepare(6)!;
    expect(bot.board!.minions.map((m) => [m.cardId, m.attack, m.health])).toEqual(fielded.minions.map((m) => [m.cardId, m.attack, m.health]));
  });
});

describe('scoreboard order', () => {
  const seat = (id: string, placement: number | undefined, hp: number): MatchSeat => ({ id, name: id, heroId: 'warden', health: hp, armor: 0, board: null, ...(placement ? { placement } : {}) });

  it('you knocked out 6th: the five still standing first (by health), then you, then the earlier knockouts', () => {
    const order = orderMatchSeats([
      seat('s0', 6, 0), seat('s1', 8, 0), seat('s2', 7, 0), seat('s3', undefined, 12), seat('s4', undefined, 30),
      seat('s5', undefined, 5), seat('s6', undefined, 30), seat('s7', undefined, 18),
    ], 's0', true).map((s) => s.id);
    expect(order).toEqual(['s4', 's6', 's7', 's3', 's5', 's0', 's2', 's1']);
  });

  it('a shared placement (knocked out the same round) keeps you first in the tie', () => {
    const order = orderMatchSeats([seat('s1', 5, 0), seat('s0', 5, 0), seat('s2', undefined, 3)], 's0', true).map((s) => s.id);
    expect(order).toEqual(['s2', 's0', 's1']);
  });

  it('you standing at the end (a win, or Practice\'s curtain): you first, then anyone still standing, then the rest', () => {
    const order = orderMatchSeats([seat('s1', 3, 0), seat('s0', 1, 20), seat('s2', undefined, 3), seat('s3', 2, 0)], 's0', false).map((s) => s.id);
    expect(order).toEqual(['s0', 's2', 's3', 's1']);
  });
});

describe('reading a stored record (old records and junk)', () => {
  it('round-trips through JSON unchanged', () => {
    const d = buildMatchDetails(lobbyAt(8, { s1: { round: 4, placement: 8 } }), input(2));
    expect(parseMatchDetails(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('an old record without the field, or one from a future shape, reads as null (the UI says it was not recorded)', () => {
    expect(parseMatchDetails(undefined)).toBeNull();
    expect(parseMatchDetails(null)).toBeNull();
    expect(parseMatchDetails({})).toBeNull();
    expect(parseMatchDetails({ v: 2, seats: [] })).toBeNull();
    expect(parseMatchDetails({ v: 1, seats: [] })).toBeNull();
    expect(parseMatchDetails('nope')).toBeNull();
  });

  it('drops unreadable seats and minions but keeps the rest', () => {
    const d = parseMatchDetails({
      v: 1, endRound: 9, placement: 3, eliminated: true, seats: [
        { id: 's0', name: 'Kev', heroId: 'cia', self: true, placement: 3, health: 0, armor: 0, board: { round: 9, tier: 5, minions: [{ cardId: 'pack', attack: 2, health: 2 }, { attack: 1 }] } },
        { id: 's1', heroId: 'warden', health: 12, armor: 4, board: null },
        { name: 'no id' },
      ],
    })!;
    expect(d.seats).toHaveLength(2);
    expect(d.seats[0]!.board!.minions).toHaveLength(1);
    expect(d.seats[1]).toMatchObject({ name: 'Player', health: 12, armor: 4 });
  });
});
