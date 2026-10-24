/**
 * ACCOUNT PROGRESSION: the client slice (2026-09-27). A small store of its OWN rather than more fields on the
 * game store (`store.ts` is a hot file): the game store only calls the four entry points below at its seams.
 *
 *   capability  `unknown` until the probe answers, then `on` (migration run + epoch set) or `off`. While not
 *               `on`, NOTHING is shown; while `off`, nothing is queued either. This is the feature flag that
 *               makes shipping the client before the owner runs the SQL safe.
 *   mirror      the account's authoritative progression (XP, level, revision, equipped title, titles), adopted
 *               from the server by HIGHEST revision (a late, older answer never rolls it back); persisted per
 *               account so the Career paints at once.
 *   current     the run that just finished, keyed by a LOCAL key (its seed) so the end screen can find it before
 *               the server run id exists (a practice run's id is its uploaded row id).
 *
 * Entry points (called from store.ts): `probeProgression` (identity boot / change), `expectRunProgression` +
 * `beginRunProgression` (run end), `flushProgression` (a rank answer landed).
 *
 * CRATES (2026-09-28): `cratesCapability` is a second flag (the crates migration has run and `crates_enabled` is
 * on), probed after the first; `crateList` is this account's crates (owner-only read). `openCrate` and
 * `equipTitle` go through the `progression-inventory` Edge Function and adopt the profile it returns, so the
 * owned titles and the equipped title update everywhere at once. Opening is interactive, never queued.
 *
 * SKINS (2026-09-28): `equipCosmetic` wears a hero / minion skin (or Default) through the same Edge Function; the
 * mirror carries the owned cosmetics and the loadout. `catalogEpoch` moves whenever the SERVER's kill switch is
 * (re)read (`refreshServerCatalog`), so every skin renderer re-resolves; the last answer is cached so an offline
 * client still honours a retire it has already seen.
 *
 * AETHER + THE CRATE SHOP (2026-10-18): `aetherCapability` is a third flag (probed right after crates; the shop shows
 * only while `aetherVisible`), `economy` is the live `aether_config` document (the bundled default until read; the
 * server prices every purchase regardless), and the balance rides the mirror (`ProgressionProfile.aether`, adopted
 * with the profile like XP). `buyCrate` is the shop's one purchase call, interactive and never queued.
 */
import { create } from 'zustand';
import { queueNewRewards } from './newRewards';
import { addSeen, adoptAccountSeen, ensureSeenBaseline } from './collectionSeen';
import {
  COSMETICS, DEFAULT_AETHER_ECONOMY, HERO_TITLE_COSMETICS, INVENTORY_ERROR_STATUS, PROGRESSION_RULES_VERSION, heroMasterTitleId, heroTitleId, isMasterTitle, setServerCatalogState, titleName, withEmoteAt, type ServerCatalogState, type AetherEconomy, type BuyCrateResult, type CosmeticCategory, type CrateTier, type EquipSlot, type CrateRow, type OpenCrateResult, type ProgressionMode, type ProgressionProfile, type ProgressionResult, type ProgressionRunFacts, type RunCosmeticSnapshot,
} from '@game/progression';
import { currentUserId } from '../identity';
import { remoteEnabled } from '../remoteBoards';
import {
  enqueuePendingProgression, flushPendingProgressions, installProgressionRetryTriggers, type PendingProgression,
} from './progressionQueue';
import {
  buyCrateRemote, equipCosmeticRemote, equipTitleRemote, fetchAchievementsEnabled, fetchAetherEconomy, fetchAetherEnabled, fetchCratesEnabled, fetchOwnCrates, fetchOwnProgression, fetchProgressionEnabled, fetchSeenCosmeticIds, fetchServerCatalogState, markCosmeticsSeenRemote, openCrateRemote, progressionRequestFor,
  type ProgressionSubmitOutcome,
} from './progressionRemote';

export type ProgressionCapability = 'unknown' | 'on' | 'off';
/** `none`: this run earns nothing we can settle (no session, no source row). */
export type ProgressionRunState = 'pending' | 'confirmed' | 'retryable' | 'rejected' | 'none';

export interface ProgressionMirror extends ProgressionProfile { userId: string }

export interface CurrentRunProgression {
  localKey: string;
  mode: ProgressionMode;
  runId: string | null;
  state: ProgressionRunState;
  result: ProgressionResult | null;
  deduped: boolean;
  error: string | null;
}

interface ProgressionStore {
  capability: ProgressionCapability;
  mirror: ProgressionMirror | null;
  current: CurrentRunProgression | null;
  /** Crates + Collection shown only while `on` (and `capability` is `on`). */
  cratesCapability: ProgressionCapability;
  /** This account's crates, oldest level first (null until read). */
  crateList: CrateRow[] | null;
  /** Bumps whenever the server's catalog switches are applied: a render key for every skin lookup. */
  catalogEpoch: number;
  /** ACHIEVEMENTS (2026-09-28): `on` once the owner set `achievements_epoch`. Shows the Career tab and the post-game
   *  "Achievement unlocked" rows, and makes a settlement carry its run metrics (V2 facts). */
  achievementsCapability: ProgressionCapability;
  /** AETHER (2026-10-18): `on` once the Aether migration has run and `aether_enabled` is on. The Crate Shop, the Aether
   *  balance chip and the milestone-crate focus show only while this AND crates are on (`aetherVisible`). */
  aetherCapability: ProgressionCapability;
  /** The live Aether economy (prices, focus fee table, rewards). The bundled default until the server's row is read. */
  economy: AetherEconomy;
  /** THE COLLECTION'S SEEN LIST as last answered from outside the page: the ids the ACCOUNT has looked at (read from
   *  the server), or, on a server from before the seen migration, the baseline this device just took. Null until
   *  one of those lands. The Collection lays it over its own snapshot, so the answer shows the moment it arrives. */
  seenKnown: { userId: string; ids: ReadonlySet<string> } | null;
}

