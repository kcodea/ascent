// GENERATED from packages/progression/src/inventory.ts by `npm run progression:shared`. DO NOT EDIT.
// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.
// Deno module (the submit-progression Edge Function imports it); the repo's tsc/eslint skip supabase/**.
/**
 * ACCOUNT PROGRESSION: the `progression-inventory` Edge Function's logic, as a pure function (2026-09-28). Also the
 * once-per-cold-start CATALOG SYNC (`syncCatalogOnce`, at the end): this function is the one place the database's
 * cosmetic catalog is written from code.
 *
 * Four actions, all for the authenticated caller only, each a single SQL transaction under the same per-user lock
 * the settlement takes:
 *   { action: 'open_crate', crateId }     → `open_crate`: pick one unowned, eligible item AT OPEN TIME (a rarity
 *                                           at the fixed odds, then an item of it; 2026-09-29), insert ownership,
 *                                           mark the crate opened. It may still NAME `focus` + `expectedFee` (a
 *                                           milestone crate's focus at open, 2026-10-18), but since 2026-10-20 the
 *                                           SQL refuses any focus at open (`focus_not_allowed`).
 *   { action: 'buy_crate', tier, focus, expectedTotal, requestId }
 *                                         → `buy_crate` (2026-10-18, the Crate Shop): spend Aether on a crate of a tier
 *                                           (its rarity floor), optionally focused on categories, and open it in the same
 *                                           transaction. The client names the tier, the focus, the price it SHOWED and a
 *                                           request id (a replay answers `already_opened`, never a second charge); the SQL
 *                                           re-quotes, refuses a moved price (`price_changed`), charges and rolls.
 *   { action: 'equip_title', titleId }    → `equip_title`: equip a title the caller OWNS (null takes it off).
 *   { action: 'equip_cosmetic', slot, targetId, cosmeticId }
 *                                         → `equip_cosmetic` (2026-09-28, skins): wear a hero or minion skin the
 *                                           caller OWNS on the target it was made for, or null for Default. The
 *                                           SQL checks ownership, category = slot, target and that the item is
 *                                           live (a retired skin cannot be equipped). Also the account-wide
 *                                           `hero_attack` slot (target '', null = Classic) and, since 2026-10-01, the account-wide
 *                                           `portrait_frame` slot (target '', null = the default ring), same checks.
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
import { COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, EMOTE_POSITION_RE, EQUIP_SLOTS, GLOBAL_EQUIP_SLOTS, catalogHash, catalogSyncPayload, cosmeticOf, parseOpenCrateResult, type CosmeticCategory, type EquipSlot, type OpenCrateResult } from './progressionCosmetics.ts';
import { CRATE_TIERS, type CrateTier } from './progressionAether.ts';
import { atOrAbove, parseBuyCrateResult } from './progressionCrateShop.ts';
import { parseProgressionProfile, type ProgressionProfile } from './progressionRules.ts';
import type { HandlerResponse, RpcCall } from './progressionServer.ts';

export type InventoryRequest =
  | { action: 'open_crate'; crateId: string; focus?: CosmeticCategory[]; expectedFee?: number }
  | { action: 'buy_crate'; tier: CrateTier; focus: CosmeticCategory[] | null; expectedTotal: number; requestId: string }
  | { action: 'equip_title'; titleId: string | null }
  | { action: 'equip_cosmetic'; slot: EquipSlot; targetId: string; cosmeticId: string | null };

export type InventoryValidation = { ok: true; request: InventoryRequest } | { ok: false; status: number; error: string };

/** A hero or card id, and a cosmetic id: the same conservative shape the SQL enforces. */
const TARGET_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const COSMETIC_ID = /^[a-z0-9_]{1,64}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most Aether a client may NAME as a price (a sanity bound; the SQL compares it with its own quote). */
const MAX_NAMED_PRICE = 1_000_000;
/** A focus names at most this many categories (there are ten; the SQL treats a focus covering all available as none). */
const MAX_FOCUS = 10;

/** A focus: absent or null = none; otherwise 1..10 DISTINCT known category names. 'bad' for anything else. */
function parseFocus(v: unknown): CosmeticCategory[] | null | 'bad' {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_FOCUS) return 'bad';
  if (!v.every((c) => typeof c === 'string' && (COSMETIC_CATEGORIES as readonly string[]).includes(c))) return 'bad';
  if (new Set(v).size !== v.length) return 'bad';
  return [...v] as CosmeticCategory[];
}

const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_NAMED_PRICE;

