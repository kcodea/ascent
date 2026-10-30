/**
 * THE FRIENDS HUB — direct messages are stored in Supabase (R-DM-02), through the SAME limited, key-gated writer pattern
 * as the Versus results (`versus_cf_persist`), with the hub Worker's OWN secret (`HUB_WRITER_SECRET`): two functions in supabase/migrations/2026-11-12-direct-messages.sql,
 * called with the publishable key and gated by the writer secret, never the service role.
 *
 *   - `dm_cf_send(p_key, p_from, p_to, p_body, p_cid[, p_reply])`: stores one message (`p_reply`, the message it answers,
 *     since 2026-11-15-dm-replies.sql; sent only when set, so a plain message works before that SQL is applied). Postgres is the authority on the rules that
 *     need tables: friends only, no block either way, the body's size, a per-minute backstop on top of the hub's own
 *     limit. The same (sender, client id) again answers the stored row, so a retry after a timeout never doubles it.
 *   - `dm_cf_friends(p_key, p_user)`: the account's accepted friends, nobody blocked either way (the hub's presence
 *     fan-out list, read at most every `HUB_FRIENDS_TTL_MS`).
 *
 * Off (no writer secret, PERSIST not "1"): a DEV Worker uses the memory backend; any other Worker answers every send
 * `unavailable`, which the client shows as "Messages are not available right now" (never a silent drop).
 */
import { DmError, dmErrorOf, MemoryDmBackend, type DmBackend, type SendCheck } from './core/hubCore';
import { cleanReplyPreview, type DmRow } from './hubProtocol';

/** The hub Worker's own settings (`hub.wrangler.toml`): its own writer secret, never the Versus Worker's. */
export interface HubStoreEnv {
  SUPABASE_URL?: string;
  /** The project's publishable (anon) key: public. */
  SUPABASE_ANON_KEY?: string;
  /** The hub's writer secret (a Worker secret). Its sha256 is a row of `versus_cf_writer_keys` (note 'ascent-hub'). */
  HUB_WRITER_SECRET?: string;
  PERSIST?: string;
  DEV_AUTH?: string;
}

export class SupabaseDmBackend implements DmBackend {
  readonly live = true;
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}

  private async rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, ...body }),
    });
    const text = await res.text();
    if (!res.ok) {
      const code = dmErrorOf(text);
      if (code !== 'unavailable') throw new DmError(code);
      throw new Error(`${fn} ${res.status}: ${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async send(from: string, msg: SendCheck): Promise<DmRow> {
    const args: Record<string, unknown> = { p_from: from, p_to: msg.to, p_body: msg.body, p_cid: msg.cid };
    if (msg.replyTo) args.p_reply = msg.replyTo;
    let r: Record<string, unknown> | null;
    try {
      r = (await this.rpc('dm_cf_send', args)) as Record<string, unknown> | null;
    } catch (e) {
      // The replies SQL not applied yet (no 6-argument writer): the message still goes, as a plain one.
      if (!args.p_reply || !/PGRST202|42883/.test(String((e as Error)?.message))) throw e;
      delete args.p_reply;
      r = (await this.rpc('dm_cf_send', args)) as Record<string, unknown> | null;
    }
    if (!r || typeof r.id !== 'string') throw new Error('dm_cf_send: no row');
    return {
      id: r.id, cid: (r.cid as string | null) ?? msg.cid, from: String(r.from ?? from), to: String(r.to ?? msg.to),
      body: String(r.body ?? msg.body), at: String(r.at), readAt: (r.readAt as string | null) ?? null,
      replyTo: typeof r.replyTo === 'string' ? r.replyTo : null, reply: cleanReplyPreview(r.reply),
    };
  }

  async friendsOf(user: string): Promise<string[]> {
    const r = await this.rpc('dm_cf_friends', { p_user: user });
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()) : [];
  }
}

/** Every send refused as `unavailable` (a deployed Worker with persistence off: messages cannot be kept). */
export class OffDmBackend implements DmBackend {
  readonly live = false;
  async send(): Promise<DmRow> { throw new DmError('unavailable'); }
  async friendsOf(): Promise<string[]> { return []; }
}

export function dmBackendFor(env: HubStoreEnv): DmBackend {
  if (env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.HUB_WRITER_SECRET) {
    return new SupabaseDmBackend(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.HUB_WRITER_SECRET);
  }
  return env.DEV_AUTH === '1' ? new MemoryDmBackend() : new OffDmBackend();
}
