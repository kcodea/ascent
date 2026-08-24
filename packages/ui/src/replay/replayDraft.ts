/**
 * REPLAY V2 — DRAFT PERSISTENCE (resume durability).
 *
 * Replay V2 frames are the recorded truth of a run, and until 2026-08-20 they lived ONLY in memory: quitting,
 * reloading, or letting the tab be discarded threw away every frame before the reload, and the resumed run
 * uploaded a `partial` replay that began at whatever wave the player came back on. A public leaderboard run
 * shipped with rounds 7-18 and nothing before them, while its board snapshots and result history covered all
 * 18 — the viewer was faithfully showing the only frames that were ever uploaded.
 *
 * The frames cannot ride in `ascent.save`: localStorage is a synchronous ~5 MB string store and a human run's
 * frames are hundreds of KB of JSON that would have to be re-serialized on every autosave — squarely against
 * the perf contract. So drafts live in **IndexedDB**, written **once per round** as an immutable chunk.
 *
 * Contract:
 *  - Capture is BEST-EFFORT and must never block, throw into, or slow the live run. Every entry point here
 *    resolves rather than rejects; a storage failure downgrades the recording to `partial` and plays on.
 *  - A chunk is keyed `[runId, wave]` and REPLACES its predecessor, so a mid-round flush followed by the
 *    round-boundary write converges on the complete round instead of duplicating it.
 *  - Nothing in this module imports the reducer or simulates anything — it moves recorded frames, no more.
 */
import type { InspectEvent, ReplayFrame, RunMode, RunState } from '@game/sim';

/** Bumped when the stored shape changes; a draft from an older schema is discarded rather than migrated
 *  (it is a disposable in-progress recording, never player-visible data). */
export const REPLAY_DRAFT_SCHEMA = 1;

const DB_NAME = 'ascent.replay';
const DB_VERSION = 1;
const META_STORE = 'replayDrafts';
const CHUNK_STORE = 'replayRoundChunks';

/** Drafts older than this are garbage — a run abandoned at the title, or a browser closed mid-run weeks ago.
 *  Deliberately generous: the cost of keeping one is a few hundred KB, the cost of dropping a live one is a
 *  truncated replay. */
export const DRAFT_STALE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** The synthetic gap inserted at a resume boundary. Real time away (a minute or a week) must NOT become a
 *  replay pause — playback is literal 1:1 and would sit on a still frame for the whole absence — so the two
 *  halves are stitched with one deliberate, human-sized beat instead. */
export const RESUME_GAP_MS = 1200;

export interface ReplayDraftMeta {
  runId: string;
  seed: number;
  heroId: string;
  mode: RunMode;
  createdAtMs: number;
  updatedAtMs: number;
  currentWave: number;
  schemaVersion: number;
}

export interface ReplayRoundChunk {
  runId: string;
  wave: number;
  frames: ReplayFrame[];
  inspectTrail: InspectEvent[];
}

export interface ReplayDraft {
  meta: ReplayDraftMeta;
  chunks: ReplayRoundChunk[];
}

/** The storage seam. The IndexedDB implementation is the shipped one; `memoryDraftStore()` backs tests and
 *  any environment without IDB (node, a private-mode browser that refuses it). */
export interface ReplayDraftStore {
  load(runId: string): Promise<ReplayDraft | null>;
  putChunk(meta: ReplayDraftMeta, chunk: ReplayRoundChunk): Promise<void>;
  remove(runId: string): Promise<void>;
  /** Drop drafts last touched before `before`, never touching `keepRunId`. */
  gc(before: number, keepRunId?: string): Promise<void>;
}

// ── Pure helpers (the testable core — no storage, no clock) ───────────────────────────────────────────────

/**
 * The draft key for a run. The run SEED already serves as the run's identity for rating de-duplication
 * (`runId: String(next.seed)` at upload), so reusing it means a resumed run finds its own draft without the
 * save having to carry a new field.
 */
export function draftRunId(run: Pick<RunState, 'seed'>): string {
  return String(run.seed);
}

/**
 * Which runs record a draft at all. A sandbox run is a disposable dev rig, and practice/tutorial/bots runs
 * never upload a replay — recording them would be pure write traffic for a payload nothing can ever watch.
 */
export function runRecordsDraft(run: Pick<RunState, 'mode' | 'sandbox'>): boolean {
  if (run.sandbox) return false;
  return run.mode !== 'practice' && run.mode !== 'tutorial' && run.mode !== 'bots';
}

/** Highest `tMs` across frames and trail — the cumulative clock position a resume must continue from. */
export function lastRecordedTMs(frames: readonly ReplayFrame[], trail: readonly InspectEvent[] = []): number {
  let max = 0;
  for (const f of frames) if (f.tMs > max) max = f.tMs;
  for (const e of trail) if (e.tMs > max) max = e.tMs;
  return max;
}

