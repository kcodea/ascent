/**
 * VERSUS ON CLOUDFLARE — what a Ranked Duos room reads from Supabase (the pair's team identity and rank, the recorded
 * solo and duo runs the table is seated from). One limited RPC, `versus_cf_ranked(p_key, p_kind, p_args)`
 * (supabase/migrations/2026-11-07-versus-cf-ranked.sql), gated by the same writer secret as the result writer and
 * called with the publishable key: never the service role.
 *
 * Without Supabase configured (local dev, tests) the room still plays: no team identity (the match is unrated) and empty
 * samples, so the seating handler fills the table with generated teams.
 */
import type { RankedService } from './core/rankedMatch';
import type { PersistEnv } from './persist';

export class SupabaseRankedService implements RankedService {
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}

  private async call<T>(kind: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/versus_cf_ranked`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, p_kind: kind, p_args: args }),
    });
    if (!res.ok) throw new Error(`versus_cf_ranked ${kind} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  ensureTeam(a: string, b: string) {
    return this.call<{ teamId: string | null; name: string | null; division: number }>('team', { a, b });
  }

  soloSample(args: { p_limit: number; p_set: string; p_seed: string; p_strength_cap: number | null }) {
    return this.call<unknown[]>('solo_sample', args);
  }

  duoSample(args: { p_limit: number; p_set: string; p_seed: string }) {
    return this.call<{ rows: unknown[]; names: Record<string, string> }>('duo_sample', args);
  }
}

/** No Supabase: an unrated match against generated teams. */
export class LocalRankedService implements RankedService {
  async ensureTeam() { return { teamId: null, name: null, division: 0 }; }
  async soloSample() { return []; }
  async duoSample() { return { rows: [], names: {} }; }
}

export function rankedServiceFor(env: PersistEnv): RankedService {
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.VERSUS_WRITER_SECRET && env.PERSIST === '1') {
    return new SupabaseRankedService(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.VERSUS_WRITER_SECRET);
  }
  return new LocalRankedService();
}
