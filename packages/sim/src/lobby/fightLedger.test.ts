import { describe, expect, it } from 'vitest';
import { reduce } from '../reducer';
import { DEFAULT_BOT } from '../bots/index';
import type { RunState } from '../state';
import { createLobbyRun, createRunLobby, playerEliminated, type RunLobby } from './runLobby';
import { botFightKey, fightRowsOf, isBotFightKey, opponentFightKeys, playOutRunLobby, seatFightKey } from './fightLedger';

/**
 * THE FIGHT LEDGER (owner 2026-09-22): "we want the hall of champions to answer 'what board has been the best
 * against everything else' … overall win/loss across games. so a 15 round game may mean it was 12-3". One row
 * per fight the table resolved, both sides named by run key; the table is played out on a COPY after the
 * reporter's elimination (owner answer (1): "Play out after elimination — yes").
 */
type Seat = RunLobby['seats'][number];
type Enc = RunLobby['encounters'][number];

const OPTS = { reporterKey: 'Me|warden|31337', patch: '0.1.0+test', resolves: (k: string) => !k.startsWith('gone|') };

/** A hand-built, FINISHED table so every seat's kind, key and fate is exactly what the test says. */
function table(seats: Partial<Seat>[], encounters: Partial<Enc>[], over: Partial<RunLobby> = {}): RunLobby {
  const base = createRunLobby(31337, 'warden', {}, 'set1');
  const proto = base.seats[0]!;
  return {
    ...base,
    round: 9,
    finished: true,
    seats: seats.map((s, i) => ({ ...proto, id: `s${i}`, kind: 'bot', alive: true, placement: undefined, eliminatedRound: undefined, runKey: undefined, ...s } as Seat)),
    encounters: encounters.map((e) => ({ outcome: 'lose', damageToA: 0, damageToB: 0, fought: true, ...e } as Enc)),
    ...over,
  };
}

describe('seatFightKey', () => {
  const lobby = { setId: 'set1' as const };
  it('the player is the reporter key; a resolvable snapshot is its run key; generated seats are bot:<kind>:<hero>', () => {
    const proto = createRunLobby(1, 'warden', {}, 'set1').seats[0]!;
    expect(seatFightKey({ ...proto, kind: 'player' }, lobby, OPTS)).toBe('Me|warden|31337');
    expect(seatFightKey({ ...proto, kind: 'snapshot', runKey: 'Mike|drakko|5', heroId: 'drakko' }, lobby, OPTS)).toBe('Mike|drakko|5');
    expect(seatFightKey({ ...proto, kind: 'hybrid', heroId: 'gorr' }, lobby, OPTS)).toBe('bot:hybrid:gorr');
    expect(seatFightKey({ ...proto, kind: 'bot', heroId: 'gorr' }, lobby, OPTS)).toBe('bot:bot:gorr');
    expect(seatFightKey({ ...proto, kind: 'authored', heroId: 'omen' }, lobby, OPTS)).toBe('bot:authored:omen');
  });

  it('a snapshot seat whose run this session cannot resolve was driven by a hybrid: its fights are the hybrid\'s, never the recorded run\'s', () => {
    const proto = createRunLobby(1, 'warden', {}, 'set1').seats[0]!;
    expect(seatFightKey({ ...proto, kind: 'snapshot', runKey: 'gone|drakko|5', heroId: 'drakko' }, lobby, OPTS)).toBe('bot:hybrid:drakko');
    expect(seatFightKey({ ...proto, kind: 'snapshot', runKey: undefined, heroId: 'drakko' }, lobby, OPTS)).toBe('bot:snapshot:drakko');
  });

  it('bot keys are recognisable and never a Hall candidate', () => {
    expect(isBotFightKey(botFightKey('hybrid', 'x'))).toBe(true);
    expect(isBotFightKey('Mike|warden|1')).toBe(false);
    expect(isBotFightKey('bot|warden|1')).toBe(false); // an author literally named "bot" is still a player
  });
});

