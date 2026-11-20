import { beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponents } from '../opponents';
import { createRunLobby, driverFor, type RunLobby } from './runLobby';
import { createPracticeBotLobby } from './practiceBots';
import { STRENGTH_REF_VERSION, boardPctAtRound, windowStrengthOf, type StrengthHistogram } from './boardStrength';
import {
  BUFF_ROW_CAP, MATCH_DETAILS_MAX_BYTES, MORE_BUFFS_SOURCE, buildMatchDetails, compactBuffs, matchDetailsBytes, matchEndRound, orderMatchSeats, parseMatchDetails, seatBoardRound,
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
  ...(a >= 2 ? { cosmetics: { title: 'title_wanderer' } } : {}), // the title each of these players wore (R-PROG-TITLE-03)
  ...(a === 1 ? { runes: wave >= 6 ? ['rune_broodpit', 'rune_epic_forge'] : ['rune_broodpit'] } : {}),
  ...(a === 2 ? { runStrength: 64 } : {}), // Rook's run is scored (board strength, R-LOBBY-09); the others are not
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

describe('board strength, frozen into the record (R-LOBBY-09)', () => {
  it("an opponent seat carries its run's pool strength; yours carries your rounds; unscored seats carry nothing", () => {
    const lobby = lobbyAt(8, {}, { round: 8, placement: 8 });
    const d = buildMatchDetails(lobby, { ...input(8), selfStrength: { value: 57, rounds: [{ round: 1, value: 40 }, { round: 2, value: 74 }] } });
    const rook = d.seats.find((s) => s.name === 'Rook');
    expect(rook?.strength).toBe(64);
    for (const s of d.seats) if (!s.self && s.name !== 'Rook') expect(s.strength, s.name).toBeUndefined();
    const me = d.seats.find((s) => s.self)!;
    expect(me.strength).toBe(57);
    expect(me.roundStrength).toEqual([{ round: 1, value: 40 }, { round: 2, value: 74 }]);
    // Not scored in time: nothing on your seat either.
    const none = buildMatchDetails(lobby, input(8)).seats.find((s) => s.self)!;
    expect(none.strength).toBeUndefined();
    expect(none.roundStrength).toBeUndefined();
  });
});

/** A histogram where round r's bucket holds raws 1..20, so a board's raw is (about) its percentile x 5. */
const HIST: StrengthHistogram = Object.fromEntries(
  Array.from({ length: 15 }, (_, i) => [String(i + 1), Array.from({ length: 20 }, (_, k) => ({ raw: k + 1, count: 1 }))]),
);
/** A scored board for `round`: raw = round + 3 (so each round ranks differently). */
const scoredBoard = (round: number): BoardSnapshot => ({
  ...board(3, round), poolScore: { ref: STRENGTH_REF_VERSION, raw: round + 3, wave: round },
}) as BoardSnapshot;
/** Serve `boardFor(round)` as the snapshot of every given seat's prepared boards, for the body of `fn`. */
function withBoards(lobby: RunLobby, ids: string[], boardFor: (round: number) => BoardSnapshot | undefined, fn: () => void): void {
  const restore: (() => void)[] = [];
  for (const seat of lobby.seats.filter((s) => ids.includes(s.id))) {
    const drv = driverFor(seat, lobby.setId)!;
    const orig = drv.prepare;
    drv.prepare = (r: number) => {
      const snapshot = boardFor(r);
      return snapshot ? { minions: snapshot.minions, tier: snapshot.tier, snapshot } as never : orig.call(drv, r);
    };
    restore.push(() => { drv.prepare = orig; });
  }
  try { fn(); } finally { for (const r of restore) r(); }
}
const expectedRounds = (n: number) => Array.from({ length: n }, (_, i) => ({ round: i + 1, value: boardPctAtRound(scoredBoard(i + 1), i + 1, HIST)! }));

describe('Relevant Strength, frozen into the record (R-RESULTS-STRENGTH-WINDOW-01)', () => {
  it("window stops at the opponent's elimination round", () => {
    const lobby = lobbyAt(10, { s1: { round: 5, placement: 8 } }, { round: 10, placement: 5 });
    withBoards(lobby, ['s1'], scoredBoard, () => {
      const s1 = seatOf(buildMatchDetails(lobby, { ...input(5), strengthHistogram: HIST }), 's1');
      expect(s1.roundStrength).toEqual(expectedRounds(5));
      expect(s1.windowStrength).toBe(windowStrengthOf(expectedRounds(5), 5));
    });
  });

  it('unscored seat shows run strength only', () => {
    const lobby = lobbyAt(8, {}, { round: 8, placement: 8 });
    const d = buildMatchDetails(lobby, { ...input(8), strengthHistogram: HIST });
    const withRun = d.seats.find((s) => s.name === 'Rook')!;
    for (const seat of d.seats.filter((x) => !x.self)) {
      expect(seat.windowStrength, seat.name).toBeUndefined();
      expect(seat.roundStrength, seat.name).toBeUndefined();
    }
    expect(withRun.strength).toBe(64); // Run Strength keeps its meaning
  });

  it('generated seats get none', () => {
    const lobby = lobbyAt(8, {}, { round: 8, placement: 8 });
    lobby.seats[2]!.kind = 'hybrid';
    withBoards(lobby, ['s2'], scoredBoard, () => {
      const s2 = seatOf(buildMatchDetails(lobby, { ...input(8), strengthHistogram: HIST }), 's2');
      expect(s2.windowStrength).toBeUndefined();
      expect(s2.roundStrength).toBeUndefined();
    });
  });

  it('over the size budget, other seats shed their per-round strength first and keep Relevant Strength', () => {
    const lobby = lobbyAt(12, {}, { round: 12, placement: 8 });
    const ids = lobby.seats.filter((x) => x.id !== 's0').map((x) => x.id);
    const fatBoard = (pad: number) => (round: number): BoardSnapshot => ({
      ...scoredBoard(round), minions: Array.from({ length: 7 }, (_, i) => ({ cardId: 'pack' + String(i).repeat(pad), attack: 9, health: 9 })),
    }) as BoardSnapshot;
    const run = (pad: number, hist: boolean): MatchDetails => {
      let d!: MatchDetails;
      withBoards(lobby, ids, fatBoard(pad), () => { d = buildMatchDetails(lobby, hist ? { ...input(8), strengthHistogram: HIST } : input(8)); });
      return d;
    };
    // Calibrate the padding so the record fits WITHOUT opponents' roundStrength but not WITH it.
    const base = matchDetailsBytes(run(1, false));
    const rsBytes = matchDetailsBytes(run(1, true)) - base;
    expect(rsBytes).toBeGreaterThan(200);
    const perPad = (matchDetailsBytes(run(11, false)) - base) / 10;
    const pad = Math.floor(1 + (MATCH_DETAILS_MAX_BYTES - base - rsBytes / 2) / perPad);
    const d = run(pad, true);
    expect(matchDetailsBytes(d)).toBeLessThanOrEqual(MATCH_DETAILS_MAX_BYTES);
    const rook = seatOf(d, 's1');
    expect(rook.roundStrength).toBeUndefined();
    expect(rook.windowStrength).toBeDefined();
    expect(rook.board!.minions.length).toBe(7); // boards were not trimmed
  });

  it('your seat uses your own rounds', () => {
    const lobby = lobbyAt(8, {}, { round: 8, placement: 8 });
    const rounds = Array.from({ length: 8 }, (_, i) => ({ round: i + 1, value: 20 + i * 10 }));
    const me = seatOf(buildMatchDetails(lobby, { ...input(8), selfStrength: { value: 57, rounds } }), 's0');
    expect(me.windowStrength).toBe(windowStrengthOf(rounds, 8));
    expect(me.strength).toBe(57);
  });

  it('the record round-trips', () => {
    const lobby = lobbyAt(10, { s1: { round: 5, placement: 8 } }, { round: 10, placement: 5 });
    withBoards(lobby, ['s1'], scoredBoard, () => {
      const d = buildMatchDetails(lobby, { ...input(5), strengthHistogram: HIST });
      expect(d.strengthWindow).toBe(1);
      const back = parseMatchDetails(JSON.parse(JSON.stringify(d)))!;
      expect(back).toEqual(d);
      expect(seatOf(back, 's1').windowStrength).toBeDefined();
      expect(seatOf(back, 's1').roundStrength).toHaveLength(5);
    });
    const old = parseMatchDetails({ v: 1, seats: [{ id: 's0', heroId: 'cia', strength: 60, board: null }] })!;
    expect(old.strengthWindow).toBeUndefined();
    expect(old.seats[0]!.windowStrength).toBeUndefined();
    expect(old.seats[0]!.roundStrength).toBeUndefined();
  });

  it('fielded boards are read without side effects', () => {
    const lobby = lobbyAt(10, { s1: { round: 5, placement: 8 } }, { round: 10, placement: 5 });
    const a = buildMatchDetails(lobby, { ...input(5), strengthHistogram: HIST });
    const b = buildMatchDetails(lobby, { ...input(5), strengthHistogram: HIST });
    expect(b).toEqual(a);
  });
});

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

  it('carries the seat owner\'s recorded skins, compacts the minions and keeps the inspect breakdown (R-MATCH-BUFFS-01)', () => {
    const lobby = lobbyAt(4, {});
    const d = buildMatchDetails(lobby, input(1));
    const skye = d.seats.find((s) => s.name === 'Skye')!;
    expect(skye.cosmetics).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' } });
    const m = skye.board!.minions[0]!;
    expect(m.buffs).toEqual([{ source: 'x', attack: 1, health: 1, count: 1 }]);
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

  it('TITLES (R-PROG-TITLE-03): every seat carries the title its player wore, in its cosmetics; yours from your run; none for a player without one', () => {
    const d = buildMatchDetails(lobbyAt(4, {}), { ...input(1), selfCosmetics: { title: 'alpha_tester' } });
    expect(d.seats.find((s) => s.name === 'Rook')!.cosmetics).toEqual({ title: 'title_wanderer' });
    expect(d.seats.find((s) => s.name === 'Tam')!.cosmetics?.title).toBe('title_wanderer');
    expect(d.seats.find((s) => s.name === 'Olde')!.cosmetics).toBeUndefined(); // wore none
    expect(d.seats.find((s) => s.self)!.cosmetics).toEqual({ title: 'alpha_tester' });
    // Stored and read back (the Career), the titles survive.
    const back = parseMatchDetails(JSON.parse(JSON.stringify(d)))!;
    expect(back.seats.find((s) => s.name === 'Rook')!.cosmetics?.title).toBe('title_wanderer');
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

describe('buff breakdown on stored boards (R-MATCH-BUFFS-01, owner 2026-10-31)', () => {
  const row = (source: string, attack: number, health: number, count = 1) => ({ source, attack, health, count });

  it('sorts biggest first and keeps a short list as-is', () => {
    expect(compactBuffs([row('Small', 1, 0), row('Big', 20, 0, 20), row('Mid', 3, 3)])).toEqual([
      row('Big', 20, 0, 20), row('Mid', 3, 3), row('Small', 1, 0),
    ]);
    expect(compactBuffs(undefined)).toBeUndefined();
    expect(compactBuffs([])).toBeUndefined();
  });

  it('past the cap, the biggest rows stay and the rest fold into one "N more" row that keeps the totals', () => {
    const many = [row('a', 1, 1), row('b', 50, 50, 5), row('c', 2, 0), row('d', 10, 10, 2), row('e', 0, 3), row('f', 30, 0), row('g', 5, 5)];
    const out = compactBuffs(many)!;
    expect(out).toHaveLength(BUFF_ROW_CAP);
    expect(out.slice(0, BUFF_ROW_CAP - 1).map((b) => b.source)).toEqual(['b', 'f', 'd', 'g']);
    expect(out[BUFF_ROW_CAP - 1]).toEqual({ source: MORE_BUFFS_SOURCE, attack: 3, health: 4, count: 3 });
    const sum = (rows: { attack: number; health: number }[]) => rows.reduce((n, b) => [n[0]! + b.attack, n[1]! + b.health], [0, 0]);
    expect(sum(out)).toEqual(sum(many));
  });

  it('survives a save and read back, and junk rows from another build are dropped', () => {
    const d = buildMatchDetails(lobbyAt(4, {}), { ...input(1), selfBoard: { tier: 4, minions: [{ cardId: 'pack', attack: 30, health: 9, buffs: [row('Striker', 20, 0, 20), row('Spirit Fire', 1, 1)] }] } });
    const back = parseMatchDetails(JSON.parse(JSON.stringify(d)))!;
    expect(back.seats.find((s) => s.self)!.board!.minions[0]!.buffs).toEqual([row('Striker', 20, 0, 20), row('Spirit Fire', 1, 1)]);
    const junk = parseMatchDetails({ v: 1, seats: [{ id: 's0', heroId: 'cia', board: { round: 3, tier: 2, minions: [
      { cardId: 'pack', attack: 2, health: 2, buffs: [{ source: 'ok', attack: 1, health: 1, count: 2 }, { attack: 1 }, 'x'] },
      { cardId: 'pack', attack: 2, health: 2, buffs: 'nope' },
    ] } }] })!;
    expect(junk.seats[0]!.board!.minions[0]!.buffs).toEqual([row('ok', 1, 1, 2)]);
    expect(junk.seats[0]!.board!.minions[1]!.buffs).toBeUndefined();
  });

  it('over the size budget, other seats lose their buffs before card text, and yours go last', () => {
    // Long labels on every row of every minion push a full table over budget.
    const fat = (id: string) => Array.from({ length: 9 }, (_, i) => row(`${id} source ${i}`.padEnd(48, '.'), 100 + i, 100 + i, 99));
    const lobby = lobbyAt(12, {});
    const restore: (() => void)[] = [];
    for (const seat of lobby.seats) {
      const drv = driverFor(seat, lobby.setId);
      if (!drv) continue;
      const orig = drv.prepare;
      drv.prepare = (r: number) => {
        const b = orig.call(drv, r);
        return b ? { ...b, minions: Array.from({ length: 7 }, (_, i) => ({ cardId: 'pack', attack: 9, health: 9, text: 'T'.repeat(280), buffs: fat(seat.id + i) })) } : b;
      };
      restore.push(() => { drv.prepare = orig; });
    }
    try {
      const selfMinions = Array.from({ length: 7 }, (_, i) => ({ cardId: 'pack', attack: 9, health: 9, buffs: fat('me' + i) }));
      const d = buildMatchDetails(lobby, { ...input(1), selfBoard: { tier: 4, minions: selfMinions } });
      expect(matchDetailsBytes(d)).toBeLessThanOrEqual(MATCH_DETAILS_MAX_BYTES);
      expect(d.seats.find((s) => s.self)!.board!.minions[0]!.buffs).toHaveLength(BUFF_ROW_CAP);
      const other = d.seats.find((s) => !s.self && s.board && s.board.minions.length)!;
      expect(other.board!.minions[0]!.buffs).toBeUndefined();
      expect(other.board!.minions[0]!.text).toBe('T'.repeat(280)); // text outlived the other seats' buffs
    } finally {
      for (const r of restore) r();
    }
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
