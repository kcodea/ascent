import type { SetId } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponentRuns } from '../opponents';
import { builtRecording, primeRecording } from './seats';
import { playerRunsFrom, runKeyOf } from './snapshotSeats';
import type { RunLobby } from './runLobby';

/**
 * A SAVED GAME CARRIES ITS OPPONENTS (R-LOBBY-SERVE-01, owner 2026-10-17: "we need the game serving integrity to be
 * literally perfect").
 *
 * A lobby seat stores only how to FIND its boards: a recorded seat its run key, a generated seat its seed and hero.
 * Both used to be re-found on resume: the run key against the session's pool (a fresh random sample of whole runs, so
 * a seated run was often not in it, and the seat silently became a generated stand-in under the real player's name),
 * the generated seat by replaying its recording with whatever code the client now runs (a deploy changed its boards
 * mid-game). Measured on the live pool: a resume whose sample missed `Orangez|drakko|932453328` served
 * `k_beggy, d2_cinderchef, dm_leech` in round 3 where the real run fielded `dw_orin 2/2, dw_brunni 3/2`.
 *
 * So every lobby save stores the boards themselves: each recorded seat's whole run, and each generated seat's
 * recording once it has been built. A resume restores them BEFORE any seat driver is built. Plain JSON.
 */
export interface LobbySeatRecordings {
  v: 1;
  /** Each recorded (`snapshot`) seat's whole run, as the pool delivered it. */
  runs: BoardSnapshot[][];
  /** Each generated seat's recording, keyed the way the recording cache keys it. */
  // `setId` only on a seat stamped with a card set (Practice's DEV set picker, 2026-10-26); absent everywhere else.
  hybrids: { seed: number; heroId: string; snaps: BoardSnapshot[]; setId?: SetId }[];
}

/**
 * The recordings behind a lobby's seats, as this session holds them now. A recorded seat whose run this session
 * cannot resolve is simply absent from `runs` (it is a stand-in: `lobbyStandIns`); a generated seat whose recording has
 * not been built yet is absent too, and is picked up by a later save (the opening shop phase warms every seat).
 */
export function lobbySeatRecordings(lobby: Pick<RunLobby, 'seats' | 'setId'>): LobbySeatRecordings {
  const runs = lobbySeatRuns(lobby);
  return { v: 1, runs, hybrids: lobbyHybridRecordings(lobby, new Set(runs.map(runKeyOfRun))) };
}

/** The whole run behind each recorded seat that this session's pool holds (one pass over the pool). */
export function lobbySeatRuns(lobby: Pick<RunLobby, 'seats' | 'setId'>): BoardSnapshot[][] {
  const keys = new Set(lobby.seats.filter((s) => s.kind === 'snapshot' && s.runKey).map((s) => s.runKey!));
  return keys.size ? playerRunsFrom(undefined, undefined, lobby.setId).filter((r) => keys.has(r.key)).map((r) => r.snaps) : [];
}

/** Each generated seat's BUILT recording (no pool pass): a `hybrid` seat, or a recorded seat whose run is not in
 *  `heldRunKeys` (its stand-in is a generated recording, and pinning it keeps the seat consistent with what it
 *  already fielded). */
export function lobbyHybridRecordings(lobby: Pick<RunLobby, 'seats'>, heldRunKeys: ReadonlySet<string>): LobbySeatRecordings['hybrids'] {
  const out: LobbySeatRecordings['hybrids'] = [];
  for (const s of lobby.seats) {
    if (s.kind !== 'hybrid' && !(s.kind === 'snapshot' && !(s.runKey && heldRunKeys.has(s.runKey)))) continue;
    const snaps = builtRecording(s.seed, s.heroId, s.setId);
    if (snaps?.length) out.push({ seed: s.seed, heroId: s.heroId, snaps, ...(s.setId ? { setId: s.setId } : {}) });
  }
  return out;
}

/** A stored run's key (`author|heroId|seed`, as `runKeyOf` in snapshotSeats), read off its first board. */
export const runKeyOfRun = (run: readonly BoardSnapshot[]): string => (run[0] ? runKeyOf(run[0]) : '');

/** Parse a stored bundle (untrusted JSON). The pre-2026-10-17 shape was a bare `BoardSnapshot[][]` of runs. */
export function parseLobbySeatRecordings(raw: unknown): LobbySeatRecordings | null {
  if (Array.isArray(raw)) return { v: 1, runs: raw.filter(Array.isArray) as BoardSnapshot[][], hybrids: [] };
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<LobbySeatRecordings>;
  const runs = Array.isArray(o.runs) ? o.runs.filter(Array.isArray) : [];
  const hybrids = Array.isArray(o.hybrids)
    ? o.hybrids.filter((h) => !!h && typeof h.seed === 'number' && typeof h.heroId === 'string' && Array.isArray(h.snaps))
    : [];
  return { v: 1, runs, hybrids };
}

/**
 * Put a saved game's seat recordings back, BEFORE its seat drivers are built: the runs into the opponent pool (where
 * every reader of a seat, the driver, the fight ledger and the scout card, resolves its run key), the generated
 * recordings into the recording cache. Returns how many of each were restored. Idempotent.
 */
export function restoreLobbySeatRecordings(rec: LobbySeatRecordings | null | undefined): { runs: number; hybrids: number } {
  if (!rec) return { runs: 0, hybrids: 0 };
  const reg = rec.runs.length ? registerOpponentRuns(rec.runs) : { runs: 0 };
  for (const h of rec.hybrids) primeRecording(h.seed, h.heroId, h.snaps, h.setId);
  return { runs: reg.runs, hybrids: rec.hybrids.length };
}
