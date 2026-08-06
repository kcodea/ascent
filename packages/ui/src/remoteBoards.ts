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
import { CONFIG, registerBoardRecords, registerOpponents, type BoardSnapshot, type DerivedRun, type RunTelemetry } from '@game/sim';
import { currentIdentity, currentUserId, setIdentity, type AuthProvider } from './identity';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = 'boards';
const FETCH_LIMIT = 2000; // cap for the author/board lookups (the pool pull is capped PER WAVE below)
const POOL_PER_WAVE_LIMIT = 120; // startup pool: newest N boards per wave (~17 × 120 ≈ the old 2000 total)
const FETCH_TIMEOUT_MS = 4000; // never block boot on a slow / absent network

/** True when a backend is configured (both env vars present). */
export const remoteEnabled = (): boolean => !!(SUPABASE_URL && SUPABASE_KEY);

let cachedClient: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (cachedClient === undefined) {
    cachedClient =
      SUPABASE_URL && SUPABASE_KEY
        // ACCOUNTS C1: the session is PERSISTED now. It used to be off (`persistSession: false`), which was
        // correct while auth was unused — but an anonymous identity that doesn't survive a reload would mint a
        // new `user_id` on every load, orphaning the player's boards and rating each time.
        ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
        : null;
  }
  return cachedClient;
}

/**
 * ACCOUNTS C1 — the Supabase implementation of the `AuthProvider` seam.
 *
 * `restore()` reuses a persisted session when there is one and otherwise signs in ANONYMOUSLY, so every
 * install has a real `user_id` without a login screen. Anonymous sign-in must be enabled in the Supabase
 * dashboard (Authentication → Providers → Anonymous); if it is not, this resolves null and the app simply
 * uploads nothing — the same graceful degradation as an unconfigured backend.
 */
export const supabaseAuthProvider: AuthProvider = {
  async restore() {
    const c = client();
    if (!c) return null;
    try {
      const existing = await c.auth.getSession();
      const user = existing.data.session?.user;
      if (user) return { userId: user.id, displayName: '', anonymous: user.is_anonymous ?? true };
      const fresh = await c.auth.signInAnonymously();
      if (fresh.error || !fresh.data.user) return null;
      return { userId: fresh.data.user.id, displayName: '', anonymous: true };
    } catch {
      return null; // no session → uploads skip for the session; play is unaffected
    }
  },
  async setDisplayName(name) {
    // C1 keeps the display name LOCAL (it rides on rows as `author`, for rendering only). C2 moves it onto
    // the profile with a server-assigned discriminator; this shape is here so callers don't change then.
    const id = currentIdentity();
    if (!id) return null;
    const next = { ...id, displayName: name };
    setIdentity(next);
    return next;
  },
  async signOut() {
    const c = client();
    setIdentity(null);
    try { await c?.auth.signOut(); } catch { /* best-effort */ }
  },
};

/** A DB row: the full `BoardSnapshot` lives in the `snapshot` jsonb column; the rest are denormalized so the
 *  dashboard can index / sort / patch-prune (`delete from boards where patch <> '…'`). */