const MIRROR_KEY = 'ascent.progression';
const SERVER_CATALOG_KEY = 'ascent.cosmetics.server';

/** Apply (and cache) the server's catalog switches, then bump the render epoch. */
export function applyServerCatalogState(state: ServerCatalogState | null, persist = true): void {
  setServerCatalogState(state);
  if (persist) {
    try { if (state) localStorage.setItem(SERVER_CATALOG_KEY, JSON.stringify(state)); else localStorage.removeItem(SERVER_CATALOG_KEY); } catch { /* ignore */ }
  }
  useProgression.setState((s) => ({ catalogEpoch: s.catalogEpoch + 1 }));
}
function loadServerCatalogState(): ServerCatalogState | null {
  try {
    const o = JSON.parse(localStorage.getItem(SERVER_CATALOG_KEY) ?? 'null') as ServerCatalogState | null;
    return o && Array.isArray(o.retiredIds) && Array.isArray(o.disabledCategories) ? o : null;
  } catch {
    return null;
  }
}

function loadMirror(): ProgressionMirror | null {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    const o = raw ? (JSON.parse(raw) as ProgressionMirror) : null;
    return o && typeof o.userId === 'string' && typeof o.accountXp === 'number' && typeof o.revision === 'number' ? o : null;
  } catch {
    return null;
  }
}
function saveMirror(m: ProgressionMirror | null): void {
  try { if (m) localStorage.setItem(MIRROR_KEY, JSON.stringify(m)); else localStorage.removeItem(MIRROR_KEY); } catch { /* ignore */ }
}

export const useProgression = create<ProgressionStore>(() => ({
  capability: 'unknown',
  mirror: typeof localStorage === 'undefined' ? null : loadMirror(),
  current: null,
  cratesCapability: 'unknown',
  crateList: null,
  catalogEpoch: 0,
  achievementsCapability: 'unknown',
  aetherCapability: 'unknown',
  economy: DEFAULT_AETHER_ECONOMY,
  seenKnown: null,
}));

// The last server kill-switch answer we saw, applied before anything renders (never un-retires on its own).
if (typeof localStorage !== 'undefined') {
  const cached = loadServerCatalogState();
  if (cached) setServerCatalogState(cached);
}

/** The mirror, only when it belongs to the account that is live right now. */
export function mirrorFor(userId: string | null | undefined, mirror: ProgressionMirror | null): ProgressionMirror | null {
  return userId && mirror && mirror.userId === userId ? mirror : null;
}

/**
 * Adopt a server profile for `userId` unless the mirror already holds a NEWER revision of the same account.
 * Returns whether it was adopted.
 */
export function adoptProgressionProfile(userId: string, profile: ProgressionProfile): boolean {
  const cur = useProgression.getState().mirror;
  if (cur && cur.userId === userId && profile.revision < cur.revision) return false;
  // A profile that does not CARRY the balance (a pre-Aether server, an unreadable wallet, a plain reader) must not wipe
  // it: keep the one this same account already had. A profile that carries `aether` (0 included) always wins.
  const keepAether = profile.aether === undefined && cur && cur.userId === userId && cur.aether !== undefined ? { aether: cur.aether } : {};
  const next: ProgressionMirror = { ...profile, ...keepAether, userId };
  saveMirror(next);
  useProgression.setState({ mirror: next });
  return true;
}

/** One queue answer lands: adopt the profile, and update the end screen when it is the run it shows. */
export function applyProgressionOutcome(item: Pick<PendingProgression, 'userId' | 'runId' | 'mode'>, outcome: ProgressionSubmitOutcome): void {
  if (outcome.status === 'confirmed') adoptProgressionProfile(item.userId, outcome.profile);
  // NEW REWARDS (owner 2026-09-28): the achievements, titles and crates this settlement awarded wait for the player in
  // the Collection (a pop-up there + a NEW pill on every Collection entry point) instead of crowding the end screen.
  // Idempotent per reward id, so a duplicate or replayed answer never queues twice.
  if (outcome.status === 'confirmed') queueNewRewards(item.userId, outcome.result);
  // New crates: re-read the list so the Collection and the post-game Open button see them.
  if (outcome.status === 'confirmed' && outcome.result.cratesAwarded > 0 && !outcome.deduped) void refreshCrates();
  const cur = useProgression.getState().current;
  if (!cur || cur.runId !== item.runId || cur.mode !== item.mode) return;
  if (outcome.status === 'confirmed') {
    useProgression.setState({ current: { ...cur, state: 'confirmed', result: outcome.result, deduped: outcome.deduped, error: null } });
  } else {
    useProgression.setState({ current: { ...cur, state: outcome.status, error: outcome.reason } });
  }
}

// ── The Collection's seen list (owner 2026-10-11: "i want to save the 'seen' on the account level") ───────────

/** The account whose seen list the SERVER holds (the migration has run and it answered). Null = the list is this
 *  device's own: nothing is sent. */
