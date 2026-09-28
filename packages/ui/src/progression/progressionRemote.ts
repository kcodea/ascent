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
  COSMETIC_INDEX, PROGRESSION_RULES_VERSION, TUTORIAL_COURSE_ID, TUTORIAL_COURSE_VERSION, parseCrate, parseOpenCrateResult, parseProgressionProfile,
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
    const [prof, titles] = await Promise.race([
      Promise.all([
        Promise.resolve(c.from('profiles').select(PROFILE_COLUMNS).eq('user_id', userId).limit(1)),
        fetchOwnedTitleIds(userId),
      ]),
      timeout(READ_TIMEOUT_MS, [null, null] as const),
    ]);
    if (!prof || prof.error) return undefined; // pre-migration columns, offline, timeout
    const row = (prof.data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) return null;
    return parseProgressionProfile({
      accountXp: row.account_xp, accountLevel: row.account_level, revision: row.progression_revision,
      equippedTitleId: row.equipped_title_id, titles: titles ?? [],
    }) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * A player's owned titles, oldest first. Since 2026-09-28 ownership of every cosmetic is `player_cosmetics`
 * (public read), filtered to titles through the catalog; before the crates migration runs it falls back to the
 * MVP's `player_titles`. Null = could not ask.
 */
async function fetchOwnedTitleIds(userId: string): Promise<string[] | null> {
  const c = supabaseClient();
  if (!c) return null;
  const owned = await Promise.resolve(
    c.from('player_cosmetics').select('cosmetic_id, unlocked_at, cosmetic_catalog(category)').eq('user_id', userId).order('unlocked_at', { ascending: true }),
  );
  if (!owned.error) {
    const rows = (owned.data as Array<{ cosmetic_id?: unknown; cosmetic_catalog?: { category?: unknown } | null }> | null) ?? [];
    return rows
      .filter((r) => (r.cosmetic_catalog?.category ?? COSMETIC_INDEX[String(r.cosmetic_id)]?.category) === 'title')
      .map((r) => r.cosmetic_id)
      .filter((t): t is string => typeof t === 'string');
  }
  const legacy = await Promise.resolve(c.from('player_titles').select('title_id, unlocked_at').eq('user_id', userId).order('unlocked_at', { ascending: true }));
  if (legacy.error) return null;
  return ((legacy.data as Array<{ title_id?: unknown }> | null) ?? []).map((r) => r.title_id).filter((t): t is string => typeof t === 'string');
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
