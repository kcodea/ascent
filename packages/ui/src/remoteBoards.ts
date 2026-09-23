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
import type { SetId } from '@game/content';
import type { FightRow, LobbyStrength, StrengthInput } from '@game/sim';
import { CONFIG, RANK_SEASON, initialRankedProfile, lobbyStrengthOf, excludeOwnFights, parseLobbyStrength, parseRankResult, parseRankedProfile, registerBoardRecords, registerOpponents, type BoardSnapshot, type DerivedRun, type RankedProfile, type ReplayV2, type RunTelemetry, type RunTelemetryRow, type TelemetrySource, isRankPosition, type RankPosition } from '@game/sim';
import { currentIdentity, currentUserId, setIdentity, type AuthProvider, type Identity } from './identity';
import type { RankSubmitOutcome, RankSubmitRequest } from './rank/types';
import { careerRunOf, joinTelemetry, type CareerRun, type RunHistoryRowLike, type TelemetryProbeRow } from './careerData';
import { hallHistoryKeyOf, ownGameRecordsOf, type HallLedgerFight, type HallOwnRecord } from './leaderboardData';

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

/** BUG REPORTER (PR 2): the reporter's Edge Function upload rides THIS client — same persisted session and
 *  access token as every other write — so `bug-report/` never builds a second client. Null when no backend
 *  is configured (the queue then simply retains reports). Exported narrowly for that one caller. */
export const supabaseClient = (): SupabaseClient | null => client();

/** A Supabase auth user → our provider-agnostic `Identity`. `is_anonymous` flips false once an email is
 *  confirmed on the account, so it is the single source of truth for "real account vs device-bound session".
 *  `displayName` is left to the caller (it comes from local storage / the profile, never from auth). */
type SbUser = { id: string; is_anonymous?: boolean; email?: string };
const toIdentity = (user: SbUser, displayName = ''): Identity => ({
  userId: user.id,
  displayName,
  anonymous: user.is_anonymous ?? false,
  email: user.email ?? null,
});

/** Raw Supabase auth errors are terse and sometimes leak internals; map the ones a player can actually hit to
 *  something calm. Anything unrecognised falls through verbatim so we never hide a real signal in dev.
 *  Exported for the regression test (the "{}" braces bug) — not part of the module's public surface. */
export function friendlyAuthError(message: string): string {
  const raw = (message ?? '').trim();
  // gotrue/@supabase/auth-js builds an error message from `JSON.stringify(body)` when the error response has no
  // readable field — an EMPTY body yields the literal string "{}" (Mike's OTP failure 2026-08-11 surfaced two
  // red braces). Any opaque, non-human message (empty, "{}", "[object Object]", a bare JSON blob) is a server /
  // transport problem the player can't act on, so show a calm generic instead of raw braces.
  if (!raw || raw === '{}' || raw === '[object Object]' || raw.startsWith('{') || raw.startsWith('[')) {
    return 'The sign-in service didn’t respond properly. Wait a moment and try again.';
  }
  const m = raw.toLowerCase();
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('invalid') && m.includes('email')) return 'That doesn’t look like a valid email address.';
  // "Signups not allowed for otp" / "not authorized" / "disabled" all mean the Supabase project hasn't enabled
  // email sign-in (or has signups off) — a config the PLAYER can't fix, so don't imply they did something wrong.
  if (m.includes('signups not allowed') || m.includes('not authorized') || m.includes('disabled')) {
    return 'Email sign-in isn’t enabled for this build yet.';
  }
  return raw;
}

/** True when an `updateUser({ email })` failure means the email already belongs to ANOTHER account — the one
 *  case where "convert in place" must give way to "sign into the existing account". Every other failure is a
 *  real error to surface, not a reason to fall through. */
const emailAlreadyRegistered = (message: string): boolean => {
  const m = message.toLowerCase();
  return m.includes('already registered') || m.includes('already been registered') || m.includes('already exists');
};

/**
 * ACCOUNTS C1 + C2 — the Supabase implementation of the `AuthProvider` seam.
 *
 * C1: `restore()` reuses a persisted session or signs in ANONYMOUSLY, so every install has a real `user_id`
 * with no login screen. Anonymous sign-in must be enabled in the Supabase dashboard (Authentication →
 * Providers → Anonymous); if it is not, this resolves null and the app uploads nothing — the same graceful
 * degradation as an unconfigured backend.
 *
 * C2: `signInWithEmail()` turns that anonymous session into a permanent, portable account via a MAGIC LINK,
 * and `onChange()` reports the upgrade landing after the emailed link is opened. The player never sees a
 * password (there isn't one), and the upgrade keeps the same `user_id`, so all their boards / runs / rating
 * carry over. "Email sign-ins" (magic links) must be enabled in the dashboard for C2 to work.
 */
export const supabaseAuthProvider: AuthProvider = {
  async restore() {
    const c = client();
    if (!c) return null;
    try {
      const existing = await c.auth.getSession();
      const user = existing.data.session?.user;
      if (user) return toIdentity(user);
      const fresh = await c.auth.signInAnonymously();
      if (fresh.error || !fresh.data.user) return null;
      return toIdentity(fresh.data.user);
    } catch {
      return null; // no session → uploads skip for the session; play is unaffected
    }
  },
  async setDisplayName(name) {
    // The display name is local (it rides on rows as `author`, for rendering). C2b moves it onto the profile
    // with a server-assigned discriminator; this shape is here so callers don't change then.
    const id = currentIdentity();
    if (!id) return null;
    const next = { ...id, displayName: name };
    setIdentity(next);
    return next;
  },
  async signInWithEmail(email) {
    const c = client();
    if (!c) return { ok: false, error: 'No account backend is configured for this build.' };
    const trimmed = email.trim();
    if (!trimmed) return { ok: false, error: 'Enter your email address.' };
    // The emailed LINK returns the player to THIS running app — but only a real http(s) origin can be a valid
    // redirect. In the packaged exe the origin is `file://` (no server), which isn't a whitelistable redirect,
    // so we omit it there and the player completes sign-in with the CODE instead (`verifyEmailCode`).
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const emailRedirectTo = /^https?:\/\//.test(origin) ? origin : undefined;
    try {
      const cur = await c.auth.getUser();
      const anonymous = cur.data.user?.is_anonymous ?? true;
      if (anonymous) {
        // PRIMARY PATH — convert this anonymous session in place. Same `user_id`, so nothing is orphaned.
        const upd = await c.auth.updateUser({ email: trimmed }, { emailRedirectTo });
        if (!upd.error) return { ok: true };
        // ONLY when the email already belongs to another account do we switch tactics: this is a RETURNING
        // player on a fresh device, so sign into that existing account. The throwaway anonymous user on this
        // device is abandoned; its local-only data was never uploaded, so nothing the player expects is lost.
        // Any OTHER updateUser error (config, network, invalid email) is surfaced as-is — falling through
        // blindly used to mislabel a "signups disabled" config as an OTP problem.
        if (!emailAlreadyRegistered(upd.error.message)) return { ok: false, error: friendlyAuthError(upd.error.message) };
        const otp = await c.auth.signInWithOtp({ email: trimmed, options: { shouldCreateUser: false, emailRedirectTo } });
        return otp.error ? { ok: false, error: friendlyAuthError(otp.error.message) } : { ok: true };
      }
      // Already a real account (re-auth, or switching accounts on this device).
      const otp = await c.auth.signInWithOtp({ email: trimmed, options: { emailRedirectTo } });
      return otp.error ? { ok: false, error: friendlyAuthError(otp.error.message) } : { ok: true };
    } catch {
      return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
    }
  },
  async verifyEmailCode(email, code) {
    const c = client();
    if (!c) return { ok: false, error: 'No account backend is configured for this build.' };
    const trimmed = email.trim();
    const token = code.replace(/\D/g, ''); // the email shows a 6-digit code; tolerate spaces the player types
    if (!token) return { ok: false, error: 'Enter the code from your email.' };
    // We don't track WHICH send path ran, so try both token types: `email_change` is what an anonymous→email
    // upgrade (`updateUser`) issues; `email` is what a `signInWithOtp` (existing-account sign-in) issues. The
    // wrong type just errors with no side effect, so trying both is safe. On success `onAuthStateChange` fires
    // and the identity updates exactly as it does for a clicked link.
    try {
      for (const type of ['email_change', 'email'] as const) {
        const res = await c.auth.verifyOtp({ email: trimmed, token, type });
        if (!res.error) return { ok: true };
      }
      return { ok: false, error: 'That code didn’t match. Check it and try again, or resend.' };
    } catch {
      return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
    }
  },
  onChange(fn) {
    const c = client();
    if (!c) return () => {};
    // Supabase fires this on the magic-link redirect (SIGNED_IN / USER_UPDATED), on token refresh, and on a
    // sign-out in another tab. We keep the live display name across the transition — it comes from local
    // state, never from auth — and push the mapped identity into the module so `currentUserId()` stays fresh
    // for every fire-and-forget upload path.
    const { data } = c.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      const next = user ? toIdentity(user, currentIdentity()?.displayName ?? '') : null;
      setIdentity(next);
      fn(next);
    });
    return () => data.subscription.unsubscribe();
  },
  async signOut() {
    const c = client();
    setIdentity(null);
    try { await c?.auth.signOut(); } catch { /* best-effort */ }
  },
};

