/**
 * RANK AT GAME START (owner 2026-10-06, R-TELEMETRY-RANK-01): the player's medal, division and rating when a RATED
 * lobby started, pinned on the run and stamped into its `run_telemetry.derived` at upload.
 *
 * Why: the owner's target is that newcomers (Bronze) place top 4 about 40% of the time, and nothing readable for
 * analysis recorded the rank a game was played at (`run_history.entry.rank` holds it, but that table is
 * authenticated-read only). With this, `npm run newcomer:rate` reads the real Bronze top-4 rate straight off the
 * public telemetry.
 *
 * Pinned by the UI where a rated lobby is minted (`goldClock.ts pinMedalAtStart`, beside `RunState.medalAtStart`),
 * so it survives Save & Quit and cloud resume (it is plain JSON on the run) and never moves with a rank change
 * mid-game. Absent on Practice, the tutorial, a Gauntlet stage, a sandbox and an unrated all-generated table.
 * Presentation / telemetry only: nothing in the sim or matchmaking reads it.
 */
import type { RunState } from './state';
import { RANK_MEDALS, medalOf, rankLabel, rankScalar, type RankMedal, type RankedProfile } from './rank';
import { lobbyIsUnrated } from './lobby/runLobby';

/** The rank a rated game started at. Only `medal` is guaranteed: a run resumed from a save that predates this
 *  field but carries `medalAtStart` stamps the medal alone (see `rankAtStartForTelemetry`). */
export interface RankAtStart {
  v: 1;
  medal: RankMedal;
  /** 0 (Bronze I) … 17 (Ascendant III). */
  divisionIndex?: number;
  /** "Bronze II" (`rankLabel`). */
  division?: string;
  /** Points inside the division (0 … 100, uncapped only at the top). */
  points?: number;
  /** The reporting scalar `100 × divisionIndex + points` (`rankScalar`, the same number `profile.rating` holds). */
  rating?: number;
  /** The ladder season the position belongs to. */
  seasonId?: number;
}

/** The snapshot of a ranked profile, as pinned on a run. */
export function rankAtStartOf(rank: Pick<RankedProfile, 'position'> & Partial<Pick<RankedProfile, 'seasonId'>>): RankAtStart {
  const { position } = rank;
  return {
    v: 1,
    medal: medalOf(position.divisionIndex),
    divisionIndex: position.divisionIndex,
    division: rankLabel(position),
    points: position.points,
    rating: rankScalar(position),
    ...(typeof rank.seasonId === 'number' ? { seasonId: rank.seasonId } : {}),
  };
}

const isMedal = (v: unknown): v is RankMedal => typeof v === 'string' && (RANK_MEDALS as readonly string[]).includes(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Read a stored `rankAtStart` back (a telemetry row's `derived->rankAtStart`). Null for an old row without it or a
 *  malformed value: the reader then treats the rank as UNKNOWN, never as any particular medal. */
export function parseRankAtStart(v: unknown): RankAtStart | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isMedal(o.medal)) return null;
  const divisionIndex = num(o.divisionIndex);
  const points = num(o.points);
  const rating = num(o.rating);
  const seasonId = num(o.seasonId);
  return {
    v: 1,
    medal: o.medal,
    ...(divisionIndex !== undefined ? { divisionIndex } : {}),
    ...(typeof o.division === 'string' ? { division: o.division } : {}),
    ...(points !== undefined ? { points } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(seasonId !== undefined ? { seasonId } : {}),
  };
}

/** The rank to stamp on a finished run's telemetry: the pinned snapshot, or (a run resumed from a save written
 *  before the snapshot existed) the pinned medal alone. Undefined for anything that is not a RATED lobby, so the
 *  stamp can never appear on a Practice, tutorial, Gauntlet, sandbox or unrated row even if a pin leaked. */
export function rankAtStartForTelemetry(run: Pick<RunState, 'mode' | 'sandbox' | 'lobby' | 'medalAtStart' | 'rankAtStart'>): RankAtStart | undefined {
  if (run.mode !== 'lobby' || run.sandbox || !run.lobby || lobbyIsUnrated(run.lobby)) return undefined;
  if (run.rankAtStart) return run.rankAtStart;
  return run.medalAtStart ? { v: 1, medal: run.medalAtStart } : undefined;
}
