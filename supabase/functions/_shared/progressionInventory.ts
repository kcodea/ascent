// GENERATED from packages/progression/src/inventory.ts by `npm run progression:shared`. DO NOT EDIT.
// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.
// Deno module (the submit-progression Edge Function imports it); the repo's tsc/eslint skip supabase/**.
/**
 * ACCOUNT PROGRESSION: the `progression-inventory` Edge Function's logic, as a pure function (2026-09-28). Also the
 * once-per-cold-start CATALOG SYNC (`syncCatalogOnce`, at the end): this function is the one place the database's
 * cosmetic catalog is written from code.
 *
 * Three actions, all for the authenticated caller only, each a single SQL transaction under the same per-user lock
 * the settlement takes:
 *   { action: 'open_crate', crateId }     → `open_crate`: pick one unowned, eligible item AT OPEN TIME, weighted
 *                                           over what actually remains, insert ownership, mark the crate opened.
 *   { action: 'equip_title', titleId }    → `equip_title`: equip a title the caller OWNS (null takes it off).
 *   { action: 'equip_cosmetic', slot, targetId, cosmeticId }
 *                                         → `equip_cosmetic` (2026-09-28, skins): wear a hero or minion skin the
 *                                           caller OWNS on the target it was made for, or null for Default. The
 *                                           SQL checks ownership, category = slot, target and that the item is
 *                                           live (a retired skin cannot be equipped). Also the account-wide
 *                                           `hero_attack` slot (target '', null = Classic), same checks.
 *
 * WHY A SEPARATE FUNCTION (not an extension of submit-progression): settlement is a queued, retried, byte-pinned
 * request whose contract is already live; opening and equipping are interactive, never queued, and fail
 * differently (`pool_exhausted` is a normal answer, not an error). Keeping them apart means an inventory change
 * never redeploys or risks the XP writer, and one function covers both inventory actions (one deploy).
 *
 * A client never names a reward, never writes ownership, crates or the loadout: it names a crate or a title and
 * the SQL decides. `npm run progression:shared` generates this file VERBATIM into
 * supabase/functions/_shared/progressionInventory.ts; `sharedArtifact.test.ts` fails CI on drift.
 */
import { COSMETIC_CATEGORY_DEFS, EQUIP_SLOTS, catalogHash, catalogSyncPayload, cosmeticOf, parseOpenCrateResult, type EquipSlot, type OpenCrateResult } from './progressionCosmetics.ts';
import { parseProgressionProfile, type ProgressionProfile } from './progressionRules.ts';
import type { HandlerResponse, RpcCall } from './progressionServer.ts';

export type InventoryRequest =
  | { action: 'open_crate'; crateId: string }
  | { action: 'equip_title'; titleId: string | null }
  | { action: 'equip_cosmetic'; slot: EquipSlot; targetId: string; cosmeticId: string | null };

export type InventoryValidation = { ok: true; request: InventoryRequest } | { ok: false; status: number; error: string };

/** A hero or card id, and a cosmetic id: the same conservative shape the SQL enforces. */
const TARGET_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const COSMETIC_ID = /^[a-z0-9_]{1,64}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateInventoryBody(body: unknown): InventoryValidation {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'bad_json' };
  const b = body as Record<string, unknown>;
  if (b.action === 'open_crate') {
    if (typeof b.crateId !== 'string' || !UUID.test(b.crateId)) return { ok: false, status: 400, error: 'bad_crate_id' };
    return { ok: true, request: { action: 'open_crate', crateId: b.crateId.toLowerCase() } };
  }
  if (b.action === 'equip_title') {
    if (b.titleId === null) return { ok: true, request: { action: 'equip_title', titleId: null } };
    if (typeof b.titleId !== 'string' || b.titleId.length < 1 || b.titleId.length > 64) return { ok: false, status: 400, error: 'bad_title_id' };
    return { ok: true, request: { action: 'equip_title', titleId: b.titleId } };
  }
  if (b.action === 'equip_cosmetic') {
    if (typeof b.slot !== 'string' || !(EQUIP_SLOTS as readonly string[]).includes(b.slot)) return { ok: false, status: 400, error: 'bad_slot' };
    // A hero attack is account-wide: its target is always '' (the global slot). A skin names its hero or card.
    if (typeof b.targetId !== 'string' || (b.slot === 'hero_attack' ? b.targetId !== '' : !TARGET_ID.test(b.targetId))) return { ok: false, status: 400, error: 'bad_target' };
    if (b.cosmeticId !== null && (typeof b.cosmeticId !== 'string' || !COSMETIC_ID.test(b.cosmeticId))) return { ok: false, status: 400, error: 'bad_cosmetic_id' };
    return { ok: true, request: { action: 'equip_cosmetic', slot: b.slot as EquipSlot, targetId: b.targetId, cosmeticId: b.cosmeticId as string | null } };
  }
  return { ok: false, status: 400, error: 'bad_action' };
}

/** `raise exception '<code>'` inside `open_crate` / `equip_title` → HTTP status (4xx permanent, 5xx retry). */
export const INVENTORY_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  bad_crate_id: 400,
  bad_title_id: 400,
  crate_not_found: 404,
  not_owned: 409,
  crates_disabled: 409,
  duplicate_reward: 409,
  bad_slot: 400,
  bad_target: 400,
  bad_cosmetic_id: 400,
  wrong_target: 409,
  not_equippable: 409,
});

