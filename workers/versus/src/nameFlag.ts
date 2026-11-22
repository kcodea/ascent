/**
 * NAME FLAGS FROM THE ROOM (R-NAME-FILTER-01, owner 2026-11-22: "account name and party name flags").
 *
 * A Versus room's name lives only in this Worker, so a name the filter FLAGS (allowed, but worth a look) is reported to
 * the private dashboard's moderation queue through ONE key-gated RPC, `moderation_cf_flag`
 * (supabase/migrations/2026-11-28-moderation.sql), with the publishable key and the writer secret that
 * `versus_cf_persist` already uses (never the service role). The SQL reads the name again itself and stores a flag
 * only when its own filter agrees. Best effort: a failed report is logged and never blocks the room. A BLOCKED name
 * never gets here: `newRoomState` refuses it (`name_blocked`).
 */
import { nameVerdict } from '@game/sim/versus/server';
import type { PersistEnv } from './persist';

const FLAG_TIMEOUT_MS = 5000;

/** Whether this room name should be reported (the filter says flag). */
export const roomNameNeedsFlag = (name: string): boolean => nameVerdict(name).verdict === 'flag';

/** Report a flagged room name. Answers false when persistence is off (local dev) or the call failed. */
export async function reportRoomName(env: PersistEnv, room: { id: string; name: string; hostUserId: string }, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (env.PERSIST !== '1' || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.VERSUS_WRITER_SECRET) return false;
  const res = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/moderation_cf_flag`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: env.VERSUS_WRITER_SECRET, p_room: room.id, p_name: room.name, p_owner: room.hostUserId }),
    signal: AbortSignal.timeout(FLAG_TIMEOUT_MS),
  });
  return res.ok;
}
