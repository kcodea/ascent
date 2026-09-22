import { describe, expect, it } from 'vitest';
import { createRunLobby, seatOutcomesOf, type RunLobby } from './runLobby';

/**
 * The seat ledger rows a run produces when it ends (owner 2026-09-22, the Hall of Champions record): "track the
 * run that beat the player when they were knocked out … if i play a board that wins on turn 14 and it knocks a
 * player out on turn 9, that board should probably get a win. subsequently, if that same board is served to a
 * player and it comes in 3rd against the player on turn 13, my board should get a loss recorded."
 *
 * Everything is read from the lobby state the player's own run ended with; nothing is simulated past it.
 */
type Seat = RunLobby['seats'][number];
type Enc = RunLobby['encounters'][number];

/** A hand-built table so every seat's kind, key and fate is exactly what the test says. */
function table(seats: Partial<Seat>[], encounters: Partial<Enc>[]): RunLobby {
  const base = createRunLobby(31337, 'warden', {}, 'set1');
  const proto = base.seats[0]!;
  return {
    ...base,
    round: 9,
    finished: false,
    seats: seats.map((s, i) => ({ ...proto, id: `s${i}`, kind: 'bot', alive: true, placement: undefined, eliminatedRound: undefined, runKey: undefined, ...s } as Seat)),
    encounters: encounters.map((e) => ({ outcome: 'lose', damageToA: 0, damageToB: 0, ...e } as Enc)),
  };
}

describe('seatOutcomesOf', () => {
  it('the run that knocked the player out gets a WIN; runs knocked out earlier get a LOSS; the rest nothing', () => {
    const t = table([
      { id: 's0', kind: 'player', alive: false, eliminatedRound: 6, placement: 5 },
      { id: 's1', kind: 'snapshot', runKey: 'Mike|warden|111', alive: true },                          // still standing: nothing decided
      { id: 's2', kind: 'snapshot', runKey: 'Kevin|drakko|222', alive: true },                         // the killer, still alive
      { id: 's3', kind: 'bot', alive: false, eliminatedRound: 2 },                                     // nobody's run
      { id: 's4', kind: 'hybrid', alive: false, eliminatedRound: 3 },                                  // nobody's run
      { id: 's5', kind: 'snapshot', runKey: 'anon|odelle|555', alive: false, eliminatedRound: 3, placement: 7 }, // fell before the player: loss
      { id: 's6', kind: 'snapshot', runKey: 'Robin|gorr|666', alive: false, eliminatedRound: 6, placement: 5 },  // fell WITH the player, did not fell them: nothing
      { id: 's7', kind: 'authored', alive: false, eliminatedRound: 4 },                                // nobody's run
    ], [
      { round: 6, a: 's2', b: 's0', outcome: 'win', damageToB: 12 },   // the player's last fight, lost to s2
      { round: 6, a: 's6', b: 's1', outcome: 'lose' },
      { round: 3, a: 's5', b: 's0', outcome: 'lose' },
    ]);
    const rows = seatOutcomesOf(t, '0.1.0+test');
    expect(rows.map((r) => [r.runKey, r.outcome, r.round])).toEqual([
      ['Kevin|drakko|222', 'win', 6],
      ['anon|odelle|555', 'loss', 3],
    ]);
    for (const r of rows) {
      expect(r.lobbySeed).toBe(31337);
      expect(r.playerPlacement).toBe(5);
      expect(r.seats).toBe(8);
      expect(r.mode).toBe('lobby');
      expect(r.patch).toBe('0.1.0+test');
    }
  });

  it('when the player WINS the table, every recorded seat that fell is a loss and nobody gets a win', () => {
    const t = table([
      { id: 's0', kind: 'player', alive: true, placement: 1 },
      { id: 's1', kind: 'snapshot', runKey: 'A|warden|1', alive: false, eliminatedRound: 8, placement: 2 },
      { id: 's2', kind: 'snapshot', runKey: 'B|drakko|2', alive: false, eliminatedRound: 5, placement: 4 },
      { id: 's3', kind: 'bot', alive: false, eliminatedRound: 2 },
    ], [{ round: 8, a: 's0', b: 's1', outcome: 'win' }]);
    const rows = seatOutcomesOf(t, 'p');
    expect(rows.map((r) => [r.runKey, r.outcome, r.round])).toEqual([['A|warden|1', 'loss', 8], ['B|drakko|2', 'loss', 5]]);
    expect(rows.every((r) => r.playerPlacement === 1)).toBe(true);
  });

  it('a ghost that finishes the player still counts as a win for the run behind it', () => {
    // The player held the bye and fought the ghost of s3 (the ghost is `b`), and lost the fight that ended them.
    const t = table([
      { id: 's0', kind: 'player', alive: false, eliminatedRound: 7, placement: 3 },
      { id: 's1', kind: 'snapshot', runKey: 'A|warden|1', alive: true },
      { id: 's2', kind: 'snapshot', runKey: 'B|drakko|2', alive: true },
      { id: 's3', kind: 'snapshot', runKey: 'C|gorr|3', alive: false, eliminatedRound: 5, placement: 6 },
    ], [{ round: 7, a: 's0', b: 's3', bye: 's0', outcome: 'lose', damageToA: 9 } as Partial<Enc>]);
    const rows = seatOutcomesOf(t, 'p');
    // s3 fell before the player (a loss) AND finished them as a ghost (a win): the win takes precedence, one row.
    expect(rows.map((r) => [r.runKey, r.outcome, r.round])).toEqual([['C|gorr|3', 'win', 7]]);
  });

  it('a knocked-out player with no recorded last fight yields no win, and the earlier losses still count', () => {
    const t = table([
      { id: 's0', kind: 'player', alive: false, eliminatedRound: 6, placement: 5 },
      { id: 's1', kind: 'snapshot', runKey: 'A|warden|1', alive: false, eliminatedRound: 2 },
    ], []);
    expect(seatOutcomesOf(t, 'p').map((r) => [r.runKey, r.outcome])).toEqual([['A|warden|1', 'loss']]);
  });

  it('the player placement falls back to "alive seats + 1" when the seat carries none', () => {
    const t = table([
      { id: 's0', kind: 'player', alive: false, eliminatedRound: 4 },
      { id: 's1', kind: 'snapshot', runKey: 'A|warden|1', alive: true },
      { id: 's2', kind: 'snapshot', runKey: 'B|drakko|2', alive: true },
      { id: 's3', kind: 'snapshot', runKey: 'C|gorr|3', alive: false, eliminatedRound: 2 },
    ], [{ round: 4, a: 's1', b: 's0', outcome: 'win' }]);
    const rows = seatOutcomesOf(t, 'p');
    expect(rows.every((r) => r.playerPlacement === 3)).toBe(true);
  });

  it('never rows the player, a bot, a hybrid or an authored seat, and never a snapshot seat without a key', () => {
    const t = table([
      { id: 's0', kind: 'player', alive: false, eliminatedRound: 3 },
      { id: 's1', kind: 'snapshot', runKey: undefined, alive: false, eliminatedRound: 1 },
      { id: 's2', kind: 'bot', alive: false, eliminatedRound: 1 },
      { id: 's3', kind: 'authored', alive: false, eliminatedRound: 2 },
    ], [{ round: 3, a: 's2', b: 's0', outcome: 'win' }]);
    expect(seatOutcomesOf(t, 'p')).toEqual([]);
  });
});
