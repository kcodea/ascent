/**
 * THE NEWCOMER TOP-4 RATE (owner 2026-10-06, R-TELEMETRY-RANK-01): of the RATED lobby games started in BRONZE, how
 * often did the player finish top 4? The owner's target is about 40%.
 *
 * Pure over the rows `npm run newcomer:rate` fetches from `run_telemetry` (anon GETs, cli.ts). A row counts when:
 *  · it is a RATED lobby game: not an unauthenticated upload (`unrated` column), a ladder row (`source = 'ladder'`, or
 *    an unstamped row whose offer carries `mode:lobby`), not an all-generated / unrated table (`derived.lobbyPool`),
 *    with a placement 1-8;
 *  · it was not played by a developer: the author (its handle, before any `#tag`) is in `DEVELOPER_AUTHORS`, or the
 *    row's account key appears on any row such an author uploaded (the same account under another handle);
 *  · its rank at game start is Bronze. STAMPED rows (`derived.rankAtStart`, uploads from 2026-10-06) say so exactly.
 *    Older rows are APPROXIMATED from the matchmaking band they asked for: Bronze's band in the row's band table
 *    (`B0-30` / `B0-20/e100`), or `0-30` / `0-20` when the row carries no table. Rows with neither are UNKNOWN and
 *    are only counted, never guessed.
 * Results are split by the row's matchmaking regime (`resolveRegime`: stamped, or inferred from the build or date).
 */
import { RANK_MEDALS, resolveRegime, wilson, parseRankAtStart, type RankMedal, type LobbyPoolTelemetry, type RunRegime } from '@game/sim';

/** The developers' handles (owner 2026-10-06: "developers excluded"). Matched case-insensitively on the handle
 *  before any `#tag`, and widened to every account key those handles uploaded under. */
export const DEVELOPER_AUTHORS: readonly string[] = Object.freeze(['LazerLemon', 'Orangez']);

/** The owner's newcomer target (top-4 rate in Bronze). */
export const NEWCOMER_TOP4_TARGET = 0.4;

/** Band labels that read as Bronze on a row with no band table (the owner's approximation). */
export const BRONZE_FALLBACK_BANDS: readonly string[] = Object.freeze(['0-30', '0-20']);

/** One fetched `run_telemetry` row: flat columns plus three small JSON paths out of `derived`. */
export interface NewcomerRow {
  id: number;
  created_at: string | null;
  author: string | null;
  player_key: string | null;
  unrated: boolean | null;
  placement: number | null;
  source: string | null;
  hero_offer: string[] | null;
  patch: string | null;
  /** `derived->rankAtStart` */
  rank: unknown;
  /** `derived->regime` */
  regime: unknown;
  /** `derived->lobbyPool` */
  pool: unknown;
}

export type RankBasis = 'stamped' | 'approximate' | 'unknown';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const handleOf = (author: string | null): string => (author ?? '').split('#')[0]!.trim().toLowerCase();

/** A rated lobby game (see the file header). */
export function isRatedLobbyRow(r: NewcomerRow): boolean {
  if (r.unrated === true) return false;
  const lobby = r.source === 'ladder' || (r.source == null && (r.hero_offer ?? []).includes('mode:lobby'));
  if (!lobby) return false;
  if (isObj(r.pool) && (r.pool.allGenerated === true || r.pool.unrated === true)) return false;
  return typeof r.placement === 'number' && Number.isInteger(r.placement) && r.placement >= 1 && r.placement <= 8;
}

/** The account keys and handles to exclude: every row whose handle is a developer's, plus every row sharing an
 *  account key with one. */
export function developerFilter(rows: readonly NewcomerRow[], developers: readonly string[] = DEVELOPER_AUTHORS): (r: NewcomerRow) => 'name' | 'account' | null {
  const devHandles = new Set(developers.map((d) => d.toLowerCase()));
  const devKeys = new Set<string>();
  for (const r of rows) if (devHandles.has(handleOf(r.author)) && r.player_key) devKeys.add(r.player_key);
  return (r) => (devHandles.has(handleOf(r.author)) ? 'name' : r.player_key && devKeys.has(r.player_key) ? 'account' : null);
}

