import { describe, it, expect, beforeEach } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { createRunLobby, driverFor, lobbyPoolTelemetryOf, lobbyStandIns, resetLobbyDrivers, type RunLobby } from './runLobby';
import { builtRecording } from './seats';
import { autoplayRun } from '../snapshot';
import { lobbySeatRecordings, parseLobbySeatRecordings, restoreLobbySeatRecordings } from './savedSeats';
import REAL_RUN from './seatResume.fixture.json';

/**
 * R-LOBBY-SERVE-01 (owner 2026-10-17: "we need the game serving integrity to be literally perfect"): a saved lobby
 * resumes against EXACTLY the boards it was playing, whatever the new session's pool sample holds.
 *
 * The fixture is a real live-pool run (`Orangez|drakko|932453328`, 15 waves). The audit that found the bug resumed
 * a lobby seating it in a session whose sample lacked it: round 3 served `k_beggy, d2_cinderchef, dm_leech` (a
 * generated stand-in under the real player's name) where the run really fielded `dw_orin 2/2, dw_brunni 3/2`.
 */
const run = REAL_RUN as unknown as BoardSnapshot[];
const KEY = 'Orangez|drakko|932453328';
const sig = (ms: readonly { cardId: string; attack: number; health: number }[]): string[] => ms.map((m) => `${m.cardId} ${m.attack}/${m.health}`);

/** A new session: an empty pool (the sample missed the run) and no seat drivers built yet. */
function newSession(lobby: RunLobby): void {
  OPPONENT_POOL.length = 0;
  resetLobbyDrivers(lobby.seats);
}

describe('R-LOBBY-SERVE-01: a resumed lobby serves the boards it was playing', () => {
  beforeEach(() => { OPPONENT_POOL.length = 0; });

  it('the real case: with the run missing from the new pool, round 3 still serves dw_orin 2/2, dw_brunni 3/2', () => {
    registerOpponentRuns([run]);
    const lobby = createRunLobby(4242, 'warden', {}, 'set2');
    const seat = lobby.seats.find((s) => s.runKey === KEY)!;
    expect(seat, 'the real run is seated').toBeTruthy();
    expect(sig(driverFor(seat, 'set2')!.prepare(3)!.minions)).toEqual(['dw_orin 2/2', 'dw_brunni 3/2']);
    // Build every seat's recording, as the opening shop phase does, then save.
    for (const s of lobby.seats) if (s.kind !== 'player') driverFor(s, 'set2')?.prepare(1);
    const saved = JSON.parse(JSON.stringify(lobbySeatRecordings(lobby))) as unknown;

    // WITHOUT the saved recordings the seat becomes a silent stand-in (the bug), and is now REPORTED.
    newSession(lobby);
    expect(lobbyStandIns(lobby).map((s) => s.runKey)).toEqual([KEY]);
    expect(lobbyPoolTelemetryOf(lobby).standIns).toBe(1);
    expect(sig(driverFor(seat, 'set2')!.prepare(3)!.minions)).not.toEqual(['dw_orin 2/2', 'dw_brunni 3/2']);

    // WITH them, restored before the drivers are built: every round is the run's own board again.
    newSession(lobby);
    restoreLobbySeatRecordings(parseLobbySeatRecordings(saved));
    expect(lobbyStandIns(lobby)).toEqual([]);
    for (const b of run) expect(sig(driverFor(seat, 'set2')!.prepare(b.wave)!.minions), `round ${b.wave}`).toEqual(sig(b.minions));
  });

  it('a generated seat keeps the recording it was saved with, even if the code would now record it differently', () => {
    const lobby = createRunLobby(4243, 'warden', {}, 'set2'); // empty pool: every seat is generated
    const seat = lobby.seats.find((s) => s.kind === 'hybrid')!;
    expect(builtRecording(seat.seed, seat.heroId), 'seating probes a prefix only; nothing is built yet').toBeNull();
    // Stand in for "a deploy changed the autoplay": the SAVED recording differs from what this build records.
    const saved = autoplayRun(seat.seed, seat.heroId).map((b) => ({ ...b, minions: b.minions.map((m) => ({ ...m, attack: m.attack + 100 })) }));
    restoreLobbySeatRecordings({ v: 1, runs: [], hybrids: [{ seed: seat.seed, heroId: seat.heroId, snaps: saved }] });
    resetLobbyDrivers(lobby.seats);
    expect(sig(driverFor(seat, 'set2')!.prepare(1)!.minions)).toEqual(sig(saved[0]!.minions));
    // …and the next save carries it on.
    expect(lobbySeatRecordings(lobby).hybrids.find((h) => h.seed === seat.seed)?.snaps[0]?.minions[0]?.attack).toBe(saved[0]!.minions[0]!.attack);
  });

  it('the pre-2026-10-17 stored shape (a bare array of runs) still restores', () => {
    const parsed = parseLobbySeatRecordings([run]);
    expect(parsed?.runs.length).toBe(1);
    expect(restoreLobbySeatRecordings(parsed).runs).toBe(1);
  });
});