let seenAccount: string | null = null;
/** The ids the server is known to hold as seen for `seenAccount` (its answer + every write that got through), so an
 *  item is sent once. Not reactive on purpose: a badge you are looking at must not vanish because its write landed. */
const seenOnServer = new Set<string>();

/**
 * Read the account's seen list (run with the probe, when identity lands or changes).
 *  - it answers: the list is the account's. Copy it to this device and publish it (`seenKnown`).
 *  - `unsupported` (a server from before the migration): the list is this device's. Take the one-time baseline from
 *    `profile` (the ownership just read), so the collection you already own is not badged.
 *  - no answer: change nothing. A device that has never had an answer shows no NEW badge until it gets one.
 */
export async function refreshSeenList(userId: string, profile: Pick<ProgressionProfile, 'cosmetics'> | null): Promise<void> {
  const seen = await fetchSeenCosmeticIds(userId);
  if (seen === undefined || currentUserId() !== userId) return;
  if (seen === 'unsupported') {
    seenAccount = null;
    seenOnServer.clear();
    const took = ensureSeenBaseline(userId, profile);
    if (took) useProgression.setState({ seenKnown: { userId, ids: new Set(took) } });
    return;
  }
  seenAccount = userId;
  seenOnServer.clear();
  for (const id of seen) seenOnServer.add(id);
  adoptAccountSeen(userId, seen);
  useProgression.setState({ seenKnown: { userId, ids: new Set(seen) } });
}

/**
 * The player looked at `ids` (opened their tab, or selected one): seen on this device at once, and on the account
 * when the server holds the list. Best-effort and never queued: a write that fails is sent again the next time the
 * items are looked at. The server marks only the caller's own unseen items, so an id it does not know is a no-op.
 */
export function markCosmeticsSeen(userId: string | null | undefined, ids: readonly string[]): void {
  if (!userId || !ids.length) return;
  addSeen(userId, ids);
  if (seenAccount !== userId) return;
  const send = ids.filter((id) => !seenOnServer.has(id));
  if (!send.length) return;
  for (const id of send) seenOnServer.add(id);
  void markCosmeticsSeenRemote(send).then((ok) => {
    if (!ok && seenAccount === userId) for (const id of send) seenOnServer.delete(id);
  });
}

let probing: Promise<void> | null = null;

/**
 * The capability probe + mirror refresh + queue flush, run when identity lands or changes. Safe to call often:
 * concurrent calls share one probe. An unanswerable probe (offline) leaves the capability as it was.
 */
export function probeProgression(): Promise<void> {
  if (probing) return probing;
  const run = async (): Promise<void> => {
    if (!remoteEnabled()) { useProgression.setState({ capability: 'off' }); return; }
    // The kill switch first and independently of the XP feature: a retired item must stop rendering even while
    // progression is switched off. Unanswerable = keep the cached / bundled state.
    void refreshServerCatalog();
    const enabled = await fetchProgressionEnabled();
    if (enabled === undefined) return;
    useProgression.setState({ capability: enabled ? 'on' : 'off' });
    if (!enabled) return;
    const userId = currentUserId();
    if (!userId) return;
    const profile = await fetchOwnProgression();
    if (profile) adoptProgressionProfile(userId, profile);
    // The Collection's seen list, alongside the rest (its baseline fallback needs the ownership just read).
    const seenRead = refreshSeenList(userId, profile ?? null);
    await flushPendingProgressions(applyProgressionOutcome, { force: true });
    // The crates probe: a separate switch, so the XP panel works before the crates migration runs.
    const crates = await fetchCratesEnabled();
    if (crates !== undefined) useProgression.setState({ cratesCapability: crates ? 'on' : 'off' });
    if (crates) await refreshCrates();
    // The achievements probe: its own switch (the owner flips it after deploying the Edge Function).
    const ach = await fetchAchievementsEnabled();
    if (ach !== undefined) useProgression.setState({ achievementsCapability: ach ? 'on' : 'off' });
    // The Aether probe: its own switch, read from the same row as crates. Unanswerable keeps what it had.
    const aether = await fetchAetherEnabled();
    if (aether !== undefined) useProgression.setState({ aetherCapability: aether ? 'on' : 'off' });
    if (aether) await refreshEconomy();
    await seenRead;
  };
  const p = run().catch(() => { /* never throws */ }).finally(() => { if (probing === p) probing = null; });
  probing = p;
  return p;
}

/** Flush the queue now (a rank answer landed, or the player pressed Retry). No-op until the feature is on. */
export function flushProgression(force = false): Promise<void> {
  if (useProgression.getState().capability !== 'on') return Promise.resolve();
  return flushPendingProgressions(applyProgressionOutcome, { force });
}

/**
 * A run just ended that WILL settle once its source exists (a practice run waits for its uploaded row id). The
 * end screen shows "pending" from this moment. No-op when the feature is off or there is no session.
 */
export function expectRunProgression(localKey: string, mode: ProgressionMode): void {
  if (useProgression.getState().capability === 'off' || !remoteEnabled() || !currentUserId()) {
    useProgression.setState({ current: { localKey, mode, runId: null, state: 'none', result: null, deduped: false, error: null } });
    return;
  }
  useProgression.setState({ current: { localKey, mode, runId: null, state: 'pending', result: null, deduped: false, error: null } });
}

/**
 * Queue and submit one finished run's facts. Durable first (the queue), then a flush. Returns whether it was
 * queued. `sourceId` is the practice row id.
 */