export function validateInventoryBody(body: unknown): InventoryValidation {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'bad_json' };
  const b = body as Record<string, unknown>;
  if (b.action === 'open_crate') {
    if (typeof b.crateId !== 'string' || !UUID.test(b.crateId)) return { ok: false, status: 400, error: 'bad_crate_id' };
    const crateId = b.crateId.toLowerCase();
    // A focus must come with the fee the client showed. Since 2026-10-20 the SQL refuses ANY focus at open
    // (`focus_not_allowed`: milestone crates can no longer be focused); the shape stays so an older client gets that answer.
    const focus = parseFocus(b.focus);
    if (focus === 'bad') return { ok: false, status: 400, error: 'bad_focus' };
    if (!focus) return { ok: true, request: { action: 'open_crate', crateId } };
    if (!isPrice(b.expectedFee)) return { ok: false, status: 400, error: 'bad_price' };
    return { ok: true, request: { action: 'open_crate', crateId, focus, expectedFee: b.expectedFee } };
  }
  if (b.action === 'buy_crate') {
    if (typeof b.tier !== 'string' || !(CRATE_TIERS as readonly string[]).includes(b.tier)) return { ok: false, status: 400, error: 'bad_tier' };
    const focus = parseFocus(b.focus);
    if (focus === 'bad') return { ok: false, status: 400, error: 'bad_focus' };
    if (!isPrice(b.expectedTotal)) return { ok: false, status: 400, error: 'bad_price' };
    if (typeof b.requestId !== 'string' || !UUID.test(b.requestId)) return { ok: false, status: 400, error: 'bad_request_id' };
    return { ok: true, request: { action: 'buy_crate', tier: b.tier as CrateTier, focus, expectedTotal: b.expectedTotal, requestId: b.requestId.toLowerCase() } };
  }
  if (b.action === 'equip_title') {
    if (b.titleId === null) return { ok: true, request: { action: 'equip_title', titleId: null } };
    if (typeof b.titleId !== 'string' || b.titleId.length < 1 || b.titleId.length > 64) return { ok: false, status: 400, error: 'bad_title_id' };
    return { ok: true, request: { action: 'equip_title', titleId: b.titleId } };
  }
  if (b.action === 'equip_cosmetic') {
    if (typeof b.slot !== 'string' || !(EQUIP_SLOTS as readonly string[]).includes(b.slot)) return { ok: false, status: 400, error: 'bad_slot' };
    // A hero attack is account-wide: its target is always '' (the global slot). A skin names its hero or card. An
    // emote (2026-10-13) names its menu position, '0'..'7' (eight since 2026-10-22).
    if (typeof b.targetId !== 'string' || (b.slot === 'emote' ? !EMOTE_POSITION_RE.test(b.targetId) : (GLOBAL_EQUIP_SLOTS as readonly string[]).includes(b.slot) ? b.targetId !== '' : !TARGET_ID.test(b.targetId))) return { ok: false, status: 400, error: 'bad_target' };
    if (b.cosmeticId !== null && (typeof b.cosmeticId !== 'string' || !COSMETIC_ID.test(b.cosmeticId))) return { ok: false, status: 400, error: 'bad_cosmetic_id' };
    return { ok: true, request: { action: 'equip_cosmetic', slot: b.slot as EquipSlot, targetId: b.targetId, cosmeticId: b.cosmeticId as string | null } };
  }
  return { ok: false, status: 400, error: 'bad_action' };
}

/** `raise exception '<code>'` inside `open_crate` / `buy_crate` / `equip_title` → HTTP status (4xx permanent, 5xx retry). */
export const INVENTORY_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  bad_crate_id: 400,
  // The Crate Shop (2026-10-18). A moved price, an empty shelf, a broke wallet or a switched-off economy is a definite
  // 409 (the client refreshes its quote or its balance); a missing price in `aether_config` is the OWNER's config
  // problem, not the player's: 503, so the client may retry once it is fixed.
  bad_tier: 400,
  bad_focus: 400,
  bad_price: 400,
  bad_request_id: 400,
  price_changed: 409,
  insufficient_aether: 409,
  sold_out: 409,
  focus_not_allowed: 409,
  aether_disabled: 409,
  aether_config_missing: 503,
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
  if (!def || !def.active || def.acquisition.type !== 'crate' || !COSMETIC_CATEGORY_DEFS[def.category].enabled) return false;
  // A tiered / focused crate (2026-10-18): the reward must also respect the floor and the focus the crate was sold with.
  const { floor, focus } = r.crate;
  if (floor && !atOrAbove(def.rarity, floor)) return false;
  if (focus && focus.length > 0 && !focus.includes(def.category)) return false;
  return true;
}

export async function handleInventory(userId: string | null, body: unknown, rpc: RpcCall, log: (msg: string, detail?: unknown) => void = () => {}): Promise<HandlerResponse> {
  if (!userId) return { status: 401, body: { error: 'unauthenticated' } };
  const v = validateInventoryBody(body);
  if (!v.ok) return { status: v.status, body: { error: v.error } };
  const r = v.request;
  const [fn, args]: [string, Record<string, unknown>] = r.action === 'open_crate'
    ? ['open_crate', { p_user: userId, p_crate_id: r.crateId, ...(r.focus ? { p_focus: r.focus, p_expected_fee: r.expectedFee } : {}) }]
    : r.action === 'buy_crate'
      ? ['buy_crate', { p_user: userId, p_tier: r.tier, p_focus: r.focus, p_expected_total: r.expectedTotal, p_request_id: r.requestId }]
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
  const opened = r.action === 'buy_crate' ? parseBuyCrateResult(out) : parseOpenCrateResult(out);
  if (!opened) return { status: 500, body: { error: 'inventory_malformed' } };
  const parity = openParity(opened);
  if (!parity) log('crate parity mismatch', { userId, ...(r.action === 'buy_crate' ? { requestId: r.requestId } : { crateId: r.crateId }), sql: out });
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
