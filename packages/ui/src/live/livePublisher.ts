/**
 * LIVE LOBBY GAMES, the PLAYER's side (owner-approved 2026-10-15). While the player is in a lobby game, the game is
 * listed: its listing goes up the game's socket on every round / phase change (and every 15 s), and the stands come
 * down it the moment they change. Only while someone watches does anything else run: the spectator projection (the
 * Versus protocol: keyframes, deltas, action tags, the fight result, the cursor), all coalesced into the idle-time
 * deferred writer. With nobody watching nothing is sent per frame or per click. Spectating never touches the run, its
 * timing, uploads or rating.
 *
 * Every lobby game since 2026-10-28 (owner: "all games should show as live games"; R-LIVE-ALL-GAMES-01): ranked, casual
 * and Practice (`liveModeOf`), never a sandbox, God Mode or a replay. Always listed for now; a "hide my game" setting
 * would gate `eligible` (the one seam).
 *
 * CLOUDFLARE ONLY (R-LIVE-CF-01, R-LIVE-CF-ONLY-01; owner 2026-10-30: "Remove fallback for spectating. I want us to make
 * cloudflare work as our source for live information and action like spectating"): every game publishes over one
 * WebSocket to its Durable Object on this build's Worker (`liveCf.ts`). The listing, keyframes, stream and end go up the
 * socket; Supabase sees nothing from this client (the object writes the Live Games row itself). A Worker that does not
 * answer is tried again in the background with backoff (`LIVE_RETRY_MS`, doubling to `LIVE_RETRY_MAX_MS`); until it
 * answers the game is simply not watchable. The game itself never notices either way.
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
import { setWatchers as setWatcherList } from '../versus/watchers';
import { receiveSpectatorEmote, SPECTATOR_EMOTE_EVENT } from '../versus/spectatorEmotes';
import { subscribeSentEmotes } from '../emotes/emoteTransport';
import { PLAYER_SEAT } from '../emotes/emoteRuntime';
import { VERSUS_EMOTE_EVENT, type VersusEmoteMessage } from '../versus/versusEmotes';
import { openCfPublisher, type CfListing, type CfPublisher, type LiveWatcher } from './liveCf';
import { lobbyLivePublishUrl } from '../versus/versusRemote';
import { sessionGame, sessionLiveTarget } from '../session/sessionRemote';
import { currentRankOf } from '../rank/rankSource';
import { receivePingEvent, setPingSession } from '../pings/pingRuntime';
import { receiveLobbyChatEvent, setLobbyChatCompany, setLobbyChatSession } from '../lobbyChat/lobbyChatStore';
import { lobbyStatusNow, type FriendGameStatus } from '../friends/gameStatus';

export const LIVE_HEARTBEAT_MS = 15_000;
/** A Worker that did not answer is tried again after this long, doubling each time up to `LIVE_RETRY_MAX_MS`. */
export const LIVE_RETRY_MS = 5_000;
export const LIVE_RETRY_MAX_MS = 60_000;

/** Is this run a ranked lobby game the listing may show? The ONE gate (a hide setting would join it here). Only while
 *  the player is IN it: a game parked on the title screen (Save & Continue, the menu) is not live. */
export function liveEligible(run: RunState, st: { replaying: boolean; showTitle?: boolean }): boolean {
  if (st.replaying || st.showTitle || !liveModeOf(run)) return false;
  return run.phase === 'recruit' || run.phase === 'combat';
}

/**
 * EVERY GAME IS A LIVE GAME (owner 2026-10-28: "all games should show as live games, and pressing watch from friends list
 * should take the spectator into that game"; R-LIVE-ALL-GAMES-01): a ranked, casual (all-generated table) or Practice
 * lobby game is listed and watchable. Never a dev sandbox or God Mode run, a replay, the Tutorial or the Gauntlet (not
 * lobby games). Null = not a live game.
 */
export function liveModeOf(run: RunState): 'ranked' | 'casual' | 'practice' | null {
  if (!run.lobby || run.sandbox || run.godMode) return null;
  if (run.mode === 'practice') return 'practice';
  if (run.mode !== 'lobby') return null;
  return lobbyIsUnrated(run.lobby) ? 'casual' : 'ranked';
}

const phaseOf = (run: RunState): 'shop' | 'combat' => (run.phase === 'combat' ? 'combat' : 'shop');

type LiveStoreSlice = { replaying: boolean; showTitle?: boolean; heroChoices?: string[] | null; pendingMode?: string; rankedEntry?: { runId: string } | null; heroReroll?: unknown };
/**
 * HERO SELECT IS LIVE TOO (owner 2026-10-26: "hero select should be spectatable"; R-SPECTATE-HEROSELECT-01): the ranked
 * Hero Select (the player confirmed a ranked game, so the entry's id is already the game's id, the one the run takes at
 * the pick) is listed and watched like the rest of the game. The game id while the player is on it, else null.
 */
