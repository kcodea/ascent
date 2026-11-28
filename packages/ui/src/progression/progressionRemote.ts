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
 *  - THE PACK ECONOMY (2026-12-01): `fetchPacksEnabled` (the fourth switch, `progression_config.packs_enabled`, from the
 *    same single config read), and the four pack actions of `progression-inventory`: `fetchPackShop`, `buyPackRemote`,
 *    `openPackRemote`, `claimPackRewardRemote`. Their refusals are JSON bodies (`status: 'error'`, `reason`), read intact.
 *
 * Never throws; every read is time-boxed.
 */
import {
  COSMETIC_INDEX, parseServerCatalogState, type ServerCatalogState, type EquipSlot, PROGRESSION_RULES_VERSION, TUTORIAL_COURSE_ID, TUTORIAL_COURSE_VERSION, parseCrate, parseOpenCrateResult, parseProgressionProfile,
  parseProgressionResult, parseAetherEconomy, parseBuyCrateResult, type AetherEconomy, type BuyCrateResult, type CosmeticCategory, type CrateRow, type CrateTier, type OpenCrateResult, type ProgressionMode, type ProgressionProfile, type ProgressionResult,
  type ProgressionRunFacts, factsAsV1, loadoutFromRows, type RunCosmeticSnapshot,
  COSMETIC_RARITIES, parsePackLook, parsePackOpenResult, type CrateRarity, type OwnedPack, type PackOffer, type PackOpenResult, type PackShelf,
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
  /** THE PACK ECONOMY's switch (2026-12-01): on = the Pack Shop replaces the Chest Shop and sealed chests are frozen. */
  packs_enabled?: unknown;
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

/**
 * GIFTS (owner 2026-11-13: "give Ionlime the cosmetic. have an alert next time he loads up the game"): the items the
 * owner handed THIS account directly (`player_cosmetics.source = 'gift'`) that it has not looked at yet (`seen_at`
 * null). `undefined` = could not ask (offline, a server from before the seen list): nothing is shown.
 */
export async function fetchUnseenGiftIds(userId: string): Promise<string[] | undefined> {
  try {
    const c = supabaseClient();
    if (!c) return undefined;
    const res = await Promise.race([
      fetchAllRows<{ cosmetic_id?: unknown }>((from, to) => c.from('player_cosmetics').select('cosmetic_id').eq('user_id', userId)
        .eq('source', 'gift').is('seen_at', null).order('cosmetic_id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return (res.data ?? []).map((row) => row.cosmetic_id).filter((t): t is string => typeof t === 'string');
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

/** An Aether gift from the Ascent team (owner 2026-11-20, R-PROG-GIFT-02): how much, and the reason in their words. */
export interface AetherGift { id: string; amount: number; reason: string }

/**
 * AETHER GIFTS: this account's gifts it has not seen yet (`aether_gifts`, owner-read by RLS), oldest first.
 * `undefined` = could not ask (offline, a server from before 2026-11-22-aether-gifts.sql): nothing is shown.
 */
export async function fetchUnseenAetherGifts(userId: string): Promise<AetherGift[] | undefined> {
  try {
    const c = supabaseClient();
    if (!c) return undefined;
    const res = await Promise.race([
      Promise.resolve(c.from('aether_gifts').select('gift_id, amount, reason').eq('user_id', userId).is('seen_at', null)
        .order('created_at', { ascending: true }).limit(20)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    const rows = (res.data as Array<{ gift_id?: unknown; amount?: unknown; reason?: unknown }> | null) ?? [];
    return rows.flatMap((r) => typeof r.gift_id === 'string' && typeof r.amount === 'number' && Number.isInteger(r.amount) && r.amount > 0
      && typeof r.reason === 'string' && r.reason.trim() ? [{ id: r.gift_id, amount: r.amount, reason: r.reason.trim() }] : []);
  } catch {
    return undefined;
  }
}

/** Mark THIS account's Aether gift seen (`ack_aether_gift`: only the caller's own unseen gift changes). False = it did
 *  not get through; the gift then shows again on the next load, which is the safe side. */
export async function ackAetherGiftRemote(giftId: string): Promise<boolean> {
  try {
    const c = supabaseClient();
    if (!c) return false;
    const res = await Promise.race([
      // rows: a write that answers one boolean, never a list
      Promise.resolve(c.rpc('ack_aether_gift', { p_gift: giftId })),
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

// ── The pack economy (2026-12-01) ────────────────────────────────────────────────────────────────────────────

/**
 * THE PACKS PROBE. `true` = the packs migration has run and the owner's `pack_rollout()` flipped
 * `progression_config.packs_enabled`; `false` = asked, and it is not (no column yet, or still off); `undefined` = could
 * not ask. Read from the same single config row as every other switch (R-EGRESS-02). The client decides which shop to
 * show from this answer alone, never from its own version.
 */
export async function fetchPacksEnabled(): Promise<boolean | undefined> {
  const a = await fetchProgressionConfig();
  return a && a.row?.packs_enabled === true;
}

/**
 * Did THIS account get the 3,000 Aether launch gift (spec 12.1: launch-day accounts only)? One owner-read row of the
 * ledger (`grant` / `pack_launch`), asked only while the one-time Pack Shop announcement has not been seen. `undefined`
 * = could not ask (the announcement waits for an answer rather than claim a gift that was never paid).
 */
export async function fetchPackLaunchGiftReceived(userId: string): Promise<boolean | undefined> {
  try {
    const c = supabaseClient();
    if (!c) return undefined;
    const res = await Promise.race([
      Promise.resolve(c.from('aether_ledger').select('id').eq('user_id', userId).eq('reason', 'grant').eq('source_id', 'pack_launch').limit(1)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return ((res.data as unknown[] | null) ?? []).length > 0;
  } catch {
    return undefined;
  }
}

/** The purchase reward meter: paid packs toward the next reward, and rewards ready to claim. */
export interface PackMeter {
  progress: number;
  ready: number;
  /** The shop read's reward size and rarity (pack_config's `rewardEvery` / `rewardRarity`); buy and claim answers omit them. */
  every?: number;
  rarity?: CrateRarity;
}

/** The `pack_shop` read: the window's offers with this player's numbers, the sealed packs in counter order, the meter and the balance. */
export interface PackShopSnapshot {
  windowId: string;
  /** When the window ends (ms since the epoch). */
  nextRefreshAt: number;
  shelves: PackShelf[];
  offers: PackOffer[];
  /** The sealed packs, oldest first (the counter's order). */
  packs: OwnedPack[];
  packMeter: PackMeter;
  aether: number;
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const countOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const PACK_BADGES: readonly string[] = ['new', 'free', 'featured'];

function parseRarityRecord(v: unknown): Record<CrateRarity, number> | null {
  if (!isRec(v)) return null;
  const out = {} as Record<CrateRarity, number>;
  for (const r of COSMETIC_RARITIES) {
    const n = v[r];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) return null;
    out[r] = n;
  }
  return out;
}

/** One shelf offer; null on anything malformed (an optional field that is present but wrong drops the offer). */
export function parsePackOffer(v: unknown): PackOffer | null {
  if (!isRec(v) || typeof v.offerId !== 'string' || !v.offerId || typeof v.shelf !== 'string') return null;
  const look = parsePackLook(v.look);
  const price = countOf(v.price);
  const contains = countOf(v.contains);
  if (!look || price === null || contains === null || contains < 1) return null;
  const offer: PackOffer = { offerId: v.offerId, look, price, shelf: v.shelf, contains };
  if (v.fullPrice !== undefined && v.fullPrice !== null) {
    const full = countOf(v.fullPrice);
    if (full === null) return null;
    if (full > price) offer.fullPrice = full;
  }
  if (v.newToYou !== undefined && v.newToYou !== null) {
    if (!isRec(v.newToYou)) return null;
    const unowned = countOf(v.newToYou.unowned); const total = countOf(v.newToYou.total);
    if (unowned === null || total === null || unowned > total) return null;
    offer.newToYou = { unowned, total };
  }
  if (v.stock !== undefined && v.stock !== null) {
    const stock = countOf(v.stock);
    if (stock === null) return null;
    offer.stock = stock;
  }
  if (v.badge !== undefined && v.badge !== null) {
    if (typeof v.badge !== 'string' || !PACK_BADGES.includes(v.badge)) return null;
    offer.badge = v.badge as PackOffer['badge'];
  }
  if (v.soldOut === true || offer.stock === 0) offer.soldOut = true;
  if (v.odds !== undefined && v.odds !== null) {
    const cards = isRec(v.odds) ? parseRarityRecord(v.odds.cards) : null;
    const last = isRec(v.odds) ? parseRarityRecord(v.odds.last) : null;
    if (!cards || !last) return null;
    offer.odds = { cards, last };
  }
  return offer;
}

/** A list of offers; null when it is not a list or any entry is malformed (never a half-trusted shelf). */
function parseOffers(v: unknown): PackOffer[] | null {
  if (!Array.isArray(v)) return null;
  const out: PackOffer[] = [];
  for (const raw of v) { const o = parsePackOffer(raw); if (!o) return null; out.push(o); }
  return out;
}

/** A list of owned packs (`{packId, look}`); null on anything malformed. */
function parseOwnedPacks(v: unknown): OwnedPack[] | null {
  if (!Array.isArray(v)) return null;
  const out: OwnedPack[] = [];
  for (const raw of v) {
    if (!isRec(raw) || typeof raw.packId !== 'string' || !raw.packId) return null;
    const look = parsePackLook(raw.look);
    if (!look) return null;
    out.push({ packId: raw.packId, look });
  }
  return out;
}

function parseMeter(v: unknown): PackMeter | null {
  if (!isRec(v)) return null;
  const progress = countOf(v.progress); const ready = countOf(v.ready);
  if (progress === null || ready === null) return null;
  const every = countOf(v.every);
  const rarity = (COSMETIC_RARITIES as readonly unknown[]).includes(v.rarity) ? (v.rarity as CrateRarity) : undefined;
  return { progress, ready, ...(every !== null && every > 0 ? { every } : {}), ...(rarity ? { rarity } : {}) };
}

/** The `pack_shop` answer; null on anything malformed. */
export function parsePackShopSnapshot(v: unknown): PackShopSnapshot | null {
  if (!isRec(v) || typeof v.windowId !== 'string') return null;
  const next = typeof v.nextRefreshAt === 'number' ? v.nextRefreshAt : typeof v.nextRefreshAt === 'string' && /^\d+$/.test(v.nextRefreshAt) ? Number(v.nextRefreshAt) : NaN;
  if (!Number.isFinite(next) || next <= 0) return null;
  if (!Array.isArray(v.shelves)) return null;
  const shelves: PackShelf[] = [];
  for (const s of v.shelves) {
    if (!isRec(s) || typeof s.id !== 'string' || typeof s.name !== 'string') return null;
    shelves.push({ id: s.id, name: s.name });
  }
  const offers = parseOffers(v.offers);
  const packs = parseOwnedPacks(v.packs);
  const packMeter = parseMeter(v.packMeter);
  const aether = countOf(v.aether);
  if (!offers || !packs || !packMeter || aether === null) return null;
  return { windowId: v.windowId, nextRefreshAt: next, shelves, offers, packs, packMeter, aether };
}

/**
 * A pack action's answer: the body (2xx), or the server's JSON REFUSAL (`{status: 'error', reason, ...}`, a 403 / 409
 * whose body is passed through intact), or an error code (`packs_disabled`, `pack_not_found`, a timeout, a network or
 * transport failure).
 */
async function invokePackAction(body: Record<string, unknown>): Promise<{ data: Record<string, unknown> } | { refusal: Record<string, unknown> } | { error: string }> {
  const c = supabaseClient();
  if (!c) return { error: 'no_backend' };
  if (!currentUserId()) return { error: 'no_session' };
  try {
    const call = c.functions.invoke('progression-inventory', { body }) as Promise<{ data: unknown; error: unknown }>;
    const raced = await Promise.race([call, timeout(SUBMIT_TIMEOUT_MS, { timedOut: true } as const)]);
    if ('timedOut' in raced) return { error: 'timeout' };
    if (raced.error) {
      const e = raced.error as { context?: { status?: number; json?: () => Promise<unknown> }; message?: string };
      let parsed: unknown = null;
      try { parsed = e.context?.json ? await e.context.json() : null; } catch { /* no readable body */ }
      if (isRec(parsed) && parsed.status === 'error' && typeof parsed.reason === 'string') return { refusal: parsed };
      const code = isRec(parsed) && typeof parsed.error === 'string' ? parsed.error : '';
      return { error: code || (e.context?.status ? `http_${e.context.status}` : e.message || 'function_error') };
    }
    const data = (raced.data ?? {}) as Record<string, unknown>;
    // A 2xx refusal (never sent today, but the shape is the server's): read it as one.
    if (data.status === 'error' && typeof data.reason === 'string') return { refusal: data };
    return { data };
  } catch (e) {
    return { error: `network:${(e as Error)?.message ?? 'unknown'}` };
  }
}

/** The shop read. Errors: `packs_disabled` (the switch is off), a transport code, or `server_outdated` (did not parse). */
export async function fetchPackShop(): Promise<{ status: 'ok'; shop: PackShopSnapshot } | { status: 'error'; reason: string }> {
  const r = await invokePackAction({ action: 'pack_shop' });
  if ('error' in r) return { status: 'error', reason: r.error };
  if ('refusal' in r) return { status: 'error', reason: String(r.refusal.reason) };
  const shop = parsePackShopSnapshot(r.data);
  return shop ? { status: 'ok', shop } : { status: 'error', reason: 'server_outdated' };
}

export type BuyPackRemoteOutcome =
  | { status: 'ok'; packs: OwnedPack[]; aether: number; meter: PackMeter | null }
  | { status: 'error'; reason: string; aether?: number; offers?: PackOffer[] };

/**
 * BUY a pack offer (the `buy_pack` action). The client names the offer, the price it SHOWED and a request id (one per
 * attempt, reused on a retry of the same attempt: the server answers a repeated id with the packs it first made and
 * never charges twice); the server prices, charges and creates the pack. A refusal carries the server's reason
 * (`expired` with the current offers, `price_changed`, `sold_out`, `no_room`, `insufficient`, `guest`) and the balance.
 */
export async function buyPackRemote(req: { offerId: string; expectedPrice: number; requestId: string }): Promise<BuyPackRemoteOutcome> {
  const r = await invokePackAction({ action: 'buy_pack', offerId: req.offerId, expectedPrice: req.expectedPrice, requestId: req.requestId });
  if ('error' in r) return { status: 'error', reason: r.error };
  if ('refusal' in r) {
    const out: BuyPackRemoteOutcome = { status: 'error', reason: String(r.refusal.reason) };
    const aether = countOf(r.refusal.aether);
    if (aether !== null) out.aether = aether;
    const offers = parseOffers(r.refusal.offers);
    if (offers) out.offers = offers;
    return out;
  }
  const packs = parseOwnedPacks(r.data.packs);
  const aether = countOf(r.data.aether);
  if (r.data.status !== 'ok' || !packs || packs.length === 0 || aether === null) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', packs, aether, meter: parseMeter(r.data.meter) };
}

/** OPEN one sealed pack (the `open_pack` action). An already-opened pack answers its stored result, never a new roll. */
export async function openPackRemote(packId: string): Promise<{ status: 'ok'; result: PackOpenResult; alreadyOpened: boolean } | { status: 'error'; reason: string }> {
  const r = await invokePackAction({ action: 'open_pack', packId });
  if ('error' in r) return { status: 'error', reason: r.error };
  if ('refusal' in r) return { status: 'error', reason: String(r.refusal.reason) };
  if (r.data.status !== 'opened' && r.data.status !== 'already_opened') return { status: 'error', reason: 'server_outdated' };
  const result = parsePackOpenResult(r.data);
  if (!result) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', result, alreadyOpened: r.data.status === 'already_opened' };
}

/** CLAIM one waiting purchase reward (the `claim_pack_reward` action). A repeated request id answers its first pack. */
export async function claimPackRewardRemote(requestId: string): Promise<{ status: 'ok'; packs: OwnedPack[]; meter: PackMeter | null } | { status: 'error'; reason: string }> {
  const r = await invokePackAction({ action: 'claim_pack_reward', requestId });
  if ('error' in r) return { status: 'error', reason: r.error };
  if ('refusal' in r) return { status: 'error', reason: String(r.refusal.reason) };
  const packs = parseOwnedPacks(r.data.packs);
  if (r.data.status !== 'ok' || !packs || packs.length === 0) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', packs, meter: parseMeter(r.data.meter) };
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
