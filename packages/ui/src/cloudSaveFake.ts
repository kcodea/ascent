/**
 * TEST DOUBLE for the `saved_runs` server (supabase/migrations/2026-09-30-saved-runs.sql): the same accept /
 * refuse rules as `put_saved_run` / `clear_saved_run`, in memory, one row per user. `online = false` makes every
 * call answer `unavailable`; `deployed = false` makes it answer `absent` (the SQL not run yet).
 */
import type { CloudPayload, CloudRow, CloudSaveApi } from './cloudSave';

export interface FakeServer {
  rows: Map<string, CloudRow>;
  online: boolean;
  deployed: boolean;
  /** The next put COMMITS but its answer is lost (`unavailable`): a page frozen mid-request (iOS backgrounding). */
  loseNextAnswer: boolean;
  calls: string[];
  clock: number;
  apiFor(userId: () => string | null): CloudSaveApi;
}

export function fakeCloudServer(): FakeServer {
  const srv: FakeServer = {
    rows: new Map(),
    online: true,
    deployed: true,
    loseNextAnswer: false,
    calls: [],
    clock: Date.parse('2026-09-30T12:00:00Z'),
    apiFor(userId) {
      const gate = (): 'unavailable' | 'absent' | null => (!srv.deployed ? 'absent' : !srv.online || !userId() ? 'unavailable' : null);
      const meta = (r: CloudRow) => ({ runKey: r.runKey, revision: r.revision, deviceId: r.deviceId, updatedAt: r.updatedAt });
      const stamp = (): string => new Date((srv.clock += 1000)).toISOString();
      return {
        async fetchMeta() { srv.calls.push('fetchMeta'); const g = gate(); if (g) return g; const r = srv.rows.get(userId()!); return r ? meta(r) : null; },
        async fetchRow() { srv.calls.push('fetchRow'); const g = gate(); if (g) return g; const r = srv.rows.get(userId()!); return r ? structuredClone(r) : null; },
        async put(a) {
          const res = await put(a);
          if (srv.loseNextAnswer && res.status !== 'unavailable' && res.status !== 'absent') { srv.loseNextAnswer = false; return { status: 'unavailable' }; }
          return res;
        },
        async clear({ runKey, expected }) {
          srv.calls.push(`clear:${expected}`);
          const g = gate(); if (g) return g;
          const uid = userId()!;
          const cur = srv.rows.get(uid);
          if (cur && cur.runKey === runKey && cur.revision === expected) { srv.rows.delete(uid); return 'ok'; }
          return 'conflict';
        },
      };
      async function put({ runKey, expected, deviceId, payload }: Parameters<CloudSaveApi['put']>[0]): ReturnType<CloudSaveApi['put']> {
          srv.calls.push(payload ? `put:${expected}` : `claim:${expected}`);
          const g = gate(); if (g) return { status: g };
          const uid = userId()!;
          const cur = srv.rows.get(uid);
          if (!cur) {
            if (expected === 0 && payload) {
              srv.rows.set(uid, { runKey, revision: 1, deviceId, updatedAt: stamp(), payload: structuredClone(payload) as CloudPayload });
              return { status: 'ok', revision: 1 };
            }
            return { status: 'conflict', current: null };
          }
          if ((cur.runKey === runKey && cur.revision === expected) || (expected === 0 && payload && cur.runKey !== runKey)) {
            const next: CloudRow = { runKey, revision: cur.revision + 1, deviceId, updatedAt: stamp(), payload: payload ? structuredClone(payload) as CloudPayload : cur.payload };
            srv.rows.set(uid, next);
            return { status: 'ok', revision: next.revision };
          }
          return { status: 'conflict', current: meta(cur) };
      }
    },
  };
  return srv;
}
