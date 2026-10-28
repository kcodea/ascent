/**
 * VERSUS ON CLOUDFLARE — how a room's state is split across Durable Object storage keys.
 *
 * The object keeps the whole room in memory, but hibernation (and any restart) evicts memory while the sockets stay
 * open, so every change is written through before its effects are sent. The state is split so a write is small:
 *
 *   meta          room + members + the current match row(s) + the seats' private rows (a few KB)
 *   sub:<seat>    1v1: the seat's current-round submission (prepared side up to 256 KB + checkpoint up to 1 MB)
 *   last:<seat>   1v1: the seat's last locked board from an earlier round (an absent seat's auto board)
 *   ckpt:<seat>   1v1: the seat's newest locked checkpoint from an earlier round (the reconnect restore point)
 *   round:<n>     1v1: one committed round (both perspectives of the fight)
 *   gsub / glast / gckpt:<seat>, ground:<n>   the same for a GROUP match (seats p1-p4; a round holds its 1-2 fights)
 *   ob:<seq>      persistence jobs not yet acknowledged by Supabase (see ../persist.ts)
 *
 * SQLite-backed objects take values up to 2 MB, which bounds a checkpoint (1 MB) comfortably.
 */
import type { CoreState, RoundRow, Seat } from './roomCore';
import { GSEATS, type GroupState, type GRound, type GSeat } from './groupMatch';

const SEATS: readonly Seat[] = ['p1', 'p2'];

/** The value to store for one dirty key (undefined = delete the key). */
export function valueOfKey(state: CoreState, key: string): unknown {
  if (key === 'meta') {
    const g = state.group;
    return { v: state.v, room: state.room, match: state.match, priv: state.priv, group: g ? { match: g.match, priv: g.priv } : null };
  }
  const [kind, id] = key.split(':');
  if (kind === 'sub') return state.subs[id as Seat];
  if (kind === 'last') return state.lastLocked[id as Seat];
  if (kind === 'ckpt') return state.lastCheckpoint[id as Seat];
  if (kind === 'round') return state.rounds[Number(id)];
  const g = state.group;
  if (!g) return undefined;
  if (kind === 'gsub') return g.subs[id as GSeat];
  if (kind === 'glast') return g.lastLocked[id as GSeat];
  if (kind === 'gckpt') return g.lastCheckpoint[id as GSeat];
  if (kind === 'ground') return g.rounds[Number(id)];
  if (kind === 'gpass') return g.passes?.[Number(id)];
  return undefined;
}

/** Rebuild the state from every stored key (null when the room was never created). */
export function stateFromEntries(entries: Map<string, unknown>): CoreState | null {
  const meta = entries.get('meta') as (Pick<CoreState, 'v' | 'room' | 'match' | 'priv'> & { group?: Pick<GroupState, 'match' | 'priv'> | null }) | undefined;
  if (!meta) return null;
  const { group: gmeta, ...rest } = meta;
  const state: CoreState = { ...rest, subs: {}, lastLocked: {}, lastCheckpoint: {}, rounds: {}, group: null };
  for (const s of SEATS) {
    const sub = entries.get(`sub:${s}`);
    if (sub) state.subs[s] = sub as CoreState['subs'][Seat];
    const last = entries.get(`last:${s}`);
    if (last !== undefined) state.lastLocked[s] = last;
    const ck = entries.get(`ckpt:${s}`);
    if (ck) state.lastCheckpoint[s] = ck as CoreState['lastCheckpoint'][Seat];
  }
  if (gmeta) {
    const g: GroupState = { match: gmeta.match, priv: gmeta.priv, subs: {}, lastLocked: {}, lastCheckpoint: {}, rounds: {} };
    for (const s of GSEATS) {
      const sub = entries.get(`gsub:${s}`);
      if (sub) g.subs[s] = sub as GroupState['subs'][GSeat];
      const last = entries.get(`glast:${s}`);
      if (last !== undefined) g.lastLocked[s] = last;
      const ck = entries.get(`gckpt:${s}`);
      if (ck) g.lastCheckpoint[s] = ck as GroupState['lastCheckpoint'][GSeat];
    }
    state.group = g;
  }
  for (const [k, v] of entries) {
    // A round of an older match (left behind before the new match's deletes landed) is ignored.
    if (k.startsWith('round:')) {
      const row = v as RoundRow;
      if (state.match && row.match_id === state.match.id) state.rounds[row.round] = row;
    } else if (k.startsWith('gpass:') && state.group) {
      const rows = v as GroupState['passes'] extends Record<number, infer P> | undefined ? P : never;
      if (Array.isArray(rows) && rows[0]?.match_id === state.group.match.id) (state.group.passes ??= {})[Number(k.slice(6))] = rows;
    } else if (k.startsWith('ground:') && state.group) {
      const row = v as GRound;
      if (row.match_id === state.group.match.id) state.group.rounds[row.round] = row;
    }
  }
  return state;
}