/**
 * RUNTIME PARITY for an open: the item the SQL gave must be one the TS catalog says a crate can give (known,
 * active, crate-sourced, in an enabled category). A mismatch never overrules the committed row; it flags
 * `parity: false` so a catalog edit that missed one copy surfaces on the first real opening.
 */
export function openParity(r: OpenCrateResult): boolean {
  if (r.status === 'pool_exhausted') return r.crate.state === 'sealed' && r.rewardId === null;
  if (r.crate.state !== 'opened' || r.crate.rewardId !== r.rewardId) return false;
  const def = cosmeticOf(r.rewardId);
  return !!def && def.active && def.acquisition.type === 'crate' && COSMETIC_CATEGORY_DEFS[def.category].enabled;
}

export async function handleInventory(userId: string | null, body: unknown, rpc: RpcCall, log: (msg: string, detail?: unknown) => void = () => {}): Promise<HandlerResponse> {
  if (!userId) return { status: 401, body: { error: 'unauthenticated' } };
  const v = validateInventoryBody(body);
  if (!v.ok) return { status: v.status, body: { error: v.error } };
  const r = v.request;
  const [fn, args]: [string, Record<string, unknown>] = r.action === 'open_crate'
    ? ['open_crate', { p_user: userId, p_crate_id: r.crateId }]
    : r.action === 'equip_title'
      ? ['equip_title', { p_user: userId, p_title_id: r.titleId }]
      : ['equip_cosmetic', { p_user: userId, p_slot: r.slot, p_target_id: r.targetId, p_cosmetic_id: r.cosmeticId }];
  let res: Awaited<ReturnType<RpcCall>>;
  try {
    res = await rpc(fn, args);
  } catch (e) {
    log(`${fn} threw`, e);
    return { status: 500, body: { error: 'inventory_failed' } };
  }
  if (res.error) {
    const message = String(res.error.message ?? '');
    const code = Object.keys(INVENTORY_ERROR_STATUS).find((k) => message.includes(k));
    if (code) return { status: INVENTORY_ERROR_STATUS[code]!, body: { error: code } };
    log(`${fn} failed`, res.error);
    return { status: 500, body: { error: 'inventory_failed' } };
  }
  const out = (res.data ?? null) as Record<string, unknown> | null;
  const profile: ProgressionProfile | null = parseProgressionProfile(out?.profile);
  if (!out || !profile) return { status: 500, body: { error: 'inventory_malformed' } };
  if (r.action === 'equip_title' || r.action === 'equip_cosmetic') return { status: 200, body: { status: 'equipped', profile: out.profile } };
  const opened = parseOpenCrateResult(out);
  if (!opened) return { status: 500, body: { error: 'inventory_malformed' } };
  const parity = openParity(opened);
  if (!parity) log('crate parity mismatch', { userId, crateId: r.crateId, sql: out });
  return { status: 200, body: { ...out, parity } };
}

// ── The catalog sync (owner 2026-09-28: "make it automated when i add skins") ──────────────────────────────

export type CatalogSyncOutcome = { status: 'synced' | 'unchanged' | 'failed'; hash: string; detail?: unknown };

/** After a FAILED sync (the SQL not pasted yet, a blip), the next attempt waits this long, so a missing function
 *  costs one extra round trip a minute rather than one per request. */
export const CATALOG_SYNC_RETRY_MS = 60_000;

let syncState: { promise: Promise<CatalogSyncOutcome>; at: number; ok: boolean } | null = null;

/**
 * Push this build's catalog to the database ONCE per cold start (an Edge Function isolate keeps module state
 * between requests). `sync_cosmetic_catalog` compares the hash first, so an unchanged catalog is one cheap read.
 * NEVER throws: a failed sync is logged, the request carries on, and it is retried after `CATALOG_SYNC_RETRY_MS`.
 *
 * Only `progression-inventory` calls this. `submit-progression` bundles the same catalog but deliberately does NOT
 * sync: two functions deployed at different times carry different catalogs, and each cold start would push its own
 * copy back (an older `submit-progression` would re-deactivate a skin you had just added). One writer, one deploy.
 */
export function syncCatalogOnce(rpc: RpcCall, log: (msg: string, detail?: unknown) => void = () => {}, now: () => number = Date.now): Promise<CatalogSyncOutcome> {
  if (syncState && (syncState.ok || now() - syncState.at < CATALOG_SYNC_RETRY_MS)) return syncState.promise;
  const payload = catalogSyncPayload();
  const hash = catalogHash(payload);
  const entry: { promise: Promise<CatalogSyncOutcome>; at: number; ok: boolean } = { promise: Promise.resolve({ status: 'failed', hash }), at: now(), ok: false };
  entry.promise = (async (): Promise<CatalogSyncOutcome> => {
    try {
      const res = await rpc('sync_cosmetic_catalog', { p_catalog: payload, p_hash: hash });
      if (res.error) {
        log('catalog sync failed', res.error);
        return { status: 'failed', hash, detail: res.error };
      }
      entry.ok = true;
      const status = (res.data as { status?: unknown } | null)?.status === 'unchanged' ? 'unchanged' : 'synced';
      return { status, hash, detail: res.data };
    } catch (e) {
      log('catalog sync threw', e);
      return { status: 'failed', hash, detail: String(e) };
    }
  })();
  syncState = entry;
  return entry.promise;
}

/** Tests: forget the per-isolate sync. */
export function resetCatalogSyncForTests(): void { syncState = null; }
