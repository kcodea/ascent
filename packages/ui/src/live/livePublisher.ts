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
import { hasPendingActs, setSpectatorTap, takeActs } from '../versus/spectateTap';
import { SPECTATE_KEY_EVENT } from '../versus/spectate';
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

function setWatchers(l: Live, n: number): void {
  const was = l.watchers;
  l.watchers = n;
  if (n > 0 && !l.channel) {
    l.channel = remote.channel(l.gameId, (event) => { if (event === SPECTATE_KEY_EVENT) { l.keyWanted = true; frames.schedule(undefined); } });
    l.pub = newPublisher('p1');
    l.keyWanted = true;
    setSpectatorTap(true, 'p1', l.channel.send, () => frames.schedule(undefined));
    frames.schedule(undefined);
  } else if (n === 0 && l.channel) {
    stopPublishing(l);
  } else if (n > was) {
    l.keyWanted = true; // a newcomer: the next publish is a keyframe
    frames.schedule(undefined);
  }
}

function stopPublishing(l: Live): void {
  setSpectatorTap(false, null, null);
  l.channel?.close();
  l.channel = null;
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
  l.channel.send('spectate', msg);
  if (msg.kind === 'key') void remote.publishFrame(l.gameId, msg.seq, msg.round, msg).catch(() => undefined);
}, 250);

function start(run: RunState): void {
  const gameId = rankedRunIdOf(run);
  live = { gameId, watchers: 0, timer: null, lastKey: '', pub: null, channel: null, fightSent: null, keyWanted: false };
  live.timer = window.setInterval(beat, LIVE_HEARTBEAT_MS);
  // the first beat is the round / phase key change in the subscriber (one registration, not two)
}

function stop(ended: number | null | 'abandon'): void {
  const l = live;
  if (!l) return;
  live = null;
  if (l.timer != null) window.clearInterval(l.timer);
  stopPublishing(l);
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
    if (l.channel) frames.schedule(undefined);
  });
  return () => { unsub(); stop('abandon'); };
}

/** For the tests: the live state. */
export const liveState = (): { gameId: string; watchers: number; publishing: boolean } | null =>
  live ? { gameId: live.gameId, watchers: live.watchers, publishing: !!live.channel } : null;
