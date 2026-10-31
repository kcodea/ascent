/**
 * THE CLOUD SAVE OF A SESSION GAME (R-SESSION-CF-01). The per-round save (`put_saved_run`, one call carrying the whole
 * save plus every seat recording at each shop start: 130-225 KB a round in the 2026-10-31 audit) goes to the game's
 * session instead, which holds it and writes the Supabase row only when the player parks the game or goes quiet. The
 * row removal at the end goes to the session too, flushed with the game's other end writes.
 *
 * The seat recordings ride a save only when they changed for that game (the session keeps the last ones; the table
 * pin sends them too), so a round's save is the save string alone.
 *
 * Everything else (the title's reads, a Continue's claim) stays on Supabase: those are reads and writes on an event, not
 * per round. A session that cannot be reached answers nothing, and the save goes to Supabase exactly as before.
 */
import type { CloudSaveApi, PutResult } from '../cloudSave';
import { sessionCall, sessionGameForRunKey, type SessionAnswer } from './sessionRemote';
import type { SessionSaveAnswer } from '@game/versus-cf/session';

const sentSeats = new Map<string, string>();
/** Tests. */
export function resetSessionCloudSaveForTests(): void { sentSeats.clear(); }

export function sessionCloudSaveApi(base: CloudSaveApi): CloudSaveApi {
  return {
    fetchMeta: () => base.fetchMeta(),
    fetchRow: () => base.fetchRow(),
    async put(a): Promise<PutResult> {
      const game = a.payload ? sessionGameForRunKey(a.runKey) : null;
      if (!game || !a.payload) return base.put(a);
      const p = a.payload;
      const print = `${(p.seatRuns ?? []).map((r) => r.length).join(',')}|${p.seatHybrids?.length ?? 0}`;
      const seats = sentSeats.get(game) !== print;
      const ans: SessionAnswer<SessionSaveAnswer | { error?: string }> | null = await sessionCall(game, 'save', {
        runKey: a.runKey, expected: a.expected, deviceId: a.deviceId, save: p.save,
        ...(seats ? { seatRuns: p.seatRuns ?? [], seatHybrids: p.seatHybrids ?? [] } : { seatsSame: true }),
      });
      if (!ans || ans.status !== 200) return base.put(a); // unreachable or refused: the old path, as before
      const b = ans.body as SessionSaveAnswer;
      if (b.status === 'ok') {
        if (seats) sentSeats.set(game, print);
        return { status: 'ok', revision: Number(b.revision) };
      }
      if (b.status === 'conflict') {
        const c = b.current;
        return { status: 'conflict', current: c ? { runKey: c.run_key, revision: Number(c.revision), deviceId: c.device_id, updatedAt: c.updated_at } : null };
      }
      return base.put(a);
    },
    async clear(a) {
      const game = sessionGameForRunKey(a.runKey);
      if (!game) return base.clear(a);
      const ans = await sessionCall(game, 'clear', { runKey: a.runKey, expected: a.expected });
      if (ans && ans.status === 200) return 'ok';
      return base.clear(a);
    },
  };
}
