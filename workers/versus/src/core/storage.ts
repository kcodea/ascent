/**
 * VERSUS ON CLOUDFLARE — how a room's state is split across Durable Object storage keys.
 *
 * The object keeps the whole room in memory, but hibernation (and any restart) evicts memory while the sockets stay
 * open, so every change is written through before its effects are sent. The state is split so a write is small:
 *
 *   meta         room + members + match row + both seats' private rows (a few KB)
 *   sub:<seat>   the seat's current-round submission (the prepared side, up to 256 KB, and its checkpoint, up to 1 MB)
 *   last:<seat>  the seat's last locked board from an earlier round (an absent seat's auto board)
 *   ckpt:<seat>  the seat's newest locked checkpoint from an earlier round (the reconnect restore point)
 *   round:<n>    one committed round (both perspectives of the fight)
 *   outbox       persistence jobs not yet acknowledged by Supabase (see ../persist.ts)
 *
 * SQLite-backed objects take values up to 2 MB, which bounds a checkpoint (1 MB) comfortably.
 */
import type { CoreState, RoundRow, Seat } from './roomCore';

const SEATS: readonly Seat[] = ['p1', 'p2'];

/** The value to store for one dirty key (undefined = delete the key). */
export function valueOfKey(state: CoreState, key: string): unknown {
  if (key === 'meta') return { v: state.v, room: state.room, match: state.match, priv: state.priv };
  const [kind, id] = key.split(':');
  if (kind === 'sub') return state.subs[id as Seat];
  if (kind === 'last') return state.lastLocked[id as Seat];
  if (kind === 'ckpt') return state.lastCheckpoint[id as Seat];
  if (kind === 'round') return state.rounds[Number(id)];
  return undefined;
}

/** Rebuild the state from every stored key (null when the room was never created). */
export function stateFromEntries(entries: Map<string, unknown>): CoreState | null {
  const meta = entries.get('meta') as Pick<CoreState, 'v' | 'room' | 'match' | 'priv'> | undefined;
  if (!meta) return null;
  const state: CoreState = { ...meta, subs: {}, lastLocked: {}, lastCheckpoint: {}, rounds: {} };
  for (const s of SEATS) {
    const sub = entries.get(`sub:${s}`);
    if (sub) state.subs[s] = sub as CoreState['subs'][Seat];
    const last = entries.get(`last:${s}`);
    if (last !== undefined) state.lastLocked[s] = last;
    const ck = entries.get(`ckpt:${s}`);
    if (ck) state.lastCheckpoint[s] = ck as CoreState['lastCheckpoint'][Seat];
  }
  for (const [k, v] of entries) {
    if (!k.startsWith('round:')) continue;
    const row = v as RoundRow;
    // A round of an older match (left behind before the new match's deletes landed) is ignored.
    if (state.match && row.match_id === state.match.id) state.rounds[row.round] = row;
  }
  return state;
}