export function beginRunProgression(localKey: string, facts: ProgressionRunFacts, sourceId?: number): boolean {
  const st = useProgression.getState();
  const none = (): false => {
    useProgression.setState({ current: { localKey, mode: facts.mode, runId: facts.runId, state: 'none', result: null, deduped: false, error: null } });
    return false;
  };
  if (st.capability === 'off' || !facts.terminal) return none();
  // Run metrics ride along only while the server evaluates achievements (an older server refuses V2 facts).
  const item = enqueuePendingProgression(progressionRequestFor(facts, sourceId, st.achievementsCapability === 'on'));
  if (!item) return none();
  useProgression.setState({ current: { localKey, mode: facts.mode, runId: facts.runId, state: 'pending', result: null, deduped: false, error: null } });
  void flushProgression();
  return true;
}

/**
 * SPECTATOR XP (owner 2026-10-24: "watching a player's game rewards 50% of the xp at the end of the match"): a watched
 * game just ended for this spectator. Queue its settlement (`watch:<kind>:<game>`): the server decides from its own watch
 * record whether it earns (watched to the end, enough of it, not your own game), so the request carries no facts and
 * no amount. `localKey` is the key the spectator's end notice shows the XP panel for. Returns whether it was queued.
 */
export function beginSpectateProgression(localKey: string, runId: string): boolean {
  const st = useProgression.getState();
  const none = (): false => {
    useProgression.setState({ current: { localKey, mode: 'spectate', runId, state: 'none', result: null, deduped: false, error: null } });
    return false;
  };
  if (st.capability === 'off') return none();
  const item = enqueuePendingProgression({ mode: 'spectate', runId, rulesVersion: PROGRESSION_RULES_VERSION });
  if (!item) return none();
  useProgression.setState({ current: { localKey, mode: 'spectate', runId, state: 'pending', result: null, deduped: false, error: null } });
  void flushProgression();
  return true;
}

/** A run that was expected to settle cannot (its practice row never uploaded): the end screen stops waiting. */
export function markRunProgressionUnavailable(localKey: string): void {
  const cur = useProgression.getState().current;
  if (cur && cur.localKey === localKey && cur.state === 'pending') useProgression.setState({ current: { ...cur, state: 'none' } });
}

/** Wire the network-return trigger once. */
export function installProgression(): void {
  installProgressionRetryTriggers(applyProgressionOutcome);
}

// ── Crates + titles (2026-09-28) ─────────────────────────────────────────────────────────────────────────────

/** Achievements are visible: progression is on AND the owner set the achievements epoch. */
export const achievementsVisible = (s: Pick<ProgressionStore, 'capability' | 'achievementsCapability'>): boolean => s.capability === 'on' && s.achievementsCapability === 'on';

/** Crates and the Collection are visible: progression is on AND the crates migration is live. */
export const cratesVisible = (s: Pick<ProgressionStore, 'capability' | 'cratesCapability'>): boolean => s.capability === 'on' && s.cratesCapability === 'on';

/** The Crate Shop is visible: crates are visible AND the Aether migration is live and switched on. */
export const aetherVisible = (s: Pick<ProgressionStore, 'capability' | 'cratesCapability' | 'aetherCapability'>): boolean => cratesVisible(s) && s.aetherCapability === 'on';

/** This account's Aether balance (the live account's mirror), 0 when there is none yet or it is another account's. */
export const aetherBalance = (s: Pick<ProgressionStore, 'mirror'>): number => mirrorFor(currentUserId(), s.mirror)?.aether ?? 0;

/** Re-read the live Aether economy. Never throws; an unanswerable or unparseable read keeps the economy as it was. */
export async function refreshEconomy(): Promise<void> {
  const economy = await fetchAetherEconomy().catch(() => undefined);
  if (economy) useProgression.setState({ economy });
}

/** Re-read this account's own profile (it carries the Aether balance) and adopt it: a Gauntlet clear pays Aether
 *  without answering a profile. Never throws; an unanswerable read, or an account switch meanwhile, changes nothing. */
export async function refreshOwnProfile(): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  const profile = await fetchOwnProgression().catch(() => undefined);
  if (profile && currentUserId() === userId) adoptProgressionProfile(userId, profile);
}

/** Re-read this account's crates. Never throws; an unanswerable read keeps the list as it was. */
export async function refreshCrates(): Promise<void> {
  if (!currentUserId()) return;
  const list = await fetchOwnCrates().catch(() => undefined);
  if (list) useProgression.setState({ crateList: list });
}

export type CrateOpenOutcome = { status: 'ok'; result: OpenCrateResult } | { status: 'error'; reason: string };

/** Replace one crate in the list (or add it when the list has not been read yet). */
function mergeCrate(crate: CrateRow): void {
  const list = useProgression.getState().crateList ?? [];
  const next = list.some((c) => c.crateId === crate.crateId) ? list.map((c) => (c.crateId === crate.crateId ? crate : c)) : [...list, crate];
  // Level crates oldest level first (as before); a level-less (Gauntlet) crate after them, as Postgres orders nulls.
  next.sort((a, b) => (a.earnedLevel ?? Infinity) - (b.earnedLevel ?? Infinity) || 0);
  useProgression.setState({ crateList: next });
}

/**
 * Open one crate through the server. The reward (or `pool_exhausted`) comes back; the profile is adopted. A MILESTONE
 * crate may be focused at the opening: pass the ticked `focus` and the `expectedFee` the player was shown.
 */
