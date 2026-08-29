import { supabaseClient } from './remoteBoards';
import { currentUserId } from './identity';
import { diagnose } from './perfDiagnose';
import type { PerfBucket } from './perfMonitor';
import type { PerfRun, PerfRunMeta } from './perfStore';

/**
 * PERF RUNS IN THE CLOUD (owner ask 2026-08-29: *"uploads to supabase and drops it into a performance viewer
 * in game for us"*).
 *
 * The local store answers "was this run worse than my last one". This answers the question a local tool
 * structurally cannot: **"what does this look like on the other machine?"** Mike's hardware, refresh rate and
 * GPU are not Kevin's, and a spike that only reproduces on one of them is exactly the kind that survives for
 * months. `read perf_runs` is deliberately open to every authenticated user for that reason.
 *
 * ── Degrading, not failing ────────────────────────────────────────────────────────────────────────────────
 *
 * Every function here resolves. Signed out, offline, table not created yet, RLS refusing — all of them are
 * ordinary states for a dev tool, and none of them may break the game, the HUD, or even the local half of the
 * analytics screen. A missing table is reported as `notReady` rather than as an error, because the honest
 * message is "the schema has not been run yet", not "something went wrong".
 *
 * ── Why no Edge Function ──────────────────────────────────────────────────────────────────────────────────
 *
 * `bug_reports` goes through one because it is user-submitted content that needs server-side validation and
 * rate limiting. A perf log is our own telemetry from our own dev clients, so a plain insert-own / read-all
 * policy pair is the right size — and it is one less thing for the owner to deploy.
 */

/**
 * Refuse to upload a timeline larger than this. A 2400-bucket run is ~½ MB, so this is roughly 3× the
 * worst realistic case — big enough never to bite in practice, small enough that a runaway counter (a label
 * exploding into thousands of keys) cannot turn the table into a blob store.
 */
export const PERF_MAX_UPLOAD_BYTES = 1_500_000;

export type CloudResult =
  | { kind: 'ok'; id: string }
  /** The table is not there yet — the owner has not run the schema. Not an error; a setup state. */
  | { kind: 'notReady' }
  | { kind: 'failed'; error: string };

/** A cloud row as the viewer needs it: the local shape plus who recorded it. */
export interface CloudRunMeta extends PerfRunMeta {
  author: string;
  /** True when this row is yours — the only ones you are allowed to delete. */
  mine: boolean;
}

/** Postgres' "relation does not exist". The one failure that means "not set up" rather than "broken". */
const isMissingTable = (msg: string): boolean =>
  /relation .*perf_runs.* does not exist|could not find the table|schema cache/i.test(msg);

/**
 * Upload one recording. Returns `notReady` when the table has not been created, so the caller can say so
 * plainly instead of showing a database error to someone whose only problem is an un-run migration.
 */
export async function uploadRun(run: PerfRun, author: string): Promise<CloudResult> {
  const c = supabaseClient();
  const userId = currentUserId();
  if (!c || !userId) return { kind: 'failed', error: 'Not signed in — sign in to share recordings.' };

  const live = run.buckets.filter((b) => !b.hidden);
  const body = JSON.stringify(run.buckets);
  if (body.length > PERF_MAX_UPLOAD_BYTES) {
    return { kind: 'failed', error: `Recording is ${Math.round(body.length / 1024)} kB — over the ${Math.round(PERF_MAX_UPLOAD_BYTES / 1024)} kB upload limit. Record a shorter session.` };
  }

  try {
    // The diagnosis travels WITH the row so the list can show a verdict without loading a timeline, and so a
    // row stays readable even if the rules change later — what it says is what the client concluded then.
    const d = diagnose(run.buckets);
    const { data, error } = await c.from('perf_runs').insert([{
      user_id: userId,
      author,
      patch: run.build,
      note: run.note ?? null,
      mode: run.mode ?? null,
      hero_id: run.heroId ?? null,
      seconds: live.length,
      hz: run.hz,
      worst_frame: run.worstFrame,
      jank_frames: run.jankFrames,
      fps_med: run.fpsMed,
      buckets: run.buckets,
      summary: { verdicts: d.verdicts, phases: d.phases, budgetMs: d.budgetMs, attribution: d.attribution },
    }]).select('id').single();
    if (error) return isMissingTable(error.message) ? { kind: 'notReady' } : { kind: 'failed', error: error.message };
    return { kind: 'ok', id: String((data as { id?: string } | null)?.id ?? '') };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return isMissingTable(msg) ? { kind: 'notReady' } : { kind: 'failed', error: msg };
  }
}

export type CloudList =
  | { kind: 'ok'; runs: CloudRunMeta[] }
  | { kind: 'notReady' }
  | { kind: 'failed'; error: string };

/** Every shared recording, newest first. Buckets are NOT fetched — the list never needs them. */
export async function listCloudRuns(limit = 40): Promise<CloudList> {
  const c = supabaseClient();
  if (!c) return { kind: 'failed', error: 'Not signed in.' };
  const me = currentUserId();
  try {
    const { data, error } = await c.from('perf_runs')
      .select('id, user_id, author, created_at, patch, note, mode, hero_id, seconds, hz, worst_frame, jank_frames, fps_med')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return isMissingTable(error.message) ? { kind: 'notReady' } : { kind: 'failed', error: error.message };
    const rows = (data ?? []) as Record<string, unknown>[];
    return {
      kind: 'ok',
      runs: rows.map((r) => ({
        id: String(r.id),
        author: String(r.author ?? ''),
        mine: !!me && r.user_id === me,
        startedAt: Date.parse(String(r.created_at)),
        seconds: Number(r.seconds ?? 0),
        build: String(r.patch ?? ''),
        note: (r.note as string | null) ?? undefined,
        mode: (r.mode as string | null) ?? undefined,
        heroId: (r.hero_id as string | null) ?? undefined,
        hz: Number(r.hz ?? 0),
        worstFrame: Number(r.worst_frame ?? 0),
        jankFrames: Number(r.jank_frames ?? 0),
        fpsMed: Number(r.fps_med ?? 0),
      })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return isMissingTable(msg) ? { kind: 'notReady' } : { kind: 'failed', error: msg };
  }
}

/** One shared recording's timeline. Null when it is gone or unreadable. */
export async function loadCloudRun(id: string): Promise<PerfBucket[] | null> {
  const c = supabaseClient();
  if (!c) return null;
  try {
    const { data, error } = await c.from('perf_runs').select('buckets').eq('id', id).single();
    if (error || !data) return null;
    const b = (data as { buckets?: unknown }).buckets;
    return Array.isArray(b) ? (b as PerfBucket[]) : null;
  } catch { return null; }
}

/** Delete one of YOUR shared recordings. RLS refuses anyone else's, so this needs no ownership check here. */
export async function deleteCloudRun(id: string): Promise<boolean> {
  const c = supabaseClient();
  if (!c) return false;
  try {
    const { error } = await c.from('perf_runs').delete().eq('id', id);
    return !error;
  } catch { return false; }
}
