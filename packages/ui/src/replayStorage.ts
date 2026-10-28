/**
 * REPLAYS IN STORAGE (owner ruling 2026-10-28: "move to cheap storage, keep all"; docs/design/2026-10-28-supabase-cleanup.md
 * 3.5, supabase/migrations/2026-11-07-replays-storage.sql).
 *
 * A finished game's replay (the v1 action log + the v2 state recording, 0.1 to 5 MB of JSON) used to ride inside its
 * `run_telemetry` row. It is written once and read only when someone presses Watch, so it now lives in the private
 * Storage bucket `replays` as gzipped JSON at `<user_id>/<key>.json.gz`, and the row keeps:
 *  - `replay_path`, the object;
 *  - `replay_head`, the replay minus its bulk (`replayHeadOf`), from which the server fills every list fact (`tp_*`).
 * Rows written before the move (and any row whose upload fell back) still carry the replay inline; every reader tries
 * the inline replay first and the object second, so both kinds play.
 *
 * Reads are gated by Storage's own row policy: any signed-in session (a guest included) may read, exactly like the
 * table. A session may only upload into its own folder and never overwrite.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const REPLAY_BUCKET = 'replays';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The replay without its bulk, the twin of the SQL `maint.replay_head` (same rule, so the server derives the same list
 * facts from either): top-level arrays (the v1 action log) and `v2`'s arrays and `stream` go; `v2.frames` keeps only its
 * first and last clock. Everything the lists show (seed, version, clocks, active time, partial, result) survives.
 */
export function replayHeadOf(replay: unknown): unknown {
  if (!isObj(replay)) return replay;
  const head: Json = {};
  for (const [k, v] of Object.entries(replay)) if (k !== 'v2' && !Array.isArray(v)) head[k] = v;
  const v2 = replay.v2;
  if (isObj(v2)) {
    const h2: Json = {};
    for (const [k, v] of Object.entries(v2)) if (k !== 'stream' && !Array.isArray(v)) h2[k] = v;
    const frames = v2.frames;
    if (Array.isArray(frames) && frames.length > 0) {
      const tMs = (f: unknown): unknown => (isObj(f) && 'tMs' in f ? f.tMs : null);
      h2.frames = [{ tMs: tMs(frames[0]) }, { tMs: tMs(frames[frames.length - 1]) }];
    }
    head.v2 = h2;
  }
  return head;
}

/** gzip a string, or null where the platform has no CompressionStream (the caller then keeps the replay inline). */
export async function gzipText(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined' || typeof Blob === 'undefined' || typeof Response === 'undefined') return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** gunzip to a string. */
export async function gunzipText(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

const objectKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Upload a replay into the player's folder. Resolves the row columns to write, or null on ANY failure (no
 * CompressionStream, no bucket yet, offline, refused): the caller then writes the replay inline, as before.
 */
export async function storeReplay(c: SupabaseClient, userId: string, replay: unknown): Promise<{ replay_path: string; replay_head: unknown } | null> {
  try {
    const gz = await gzipText(JSON.stringify(replay));
    if (!gz) return null;
    const path = `${userId}/${objectKey()}.json.gz`;
    const res = await c.storage.from(REPLAY_BUCKET).upload(path, new Blob([gz as BlobPart], { type: 'application/gzip' }), { contentType: 'application/gzip', upsert: false });
    if (res.error) return null;
    return { replay_path: path, replay_head: replayHeadOf(replay) };
  } catch {
    return null;
  }
}

/** Downloaded replays by path, for the session (a replay never changes; a second Watch costs no egress). */
const loaded = new Map<string, Promise<unknown>>();
const STORED_REPLAY_TIMEOUT_MS = 20000;

/** A stored replay's parsed JSON, or null (missing object, network, malformed). Never throws. */
export function loadStoredReplay(c: SupabaseClient, path: string): Promise<unknown> {
  const hit = loaded.get(path);
  if (hit) return hit;
  const p = (async (): Promise<unknown> => {
    try {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), STORED_REPLAY_TIMEOUT_MS));
      const res = await Promise.race([c.storage.from(REPLAY_BUCKET).download(path), timeout]);
      if (!res || res.error || !res.data) return null;
      return JSON.parse(await gunzipText(await res.data.arrayBuffer())) as unknown;
    } catch {
      return null;
    }
  })();
  loaded.set(path, p);
  void p.then((v) => { if (v == null) loaded.delete(path); }); // a failure may be retried by the next Watch
  return p;
}
