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
 */
import { create } from 'zustand';
import { queueNewRewards } from './newRewards';
import {
  HERO_TITLE_COSMETICS, heroMasterTitleId, heroTitleId, isMasterTitle, setServerCatalogState, titleName, type ServerCatalogState, type EquipSlot, type CrateRow, type OpenCrateResult, type ProgressionMode, type ProgressionProfile, type ProgressionResult, type ProgressionRunFacts,
} from '@game/progression';
import { currentUserId } from '../identity';
import { remoteEnabled } from '../remoteBoards';
import {
  enqueuePendingProgression, flushPendingProgressions, installProgressionRetryTriggers, type PendingProgression,
} from './progressionQueue';
import {
  equipCosmeticRemote, equipTitleRemote, fetchAchievementsEnabled, fetchCratesEnabled, fetchOwnCrates, fetchOwnProgression, fetchProgressionEnabled, fetchServerCatalogState, openCrateRemote, progressionRequestFor,
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
  const next: ProgressionMirror = { ...profile, userId };
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
    await flushPendingProgressions(applyProgressionOutcome, { force: true });
    // The crates probe: a separate switch, so the XP panel works before the crates migration runs.
    const crates = await fetchCratesEnabled();
    if (crates !== undefined) useProgression.setState({ cratesCapability: crates ? 'on' : 'off' });
    if (crates) await refreshCrates();
    // The achievements probe: its own switch (the owner flips it after deploying the Edge Function).
    const ach = await fetchAchievementsEnabled();
    if (ach !== undefined) useProgression.setState({ achievementsCapability: ach ? 'on' : 'off' });
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

/** Open one crate through the server. The reward (or `pool_exhausted`) comes back; the profile is adopted. */
export async function openCrate(crateId: string): Promise<CrateOpenOutcome> {
  const userId = currentUserId();
  if (!userId) return { status: 'error', reason: 'no_session' };
  const out = await openCrateRemote(crateId).catch((e: unknown) => ({ status: 'error' as const, reason: String((e as Error)?.message ?? e) }));
  if (out.status !== 'ok') return out;
  adoptProgressionProfile(userId, out.profile);
  mergeCrate(out.value.crate);
  return { status: 'ok', result: out.value };
}

/** Equip an owned title (null takes it off). Returns whether the server accepted it. */
export async function equipTitle(titleId: string | null): Promise<boolean> {
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
  useProgression.setState({ capability: 'unknown', mirror: null, current: null, cratesCapability: 'unknown', crateList: null, catalogEpoch: 0, achievementsCapability: 'unknown' });
}
