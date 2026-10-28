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
 * The key is the service role today (a Worker secret, `SUPABASE_SERVICE_ROLE_KEY`). The design doc recommends a
 * dedicated Postgres role limited to INSERT/UPDATE on these two tables, reached through a narrow RPC.
 */
import type { PersistJob } from './core/roomCore';

export interface PersistEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PERSIST?: string;
}

export interface PersistSink {
  readonly live: boolean;
  write(job: PersistJob): Promise<void>;
}

/** The spike's default: nothing leaves the machine; the jobs are kept (capped) for tests and the measurement script. */
export class LocalSink implements PersistSink {
  readonly live = false;
  readonly written: PersistJob[] = [];
  async write(job: PersistJob): Promise<void> {
    this.written.push(job);
    if (this.written.length > 200) this.written.shift();
  }
}

export class SupabaseRestSink implements PersistSink {
  readonly live = true;
  constructor(private readonly url: string, private readonly key: string) {}

  async write(job: PersistJob): Promise<void> {
    const [table, conflict] = job.kind === 'match' ? ['versus_matches', 'id'] : ['versus_rounds', 'match_id,round'];
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(job.row),
    });
    if (!res.ok) throw new Error(`persist ${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export function sinkFor(env: PersistEnv): PersistSink {
  if (env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseRestSink(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return new LocalSink();
}

/** Retry schedule: 1 s, 2 s, 4 s ... capped at 60 s. */
export const persistBackoffMs = (attempt: number): number => Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));
