/**
 * Remote board sync — the live shared opponent pool (async-PvP step 5), behind a Supabase Postgres table.
 * Mirrors `boardLibrary.ts` but over the network instead of localStorage: finished-run boards POST here
 * (fire-and-forget) and a curated, patch-matched pool is fetched ONCE at startup and registered into the
 * static opponent pool. This kills the manual Export → `docs/board-exports/` → `npm run pool` round-trip for
 * the live game — you and a friend automatically pool each other's boards.
 *
 * No-ops gracefully when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset (no project configured) — so
 * the build, the headless tests, and offline play are all unaffected. The committed `OPPONENT_POOL_DATA` stays
 * the offline FLOOR; this is purely additive fresh boards on top.
 *
 * Determinism: like the committed pool, the remote pool is fetched once at boot and kept static for the session
 * (`registerOpponents` is never called mid-run), so replays stay faithful within a session. Daily/shareable
 * seeds should still pin to the committed pool only (see docs/board-pool.md).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { registerOpponents, type BoardSnapshot, type RunTelemetry } from '@game/sim';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = 'boards';
const FETCH_LIMIT = 2000; // cap the startup pull (curate server-side later if the table grows large)
const FETCH_TIMEOUT_MS = 4000; // never block boot on a slow / absent network

/** True when a backend is configured (both env vars present). */
export const remoteEnabled = (): boolean => !!(SUPABASE_URL && SUPABASE_KEY);

let cachedClient: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (cachedClient === undefined) {
    cachedClient =
      SUPABASE_URL && SUPABASE_KEY
        ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
        : null;
  }
  return cachedClient;
}

/** A DB row: the full `BoardSnapshot` lives in the `snapshot` jsonb column; the rest are denormalized so the
 *  dashboard can index / sort / patch-prune (`delete from boards where patch <> '…'`). */
const toRow = (b: BoardSnapshot) => ({
  patch: b.patch ?? 'unknown',
  wave: b.wave,
  hero_id: b.heroId,
  power: b.power,
  rating: b.rating ?? null,
  origin: b.origin ?? 'self',
  author: b.author ?? null,
  tribes: b.tribes ?? [],
  captured_at: b.capturedAt ?? null,
  seed: b.seed ?? null,
  snapshot: b, // the board's fight-ledger id travels inside here (b.id) — no separate column needed
});

/** Upload a finished run's boards. Fire-and-forget — never throws, never blocks the game (offline → skipped). */
export async function uploadBoards(boards: BoardSnapshot[]): Promise<void> {
  const c = client();
  if (!c || boards.length === 0) return;
  try {
    await c.from(TABLE).insert(boards.map(toRow));
  } catch {
    /* best-effort — capture must never disrupt play */
  }
}

/**
 * Fetch the shared pool for the current patch and register it into the static opponent pool. Best-effort +
 * time-boxed; returns how many boards were registered (0 on any failure / no backend). Call ONCE at startup,
 * before any run faces combat. `patchPrefix` matches by build VERSION (e.g. `"0.1.0+"`) so per-commit SHA
 * churn doesn't hide your own boards — boards are keyed `version+sha`, served by `version+%`.
 */
export async function fetchAndRegisterPool(patchPrefix?: string): Promise<number> {
  const c = client();
  if (!c) return 0;
  try {
    let query = c.from(TABLE).select('snapshot');
    if (patchPrefix) query = query.like('patch', `${patchPrefix}%`);
    const request = Promise.resolve(query.order('wave', { ascending: true }).limit(FETCH_LIMIT));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return 0;
    const snaps = (result.data as { snapshot: BoardSnapshot }[])
      .map((r) => r.snapshot)
      .filter((s): s is BoardSnapshot => !!s && Array.isArray(s.minions) && s.minions.length > 0)
      .map((s) => ({ ...s, remote: true as const })); // mark as live-shared-pool so pickOpponent prefers them
    registerOpponents(snaps);
    return snaps.length;
  } catch {
    return 0;
  }
}

// ── Runs / leaderboard (victories) ─────────────────────────────────────────────────────────────
// A completed VICTORY run logs a row in the `runs` table for the leaderboard — the hero/author/wave + the
// final winning warband (shown on hover). Separate from `boards` (which feeds the opponent pool). Same
// no-op-when-unconfigured, fire-and-forget, never-throws contract.

