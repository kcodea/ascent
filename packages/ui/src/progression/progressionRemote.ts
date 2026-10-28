/**
 * ACCOUNT PROGRESSION: the network seam (2026-09-27). Every Supabase call the progression feature makes lives
 * here, so the queue, the store and the screens stay testable with a fake client.
 *
 *  - `submitProgression`: the `submit-progression` Edge Function (the ONLY XP writer). Mirrors `submitRating`:
 *    definite refusals (400 / 409 / 422) are `rejected`, everything transport-shaped (offline, timeout, 401,
 *    404 before the function is deployed, 429, 5xx) is `retryable` so the durable queue keeps the request.
 *  - `fetchProgressionEnabled`: the CAPABILITY PROBE. The feature is off until the owner has run the migration
 *    AND set `progression_config.epoch`; until then the client queues nothing and shows nothing.
 *  - `fetchOwnProgression` / `fetchPublicProgression`: the profile columns (+ titles) for the mirror and Career.
 *  - CRATES (2026-09-28): `fetchCratesEnabled` (the second probe: the crates migration has run and
 *    `crates_enabled` is on), `fetchOwnCrates`, and the `progression-inventory` Edge Function (`openCrateRemote`,
 *    `equipTitleRemote`). Opening and equipping are interactive and never queued: a failure is shown, not retried.
 *  - THE COLLECTION'S SEEN LIST (2026-10-11): `fetchSeenCosmeticIds` reads which owned items the account has looked
 *    at (`player_cosmetics.seen_at`), `markCosmeticsSeenRemote` marks more (the `mark_cosmetics_seen` function).
 *  - AETHER + THE CRATE SHOP (2026-10-18): `fetchAetherEnabled` (the third probe, `progression_config.aether_enabled`),
 *    `fetchAetherEconomy` (the public `aether_config` row: prices, fee table, rewards), and `buyCrateRemote` (the
 *    `buy_crate` action: the client names a tier, a focus, the total it was shown and a request id; the server prices,
 *    charges and rolls). `openCrateRemote` also carries a milestone crate's focus + the fee the player was shown.
 *
 * Never throws; every read is time-boxed.
 */
import {
  COSMETIC_INDEX, parseServerCatalogState, type ServerCatalogState, type EquipSlot, PROGRESSION_RULES_VERSION, TUTORIAL_COURSE_ID, TUTORIAL_COURSE_VERSION, parseCrate, parseOpenCrateResult, parseProgressionProfile,
  parseProgressionResult, parseAetherEconomy, parseBuyCrateResult, type AetherEconomy, type BuyCrateResult, type CosmeticCategory, type CrateRow, type CrateTier, type OpenCrateResult, type ProgressionMode, type ProgressionProfile, type ProgressionResult,
  type ProgressionRunFacts, factsAsV1, loadoutFromRows, type RunCosmeticSnapshot,
} from '@game/progression';
import { currentUserId } from '../identity';
import { supabaseClient } from '../remoteBoards';
import { fetchAllRows } from '../supabaseRows';

const SUBMIT_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 4_000;

/** What the client sends to settle ONE run. Pinned at run end and retried byte for byte. Never an XP number. */
export interface ProgressionSubmitRequest {
  mode: ProgressionMode;
  /** Ranked: the rank run id. Practice: `practice:<row id>`. Tutorial: `learn-ascent:v1`. */
  runId: string;
  rulesVersion: number;
  comeback?: boolean;
  /** Practice: the `practice_games` row id. */
  sourceId?: number;
  courseId?: string;
  courseVersion?: number;
  /** The run's fact document, stored with the ledger row for audit. */
  facts?: ProgressionRunFacts | null;
}

export type ProgressionSubmitOutcome =
  | { status: 'confirmed'; result: ProgressionResult; profile: ProgressionProfile; deduped: boolean }
  | { status: 'retryable'; reason: string }
  | { status: 'rejected'; reason: string };

/**
 * Build the request for one finished run's facts (tutorial requests carry the course pin instead).
 *
 * ACHIEVEMENTS (2026-09-28): the facts go up as V2 (with the run metrics) ONLY when `withMetrics` says the server
 * evaluates achievements (the owner has set the achievements epoch, which follows the Edge Function deploy). Any
 * other time they go up as V1: a server from before achievements refuses a V2 document as `bad_facts`, which the
 * queue would treat as permanent, and the game's XP would be lost.
 */