/** Bronze's band in a band-table version string (`B0-30 S10-40 ...` → `0-30`, `B0-20/e100 ...` → `0-20`). */
export function bronzeBandOf(bandsVersion: string | null | undefined): string | null {
  const tok = (bandsVersion ?? '').split(/\s+/).find((t) => t.startsWith('B'));
  if (!tok) return null;
  const band = tok.slice(1).split('/')[0]!;
  return /^\d+-\d+$/.test(band) ? band : null;
}

/** The row's medal at game start and how it is known. */
export function medalAtStartOf(r: NewcomerRow): { medal: RankMedal | null; basis: RankBasis } {
  const stamped = parseRankAtStart(r.rank);
  if (stamped) return { medal: stamped.medal, basis: 'stamped' };
  const regime = isObj(r.regime) ? (r.regime as unknown as RunRegime) : null;
  const pool = isObj(r.pool) ? (r.pool as unknown as LobbyPoolTelemetry) : null;
  const band = regime?.band ?? pool?.strengthBand ?? null;
  if (!band) return { medal: null, basis: 'unknown' };
  const bronze = bronzeBandOf(regime?.bandsVersion);
  const isBronze = bronze ? band === bronze : BRONZE_FALLBACK_BANDS.includes(band);
  // A band that is not Bronze's is some other medal; which one is not needed here, and is not guessed.
  return isBronze ? { medal: 'Bronze', basis: 'approximate' } : { medal: null, basis: 'approximate' };
}

export interface RateCell {
  games: number;
  top4: number;
  rate: number | null;
  ci: { lo: number; hi: number } | null;
  players: number;
}

export interface RegimeRates { regime: string; basis: string; stamped: RateCell; approximate: RateCell; combined: RateCell }

export interface NewcomerReport {
  fetched: number;
  rated: number;
  excludedDeveloper: { byName: number; byAccount: number };
  /** Rated, non-developer rows by how their rank is known. */
  rankKnown: { stamped: number; approximate: number; unknown: number };
  /** Stamped non-developer rated rows by medal at start. */
  stampedByMedal: Partial<Record<RankMedal, number>>;
  regimes: RegimeRates[];
  overall: { stamped: RateCell; approximate: RateCell; combined: RateCell };
}

function cell(rows: readonly NewcomerRow[]): RateCell {
  const top4 = rows.filter((r) => (r.placement ?? 9) <= 4).length;
  const players = new Set(rows.map((r) => r.player_key ?? `name:${handleOf(r.author)}`)).size;
  return { games: rows.length, top4, rate: rows.length ? top4 / rows.length : null, ci: wilson(top4, rows.length), players };
}

