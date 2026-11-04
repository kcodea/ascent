/**
 * THE SAMPLE ROOM's state (DEV only; see sampleRoom.ts). Kept apart from the store-facing `home*` calls so this file imports
 * no game store: the room's states can be tested without loading the whole client (that import cost 3 to 7 s inside a test
 * body and timed the suite out under load).
 */
import { create } from 'zustand';
import type { VersusModifierId, VersusRoomOptions } from '@game/sim';
import type { VersusMember, VersusRole, VersusRoom, VersusRoomSummary } from '../versus/versusRemote';
import { roomModeLabel, roomModeOf, type VersusRoomMode } from './pages/versusPh';
import { sampleHeroes } from './sample';

export const SAMPLE_ME = 'sample-me';

interface SampleInput { mode: VersusRoomMode; modifier: VersusModifierId | null; view: 'host' | 'guest'; myRole: VersusRole | null; status: VersusRoom['status']; left: boolean }
interface SampleState extends SampleInput { room: VersusRoom | null }

function build(s: SampleInput): VersusRoom | null {
  if (s.left) return null;
  const heroes = sampleHeroes();
  const mk = (userId: string, role: VersusRole, displayName: string, i: number): VersusMember => ({
    userId, role, displayName, profile: userId === SAMPLE_ME ? {} : { avatar: `hero:${heroes[i % heroes.length]}` }, lastSeenAt: '',
  });
  const host = s.view === 'host' ? SAMPLE_ME : 'sample-1'; // (the sample friends' ids, so the friends list says In this room)
  const guest = s.view === 'guest' ? SAMPLE_ME : 'sample-2';
  const members: VersusMember[] = [mk(host, 'p1', host === SAMPLE_ME ? 'Player' : 'Mike', 0), mk(guest, 'p2', guest === SAMPLE_ME ? 'Player' : 'Brisbane', 1)];
  if (s.mode !== 'duel') members.push(mk('sample-3', 'p3', 'Coran', 2));
  members.push(mk('sample-4', 'spectator', 'Tamby', 3), mk('sample-watch-2', 'spectator', 'Rowan', 4));
  if (s.myRole) for (const m of members) if (m.userId === SAMPLE_ME) m.role = s.myRole;
  return {
    id: 'sample-room', name: `Sample ${roomModeLabel(s.mode)}`, host_user_id: host, status: s.status, set_id: '', content_revision: '', protocol: 0, revision: 0, gate_deadline: null,
    p1_gate: false, p2_gate: false, current_match_id: null, options: { v: 1, mode: s.mode, modifiers: s.modifier ? [s.modifier] : [] } as VersusRoomOptions, members,
  } as VersusRoom;
}

const FIRST: SampleInput = { mode: 'duel', modifier: null, view: 'host', myRole: null, status: 'open', left: false };
export const useSampleRoom = create<SampleState>(() => ({ ...FIRST, room: build(FIRST) }));
export const patchSampleRoom = (p: Partial<SampleInput>): void => useSampleRoom.setState((s) => { const n = { ...s, ...p }; return { ...n, room: build(n) }; });

export const sampleToggleView = (): void => patchSampleRoom({ view: useSampleRoom.getState().view === 'host' ? 'guest' : 'host', myRole: null, status: 'open' });
/** Host the sample again after leaving it (START with no room). */
export const sampleHost = (mode: VersusRoomMode, modifier: VersusModifierId | null): void => patchSampleRoom({ mode, modifier, left: false, view: 'host', myRole: null, status: 'open' });
/** Join a sample Open rooms row: its mode, in the stands. */
export const sampleJoin = (r: VersusRoomSummary): void => patchSampleRoom({ mode: roomModeOf(r.options), modifier: null, left: false, view: 'guest', myRole: 'spectator', status: 'open' });

/** The sample Open rooms list. */
export function sampleRooms(): VersusRoomSummary[] {
  const row = (id: string, name: string, mode: VersusRoomMode, players: number, maxPlayers: number, status: VersusRoom['status'], spectators: number, hostName: string, i: number): VersusRoomSummary => ({
    id, name, status, setId: '', contentRevision: '', protocol: 0, createdAt: '', currentMatchId: null, hostName, hostProfile: { avatar: `hero:${sampleHeroes()[i]}` },
    players, spectators, maxPlayers, options: { v: 1, mode, modifiers: [] } as VersusRoomOptions,
  });
  return [
    row('s1', "Mike's arena", 'duel', 1, 2, 'open', 0, 'Mike', 0), row('s2', 'Friday brawl', 'group', 2, 4, 'open', 1, 'Coran', 1),
    row('s3', 'Team night', 'duos', 3, 4, 'open', 2, 'Tamby', 2), row('s4', 'Finals', 'duel', 2, 2, 'in_game', 6, 'Rowan', 3),
  ];
}