export async function openCrate(crateId: string, focus?: CosmeticCategory[] | null, expectedFee?: number): Promise<CrateOpenOutcome> {
  if (import.meta.env.DEV && devUnlockAllOn()) return { status: 'error', reason: 'dev_unlock_all' };
  const userId = currentUserId();
  if (!userId) return { status: 'error', reason: 'no_session' };
  const out = await openCrateRemote(crateId, focus, expectedFee).catch((e: unknown) => ({ status: 'error' as const, reason: String((e as Error)?.message ?? e) }));
  if (out.status !== 'ok') return out;
  adoptProgressionProfile(userId, out.profile);
  mergeCrate(out.value.crate);
  return { status: 'ok', result: out.value };
}

export type BuyCrateOutcome = { status: 'ok'; result: BuyCrateResult } | { status: 'error'; reason: string };

/** A fresh request id for ONE purchase (its retries reuse it). UI-side randomness (Math.random is banned only in
 *  core/content/sim); the fallback covers an embedded runtime without `crypto.randomUUID` and is still a valid RFC 4122
 *  v4 id. */
export function mintRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Refusals raised on THIS device before anything was sent: the server cannot have charged. */
const NEVER_SENT: ReadonlySet<string> = new Set(['no_session', 'no_backend', 'dev_unlock_all']);

/**
 * Is this failed purchase a DEFINITE answer (final review 2026-10-19)? Yes for the server's 4xx refusals
 * (`INVENTORY_ERROR_STATUS` below 500: bad_*, price_changed, insufficient_aether, sold_out, focus_not_allowed,
 * aether_disabled, ...) and for a refusal that never left this device: nothing was charged. NO for a timeout, a network
 * error, a 5xx (`aether_config_missing` included) or an answer that did not parse: the server may have committed the
 * purchase, so a retry must reuse the SAME request id (a replay answers `already_opened` with the reward, never a
 * second charge).
 */
export function isDefiniteBuyFailure(reason: string): boolean {
  if (NEVER_SENT.has(reason)) return true;
  const status = INVENTORY_ERROR_STATUS[reason];
  return status !== undefined && status < 500;
}

/**
 * BUY AND OPEN a crate through the server (the Crate Shop's one purchase call). The client names a tier, a focus, the
 * total it showed and a request id (a replay of that id never charges twice); the server prices, charges and rolls.
 * `requestId` is the caller's when it is RETRYING a purchase whose answer never came (`isDefiniteBuyFailure`); absent, a
 * fresh one is minted. On success the profile (with the new balance) is adopted and the opened crate joins the list.
 * Every failure comes back as an error outcome and nothing is retried here; a `price_changed` also re-reads the economy
 * so the shop re-quotes at the new price, and a failure that is NOT definite re-reads the balance and the crates (the
 * purchase may have landed), so what the player sees is true before they try again.
 */
export async function buyCrate(tier: CrateTier, focus: CosmeticCategory[] | null, expectedTotal: number, requestId: string = mintRequestId()): Promise<BuyCrateOutcome> {
  if (import.meta.env.DEV && devUnlockAllOn()) return { status: 'error', reason: 'dev_unlock_all' };
  const userId = currentUserId();
  if (!userId) return { status: 'error', reason: 'no_session' };
  const out = await buyCrateRemote({ tier, focus, expectedTotal, requestId }).catch((e: unknown) => ({ status: 'error' as const, reason: String((e as Error)?.message ?? e) }));
  if (out.status !== 'ok') {
    if (out.reason === 'price_changed') await refreshEconomy();
    // Not awaited: the shop shows its message now; the wallet and the bay follow when the reads land.
    if (!isDefiniteBuyFailure(out.reason)) { void refreshOwnProfile(); void refreshCrates(); }
    return out;
  }
  adoptProgressionProfile(userId, out.profile);
  mergeCrate(out.value.crate);
  return { status: 'ok', result: out.value };
}

/** Equip an owned title (null takes it off). Returns whether the server accepted it. */
export async function equipTitle(titleId: string | null): Promise<boolean> {
  if (import.meta.env.DEV && devUnlockAllOn()) { devUnlockEquipTitle(titleId); return true; }
  const userId = currentUserId();
  if (!userId) return false;
  const out = await equipTitleRemote(titleId).catch(() => null);
  if (!out || out.status !== 'ok') return false;
  adoptProgressionProfile(userId, out.profile);
  return true;
}

/** Re-read the server's catalog switches (retired items / disabled categories). Never throws. */
export async function refreshServerCatalog(): Promise<void> {
  const state = await fetchServerCatalogState().catch(() => undefined);
  if (state) applyServerCatalogState(state);
}

/** Wear an owned skin on its hero / card, or an owned hero attack (target ''), or Default (null). Returns whether
 *  the server accepted it. */
export async function equipCosmetic(slot: EquipSlot, targetId: string, cosmeticId: string | null): Promise<boolean> {
  if (import.meta.env.DEV && devUnlockAllOn()) { devUnlockEquipCosmetic(slot, targetId, cosmeticId); return true; }
  const userId = currentUserId();
  if (!userId) return false;
  // DEV ONLY: a frame granted by the dev test path equips locally, never on the server (see devGrantPortraitFrame).
  if (import.meta.env.DEV && slot === 'portrait_frame' && devEquipPortraitFrame(cosmeticId)) return true;
  const out = await equipCosmeticRemote(slot, targetId, cosmeticId).catch(() => null);
  if (!out || out.status !== 'ok') return false;
  adoptProgressionProfile(userId, out.profile);
  return true;
}