export function newcomerRate(rows: readonly NewcomerRow[], opts: { developers?: readonly string[] } = {}): NewcomerReport {
  const dev = developerFilter(rows, opts.developers ?? DEVELOPER_AUTHORS);
  const rated = rows.filter(isRatedLobbyRow);
  const excludedDeveloper = { byName: 0, byAccount: 0 };
  const rankKnown = { stamped: 0, approximate: 0, unknown: 0 };
  const stampedByMedal: Partial<Record<RankMedal, number>> = {};
  const bronze: { row: NewcomerRow; basis: 'stamped' | 'approximate'; regime: string; regimeBasis: string }[] = [];
  for (const r of rated) {
    const why = dev(r);
    if (why === 'name') { excludedDeveloper.byName++; continue; }
    if (why === 'account') { excludedDeveloper.byAccount++; continue; }
    const { medal, basis } = medalAtStartOf(r);
    rankKnown[basis]++;
    if (basis === 'stamped' && medal) stampedByMedal[medal] = (stampedByMedal[medal] ?? 0) + 1;
    if (medal !== 'Bronze' || basis === 'unknown') continue;
    const reg = resolveRegime({
      regime: isObj(r.regime) ? (r.regime as unknown as RunRegime) : undefined,
      lobbyPool: isObj(r.pool) ? (r.pool as unknown as LobbyPoolTelemetry) : undefined,
      patch: r.patch, createdAt: r.created_at,
    });
    bronze.push({ row: r, basis, regime: reg.key, regimeBasis: reg.basis });
  }
  const keys = [...new Set(bronze.map((b) => b.regime))];
  const regimes = keys.map((regime) => {
    const inR = bronze.filter((b) => b.regime === regime);
    const bases = [...new Set(inR.map((b) => b.regimeBasis))].sort().join(' + ');
    return {
      regime, basis: bases,
      stamped: cell(inR.filter((b) => b.basis === 'stamped').map((b) => b.row)),
      approximate: cell(inR.filter((b) => b.basis === 'approximate').map((b) => b.row)),
      combined: cell(inR.map((b) => b.row)),
    };
  }).sort((a, b) => b.combined.games - a.combined.games);
  const ordered: Partial<Record<RankMedal, number>> = {};
  for (const m of RANK_MEDALS) if (stampedByMedal[m]) ordered[m] = stampedByMedal[m];
  return {
    fetched: rows.length, rated: rated.length, excludedDeveloper, rankKnown, stampedByMedal: ordered, regimes,
    overall: {
      stamped: cell(bronze.filter((b) => b.basis === 'stamped').map((b) => b.row)),
      approximate: cell(bronze.filter((b) => b.basis === 'approximate').map((b) => b.row)),
      combined: cell(bronze.map((b) => b.row)),
    },
  };
}

const pct = (x: number | null): string => (x == null ? '  n/a' : `${(x * 100).toFixed(1)}%`);
function line(label: string, c: RateCell): string {
  if (!c.games) return `  ${label.padEnd(24)} no games`;
  const ci = c.ci ? `95% CI ${pct(c.ci.lo)} to ${pct(c.ci.hi)}` : '';
  return `  ${label.padEnd(24)} top-4 ${pct(c.rate).padStart(6)}  (${c.top4}/${c.games} games, ${c.players} player${c.players === 1 ? '' : 's'})  ${ci}`;
}

/** The printed report. */
export function formatNewcomerRate(rep: NewcomerReport, developers: readonly string[] = DEVELOPER_AUTHORS): string[] {
  const out: string[] = [];
  out.push(`NEWCOMER (BRONZE) TOP-4 RATE  ·  target ${pct(NEWCOMER_TOP4_TARGET)}`);
  out.push(`rows fetched ${rep.fetched}  ·  rated lobby games ${rep.rated}  ·  developer games excluded ${rep.excludedDeveloper.byName + rep.excludedDeveloper.byAccount} (${rep.excludedDeveloper.byName} by handle, ${rep.excludedDeveloper.byAccount} by shared account; developers: ${developers.join(', ')})`);
  out.push(`rank at start, rated non-developer games: stamped ${rep.rankKnown.stamped}, approximated from the band ${rep.rankKnown.approximate}, unknown (not counted) ${rep.rankKnown.unknown}`);
  const medals = Object.entries(rep.stampedByMedal).map(([m, n]) => `${m} ${n}`).join(', ');
  if (medals) out.push(`stamped games by medal at start: ${medals}`);
  out.push('');
  out.push('OVERALL (Bronze at game start)');
  out.push(line('stamped (exact)', rep.overall.stamped));
  out.push(line('approximate (band)', rep.overall.approximate));
  out.push(line('combined', rep.overall.combined));
  for (const r of rep.regimes) {
    out.push('');
    out.push(`REGIME: ${r.regime}  [${r.basis}]`);
    out.push(line('stamped (exact)', r.stamped));
    out.push(line('approximate (band)', r.approximate));
    out.push(line('combined', r.combined));
  }
  out.push('');
  out.push('"approximate" = an older row with no rank stamp, read as Bronze because it asked for Bronze\'s matchmaking band (0-30 / 0-20).');
  return out;
}
