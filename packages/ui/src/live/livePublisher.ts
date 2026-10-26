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
import { heroSelectFrame, newPublisher, nextHeroSelectMessage, nextSpectatorMessage, type HeroSelectFrame, type SpectatorPublisher } from '../versus/spectatorView';
import { useOwnHeroPick } from '../hero-select/ownHeroPick';
import { combatBeatFor, hasPendingActs, setSpectatorTap, takeActs, takeOdds, takeOverlay } from '../versus/spectateTap';
import { SPECTATE_KEY_EVENT } from '../versus/spectate';
import { SPECTATE_BYE_EVENT } from '../versus/spectateTap';
import { anonymousWatchers, setWatchers as setWatcherList } from '../versus/watchers';
import { receiveSpectatorEmote, SPECTATOR_EMOTE_EVENT } from '../versus/spectatorEmotes';
import { subscribeSentEmotes } from '../emotes/emoteTransport';
import { PLAYER_SEAT } from '../emotes/emoteRuntime';
import { VERSUS_EMOTE_EVENT, type VersusEmoteMessage } from '../versus/versusEmotes';
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

/** The server refused the 'hero' phase (`bad_phase`: 2026-10-26-lobby-live-hero-select.sql not applied yet): Hero Select
 *  is not listed for the rest of the session (one refused call, never one every 15 s), and the game lists from its shop. */
let heroPhaseRefused = false;
type LiveStoreSlice = { replaying: boolean; showTitle?: boolean; heroChoices?: string[] | null; pendingMode?: string; rankedEntry?: { runId: string } | null; heroReroll?: unknown };
/**
 * HERO SELECT IS LIVE TOO (owner 2026-10-26: "hero select should be spectatable"; R-SPECTATE-HEROSELECT-01): the ranked
 * Hero Select (the player confirmed a ranked game, so the entry's id is already the game's id, the one the run takes at
 * the pick) is listed and watched like the rest of the game. The game id while the player is on it, else null.
 */
export function liveHeroSelectGameId(st: LiveStoreSlice): string | null {
  if (heroPhaseRefused || st.replaying || st.showTitle || st.pendingMode !== 'lobby' || !st.heroChoices?.length || !st.rankedEntry?.runId) return null;
  return st.rankedEntry.runId;
}
/** The Hero Select frame I send (my three, my pick, my re-roll), or null. */
function myHeroFrame(st: LiveStoreSlice): HeroSelectFrame | null {
  const g = useGame.getState();
  if (!st.heroChoices?.length) return null;
  // The ranked entry's re-roll is spent with the entry; one left only while it is unused (the screen shows the button).
  return heroSelectFrame({ offer: st.heroChoices, picked: useOwnHeroPick.getState().heroId, reroll: g.heroReroll, canReroll: !g.heroReroll, mode: 'lobby' });
}
const placementOf = (run: RunState): number | null => run.lobby?.seats.find((s) => s.id === 's0')?.placement ?? null;

interface Live {
  gameId: string;
  /** The player is on Hero Select (no run yet): the listing says so and the frames are Hero Select frames. */
  hero: boolean;
  watchers: number;
  timer: number | null;
  lastKey: string;
  pub: SpectatorPublisher | null;
  channel: { send: (e: string, p: unknown) => void; close: () => void } | null;
  fightSent: unknown;
  keyWanted: boolean;
  /** The last heartbeat a watcher's arrival asked for (throttled). */
  askedAt: number;
  /** Stops forwarding my emotes to the stands (set only while someone watches). */
  emotesOff: (() => void) | null;
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
  // On Hero Select the row's hero is my pick once made, else the first offered (the list says "Picking a hero").
  const frame = l.hero ? myHeroFrame(g) : null;
  void remote.heartbeat({
    gameId: l.gameId, name: g.playerName || 'Player', heroId: frame ? frame.picked ?? frame.offer[0]! : run.heroId,
    cosmetics: frame ? currentRunCosmetics() ?? null : run.cosmetics ?? currentRunCosmetics() ?? null,
    round: frame ? 1 : run.wave, phase: frame ? 'hero' : phaseOf(run),
  }).then((n) => { if (live === l) setWatchers(l, Number(n) || 0); }).catch((e: unknown) => {
    if (frame && (e as { code?: string })?.code === 'bad_phase') { heroPhaseRefused = true; if (live === l) stop('abandon'); }
  });
}