/** Shift a recording along the cumulative clock. Used once, at resume, to place the new session's frames
 *  AFTER the restored ones instead of restarting the timeline at zero. */
export function shiftFrames(frames: readonly ReplayFrame[], offsetMs: number): ReplayFrame[] {
  if (!offsetMs) return frames.slice();
  return frames.map((f) => ({ ...f, tMs: f.tMs + offsetMs }));
}

export function shiftInspect(trail: readonly InspectEvent[], offsetMs: number): InspectEvent[] {
  if (!offsetMs) return trail.slice();
  return trail.map((e) => ({ ...e, tMs: e.tMs + offsetMs }));
}

/**
 * Split a recording into per-wave chunks, preserving order within each wave.
 *
 * Inspect events have no wave of their own (they ride the shared clock, not the frame list), so each is
 * assigned to the LAST wave whose first frame is at-or-before it — i.e. the round the player was looking at
 * when they opened the panel. Events before any frame land on the first wave rather than being dropped.
 */
export function splitIntoChunks(
  runId: string,
  frames: readonly ReplayFrame[],
  trail: readonly InspectEvent[] = [],
): ReplayRoundChunk[] {
  const byWave = new Map<number, ReplayRoundChunk>();
  const order: number[] = [];
  for (const f of frames) {
    let c = byWave.get(f.wave);
    if (!c) {
      c = { runId, wave: f.wave, frames: [], inspectTrail: [] };
      byWave.set(f.wave, c);
      order.push(f.wave);
    }
    c.frames.push(f);
  }
  if (order.length === 0) return [];
  // Wave boundaries on the cumulative clock: the tMs of each wave's first frame.
  const bounds = order.map((w) => ({ wave: w, from: byWave.get(w)!.frames[0]!.tMs }));
  for (const e of trail) {
    let target = bounds[0]!;
    for (const b of bounds) { if (b.from <= e.tMs) target = b; else break; }
    byWave.get(target.wave)!.inspectTrail.push(e);
  }
  return order.map((w) => byWave.get(w)!);
}

/**
 * Reassemble a draft into one recording. Chunks are ordered by WAVE (IndexedDB returns them by key, but a
 * caller merging hand-built chunks must not have to care), and frames within a wave keep their recorded
 * order. Both lists come back sorted by `tMs` so the two timelines stay one timeline.
 */
export function mergeDraftChunks(chunks: readonly ReplayRoundChunk[]): { frames: ReplayFrame[]; inspectTrail: InspectEvent[] } {
  const ordered = [...chunks].sort((a, b) => a.wave - b.wave);
  const frames: ReplayFrame[] = [];
  const inspectTrail: InspectEvent[] = [];
  for (const c of ordered) {
    frames.push(...c.frames);
    inspectTrail.push(...c.inspectTrail);
  }
  frames.sort((a, b) => a.tMs - b.tMs);
  inspectTrail.sort((a, b) => a.tMs - b.tMs);
  return { frames, inspectTrail };
}

/** The lowest wave a recording actually contains — what a partial replay must advertise as its start. */
export function firstRecordedWave(frames: readonly ReplayFrame[]): number | null {
  let min: number | null = null;
  for (const f of frames) if (min === null || f.wave < min) min = f.wave;
  return min;
}

/**
 * Is a chunk structurally usable? A draft is written by a possibly-older build and read after an arbitrary
 * interruption, so a corrupt or half-written chunk must be REJECTED rather than fed to `expandFrames` — a
 * delta frame with no keyframe baseline ahead of it renders an empty shop.
 */
export function isValidChunk(c: unknown): c is ReplayRoundChunk {
  if (!c || typeof c !== 'object') return false;
  const o = c as Partial<ReplayRoundChunk>;
  if (typeof o.runId !== 'string' || typeof o.wave !== 'number' || !Number.isFinite(o.wave)) return false;
  if (!Array.isArray(o.frames) || o.frames.length === 0) return false;
  if (o.inspectTrail !== undefined && !Array.isArray(o.inspectTrail)) return false;
  return o.frames.every((f) => f && typeof f === 'object'
    && typeof (f as ReplayFrame).wave === 'number'
    && typeof (f as ReplayFrame).tMs === 'number'
    && ((f as ReplayFrame).kind === 'shop' || (f as ReplayFrame).kind === 'shopDelta' || (f as ReplayFrame).kind === 'combat'));
}

/**
 * Drop everything from the first wave that cannot stand on its own.
 *
 * `expandFrames` reconstructs a delta frame against the keyframe ahead of it, so a restored history must
 * begin on a full `shop` keyframe (every wave's `turnStart` is one) or a `combat` frame. If the earliest
 * chunk somehow begins on a delta — a half-written flush, a schema drift — the whole leading run of frames
 * up to the first valid baseline is dropped rather than shipping a recording that expands into an empty
 * shop. Returns the frames unchanged when the first one is already a valid baseline.
 */