/**
 * DEV ONLY (the Crate opening tuner's Preview buttons): show hero titles on THIS client as if owned, so the Career
 * header, the Collection and the Achievements tab can be checked without winning 10 Ranked games. In memory only:
 * nothing is saved and nothing is sent (the next server read replaces it; `clear` restores the saved mirror).
 * `titles` owns every base hero title and wears Warden's; `masters` owns every title AND master and wears Warden's
 * golden master.
 */
export function devPreviewHeroTitles(tier: 'titles' | 'masters' | 'clear', userId: string | null = currentUserId() ?? 'dev-preview'): void {
  if (tier === 'clear') { useProgression.setState({ mirror: loadMirror() }); return; }
  const base = mirrorFor(userId, useProgression.getState().mirror) ?? { userId: userId!, accountXp: 0, accountLevel: 1, revision: 0, equippedTitleId: null, titles: [] };
  const ids = HERO_TITLE_COSMETICS.filter((c) => tier === 'masters' || !isMasterTitle(c.id)).map((c) => c.id);
  const union = (xs: readonly string[] | undefined): string[] => [...new Set([...(xs ?? []), ...ids])];
  useProgression.setState({
    mirror: {
      ...base, userId: userId!, titles: union(base.titles), cosmetics: union(base.cosmetics ?? base.titles),
      equippedTitleId: tier === 'masters' ? heroMasterTitleId('warden') : heroTitleId('warden'),
    },
  });
}

// ── DEV ONLY: a local test grant for portrait frames ─────────────────────────────────────────────────────────

/**
 * DEV ONLY (owner 2026-10-01: "put a test frame in the collections, and set it to the gold one, and let me test
 * equipping it and see what it looks like in game"). The `portrait_frame` SQL is not live yet, so this grants a frame
 * to THIS client only: the Crate opening tuner's "Dev: grant Gilded frame" adds it to the owned set, and the
 * Collection's Equip / "Use default frame" then work LOCALLY (`equipCosmetic` short-circuits for a dev-granted id).
 * Kept in localStorage (`ascent.dev.portraitFrames`) so it survives a reload; laid over the mirror IN MEMORY (the
 * saved mirror and the server are never written), re-applied whenever the mirror changes. The frame then reaches
 * every portrait through the NORMAL path: the mirror's loadout -> `usePortraitFrame('self')`, and a new run records it
 * in `run.cosmetics` -> the in-run portrait. Production builds never install it (`import.meta.env.DEV`).
 */
const DEV_FRAMES_KEY = 'ascent.dev.portraitFrames';
interface DevFrames { owned: string[]; equipped: string | null }
function loadDevFrames(): DevFrames {
  try {
    const o = JSON.parse(localStorage.getItem(DEV_FRAMES_KEY) ?? 'null') as Partial<DevFrames> | null;
    const owned = Array.isArray(o?.owned) ? o!.owned.filter((x): x is string => typeof x === 'string') : [];
    return { owned, equipped: typeof o?.equipped === 'string' && owned.includes(o.equipped) ? o.equipped : null };
  } catch {
    return { owned: [], equipped: null };
  }
}
function saveDevFrames(d: DevFrames): void {
  try { if (d.owned.length) localStorage.setItem(DEV_FRAMES_KEY, JSON.stringify(d)); else localStorage.removeItem(DEV_FRAMES_KEY); } catch { /* ignore */ }
}
/** The mirror with the dev grant laid over it, or null when it already carries it (so the subscriber never loops). */
function withDevFrames(m: ProgressionMirror | null, d: DevFrames, wasEquipped: string | null = null): ProgressionMirror | null {
  if (!d.owned.length && !wasEquipped) return null;
  const userId = currentUserId();
  const base: ProgressionMirror | null = m ?? (userId ? { userId, accountXp: 0, accountLevel: 1, revision: 0, equippedTitleId: null, titles: [] } : null);
  if (!base) return null;
  const owned = base.cosmetics ?? base.titles;
  const missing = d.owned.filter((id) => !owned.includes(id));
  const worn = base.loadout?.portraitFrame ?? null;
  // Wear the dev frame; on "Use default", take off only a frame the dev grant put on.
  const want = d.equipped ?? (worn && (worn === wasEquipped || d.owned.includes(worn)) ? null : worn);
  if (!missing.length && worn === want && m) return null;
  const loadout = { ...(base.loadout ?? {}) };
  if (want) loadout.portraitFrame = want; else delete loadout.portraitFrame;
  return { ...base, cosmetics: [...owned, ...missing], loadout };
}
function applyDevFrames(wasEquipped: string | null = null): void {
  const next = withDevFrames(useProgression.getState().mirror, loadDevFrames(), wasEquipped);
  if (next) useProgression.setState({ mirror: next });
}
/** Equip (or, with null, take off) a dev-granted frame locally. False = not a dev frame: the server handles it. */
function devEquipPortraitFrame(cosmeticId: string | null): boolean {
  const d = loadDevFrames();
  if (cosmeticId ? !d.owned.includes(cosmeticId) : !d.equipped) return false;
  const was = d.equipped;
  saveDevFrames({ ...d, equipped: cosmeticId });
  applyDevFrames(was);
  return true;
}
/** DEV: grant `id` (a portrait frame cosmetic) to this client; `clear` drops every dev grant. */
export function devGrantPortraitFrame(id: string | 'clear'): void {
  if (!import.meta.env.DEV) return;
  const d = loadDevFrames();
  if (id === 'clear') {
    saveDevFrames({ owned: [], equipped: null });
    useProgression.setState({ mirror: loadMirror() });
    return;
  }
  if (!d.owned.includes(id)) saveDevFrames({ ...d, owned: [...d.owned, id] });
  applyDevFrames();
}
if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
  // Re-lay the grant over every new mirror (a server read, an adopt, a reload's saved copy).
  let applying = false;
  useProgression.subscribe((s, prev) => {
    if (applying || s.mirror === prev.mirror) return;
    applying = true;
    try { applyDevFrames(); } finally { applying = false; }
  });
  applyDevFrames();
}