describe('fightRowsOf — the row assembly', () => {
  it('one row per fought, non-ghost pairing, from A\'s side, keyed by run; ghosts, sit-outs, unfought pairings and bot-vs-bot skipped', () => {
    const t = table([
      { id: 's0', kind: 'player', alive: false, eliminatedRound: 6, placement: 5 },
      { id: 's1', kind: 'snapshot', runKey: 'Mike|drakko|111', heroId: 'drakko', alive: true, placement: 1 },
      { id: 's2', kind: 'snapshot', runKey: 'Kevin|gorr|222', heroId: 'gorr', alive: false, eliminatedRound: 8 },
      { id: 's3', kind: 'hybrid', heroId: 'odelle', alive: false, eliminatedRound: 2 },
      { id: 's4', kind: 'hybrid', heroId: 'sable', alive: false, eliminatedRound: 3 },
    ], [
      { round: 1, a: 's1', b: 's0', outcome: 'win' },                                 // Mike beat me
      { round: 1, a: 's3', b: 's4', outcome: 'lose' },                                // bot vs bot: skipped
      { round: 2, a: 's0', b: 's2', outcome: 'draw' },                                // a draw
      { round: 2, a: 's3', b: 's1', outcome: 'draw', fought: false },                 // could not field: skipped
      { round: 3, a: 's2', b: 's3', outcome: 'win' },                                 // Kevin beat a bot: counts for Kevin
      { round: 3, a: 's0', b: 's0', outcome: 'draw', bye: 's0', fought: false },      // a sit-out: skipped
      { round: 4, a: 's1', b: 's3', outcome: 'lose', bye: 's1' },                     // a ghost fight: skipped
      { round: 6, a: 's2', b: 's0', outcome: 'win', damageToB: 12 },                  // my knockout
    ]);
    const rows = fightRowsOf(t, OPTS);
    expect(rows.map((r) => [r.round, r.runA, r.runB, r.outcome, r.observed])).toEqual([
      [1, 'Mike|drakko|111', 'Me|warden|31337', 'a', true],
      [2, 'Me|warden|31337', 'Kevin|gorr|222', 'draw', true],
      [3, 'Kevin|gorr|222', 'bot:hybrid:odelle', 'a', true],
      [6, 'Kevin|gorr|222', 'Me|warden|31337', 'a', true],
    ]);
    for (const r of rows) {
      expect(r.lobbySeed).toBe(31337);
      expect(r.patch).toBe('0.1.0+test');
      expect(r.runA).not.toBe(r.runB);
    }
  });

  it('a finished table (the reporter won) is all observed and never played out', () => {
    const t = table([
      { id: 's0', kind: 'player', alive: true, placement: 1 },
      { id: 's1', kind: 'snapshot', runKey: 'A|drakko|1', heroId: 'drakko', alive: false, eliminatedRound: 8, placement: 2 },
    ], [{ round: 8, a: 's0', b: 's1', outcome: 'win' }]);
    const before = JSON.stringify(t);
    const rows = fightRowsOf(t, OPTS);
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.observed)).toBe(true);
    expect(playOutRunLobby(t)).toBe(t);
    expect(JSON.stringify(t)).toBe(before);
  });

  it('the seven opponent keys, in seat order, for the strength read', () => {
    const t = table([
      { id: 's0', kind: 'player' },
      { id: 's1', kind: 'snapshot', runKey: 'A|drakko|1', heroId: 'drakko' },
      { id: 's2', kind: 'hybrid', heroId: 'gorr' },
      { id: 's3', kind: 'snapshot', runKey: 'gone|sable|9', heroId: 'sable' },
    ], []);
    expect(opponentFightKeys(t, OPTS)).toEqual(['A|drakko|1', 'bot:hybrid:gorr', 'bot:hybrid:sable']);
  });
});

/** Drive the real reducer until the run ends. */
const playOut = (s: RunState, maxSteps = 6000): RunState => {
  let guard = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < maxSteps) {
    const next = reduce(s, DEFAULT_BOT.act(s));
    if (next === s) break;
    s = next;
  }
  return s;
};

/** A seed on which the default bot is eliminated before the table finishes (so there is something to play out). */
function eliminatedRun(): RunState {
  for (let seed = 1; seed < 60; seed++) {
    const s = playOut(createLobbyRun(seed, 'drakko'));
    if (s.lobby && playerEliminated(s.lobby) && !s.lobby.finished) return s;
  }
  throw new Error('no seed in range eliminates the bot before the table finishes');
}

describe('playOutRunLobby — the play-out after the reporter\'s elimination', () => {
  it('finishes the table on a COPY, deterministically, and leaves the run\'s own lobby untouched', () => {
    const run = eliminatedRun();
    const lobby = run.lobby!;
    const frozen = JSON.stringify(lobby);
    const observed = lobby.encounters.length;
    const a = playOutRunLobby(lobby);
    const b = playOutRunLobby(lobby);
    expect(a).not.toBe(lobby);
    expect(a.finished).toBe(true);
    expect(a.seats.filter((s) => s.alive)).toHaveLength(1);
    expect(a.seats.every((s) => s.placement !== undefined)).toBe(true);
    expect(a.encounters.length).toBeGreaterThan(observed);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // deterministic from the seed
    expect(JSON.stringify(lobby), 'the reducer state is not mutated by the play-out').toBe(frozen);
    expect(run.lobby!.finished).toBe(false);
    // A test session has no opponent pool, so every rival is a hybrid and every played-out fight would be
    // bot-vs-bot (skipped). Relabel them as recorded seats — the unresolvable-key fallback drives them with the
    // SAME hybrid recording (`driverFor`), so the fights are identical and the rows carry real keys.
    const recorded: RunLobby = { ...lobby, seats: lobby.seats.map((s) => (s.kind === 'hybrid' ? { ...s, kind: 'snapshot' as const, runKey: `P|${s.heroId}|${s.seed}` } : s)) };
    const frozenRecorded = JSON.stringify(recorded);
    // The rows: everything the reporter saw is observed, everything after is not, and the reporter's own key
    // never appears in a played-out round (they were out).
    const rows = fightRowsOf(recorded, { reporterKey: 'Me|drakko|1', patch: 'p', resolves: () => true });
    const myKnockout = lobby.seats[0]!.eliminatedRound!;
    expect(rows.some((r) => r.observed && [r.runA, r.runB].includes('Me|drakko|1'))).toBe(true);
    expect(JSON.stringify(recorded), 'the relabelled table is not mutated either').toBe(frozenRecorded);
    expect(rows.some((r) => !r.observed)).toBe(true);
    for (const r of rows) {
      expect(r.observed).toBe(r.round <= myKnockout);
      if (!r.observed) expect([r.runA, r.runB]).not.toContain('Me|drakko|1');
    }
    expect(JSON.stringify(lobby), 'nor by the row assembly').toBe(frozen);
  });
});