const toRow = (b: BoardSnapshot) => ({
  // ACCOUNTS C1: the row's OWNER. RLS accepts an insert only when this equals `auth.uid()`, so a client can
  // no longer write rows attributed to anyone else. `author` below is now display-only — nothing joins on it.
  user_id: currentUserId(),
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
  // No identity → skip. An unowned row would be rejected by RLS anyway; skipping keeps the failure quiet and
  // local instead of burning a round-trip on every finished run while offline.
  if (!c || !currentUserId() || boards.length === 0) return;
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
    // One capped, NEWEST-first pull PER WAVE (17 parallel queries), not a single global
    // `order(wave).limit(2000)`. The global pull filled the cap from wave 1 upward — and dead runs
    // over-contribute low waves — so once the table outgrew the cap, mid/high waves were truncated out of the
    // pool entirely. A starved wave then collapses matchmaking onto the one nearby board and repeats it
    // ("same snapshot twice in a row" at round ~9 — owner report 2026-07-17). Per-wave pulls guarantee
    // coverage across the whole course no matter how large the table grows.
    const queries = Array.from({ length: CONFIG.courseRounds }, (_, i) => {
      let q = c.from(TABLE).select('snapshot').eq('wave', i + 1);
      if (patchPrefix) q = q.like('patch', `${patchPrefix}%`);
      return Promise.resolve(q.order('created_at', { ascending: false }).limit(POOL_PER_WAVE_LIMIT));
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const settled = await Promise.race([Promise.allSettled(queries), timeout]);
    if (!settled) return 0; // timed out — boot without a remote pool (committed/local boards still serve)
    const rows = settled.flatMap((r) =>
      r.status === 'fulfilled' && !r.value.error && r.value.data ? (r.value.data as { snapshot: BoardSnapshot }[]) : []);
    const snaps = rows
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
  /** 'lobby' for rows logged since the 2026-07-31 rework (read from board.mode); undefined = pre-rework. */
  mode?: string;
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
  /** 'lobby' — the only mode that logs a victory since 2026-07-31. Carried INSIDE the board jsonb (as
   *  `board.mode`) so no schema migration is needed; the reader filters on it. */
  mode?: string;
}): Promise<void> {
  const c = client();
  if (!c || !currentUserId()) return;
  try {
    const board = v.board ? { ...v.board, mode: v.mode } : v.board;
    await c.from('runs').insert([{
      user_id: currentUserId(), // ACCOUNTS C1 — the row's owner (RLS checks it); `author` is display-only
      patch: v.patch, hero_id: v.heroId, author: v.author ?? null, wave: v.wave,
      wins: v.wins, result: 'victory', seed: v.seed, board, captured_at: v.capturedAt,
      history: v.history ?? null,
      // The leaderboard slot's fight-ledger id lives inside board.id (the jsonb) — no separate column, so this
      // insert stays compatible with a pre-migration `runs` table (only the new board_results table is required).
    }]);
  } catch {
    /* best-effort — leaderboard logging must never disrupt the end screen */
  }
}

/** Fetch THIS player's server-side rating from `profiles` (by author name) — null when absent/offline. The
 *  server value is authoritative (owner control 2026-07-31): the store adopts it over the local profile at
 *  launch, so editing the row in Supabase overrides any client. */
// `_author` is deliberately UNUSED since C1 — the row is selected by `user_id`, not by name. Kept in the
// signature so callers read unchanged and because C2's handle model wants it back.
export async function fetchPlayerRating(_author: string): Promise<number | null> {
  const c = client();
  const userId = currentUserId();
  // ACCOUNTS C1: look the rating up by USER, not by display name. Looking it up by name meant renaming
  // yourself to another player's name ADOPTED their rating — the read side of the same hole the write side
  // had. With no identity there is no rating to adopt, so return null rather than guessing from a name.
  if (!c || !userId) return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([
      Promise.resolve(c.from('profiles').select('rating').eq('user_id', userId).limit(1)),
      timeout,
    ]);
    if (!result || result.error || !result.data?.length) return null;
    const rating = (result.data[0] as { rating?: unknown }).rating;
    return typeof rating === 'number' && Number.isFinite(rating) ? rating : null;
  } catch {
    return null;
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
    return (result.data as Array<{ hero_id: string; author: string | null; wave: number; board: (BoardSnapshot & { mode?: string }) | null; history?: string | null; captured_at: string | null; created_at: string | null }>)
      .map((r) => ({
        mode: r.board?.mode ?? undefined, // 'lobby' since the 2026-07-31 rework; pre-rework rows have none
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
export async function uploadRunTelemetry(
  t: RunTelemetry,
  meta: { author?: string; patch: string; derived?: DerivedRun; replay?: unknown },
): Promise<void> {
  const c = client();
  if (!c || !currentUserId()) return;
  const base = {
    user_id: currentUserId(), // ACCOUNTS C1 — the row's owner (RLS checks it); `author` is display-only
    patch: meta.patch, author: meta.author ?? null,
    // `mode` rides INSIDE hero_offer's jsonb (as a tagged first entry) — no schema migration needed. The
    // reader strips it back out. Cleaner than a new column given the pre-migration fallback dance below.
    hero_id: t.heroId, hero_offer: t.mode ? [`mode:${t.mode}`, ...t.heroOffer] : t.heroOffer, won: t.won, wins: t.wins,
    offered_quests: t.offeredQuests, picked_quests: t.pickedQuests, quest_turns: t.questTurns,
    offered_runes: t.offeredRunes, picked_runes: t.pickedRunes,
    offered_cards: t.offeredCards, bought_cards: t.boughtCards,
    tier_by_wave: t.tierByWave,
    placement: t.placement ?? null, // lobby finish 1-8; null on any non-lobby row
  };
  try {
    // Prefer the full row; on a pre-migration DB (columns absent) fall back column-set by column-set so
    // telemetry keeps recording until `schema.sql`'s ALTERs are applied.
    const withSplit = {
      ...base,
      discover_offered_cards: t.discoverOfferedCards, discover_bought_cards: t.discoverBoughtCards,
    };
    const withBuys = { ...withSplit, buy_events: t.buyEvents ?? [] };
    // The derivation columns sit at the TOP of the fallback ladder: on a DB that hasn't run the
    // 2026-08-05 migration this insert fails and we drop straight back to the row that has always
    // worked, so a stale backend costs the new analytics and nothing else.
    const withDerived = meta.derived
      ? { ...withBuys, derived: meta.derived, replay: meta.replay ?? null, content_revision: meta.derived.contentRevision }
      : withBuys;
    const res0 = meta.derived ? await c.from('run_telemetry').insert([withDerived]) : { error: true };
    const res = res0?.error ? await c.from('run_telemetry').insert([withBuys]) : res0;
    if (res?.error) {
      const res2 = await c.from('run_telemetry').insert([withSplit]);
      // `placement` must be dropped on the way down. It rides in `base`, which every fallback spreads, so
      // before this a DB without that column failed ALL THREE inserts identically and the row was lost —
      // the fallback ladder existed but could never reach the ground (owner report 2026-08-03).
      if (res2?.error) {
        const res3 = await c.from('run_telemetry').insert([base]);
        if (res3?.error) {
          const noPlacement: Record<string, unknown> = { ...base };
          delete noPlacement.placement;
          await c.from('run_telemetry').insert([noPlacement]);
        }
      }
    }
  } catch {
    /* best-effort — telemetry must never disrupt the end screen */
  }
}

/** Fetch the most recent `limit` run-telemetry rows (newest first) for the player balance report. Best-effort +
 *  time-boxed; [] on any failure / no backend / un-migrated table. */
/** Fetch recent runs' DERIVED payloads (the runDerive streams stored in the `derived` jsonb column) for the
 *  Balance Report's derived views. Best-effort like everything here: [] on no backend / pre-migration DB
 *  (the column doesn't exist until the 2026-08-05 schema.sql section is run) / timeout. */
export async function fetchDerivedRuns(limit = 200): Promise<DerivedRun[]> {
  const c = client();
  if (!c) return [];
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([
      Promise.resolve(
        c.from('run_telemetry').select('derived').not('derived', 'is', null)
          .order('created_at', { ascending: false }).limit(limit),
      ),
      timeout,
    ]);
    if (!result || result.error || !result.data) return [];
    return (result.data as unknown as Array<{ derived: DerivedRun | null }>)
      .map((r) => r.derived)
      .filter((d): d is DerivedRun => !!d && Array.isArray((d as DerivedRun).offers));
  } catch {
    return [];
  }
}

export async function fetchRunTelemetry(limit = 500): Promise<RunTelemetry[]> {
  const c = client();
  if (!c) return [];
  try {
    // `placement` is load-bearing for the whole placement half of the report AND for `runWon` (placement 1 is
    // what a lobby win IS — a lobby never reaches phase 'victory'). It was written by the insert but never
    // selected here, so every placement column read empty (owner report 2026-08-03).
    const cols = 'hero_id, hero_offer, won, wins, offered_quests, picked_quests, quest_turns, offered_runes, picked_runes, offered_cards, bought_cards, discover_offered_cards, discover_bought_cards, tier_by_wave, buy_events, placement';
    const query = (select: string) => Promise.resolve(
      c.from('run_telemetry').select(select).order('created_at', { ascending: false }).limit(limit),
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    let result = await Promise.race([query(cols), timeout]);
    // Pre-migration DB (missing newer columns) errors the select — retry progressively so the report still loads.
    if (result && result.error) result = await Promise.race([query(cols.replace(', placement', '')), timeout]);
    if (result && result.error) result = await Promise.race([query(cols.replace(', buy_events', '').replace(', placement', '')), timeout]);
    if (result && result.error) result = await Promise.race([query(cols.replace(', discover_offered_cards, discover_bought_cards', '').replace(', buy_events', '').replace(', placement', '')), timeout]);
    if (!result || result.error || !result.data) return [];
    // The select list is built at runtime (columns are dropped on a pre-migration DB), so supabase-js can't
    // infer a row type and falls back to `GenericStringError[]` — go via `unknown` and read the columns by hand.
    return (result.data as unknown as Array<Record<string, unknown>>).map((r) => ({
      mode: (((r.hero_offer as string[]) ?? []).find((h) => h.startsWith('mode:')) ?? '').slice(5) || undefined,
      heroId: (r.hero_id as string) ?? '',
      heroOffer: ((r.hero_offer as string[]) ?? []).filter((h) => !h.startsWith('mode:')),
      won: !!r.won,
      wins: (r.wins as number) ?? 0,
      offeredQuests: (r.offered_quests as string[]) ?? [],
      pickedQuests: (r.picked_quests as string[]) ?? [],
      questTurns: (r.quest_turns as Record<string, number>) ?? {},
      offeredRunes: (r.offered_runes as string[]) ?? [],
      pickedRunes: (r.picked_runes as string[]) ?? [],
      offeredCards: (r.offered_cards as string[]) ?? [],
      boughtCards: (r.bought_cards as string[]) ?? [],
      discoverOfferedCards: (r.discover_offered_cards as string[]) ?? [],
      discoverBoughtCards: (r.discover_bought_cards as string[]) ?? [],
      tierByWave: (r.tier_by_wave as number[]) ?? [],
      buyEvents: (r.buy_events as { id: string; wave: number; src: 'shop' | 'discover' }[]) ?? undefined,
      placement: (r.placement as number | null) ?? undefined,
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
  /** `auth.users.id` — the key their run history is stored under. Needed to open ANOTHER player's Career from
   *  the leaderboard; `author` is a mutable display name and must never be used to look anything up. */
  userId: string;
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
  const userId = currentUserId();
  if (!c || !userId) return;
  try {
    // ACCOUNTS C1: the profile is keyed on `user_id`, NOT on the display name. Before this, renaming yourself
    // to someone else's name inherited their leaderboard slot — the name WAS the primary key.
    //
    // ── WHY THIS IS TWO STATEMENTS AND NOT ONE UPSERT ────────────────────────────────────────────────────
    // The C1 RLS policy makes `rating` WRITE-ONCE from the client: its `with check` requires the incoming
    // rating to equal the row's currently stored value. A single upsert sends every column, so as soon as the
    // player's rating moved, the incoming rating no longer matched and Postgres rejected THE WHOLE ROW — not
    // just the rating. `games_played`, `author` and `favorite_hero` all silently froze at whatever they were
    // on the first insert, and the failure was swallowed by the best-effort catch below.
    //
    // That is the leaderboard reading "1 game" for a player with four runs in their Career (owner report
    // 2026-08-04): the count was never wrong, it was never written after run one.
    //
    // So: UPDATE the mutable columns WITHOUT touching rating (leaving it equal to itself, which the policy
    // permits), and fall back to an INSERT — which may set rating — only when no row exists yet. `select()`
    // is what tells the two apart: an UPDATE matching nothing is a success with zero rows, not an error.
    const now = new Date().toISOString();
    const mutable = {
      author: p.author ?? null, games_played: p.gamesPlayed,
      favorite_hero: p.favoriteHero ?? null, patch: p.patch, updated_at: now,
    };
    const updated = await c.from('profiles').update(mutable).eq('user_id', userId).select('user_id');
    if (!updated.error && updated.data && updated.data.length > 0) {
      // RATING moves through its own RPC (`submit_own_rating`, schema.sql 2026-08-06) — the ONLY path the
      // policy design leaves open. The "C3 Edge Function" the write-once policy deferred to was never built,
      // so from the C1 migration until this call existed NOTHING could move a stored rating and the MMR
      // leaderboard froze at first-insert values (owner report 2026-08-06). Fire-and-forget like the rest of
      // this seam: on a DB that hasn't run the migration the RPC 404s and the catch above swallows it.
      await c.rpc('submit_own_rating', { new_rating: p.rating });
      return;
    }
    await c.from('profiles').insert({ user_id: userId, rating: p.rating, ...mutable });
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
      c.from('profiles').select('user_id, author, rating, games_played, favorite_hero')
        .order('rating', { ascending: false }).order('games_played', { ascending: false }).limit(limit),
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return [];
    return (result.data as Array<{ user_id: string; author: string; rating: number; games_played: number; favorite_hero: string | null }>)
      .map((r) => ({ userId: r.user_id, author: r.author, rating: r.rating, gamesPlayed: r.games_played, favoriteHero: r.favorite_hero ?? undefined }));
  } catch {
    return [];
  }
}

// ── Career (run_history) ───────────────────────────────────────────────────────────────────────────────────
// The career moved off `localStorage` (owner call 2026-08-03) so it follows the PLAYER rather than the
// browser. The whole `RunHistoryEntry` rides in the `entry` jsonb, so `careerStats()` consumes what comes
// back unchanged; the scalar columns exist only to sort and index.

/** Post one finished run to the career log. Fire-and-forget, like every other write here. */
export async function uploadRunHistory(entry: {
  heroId: string; wave: number; wins: number; placement?: number; mode?: string; patch?: string;
} & Record<string, unknown>): Promise<void> {
  const c = client();
  const userId = currentUserId();
  if (!c || !userId) return;
  try {
    await c.from('run_history').insert([{
      user_id: userId,
      patch: entry.patch ?? null,
      hero_id: entry.heroId,
      wave: entry.wave,
      wins: entry.wins,
      placement: entry.placement ?? null,
      mode: entry.mode ?? null,
      entry,
    }]);
  } catch {
    /* best-effort — career logging must never disrupt the end screen */
  }
}

/**
 * Fetch a career, newest first. Defaults to YOUR runs; pass `forUserId` to read another player's (opening a
 * Career from the leaderboard).
 *
 * Returns null (NOT []) when there is no identity or the request fails — the caller must be able to tell "no
 * runs yet" from "we couldn't ask", because writing a profile's games-played from a failed read would clobber
 * it with a zero.
 *
 * NOTE: reading someone ELSE's rows needs the `run_history` select policy to allow it. Until that migration is
 * run this returns [] for other players — an empty career, not an error — which is the correct degradation
 * (the feature simply shows nothing rather than breaking the page).
 */
export async function fetchRunHistory<T>(limit = 50, forUserId?: string): Promise<T[] | null> {
  const c = client();
  const userId = forUserId ?? currentUserId();
  // Your OWN fetch still requires a session; a foreign fetch only needs the id we were handed.
  if (!c || !userId || (!forUserId && !currentUserId())) return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([
      Promise.resolve(
        c.from('run_history').select('entry').eq('user_id', userId)
          .order('created_at', { ascending: false }).limit(limit),
      ),
      timeout,
    ]);
    if (!result || result.error || !result.data) return null;
    return (result.data as Array<{ entry: T }>).map((r) => r.entry).filter(Boolean);
  } catch {
    return null;
  }
}

// ── Fight-result ledger (win-tracking) ─────────────────────────────────────────────────────────────────────
// One row per combat fought against a served board; the leaderboard + Career per-round log aggregate it. Same
// fire-and-forget / no-op-when-unconfigured / never-throws contract as the rest of this seam.

/** Record one fight against a served board, from the BOARD's perspective (you lose to it → 'win'). */
export async function recordFightResult(r: { boardId: string; round: number; outcome: 'win' | 'loss' | 'tie'; patch: string }): Promise<void> {
  const c = client();
  if (!c || !currentUserId() || !r.boardId) return;
  try {
    await c.from('board_results').insert([{ user_id: currentUserId(), board_id: r.boardId, round: r.round, outcome: r.outcome, patch: r.patch }]);
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

// ── Board win-rate records (matchmaking weighting) ─────────────────────────────────────────────────────────
// One bounded pull of the fight ledger, aggregated client-side into per-board {wins, fights} and registered
// with the sim (matchmaking.ts). Fetched at startup and REFRESHED BETWEEN RUNS (owner ask 2026-07-18) —
// never mid-run, so a run's weights stay static (same determinism scope as the pool). Best-effort like the
// rest of this seam: no backend / un-migrated table → no records → every board sits at the neutral prior.
const RECORDS_FETCH_LIMIT = 8000;
export async function fetchAndRegisterBoardRecords(): Promise<number> {
  const c = client();
  if (!c) return 0;
  try {
    const request = Promise.resolve(
      c.from('board_results').select('board_id, outcome').order('created_at', { ascending: false }).limit(RECORDS_FETCH_LIMIT),
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return 0;
    const agg = new Map<string, { wins: number; fights: number }>();
    for (const r of result.data as { board_id: string; outcome: string }[]) {
      const rec = agg.get(r.board_id) ?? { wins: 0, fights: 0 };
      rec.fights += 1;
      if (r.outcome === 'win') rec.wins += 1;      // board-perspective: 'win' = the served board beat the player
      else if (r.outcome === 'tie') rec.wins += 0.5; // a draw counts half, both sides
      agg.set(r.board_id, rec);
    }
    registerBoardRecords(agg);
    return agg.size;
  } catch {
    return 0;
  }
}

/** Between-runs refresh (owner ask 2026-07-18): re-pull the shared pool (registerOpponents dedupes, so only
 *  NEW boards append) + the fight-ledger records, so consecutive runs in one session see fresh opponents and
 *  fresh win-rates. Fire-and-forget from the run-end boundary — never called mid-run. */
export function refreshOpponentPoolAndRecords(patchPrefix?: string): void {
  void fetchAndRegisterPool(patchPrefix);
  void fetchAndRegisterBoardRecords();
}
