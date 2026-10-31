/**
 * THE GAME SESSION, the client's lifecycle (R-SESSION-CF-01). Installed once (beside the live publisher, `Game.tsx`):
 *
 *   - reads the hub's switch at boot (`prefetchSessionConfig`);
 *   - when a live lobby / Practice game is on screen (`liveModeOf`), decides ONCE whether it is a session game
 *     (`sessionGame`, kept per game id) and, if so, links its save slot to it and pins its TABLE on the session: the
 *     opponents' fight-ledger keys (the rating settle uses these, never the ones sent at the end) and the seat
 *     recordings (what a spectator's screen fields, and what the parked save carries). Sent again only if the
 *     recordings grew (the opening shop phase builds the generated ones);
 *   - Save & Quit (the game parked on the title): asks the session to write the held save now, so another device's
 *     Continue finds it at once. A tab simply closed is covered by the session's own quiet timer.
 *
 * It never blocks the game: every call is fire-and-forget, and a session that cannot be reached changes nothing (the
 * cloud save, the outbox and the rank queue take their old paths on their own).
 */
import { opponentFightKeys, rankedRunIdOf, type RunState } from '@game/sim';
import { currentUserId } from '../identity';
import { useGame } from '../store';
import { liveModeOf } from '../live/livePublisher';
import { runKeyOf } from '../cloudSave';
import { sessionSeatsOf } from './seatProvider';
import { lastSessionGame, linkRunKey, noteSessionGame, prefetchSessionConfig, sessionCall, sessionGame } from './sessionRemote';


/** Tests. */
export function resetGameSessionForTests(): void { noteSessionGame(null); pinned.clear(); entryPinned.clear(); }

const pinned = new Map<string, string>();

/** Pin (or re-send) the table. Looked at once per shop phase at most; it sends only when the recordings changed shape (a
 *  seat's run or a generated recording appeared or grew: the opening shop phases build the generated ones). Never
 *  serializes the recordings to decide. */
function pinTable(run: RunState, gameId: string, mode: 'ranked' | 'casual' | 'practice'): void {
  const seats = sessionSeatsOf(run);
  const print = `${(seats?.runs ?? []).map((r) => r.length).join(',')}|${(seats?.hybrids ?? []).map((h) => h.snaps?.length ?? 0).join(',')}`;
  if (pinned.get(gameId) === print) return;
  pinned.set(gameId, print);
  let seatKeys: string[] = [];
  try {
    // The reporter key does not enter the opponent keys (only the seven others do).
    seatKeys = run.lobby ? opponentFightKeys(run.lobby, { reporterKey: '', patch: '' }) : [];
  } catch { seatKeys = []; }
  void sessionCall(gameId, 'table', { mode, seatKeys, ...(seats ? { seatRuns: seats.runs, seatHybrids: seats.hybrids } : {}) })
    .then((a) => { if (!a || a.status !== 200) pinned.delete(gameId); });
}

/** Ranked entries whose table was pinned at Play (OPPONENTS FIRST). */
const entryPinned = new Set<string>();

/**
 * OPPONENTS FIRST (owner 2026-10-31, R-RANKED-OPPONENTS-FIRST-01): a ranked table is picked at Play, before hero select,
 * so the session pins its opponent keys at that same moment (the entry's run id IS the game id). The table the hero
 * pick then seats is this one, so the keys the recruit pin sends later are the same (the session keeps the first). An
 * offer that had to be topped up with held heroes is not pinned early: a pick of one of those re-picks the table.
 */
function pinEntryTable(): void {
  const entry = useGame.getState().rankedEntry;
  if (!entry?.table || entry.toppedUp || entryPinned.has(entry.runId) || !currentUserId()) return;
  entryPinned.add(entry.runId);
  if (!sessionGame(entry.runId)) return;
  let seatKeys: string[] = [];
  try { seatKeys = opponentFightKeys(entry.table, { reporterKey: '', patch: '' }); } catch { seatKeys = []; }
  if (seatKeys.length === 0) return;
  void sessionCall(entry.runId, 'table', { mode: 'ranked', seatKeys })
    .then((a) => { if (!a || a.status !== 200) entryPinned.delete(entry.runId); });
}

export function installGameSession(): () => void {
  void prefetchSessionConfig();
  let lastKey = '';
  let lastTitle: boolean | undefined;
  const onChange = (): void => {
    pinEntryTable();
    const st = useGame.getState();
    const run = st.run;
    // Only a new game, round or phase (or the title) matters: never per action.
    const key = `${run.runId ?? run.seed}|${run.wave}|${run.phase}|${st.replaying ? 1 : 0}`;
    if (key === lastKey && st.showTitle === lastTitle) return;
    const wasOnTitle = lastTitle;
    lastKey = key;
    lastTitle = st.showTitle;
    const mode = liveModeOf(run);
    if (!mode || !currentUserId()) return;
    const gameId = rankedRunIdOf(run);
    // Save & Quit: the game is parked on the title with its save in the slot. Write the held save now.
    if (st.showTitle && wasOnTitle === false && (run.phase === 'recruit' || run.phase === 'combat')) {
      if (lastSessionGame() === gameId) void sessionCall(gameId, 'park', {}, { keepalive: true });
      return;
    }
    if (st.showTitle || st.replaying || (run.phase !== 'recruit' && run.phase !== 'combat')) return;
    if (!sessionGame(gameId)) return;
    noteSessionGame(gameId);
    linkRunKey(runKeyOf(run), gameId);
    if (run.phase === 'recruit') pinTable(run, gameId, mode);
  };
  const unsub = useGame.subscribe(onChange);
  onChange();
  return unsub;
}