/** One leaderboard entry (a victory run), shaped for the UI. */
export interface VictoryRow {
  heroId: string;
  author?: string;
  wave: number;
  date: string; // YYYY-MM-DD
  board: BoardSnapshot | null; // the final winning warband, for the end-screen-style hover reveal
  /** Per-round result spread — one char per round: 'W' | 'L' | 'D' (e.g. "LLWLWWW…"). The leaderboard renders
   *  it as the round-by-round W/L badges. Undefined for rows logged before the `history` column existed. */
  history?: string;
  /** ISO timestamp the row was created — the "most recent" sort key. */
  createdAt?: string;
  /** The final board's fight-ledger id (`board_id`) — the leaderboard looks up this slot's round-17 win record
   *  by it. Undefined for rows logged before win-tracking shipped (they just show no record). */
  boardId?: string;
}

/** A board's aggregated fight record from the ledger — wins/losses/ties from the BOARD's perspective. */
export interface BoardWinStats {
  wins: number;
  losses: number;
  ties: number;
  fights: number; // wins + losses + ties
  /** Win rate as a whole percent (wins / fights). 0 when it's never been fought. */
  winRate: number;
}

const emptyStats = (): BoardWinStats => ({ wins: 0, losses: 0, ties: 0, fights: 0, winRate: 0 });
function tallyStats(rows: Array<{ board_id: string; outcome: string }>): Map<string, BoardWinStats> {
  const map = new Map<string, BoardWinStats>();
  for (const r of rows) {
    const s = map.get(r.board_id) ?? emptyStats();
    if (r.outcome === 'win') s.wins++;
    else if (r.outcome === 'loss') s.losses++;
    else s.ties++;
    map.set(r.board_id, s);
  }
  for (const s of map.values()) {
    s.fights = s.wins + s.losses + s.ties;
    s.winRate = s.fights > 0 ? Math.round((s.wins / s.fights) * 100) : 0;
  }
  return map;
}

/** Log a completed victory run for the leaderboard. Fire-and-forget; never throws / blocks. */
export async function uploadVictory(v: {
  heroId: string; author?: string; wave: number; wins: number; seed: number;
  board: BoardSnapshot | null; patch: string; capturedAt: string; history?: string;
}): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    await c.from('runs').insert([{
      patch: v.patch, hero_id: v.heroId, author: v.author ?? null, wave: v.wave,
      wins: v.wins, result: 'victory', seed: v.seed, board: v.board, captured_at: v.capturedAt,
      history: v.history ?? null,
      // The leaderboard slot's fight-ledger id lives inside board.id (the jsonb) — no separate column, so this
      // insert stays compatible with a pre-migration `runs` table (only the new board_results table is required).
    }]);
  } catch {
    /* best-effort — leaderboard logging must never disrupt the end screen */
  }
}

/** Fetch the latest `limit` victory runs (newest first) for the leaderboard. Best-effort + time-boxed; [] on
 *  any failure / no backend. */