// ── ACCOUNTS C2 — offline upload queue ────────────────────────────────────────────────────────────────────
// C1 establishes an anonymous session at boot, so `currentUserId()` is almost always set by the time a run
// ends — but not if Supabase was unreachable at boot, or a run finished in the split second before the
// handshake. Those uploads used to silently no-op and the run was lost. Now they QUEUE to localStorage and
// replay when a session next establishes, tagged UNRATED (a run finished with no live session doesn't move the
// ladder — see `uploadPlayerProfile`). Fire-and-forget throughout, like the rest of this seam.
type QueueKind = 'boards' | 'victory' | 'telemetry' | 'profile' | 'history' | 'fight' | 'seat' | 'fights';
interface QueuedItem { kind: QueueKind; payload: unknown; at: string }
const QUEUE_KEY = 'ascent.uploadqueue';
const QUEUE_MAX = 100; // a hard cap so a long offline stretch can't grow localStorage without bound

function loadQueue(): QueuedItem[] {
  try { const raw = localStorage.getItem(QUEUE_KEY); const a: unknown = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? (a as QueuedItem[]) : []; }
  catch { return []; }
}
function saveQueue(q: QueuedItem[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); } catch { /* ignore */ }
}
/** Persist an upload that had no session to run under. Only meaningful with a backend configured. */
function enqueueUpload(kind: QueueKind, payload: unknown): void {
  if (!remoteEnabled() || typeof localStorage === 'undefined') return;
  const q = loadQueue();
  q.push({ kind, payload, at: new Date().toISOString() });
  saveQueue(q);
}

let flushing = false;
/**
 * Replay every queued upload now that a session exists — each tagged UNRATED, since it happened offline. Takes
 * ownership of the queue up front (clears it) so a concurrent finish can't double-send; matches the module's
 * fire-and-forget norm (no per-item retry — flush only runs right after a successful handshake, so the network
 * is up). Called from the identity boot + onChange in the store.
 */
export async function flushUploadQueue(): Promise<void> {
  if (flushing || !remoteEnabled() || !currentUserId()) return;
  const q = loadQueue();
  if (q.length === 0) return;
  flushing = true;
  saveQueue([]);
  try {
    for (const item of q) {
      try {
        switch (item.kind) {
          case 'boards':    await uploadBoards(item.payload as BoardSnapshot[], { unrated: true }); break;
          case 'victory':   await uploadVictory({ ...(item.payload as Parameters<typeof uploadVictory>[0]), unrated: true }); break;
          case 'telemetry': { const p = item.payload as { t: RunTelemetry; meta: Parameters<typeof uploadRunTelemetry>[1] }; await uploadRunTelemetry(p.t, p.meta); break; }
          case 'profile':   await uploadPlayerProfile({ ...(item.payload as Parameters<typeof uploadPlayerProfile>[0]), unrated: true }); break;
          case 'history':   await uploadRunHistory(item.payload as Parameters<typeof uploadRunHistory>[0]); break;
          case 'fight':     await recordFightResult(item.payload as Parameters<typeof recordFightResult>[0]); break;
          case 'seat':      break; // the retired knockout ledger (2026-09-22): a row queued before the fight ledger is dropped
          case 'fights':    await recordLobbyFights(item.payload as Parameters<typeof recordLobbyFights>[0]); break;
        }
      } catch { /* best-effort — a failed item is dropped, matching every other write here */ }
    }
  } finally {
    flushing = false;
  }
}

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
export async function uploadBoards(boards: BoardSnapshot[], opts?: { unrated?: boolean }): Promise<void> {
  const c = client();
  if (!c || boards.length === 0) return;
  // No session yet (offline / pre-handshake) → QUEUE rather than lose the boards; flushed when one lands.
  if (!currentUserId()) { enqueueUpload('boards', boards); return; }
  try {
    const rows = boards.map((b) => toRow(b));
    const tagged = rows.map((r) => ({ ...r, unrated: opts?.unrated ?? false }));
    const res = await c.from(TABLE).insert(tagged);
    // `unrated` is a C2b column; on a DB that hasn't run that migration the insert fails, so retry WITHOUT it
    // — boards keep uploading, they just aren't tagged until the ALTER is applied. Same discipline as the
    // telemetry fallback ladder below.
    if (res.error) await c.from(TABLE).insert(rows);
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
  /** C2 offline queue — a victory logged offline is tagged unrated (forward-looking for the C3 audit). */
  unrated?: boolean;
}): Promise<void> {
  const c = client();
  if (!c) return;
  if (!currentUserId()) { enqueueUpload('victory', v); return; }
  try {
    const board = v.board ? { ...v.board, mode: v.mode } : v.board;
    const row = {
      user_id: currentUserId(), // ACCOUNTS C1 — the row's owner (RLS checks it); `author` is display-only
      patch: v.patch, hero_id: v.heroId, author: v.author ?? null, wave: v.wave,
      wins: v.wins, result: 'victory', seed: v.seed, board, captured_at: v.capturedAt,
      history: v.history ?? null,
      // The leaderboard slot's fight-ledger id lives inside board.id (the jsonb) — no separate column, so this
      // insert stays compatible with a pre-migration `runs` table (only the new board_results table is required).
    };
    // `unrated` is a C2b column — send it, and retry WITHOUT it on a DB that hasn't run the migration.
    const res = await c.from('runs').insert([{ ...row, unrated: v.unrated ?? false }]);
    if (res.error) await c.from('runs').insert([row]);
  } catch {
    /* best-effort — leaderboard logging must never disrupt the end screen */
  }
}

/** Fetch THIS player's server-side rating from `profiles` (by author name) — null when absent/offline. The
 *  server value is authoritative (owner control 2026-07-31): the store adopts it over the local profile at
 *  launch, so editing the row in Supabase overrides any client. */
// `_author` is deliberately UNUSED since C1 — the row is selected by `user_id`, not by name. Kept in the
// signature so callers read unchanged and because C2's handle model wants it back.
export async function fetchPlayerRating(_author: string): Promise<number | null | undefined> {
  const c = client();
  const userId = currentUserId();
  // ACCOUNTS C1: look the rating up by USER, not by display name. Looking it up by name meant renaming
  // yourself to another player's name ADOPTED their rating — the read side of the same hole the write side
  // had. With no identity there is no rating to adopt, so report "couldn't ask" rather than guessing.
  //
  // THREE-WAY RESULT (owner report 2026-08-19: a wiped `profiles` table left every client showing its old
  // local rating). The caller has to tell "the server has no rating for me" apart from "I couldn't reach the
  // server", because those want opposite handling — adopt-fresh vs keep-local:
  //   • `undefined` — COULDN'T ASK (no backend configured, no session, query error, timeout). Keep local.
  //   • `null`      — ASKED AND ANSWERED: no row, or a row with no usable rating. The server says unranked.
  //   • `number`    — this account's authoritative rating.
  if (!c || !userId) return undefined;
  try {
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), FETCH_TIMEOUT_MS));
    const result = await Promise.race([
      Promise.resolve(c.from('profiles').select('rating').eq('user_id', userId).limit(1)),
      timeout,
    ]);
    if (!result || result.error) return undefined;   // timed out / query failed — we never got an answer
    if (!result.data?.length) return null;           // answered: this account has no profile row
    const rating = (result.data[0] as { rating?: unknown }).rating;
    return typeof rating === 'number' && Number.isFinite(rating) ? rating : null;
  } catch {
    return undefined;
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
  if (!c) return;
  if (!currentUserId()) { enqueueUpload('telemetry', { t, meta }); return; }
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
    // 2026-09-22: the SET + SOURCE stamps (the Balance Report reads one set and never a sandbox row). A NEW
    // top rung, never a key in `base`: `base` is spread into every rung below, so a column there that the
    // backend lacks would fail every insert and LOSE the row — exactly the 2026-08-03 `placement` bug. On a
    // pre-migration table this rung errors and the walk continues one rung down, costing only the stamps
    // (both also ride inside `derived`, so a stamped payload still survives). A MISSING stamp stays null:
    // the reader treats null as legacy, and a caller that forgot the stamp must never be labelled ladder.
    const withSet = { ...withDerived, set_id: t.setId ?? null, source: t.source ?? null };
    // `placement` must be dropped on the way down. It rides in `base`, which every fallback spreads, so
    // before this a DB without that column failed ALL THREE inserts identically and the row was lost —
    // the fallback ladder existed but could never reach the ground (owner report 2026-08-03).
    const noPlacement: Record<string, unknown> = { ...base };
    delete noPlacement.placement;
    // Walk the ladder richest → plainest; the first insert the backend accepts ends it.
    const ladder: Record<string, unknown>[] = [withSet, ...(meta.derived ? [withDerived] : []), withBuys, withSplit, base, noPlacement];
    for (const row of ladder) {
      const res = await c.from('run_telemetry').insert([row]);
      if (!res?.error) break;
    }
  } catch {
    /* best-effort — telemetry must never disrupt the end screen */
  }
}

/** The Balance Report's select ladder — richest first. Each rung drops the columns of one migration, NEWEST
 *  migration first, so a backend that has not run a migration answers from the rung below it (PostgREST
 *  rejects an unknown column in `select=` with 42703; a walk that never dropped the newest columns first
 *  would error on every rung and empty the whole report). Exported for tests. */
