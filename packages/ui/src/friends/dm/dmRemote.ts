/**
 * DIRECT MESSAGES — the Supabase reads and the one client write (read receipts), R-DM-03. Every call is one RPC in
 * supabase/migrations/2026-11-12-direct-messages.sql that answers one jsonb value. SENDING never goes through here:
 * a message is sent on the friends hub's socket (`dmHub.ts`), which stores it through the Worker's key-gated writer.
 *
 * EGRESS (R-DM-05): `history` only when a conversation is opened (50 rows, older pages on request); `unread` once per
 * hub connection; `markRead` only when there was something unread; `report` on a player's press.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DmRow } from '@game/versus-cf/hub';
import { supabaseClient } from '../../remoteBoards';

export const DM_PAGE = 50;

export type DmReportReason = 'abuse' | 'spam' | 'cheating' | 'other';

export interface DmUnread {
  count: number;
  last: DmRow | null;
}

export class DmRemoteError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

/** A row from the SQL (`dm__row`), or null when it is not one. */
export function parseDmRow(raw: unknown): DmRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.from !== 'string' || typeof r.to !== 'string' || typeof r.body !== 'string' || typeof r.at !== 'string') return null;
  return {
    id: r.id, cid: typeof r.cid === 'string' ? r.cid : null, from: r.from.toLowerCase(), to: r.to.toLowerCase(), body: r.body, at: r.at,
    readAt: typeof r.readAt === 'string' ? r.readAt : null,
  };
}

export interface DmRemote {
  /** One conversation, NEWEST FIRST, `DM_PAGE` at a time (`before`: the oldest row I have, for the page before it). */
  history(withId: string, before: string | null): Promise<DmRow[]>;
  unread(): Promise<Record<string, DmUnread>>;
  markRead(withId: string): Promise<number>;
  report(messageId: string, reason: DmReportReason): Promise<void>;
}

export function makeDmRemote(getClient: () => SupabaseClient | null): DmRemote {
  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const c = getClient();
    if (!c) throw new DmRemoteError('no_backend');
    // rows: one jsonb value per call (history is capped at 100 rows in SQL), never a table (R-NET-01).
    const { data, error } = await c.rpc(fn, args);
    if (error) {
      const code = error.code === 'PGRST202' || error.code === '42883' ? 'not_deployed' : (error.message ?? 'network').trim();
      throw new DmRemoteError(code, error.message);
    }
    return data as T;
  }
  return {
    async history(withId, before) {
      const rows = await rpc<unknown[]>('dm_history', { p_with: withId, p_before: before, p_limit: DM_PAGE });
      return (Array.isArray(rows) ? rows : []).map(parseDmRow).filter((r): r is DmRow => !!r);
    },
    async unread() {
      const raw = await rpc<Record<string, { count?: unknown; last?: unknown }>>('dm_unread');
      const out: Record<string, DmUnread> = {};
      for (const [id, v] of Object.entries(raw ?? {})) {
        const n = Number(v?.count);
        if (Number.isFinite(n) && n > 0) out[id.toLowerCase()] = { count: n, last: parseDmRow(v?.last) };
      }
      return out;
    },
    markRead: (withId) => rpc<number>('dm_mark_read', { p_with: withId }),
    async report(messageId, reason) { await rpc('dm_report', { p_message: messageId, p_reason: reason }); },
  };
}

export const dmRemote: DmRemote = makeDmRemote(supabaseClient);