export async function fetchVictories(limit = 20): Promise<VictoryRow[]> {
  const c = client();
  if (!c) return [];
  try {
    const request = Promise.resolve(
      // `*` (not an explicit column list) keeps the query resilient if `history` hasn't been added to the table
      // yet (a pre-migration project) — a missing column is then simply absent, not a whole-query error.
      c.from('runs').select('*')
        .eq('result', 'victory').order('created_at', { ascending: false }).limit(limit),
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return [];
    return (result.data as Array<{ hero_id: string; author: string | null; wave: number; board: BoardSnapshot | null; history?: string | null; captured_at: string | null; created_at: string | null }>)
      .map((r) => ({
        heroId: r.hero_id,
        author: r.author ?? undefined,
        wave: r.wave,
        date: (r.captured_at ?? r.created_at ?? '').slice(0, 10),
        board: r.board ?? null,
        history: r.history ?? undefined,
        createdAt: r.created_at ?? undefined,
        boardId: r.board?.id ?? undefined, // the fight-ledger id lives inside the board jsonb
      }));
  } catch {
    return [];
  }
}

// ── Run telemetry (player balance report) ───────────────────────────────────────────────────────────────────
// One row per finished Ascent run: what the player was OFFERED + PICKED (heroes, quests, runes, minions) + the
// outcome, reconstructed from the run's replay at run-end. The in-app Balance Report fetches recent rows and
// aggregates them client-side into real offer/pick/win/avg tables. Same fire-and-forget / no-op-when-unconfigured
// / never-throws contract; dormant until the `run_telemetry` table is migrated (see schema.sql).

/** Upload one finished run's telemetry. Fire-and-forget; never throws / blocks. */
export async function uploadRunTelemetry(t: RunTelemetry, meta: { author?: string; patch: string }): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    await c.from('run_telemetry').insert([{
      patch: meta.patch, author: meta.author ?? null,
      hero_id: t.heroId, hero_offer: t.heroOffer, won: t.won, wins: t.wins,
      offered_quests: t.offeredQuests, picked_quests: t.pickedQuests, quest_turns: t.questTurns,
      offered_runes: t.offeredRunes, picked_runes: t.pickedRunes,
      offered_cards: t.offeredCards, bought_cards: t.boughtCards,
    }]);
  } catch {
    /* best-effort — telemetry must never disrupt the end screen */
  }
}

/** Fetch the most recent `limit` run-telemetry rows (newest first) for the player balance report. Best-effort +
 *  time-boxed; [] on any failure / no backend / un-migrated table. */