const BALANCE_BASE = 'id, created_at, patch, author, hero_id, hero_offer, won, wins, offered_quests, picked_quests, quest_turns, offered_runes, picked_runes, offered_cards, bought_cards, tier_by_wave';
const BALANCE_SPLIT = `${BALANCE_BASE}, discover_offered_cards, discover_bought_cards`; // 2026-07-15
const BALANCE_BUYS = `${BALANCE_SPLIT}, buy_events`; // 2026-07-16
const BALANCE_PLACE = `${BALANCE_BUYS}, placement`; // 2026-08-02
/** 2026-08-05: `content_revision` arrived in the same migration as the `derived` jsonb, so this rung ALSO reads
 *  the two stamps the client writes INSIDE derived (`derived->>setId`, `derived->>source`): two short scalars
 *  per row, never the payload. A row uploaded by a 2026-09-22 client to a table that still lacks the columns
 *  then reads as stamped rather than as legacy, until the owner's migration lands the columns proper. */
const BALANCE_REV = `${BALANCE_PLACE}, content_revision, derived_set:derived->>setId, derived_source:derived->>source`;
export const BALANCE_SELECTS: readonly string[] = [
  `${BALANCE_REV}, set_id, source`, // 2026-09-22 — the set + source stamps as columns
  BALANCE_REV,
  BALANCE_PLACE,
  BALANCE_BUYS,
  BALANCE_SPLIT,
  BALANCE_BASE,
];
/** The Balance Report is a dev panel reading a multi-megabyte table, not a boot-path fetch: it gets a longer
 *  box than `FETCH_TIMEOUT_MS`, and the derived query longer still. */
const BALANCE_FLAT_TIMEOUT_MS = 12000;
const BALANCE_DERIVED_TIMEOUT_MS = 45000;
const balanceTimeout = (ms: number): Promise<null> => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

/** Fetch the most recent `limit` run-telemetry rows (newest first) for the player Balance Report: the FLAT
 *  columns only, `derived` left null. The derived payloads are the heavy half and are fetched afterwards, by id,
 *  for the rows the report actually reads (`fetchRunDerived`). Best-effort + time-boxed; [] on any failure /
 *  no backend / un-migrated table. The set / ladder filtering happens in `@game/sim`'s `applyReportFilters`,
 *  on the caller's side, so the export and the screen share one path. */
export async function fetchRunTelemetry(limit = 500): Promise<RunTelemetryRow[]> {
  const c = client();
  if (!c) return [];
  try {
    const query = (select: string) => Promise.race([
      Promise.resolve(c.from('run_telemetry').select(select).order('created_at', { ascending: false }).limit(limit)),
      balanceTimeout(BALANCE_FLAT_TIMEOUT_MS),
    ]);
    // Walk the ladder: a query ERROR (an unknown column on this backend) tries the next, plainer select; a
    // timeout or a clean answer ends the walk.
    let result: Awaited<ReturnType<typeof query>> = null;
    for (const select of BALANCE_SELECTS) {
      result = await query(select);
      if (!result || !result.error) break;
    }
    if (!result || result.error || !result.data) return [];
    // The select list is built at runtime (columns are dropped on a pre-migration DB), so supabase-js can't
    // infer a row type and falls back to `GenericStringError[]` — go via `unknown` and read the columns by hand.
    return (result.data as unknown as Array<Record<string, unknown>>).map((r) => {
      const id = typeof r.id === 'number' ? r.id : null;
      // The stamps: the column when the backend has it, else the copy the client wrote inside `derived`
      // (read as two scalars on the rung above); absent on a genuinely legacy row, which then reads as set 1.
      const setId = typeof r.set_id === 'string' ? (r.set_id as SetId) : typeof r.derived_set === 'string' ? (r.derived_set as SetId) : undefined;
      const source = typeof r.source === 'string' ? (r.source as TelemetrySource) : typeof r.derived_source === 'string' ? (r.derived_source as TelemetrySource) : undefined;
      return {
        id,
        createdAt: (r.created_at as string | null) ?? null,
        patch: (r.patch as string | null) ?? null,
        author: (r.author as string | null) ?? null,
        contentRevision: (r.content_revision as string | null) ?? null,
        derived: null, // joined afterwards by `fetchRunDerived`, for the rows the report reads
        mode: (((r.hero_offer as string[]) ?? []).find((h) => h.startsWith('mode:')) ?? '').slice(5) || undefined,
        ...(setId ? { setId } : {}),
        ...(source ? { source } : {}),
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
      };
    });
  } catch {
    return [];
  }
}

/** The derived payloads are the heavy half (~100 KB per run today, ~16 MB for the live table), so they are NOT
 *  part of the flat fetch: the panel asks for them BY ID, after the flat rows have been filtered to the set and
 *  rendered, and only for the rows that survived (pre-migration that is no rows and no bytes; a 16 MB parse
 *  used to land on the title screen's frame even when the report rendered nothing). Fetched in chunks of
 *  `DERIVED_CHUNK` ids (the `in` filter rides in the URL), in parallel, each time-boxed. A pre-2026-08-05
 *  backend errors the query and the flat report stands, exactly as before. Malformed payloads are dropped. */
const BALANCE_DERIVED_SELECT = 'id, derived';
export const DERIVED_CHUNK = 100;
export async function fetchRunDerived(ids: readonly number[]): Promise<Map<number, DerivedRun>> {
  const out = new Map<number, DerivedRun>();
  const c = client();
  if (!c || ids.length === 0) return out;
  try {
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += DERIVED_CHUNK) chunks.push(ids.slice(i, i + DERIVED_CHUNK));
    const results = await Promise.all(chunks.map((chunk) => Promise.race([
      Promise.resolve(c.from('run_telemetry').select(BALANCE_DERIVED_SELECT).in('id', chunk)),
      balanceTimeout(BALANCE_DERIVED_TIMEOUT_MS),
    ])));
    for (const res of results) {
      if (!res || res.error || !res.data) continue;
      for (const r of res.data as unknown as Array<{ id: unknown; derived: DerivedRun | null }>) {
        if (typeof r.id === 'number' && r.derived && Array.isArray(r.derived.offers)) out.set(r.id, r.derived);
      }
    }
  } catch {
    /* best-effort — the flat report stands without the payloads */
  }
  return out;
}

/** One row for the Recent Games list (title → "Recent Games"): who played, which hero, how it ended — plus,
 *  since the 2026-09-20 polish, the LIGHT facts the banner prints (final board, record, run length, runes,
 *  partial flag), read as JSON-path scalars / small subtrees off the replay so the list still never pulls a
 *  frame. */
export interface RecentGameRow {
  /** `auth.users.id` of the player — needed to open THEIR Career from the row (the mutable `author` name must
   *  never be used to look anything up). Null on pre-accounts rows, which then aren't clickable. */
  userId: string | null;
  author: string | null;
  heroId: string;
  wins: number;
  placement: number | null;
  createdAt: string | null;
  /** The `run_telemetry` PK — the handle `fetchReplayPayload` fetches the full replay by. Null only on a
   *  pre-`id`-select fallback read (then `hasReplay` is false too, so nothing offers a Watch). */
  rowId: number | null;
  /** True when the row's telemetry carries a WATCHABLE v2 state replay (`replay->v2->version === 2`), read
   *  as a light JSON-path column so the list never pulls the ~100–450 KB payloads (replay-v2-handoff §9). */
  hasReplay: boolean;
  /** The run's final warband (`replay->v2->result->finalBoard`) — null on rows without a v2 replay, on an
   *  empty final board, and on the plainer fallback selects. */
  board: BoardSnapshot | null;
  /** The recorded fight record (`replay->v2->result->record`); null when the row has no v2 replay — the
   *  scalar `wins` column is then all the banner can print. */
  record: { wins: number; losses: number; draws: number } | null;
  /** The recording's clock span (last frame − first frame), ms — the run length. Null without both clocks
   *  (no v2 replay, or a PostgREST that can't index `frames->-1`). */
  durationMs: number | null;
  /** A recording that does NOT start at round 1 (`replay->v2->partial`), with the first round it holds. */
  partial: boolean;
  firstRecordedWave: number | null;
  /** The runes the run picked (`picked_runes`), falling back to the final board's own rune list. */
  runes: string[];
  /** The round the run ended on (`derived->>finalWave`); null on rows without a derivation. */
  wave: number | null;
  /** The LOBBY STRENGTH the run was played at (`replay->v2->result->lobbyStrength`, stamped at run end — owner
   *  2026-09-22, shown only post-game on the Career and Recent Games rows). Null on rows from before it existed
   *  and on runs whose strength fetch failed; the row then prints nothing for it. */
  lobbyStrength: LobbyStrength | null;
}

// ── Replay v2 (spectate — docs/replay-v2-handoff.md Phase C) ───────────────────────────────────────────────
// The v2 state replay rides INSIDE the `replay` jsonb as `replay.v2` (the upload keeps the dormant v1 fields
// alongside — see uploadRunTelemetry). Watchability is gated on `version === 2`, which also hides every
// pre-v2 row; the v1 `isFaithful` predicate is gone with the rest of action replay (§9).

/** Light structural gate over a network jsonb value: a v2 replay we can hand to `startReplay`. Version +
 *  a non-empty frame list — full validation is playback's job; this only keeps malformed rows un-offered. */
export function isReplayV2(v: unknown): v is ReplayV2 {
  if (!v || typeof v !== 'object') return false;
  const r = v as { version?: unknown; frames?: unknown };
  return r.version === 2 && Array.isArray(r.frames) && r.frames.length > 0;
}

/** The watchable v2 replay inside a `run_telemetry.replay` column value, or null (v1-only / absent / malformed). */
export function v2ReplayOf(replayColumn: unknown): ReplayV2 | null {
  if (!replayColumn || typeof replayColumn !== 'object') return null;
  const v2 = (replayColumn as { v2?: unknown }).v2;
  return isReplayV2(v2) ? v2 : null;
}

