/**
 * THE SAMPLE ROOM (DEV only, the "Party home: sample room" switch): a mocked Versus room on the party home, so the room state
 * can be reviewed with no backend and no second account. Host, a guest, an open seat (Group and Duos; a 1v1 is full), two
 * spectators, rules, sample Open rooms rows, and the Start states. The mode tabs cycle 1v1 / Group / Duos; View as guest
 * flips the seat you hold; Leave and Start work. No call leaves this file.
 *
 * `home*` are what the home's room code calls: the sample while the switch is on, the store's real call otherwise.
 */
import type { VersusRoomOptions } from '@game/sim';
import { currentUserId } from '../identity';
import type { VersusRole, VersusRoom } from '../versus/versusRemote';
import { leaveRoom, setRoomOptions, startGame, takeSeat } from '../versus/versusStore';
import { partyRoomOn } from './partyHomeFlag';
import { roomModeOf } from './pages/versusPh';
import { patchSampleRoom, SAMPLE_ME, useSampleRoom } from './sampleRoomState';

export { SAMPLE_ME, sampleHost, sampleJoin, sampleRooms, sampleToggleView, useSampleRoom } from './sampleRoomState';

const SAMPLE_START_MS = 2600;
let startTimer = 0;

export const homeMe = (): string | null => (partyRoomOn() ? SAMPLE_ME : currentUserId());
export const homeRoomNow = (real: () => VersusRoom | null): VersusRoom | null => (partyRoomOn() ? useSampleRoom.getState().room : real());
export function homeTakeSeat(role: VersusRole): Promise<boolean> {
  if (!partyRoomOn()) return takeSeat(role);
  const room = useSampleRoom.getState().room;
  if (role !== 'spectator' && room?.members.some((m) => m.role === role && m.userId !== SAMPLE_ME)) return Promise.resolve(false);
  patchSampleRoom({ myRole: role });
  return Promise.resolve(true);
}
export function homeSetOptions(next: VersusRoomOptions): Promise<void> {
  if (!partyRoomOn()) return setRoomOptions(next);
  patchSampleRoom({ mode: roomModeOf(next), modifier: next.modifiers[0] ?? null, myRole: null });
  return Promise.resolve();
}
export function homeLeave(): Promise<void> {
  if (!partyRoomOn()) return leaveRoom();
  patchSampleRoom({ left: true, myRole: null, status: 'open' });
  return Promise.resolve();
}
export function homeStart(): Promise<void> {
  if (!partyRoomOn()) return startGame();
  patchSampleRoom({ status: 'sealed' });
  window.clearTimeout(startTimer);
  startTimer = window.setTimeout(() => patchSampleRoom({ status: 'open' }), SAMPLE_START_MS);
  return Promise.resolve();
}
