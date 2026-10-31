/** The app's one lobby pool gate, bound to the session's pool loader (null without a backend, so offline
 *  builds and tests pass straight through). See `poolGate.ts`. */
import { opponentPoolLoader } from '../remoteBoards';
import { createPoolGate } from './poolGate';

export const lobbyPoolGate = createPoolGate(() => opponentPoolLoader());

/** OPPONENTS FIRST (R-RANKED-OPPONENTS-FIRST-01): the ranked Play's own wait. The table is picked before hero select,
 *  so a pool still loading at Play is waited for here, over the shut ranked gate (its panel sits above the doors). A
 *  separate gate from the launch curtain's, so the two panels never both show. */
export const rankedEntryPoolGate = createPoolGate(() => opponentPoolLoader());