/** A JSON-path scalar as PostgREST returns it (`->` keeps the JSON type, `->>` returns TEXT) → a finite
 *  number, or null. */
const numOf = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};

/** A stored board snapshot as a light select returns it — null for anything that isn't one, and for an
 *  EMPTY board (nothing to tile). */
const boardOf = (v: unknown): BoardSnapshot | null =>
  v && typeof v === 'object' && Array.isArray((v as BoardSnapshot).minions) && (v as BoardSnapshot).minions.length > 0 ? (v as BoardSnapshot) : null;

/** Map one raw `run_telemetry` list row → a `RecentGameRow`. Exported pure for the Phase C listing tests.
 *  Every banner fact is optional on the wire — the fallback selects (`RECENT_GAMES_SELECTS`) drop columns a
 *  pre-migration backend can't serve, and older rows simply carry nulls — so the mapper never throws on a
 *  sparse row; it prints what it has. */
export function asRecentGameRow(r: Record<string, unknown>): RecentGameRow {
  const board = boardOf(r.final_board);
  const rec = r.record && typeof r.record === 'object' ? (r.record as Record<string, unknown>) : null;
  const record = rec && numOf(rec.wins) !== null
    ? { wins: numOf(rec.wins) ?? 0, losses: numOf(rec.losses) ?? 0, draws: numOf(rec.draws) ?? 0 }
    : null;
  const first = numOf(r.first_t);
  const last = numOf(r.last_t);
  const picked = Array.isArray(r.picked_runes) ? (r.picked_runes as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return {
    userId: (r.user_id as string | null) ?? null,
    author: (r.author as string | null) ?? null,
    heroId: String(r.hero_id ?? ''),
    wins: Number(r.wins ?? 0),
    placement: r.placement != null ? Number(r.placement) : null,
    createdAt: (r.created_at as string | null) ?? null,
    rowId: typeof r.id === 'number' ? r.id : null,
    // The aliased JSON-path column `replay_v2_version` (`replay->v2->version`) — 2 on a v2 row, null/absent
    // on v1-only rows, rows with no replay, and the pre-migration fallback select.
    hasReplay: (r.replay_v2_version === 2 || r.replay_v2_version === '2') && typeof r.id === 'number',
    board,
    record,
    durationMs: first !== null && last !== null && last >= first ? last - first : null,
    partial: r.partial === true || r.partial === 'true',
    firstRecordedWave: numOf(r.first_wave),
    runes: picked.length > 0 ? picked : (board?.runes ?? []),
    wave: numOf(r.final_wave),
    lobbyStrength: parseLobbyStrength(r.lobby_strength),
  };
}

/** The Recent Games select ladder — richest first. Every JSON-path column is a server-side scalar or a small
 *  subtree (the final board, the record), never the frame list: the list still never downloads a payload.
 *  `frames->-1` (the last frame's clock) needs a PostgREST that resolves negative indices; `derived` /
 *  `picked_runes` / `replay` need their migrations. A backend that rejects a select falls to the next,
 *  plainer rung, costing only what that rung reads (run length → banner facts → Watch). Exported for tests. */
const RECENT_BASE = 'id, user_id, author, hero_id, wins, placement, created_at';
const RECENT_FACTS = 'picked_runes, replay_v2_version:replay->v2->version, final_board:replay->v2->result->finalBoard, record:replay->v2->result->record, partial:replay->v2->>partial, first_wave:replay->v2->>firstRecordedWave, final_wave:derived->>finalWave, lobby_strength:replay->v2->result->lobbyStrength';
export const RECENT_GAMES_SELECTS: readonly string[] = [
  `${RECENT_BASE}, ${RECENT_FACTS}, first_t:replay->v2->frames->0->>tMs, last_t:replay->v2->frames->-1->>tMs`,
  `${RECENT_BASE}, ${RECENT_FACTS}`,
  `${RECENT_BASE}, replay_v2_version:replay->v2->version`,
  RECENT_BASE,
];

/** The last N finished games across ALL players (public read on `run_telemetry`) — newest first. Best-effort +
 *  time-boxed; `[]` when no backend / on any failure. */
export async function fetchRecentGames(limit = 20): Promise<RecentGameRow[]> {
  const c = client();
  if (!c) return [];
  try {
    const timeout = () => new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const query = (select: string) => Promise.race([
      Promise.resolve(c.from('run_telemetry').select(select).order('created_at', { ascending: false }).limit(limit)),
      timeout(),
    ]);
    // Walk the ladder: a query ERROR (an unknown column / an unsupported path on this backend) tries the
    // next, plainer select; a timeout or a clean answer ends the walk.
    let result: Awaited<ReturnType<typeof query>> = null;
    for (const select of RECENT_GAMES_SELECTS) {
      result = await query(select);
      if (!result || !result.error) break;
    }
    if (!result || result.error || !result.data) return [];
    // Runtime-built select list → supabase-js can't infer the row type; read the columns by hand.
    return (result.data as unknown as Array<Record<string, unknown>>).map(asRecentGameRow);
  } catch {
    return [];
  }
}

/** Fetch ONE row's full v2 replay by its `run_telemetry` PK — the heavy half of the two-step spectate fetch
 *  (the list read only probed `replay->v2->version`). Selects `replay->v2` alone, so the dormant v1 fields
 *  riding alongside in the jsonb never cross the wire. Best-effort + time-boxed; null on any failure /
 *  malformed payload — the caller shows "no replay" rather than a broken viewer. */
export async function fetchReplayPayload(rowId: number): Promise<ReplayV2 | null> {
  const c = client();
  if (!c || !Number.isFinite(rowId)) return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([
      Promise.resolve(c.from('run_telemetry').select('v2:replay->v2').eq('id', rowId).limit(1)),
      timeout,
    ]);
    if (!result || result.error || !result.data?.length) return null;
    const v2 = (result.data[0] as unknown as { v2: unknown }).v2;
    return isReplayV2(v2) ? v2 : null;
  } catch {
    return null;
  }
}

/** A specific player's most recent v2 replay — the leaderboard row's Watch. Filters server-side to rows that
 *  actually carry a v2 payload (`replay->v2->version = 2`), so v1-only history never crosses the wire; scans
 *  the couple of newest qualifying rows in case the very latest payload is malformed. Null when the player
 *  has no watchable run yet — the caller shows "No run", never a broken viewer. */
