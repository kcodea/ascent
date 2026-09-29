/** The app's one lobby pool gate, bound to the session's pool loader (null without a backend, so offline
 *  builds and tests pass straight through). See `poolGate.ts`. */
import { opponentPoolLoader } from '../remoteBoards';
import { createPoolGate } from './poolGate';

export const lobbyPoolGate = createPoolGate(() => opponentPoolLoader());