export async function fetchRunTelemetry(limit = 500): Promise<RunTelemetry[]> {
  const c = client();
  if (!c) return [];
  try {
    const request = Promise.resolve(
      c.from('run_telemetry').select('hero_id, hero_offer, won, wins, offered_quests, picked_quests, quest_turns, offered_runes, picked_runes, offered_cards, bought_cards')
        .order('created_at', { ascending: false }).limit(limit),
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return [];
    return (result.data as Array<Record<string, unknown>>).map((r) => ({
      heroId: (r.hero_id as string) ?? '',
      heroOffer: (r.hero_offer as string[]) ?? [],
      won: !!r.won,
      wins: (r.wins as number) ?? 0,
      offeredQuests: (r.offered_quests as string[]) ?? [],
      pickedQuests: (r.picked_quests as string[]) ?? [],
      questTurns: (r.quest_turns as Record<string, number>) ?? {},
      offeredRunes: (r.offered_runes as string[]) ?? [],
      pickedRunes: (r.picked_runes as string[]) ?? [],
      offeredCards: (r.offered_cards as string[]) ?? [],
      boughtCards: (r.bought_cards as string[]) ?? [],
    }));
  } catch {
    return [];
  }
}

// ── Player leaderboard (profiles) ───────────────────────────────────────────────────────────────────────────
// One row per NAMED player, upserted on every finished Ascent run: their skill rating (the "MMR"), total games
// played, and favorite hero (most-played). Powers the player Leaderboard (top 10 by rating). Same
// no-op-when-unconfigured / fire-and-forget / never-throws contract, and dormant until the `profiles` table is
// migrated (see schema.sql) — exactly like the board_results ledger.

/** One ranked player, shaped for the leaderboard UI. */
export interface PlayerRow {
  author: string;
  rating: number;
  gamesPlayed: number;
  /** Hero id of the most-played hero (resolved to a name + portrait in the UI). Undefined if none recorded. */
  favoriteHero?: string;
}

/** Upsert a player's leaderboard row (keyed by author). Fire-and-forget; never throws / blocks. Skipped for
 *  anonymous players (no author) — an unnamed run can't own a leaderboard slot. */
export async function uploadPlayerProfile(p: {
  author?: string; rating: number; gamesPlayed: number; favoriteHero?: string; patch: string;
}): Promise<void> {
  const c = client();
  if (!c || !p.author) return;
  try {
    await c.from('profiles').upsert(
      {
        author: p.author, rating: p.rating, games_played: p.gamesPlayed,
        favorite_hero: p.favoriteHero ?? null, patch: p.patch, updated_at: new Date().toISOString(),
      },
      { onConflict: 'author' },
    );
  } catch {
    /* best-effort — profile sync must never disrupt the end screen */
  }
}

/** Fetch the top `limit` players by rating (the "MMR"), highest first, games-played as a tiebreak. Best-effort
 *  + time-boxed; [] on any failure / no backend / un-migrated table. */
export async function fetchTopPlayers(limit = 10): Promise<PlayerRow[]> {
  const c = client();
  if (!c) return [];
  try {
    const request = Promise.resolve(
      c.from('profiles').select('author, rating, games_played, favorite_hero')
        .order('rating', { ascending: false }).order('games_played', { ascending: false }).limit(limit),
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return [];
    return (result.data as Array<{ author: string; rating: number; games_played: number; favorite_hero: string | null }>)
      .map((r) => ({ author: r.author, rating: r.rating, gamesPlayed: r.games_played, favoriteHero: r.favorite_hero ?? undefined }));
  } catch {
    return [];
  }
}

// ── Fight-result ledger (win-tracking) ─────────────────────────────────────────────────────────────────────
// One row per combat fought against a served board; the leaderboard + Career per-round log aggregate it. Same
// fire-and-forget / no-op-when-unconfigured / never-throws contract as the rest of this seam.

/** Record one fight against a served board, from the BOARD's perspective (you lose to it → 'win'). */
export async function recordFightResult(r: { boardId: string; round: number; outcome: 'win' | 'loss' | 'tie'; patch: string }): Promise<void> {
  const c = client();
  if (!c || !r.boardId) return;
  try {
    await c.from('board_results').insert([{ board_id: r.boardId, round: r.round, outcome: r.outcome, patch: r.patch }]);
  } catch {
    /* best-effort — win-tracking must never disrupt play */
  }
}

/** One of your boards at a given round, with its fight record — a row in the Career per-round board log. */
export interface RoundBoard {
  round: number;
  board: BoardSnapshot;
  stats: BoardWinStats;
}

/** Fetch YOUR uploaded boards (by author) grouped by round, each with its fight record — the data behind the
 *  Career per-round "winningest board" log. Within each round, sorted best-record first (win-rate, then volume).
 *  Best-effort + time-boxed; an empty map on any failure / no backend / no author. */
export async function fetchPlayerRoundBoards(author: string): Promise<Map<number, RoundBoard[]>> {
  const out = new Map<number, RoundBoard[]>();
  const c = client();
  if (!c || !author) return out;
  try {
    const request = Promise.resolve(c.from(TABLE).select('snapshot').eq('author', author).limit(FETCH_LIMIT));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return out;
    const boards = (result.data as Array<{ snapshot: BoardSnapshot }>)
      .map((r) => r.snapshot)
      .filter((s): s is BoardSnapshot & { id: string } => !!s && !!s.id && Array.isArray(s.minions) && s.minions.length > 0);
    if (boards.length === 0) return out;
    const stats = await fetchBoardStats(boards.map((b) => b.id)); // all rounds
    for (const b of boards) {
      const arr = out.get(b.wave) ?? [];
      arr.push({ round: b.wave, board: b, stats: stats.get(b.id) ?? emptyStats() });
      out.set(b.wave, arr);
    }
    for (const arr of out.values()) {
      arr.sort((a, z) => z.stats.winRate - a.stats.winRate || z.stats.fights - a.stats.fights);
    }
    return out;
  } catch {
    return out;
  }
}

/** Aggregate the fight ledger for a set of board ids (optionally at a single round). Best-effort + time-boxed;
 *  an empty map on any failure / no backend. Client-side aggregation over a bounded fetch (friend-scale). */
export async function fetchBoardStats(boardIds: string[], round?: number): Promise<Map<string, BoardWinStats>> {
  const c = client();
  if (!c || boardIds.length === 0) return new Map();
  try {
    let query = c.from('board_results').select('board_id, outcome').in('board_id', boardIds);
    if (round !== undefined) query = query.eq('round', round);
    const request = Promise.resolve(query.limit(FETCH_LIMIT * 5));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return new Map();
    return tallyStats(result.data as Array<{ board_id: string; outcome: string }>);
  } catch {
    return new Map();
  }
}