export async function fetchLatestReplayForUser(userId: string): Promise<ReplayV2 | null> {
  const c = client();
  if (!c || !userId) return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([
      Promise.resolve(
        c.from('run_telemetry').select('v2:replay->v2').eq('user_id', userId)
          .eq('replay->v2->>version', '2') // ->> filters as text — robust across PostgREST versions
          .order('created_at', { ascending: false }).limit(2),
      ),
      timeout,
    ]);
    if (!result || result.error || !result.data?.length) return null;
    for (const row of result.data as unknown as Array<{ v2: unknown }>) {
      if (isReplayV2(row.v2)) return row.v2;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Career Watch (owner ask 2026-08-19): map a match-history row to ITS uploaded replay by SEED ────────────
// run_history and run_telemetry are separate rows written from the same run-end flow with no shared id — but
// both carry the run's SEED (`RunHistoryEntry.seed`; `replay.seed` at the top of the telemetry jsonb, echoed
// as `replay.v2.seed`). The seed is the run's identity (it's already the rating dedupe key), so it is the join.

/** When replay-v2 capture shipped (Phase A, commit e15eef75 2026-08-19T16:32:35-04:00). History entries that
 *  finished before this moment cannot have a v2 payload on the server, so the Career offers them no Watch at
 *  all — a button that usually answers "No replay" is noise. */
export const V2_CAPTURE_START_MS = Date.parse('2026-08-19T16:32:35-04:00');

/**
 * Can this Career match-history row offer a Watch? Three structural gates, all knowable WITHOUT a network
 * round-trip (the fetch only runs on click):
 *  - a finite `seed` — the only key that maps the row to its telemetry replay; no seed, no honest mapping;
 *  - a LOBBY run — `uploadRunTelemetry` (which carries the replay) only fires for lobby runs, so a course/rift
 *    row has nothing uploaded to find (`mode === 'lobby'`, or a recorded placement — only lobbies have one);
 *  - finished AFTER v2 capture shipped — the full `at` timestamp must parse and post-date Phase A. Entries
 *    without `at` predate 2026-08-11 and are pre-v2 by years of margin, so they're out too.
 */
export function historyEntryWatchable(e: { seed?: unknown; at?: string; mode?: string; placement?: number }): boolean {
  if (typeof e.seed !== 'number' || !Number.isFinite(e.seed)) return false;
  if (e.mode !== 'lobby' && typeof e.placement !== 'number') return false;
  if (!e.at) return false;
  const t = Date.parse(e.at);
  return Number.isFinite(t) && t >= V2_CAPTURE_START_MS;
}

/** Pick the newest watchable v2 replay for a seed out of fetched rows (newest first). The server already
 *  filtered by seed + version, but the payloads still get the structural gate (malformed rows skip to the
 *  next) and the seed echo inside `v2` is verified, so a mismatched row can never play as someone's run.
 *  Exported pure for the Career Watch tests. */
export function pickReplayForSeed(rows: Array<{ v2: unknown }>, seed: number): ReplayV2 | null {
  for (const row of rows) {
    if (isReplayV2(row.v2) && row.v2.seed === seed) return row.v2;
  }
  return null;
}

/** Fetch the v2 replay of the run with this SEED — the Career match row's Watch. Filters server-side on the
 *  top-level `replay->>seed` (every upload writes it beside `v2`) + `replay->v2->>version = 2` so v1-only and
 *  foreign-seed rows never cross the wire, and by `user_id` when the career's owner is known (a seed collision
 *  across players is unlikely, but the column exists and the filter is free). Newest first, two rows deep in
 *  case the latest payload is malformed. Best-effort + time-boxed; null on any failure — the caller shows
 *  "No replay", never a broken viewer. */
export async function fetchReplayForSeed(seed: number, opts?: { userId?: string | null }): Promise<ReplayV2 | null> {
  const c = client();
  if (!c || !Number.isFinite(seed)) return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const base = c.from('run_telemetry').select('v2:replay->v2')
      .eq('replay->>seed', String(seed)) // ->> compares as text — robust across PostgREST versions
      .eq('replay->v2->>version', '2');
    const query = opts?.userId ? base.eq('user_id', opts.userId) : base;
    const result = await Promise.race([
      Promise.resolve(query.order('created_at', { ascending: false }).limit(2)),
      timeout,
    ]);
    if (!result || result.error || !result.data?.length) return null;
    return pickReplayForSeed(result.data as unknown as Array<{ v2: unknown }>, seed);
  } catch {
    return null;
  }
}

/** Fetch ONE player's leaderboard row by user id — the rating / games-played / favorite-hero the Career header
 *  needs when a Career is opened from a Recent Games row (run_telemetry carries no rating), plus their MEDAL
 *  RANK (`rank`, parsed by the same `rankedProfileOfRow` the Rankings rows use) so the viewed player's
 *  Seasonal Ranked card shows the crest + bar rather than a bare number (owner 2026-09-21). A pre-migration
 *  table without the rank columns errors on that select and falls back to the display columns alone, leaving
 *  `rank` absent. Best-effort + time-boxed; null when absent / offline / no backend. */
export async function fetchPlayerById(userId: string): Promise<PlayerRow | null> {
  const c = client();
  if (!c || !userId) return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const ranked = await Promise.race([
      Promise.resolve(
        c.from('profiles').select(`user_id, author, discriminator, games_played, favorite_hero, ${RANK_COLUMNS}`)
          .eq('user_id', userId).limit(1),
      ),
      timeout,
    ]);
    const result = ranked && !ranked.error && ranked.data
      ? ranked
      : await Promise.race([
        Promise.resolve(
          c.from('profiles').select('user_id, author, discriminator, rating, games_played, favorite_hero')
            .eq('user_id', userId).limit(1),
        ),
        timeout,
      ]);
    if (!result || result.error || !result.data?.length) return null;
    const r = result.data[0] as Record<string, unknown> & { user_id: string; author: string | null; discriminator: string | null; rating: number; games_played: number; favorite_hero: string | null };
    return {
      userId: r.user_id, author: r.author ?? '', discriminator: r.discriminator ?? undefined, rating: r.rating,
      gamesPlayed: r.games_played, favoriteHero: r.favorite_hero ?? undefined,
      ...(typeof r.rank_revision === 'number' ? { rank: rankedProfileOfRow(r) } : {}),
    };
  } catch {
    return null;
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
  /** The `#4821` half of the handle (C2b). Undefined for a legacy/untagged row; the UI shows the bare name. */
  discriminator?: string;
  /** The reporting scalar (`100 × division + points` since medals; the raw season-2 number before). */
  rating: number;
  gamesPlayed: number;
  /** Hero id of the most-played hero (resolved to a name + portrait in the UI). Undefined if none recorded. */
  favoriteHero?: string;
  /** MEDAL RANK (2026-09-20): the row's ladder state, when the table carries the rank columns. Absent on a
   *  pre-migration backend — render the scalar then. */
  rank?: RankedProfile;
}

/**
 * ACCOUNTS C2b — ensure this account has a stable `#tag`, and keep `author`/`email` on the profile current.
 *
 * The tag STAYS THE SAME across renames whenever it remains unique under the new name, and is only reassigned
 * on a genuine collision (another account already holds that exact `name#tag`). Returns the live handle, or
 * null when offline / no backend. `Math.random` is legitimate here — a UI concern, never the seeded sim.
 */
export async function claimHandle(name: string): Promise<{ author: string; discriminator: string } | null> {
  const c = client();
  const userId = currentUserId();
  if (!c || !userId) return null;
  const author = name.trim().slice(0, 24);
  if (!author) return null;
  try {
    const existing = await c.from('profiles').select('discriminator').eq('user_id', userId).limit(1);
    if (existing.error) return null;
    // A leaderboard row is EARNED by finishing a run (`uploadPlayerProfile` creates it), not by setting a
    // name. If there's no row yet, do NOT create one — otherwise every throwaway anonymous session that types
    // a name leaves a 0-game ghost on the leaderboard (owner report 2026-08-10: a stray `Orangez#4040`, 0/0,
    // from a fresh session that never played). The tag lands on the next boot after the first run instead.
    const rowExists = !!existing.data && existing.data.length > 0;
    if (!rowExists) return null;
    const currentTag = (existing.data?.[0] as { discriminator?: string | null } | undefined)?.discriminator ?? null;
    const email = currentIdentity()?.email ?? null;
    // Prefer the current tag (stable across renames); fall back to fresh random tags on collision.
    const candidates: string[] = [
      ...(currentTag ? [currentTag] : []),
      ...Array.from({ length: 8 }, () => String(1000 + Math.floor(Math.random() * 9000))),
    ];
    for (const tag of candidates) {
      const patch = { author, discriminator: tag, email, updated_at: new Date().toISOString() };
      const res = await c.from('profiles').update(patch).eq('user_id', userId).select('user_id');
      if (!res.error) return { author, discriminator: tag };
      if (res.error.code !== '23505') return null; // a real error, not a `name#tag` uniqueness collision
    }
    return null; // every candidate collided — astronomically unlikely at any real player count
  } catch {
    return null;
  }
}

/** How long a single settlement round-trip may take before the client parks it as retryable. */
const RANK_SUBMIT_TIMEOUT_MS = 15_000;

/**
 * MEDAL RANK — submit a finished RATED lobby's placement for an AUTHORITATIVE settlement (2026-09-20).
 *
 * The `submit-rating` Edge Function (service role) runs the atomic `settle_rank` transaction: it locks the
 * caller's profile row, checks the `rank_results` ledger under the lock (a duplicate returns the ORIGINAL
 * result, never a second award), resolves the medal rules, and writes profile + revision + immutable result
 * in one commit. The client sends `{ runId, placement, seasonId, rulesVersion }` — never a rating, never a
 * division — and gets back the typed `RankResult` plus the current authoritative `RankedProfile`.
 *
 * The answer is EXPLICIT (blueprint §7): `confirmed` (with the result), `retryable` (offline, timeout, 5xx,
 * rate-limited, no session yet — the durable queue in `rank/rankSubmission.ts` keeps the request and retries
 * it byte-for-byte) or `rejected` (bad input, unsupported season / rules version, a server that predates
 * medals). There is NO client-computed fallback any more: the legacy `submit_own_rating` RPC is retired for
 * the medal ladder (owner ruling — the old delta table must not write the new ladder).
 */
export async function submitRating(req: RankSubmitRequest): Promise<RankSubmitOutcome> {
  const c = client();
  if (!c) return { status: 'retryable', reason: 'no_backend' };
  if (!currentUserId()) return { status: 'retryable', reason: 'no_session' };
  const body = {
    runId: req.runId, placement: req.placement, seasonId: req.seasonId, rulesVersion: req.rulesVersion,
    ...(req.seed != null ? { seed: req.seed } : {}),
    // The seven opponent keys (2026-09-22): the SERVER recomputes the lobby strength from the fight ledger at
    // settle time and applies the top-4 bonus itself; the client never sends a strength or a bonus.
    ...(req.seatKeys && req.seatKeys.length > 0 ? { seatKeys: req.seatKeys } : {}),
  };
  try {
    const timeout = new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), RANK_SUBMIT_TIMEOUT_MS));
    const call = c.functions.invoke('submit-rating', { body }) as Promise<{ data: unknown; error: unknown }>;
    const raced = await Promise.race([call, timeout]);
    if ('timedOut' in raced) return { status: 'retryable', reason: 'timeout' };
    if (raced.error) return classifyFunctionError(raced.error);
    return parseSubmitResponse(raced.data);
  } catch (e) {
    return { status: 'retryable', reason: `network:${(e as Error)?.message ?? 'unknown'}` };
  }
}

/** Map a `functions.invoke` error to a submission outcome. Only definite server refusals are `rejected`;
 *  anything transport-shaped (fetch failure, relay error, 5xx, 429, a not-yet-deployed function) is retryable
 *  so the durable queue keeps the result. */
async function classifyFunctionError(err: unknown): Promise<RankSubmitOutcome> {
  const e = err as { name?: string; message?: string; context?: { status?: number; json?: () => Promise<unknown> } };
  const status = e.context?.status;
  let code = '';
  try {
    const parsed = e.context?.json ? await e.context.json() : null;
    code = typeof (parsed as { error?: unknown } | null)?.error === 'string' ? (parsed as { error: string }).error : '';
  } catch { /* no readable body */ }
  if (status === 400 || status === 409 || status === 422) return { status: 'rejected', reason: code || `http_${status}` };
  if (status === 401 || status === 403) return { status: 'retryable', reason: code || 'unauthenticated' };
  return { status: 'retryable', reason: code || e.message || e.name || 'function_error' };
}

