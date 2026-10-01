/**
 * CROSS-DEVICE SAVES (owner ask 2026-09-30: "if a player is playing on one device and they save/quit, can we allow
 * that to be picked up from another device they are signed in on?"). R-PERSIST-CLOUD-01..03.
 *
 * The LOCAL save (`ascent.save`, store.ts) stays the source of truth on a device and is always written first,
 * exactly as before, so offline play is unchanged. This module mirrors it to ONE server row per SIGNED-IN account
 * (`public.saved_runs`, supabase/migrations/2026-09-30-saved-runs.sql) and reconciles the two:
 *
 *  - UPLOAD: after a save (Save & Quit / tab hide, the start of each shop phase, a new run) the raw local save
 *    string rides up as-is. Fire-and-forget and serialized through one chain; a network failure keeps the save
 *    DIRTY and retries with backoff (and on `online` / a new session). Guests (anonymous accounts) never upload.
 *  - ONE DEVICE AT A TIME: the row carries a `revision`. Every write names the revision this device last saw
 *    (its LEASE); the server accepts it only when that is still current (`put_saved_run`). Continue CLAIMS the run
 *    (bumps the revision under this device), so the other device's next write is REFUSED and it is told the run
 *    moved, never silently overwriting newer progress.
 *  - CONTINUE ANYWHERE: at the title a signed-in client compares its local save + lease with the cloud row
 *    (`decideAtTitle`, pure) and adopts the cloud run when it is newer, pushes the local one when that is newer,
 *    or drops a local copy of a run the cloud says has ENDED (a synced run whose row is gone).
 *  - RUN END clears the row (`clear_saved_run`, revision-checked), so Continue disappears everywhere.
 *
 * FEATURE-DETECTED: until the owner runs the SQL every call answers `absent`, the module switches itself off for
 * the session and nothing else changes.
 */
import type { BoardSnapshot } from '@game/sim';

/** What travels to the server: the local save string byte-for-byte, plus the recordings behind the lobby's
 *  snapshot seats (a seat stores only a `runKey`, resolved against THIS session's pool; another device's pool
 *  is a different random sample, so without the boards those seats would fall back to bots). */
export interface CloudPayload { v: 1; save: string; seatRuns?: BoardSnapshot[][] }
export interface CloudRowMeta { runKey: string; revision: number; deviceId: string; updatedAt: string }
export interface CloudRow extends CloudRowMeta { payload: CloudPayload }

/** A read's answer: the row, `null` (no row: nothing saved / the run ended), or why it couldn't be asked. */
export type CloudRead<T> = T | null | 'unavailable' | 'absent';
export type PutResult =
  | { status: 'ok'; revision: number }
  /** Refused: the row moved on. `current` is what is there now (null = the row is gone: the run ended). */
  | { status: 'conflict'; current: CloudRowMeta | null }
  | { status: 'unavailable' }
  | { status: 'absent' };
export type ClearResult = 'ok' | 'conflict' | 'unavailable' | 'absent';

/** The server seam — Supabase in the app (`supabaseCloudSaveApi`), an in-memory fake in tests. */
export interface CloudSaveApi {
  fetchMeta(): Promise<CloudRead<CloudRowMeta>>;
  fetchRow(): Promise<CloudRead<CloudRow>>;
  /** `payload: null` = CLAIM only (bump the revision under this device, keep the stored save). */
  put(a: { runKey: string; expected: number; deviceId: string; payload: CloudPayload | null }): Promise<PutResult>;
  clear(a: { runKey: string; expected: number }): Promise<ClearResult>;
}

/** This device's knowledge of the cloud row for the local save. `revision` 0 = never synced. */
export interface Lease { userId: string | null; runKey: string; revision: number; dirty: boolean; savedAt: number }

const LEASE_KEY = 'ascent.cloudsave';
const DEVICE_KEY = 'ascent.deviceid';

export function loadLease(): Lease | null {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Lease>;
    if (typeof o.runKey !== 'string' || typeof o.revision !== 'number') return null;
    return { userId: o.userId ?? null, runKey: o.runKey, revision: o.revision, dirty: !!o.dirty, savedAt: o.savedAt ?? 0 };
  } catch { return null; }
}
function saveLease(l: Lease | null): void {
  try { if (l) localStorage.setItem(LEASE_KEY, JSON.stringify(l)); else localStorage.removeItem(LEASE_KEY); } catch { /* ignore */ }
}