export function progressionRequestFor(facts: ProgressionRunFacts, sourceId?: number, withMetrics = false): ProgressionSubmitRequest {
  const base = { mode: facts.mode, runId: facts.runId, rulesVersion: PROGRESSION_RULES_VERSION, facts: withMetrics ? facts : factsAsV1(facts) };
  if (facts.mode === 'tutorial') return { ...base, courseId: TUTORIAL_COURSE_ID, courseVersion: TUTORIAL_COURSE_VERSION };
  return { ...base, comeback: facts.comebackAfterFourLosses, ...(facts.mode === 'practice' && sourceId != null ? { sourceId } : {}) };
}

const timeout = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

export async function submitProgression(req: ProgressionSubmitRequest): Promise<ProgressionSubmitOutcome> {
  const c = supabaseClient();
  if (!c) return { status: 'retryable', reason: 'no_backend' };
  if (!currentUserId()) return { status: 'retryable', reason: 'no_session' };
  const body: Record<string, unknown> = { mode: req.mode, runId: req.runId, rulesVersion: req.rulesVersion };
  if (req.comeback !== undefined) body.comeback = req.comeback;
  if (req.sourceId !== undefined) body.sourceId = req.sourceId;
  if (req.courseId !== undefined) body.courseId = req.courseId;
  if (req.courseVersion !== undefined) body.courseVersion = req.courseVersion;
  if (req.facts) body.facts = req.facts;
  try {
    const call = c.functions.invoke('submit-progression', { body }) as Promise<{ data: unknown; error: unknown }>;
    const raced = await Promise.race([call, timeout(SUBMIT_TIMEOUT_MS, { timedOut: true } as const)]);
    if ('timedOut' in raced) return { status: 'retryable', reason: 'timeout' };
    if (raced.error) return classifyFunctionError(raced.error);
    return parseSubmitResponse(raced.data);
  } catch (e) {
    return { status: 'retryable', reason: `network:${(e as Error)?.message ?? 'unknown'}` };
  }
}

async function classifyFunctionError(err: unknown): Promise<ProgressionSubmitOutcome> {
  const e = err as { name?: string; message?: string; context?: { status?: number; json?: () => Promise<unknown> } };
  const status = e.context?.status;
  let code = '';
  try {
    const parsed = e.context?.json ? await e.context.json() : null;
    code = typeof (parsed as { error?: unknown } | null)?.error === 'string' ? (parsed as { error: string }).error : '';
  } catch { /* no readable body */ }
  if (status === 400 || status === 409 || status === 422) return { status: 'rejected', reason: code || `http_${status}` };
  return { status: 'retryable', reason: code || (status ? `http_${status}` : e.message || e.name || 'function_error') };
}

function parseSubmitResponse(data: unknown): ProgressionSubmitOutcome {
  const o = (data ?? {}) as { result?: unknown; profile?: unknown; deduped?: unknown; error?: unknown };
  if (typeof o.error === 'string') return { status: 'rejected', reason: o.error };
  const result = parseProgressionResult(o.result);
  const profile = parseProgressionProfile(o.profile);
  if (!result || !profile) return { status: 'rejected', reason: 'server_outdated' };
  return { status: 'confirmed', result, profile, deduped: o.deduped === true };
}

// ── progression_config, read ONCE per session (Supabase cleanup P1.2, 2026-10-28) ──────────────────────────
/** Row 1 of `progression_config` as the client reads it. Every column is optional: an older server lacks the newer ones. */
export interface ProgressionConfigRow {
  epoch?: unknown; crates_enabled?: unknown; aether_enabled?: unknown; achievements_epoch?: unknown;
  /** md5 of the kill-switch state the client reads (`cosmetic_catalog` + `cosmetic_categories`), kept by a trigger. */
  catalog_state_hash?: unknown;
}
/** `row` = answered (null = no table / no row: every probe is off); `undefined` = could not ask. */
type ConfigAnswer = { row: ProgressionConfigRow | null } | undefined;
let configRead: Promise<ConfigAnswer> | null = null;
/** DEV/tests: how many `progression_config` requests this session has sent. */
export const progressionConfigStats = { requests: 0 };

