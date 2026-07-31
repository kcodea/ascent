import type { SetId } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL } from '../opponents';
import { botSeat, recordedSeat, type SeatPolicy } from './seats';
import type { PreparedBoard, SeatDriver } from './types';

/**
 * REAL PLAYER RUNS AS LOBBY SEATS.
 *
 * The lobby's seat drivers were built for this from the start — `recordedSeat` replays someone's actual boards
 * in wave order — but nothing ever fed them real data, so every seat was a bot. This is the wiring: group the
 * registered opponent pool back into the RUNS it came from, and hand each one to a seat.
 *
 * The boards are Ascent-mode snapshots (owner call 2026-07-29: use those for now). That is a real approximation
 * and worth naming — an Ascent board was built against the 17-round course, not against a lobby's damage race —
 * but it is a player's genuine build order, which is the part bots cannot fake.
 */

/** One player's run, reassembled from its per-wave boards. */
export interface PlayerRun {
  /** Stable identity, and the only thing a serialized seat stores — see `snapshotSeat`. */
  key: string;
  author: string;
  heroId: string;
  /** Per-wave boards, ascending. */
  snaps: BoardSnapshot[];
}

/** A run is only worth a seat if it has enough material to hold one for a while. */
const MIN_WAVES = 4;

/**
 * Group snapshots back into runs.
 *
 * Synthetic boards are excluded: they are generated per-wave against a power curve and were never a single
 * player's run, so stringing them together would fake a build order that never existed.
 */
export function playerRunsFrom(
  pool: readonly BoardSnapshot[] = OPPONENT_POOL,
  minWaves = MIN_WAVES,
  /** The SET the asking run is pinned to. Boards from another set are excluded outright — their minions are
   *  that set's cards, so seating one would field set-1 bodies against a set-2 board. Filtered HERE rather than
   *  at registration for the same reason `nextOpponent` does it: the registry is shared across every run in the
   *  session, and two runs on different sets must both find their own boards. Absent = no filter, which is what
   *  the tools and tests that predate sets expect. */
  setId?: SetId,
): PlayerRun[] {
  const byRun = new Map<string, BoardSnapshot[]>();
  for (const s of pool) {
    if ((s.origin ?? 'house') === 'synthetic') continue;
    if (!s.minions?.length) continue;
    if (setId && (s.setId ?? 'set1') !== setId) continue; // legacy boards predate sets → they are set 1
    const key = `${s.author ?? 'anon'}|${s.heroId}|${s.seed}`;
    const list = byRun.get(key);
    if (list) list.push(s);
    else byRun.set(key, [s]);
  }
  const runs: PlayerRun[] = [];
  for (const [key, snaps] of byRun) {
    // One board per wave — a run replayed twice, or re-uploaded, can carry duplicates.
    const byWave = new Map<number, BoardSnapshot>();
    for (const s of snaps) if (!byWave.has(s.wave)) byWave.set(s.wave, s);
    const ordered = [...byWave.values()].sort((a, b) => a.wave - b.wave);
    if (ordered.length < minWaves) continue;
    runs.push({ key, author: ordered[0]!.author ?? 'anon', heroId: ordered[0]!.heroId, snaps: ordered });
  }
  // Deterministic order — the pool's iteration order is an accident of registration, and seat selection must
  // reproduce across sessions and replays.
  return runs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Look one up by key. Returns null when the pool of this session doesn't contain that run. */
export const playerRunByKey = (key: string, pool: readonly BoardSnapshot[] = OPPONENT_POOL, setId?: SetId): PlayerRun | null =>
  playerRunsFrom(pool, MIN_WAVES, setId).find((r) => r.key === key) ?? null;

/**
 * A seat driven by a real player's run: their actual boards while the recording lasts, then a live bot.
 *
 * Same hand-off rule the generated hybrid seat uses (owner call 2026-07-29) and for the same reason — a
 * recording is finite and a lobby has no fixed length, so freezing on a stale board or vacating the seat both
 * distort the game. The bot picks up seeded from the run's own identity so the continuation has the shape of
 * the run it follows rather than dropping an unrelated board into the seat mid-lobby.
 */
export function snapshotSeat(run: PlayerRun, policy: SeatPolicy = 'hard'): SeatDriver & { readonly lastRecordedWave: number } {
  const label = run.author && run.author !== 'anon' ? run.author : `run ${run.key.slice(-4)}`;
  const recorded = recordedSeat(label, run.snaps);
  // Seed the continuation from the run key so it is stable across sessions without depending on the snapshot's
  // own seed (which belongs to a different run's RNG stream).
  let h = 2166136261 >>> 0;
  for (let i = 0; i < run.key.length; i++) { h ^= run.key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const live = botSeat(h % 100_000, run.heroId, label, policy);
  const lastRecordedWave = recorded.lastWave;
  return {
    kind: 'recorded',
    label,
    heroId: run.heroId,
    lastRecordedWave,
    prepare: (round) => (round <= lastRecordedWave ? recorded.prepare(round) : live.prepare(round)),
    finalBoard: (): PreparedBoard | null => live.finalBoard?.() ?? recorded.finalBoard?.() ?? null,
    settle: (o) => {
      // The recording can't react, but the bot that inherits the seat must — so the health sync always runs.
      live.settle(o);
    },
  };
}
