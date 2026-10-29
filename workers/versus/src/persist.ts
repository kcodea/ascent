/**
 * VERSUS ON CLOUDFLARE — results go to Supabase (spike, 2026-10-28: the live writer exists but is OFF).
 *
 * The room plays in memory; what must outlive it is written to the SAME tables the Supabase build fills, so XP
 * (`settle_progression` reads `versus_matches` + `versus_rounds`), the room cards' records (`versus_records`) and
 * Previous match stats keep working with no reader changed:
 *
 *   - `versus_matches`  upserted when the match is created, after every round, and when it completes (`room_id` null:
 *                       the room lives in the object).
 *   - `versus_rounds`   inserted once per committed round (primary key match_id + round).
 *
 * Every write is an idempotent upsert keyed by the table's primary key (`Prefer: resolution=merge-duplicates`), so a
 * retry after a timeout (the write may have landed) is harmless. Jobs are queued in the object's storage (`ob:<seq>`,
 * one key per job so a large round never makes one huge value) and drained in order by the alarm, with exponential
 * backoff; a failed job never blocks the game, only the write behind it.
 *
 * The writer is the limited RPC `versus_cf_persist` (see SupabaseRpcSink), never the service role.
 */
import type { PersistJob } from './core/roomCore';
import { rankedFinishWire } from './core/rankedMatch';

export interface PersistEnv {
  SUPABASE_URL?: string;
  /** The project's publishable (anon) key: public, a plain var. */
  SUPABASE_ANON_KEY?: string;
  /** The writer secret (a Worker secret). Its sha256 is the only row of `versus_cf_writer_keys`. */
  VERSUS_WRITER_SECRET?: string;
  PERSIST?: string;
}

export interface PersistSink {
  readonly live: boolean;
  write(job: PersistJob): Promise<void>;
}

/** Persistence off: nothing leaves the Worker; the jobs are kept (capped) for tests and the measurement script. */
export class LocalSink implements PersistSink {
  readonly live = false;
  readonly written: PersistJob[] = [];
  async write(job: PersistJob): Promise<void> {
    this.written.push(job);
    if (this.written.length > 200) this.written.shift();
  }
}

/**
 * The limited writer (owner ruling 2026-10-28: never the service role): ONE RPC, `versus_cf_persist`
 * (supabase/migrations/2026-11-04-versus-cf-writer.sql), called with the publishable key and gated by the writer secret.
 * It can only upsert a Cloudflare 1v1 match and insert its rounds; both are idempotent, so a retry is harmless.
 */
export class SupabaseRpcSink implements PersistSink {
  readonly live = true;
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}

  async write(job: PersistJob): Promise<void> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/versus_cf_persist`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, p_kind: job.kind, p_row: wireRow(job) }),
    });
    if (!res.ok) throw new Error(`persist ${job.kind} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** The row as the writer sends it: a `ranked_finish` queued before the wire fix is made safe here too (R-VERSUS-CF-PERSIST-01). */
export function wireRow(job: PersistJob): unknown {
  return job.kind === 'ranked_finish' ? rankedFinishWire(job.row) : job.row;
}

export function sinkFor(env: PersistEnv): PersistSink {
  if (env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.VERSUS_WRITER_SECRET) {
    return new SupabaseRpcSink(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.VERSUS_WRITER_SECRET);
  }
  return new LocalSink();
}

/** Retry schedule: 1 s, 2 s, 4 s ... capped at 60 s. */
export const persistBackoffMs = (attempt: number): number => Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));

/** Failed attempts before a job is set aside (`dead:<key>`): about 8 minutes on the backoff above. */
export const PERSIST_DEAD_AFTER = 10;