/**
 * The ONE `progression_config` read. The four probes (epoch, crates, achievements, Aether) and the catalog hash all
 * come from this row, which used to be four single-column requests on every auth event. A successful answer is kept
 * for the session (the switches change a few times a month; a new session picks a flip up); a failed one is not, so
 * the next probe asks again. `select('*')` so an older server simply lacks the newer columns instead of erroring.
 */
export function fetchProgressionConfig(): Promise<ConfigAnswer> {
  if (configRead) return configRead;
  const p = (async (): Promise<ConfigAnswer> => {
    try {
      const c = supabaseClient();
      if (!c) return undefined;
      progressionConfigStats.requests++;
      const res = await Promise.race([
        Promise.resolve(c.from('progression_config').select('*').eq('id', 1).limit(1)),
        timeout(READ_TIMEOUT_MS, null),
      ]);
      if (!res) return undefined;
      if (res.error) {
        // A missing table (the migration not run) is a definite "off"; anything else is "could not ask".
        const code = String((res.error as { code?: string }).code ?? '');
        return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703' ? { row: null } : undefined;
      }
      return { row: (res.data as ProgressionConfigRow[] | null)?.[0] ?? null };
    } catch {
      return undefined;
    }
  })();
  configRead = p;
  void p.then((a) => { if (a === undefined && configRead === p) configRead = null; });
  return p;
}
/** Tests: forget the session's config answer. */
export function resetProgressionConfigForTests(): void { configRead = null; progressionConfigStats.requests = 0; }

const nonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

/**
 * THE CAPABILITY PROBE. `true` = the migration has run AND the owner set the epoch; `false` = asked, and it is
 * off (no table yet, or no epoch); `undefined` = could not ask (no backend, offline, timeout).
 */
export async function fetchProgressionEnabled(): Promise<boolean | undefined> {
  const a = await fetchProgressionConfig();
  return a && nonEmptyString(a.row?.epoch);
}

const PROFILE_COLUMNS = 'account_xp, account_level, progression_revision, equipped_title_id';

/** THIS account's authoritative progression. `undefined` = could not ask; `null` = no profile row yet. */
export async function fetchOwnProgression(): Promise<ProgressionProfile | null | undefined> {
  const userId = currentUserId();
  if (!userId) return undefined;
  return fetchProgressionOf(userId, true);
}

/** Any player's PUBLIC progression (level, XP, equipped title, owned titles), for Career. */
export async function fetchPublicProgression(userId: string): Promise<ProgressionProfile | null | undefined> {
  return fetchProgressionOf(userId);
}

