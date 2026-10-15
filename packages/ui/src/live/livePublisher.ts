/**
 * LIVE RANKED LOBBY GAMES, the PLAYER's side (owner-approved 2026-10-15). While the player is in a RATED lobby game,
 * the game is listed (`lobby_live_games`): a heartbeat every 15 s (and on every round / phase change) refreshes the
 * row and answers how many people are watching. Only while that is above zero does anything else run: the game's
 * broadcast channel, the spectator projection (the Versus protocol: keyframes, deltas, action tags, the fight result,
 * the cursor), all coalesced into the idle-time deferred writer. With nobody watching it costs one tiny RPC every 15 s
 * and nothing per frame or per click. Spectating never touches the run, its timing, uploads or rating.
 *
 * Ranked only (owner 2026-10-15): `mode: 'lobby'` with a rated table (not all-generated), never a sandbox, God Mode or
 * a replay. Always listed for now; a "hide my game" setting would gate `eligible` (the one seam).
 */
import { lobbyIsUnrated, rankedRunIdOf, type RunState } from '@game/sim';
import { createDeferredWriter } from '../idleWork';
import { currentUserId } from '../identity';
import { currentRunCosmetics, useGame } from '../store';
import { newPublisher, nextSpectatorMessage, type SpectatorPublisher } from '../versus/spectatorView';
import { combatBeatFor, hasPendingActs, setSpectatorTap, takeActs } from '../versus/spectateTap';
import { SPECTATE_KEY_EVENT } from '../versus/spectate';
import { SPECTATE_BYE_EVENT } from '../versus/spectateTap';
import { anonymousWatchers, setWatchers as setWatcherList } from '../versus/watchers';
import { liveRemote, type LiveRemote } from './liveRemote';

export const LIVE_HEARTBEAT_MS = 15_000;

/** Is this run a ranked lobby game the listing may show? The ONE gate (a hide setting would join it here). Only while
 *  the player is IN it: a game parked on the title screen (Save & Continue, the menu) is not live. */
export function liveEligible(run: RunState, st: { replaying: boolean; showTitle?: boolean }): boolean {
  if (st.replaying || st.showTitle || run.mode !== 'lobby' || !run.lobby || run.sandbox || run.godMode) return false;
  if (lobbyIsUnrated(run.lobby)) return false;
  return run.phase === 'recruit' || run.phase === 'combat';
}

const phaseOf = (run: RunState): 'shop' | 'combat' => (run.phase === 'combat' ? 'combat' : 'shop');
const placementOf = (run: RunState): number | null => run.lobby?.seats.find((s) => s.id === 's0')?.placement ?? null;

interface Live {
  gameId: string;
  watchers: number;
  timer: number | null;
  lastKey: string;
  pub: SpectatorPublisher | null;
  channel: { send: (e: string, p: unknown) => void; close: () => void } | null;
  fightSent: unknown;
  keyWanted: boolean;
  /** The last heartbeat a watcher's arrival asked for (throttled). */
  askedAt: number;
}
let live: Live | null = null;
let remote: LiveRemote = liveRemote;
/** For the tests: a fake network. */
export function setLiveRemoteForTests(r: LiveRemote): void { remote = r; }

function beat(): void {
  const l = live;
  if (!l) return;
  const run = useGame.getState().run;
  const g = useGame.getState();
  void remote.heartbeat({
    gameId: l.gameId, name: g.playerName || 'Player', heroId: run.heroId,
    cosmetics: run.cosmetics ?? currentRunCosmetics() ?? null, round: run.wave, phase: phaseOf(run),
  }).then((n) => { if (live === l) setWatchers(l, Number(n) || 0); }).catch(() => undefined);
}

/** A watcher's arrival is HEARD at once (owner ask 2026-10-15: no 15 s wait to start). The game's channel is joined
 *  for LISTENING when the game is listed (a passive subscription: nothing is sent on it while unwatched); a joining
 *  watcher asks it for a keyframe, and a game not yet publishing answers with an immediate heartbeat (throttled), whose
 *  watcher count starts publishing. */
const ASK_THROTTLE_MS = 2000;
function onBroadcast(l: Live, event: string): void {
  // A watcher LEAVING: an immediate heartbeat recounts the stands (the "Spectating" indicator drops them now).
  if (event === SPECTATE_BYE_EVENT) { beat(); return; }
  if (event !== SPECTATE_KEY_EVENT) return;
  if (l.pub) { l.keyWanted = true; frames.schedule(undefined); }
  // A joining watcher asks for a keyframe: a heartbeat (throttled) recounts the stands, so a game not publishing yet
  // starts, and the indicator shows the newcomer at once.
  const now = Date.now();
  if (now - l.askedAt < ASK_THROTTLE_MS) return;
  l.askedAt = now;
  beat();
}

/** The stands changed (a recount moved): read who is watching for the top-left indicator (R-SPECTATE-WATCHERS-01).
 *  Only on a change of count, so it is one small read per join / leave. An older server gives no identities: plain
 *  "Spectator" plates, one per watcher. */
