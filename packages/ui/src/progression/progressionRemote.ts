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
 *
 * Never throws; every read is time-boxed.
 */
import {
  COSMETIC_INDEX, parseServerCatalogState, type ServerCatalogState, type SkinSlot, PROGRESSION_RULES_VERSION, TUTORIAL_COURSE_ID, TUTORIAL_COURSE_VERSION, parseCrate, parseOpenCrateResult, parseProgressionProfile,
  parseProgressionResult, type CrateRow, type OpenCrateResult, type ProgressionMode, type ProgressionProfile, type ProgressionResult,
  type ProgressionRunFactsV1,
} from '@game/progression';
import { currentUserId } from '../identity';
import { supabaseClient } from '../remoteBoards';

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
  facts?: ProgressionRunFactsV1 | null;
}

export type ProgressionSubmitOutcome =
  | { status: 'confirmed'; result: ProgressionResult; profile: ProgressionProfile; deduped: boolean }
  | { status: 'retryable'; reason: string }
  | { status: 'rejected'; reason: string };

/** Build the request for one finished run's facts (tutorial requests carry the course pin instead). */
export function progressionRequestFor(facts: ProgressionRunFactsV1, sourceId?: number): ProgressionSubmitRequest {
  const base = { mode: facts.mode, runId: facts.runId, rulesVersion: PROGRESSION_RULES_VERSION, facts };
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

/**
 * THE CAPABILITY PROBE. `true` = the migration has run AND the owner set the epoch; `false` = asked, and it is
 * off (no table yet, or no epoch); `undefined` = could not ask (no backend, offline, timeout).
 */
export async function fetchProgressionEnabled(): Promise<boolean | undefined> {
  const c = supabaseClient();
  if (!c) return undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('progression_config').select('epoch').eq('id', 1).limit(1)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res) return undefined;
    if (res.error) {
      // A missing table (the migration not run) is a definite "off"; anything else is "could not ask".
      const code = String((res.error as { code?: string }).code ?? '');
      return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703' ? false : undefined;
    }
    const row = (res.data as Array<{ epoch?: unknown }> | null)?.[0];
    return typeof row?.epoch === 'string' && row.epoch.length > 0;
  } catch {
    return undefined;
  }
}

const PROFILE_COLUMNS = 'account_xp, account_level, progression_revision, equipped_title_id';

/** THIS account's authoritative progression. `undefined` = could not ask; `null` = no profile row yet. */
export async function fetchOwnProgression(): Promise<ProgressionProfile | null | undefined> {
  const userId = currentUserId();
  if (!userId) return undefined;
  return fetchProgressionOf(userId);
}

/** Any player's PUBLIC progression (level, XP, equipped title, owned titles), for Career. */
export async function fetchPublicProgression(userId: string): Promise<ProgressionProfile | null | undefined> {
  return fetchProgressionOf(userId);
}

async function fetchProgressionOf(userId: string): Promise<ProgressionProfile | null | undefined> {
  const c = supabaseClient();
  if (!c || !userId) return undefined;
  try {
    const [prof, owned, loadout] = await Promise.race([
      Promise.all([
        Promise.resolve(c.from('profiles').select(PROFILE_COLUMNS).eq('user_id', userId).limit(1)),
        fetchOwnedCosmeticIds(userId),
        fetchLoadoutRows(userId),
      ]),
      timeout(READ_TIMEOUT_MS, [null, null, null] as const),
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
    }) ?? undefined;
  } catch {
    return undefined;
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
  const owned = await Promise.resolve(
    c.from('player_cosmetics').select('cosmetic_id, unlocked_at, cosmetic_catalog(category)').eq('user_id', userId).order('unlocked_at', { ascending: true }),
  );
  if (!owned.error) {
    const rows = (owned.data as Array<{ cosmetic_id?: unknown; cosmetic_catalog?: { category?: unknown } | null }> | null) ?? [];
    const ids = (xs: typeof rows): string[] => xs.map((r) => r.cosmetic_id).filter((t): t is string => typeof t === 'string');
    return {
      titles: ids(rows.filter((r) => (r.cosmetic_catalog?.category ?? COSMETIC_INDEX[String(r.cosmetic_id)]?.category) === 'title')),
      all: ids(rows),
    };
  }
  const legacy = await Promise.resolve(c.from('player_titles').select('title_id, unlocked_at').eq('user_id', userId).order('unlocked_at', { ascending: true }));
  if (legacy.error) return null;
  const titles = ((legacy.data as Array<{ title_id?: unknown }> | null) ?? []).map((r) => r.title_id).filter((t): t is string => typeof t === 'string');
  return { titles, all: titles };
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
    const res = await Promise.resolve(c.from('cosmetic_loadouts').select('slot, target_id, cosmetic_id').eq('user_id', userId));
    if (res.error) return null;
    return ((res.data as Array<{ slot?: unknown; target_id?: unknown; cosmetic_id?: unknown }> | null) ?? [])
      .filter((r) => typeof r.slot === 'string' && typeof r.target_id === 'string' && typeof r.cosmetic_id === 'string')
      .map((r) => ({ slot: r.slot as string, targetId: r.target_id as string, cosmeticId: r.cosmetic_id as string }));
  } catch {
    return null;
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
    const read = (withAdmin: boolean) => Promise.race([
      Promise.all([
        Promise.resolve(c.from('cosmetic_catalog').select(withAdmin ? 'cosmetic_id, active, admin_off' : 'cosmetic_id, active')),
        Promise.resolve(c.from('cosmetic_categories').select(withAdmin ? 'category, enabled, admin_off' : 'category, enabled')),
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
  const c = supabaseClient();
  if (!c) return undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('progression_config').select('crates_enabled').eq('id', 1).limit(1)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res) return undefined;
    if (res.error) {
      const code = String((res.error as { code?: string }).code ?? '');
      return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703' ? false : undefined;
    }
    return (res.data as Array<{ crates_enabled?: unknown }> | null)?.[0]?.crates_enabled === true;
  } catch {
    return undefined;
  }
}

/** THIS account's crates (owner-only read), oldest level first. `undefined` = could not ask. */
export async function fetchOwnCrates(): Promise<CrateRow[] | undefined> {
  const c = supabaseClient();
  const userId = currentUserId();
  if (!c || !userId) return undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('loot_crates').select('crate_id, earned_level, state, reward_cosmetic_id, earned_at, opened_at').eq('user_id', userId).order('earned_level', { ascending: true })),
      timeout(READ_TIMEOUT_MS, null),
    ]);
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

/** Open one crate. The server picks the reward; the client only names the crate. */
export async function openCrateRemote(crateId: string): Promise<InventoryOutcome<OpenCrateResult>> {
  const r = await invokeInventory({ action: 'open_crate', crateId });
  if ('error' in r) return { status: 'error', reason: r.error };
  const value = parseOpenCrateResult(r.data);
  const profile = parseProgressionProfile(r.data.profile);
  if (!value || !profile) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', value, profile };
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
export async function equipCosmeticRemote(slot: SkinSlot, targetId: string, cosmeticId: string | null): Promise<InventoryOutcome<null>> {
  const r = await invokeInventory({ action: 'equip_cosmetic', slot, targetId, cosmeticId });
  if ('error' in r) return { status: 'error', reason: r.error };
  const profile = parseProgressionProfile(r.data.profile);
  if (!profile) return { status: 'error', reason: 'server_outdated' };
  return { status: 'ok', value: null, profile };
}