/** Parse the function's 200 body into a typed outcome. A body with no parseable `result`/`profile` means the
 *  deployed function predates medals (it would have written the OLD numeric ladder) — surfaced as `rejected`
 *  so nobody mistakes it for a settled medal result. */
function parseSubmitResponse(data: unknown): RankSubmitOutcome {
  const o = (data ?? {}) as { result?: unknown; profile?: unknown; deduped?: unknown; error?: unknown };
  if (typeof o.error === 'string') return { status: 'rejected', reason: o.error };
  const result = parseRankResult(o.result);
  const profile = parseRankedProfile(o.profile);
  if (!result || !profile) return { status: 'rejected', reason: 'server_outdated' };
  return { status: 'confirmed', result, profile, deduped: o.deduped === true };
}

/** The `profiles` rank columns, as the client reads them. Kept in one place so the boot fetch, the
 *  leaderboard and the single-player lookup (`fetchPlayerById`, above — a module const resolves at call
 *  time, so the earlier declaration order is fine) agree on names. */
const RANK_COLUMNS = 'rating, rank_season, rank_rules_version, rank_division, rank_points, rank_demotion_ready, rank_highest_division, rank_highest_points, rank_revision';

/** Shape one `profiles` row's rank columns into a `RankedProfile`. A row whose `rank_season` is not the live
 *  season (never ranked under medals, or from an earlier season) reads as a FRESH season start — the same
 *  thing `settle_rank` does on its first settlement — keeping the row's revision so the compare still orders. */
function rankedProfileOfRow(r: Record<string, unknown>): RankedProfile {
  const rev = typeof r.rank_revision === 'number' ? r.rank_revision : 0;
  if (r.rank_season !== RANK_SEASON) return { ...initialRankedProfile(), revision: rev };
  const parsed = parseRankedProfile({
    seasonId: r.rank_season, rulesVersion: r.rank_rules_version, revision: rev,
    position: { divisionIndex: r.rank_division, points: r.rank_points, demotionReady: r.rank_demotion_ready === true },
    highest: { divisionIndex: r.rank_highest_division, points: r.rank_highest_points },
  });
  return parsed ?? { ...initialRankedProfile(), revision: rev };
}

/**
 * Fetch THIS account's authoritative `RankedProfile` — the medal-era twin of `fetchPlayerRating`, with the
 * same three-way contract: `undefined` = couldn't ask (no backend / no session / error / timeout / a
 * pre-migration table without the rank columns) → keep the local mirror; `null` = asked, no row → fresh;
 * a profile = adopt (subject to the store's revision compare).
 */
export async function fetchRankedProfile(): Promise<RankedProfile | null | undefined> {
  const c = client();
  const userId = currentUserId();
  if (!c || !userId) return undefined;
  try {
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), FETCH_TIMEOUT_MS));
    const result = await Promise.race([
      Promise.resolve(c.from('profiles').select(RANK_COLUMNS).eq('user_id', userId).limit(1)),
      timeout,
    ]);
    if (!result || result.error) return undefined;
    if (!result.data?.length) return null;
    return rankedProfileOfRow(result.data[0] as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

/** Upsert a player's leaderboard row's DISPLAY columns (keyed by user). Fire-and-forget; never throws /
 *  blocks. Since medals (2026-09-20) this writes NO ladder state at all: the rank settles through
 *  `submitRating` on its own durable path, independent of this write and of the history upload/fetch that
 *  feeds `gamesPlayed`. (`rating` stays in the signature for queued pre-medal payloads; it is never sent.) */
export async function uploadPlayerProfile(p: {
  author?: string; rating?: number; gamesPlayed: number; favoriteHero?: string; patch: string;
  /** C2 offline queue tag — informational now (the ladder no longer rides this write). */
  unrated?: boolean;
}): Promise<void> {
  const c = client();
  const userId = currentUserId();
  if (!c) return;
  if (!userId) { enqueueUpload('profile', p); return; }
  try {
    // ACCOUNTS C1: the profile is keyed on `user_id`, NOT on the display name. Before this, renaming yourself
    // to someone else's name inherited their leaderboard slot — the name WAS the primary key.
    //
    // ── DISPLAY COLUMNS vs RANK ──────────────────────────────────────────────────────────────────────────
    // The RLS policy rejects any change to `rating` / the `rank_*` columns on a row UPDATE (its `with check`
    // requires them to equal the stored values), so the display columns and the ladder travel by DIFFERENT
    // doors. Here we write ONLY the display columns; the ladder moves through `submitRating` → the
    // `settle_rank` transaction. A brand-new row gets a rating-0 / Bronze I PLACEHOLDER (the insert policy
    // requires exactly that) and the server fills in the real values. (History: a single `upsert()` sent
    // rating on every write and, once it moved, Postgres rejected the WHOLE row — freezing games_played/author
    // at run one, the "1 game for four runs" report 2026-08-04. Split writes fixed that; medals remove the
    // client's last numeric fallback.)
    const now = new Date().toISOString();
    // `email` is denormalised from `auth.users` (C2b) — kept current here so "signed in as …" and a future
    // Steam merge can read it off the profile row. Null while anonymous.
    const mutable = {
      author: p.author ?? null, games_played: p.gamesPlayed,
      favorite_hero: p.favoriteHero ?? null, patch: p.patch, updated_at: now,
      email: currentIdentity()?.email ?? null,
    };
    // UPDATE the display columns; INSERT a rating-0 placeholder row only when none exists yet (an UPDATE
    // matching nothing is a 0-row success, not an error — that is how we tell the two apart).
    const updated = await c.from('profiles').update(mutable).eq('user_id', userId).select('user_id');
    if (updated.error || !updated.data || updated.data.length === 0) {
      await c.from('profiles').insert({ user_id: userId, rating: 0, ...mutable });
    }
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
    // Only RANKED players — a profile with zero finished games hasn't earned a slot (and a stray 0-game
    // ghost row shouldn't clutter the board). Defensive alongside `claimHandle` no longer minting them.
    // MEDALS: order by division, then points (the scalar `rating` ties Gold II 100 with Gold III 0 — the
    // promoted player must rank above the one still waiting at the gate); games-played breaks the rest.
    // A pre-migration table has no rank columns → that query errors → fall back to the legacy ordering.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const ranked = await Promise.race([
      Promise.resolve(
        c.from('profiles').select(`user_id, author, discriminator, games_played, favorite_hero, ${RANK_COLUMNS}`)
          .gt('games_played', 0)
          .order('rank_division', { ascending: false }).order('rank_points', { ascending: false })
          .order('games_played', { ascending: false }).limit(limit),
      ),
      timeout,
    ]);
    const result = ranked && !ranked.error && ranked.data
      ? ranked
      : await Promise.race([
        Promise.resolve(
          c.from('profiles').select('user_id, author, discriminator, rating, games_played, favorite_hero')
            .gt('games_played', 0)
            .order('rating', { ascending: false }).order('games_played', { ascending: false }).limit(limit),
        ),
        timeout,
      ]);
    if (!result || result.error || !result.data) return [];
    return (result.data as Array<Record<string, unknown> & { user_id: string; author: string; discriminator: string | null; rating: number; games_played: number; favorite_hero: string | null }>)
      .map((r) => ({
        userId: r.user_id, author: r.author, discriminator: r.discriminator ?? undefined, rating: r.rating,
        gamesPlayed: r.games_played, favoriteHero: r.favorite_hero ?? undefined,
        ...(typeof r.rank_revision === 'number' ? { rank: rankedProfileOfRow(r) } : {}),
      }));
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
  if (!c) return;
  // Career is personal history (not the ladder), so it carries no `unrated` tag — but it must not be LOST
  // offline either, so it queues like the rest and replays when a session lands.
  if (!userId) { enqueueUpload('history', entry); return; }
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

// ── Career page (owner rebuild 2026-09-19) — the account's runs, joined to their replay rows ────────────────
// The page reads `run_history` (the per-account run log: every finished lobby run with its final board, record,
// placement, Gold, APT, rating delta, seed and end time) and a LIGHT probe of `run_telemetry` (JSON-path
// scalars only — never the 100 KB–1 MB replay payloads) for replay availability + the recording's clock span.
// The two are joined by SEED (`careerData.joinTelemetry`). `runs` (the Hall of Champions) is NOT read here: it
// only ever holds 1st-place finishes, so it cannot be a match history.

/** Newest rows fetched WITH their full `entry` (final board included) — the match-history banners (25, owner
 *  2026-09-20). Each detailed row is a few KB (the board snapshot), so this stays a small multiple of the page. */
export const CAREER_DETAIL_ROWS = 25;

/** The light `run_history` select — every scalar the trends + left-column tiles need, projected out of the
 *  `entry` jsonb server-side so a 100-row pull stays a few KB instead of shipping 100 boards. `rating_after` is
 *  the MMR after settle that `settle_rank` stamps onto the row (the MMR trend); a row the stamp never reached
 *  simply projects NULL for it — a JSON path to a missing key is never an error. */
const CAREER_LIGHT_SELECT = 'id, created_at, hero_id, wave, wins, placement, mode, losses:entry->>losses, draws:entry->>draws, apt:entry->>apt, seed:entry->>seed, gold_spent:entry->>goldSpent, rating_delta:entry->>ratingDelta, rating_after:entry->>ratingAfter, at:entry->>at, dominant_tribe:entry->>dominantTribe, lobby_strength:entry->lobbyStrength';

/** The light `run_telemetry` probe: the row id (the Watch handle), the seed (the join), the v2 stamp (the
 *  watchability gate) and the first/last frame clocks (the run length). PostgREST resolves `frames->-1` as
 *  the last element; on a DB whose PostgREST predates negative indices the select errors and the probe
 *  retries WITHOUT the clocks (Watch still works; run length prints "—"). */
const TELEMETRY_PROBE_SELECT = 'id, created_at, placement, seed:replay->>seed, v2_version:replay->v2->>version, first_t:replay->v2->frames->0->>tMs, last_t:replay->v2->frames->-1->>tMs';
const TELEMETRY_PROBE_SELECT_NO_CLOCK = 'id, created_at, placement, seed:replay->>seed, v2_version:replay->v2->>version';

/**
 * The Career page's runs — newest first, `limit` rows in all (light), the newest `CAREER_DETAIL_ROWS` of
 * them detailed (with the final board), every row joined to its replay facts. Defaults to YOUR runs; pass
 * `userId` to read another player's (opening a Career from the leaderboard / Recent Games).
 *
 * Returns null (NOT []) when we couldn't ask — no backend, no session for an own-career read, or the history
 * query failed / timed out — so the page can say "couldn't reach the server" rather than "no runs yet". The
 * telemetry probe is best-effort: its failure only costs Watch buttons + run lengths, never the page.
 */
export async function fetchMyRuns(limit = 100, opts?: { userId?: string }): Promise<CareerRun[] | null> {
  const c = client();
  const userId = opts?.userId ?? currentUserId();
  if (!c || !userId || (!opts?.userId && !currentUserId())) return null;
  const detailLimit = Math.min(CAREER_DETAIL_ROWS, limit);
  try {
    const timeout = () => new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const light = Promise.race([
      Promise.resolve(c.from('run_history').select(CAREER_LIGHT_SELECT).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)),
      timeout(),
    ]);
    const detailed = Promise.race([
      Promise.resolve(c.from('run_history').select('id, created_at, placement, entry').eq('user_id', userId).order('created_at', { ascending: false }).limit(detailLimit)),
      timeout(),
    ]);
    const probe = (select: string) => Promise.race([
      Promise.resolve(c.from('run_telemetry').select(select).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)),
      timeout(),
    ]);
    const [lightRes, detailRes, probeRes0] = await Promise.all([light, detailed, probe(TELEMETRY_PROBE_SELECT)]);
    if (!lightRes || lightRes.error || !lightRes.data) return null;
    // A failed detailed read degrades to light rows everywhere (outcome-only banners), never to a failed page.
    const detailRows = detailRes && !detailRes.error && detailRes.data ? (detailRes.data as unknown as RunHistoryRowLike[]) : [];
    const probeRes = probeRes0 && probeRes0.error ? await probe(TELEMETRY_PROBE_SELECT_NO_CLOCK) : probeRes0;
    const probeRows = probeRes && !probeRes.error && probeRes.data ? (probeRes.data as unknown as TelemetryProbeRow[]) : [];
    return careerRunsOf(lightRes.data as unknown as RunHistoryRowLike[], detailRows, probeRows);
  } catch {
    return null;
  }
}