function readWatchers(l: Live, n: number): void {
  if (n <= 0) { setWatcherList([]); return; }
  void remote.watchers(l.gameId).then((rows) => {
    if (live !== l) return;
    setWatcherList(rows ? rows.slice(0, 20).map((r) => ({ id: r.user_id, name: r.display_name ?? '', profile: r.profile ?? null })) : anonymousWatchers(n));
  }).catch(() => { if (live === l) setWatcherList(anonymousWatchers(n)); });
}

function setWatchers(l: Live, n: number): void {
  const was = l.watchers;
  l.watchers = n;
  if (n !== was) readWatchers(l, n);
  if (n > 0 && !l.pub) {
    if (!l.channel) l.channel = remote.channel(l.gameId, (event) => onBroadcast(l, event));
    l.pub = newPublisher('p1');
    l.keyWanted = true;
    setSpectatorTap(true, 'p1', l.channel.send, () => frames.schedule(undefined));
    frames.schedule(undefined);
  } else if (n === 0 && l.pub) {
    stopPublishing(l);
  } else if (n > was) {
    l.keyWanted = true; // a newcomer: the next publish is a keyframe
    frames.schedule(undefined);
  }
}

/** Stop publishing (nobody watching any more): the channel stays joined, listening for the next watcher. */
function stopPublishing(l: Live): void {
  setSpectatorTap(false, null, null);
  l.pub = null;
  l.fightSent = null;
}

/** The publish: one message per idle slot, whatever happened since. Only while watched. */
const frames = createDeferredWriter<undefined>(() => {
  const l = live;
  if (!l || !l.pub || !l.channel) return;
  const run = useGame.getState().run;
  const fight = run.phase === 'combat' ? run.lastCombat ?? null : null;
  const newFight = !!fight && fight !== l.fightSent;
  const msg = nextSpectatorMessage(l.pub, run, run.wave, l.keyWanted || newFight, hasPendingActs());
  l.keyWanted = false;
  if (!msg) return;
  msg.m = l.gameId;
  const acts = takeActs();
  if (acts.length) msg.acts = acts;
  // The fight rides KEYFRAMES only (a new fight forces one): a delta keeps the watcher's fight object, so its replay
  // is never restarted by the next shop delta mid-fight.
  if (fight && msg.kind === 'key') { msg.fight = fight; l.fightSent = fight; }
  // Where the fight is, on a broadcast keyframe while it plays (never the persisted copy): R-SPECTATE-JOIN-01.
  const cb = msg.kind === 'key' ? combatBeatFor(run) : null;
  l.channel.send('spectate', cb ? { ...msg, cb } : msg);
  if (msg.kind === 'key') void remote.publishFrame(l.gameId, msg.seq, msg.round, msg).catch(() => undefined);
}, 250);

function start(run: RunState): void {
  const gameId = rankedRunIdOf(run);
  const l: Live = { gameId, watchers: 0, timer: null, lastKey: '', pub: null, channel: null, fightSent: null, keyWanted: false, askedAt: 0 };
  live = l;
  l.timer = window.setInterval(beat, LIVE_HEARTBEAT_MS);
  l.channel = remote.channel(gameId, (event) => onBroadcast(l, event)); // listening only, until someone watches
  // the first beat is the round / phase key change in the subscriber (one registration, not two)
}

function stop(ended: number | null | 'abandon'): void {
  const l = live;
  if (!l) return;
  live = null;
  if (l.timer != null) window.clearInterval(l.timer);
  stopPublishing(l);
  frames.cancel(); // a publish still waiting for idle time belongs to the game that just stopped
  setWatcherList([]);
  l.channel?.close();
  l.channel = null;
  void remote.end(l.gameId, ended === 'abandon' ? null : ended).catch(() => undefined);
}

/** Watch the store: register a ranked lobby game, follow it, end it. Installed once at boot. */
export function installLivePublisher(): () => void {
  let lastRun: RunState | null = null;
  let lastTitle: boolean | null = null;
  const unsub = useGame.subscribe((st) => {
    const run = st.run;
    if (run === lastRun && st.showTitle === lastTitle) return;
    lastRun = run;
    lastTitle = st.showTitle;
    const ok = liveEligible(run, st) && !!currentUserId();
    if (live) {
      const sameGame = rankedRunIdOf(run) === live.gameId;
      if (!sameGame) { stop('abandon'); }
      else if (run.phase === 'gameover' || run.phase === 'victory') { stop(placementOf(run)); return; }
      else if (!ok) { stop('abandon'); return; }
    }
    if (!ok) return;
    if (!live) start(run);
    const l = live!;
    const key = `${run.wave}|${phaseOf(run)}`;
    if (key !== l.lastKey) { l.lastKey = key; beat(); }
    if (l.pub) frames.schedule(undefined);
  });
  return () => { unsub(); stop('abandon'); };
}

/** For the tests: the live state. */
export const liveState = (): { gameId: string; watchers: number; publishing: boolean } | null =>
  live ? { gameId: live.gameId, watchers: live.watchers, publishing: !!live.pub } : null;
