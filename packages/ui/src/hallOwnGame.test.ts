import { describe, expect, it } from 'vitest';
import { hallRowsOf, ownGameRecordsOf, type HallFightRecord, type HallLedgerFight, type HallOwnFacts } from './leaderboardData';

/**
 * The Hall's "Own game" line reads the FIGHT LEDGER, like the record line above it (owner 2026-09-23, asked
 * "why is the record 12-2-1 but also 13-2-1? what's right?": "ledger number probably i think."). A run's own
 * game is the ledger rows of its OWN lobby (lobby_seed = the run's seed) that name the run as a side, counted
 * from that side. Ghost fights are never ledger rows, so the tally the run's career row carries (which counts
 * them) can read one higher; it is used only when the ledger has nothing for that lobby, and the row says so.
 */
const ME = 'Me|drakko|31337';
const fight = (lobbySeed: number, runA: string, runB: string, outcome: HallLedgerFight['outcome']): HallLedgerFight => ({ lobbySeed, runA, runB, outcome });

const LEDGER: HallLedgerFight[] = [
  // My lobby (seed 31337): I am side A or side B depending on the pairing.
  fight(31337, ME, 'Mike|warden|1', 'a'),        // win
  fight(31337, 'Kev|sable|2', ME, 'b'),          // win (from side B)
  fight(31337, ME, 'bot:hybrid:gorr', 'b'),      // loss
  fight(31337, 'Nadja|brackus|7', ME, 'draw'),   // draw
  fight(31337, ME, 'Robin|gorr|9', 'a'),         // win
  fight(31337, 'Mike|warden|1', 'Kev|sable|2', 'a'), // two other seats: not my fight
  // Another lobby that served my run as a snapshot: NOT my own game, even though it names me.
  fight(4242, 'Sam|odelle|10', ME, 'a'),
  fight(4242, ME, 'Sam|odelle|10', 'a'),
];

describe('ownGameRecordsOf', () => {
  it('counts only the rows of the run\'s OWN lobby that name it, from its side; other lobbies and other seats\' fights never count', () => {
    const own = ownGameRecordsOf([{ key: ME, seed: 31337 }], LEDGER);
    expect(own.get(ME)).toEqual({ wins: 3, losses: 1, draws: 1 });
  });

  it('a ghost fight is not a ledger row, so the own game reads what the ledger saw (12), never the tally\'s 13', () => {
    // A 12-win lobby where the player also won a ghost fight (paired against an eliminated seat's leftover board).
    const rows: HallLedgerFight[] = Array.from({ length: 12 }, (_, i) => fight(8, 'Kev|sable|8', `P${i}|h|${i}`, 'a'));
    rows.push(fight(8, 'Kev|sable|8', 'Q|h|100', 'b'), fight(8, 'R|h|101', 'Kev|sable|8', 'a'), fight(8, 'Kev|sable|8', 'S|h|102', 'draw'));
    expect(ownGameRecordsOf([{ key: 'Kev|sable|8', seed: 8 }], rows).get('Kev|sable|8')).toEqual({ wins: 12, losses: 2, draws: 1 });
  });

  it('two players on the SAME shared seed each read their own rows, by key; a run with no rows in its lobby is absent', () => {
    const rows = [fight(8, 'Kev|sable|8', 'X|h|1', 'a'), fight(8, 'Mike|sable|8', 'X|h|1', 'b'), fight(8, 'Mike|sable|8', 'Y|h|2', 'b')];
    const own = ownGameRecordsOf([{ key: 'Kev|sable|8', seed: 8 }, { key: 'Mike|sable|8', seed: 8 }, { key: 'Robin|gorr|9', seed: 9 }], rows);
    expect(own.get('Kev|sable|8')).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(own.get('Mike|sable|8')).toEqual({ wins: 0, losses: 2, draws: 0 });
    expect(own.has('Robin|gorr|9')).toBe(false);
  });
});

describe('hallRowsOf — the own-game line', () => {
  const rec = (runKey: string): { runKey: string } & HallFightRecord => ({ runKey, fights: 20, wins: 14, losses: 6, draws: 0, lobbies: 3, winRate: 0.7, wilsonLb: 0.48, lastFightAt: null });
  type Facts = HallOwnFacts<{ minions: unknown[]; runes?: string[] }>;
  const facts = (record: Facts['record']): Facts => ({ author: null, heroId: null, rank: null, record, placement: 1, board: null });

  it('the ledger record wins over the career tally and is flagged ledger; a lobby the ledger never saw falls back to the tally and is flagged; no data at all is null', () => {
    const history = new Map([
      ['Kev|sable|8', facts({ wins: 13, losses: 2, draws: 1 })],   // the tally counts a ghost win
      ['Old|warden|3', facts({ wins: 9, losses: 5, draws: 0 })],  // a game from before the ledger
    ]);
    const ownGames = new Map([['Kev|sable|8', { wins: 12, losses: 2, draws: 1 }]]);
    const rows = hallRowsOf([rec('Kev|sable|8'), rec('Old|warden|3'), rec('New|gorr|4')], history, new Map(), { minFights: 10, limit: 10, sort: 'rate' }, ownGames);
    expect(rows[0]).toMatchObject({ key: 'Kev|sable|8', ownRecord: { wins: 12, losses: 2, draws: 1 }, ownSource: 'ledger' });
    expect(rows[1]).toMatchObject({ key: 'Old|warden|3', ownRecord: { wins: 9, losses: 5, draws: 0 }, ownSource: 'tally' });
    expect(rows[2]).toMatchObject({ key: 'New|gorr|4', ownRecord: null, ownSource: null });
  });

  it('without an own-game map every row reads its tally (the pre-ledger shape) and says so', () => {
    const history = new Map([['Kev|sable|8', facts({ wins: 13, losses: 2, draws: 1 })]]);
    const rows = hallRowsOf([rec('Kev|sable|8')], history, new Map(), { minFights: 10, limit: 10, sort: 'rate' });
    expect(rows[0]).toMatchObject({ ownRecord: { wins: 13, losses: 2, draws: 1 }, ownSource: 'tally' });
  });
});
