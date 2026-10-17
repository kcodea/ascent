/**
 * THE RANK A GAME WAS PLAYED AT (owner 2026-10-17, R-GAME-RANK-01: "i want to show the rank that the game was in in
 * this page, so it should say Plat 3 or w/e"). Every finished RATED game in the shared game views (Recent Games, the
 * Career's Match History) shows the medal division its player held when it was played: the small crest plus
 * "Platinum III" in the selected game's header, and a mini crest plus "Plat III" in its list row.
 *
 * WHERE IT COMES FROM. Nothing is derived from a bare rating (100 x division + points is ambiguous at the gate:
 * Gold I at 100 and Gold II at 0 are the same number), only from a stored division:
 *   • a CAREER row (`run_history`): `entry.rank.before`, the position `settle_rank` settled the game FROM, stamped onto
 *     the row by the server in the same update as `ratingAfter` (every rated game since medals, 2026-09-20);
 *   • a RECENT GAMES row (`run_telemetry`, every player): `derived.rankAtStart`, the rank pinned on the run when the
 *     rated lobby started (R-TELEMETRY-RANK-01, uploads from 2026-10-06).
 * A row without one (older games, a stamp that missed, Practice, Versus, an unrated all-generated table) shows NO
 * rank: never a guessed one.
 */
import { RANK_MEDALS, rankLabel, rankTopDivision, type RankMedal } from './rank/types';

/** A stored division index (0 = Bronze I ... 17 = Ascendant III), or null for anything else. */
export function divisionIndexOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= rankTopDivision() ? n : null;
}

/** The division a CAREER row was played at: its settled `rank.before` (the whole `entry.rank` or just its `before`).
 *  Null when the row is not a rated lobby game (`mode` other than `lobby`) or carries no stamp. */
export function careerGameRankOf(before: unknown, mode?: string | null): number | null {
  if (mode != null && mode !== 'lobby') return null; // Practice / Versus / tutorial rows never carry a rank
  if (!before || typeof before !== 'object') return null;
  return divisionIndexOf((before as { divisionIndex?: unknown }).divisionIndex);
}

/** The division a RECENT GAMES row was played at: its telemetry `rankAtStart.divisionIndex`. A medal-only stamp (a
 *  run resumed from a pre-2026-10-06 save) carries no division, so it shows nothing rather than a guessed numeral. */
export function telemetryGameRankOf(rankAtStart: unknown): number | null {
  if (!rankAtStart || typeof rankAtStart !== 'object') return null;
  return divisionIndexOf((rankAtStart as { divisionIndex?: unknown }).divisionIndex);
}

const SHORT_MEDAL: Record<RankMedal, string> = {
  Bronze: 'Bronze', Silver: 'Silver', Gold: 'Gold', Platinum: 'Plat', Diamond: 'Dia', Ascendant: 'Asc',
};

/** "Plat III": the list row's compact label (the long medal names shortened, the numeral kept). */
export function shortRankLabel(divisionIndex: number): string {
  const full = rankLabel(divisionIndex);
  const medal = RANK_MEDALS.find((m) => full.startsWith(m));
  return medal ? `${SHORT_MEDAL[medal]}${full.slice(medal.length)}` : full;
}