/** Assemble the page's rows from the three raw result sets: the light rows are the list; a detailed row
 *  with the same id upgrades its entry (board + every field read straight off the jsonb); the telemetry
 *  probe joins by seed. Exported pure for the fetch tests. */
export function careerRunsOf(lightRows: RunHistoryRowLike[], detailRows: RunHistoryRowLike[], probeRows: TelemetryProbeRow[]): CareerRun[] {
  const detailById = new Map<number, RunHistoryRowLike>();
  for (const d of detailRows) if (typeof d.id === 'number') detailById.set(d.id, d);
  const runs = lightRows.map((row) => {
    const d = typeof row.id === 'number' ? detailById.get(row.id) : undefined;
    return careerRunOf(d ? { ...row, ...d } : row);
  });
  return joinTelemetry(runs, probeRows);
}

// ── Fight-result ledger (win-tracking) ─────────────────────────────────────────────────────────────────────
// One row per combat fought against a served board; the leaderboard + Career per-round log aggregate it. Same
// fire-and-forget / no-op-when-unconfigured / never-throws contract as the rest of this seam.

/** Record one fight against a served board, from the BOARD's perspective (you lose to it → 'win'). */
export async function recordFightResult(r: { boardId: string; round: number; outcome: 'win' | 'loss' | 'tie'; patch: string }): Promise<void> {
  const c = client();
  if (!c || !r.boardId) return;
  if (!currentUserId()) { enqueueUpload('fight', r); return; }
  try {
    await c.from('board_results').insert([{ user_id: currentUserId(), board_id: r.boardId, round: r.round, outcome: r.outcome, patch: r.patch }]);
  } catch {
    /* best-effort — win-tracking must never disrupt play */
  }
}

// ── The FIGHT LEDGER (owner 2026-09-22) ────────────────────────────────────────────────────────────────
// One row per fight the table resolved — both sides named by run key — written at the end of every REAL lobby
// (never practice, the tutorial or a Scene Builder run): the fights the player witnessed plus the ones a
// deterministic play-out resolved after their elimination (`fightRowsOf` in the sim). ONE batched upsert, unique
// on (lobby_seed, round, run_a, run_b) with `ignoreDuplicates`, so a run restored and finished twice can never
// count a fight twice. Same fire-and-forget / offline-queue contract as every other write here. The server
// aggregates the table into the `run_fight_records` view; the client only ever reads THAT (never a row pool).
// This replaces the knockout ledger (`seat_results`, #1630): a knockout is just the fight the reporter lost in
// their last round, so the table is left in place, no longer written, and nothing is derived from it.

export async function recordLobbyFights(rows: FightRow[]): Promise<void> {
  const c = client();
  if (!c || rows.length === 0) return;
  if (!currentUserId()) { enqueueUpload('fights', rows); return; }
  try {
    const uid = currentUserId();
    await c.from('lobby_fights').upsert(
      rows.map((r) => ({ user_id: uid, lobby_seed: r.lobbySeed, round: r.round, run_a: r.runA, run_b: r.runB, outcome: r.outcome, observed: r.observed, patch: r.patch })),
      { onConflict: 'lobby_seed,round,run_a,run_b', ignoreDuplicates: true },
    );
  } catch {
    /* best-effort — the ledger must never disrupt the end screen */
  }
}

/** One run's aggregate from the `run_fight_records` view. */
export interface RunFightRecord {
  runKey: string;
  fights: number;
  wins: number;
  losses: number;
  draws: number;
  /** Distinct lobbies the run fought in. */
  lobbies: number;
  /** wins / fights (a draw is not a win), 0–1. */
  winRate: number;
  /** The Wilson score interval's lower bound of `winRate` at 95% — the Hall's sort key (a 30–2 run ranks above
   *  a 3–0 run). */
  wilsonLb: number;
  /** ISO time of the run's most recent fight. */
  lastFightAt: string | null;
}

const FIGHT_RECORD_SELECT = 'run_key, fights, wins, losses, draws, lobbies, win_rate, wilson_lb, last_fight_at';

/** Shape one view row. Exported pure for the Hall tests; null for a row with no usable key. */
export function asRunFightRecord(r: Record<string, unknown>): RunFightRecord | null {
  if (typeof r.run_key !== 'string' || !r.run_key) return null;
  const n = (v: unknown): number => numOf(v) ?? 0;
  return {
    runKey: r.run_key, fights: n(r.fights), wins: n(r.wins), losses: n(r.losses), draws: n(r.draws), lobbies: n(r.lobbies),
    winRate: n(r.win_rate), wilsonLb: n(r.wilson_lb), lastFightAt: typeof r.last_fight_at === 'string' ? r.last_fight_at : null,
  };
}

/** PostgREST puts an `in(...)` list in the query string, and a run key is ~40 characters, so a big key list in
 *  one call would build a URL right at the size servers start refusing. Chunked and merged. */
const KEY_CHUNK = 50;

/** The view rows for a set of run keys (the seven seats of a lobby, or the Hall's candidates). Best-effort +
 *  time-boxed; an EMPTY map on any failure / no backend / a not-yet-migrated view — a key with no row reads
 *  as unserved, which is honest. */