/** A stable id for this browser profile / install. UI-side randomness, never the seeded sim. */
export function deviceId(): string {
  try {
    const have = localStorage.getItem(DEVICE_KEY);
    if (have) return have;
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch { return 'd-unknown'; }
}

/** The identity of a run in the save slot: a rated lobby's minted `runId`, else its seed. */
export function runKeyOf(run: { runId?: string | null; seed: number }): string {
  return run.runId ? `run:${run.runId}` : `seed:${run.seed}`;
}

/** Called on EVERY local save write (guests too — it is only bookkeeping): the save changed, so it is dirty. A
 *  different run replacing the slot starts a fresh, never-synced lease. */
export function noteLocalSave(runKey: string, now = Date.now()): void {
  const l = loadLease();
  saveLease(l && l.runKey === runKey ? { ...l, dirty: true, savedAt: now } : { userId: null, runKey, revision: 0, dirty: true, savedAt: now });
}
/** The local save was removed (run end, Clear, an unloadable save): the lease goes with it. */
export function noteLocalClear(): void { saveLease(null); }

// ── The title decision (pure) ─────────────────────────────────────────────────────────────────────────────
export type TitleDecision =
  | 'none'
  /** The cloud copy is newer (or the only one): adopt it into the local slot. */
  | 'adopt'
  /** The local copy is newer / not yet uploaded: push it. */
  | 'push'
  /** The local copy is a run the cloud says has ENDED (it was synced, and its row is gone): drop it. */
  | 'discard-local';

/**
 * Local vs cloud, for a signed-in player at the title. `local` is the local save's run key (null = no local save),
 * `lease` this device's lease (already filtered to THIS account by the caller), `cloud` the row's meta.
 */
export function decideAtTitle(local: string | null, lease: Lease | null, cloud: CloudRowMeta | null): TitleDecision {
  const synced = !!lease && lease.runKey === local && lease.revision > 0;
  if (!local) return cloud ? 'adopt' : 'none';
  if (!cloud) return synced ? 'discard-local' : 'push';
  if (cloud.runKey === local) {
    if (synced && lease!.revision === cloud.revision) return lease!.dirty ? 'push' : 'none';
    return 'adopt'; // another device wrote this run after us (or our lease is lost): theirs is newer
  }
  // A DIFFERENT run holds the account's slot. A local run that was synced before has been superseded (the
  // account moved on to a new run elsewhere). One never synced (played offline) competes on time.
  if (synced) return 'adopt';
  const localAt = lease && lease.runKey === local ? lease.savedAt : 0;
  return localAt > Date.parse(cloud.updatedAt) ? 'push' : 'adopt';
}

// ── The live service ──────────────────────────────────────────────────────────────────────────────────────
export interface CloudSaveDeps {
  api: CloudSaveApi;
  /** The signed-in (NON-anonymous) account id, or null (guest / offline / no backend). */
  userId(): string | null;
  /** The raw local save string (`ascent.save`), or null. */
  readLocal(): string | null;
  /** The seat recordings for the local save's run (cached per run by the caller). */
  seatRuns(): BoardSnapshot[][] | undefined;
  /** The server refused this device's write/claim: the run moved to another device (or ended there). */
  onMoved(current: CloudRowMeta | null): void;
  /** Retry scheduling (injectable for tests). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

export const RETRY_MS = [2000, 5000, 15000, 30000, 60000] as const;

export interface CloudSave {
  /** Is the cloud feature live for this player right now (signed in, backend deployed)? */
  active(): boolean;
  /** Upload the current local save if it is dirty (fire-and-forget; retried). */
  requestUpload(): Promise<void>;
  /** Continue pressed: take the run for this device. Resolves with the outcome (never throws). */
  claim(): Promise<'ok' | 'moved' | 'offline' | 'inactive'>;
  /** The run in the slot ENDED (or was discarded): clear the cloud row. Captures the lease NOW (before the
   *  local clear removes it). */
  endRun(): Promise<void>;
  /** The title reconcile: fetch + decide (+ fetch the row when adopting). */
  checkAtTitle(localRunKey: string | null): Promise<{ decision: TitleDecision; row?: CloudRow }>;
  /** A cloud row was adopted into the local slot: this device now holds its revision (not yet claimed). */
  adopted(row: CloudRowMeta): void;
  /** Has another device written past our lease? (tab-return check; cheap meta read) */
  movedElsewhere(): Promise<CloudRowMeta | null | false>;
  /** Tests. */
  idle(): Promise<void>;
}

export function createCloudSave(deps: CloudSaveDeps): CloudSave {
  let chain: Promise<unknown> = Promise.resolve();
  let disabled = false; // the SQL isn't deployed: off for the session
  let retryIdx = 0;
  let retryTimer = false;
  const later = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const run = <T>(op: () => Promise<T>): Promise<T> => {
    const next = chain.then(op, op);
    chain = next.catch(() => undefined);
    return next;
  };
  const active = (): boolean => !disabled && !!deps.userId();
  /** The lease as it applies to THIS account: a lease minted under another account (or none) is unsynced. */
  const leaseFor = (uid: string): Lease | null => {
    const l = loadLease();
    if (!l) return null;
    return l.userId === uid || l.userId === null ? l : { ...l, userId: null, revision: 0 };
  };
  const scheduleRetry = (): void => {
    if (retryTimer) return;
    retryTimer = true;
    const ms = RETRY_MS[Math.min(retryIdx, RETRY_MS.length - 1)]!;
    retryIdx++;
    later(() => { retryTimer = false; void svc.requestUpload(); }, ms);
  };

  const svc: CloudSave = {
    active,
    requestUpload: () => run(async () => {
      const uid = deps.userId();
      if (disabled || !uid) return;
      const raw = deps.readLocal();
      const lease = leaseFor(uid);
      if (!raw || !lease || !lease.dirty) return;
      const savedAt = lease.savedAt;
      const res = await deps.api.put({
        runKey: lease.runKey, expected: lease.revision, deviceId: deviceId(),
        payload: { v: 1, save: raw, ...(deps.seatRuns() ? { seatRuns: deps.seatRuns() } : {}) },
      });
      if (res.status === 'absent') { disabled = true; return; }
      if (res.status === 'unavailable') { scheduleRetry(); return; }
      retryIdx = 0;
      if (res.status === 'conflict') { deps.onMoved(res.current); return; }
      // Only clear DIRTY if nothing was saved locally while the upload was in flight.
      const now = loadLease();
      if (now && now.runKey === lease.runKey) saveLease({ ...now, userId: uid, revision: res.revision, dirty: now.savedAt !== savedAt });
    }),
    claim: () => run(async () => {
      const uid = deps.userId();
      if (disabled || !uid) return 'inactive' as const;
      const lease = leaseFor(uid);
      if (!lease) return 'inactive' as const;
      if (lease.revision === 0) {
        // Never synced: there is nothing to claim yet; the upload itself takes the slot (expected 0).
        saveLease({ ...lease, dirty: true });
        return 'offline' as const; // resolved by the upload that follows
      }
      const res = await deps.api.put({ runKey: lease.runKey, expected: lease.revision, deviceId: deviceId(), payload: null });
      if (res.status === 'absent') { disabled = true; return 'inactive' as const; }
      if (res.status === 'unavailable') return 'offline' as const;
      if (res.status === 'conflict') { deps.onMoved(res.current); return 'moved' as const; }
      const now = loadLease();
      if (now && now.runKey === lease.runKey) saveLease({ ...now, userId: uid, revision: res.revision });
      return 'ok' as const;
    }).then((r) => { if (r === 'offline') void svc.requestUpload(); return r; }),
    endRun: () => {
      const uid = deps.userId();
      const lease = uid ? leaseFor(uid) : null;
      return run(async () => {
        if (disabled || !uid || !lease || lease.revision === 0) return;
        const res = await deps.api.clear({ runKey: lease.runKey, expected: lease.revision });
        if (res === 'absent') disabled = true;
      });
    },
    checkAtTitle: (localRunKey) => run(async () => {
      const uid = deps.userId();
      if (disabled || !uid) return { decision: 'none' as TitleDecision };
      const meta = await deps.api.fetchMeta();
      if (meta === 'absent') { disabled = true; return { decision: 'none' as TitleDecision }; }
      if (meta === 'unavailable') return { decision: 'none' as TitleDecision };
      const decision = decideAtTitle(localRunKey, leaseFor(uid), meta);
      if (decision !== 'adopt') return { decision };
      const row = await deps.api.fetchRow();
      if (!row || row === 'absent' || row === 'unavailable' || row.payload?.v !== 1 || typeof row.payload.save !== 'string') return { decision: 'none' as TitleDecision };
      return { decision, row };
    }),
    adopted: (row) => {
      saveLease({ userId: deps.userId(), runKey: row.runKey, revision: row.revision, dirty: false, savedAt: Date.parse(row.updatedAt) || Date.now() });
    },
    movedElsewhere: () => run(async () => {
      const uid = deps.userId();
      if (disabled || !uid) return false as const;
      const lease = leaseFor(uid);
      if (!lease || lease.revision === 0) return false as const;
      const meta = await deps.api.fetchMeta();
      if (meta === 'absent') { disabled = true; return false as const; }
      if (meta === 'unavailable') return false as const;
      if (meta && meta.runKey === lease.runKey && meta.revision === lease.revision) return false as const;
      return meta; // moved (a newer revision / another run) or null (the run ended elsewhere)
    }),
    idle: () => chain.then(() => undefined),
  };
  return svc;
}
