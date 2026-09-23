/**
 * LEADERBOARD / HALL / RECENT GAMES — the pure half of the three ladder pages (owner polish 2026-09-20): every
 * label the banners and the ranked table print, kept synchronous and client-free so it is testable without a
 * backend. The pages themselves (`Rankings.tsx`, `Leaderboard.tsx`, `RecentGames.tsx`) only lay these out.
 *
 * NOTE — `outcomeOf` / `runLengthText` / `playedOnText` / `ordinalOf` are deliberately DUPLICATED from the
 * Career page's `careerData.ts` (branch `feat/career-page-v2`, in flight at the same time): that file did not
 * exist on `main` when this shipped, and the two branches must merge without touching each other's files.
 * Once both are in, fold these into ONE module (careerData's copies are the canonical ones) and delete these.
 */

/** 1st / 2nd / 3rd / 4th … (11th–13th handled). */
export function ordinalOf(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** The outcome block's headline: 1st reads VICTORY (green); any other placement reads as its ordinal ("4TH"),
 *  top-4 in the neutral cream, 5th–8th in red; no placement at all reads "—" (a pre-lobby row). */
export function outcomeOf(placement: number | null): { label: string; cls: 'won' | 'top4' | 'lost' | 'none' } {
  if (placement === null || !(placement > 0)) return { label: '—', cls: 'none' };
  if (placement === 1) return { label: 'VICTORY', cls: 'won' };
  return { label: ordinalOf(placement).toUpperCase(), cls: placement <= 4 ? 'top4' : 'lost' };
}

/** "36 min" for the outcome block; "<1 min" under a minute; "—" when unknown. */
export function runLengthText(durationMs: number | null): string {
  if (durationMs === null || durationMs < 0) return '—';
  const mins = Math.round(durationMs / 60_000);
  return mins < 1 ? '<1 min' : `${mins} min`;
}

/** "Sep 19, 2026" — the date a run was played; '' when unknown. */
export function playedOnText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Sep 19, 3:42 PM" — the date AND time, for a feed where several games share a day; '' when unknown. */
export function playedAtText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A W–L–D record → the per-round string a leaderboard row prints ("9–4", or "9–4–1" only when a draw
 *  happened, so the common case stays two numbers). */
export function recordText(rec: { wins: number; losses: number; draws?: number } | null): string {
  if (!rec) return '—';
  const d = rec.draws ?? 0;
  return d > 0 ? `${rec.wins}–${rec.losses}–${d}` : `${rec.wins}–${rec.losses}`;
}

/** The key a recorded run is served under — `author|heroId|seed`, exactly as `playerRunsFrom` groups the pool
 *  (packages/sim/src/lobby/snapshotSeats.ts) and as the fight ledger names a seat. Built from a run's own stored
 *  board / history entry; `fallbackAuthor` is used only when the board carries no author of its own (both are
 *  stamped from the same name at run end, so they agree whenever both exist). Null for a board that predates
 *  seeds. The REPORTER's own key at run end is built the same way from their run. */
export function hallRunKeyOf(board: { author?: string; heroId: string; seed?: number } | null | undefined, fallbackAuthor?: string): string | null {
  if (!board || typeof board.seed !== 'number' || !Number.isFinite(board.seed)) return null;
  return `${board.author ?? fallbackAuthor ?? 'anon'}|${board.heroId}|${board.seed}`;
}

/** A run key parsed back into its parts — FROM THE RIGHT, because an author name is unsanitized and may itself
 *  contain a `|`: the seed is the last segment, the hero the second-last, the author everything before. Null
 *  for a bot key or anything without a numeric seed. */
export function parseRunKey(key: string): { author: string; heroId: string; seed: number } | null {
  if (!key || key.startsWith('bot:')) return null;
  const parts = key.split('|');
  if (parts.length < 3) return null;
  const seed = Number(parts[parts.length - 1]);
  const heroId = parts[parts.length - 2]!;
  if (!Number.isFinite(seed) || !heroId) return null;
  return { author: parts.slice(0, -2).join('|'), heroId, seed };
}

/** A run's aggregate across every fight it has been in (the `run_fight_records` view's shape, minus the key). */
export interface HallFightRecord {
  fights: number;
  wins: number;
  losses: number;
  draws: number;
  lobbies: number;
  winRate: number;
  wilsonLb: number;
  lastFightAt: string | null;
}

/** "81%" — a run's raw win rate across everything (wins / fights; a draw is not a win). */
export function winRateText(rec: Pick<HallFightRecord, 'wins' | 'fights'>): string {
  return rec.fights > 0 ? `${Math.round((100 * rec.wins) / rec.fights)}%` : '—';
}

/** One Hall row, assembled (owner 2026-09-22: "what board has been the best against everything else … what the
 *  top 10 are in that category"). */
export interface HallRow {
  key: string;
  author: string;
  heroId: string;
  seed: number;
  /** The record across EVERY fight: the W–L–D, the win rate, the lobbies. */
  record: HallFightRecord;
  /** The run's OWN game ("12–3" — what its player saw; it counts their ghost fights, which the ledger does not). */
  ownRecord: { wins: number; losses: number; draws: number } | null;
  ownPlacement: number | null;
  /** The rank its player held when the game was played. */
  rank: { divisionIndex: number; points: number } | null;
  board: { minions: unknown[]; runes?: string[] } | null;
}

export type HallSort = 'rate' | 'recent';

/** The career facts a Hall row joins: the run's own game, as its player saw it. `author` is the display name
 *  the entry was stamped with at run end (2026-09-22) — null on older rows. */
export interface HallOwnFacts<B> {
  author: string | null;
  heroId: string | null;
  rank: { divisionIndex: number; points: number } | null;
  record: { wins: number; losses: number; draws: number } | null;
  placement: number | null;
  board: B | null;
}

/** The key a career row is filed under for the Hall join. A row stamped with its author (every row since
 *  2026-09-22) files under its FULL run key — `author|heroId|seed`, the same string the fight ledger and the
 *  pool group the run by — so two players who play the same shared seed with the same hero never cross-wire
 *  (review fix 2026-09-22). An older row with no author files under `seed:<seed>` and is joined by seed + hero. */
export function hallHistoryKeyOf(author: string | null | undefined, heroId: string | null | undefined, seed: number): string {
  return typeof author === 'string' && typeof heroId === 'string' ? `${author}|${heroId}|${seed}` : `seed:${seed}`;
}

/** The career row for a Hall candidate: by its full run key first, else the legacy seed-keyed row when its hero
 *  agrees (or is unknown). Undefined when the run has no career row. */
export function hallHistoryFor<F extends { heroId: string | null }>(history: ReadonlyMap<string, F>, runKey: string): F | undefined {
  const exact = history.get(runKey);
  if (exact) return exact;
  const parsed = parseRunKey(runKey);
  if (!parsed) return undefined;
  const legacy = history.get(hallHistoryKeyOf(null, null, parsed.seed));
  return legacy && (legacy.heroId === null || legacy.heroId === parsed.heroId) ? legacy : undefined;
}

/** Assemble and order the Hall from the view rows + the per-run career facts + any pool boards fetched for
 *  runs without a career row. Pure. Candidates below `minFights` are dropped (the fetch already filters; this
 *  is the same rule stated once more where the rows are built), bot keys and unparseable keys are dropped, and
 *  the list is cut to `limit`. 'rate' (the default) orders by the Wilson lower bound of the win rate, then more
 *  fights, then the most recent fight; 'recent' by the most recent fight. */
export function hallRowsOf<B extends { minions: unknown[]; runes?: string[] }>(
  records: ReadonlyArray<{ runKey: string } & HallFightRecord>,
  history: ReadonlyMap<string, HallOwnFacts<B>>,
  boards: ReadonlyMap<string, B>,
  opts: { minFights: number; limit: number; sort: HallSort },
): HallRow[] {
  const rows: HallRow[] = [];
  for (const r of records) {
    if (r.fights < opts.minFights) continue;
    const parsed = parseRunKey(r.runKey);
    if (!parsed) continue;
    const own = hallHistoryFor(history, r.runKey);
    const record: HallFightRecord = { fights: r.fights, wins: r.wins, losses: r.losses, draws: r.draws, lobbies: r.lobbies, winRate: r.winRate, wilsonLb: r.wilsonLb, lastFightAt: r.lastFightAt };
    rows.push({
      key: r.runKey, author: parsed.author, heroId: parsed.heroId, seed: parsed.seed,
      record,
      ownRecord: own?.record ?? null,
      ownPlacement: own?.placement ?? null,
      rank: own?.rank ?? null,
      board: own?.board ?? boards.get(r.runKey) ?? null,
    });
  }
  const at = (x: HallRow): number => (x.record.lastFightAt ? Date.parse(x.record.lastFightAt) || 0 : 0);
  rows.sort(opts.sort === 'recent'
    ? (a, b) => at(b) - at(a) || b.record.wilsonLb - a.record.wilsonLb
    : (a, b) => b.record.wilsonLb - a.record.wilsonLb || b.record.fights - a.record.fights || at(b) - at(a));
  return rows.slice(0, opts.limit);
}

/** The W–L–D record folded out of a Hall row's per-round spread ("LLWLWWW…", one char per round: W/L/D).
 *  Null for a row logged before the `history` column existed. */
export function recordOfHistory(history: string | undefined | null): { wins: number; losses: number; draws: number } | null {
  if (!history) return null;
  let wins = 0, losses = 0, draws = 0;
  for (const c of history) {
    if (c === 'W') wins++;
    else if (c === 'L') losses++;
    else if (c === 'D') draws++;
  }
  return { wins, losses, draws };
}

/** The ranked-table medallion tier of a 1-based rank: gold / silver / bronze for the podium, plain beyond. */
export function medalOf(rank: number): 'gold' | 'silver' | 'bronze' | 'plain' {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'plain';
}

/** The "Partial recording" caption for a replay that doesn't start at round 1. */
export function partialText(firstRecordedWave: number | null): string {
  return firstRecordedWave !== null && firstRecordedWave > 1 ? `Partial recording · from round ${firstRecordedWave}` : 'Partial recording';
}
