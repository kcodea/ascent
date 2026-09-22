import { describe, expect, it } from 'vitest';
import { tallySeatRecords } from './remoteBoards';

/**
 * The seat ledger fold behind the Hall of Champions (owner 2026-09-22): a recorded run's WINS are the players it
 * knocked out; its LOSSES the times it was knocked out while the player it was served to still stood; `played`
 * is the decided results; `lastWinAt` the newest win, for "the last date it won a game". Pure, so the Hall's
 * ranking can be reasoned about without a backend.
 */
describe('tallySeatRecords', () => {
  it('counts wins and losses per run key and keeps the newest win time', () => {
    const map = tallySeatRecords([
      { run_key: 'Mike|warden|1', outcome: 'win', created_at: '2026-09-20T10:00:00Z' },
      { run_key: 'Mike|warden|1', outcome: 'loss', created_at: '2026-09-21T10:00:00Z' },
      { run_key: 'Mike|warden|1', outcome: 'win', created_at: '2026-09-22T10:00:00Z' },
      { run_key: 'Mike|warden|1', outcome: 'loss', created_at: '2026-09-22T11:00:00Z' },
      { run_key: 'Kevin|drakko|2', outcome: 'loss', created_at: '2026-09-19T10:00:00Z' },
    ]);
    expect(map.get('Mike|warden|1')).toEqual({ wins: 2, losses: 2, played: 4, lastWinAt: '2026-09-22T10:00:00Z' });
    expect(map.get('Kevin|drakko|2')).toEqual({ wins: 0, losses: 1, played: 1 });
    expect(map.has('nobody|x|0')).toBe(false);
  });

  it('an empty ledger is an empty map (every Hall run then reads as its own single victory)', () => {
    expect(tallySeatRecords([]).size).toBe(0);
  });

  it('ignores a row whose outcome is neither win nor loss rather than guessing', () => {
    expect(tallySeatRecords([{ run_key: 'K|warden|9', outcome: 'tie' }]).size).toBe(0);
  });

  it('the owner example: 30 decided games against other players, 19 knockouts scored → 19 wins, 11 losses', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ run_key: 'K|warden|9', outcome: i < 19 ? 'win' : 'loss' }));
    expect(tallySeatRecords(rows).get('K|warden|9')).toEqual({ wins: 19, losses: 11, played: 30 });
  });
});