/** A watcher's arrival is HEARD at once (owner ask 2026-10-15: no 15 s wait to start). The game's channel is joined
 *  for LISTENING when the game is listed (a passive subscription: nothing is sent on it while unwatched); a joining
 *  watcher asks it for a keyframe, and a game not yet publishing answers with an immediate heartbeat (throttled), whose
 *  watcher count starts publishing. */
const ASK_THROTTLE_MS = 2000;
function onBroadcast(l: Live, event: string, payload?: unknown): void {
  // A watcher's emote: it pops from their chip in my "Spectating" indicator (R-SPECTATE-EMOTE-01). Only a watcher in my
  // stands (the watcher rows) can emote; the receiver throttles it on its own clock.
  if (event === SPECTATOR_EMOTE_EVENT) { receiveSpectatorEmote(payload); return; }
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
    if (!l.channel) l.channel = remote.channel(l.gameId, (event, payload) => onBroadcast(l, event, payload));
    l.pub = newPublisher('p1');
    l.keyWanted = true;
    syncTap(l);
    // MY EMOTES REACH THE STANDS (owner 2026-10-22: "spectators arent seeing when a player emotes";
    // R-SPECTATE-EMOTE-02): each one I say goes out at once on the game's channel, the Versus wire message as seat
    // `p1`. Only while watched; the channel never echoes to me (`self: false`), so my own bubble still shows once.
    const ch = l.channel;
    l.emotesOff = subscribeSentEmotes((m) => {
      if (live !== l || !l.pub || m.seat !== PLAYER_SEAT) return;
      ch.send(VERSUS_EMOTE_EVENT, { emoteId: m.emoteId, seat: 'p1', phase: m.phase, offsetMs: Math.round(m.offsetMs), round: m.round } satisfies VersusEmoteMessage);
    });
    frames.schedule(undefined);
  } else if (n === 0 && l.pub) {
    stopPublishing(l);
  } else if (n > was) {
    l.keyWanted = true; // a newcomer: the next publish is a keyframe
    frames.schedule(undefined);
  }
}

/** The action / cursor tap runs while someone watches the RUN; Hero Select sends its screen only (no hand, no actions),
 *  as in Versus. */
function syncTap(l: Live): void {
  if (l.pub && l.channel && !l.hero) setSpectatorTap(true, 'p1', l.channel.send, () => frames.schedule(undefined), () => frames.flush());
  else setSpectatorTap(false, null, null);
}

/** Stop publishing (nobody watching any more): the channel stays joined, listening for the next watcher. */
function stopPublishing(l: Live): void {
  setSpectatorTap(false, null, null);
  l.emotesOff?.();
  l.emotesOff = null;
  l.pub = null;
  l.fightSent = null;
}