export function trimToBaseline(frames: readonly ReplayFrame[]): ReplayFrame[] {
  const i = frames.findIndex((f) => f.kind !== 'shopDelta');
  if (i <= 0) return i === 0 ? frames.slice() : [];
  return frames.slice(i);
}

// ── The in-memory store (tests, and any environment without IndexedDB) ────────────────────────────────────

export function memoryDraftStore(): ReplayDraftStore {
  const metas = new Map<string, ReplayDraftMeta>();
  const chunks = new Map<string, Map<number, ReplayRoundChunk>>();
  return {
    async load(runId) {
      const meta = metas.get(runId);
      if (!meta) return null;
      const byWave = chunks.get(runId);
      return { meta, chunks: byWave ? [...byWave.values()].sort((a, b) => a.wave - b.wave) : [] };
    },
    async putChunk(meta, chunk) {
      metas.set(meta.runId, meta);
      let byWave = chunks.get(meta.runId);
      if (!byWave) { byWave = new Map(); chunks.set(meta.runId, byWave); }
      byWave.set(chunk.wave, chunk); // REPLACES — a mid-round flush is superseded by the complete round
    },
    async remove(runId) {
      metas.delete(runId);
      chunks.delete(runId);
    },
    async gc(before, keepRunId) {
      for (const [runId, meta] of [...metas]) {
        if (runId === keepRunId) continue;
        if (meta.updatedAtMs < before) { metas.delete(runId); chunks.delete(runId); }
      }
    },
  };
}

// ── IndexedDB ────────────────────────────────────────────────────────────────────────────────────────────

function idbAvailable(): boolean {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!idbAvailable()) { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'runId' });
      if (!db.objectStoreNames.contains(CHUNK_STORE)) db.createObjectStore(CHUNK_STORE, { keyPath: ['runId', 'wave'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // A browser that prompts for storage permission can leave the request hanging forever; capture must not
    // hang with it. The draft is best-effort, so a timeout is simply "no persistence this session".
    req.onblocked = () => resolve(null);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export function indexedDbDraftStore(): ReplayDraftStore {
  // One shared open, lazily. A failed open resolves null forever after — every method degrades to a no-op
  // rather than retrying an open per write.
  let dbp: Promise<IDBDatabase | null> | null = null;
  const db = (): Promise<IDBDatabase | null> => (dbp ??= openDb());

  return {
    async load(runId) {
      try {
        const d = await db();
        if (!d) return null;
        const tx = d.transaction([META_STORE, CHUNK_STORE], 'readonly');
        const meta = await reqToPromise(tx.objectStore(META_STORE).get(runId) as IDBRequest<ReplayDraftMeta>);
        if (!meta || meta.schemaVersion !== REPLAY_DRAFT_SCHEMA) return null;
        // Key range over the compound key: every chunk of this run, in wave order.
        const range = IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]);
        const raw = await reqToPromise(tx.objectStore(CHUNK_STORE).getAll(range) as IDBRequest<unknown[]>);
        const chunks = (raw ?? []).filter(isValidChunk).map((c) => ({ ...c, inspectTrail: c.inspectTrail ?? [] }));
        return { meta, chunks };
      } catch { return null; }
    },
    async putChunk(meta, chunk) {
      try {
        const d = await db();
        if (!d) return;
        const tx = d.transaction([META_STORE, CHUNK_STORE], 'readwrite');
        tx.objectStore(META_STORE).put(meta);
        tx.objectStore(CHUNK_STORE).put(chunk); // compound keyPath → replaces this run's wave
        await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); });
      } catch { /* best-effort: a failed write downgrades the replay, never the run */ }
    },
    async remove(runId) {
      try {
        const d = await db();
        if (!d) return;
        const tx = d.transaction([META_STORE, CHUNK_STORE], 'readwrite');
        tx.objectStore(META_STORE).delete(runId);
        tx.objectStore(CHUNK_STORE).delete(IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]));
        await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); });
      } catch { /* ignore */ }
    },
    async gc(before, keepRunId) {
      try {
        const d = await db();
        if (!d) return;
        const tx = d.transaction([META_STORE], 'readonly');
        const metas = await reqToPromise(tx.objectStore(META_STORE).getAll() as IDBRequest<ReplayDraftMeta[]>);
        for (const m of metas ?? []) {
          if (m.runId === keepRunId) continue;
          if (m.schemaVersion !== REPLAY_DRAFT_SCHEMA || m.updatedAtMs < before) await this.remove(m.runId);
        }
      } catch { /* ignore */ }
    },
  };
}

/** The process-wide store. IndexedDB where it exists, an in-memory stand-in otherwise (node tests, a browser
 *  that refuses IDB) — the calling code never branches on which. */
export const replayDrafts: ReplayDraftStore = idbAvailable() ? indexedDbDraftStore() : memoryDraftStore();