export function liveHeroSelectGameId(st: LiveStoreSlice): string | null {
  if (st.replaying || st.showTitle || st.pendingMode !== 'lobby' || !st.heroChoices?.length || !st.rankedEntry?.runId) return null;
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
  /** Stops forwarding my emotes to the stands (set only while someone watches). */
  emotesOff: (() => void) | null;
  /** The game's socket (R-LIVE-CF-01): 'cf' once it is open; 'connecting' until then, and between background retries
   *  while the Worker does not answer; 'quiet' once another tab took the game. */
  host: 'connecting' | 'cf' | 'quiet';
  cf: CfPublisher | null;
  /** Failed opens in a row, and the background retry waiting to run. */
  fails: number;
  retry: number | null;
}
let live: Live | null = null;
let publishUrl: () => string = lobbyLivePublishUrl;
/** For the tests: the Worker a new game publishes to. */
export function setLivePublishUrlForTests(fn: (() => string) | null): void { publishUrl = fn ?? lobbyLivePublishUrl; }

/** Where a game publishes: a SESSION game (R-SESSION-CF-01) on its session on the hub (`/session/<game>/ws`, listed with
 *  `live_host = 'session'`), every other game on this build's Versus Worker. Decided once per game. */
function publishTarget(gameId: string): { url: string; path?: string } {
  if (sessionGame(gameId)) {
    const t = sessionLiveTarget(gameId);
    if (t) return t;
  }
  return { url: publishUrl() };
}

/** MY GAME AT A GLANCE (R-LIVE-STATUS-01): the Friends status of my lobby game (the step and whom I fight, place, Health,
 *  Armor, tier), sent with the listing so the Live Games row shows what a friend's row shows. Null on Hero Select (the
 *  row says "Picking a hero" on its own). It rides on the beats that go anyway: never a beat of its own. */
function myStatus(l: Live): FriendGameStatus | null {
  if (l.hero) return null;
  const g = useGame.getState();
  const mode = liveModeOf(g.run);
  return mode ? lobbyStatusNow(mode, g.run, g.endTurnAnimating) : null;
}

/** My listing as the Cloudflare object takes it. */
function cfListing(l: Live): CfListing {
  const g = useGame.getState();
  const run = g.run;
  const frame = l.hero ? myHeroFrame(g) : null;
  const rank = currentRankOf(g);
  return {
    name: g.playerName || 'Player', hero: frame ? frame.picked ?? frame.offer[0]! : run.heroId,
    cosmetics: frame ? currentRunCosmetics() ?? null : run.cosmetics ?? currentRunCosmetics() ?? null,
    round: frame ? 1 : run.wave, phase: frame ? 'hero' : phaseOf(run), mode: frame ? 'ranked' : liveModeOf(run) ?? 'ranked',
    division: rank?.divisionIndex ?? 0, points: rank?.points ?? 0, status: myStatus(l),
  };
}

function beat(): void {
  const l = live;
  if (!l || l.host !== 'cf') return; // the listing goes out the moment the socket opens
  // The listing up the socket; the stands arrive as pushes, the count here is a check.
  void l.cf?.listing(cfListing(l)).then((n) => { if (live === l) setWatchers(l, n); }).catch(() => undefined);
}

/** The game's socket: my mentor's pings, the stands' chat and emotes, and a watcher asking for a keyframe. A watcher's
 *  arrival and departure come as pushed stands (`cfStands`), never as a recount from here. */
function onBroadcast(l: Live, event: string, payload?: unknown): void {
  // LIVE PINGS (R-PING-02): my mentor's pings, and who is mentoring (the receiver re-checks the rule).
  if (receivePingEvent(event, payload)) return;
  // LOBBY CHAT (R-LOBBY-CHAT-01): my stands' messages (the object runs the chat).
  if (receiveLobbyChatEvent(event, payload)) return;
  // A watcher's emote: it pops from their chip in my "Spectating" indicator (R-SPECTATE-EMOTE-01). Only a watcher in my
  // stands (the watcher rows) can emote; the receiver throttles it on its own clock.
  if (event === SPECTATOR_EMOTE_EVENT) { receiveSpectatorEmote(payload); return; }
  if (event === SPECTATE_BYE_EVENT) return; // the object already pushed the new stands
  if (event !== SPECTATE_KEY_EVENT) return;
  if (l.pub) { l.keyWanted = true; frames.schedule(undefined); }
}

function setWatchers(l: Live, n: number): void {
  const was = l.watchers;
  l.watchers = n;
  if (n > 0 && !l.pub) {
    if (!l.channel) return; // no socket (another tab took the game): nothing to publish on
    l.pub = newPublisher('p1');
    l.keyWanted = true;
    syncTap(l);
    // MY EMOTES REACH THE STANDS (owner 2026-10-22: "spectators arent seeing when a player emotes";
    // R-SPECTATE-EMOTE-02): each one I say goes out at once on the game's socket, the Versus wire message as seat
    // `p1`. Only while watched; the object never echoes to me, so my own bubble still shows once.
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

/** Stop publishing (nobody watching any more): the socket stays open, listening for the next watcher. */
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
    storeKey(l, hm);
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
  if (msg.kind === 'key') storeKey(l, msg);
}, 250);

