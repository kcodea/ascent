/**
 * THE SPECTATOR'S END OF A GAME, and the XP for watching it (owner 2026-10-24: "watching a player's game rewards 50% of
 * the xp at the end of the match. ... when the game ends for the player, have the gates shut for the spectator and open
 * up at the play menu with the same 'X player came in 1st' or w/e it shows"; R-PROG-SPECTATE-XP-01, R-SPECTATE-END-01).
 *
 *  - THE WATCH RECORD. While a watch screen is open its client beats `spectate_beat` (every `SPECTATE_BEAT_MS`): the
 *    server accrues the time between beats on the one game this account beat last, and marks a live ranked game's end
 *    when a beat sees it. That record, never the client, decides the XP (watched to the end, at least half the game up
 *    to 5 minutes, not your own game). A failed beat is dropped (the next one carries on); it never interrupts watching.
 *  - THE END. `endWatchedGame` beats one last time (so the server sees the spectator there at the end), queues the
 *    settlement through the ordinary progression queue, and closes the game's own END GATE over the watch screen (the
 *    `end` variant every finished game leaves through). Behind the shut doors the watch session is torn down and the
 *    notice is set; the doors open on the menu with it: the watched player's place in the end screen's numeral, the same
 *    "finished the game" line the watch screen used to show, and the XP panel (`ProgressionPostgame`, keyed by the
 *    settlement) once it settles. `SpectatorEndNotice` draws it.
 *
 * Nothing here runs on a render or a click path: one RPC every few seconds, one at the end.
 */
import { create } from 'zustand';
import { spectateRunId, type SpectateKind } from '@game/progression';
import { supabaseClient } from '../remoteBoards';
import { currentUserId } from '../identity';
import { beginSpectateProgression } from '../progression/progressionStore';
import { requestRankedGate } from '../rankedGate/rankedGateController';
import { pixiFx } from '../pixiFx';
import { resumeAudio, stopAllAudio } from '../sfx';
import { useGame } from '../store';

/** How often an open watch screen beats. Well inside the server's 45 s continuity window. */
export const SPECTATE_BEAT_MS = 10_000;

export interface SpectatorEndNoticeState {
  /** The watched player's name. */
  name: string;
  /** Their final place (1..8; a Versus place on its own table), or null when the game ended with none. */
  placement: number | null;
  /** The settlement this notice shows the XP of (`ProgressionPostgame`'s key), or null when nothing was queued. */
  xpKey: string | null;
}
export const useSpectatorEnd = create<{ notice: SpectatorEndNoticeState | null }>(() => ({ notice: null }));
export const dismissSpectatorEnd = (): void => useSpectatorEnd.setState({ notice: null });

/** A beat's answer: recorded or not, and whether the server saw the game ended (`spectate_beat`'s `ended`). */
type Beat = (kind: SpectateKind, target: string) => Promise<boolean | { ok: boolean; ended?: boolean }>;

/** The server beat. True when it was recorded. Never throws. */
const remoteBeat: Beat = async (kind, target) => {
  const c = supabaseClient();
  if (!c || !currentUserId()) return false;
  try {
    // rows: a scalar RPC (one jsonb answer).
    const { data, error } = await c.rpc('spectate_beat', { p_kind: kind, p_target: target });
    return { ok: !error, ended: !error && !!(data as { ended?: boolean } | null)?.ended };
  } catch {
    return false;
  }
};
let beatFn: Beat = remoteBeat;
/** Tests: replace the server beat. */
export function setSpectateBeatForTests(fn: Beat | null): void { beatFn = fn ?? remoteBeat; }

/** Games a recorded beat saw END (R-PROG-SPECTATE-XP-01). The server takes beats only up to 45 s after a game ends,
 *  and the screen may hold the last fight longer than that (up to `VERSUS_END_HOLD_MAX_MS`), so the final beat can be
 *  refused while the watch was complete: a game a beat saw end still settles (found in the Versus Group live test,
 *  2026-10-24). */
let sawEnd = new Set<string>();
async function beat(kind: SpectateKind, target: string): Promise<boolean> {
  const r = await beatFn(kind, target);
  const ok = typeof r === 'boolean' ? r : r.ok;
  if (typeof r !== 'boolean' && r.ok && r.ended) sawEnd.add(spectateRunId(kind, target));
  return ok;
}

let current: { kind: SpectateKind; target: string; timer: number | null } | null = null;

/** The watch screen for this game is open: beat now and every few seconds. Idempotent for the same game. */
export function startSpectatorBeat(kind: SpectateKind, target: string): void {
  if (current && current.kind === kind && current.target === target) return;
  stopSpectatorBeat();
  const s: NonNullable<typeof current> = { kind, target, timer: null };
  current = s;
  void beat(kind, target);
  if (typeof window !== 'undefined') s.timer = window.setInterval(() => { if (current === s) void beat(kind, target); }, SPECTATE_BEAT_MS);
}

/** The watch screen closed (Leave, the room left, the end): no more beats. */
export function stopSpectatorBeat(): void {
  if (current?.timer != null) window.clearInterval(current.timer);
  current = null;
}

/** The game being beaten for, or null (tests, the end flow). */
export const spectatorBeatTarget = (): { kind: SpectateKind; target: string } | null => (current ? { kind: current.kind, target: current.target } : null);

let ended = new Set<string>();

export interface WatchedGameEnd {
  kind: SpectateKind;
  target: string;
  name: string;
  placement: number | null;
  /** Behind the shut doors: tear the watch screen down and put the menu back (the caller's own leave). */
  leave: () => void;
}

/**
 * The watched game is over for its player: last beat, queue the XP, close the end gate, and open it on the menu with the
 * notice. Once per game. Resolves when the doors have opened again.
 */
export function endWatchedGame(end: WatchedGameEnd): Promise<void> {
  const runId = spectateRunId(end.kind, end.target);
  if (ended.has(runId)) return Promise.resolve();
  ended.add(runId);
  stopSpectatorBeat();
  // The last beat lands before the settlement is queued, so the server sees this spectator present at the end.
  let xpKey: string | null = null;
  const settle = beat(end.kind, end.target).then((ok) => {
    if ((ok || sawEnd.has(runId)) && beginSpectateProgression(runId, runId)) xpKey = runId;
    const n = useSpectatorEnd.getState().notice;
    if (n && n.name === end.name && n.xpKey !== xpKey) useSpectatorEnd.setState({ notice: { ...n, xpKey } });
  });
  // A fight may be playing on the watch screen: its effects fade as the doors close, never over them.
  if (useGame.getState().inspect) useGame.setState({ inspect: null });
  pixiFx.setVisible(false, 180);
  return requestRankedGate(() => {
    pixiFx.clearParticles();
    stopAllAudio();
    end.leave();
    resumeAudio();
    pixiFx.setVisible(true, 0);
    useSpectatorEnd.setState({ notice: { name: end.name, placement: end.placement, xpKey } });
  }, 'end').then(() => settle);
}

/** Tests: forget the games already ended and any beat. */
export function resetSpectatorEndForTests(): void {
  stopSpectatorBeat();
  ended = new Set();
  sawEnd = new Set();
  useSpectatorEnd.setState({ notice: null });
}
