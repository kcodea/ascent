/**
 * CROSS-DEVICE SAVES: the Supabase side of `cloudSave.ts` (table `saved_runs`, RPCs `put_saved_run` /
 * `clear_saved_run`; supabase/migrations/2026-09-30-saved-runs.sql). Every call answers instead of throwing:
 * `absent` when the SQL has not been run yet (the feature then switches itself off for the session), and
 * `unavailable` for anything transient (offline, no session, a timeout).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CloudPayload, CloudRead, CloudRow, CloudRowMeta, CloudSaveApi, ClearResult, PutResult } from './cloudSave';

type PgError = { code?: string; message?: string } | null | undefined;

/** The table / function does not exist yet (the owner hasn't run the migration). */
export function isMissing(error: PgError): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883' || code === '404'
    || /could not find the (function|table)/i.test(error.message ?? '');
}

const META_COLS = 'run_key,revision,device_id,updated_at';
type RawRow = { run_key: string; revision: number | string; device_id: string; updated_at: string; payload?: unknown };
const metaOf = (r: RawRow): CloudRowMeta => ({ runKey: r.run_key, revision: Number(r.revision), deviceId: r.device_id, updatedAt: r.updated_at });

export function supabaseCloudSaveApi(client: () => SupabaseClient | null, userId: () => string | null): CloudSaveApi {
  const read = async <T>(cols: string, map: (r: RawRow) => T): Promise<CloudRead<T>> => {
    const c = client();
    const uid = userId();
    if (!c || !uid) return 'unavailable';
    try {
      const { data, error } = await c.from('saved_runs').select(cols).eq('user_id', uid).maybeSingle();
      if (error) return isMissing(error) ? 'absent' : 'unavailable';
      return data ? map(data as unknown as RawRow) : null;
    } catch { return 'unavailable'; }
  };
  return {
    fetchMeta: () => read(META_COLS, metaOf),
    fetchRow: () => read(`${META_COLS},payload`, (r): CloudRow => ({ ...metaOf(r), payload: r.payload as CloudPayload })),
    async put({ runKey, expected, deviceId, payload }): Promise<PutResult> {
      const c = client();
      if (!c) return { status: 'unavailable' };
      try {
        // rows: a scalar RPC (one save slot per account).
        const { data, error } = await c.rpc('put_saved_run', { p_run_key: runKey, p_expected: expected, p_device: deviceId, p_payload: payload });
        if (error) return isMissing(error) ? { status: 'absent' } : { status: 'unavailable' };
        const d = data as { status?: string; revision?: number | string; current?: RawRow | null } | null;
        if (d?.status === 'ok') return { status: 'ok', revision: Number(d.revision) };
        if (d?.status === 'conflict') return { status: 'conflict', current: d.current ? metaOf(d.current) : null };
        return { status: 'unavailable' }; // 'refused' (the server sees a guest) or anything unexpected
      } catch { return { status: 'unavailable' }; }
    },
    async clear({ runKey, expected }): Promise<ClearResult> {
      const c = client();
      if (!c) return 'unavailable';
      try {
        // rows: a scalar RPC (one save slot per account).
        const { data, error } = await c.rpc('clear_saved_run', { p_run_key: runKey, p_expected: expected });
        if (error) return isMissing(error) ? 'absent' : 'unavailable';
        const d = data as { status?: string } | null;
        return d?.status === 'ok' ? 'ok' : d?.status === 'conflict' ? 'conflict' : 'unavailable';
      } catch { return 'unavailable'; }
    },
  };
}