/** The keyframe a late joiner opens on: kept in the game's object. */
function storeKey(l: Live, frame: unknown): void {
  l.cf?.key(frame);
}

/** The stands pushed by the Cloudflare object (identities included): the indicator and the publish gate at once. */
function cfStands(l: Live, list: LiveWatcher[]): void {
  if (live !== l) return;
  setWatcherList(list.slice(0, 20).map((w) => ({ id: w.user_id, name: w.display_name ?? '', profile: w.profile ?? null })));
  setWatchers(l, list.length);
  // The lobby chat shows only while someone watches (a lone player sees no panel).
  setLobbyChatCompany(list.length > 0);
}

/** The wait before the next try after `fails` failed opens in a row: 5, 10, 20, 40 s, then every 60 s. */
export const liveRetryDelay = (fails: number): number => Math.min(LIVE_RETRY_MAX_MS, LIVE_RETRY_MS * 2 ** Math.max(0, fails - 1));

/** Open the game on the Worker (or, for a session game, on its session on the hub). One that does not answer is tried again in the background, with backoff, for as long as
 *  the game lasts; there is no other host (R-LIVE-CF-ONLY-01). */
function startCf(l: Live, target: { url: string; path?: string }): void {
  l.retry = null;
  // The hello's stands arrive before the socket is handed over (a resumed game may already be watched): held until then.
  let early: LiveWatcher[] | null = null;
  void openCfPublisher(target.url, l.gameId, {
    onWatchers: (list) => { if (l.cf) cfStands(l, list); else early = list; },
    onBroadcast: (event, payload) => { if (live === l) onBroadcast(l, event, payload); },
    // Another tab took the game (or the object let it go): this one goes quiet for the rest of the game. It is not
    // re-opened, so two tabs never take the game from each other in turn.
    onDead: () => {
      if (live !== l || l.host !== 'cf') return;
      l.host = 'quiet';
      l.cf = null;
      l.channel = null;
      stopPublishing(l);
      setWatcherList([]);
      setLobbyChatSession('lobbylive', null);
    },
  }, target.path).then((cf) => {
    if (live !== l) { void cf.end(null).catch(() => undefined).finally(() => cf.close()); return; }
    l.fails = 0;
    l.cf = cf;
    l.host = 'cf';
    l.channel = { send: (e, p) => cf.send(e, p), close: () => cf.close() };
    // LOBBY CHAT (R-LOBBY-CHAT-01): the player and the stands share the game's chat, on this socket.
    setLobbyChatSession('lobbylive', { send: (e, p) => cf.send(e, p), gameKey: `lobby:${l.gameId}`, me: currentUserId() });
    setLobbyChatCompany((early?.length ?? 0) > 0);
    if (early) cfStands(l, early);
    beat();
  }).catch(() => {
    if (live !== l) return;
    // Not watchable for now: try again later. Nothing goes anywhere else.
    l.fails += 1;
    if (l.fails === 1) console.warn('live games: the Worker did not answer; this game is not watchable until it does');
    l.retry = window.setTimeout(() => { if (live === l) startCf(l, target); }, liveRetryDelay(l.fails));
  });
}

function start(gameId: string, hero: boolean): void {
  const l: Live = { gameId, hero, watchers: 0, timer: null, lastKey: '', pub: null, channel: null, fightSent: null, keyWanted: false, emotesOff: null, host: 'connecting', cf: null, fails: 0, retry: null };
  live = l;
  l.timer = window.setInterval(beat, LIVE_HEARTBEAT_MS);
  startCf(l, publishTarget(gameId));
  // LIVE PINGS (R-PING-01/02): I am the game's one player (`p1`). My own pings reach the stands only while someone
  // watches (nothing is sent unwatched), on the game's socket; my mentor's arrive through `onBroadcast`.
  setPingSession('lobbylive', { send: (e, p) => { if (live === l && l.pub && l.channel) l.channel.send(e, p); }, seat: () => 'p1', mode: () => 'lobby', gameKey: `lobby:${gameId}` });
  // the first beat is the round / phase key change in the subscriber (one registration, not two)
}

function stop(ended: number | null | 'abandon'): void {
  const l = live;
  if (!l) return;
  live = null;
  if (l.timer != null) window.clearInterval(l.timer);
  if (l.retry != null) window.clearTimeout(l.retry);
  setPingSession('lobbylive', null);
  setLobbyChatSession('lobbylive', null);
  stopPublishing(l);
  frames.cancel(); // a publish still waiting for idle time belongs to the game that just stopped
  setWatcherList([]);
  const placement = ended === 'abandon' ? null : ended;
  l.channel = null;
  if (!l.cf) return; // never reached the Worker (or another tab holds it): nothing of mine is listed
  // The end goes up the socket (the object writes the last watch beats, then tells the stands), then close.
  const cf = l.cf;
  l.cf = null;
  void cf.end(placement).catch(() => undefined).finally(() => cf.close());
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
export const liveState = (): { gameId: string; watchers: number; publishing: boolean; host: Live['host']; fails: number } | null =>
  live ? { gameId: live.gameId, watchers: live.watchers, publishing: !!live.pub, host: live.host, fails: live.fails } : null;