async function fetchProgressionOf(userId: string, withWallet = false): Promise<ProgressionProfile | null | undefined> {
  const c = supabaseClient();
  if (!c || !userId) return undefined;
  try {
    const [prof, owned, loadout, wallet] = await Promise.race([
      Promise.all([
        Promise.resolve(c.from('profiles').select(PROFILE_COLUMNS).eq('user_id', userId).limit(1)),
        fetchOwnedCosmeticIds(userId),
        fetchLoadoutRows(userId),
        // AETHER (2026-10-18): the balance is the OWN profile's only (owner-read by RLS); another player's never asks.
        withWallet ? fetchOwnAetherBalance(userId) : Promise.resolve(null),
      ]),
      timeout(READ_TIMEOUT_MS, [null, null, null, null] as const),
    ]);
    if (!prof || prof.error) return undefined; // pre-migration columns, offline, timeout
    const row = (prof.data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) return null;
    return parseProgressionProfile({
      accountXp: row.account_xp, accountLevel: row.account_level, revision: row.progression_revision,
      equippedTitleId: row.equipped_title_id, titles: owned?.titles ?? [],
      // Skins (2026-09-28): every owned id + the loadout rows. Left out when unreadable, so the parser omits them.
      ...(owned ? { cosmetics: owned.all } : {}),
      ...(loadout ? { loadout } : {}),
      // Left out when unreadable (a pre-Aether server, an error, a timeout): the store then keeps the balance it had.
      ...(wallet !== null ? { aether: wallet } : {}),
    }) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * THIS account's Aether balance (`aether_wallets.balance`, owner-read by RLS). A missing row is 0 (nothing earned yet).
 * Null = could not read it (the table is not there on a pre-Aether server, any other error, a timeout): the caller leaves
 * `aether` OUT of the profile, so a failed read never shows as a zero balance and never fails the profile read.
 */
async function fetchOwnAetherBalance(userId: string): Promise<number | null> {
  const c = supabaseClient();
  if (!c) return null;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('aether_wallets').select('balance').eq('user_id', userId).limit(1)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return null;
    const row = (res.data as Array<{ balance?: unknown }> | null)?.[0];
    if (!row) return 0;
    const n = typeof row.balance === 'number' ? row.balance : typeof row.balance === 'string' && /^\d+$/.test(row.balance) ? Number(row.balance) : null;
    return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * A player's owned cosmetics, oldest first: `titles` (the titles, as before) and `all` (every category, skins
 * included, since 2026-09-28). Ownership of every cosmetic is `player_cosmetics` (public read), classified through
 * the catalog; before the crates migration runs it falls back to the MVP's `player_titles`. Null = could not ask.
 */
async function fetchOwnedCosmeticIds(userId: string): Promise<{ titles: string[]; all: string[] } | null> {
  const c = supabaseClient();
  if (!c) return null;
  const owned = await fetchAllRows<{ cosmetic_id?: unknown; cosmetic_catalog?: { category?: unknown } | null }>((from, to) =>
    c.from('player_cosmetics').select('cosmetic_id, unlocked_at, cosmetic_catalog(category)').eq('user_id', userId)
      .order('unlocked_at', { ascending: true }).order('cosmetic_id', { ascending: true }).range(from, to),
  );
  if (!owned.error) {
    const rows = owned.data ?? [];
    const ids = (xs: typeof rows): string[] => xs.map((r) => r.cosmetic_id).filter((t): t is string => typeof t === 'string');
    return {
      titles: ids(rows.filter((r) => (r.cosmetic_catalog?.category ?? COSMETIC_INDEX[String(r.cosmetic_id)]?.category) === 'title')),
      all: ids(rows),
    };
  }
  const legacy = await fetchAllRows<{ title_id?: unknown }>((from, to) => c.from('player_titles').select('title_id, unlocked_at').eq('user_id', userId)
    .order('unlocked_at', { ascending: true }).order('title_id', { ascending: true }).range(from, to));
  if (legacy.error) return null;
  const titles = (legacy.data ?? []).map((r) => r.title_id).filter((t): t is string => typeof t === 'string');
  return { titles, all: titles };
}

/**
 * THE COLLECTION'S SEEN LIST, from the account (owner 2026-10-11: "i want to save the 'seen' on the account level"):
 * the ids of the owned items this account has looked at, on any device. `'unsupported'` = asked, and the server is
 * from before the seen migration (no `seen_at` column, or no ownership table): the list then lives on the device.
 * `undefined` = could not ask (no backend, offline, timeout): say nothing, keep what the device has.
 */
export async function fetchSeenCosmeticIds(userId: string): Promise<string[] | 'unsupported' | undefined> {
  try {
    const c = supabaseClient();
    if (!c) return undefined;
    const res = await Promise.race([
      fetchAllRows<{ cosmetic_id?: unknown }>((from, to) => c.from('player_cosmetics').select('cosmetic_id').eq('user_id', userId)
        .not('seen_at', 'is', null).order('cosmetic_id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res) return undefined;
    if (res.error) {
      // ONLY a definite "no such column / table" means the list is the device's. Anything else is "could not ask":
      // guessing 'unsupported' on a hiccup would let a device take its own baseline over the account's list.
      const code = String((res.error as { code?: string }).code ?? '');
      return code === '42703' || code === 'PGRST204' || code === '42P01' || code === 'PGRST205' ? 'unsupported' : undefined;
    }
    return (res.data ?? []).map((r) => r.cosmetic_id).filter((t): t is string => typeof t === 'string');
  } catch {
    return undefined;
  }
}

/** Mark THIS account's `ids` as seen (`mark_cosmetics_seen`: it only ever touches the caller's own unseen items).
 *  False = it did not get through; the caller sends them again the next time they are looked at. */
export async function markCosmeticsSeenRemote(ids: readonly string[]): Promise<boolean> {
  try {
    const c = supabaseClient();
    if (!c || !ids.length) return false;
    const res = await Promise.race([
      // rows: a write that answers one scalar (how many it marked), never a list
      Promise.resolve(c.rpc('mark_cosmetics_seen', { p_ids: [...ids] })),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    return !!res && !res.error;
  } catch {
    return false;
  }
}

/**
 * A player's equipped skins (`cosmetic_loadouts`, public read), as loadout rows. Retired items are INCLUDED here
 * (the table keeps them); every renderer drops them through `isCosmeticLive`. Null = could not ask (or the table
 * is not there yet), which leaves the profile without a loadout: default art.
 */
async function fetchLoadoutRows(userId: string): Promise<Array<{ slot: string; targetId: string; cosmeticId: string }> | null> {
  const c = supabaseClient();
  if (!c) return null;
  try {
    const res = await fetchAllRows((from, to) => c.from('cosmetic_loadouts').select('slot, target_id, cosmetic_id').eq('user_id', userId)
      .order('slot', { ascending: true }).order('target_id', { ascending: true }).range(from, to));
    if (res.error) return null;
    return ((res.data as Array<{ slot?: unknown; target_id?: unknown; cosmetic_id?: unknown }> | null) ?? [])
      .filter((r) => typeof r.slot === 'string' && typeof r.target_id === 'string' && typeof r.cosmetic_id === 'string')
      .map((r) => ({ slot: r.slot as string, targetId: r.target_id as string, cosmeticId: r.cosmetic_id as string }));
  } catch {
    return null;
  }
}

/**
 * THE LEADERBOARD'S PORTRAITS (owner 2026-10-12: "the portrait skins should show here"): the equipped HERO SKINS and
 * PORTRAIT FRAME of several players at once (owner 2026-10-16: "the player frames they have equipped arent showing
 * here and they should"), from the same public `cosmetic_loadouts` table the Career page reads (`fetchLoadoutRows`),
 * in ONE paged read (`.in('user_id', …)`, `fetchAllRows`), folded per player through the same `loadoutFromRows`. Only
 * the `hero_skin` and `portrait_frame` slots are read: a row prints one portrait in one ring, never a minion. A player
 * with neither is absent from the map (default art, default ring). An empty map on any failure (never a throw).
 */
export const PORTRAIT_LOADOUT_SLOTS = ['hero_skin', 'portrait_frame'] as const;
export async function fetchPortraitLoadouts(userIds: readonly string[]): Promise<Map<string, RunCosmeticSnapshot>> {
  const out = new Map<string, RunCosmeticSnapshot>();
  const ids = [...new Set(userIds.filter((u) => typeof u === 'string' && u.length > 0))];
  const c = supabaseClient();
  if (!c || ids.length === 0) return out;
  try {
    const res = await Promise.race([
      fetchAllRows<{ user_id?: unknown; slot?: unknown; target_id?: unknown; cosmetic_id?: unknown }>((from, to) =>
        c.from('cosmetic_loadouts').select('user_id, slot, target_id, cosmetic_id').in('user_id', ids).in('slot', [...PORTRAIT_LOADOUT_SLOTS])
          .order('user_id', { ascending: true }).order('slot', { ascending: true }).order('target_id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error || !res.data) return out;
    const byUser = new Map<string, unknown[]>();
    for (const r of res.data) {
      if (typeof r.user_id !== 'string') continue;
      const list = byUser.get(r.user_id) ?? [];
      list.push(r);
      byUser.set(r.user_id, list);
    }
    for (const [u, rows] of byUser) {
      const snap = loadoutFromRows(rows);
      if (snap.heroSkinByHeroId || snap.portraitFrame) out.set(u, snap);
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * THE SERVER'S KILL SWITCH (2026-09-28): which catalog items and categories the owner has switched off, read
 * from the two public tables. `undefined` = could not ask (offline, no backend, pre-migration): the bundled
 * catalog stays in charge.
 */
export async function fetchServerCatalogState(): Promise<ServerCatalogState | undefined> {
  const c = supabaseClient();
  if (!c) return undefined;
  try {
    // The owner's emergency switch (`admin_off`) is read with the code-owned flag. A server from before the skins
    // SQL has no such column: read the flags alone rather than lose the answer.
    // SUPABASE CLEANUP P1.2 (2026-10-28): only the switched-off items cross the wire. `parseServerCatalogState` keeps
    // nothing else, so the answer is identical, and the read drops from the whole 458-row list (33.8 KB) to the few
    // retired ids. Categories are a handful of rows and stay a full read.
    const read = (withAdmin: boolean) => Promise.race([
      Promise.all([
        fetchAllRows((from, to) => (withAdmin
          ? c.from('cosmetic_catalog').select('cosmetic_id, active, admin_off').or('active.eq.false,admin_off.eq.true')
          : c.from('cosmetic_catalog').select('cosmetic_id, active').eq('active', false)).order('cosmetic_id', { ascending: true }).range(from, to)),
        fetchAllRows((from, to) => c.from('cosmetic_categories').select(withAdmin ? 'category, enabled, admin_off' : 'category, enabled').order('category', { ascending: true }).range(from, to)),
      ]),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    let res = await read(true);
    if (res && (res[0].error || res[1].error)) res = await read(false);
    if (!res || res[0].error || res[1].error) return undefined;
    return parseServerCatalogState(res[0].data, res[1].data);
  } catch {
    return undefined;
  }
}

// ── Crates (2026-09-28) ───────────────────────────────────────────────────────────────────────────────────

/**
 * THE CRATES PROBE. `true` = the crates migration has run and `progression_config.crates_enabled` is on;
 * `false` = asked, and it is not (no column yet, or switched off); `undefined` = could not ask.
 */
export async function fetchCratesEnabled(): Promise<boolean | undefined> {
  const a = await fetchProgressionConfig();
  return a && a.row?.crates_enabled === true;
}

const CRATE_COLUMNS = 'crate_id, earned_level, state, reward_cosmetic_id, earned_at, opened_at';
/** `source` (2026-09-29, the Gauntlet migration) then `floor_rarity` + `focus_categories` (2026-10-18, the Aether migration). */
const CRATE_COLUMNS_FULL = `${CRATE_COLUMNS}, source, floor_rarity, focus_categories`;
/** The Gauntlet-era shape, the fallback for a server that has `source` but not the Aether columns yet. */
const CRATE_COLUMNS_SOURCE = `${CRATE_COLUMNS}, source`;

/**
 * THIS account's crates (owner-only read), oldest level first (a level-less Gauntlet or shop crate after them).
 * `source` (2026-09-29) names a Gauntlet crate's stage; `floor_rarity` + `focus_categories` (2026-10-18) carry a shop
 * or milestone crate's floor and focus. A server from before either migration lacks those columns, so a missing-column
 * error steps down one shape at a time (full -> `source` only -> the base columns) and crates keep loading on an
 * older server. `undefined` = could not ask.
 */
export async function fetchOwnCrates(): Promise<CrateRow[] | undefined> {
  const c = supabaseClient();
  const userId = currentUserId();
  if (!c || !userId) return undefined;
  try {
    const read = (columns: string) => Promise.race([
      fetchAllRows((from, to) => c.from('loot_crates').select(columns).eq('user_id', userId).order('earned_level', { ascending: true }).order('crate_id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    const missingColumn = (r: Awaited<ReturnType<typeof read>>): boolean => {
      const code = r?.error ? String((r.error as { code?: string }).code ?? '') : '';
      return code === '42703' || code === 'PGRST204';
    };
    let res = await read(CRATE_COLUMNS_FULL);
    if (missingColumn(res)) res = await read(CRATE_COLUMNS_SOURCE);
    if (missingColumn(res)) res = await read(CRATE_COLUMNS);
    if (!res || res.error) return undefined;
    return ((res.data as unknown[] | null) ?? []).map(parseCrate).filter((x): x is CrateRow => !!x);
  } catch {
    return undefined;
  }
}

export type InventoryOutcome<T> = { status: 'ok'; value: T; profile: ProgressionProfile } | { status: 'error'; reason: string };

async function invokeInventory(body: Record<string, unknown>): Promise<{ data: Record<string, unknown> } | { error: string }> {
  const c = supabaseClient();
  if (!c) return { error: 'no_backend' };
  if (!currentUserId()) return { error: 'no_session' };
  try {
    const call = c.functions.invoke('progression-inventory', { body }) as Promise<{ data: unknown; error: unknown }>;
    const raced = await Promise.race([call, timeout(SUBMIT_TIMEOUT_MS, { timedOut: true } as const)]);
    if ('timedOut' in raced) return { error: 'timeout' };
    if (raced.error) {
      const e = raced.error as { context?: { status?: number; json?: () => Promise<unknown> }; message?: string };
      let code = '';
      try {
        const parsed = e.context?.json ? await e.context.json() : null;
        code = typeof (parsed as { error?: unknown } | null)?.error === 'string' ? (parsed as { error: string }).error : '';
      } catch { /* no readable body */ }
      return { error: code || (e.context?.status ? `http_${e.context.status}` : e.message || 'function_error') };
    }
    return { data: (raced.data ?? {}) as Record<string, unknown> };
  } catch (e) {
    return { error: `network:${(e as Error)?.message ?? 'unknown'}` };
  }
}

/**
 * Open one crate. The server picks the reward; the client only names the crate. A MILESTONE crate (2026-10-18) may be
 * focused at the opening: `focus` names the categories and `expectedFee` is the Aether fee the player was shown (the
 * server refuses a stale one, and requires it whenever `focus` is non-null). Omitted, the call is the plain open.
 */
export async function openCrateRemote(crateId: string, focus?: CosmeticCategory[] | null, expectedFee?: number): Promise<InventoryOutcome<OpenCrateResult>> {
  const body: Record<string, unknown> = { action: 'open_crate', crateId };
  if (focus != null) body.focus = focus;
  if (expectedFee !== undefined) body.expectedFee = expectedFee;
  const r = await invokeInventory(body);
  if ('error' in r) return { status: 'error', reason: r.error };
  const value = parseOpenCrateResult(r.data);
  const profile = parseProgressionProfile(r.data.profile);
  if (!value || !profile) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', value, profile };
}

/** What the client sends to BUY a crate. The server prices it; `expectedTotal` is only the price the player was shown. */
export interface BuyCrateRequest {
  tier: CrateTier;
  /** The ticked categories, or null for an unfocused crate. */
  focus: CosmeticCategory[] | null;
  /** Crate price + focus fee as the player saw it. A moved price answers `price_changed`, never a silent re-price. */
  expectedTotal: number;
  /** One per buy attempt: a replay of the same id is answered `already_opened` and charges nothing twice. */
  requestId: string;
}

/**
 * Buy and open a crate in one call (the `buy_crate` action). Errors come back as the server's code (`price_changed`,
 * `insufficient_aether`, `sold_out`, `bad_focus`, `focus_not_allowed`, `aether_disabled`, and the retryable
 * `aether_config_missing`); nothing is retried here, the UI decides.
 */
export async function buyCrateRemote(req: BuyCrateRequest): Promise<InventoryOutcome<BuyCrateResult>> {
  const r = await invokeInventory({ action: 'buy_crate', tier: req.tier, focus: req.focus, expectedTotal: req.expectedTotal, requestId: req.requestId });
  if ('error' in r) return { status: 'error', reason: r.error };
  const value = parseBuyCrateResult(r.data);
  const profile = parseProgressionProfile(r.data.profile);
  if (!value || !profile) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', value, profile };
}

// ── Aether (2026-10-18) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * THE AETHER PROBE. `true` = the Aether migration has run and `progression_config.aether_enabled` is on; `false` =
 * asked, and it is not (no column yet, or switched off); `undefined` = could not ask. Read from the same row as the
 * crates probe, so crates and the shop can be switched independently.
 */
export async function fetchAetherEnabled(): Promise<boolean | undefined> {
  const a = await fetchProgressionConfig();
  return a && a.row?.aether_enabled === true;
}

/**
 * The live Aether economy (`aether_config` row 1, public read): prices, the focus fee table and the rewards, through
 * `parseAetherEconomy`. `undefined` = could not ask, no row, or a document that does not parse; the caller keeps the
 * economy it had (the bundled default at first), and the server prices every purchase regardless.
 */
export async function fetchAetherEconomy(): Promise<AetherEconomy | undefined> {
  const c = supabaseClient();
  if (!c) return undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('aether_config').select('economy').eq('id', 1).limit(1)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    const row = (res.data as Array<{ economy?: unknown }> | null)?.[0];
    return parseAetherEconomy(row?.economy) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Equip an owned title (null takes it off). The server checks ownership. */
export async function equipTitleRemote(titleId: string | null): Promise<InventoryOutcome<null>> {
  const r = await invokeInventory({ action: 'equip_title', titleId });
  if ('error' in r) return { status: 'error', reason: r.error };
  const profile = parseProgressionProfile(r.data.profile);
  if (!profile) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', value: null, profile };
}

/** Wear an owned skin on its target, or Default (null). The server checks ownership, target and that it is live. */
export async function equipCosmeticRemote(slot: EquipSlot, targetId: string, cosmeticId: string | null): Promise<InventoryOutcome<null>> {
  const r = await invokeInventory({ action: 'equip_cosmetic', slot, targetId, cosmeticId });
  if ('error' in r) return { status: 'error', reason: r.error };
  const profile = parseProgressionProfile(r.data.profile);
  if (!profile) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', value: null, profile };
}

// ── Achievements (2026-09-28) ─────────────────────────────────────────────────────────────────────────────────

/**
 * THE ACHIEVEMENTS PROBE. `true` = the achievements migration has run AND the owner set `achievements_epoch`
 * (which follows the `submit-progression` deploy); `false` = asked, and it is off; `undefined` = could not ask.
 * While it is not `true` there is no Achievements tab and settlements send V1 facts.
 */
export async function fetchAchievementsEnabled(): Promise<boolean | undefined> {
  const a = await fetchProgressionConfig();
  return a && nonEmptyString(a.row?.achievements_epoch);
}

/** One completed achievement (public: anyone's Career shows them). */
export interface AchievementCompletionRow { id: string; completedAt: string | null }

/** A player's completed achievements, newest first. `undefined` = could not ask. */
export async function fetchAchievementCompletions(userId: string): Promise<AchievementCompletionRow[] | undefined> {
  const c = supabaseClient();
  if (!c || !userId) return undefined;
  try {
    const res = await Promise.race([
      fetchAllRows((from, to) => c.from('achievement_completions').select('achievement_id, completed_at').eq('user_id', userId).order('completed_at', { ascending: false }).order('achievement_id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return ((res.data as Array<{ achievement_id?: unknown; completed_at?: unknown }> | null) ?? [])
      .filter((r) => typeof r.achievement_id === 'string')
      .map((r) => ({ id: r.achievement_id as string, completedAt: typeof r.completed_at === 'string' ? r.completed_at : null }));
  } catch {
    return undefined;
  }
}

/** THIS account's in-progress values (owner-only by RLS; another player's page never asks). `undefined` = could not ask. */
export async function fetchOwnAchievementProgress(): Promise<Record<string, number> | undefined> {
  const c = supabaseClient();
  const userId = currentUserId();
  if (!c || !userId) return undefined;
  try {
    const res = await Promise.race([
      fetchAllRows((from, to) => c.from('achievement_progress').select('achievement_id, progress').eq('user_id', userId).order('achievement_id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    const out: Record<string, number> = {};
    for (const r of (res.data as Array<{ achievement_id?: unknown; progress?: unknown }> | null) ?? []) {
      const n = typeof r.progress === 'number' ? r.progress : typeof r.progress === 'string' && /^\d+$/.test(r.progress) ? Number(r.progress) : null;
      if (typeof r.achievement_id === 'string' && n !== null) out[r.achievement_id] = n;
    }
    return out;
  } catch {
    return undefined;
  }
}

/** The ids the SERVER has switched off (`active = false` or the owner's `admin_off`). `undefined` = could not ask. */
export async function fetchRetiredAchievementIds(): Promise<string[] | undefined> {
  const c = supabaseClient();
  if (!c) return undefined;
  try {
    const res = await Promise.race([
      fetchAllRows((from, to) => c.from('achievement_catalog').select('achievement_id, active, admin_off').order('achievement_id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return ((res.data as Array<{ achievement_id?: unknown; active?: unknown; admin_off?: unknown }> | null) ?? [])
      .filter((r) => typeof r.achievement_id === 'string' && (r.active === false || r.admin_off === true))
      .map((r) => r.achievement_id as string);
  } catch {
    return undefined;
  }
}