/** The publish: one message per idle slot, whatever happened since. Only while watched. */
const frames = createDeferredWriter<undefined>(() => {
  const l = live;
  if (!l || !l.pub || !l.channel) return;
  // HERO SELECT (R-SPECTATE-HEROSELECT-01): my screen whole, on every change and on a watcher's request. Stored like a
  // keyframe, so a watcher joining now opens on it (a ranked game has no opponent to hide it from).
  if (l.hero) {
    const frame = myHeroFrame(useGame.getState());
    const hm = frame ? nextHeroSelectMessage(l.pub, frame, l.keyWanted) : null;
    l.keyWanted = false;
    if (!hm) return;
    hm.m = l.gameId;
    l.channel.send('spectate', hm);
    void remote.publishFrame(l.gameId, hm.seq, 0, hm).catch(() => undefined);
    return;
  }
  const run = useGame.getState().run;
  const fight = run.phase === 'combat' ? run.lastCombat ?? null : null;
  const newFight = !!fight && fight !== l.fightSent;
  const msg = nextSpectatorMessage(l.pub, run, run.wave, l.keyWanted || newFight, hasPendingActs());
  l.keyWanted = false;
  if (!msg) return;
  msg.m = l.gameId;
  const acts = takeActs();
  if (acts.length) msg.acts = acts;
  const od = takeOdds(run, msg.kind === 'key'); // the fight's odds, for the stands' Summary (R-SPECTATE-LOCAL-01)
  if (od) msg.od = od;
  const ov = takeOverlay(msg.kind === 'key'); // which overlays I minimized (R-SPECTATE-OVERLAY-01)
  if (ov) msg.ov = ov;
  // The fight rides KEYFRAMES only (a new fight forces one): a delta keeps the watcher's fight object, so its replay
  // is never restarted by the next shop delta mid-fight.
  if (fight && msg.kind === 'key') { msg.fight = fight; l.fightSent = fight; }
  // Where the fight is, on a broadcast keyframe while it plays (never the persisted copy): R-SPECTATE-JOIN-01.
  const cb = msg.kind === 'key' ? combatBeatFor(run) : null;
  l.channel.send('spectate', cb ? { ...msg, cb } : msg);
  if (msg.kind === 'key') void remote.publishFrame(l.gameId, msg.seq, msg.round, msg).catch(() => undefined);
}, 250);

function start(gameId: string, hero: boolean): void {
  const l: Live = { gameId, hero, watchers: 0, timer: null, lastKey: '', pub: null, channel: null, fightSent: null, keyWanted: false, askedAt: 0, emotesOff: null };
  live = l;
  l.timer = window.setInterval(beat, LIVE_HEARTBEAT_MS);
  l.channel = remote.channel(gameId, (event, payload) => onBroadcast(l, event, payload)); // listening only, until someone watches
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
  let lastHero: unknown[] = [];
  const onChange = (force = false): void => {
    const st = useGame.getState();
    const run = st.run;
    // Hero Select's own inputs (the offer, its re-roll, the entry, my pick): any change is a new frame.
    const heroKey = [st.heroChoices, st.heroReroll, st.rankedEntry, st.pendingMode, st.replaying, useOwnHeroPick.getState().heroId];
    const heroMoved = heroKey.some((v, i) => v !== lastHero[i]);
    if (!force && run === lastRun && st.showTitle === lastTitle && !heroMoved) return;
    lastRun = run;
    lastTitle = st.showTitle;
    lastHero = heroKey;
    const heroGame = liveHeroSelectGameId(st);
    const signedIn = !!currentUserId();
    const ok = (heroGame !== null || liveEligible(run, st)) && signedIn;
    const gameId = heroGame ?? rankedRunIdOf(run);
    if (live) {
      // The pick builds the run under the entry's id, so Hero Select flows into the same listed game (no re-listing).
      const sameGame = gameId === live.gameId;
      if (!sameGame) { stop('abandon'); }
      else if (!heroGame && (run.phase === 'gameover' || run.phase === 'victory')) { stop(placementOf(run)); return; }
      else if (!ok) { stop('abandon'); return; }
    }
    if (!ok) return;
    if (!live) start(gameId, heroGame !== null);
    const l = live!;
    if (l.hero !== (heroGame !== null)) { l.hero = heroGame !== null; if (l.pub) { l.keyWanted = true; syncTap(l); } }
    const key = heroGame ? 'hero' : `${run.wave}|${phaseOf(run)}`;
    if (key !== l.lastKey) { l.lastKey = key; beat(); }
    if (l.pub) frames.schedule(undefined);
  };
  const unsub = useGame.subscribe(() => onChange());
  const unsubPick = useOwnHeroPick.subscribe(() => onChange());
  return () => { unsub(); unsubPick(); stop('abandon'); };
}

/** For the tests: the live state. */
export const liveState = (): { gameId: string; watchers: number; publishing: boolean } | null =>
  live ? { gameId: live.gameId, watchers: live.watchers, publishing: !!live.pub } : null;
