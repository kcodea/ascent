/**
 * SPECTATOR XP IN A CLOUDFLARE VERSUS ROOM (2026-10-29, R-LIVE-CF-XP-01): who in the room's stands is watching which
 * match right now, as the watch record wants it (`spectate.ts`). Pure.
 *
 * The same rules `spectate_beat` checks on a Supabase room, with the room as the witness:
 *   - a spectator is a member in the `spectator` role with a socket open (the watch screen is on);
 *   - the match is the room's current one: a 1v1 match (`versus`) or a Group / Duos / Ranked Duos match (`group`);
 *   - a finished match is beaten only up to `SPECTATE_GAP_MS` after it completed (Supabase refuses a beat later than
 *     that), so time spent in the room after the end never counts as watching.
 */
import { SPECTATE_GAP_MS, type WatchBeat } from '../spectate';
import type { CoreState } from './roomCore';

export interface RoomWatch {
  /** `<kind>:<match id>`, or null when no match is being watched. */
  target: string | null;
  beats: WatchBeat[];
}

export function roomWatchOf(state: CoreState, connected: ReadonlySet<string>, now: number): RoomWatch {
  const room = state.room;
  if (room.closed) return { target: null, beats: [] };
  let kind: 'versus' | 'group';
  let id: string;
  let completedAt: number | null;
  const m = state.match;
  const g = state.group?.match;
  if (m && room.current_match_id === m.id) { kind = 'versus'; id = m.id; completedAt = m.phase === 'complete' ? m.completed_at ?? now : null; }
  else if (g && room.current_match_id === g.id) { kind = 'group'; id = g.id; completedAt = g.phase === 'complete' ? g.completed_at ?? now : null; }
  else return { target: null, beats: [] };
  if (completedAt != null && now - completedAt > SPECTATE_GAP_MS) return { target: null, beats: [] };
  const ended = completedAt != null;
  const beats = room.members
    .filter((mm) => mm.role === 'spectator' && connected.has(mm.userId))
    .map((mm): WatchBeat => ({ user: mm.userId, kind, target: id, watched_user: null, started_at: null, ended }));
  return { target: `${kind}:${id}`, beats };
}

/** What makes a beat due soon: the match, its end, and who is in the stands. */
export const roomWatchKey = (w: RoomWatch): string =>
  `${w.target ?? ''}|${w.beats[0]?.ended ? 'end' : ''}|${w.beats.map((b) => b.user).sort().join(',')}`;