export async function fetchRunFightRecords(runKeys: string[]): Promise<Map<string, RunFightRecord>> {
  const c = client();
  const keys = [...new Set(runKeys.filter((k) => k && !k.startsWith('bot:')))];
  if (!c || keys.length === 0) return new Map();
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += KEY_CHUNK) chunks.push(keys.slice(i, i + KEY_CHUNK));
  try {
    const request = Promise.all(chunks.map((ks) => Promise.resolve(
      c.from('run_fight_records').select(FIGHT_RECORD_SELECT).in('run_key', ks).limit(KEY_CHUNK),
    )));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const results = await Promise.race([request, timeout]);
    if (!results) return new Map();
    const map = new Map<string, RunFightRecord>();
    for (const r of results) {
      if (r.error || !r.data) continue;
      for (const row of r.data as Record<string, unknown>[]) { const rec = asRunFightRecord(row); if (rec) map.set(rec.runKey, rec); }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** The LOBBY STRENGTH of a finished lobby (owner 2026-09-22): ONE fetch of the seven opponent keys' records
 *  from the view, folded through the sim's formula. A bot key never hits the network (it is a fixed 25). Null
 *  when nothing could be read (no backend, timeout, the view not migrated yet) — the run then carries no
 *  strength stamp rather than a guessed one. The SERVER recomputes its own copy at settle time; this is what the
 *  Career and Recent Games rows print. */
export async function fetchLobbyStrength(opponentKeys: string[], ownRows: readonly FightRow[] = []): Promise<LobbyStrength | null> {
  const c = client();
  if (!c || opponentKeys.length === 0) return null;
  const real = opponentKeys.filter((k) => !k.startsWith('bot:'));
  const records = new Map<string, RunFightRecord>();
  if (real.length > 0) {
    // `fetchRunFightRecords` swallows failures into an empty map; tell "the view answered" apart from "we
    // could not ask" with one direct probe of the same shape so a dead backend never stamps a 50.
    try {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
      const probe = await Promise.race([Promise.resolve(c.from('run_fight_records').select(FIGHT_RECORD_SELECT).in('run_key', real.slice(0, KEY_CHUNK)).limit(KEY_CHUNK)), timeout]);
      if (!probe || probe.error || !probe.data) return null;
      for (const row of probe.data as Record<string, unknown>[]) { const rec = asRunFightRecord(row); if (rec) records.set(rec.runKey, rec); }
    } catch {
      return null;
    }
  }
  const inputs: StrengthInput[] = opponentKeys.map((key) => {
    const rec = records.get(key);
    return { key, fights: rec?.fights ?? 0, wins: rec?.wins ?? 0 };
  });
  // The field GOING IN: this lobby's own fights (the rows the run-end tick uploads) are subtracted, exactly as
  // `settle_rank` excludes them by `lobby_seed`, so the Career and Recent Games stamps agree (owner 2026-09-22).
  return lobbyStrengthOf(excludeOwnFights(inputs, ownRows));
}

/** The Hall's page size and its qualifying bar (owner 2026-09-22: "Minimum fights to qualify for the Hall —
 *  let's start at 10"). */
export const HALL_ROWS = 10;
export const HALL_MIN_FIGHTS = 10;

/** THE HALL (owner 2026-09-22: "what board has been the best against everything else … what the top 10 are in
 *  that category"): the top `limit` runs by the Wilson lower bound of their win rate, with at least `minFights`
 *  fights, from EVERY recorded run in the view — never only lobby winners, never a bot key. Ties break on more
 *  fights, then the most recent fight. Best-effort + time-boxed; `[]` on any failure / no backend / a
 *  not-yet-migrated view (the Hall then shows its empty state). */
export async function fetchHallRecords(limit = HALL_ROWS, minFights = HALL_MIN_FIGHTS): Promise<RunFightRecord[]> {
  const c = client();
  if (!c) return [];
  try {
    const request = Promise.resolve(
      c.from('run_fight_records').select(FIGHT_RECORD_SELECT)
        .not('run_key', 'like', 'bot:%').gte('fights', minFights)
        .order('wilson_lb', { ascending: false }).order('fights', { ascending: false }).order('last_fight_at', { ascending: false, nullsFirst: false })
        .limit(limit),
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return [];
    return (result.data as Record<string, unknown>[]).map(asRunFightRecord).filter((r): r is RunFightRecord => r !== null);
  } catch {
    return [];
  }
}

/** What a Hall row reads off the run's OWN career row (`run_history`, by seed): the rank its player held when
 *  the game was played (`entry.rank.before`, stamped by `settle_rank`), the run's own W–L–D ("12–3", what the
 *  player saw — it counts their ghost fights, which the fight ledger deliberately does not), when it ended, its
 *  placement, and its final warband (`entry.board`, the same end-state board the Career shows). */
export interface HallHistoryFacts {
  seed: number;
  /** The display name the row was stamped with at run end (`entry.author`, 2026-09-22); null on older rows. */
  author: string | null;
  heroId: string | null;
  rank: RankPosition | null;
  record: { wins: number; losses: number; draws: number } | null;
  at: string | null;
  placement: number | null;
  board: BoardSnapshot | null;
}

/** The career facts for a set of run seeds (owner 2026-09-22: "the rank that the player was from that
 *  snapshot"). Fetched by seed (the only key on the row), then filed under `hallHistoryKeyOf`: a row stamped
 *  with its author under its FULL run key (`author|heroId|seed`), an older row under `seed:<seed>` — so two
 *  players on the same shared seed with the same hero each keep their own row (review fix 2026-09-22). A run
 *  with no history row (an unrated or pre-history run) is simply absent. Reads EVERY placement — a Hall
 *  candidate need not have won its own lobby. Best-effort + time-boxed. */
export async function fetchHallHistory(seeds: number[]): Promise<Map<string, HallHistoryFacts>> {
  const c = client();
  const ids = [...new Set(seeds.filter((x) => Number.isFinite(x)))];
  if (!c || ids.length === 0) return new Map();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += KEY_CHUNK) chunks.push(ids.slice(i, i + KEY_CHUNK));
  try {
    const request = Promise.all(chunks.map((xs) => Promise.resolve(
      c.from('run_history').select('placement, entry').eq('mode', 'lobby').in('entry->>seed', xs.map(String)).limit(FETCH_LIMIT),
    )));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const results = await Promise.race([request, timeout]);
    if (!results) return new Map();
    const map = new Map<string, HallHistoryFacts>();
    for (const r of results) {
      if (r.error || !r.data) continue;
      for (const row of r.data as Array<{ placement?: unknown; entry: Record<string, unknown> | null }>) {
        const e = row.entry ?? {};
        const seed = Number(e.seed);
        if (!Number.isFinite(seed)) continue;
        const author = typeof e.author === 'string' ? e.author : null;
        const heroId = typeof e.heroId === 'string' ? e.heroId : null;
        const key = hallHistoryKeyOf(author, heroId, seed);
        if (map.has(key)) continue;
        const before = (e.rank as { before?: unknown } | undefined)?.before;
        const wins = numOf(e.wins); const losses = numOf(e.losses); const draws = numOf(e.draws);
        map.set(key, {
          seed,
          author,
          heroId,
          rank: isRankPosition(before) ? before : null,
          record: wins !== null ? { wins, losses: losses ?? 0, draws: draws ?? 0 } : null,
          at: typeof e.at === 'string' ? e.at : typeof e.date === 'string' ? e.date : null,
          placement: numOf(row.placement) ?? numOf(e.placement),
          board: boardOf(e.board),
        });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** The OWN-GAME record of each Hall candidate, from the fight ledger (owner 2026-09-23: "ledger number probably
 *  i think" — the Hall's "Own game" line must count the same fights as its RECORD line). ONE batched read of the
 *  raw ledger rows for all the candidates' lobbies at once (`lobby_fights` where `lobby_seed in (...)`, four
 *  small columns), then `ownGameRecordsOf` files each run's rows from its side by key, client-side. Never a
 *  per-row query. The Hall is the one place the client reads ledger ROWS rather than the view: the view has no
 *  per-lobby cut and ten lobbies are at most a few hundred rows. A run whose lobby has no rows (a game from
 *  before the ledger) is absent, and the Hall falls back to the career tally and labels it. Best-effort +
 *  time-boxed; an empty map on any failure. */
export async function fetchHallOwnGames(runs: Array<{ key: string; seed: number }>): Promise<Map<string, HallOwnRecord>> {
  const c = client();
  const seeds = [...new Set(runs.map((r) => r.seed).filter((x) => Number.isFinite(x)))];
  if (!c || seeds.length === 0) return new Map();
  try {
    const request = Promise.resolve(c.from('lobby_fights').select('lobby_seed, run_a, run_b, outcome').in('lobby_seed', seeds).limit(FETCH_LIMIT));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return new Map();
    const fights: HallLedgerFight[] = [];
    for (const row of result.data as Record<string, unknown>[]) {
      const lobbySeed = numOf(row.lobby_seed);
      const outcome = row.outcome;
      if (lobbySeed === null || typeof row.run_a !== 'string' || typeof row.run_b !== 'string') continue;
      if (outcome !== 'a' && outcome !== 'b' && outcome !== 'draw') continue;
      fights.push({ lobbySeed, runA: row.run_a, runB: row.run_b, outcome });
    }
    return ownGameRecordsOf(runs, fights);
  } catch {
    return new Map();
  }
}

/** The final warband of a run that has no career row to read it from: its HIGHEST-WAVE snapshot in the pool
 *  (`boards`, by author + hero + seed, `order wave desc limit 1` — one row, one jsonb, a few KB). Ten of these
 *  in parallel is trivial at friend scale. Keyed by run key; a run with no board in the pool is absent. */
export async function fetchRunFinalBoards(runs: Array<{ key: string; author: string; heroId: string; seed: number }>): Promise<Map<string, BoardSnapshot>> {
  const c = client();
  if (!c || runs.length === 0) return new Map();
  try {
    const request = Promise.all(runs.map((r) => Promise.resolve(
      c.from(TABLE).select('snapshot').eq('author', r.author).eq('hero_id', r.heroId).eq('seed', r.seed).order('wave', { ascending: false }).limit(1),
    )));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const results = await Promise.race([request, timeout]);
    if (!results) return new Map();
    const map = new Map<string, BoardSnapshot>();
    results.forEach((res, i) => {
      if (res.error || !res.data?.length) return;
      const board = boardOf((res.data[0] as { snapshot?: unknown }).snapshot);
      if (board) map.set(runs[i]!.key, board);
    });
    return map;
  } catch {
    return new Map();
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