/** The equipped title's display name for a mirror/profile, or null. */
export const equippedTitleName = (p: Pick<ProgressionProfile, 'equippedTitleId'> | null | undefined): string | null => titleName(p?.equippedTitleId ?? null);

// ── The presentation-consumed marker (the ceremony plays once per settled run) ─────────────────────────────

const PRESENTED_KEY = 'ascent.progression.presented';
const PRESENTED_KEEP = 40;
let presented: string[] | null = null;
function loadPresented(): string[] {
  if (presented) return presented;
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESENTED_KEY) ?? '[]') as unknown;
    presented = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    presented = [];
  }
  return presented;
}
const presentedKey = (mode: ProgressionMode, runId: string): string => `${mode}:${runId}`;
export function wasProgressionPresented(mode: ProgressionMode, runId: string): boolean {
  return loadPresented().includes(presentedKey(mode, runId));
}
export function markProgressionPresented(mode: ProgressionMode, runId: string): void {
  const list = loadPresented();
  const k = presentedKey(mode, runId);
  if (list.includes(k)) return;
  list.push(k);
  while (list.length > PRESENTED_KEEP) list.shift();
  try { localStorage.setItem(PRESENTED_KEY, JSON.stringify(list)); } catch { /* best-effort */ }
}
/** Tests: forget the markers, the current run and the mirror. */
export function resetProgressionForTests(): void {
  presented = [];
  try { localStorage.removeItem(PRESENTED_KEY); localStorage.removeItem(MIRROR_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(SERVER_CATALOG_KEY); } catch { /* ignore */ }
  setServerCatalogState(null);
  useProgression.setState({ capability: 'unknown', mirror: null, current: null, cratesCapability: 'unknown', crateList: null, catalogEpoch: 0, achievementsCapability: 'unknown', aetherCapability: 'unknown', economy: DEFAULT_AETHER_ECONOMY, seenKnown: null });
  seenAccount = null;
  seenOnServer.clear();
}

// ── DEV ONLY: "Unlock everything (dev)" (the Crate opening tuner's switch) ───────────────────────────────────

/**
 * DEV ONLY (owner 2026-10-01: "add a store override tuner in the dev tuner that unlocks everything in the store, but
 * if i turn it off, it goes back to my real account unlocks"). While ON, every catalog item counts as owned on THIS
 * client, so the Collection can equip and preview anything and a new run records it (`run.cosmetics`) like a real
 * equip. It is an in-memory overlay on the mirror, the same shape as the portrait-frame dev grant:
 *
 *   real      the mirror as the server / the saved copy last set it. Captured whenever the mirror changes for any
 *             reason other than this overlay (a server read, an adopt, a reload), so the real account keeps
 *             updating underneath and is never written by the overlay (`saveMirror` runs only in an adopt).
 *   overlay   the real mirror + every catalog id owned + the LOCAL equips (`equippedTitleId` + `loadout`, seeded from
 *             the real ones when switched on). `equipTitle` / `equipCosmetic` change only the local equips while ON;
 *             `openCrate` refuses (no inventory write). Nothing reaches the server.
 *   OFF       puts the captured real mirror back, untouched: real ownership and the real loadout exactly as they
 *             were, and every local equip (owned or not) is dropped.
 *
 * The switch + the local equips live in localStorage (`ascent.dev.unlockAll`), so they survive a reload. Every entry
 * point checks `import.meta.env.DEV`: a production build compiles it out and a stored flag there is ignored.
 */
const DEV_UNLOCK_KEY = 'ascent.dev.unlockAll';
interface DevUnlockAll { equippedTitleId: string | null; loadout: RunCosmeticSnapshot }
const DEV_ALL_IDS: readonly string[] = COSMETICS.map((c) => c.id);
const DEV_ALL_TITLE_IDS: readonly string[] = COSMETICS.filter((c) => c.category === 'title').map((c) => c.id);

function loadDevUnlock(): DevUnlockAll | null {
  try {
    const o = JSON.parse(localStorage.getItem(DEV_UNLOCK_KEY) ?? 'null') as Partial<DevUnlockAll> | null;
    if (!o || typeof o !== 'object') return null;
    return {
      equippedTitleId: typeof o.equippedTitleId === 'string' ? o.equippedTitleId : null,
      loadout: o.loadout && typeof o.loadout === 'object' && !Array.isArray(o.loadout) ? o.loadout : {},
    };
  } catch {
    return null;
  }
}
function saveDevUnlock(d: DevUnlockAll | null): void {
  try { if (d) localStorage.setItem(DEV_UNLOCK_KEY, JSON.stringify(d)); else localStorage.removeItem(DEV_UNLOCK_KEY); } catch { /* ignore */ }
}

/** The real mirror under the overlay (undefined = not captured yet), and the last overlay this module set. */
let devReal: ProgressionMirror | null | undefined;
let devOverlay: ProgressionMirror | null = null;
/** Set while this module writes its overlay, so another mirror subscriber that re-lays its own dev grant on top (the
 *  portrait-frame grant) is not mistaken for the real account moving, which would ping-pong the two overlays. */
let devApplying = false;

/** Whether "Unlock everything (dev)" is on. Always false in a production build. */
export function devUnlockAllOn(): boolean {
  return import.meta.env.DEV && typeof localStorage !== 'undefined' && loadDevUnlock() !== null;
}

/** The real mirror with everything owned and the local equips worn. Null when there is no account to lay it on. */
function withDevUnlock(real: ProgressionMirror | null, d: DevUnlockAll): ProgressionMirror | null {
  const userId = currentUserId() ?? real?.userId ?? null;
  if (!userId) return null;
  const base: ProgressionMirror = real && real.userId === userId ? real : { userId, accountXp: 0, accountLevel: 1, revision: 0, equippedTitleId: null, titles: [] };
  const union = (xs: readonly string[], add: readonly string[]): string[] => [...new Set([...xs, ...add])];
  return {
    ...base,
    titles: union(base.titles, DEV_ALL_TITLE_IDS),
    cosmetics: union(base.cosmetics ?? base.titles, DEV_ALL_IDS),
    equippedTitleId: d.equippedTitleId,
    loadout: d.loadout,
  };
}

function applyDevUnlock(): void {
  const d = loadDevUnlock();
  if (!d) return;
  if (devReal === undefined) devReal = useProgression.getState().mirror;
  const next = withDevUnlock(devReal, d);
  if (!next) return;
  devOverlay = next;
  devApplying = true;
  try { useProgression.setState({ mirror: next }); } finally { devApplying = false; }
}

/** DEV: switch "Unlock everything (dev)" on or off. Off restores the real account exactly. No-op in production. */
export function setDevUnlockAll(on: boolean): void {
  if (!import.meta.env.DEV) return;
  if (on) {
    if (loadDevUnlock()) return;
    const real = useProgression.getState().mirror;
    devReal = real;
    // Seed the local equips from what the real account wears, so switching on changes nothing you can see yet.
    const mine = mirrorFor(currentUserId(), real);
    saveDevUnlock({ equippedTitleId: mine?.equippedTitleId ?? null, loadout: mine?.loadout ?? {} });
    applyDevUnlock();
    return;
  }
  if (!loadDevUnlock()) return;
  saveDevUnlock(null);
  const real = devReal !== undefined ? devReal : loadMirror();
  devReal = undefined;
  devOverlay = null;
  useProgression.setState({ mirror: real });
}

/** While ON: wear (or take off, null) a title locally. */
function devUnlockEquipTitle(titleId: string | null): void {
  const d = loadDevUnlock();
  if (!d) return;
  saveDevUnlock({ ...d, equippedTitleId: titleId });
  applyDevUnlock();
}

/** While ON: wear (or take off, null) a skin / account-wide item locally. A per-target slot keys by its target; any
 *  other slot is account-wide and named like its loadout field (`hero_attack` -> `heroAttack`). */
function devUnlockEquipCosmetic(slot: EquipSlot, targetId: string, cosmeticId: string | null): void {
  const d = loadDevUnlock();
  if (!d) return;
  const lo: Record<string, unknown> = { ...d.loadout };
  if (slot === 'emote') {
    // The emote menu keys by position (2026-10-13): move the emote there, like the SQL does.
    const moved = withEmoteAt(lo as RunCosmeticSnapshot, Number(targetId), cosmeticId);
    if (moved.emotes) lo.emotes = moved.emotes; else delete lo.emotes;
  } else if (slot === 'hero_skin' || slot === 'minion_skin') {
    const field = slot === 'hero_skin' ? 'heroSkinByHeroId' : 'minionSkinByCardId';
    const map: Record<string, string> = { ...((lo[field] as Record<string, string> | undefined) ?? {}) };
    if (cosmeticId) map[targetId] = cosmeticId; else delete map[targetId];
    if (Object.keys(map).length) lo[field] = map; else delete lo[field];
  } else {
    const field = (slot as string).replace(/_(\w)/g, (_m, c: string) => c.toUpperCase());
    if (cosmeticId) lo[field] = cosmeticId; else delete lo[field];
  }
  saveDevUnlock({ ...d, loadout: lo as RunCosmeticSnapshot });
  applyDevUnlock();
}

/** Tests: forget the switch and the captured real mirror. */
export function resetDevUnlockAllForTests(): void {
  saveDevUnlock(null);
  devReal = undefined;
  devOverlay = null;
  devApplying = false;
}

if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
  // Any mirror change that is not our own overlay is the REAL account moving (a server read, an adopt, a restore):
  // capture it as the real mirror and lay the overlay back over it. Only runs on a mirror change, never per frame.
  useProgression.subscribe((s, prev) => {
    if (devApplying || s.mirror === prev.mirror || s.mirror === devOverlay || !loadDevUnlock()) return;
    devReal = s.mirror;
    applyDevUnlock();
  });
  applyDevUnlock();
}
