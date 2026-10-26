/**
 * VERSUS — the session store + controller (blueprint 4/5/9/11; owner rulings 2026-10-13).
 *
 * Owns everything that is NETWORK room state, never card-game state: the room, its members, the current match,
 * my private seeds, committed rounds, the server clock, my lock, and the live spectator publisher. The card game
 * itself stays the main store's `run`, reduced locally and instantly; this module only:
 *  - creates the run when Hero Select resolves (and rebuilds it on reconnect from my last lock checkpoint plus
 *    the committed rounds),
 *  - keeps a fresh LOCK CANDIDATE on the server (idle, debounced, built on a clone: never the live run),
 *  - locks at End Turn or at the shared deadline (timeout picks are random-legal, ruling 7),
 *  - when the round's one fight is committed, runs the real End Turn so the fight lands in the same commit,
 *  - acknowledges the combat barrier when the player returns to the shop,
 *  - heartbeats, reconciles deadlines, asks the resolver to finalize, follows pause/unpause.
 * No shop interaction ever waits on any of it (perf bar: >160 fps).
 */
import { create } from 'zustand';
import { contentRevision, activeSet } from '@game/content';
import {
  buildVersusCandidate, catchUpVersusRun, progressionFactsOf, createVersusRun, deserialize, reduce, resetLobbyDrivers, serialize, versusAutoResolve, versusHeroOffer, versusHeroRerollCandidates, isHeroReroll,
  versusLobby, versusLobbyKey, versusScoutOf, versusTimeoutRng, VERSUS_LEASE_SECONDS, type Action, type RunState, type VersusLobbyInput, type VersusSeat,
  normalizeVersusOptions, versusGroupLobby, type VersusRoomOptions, versusGroupLobbyKey, type PreparedCombatSide, type VersusGroupLobbyInput, type VersusGroupSeat, type VersusSeatScout,
} from '@game/sim';
import { parseCosmeticSnapshot, type RunCosmeticSnapshot } from '@game/progression';
import type { CombatResult } from '@game/core';
import type { SetId } from '@game/content';
import { versusRunId } from '@game/progression';
import { createDeferredWriter } from '../idleWork';
import { keyedBackoff, pageHidden } from '../net/backoff';
import { beginRunProgression } from '../progression/progressionStore';
import { currentUserId } from '../identity';
import { currentRunCosmetics, tempHandle, useGame } from '../store';
import { ServerClock, shopClockAt } from './versusClock';
import { installVersusEmotes, receiveVersusEmote, receiveWatchedEmote, setVersusEmoteSeatMap, uninstallVersusEmotes, VERSUS_EMOTE_EVENT } from './versusEmotes';
import { installSpectatorEmotes, receiveSpectatorEmote, SPECTATOR_EMOTE_EVENT, uninstallSpectatorEmotes } from './spectatorEmotes';
import { installVersusHandlers, type VersusFreeze } from './versusHooks';
import { VersusError, versusRemote, type VersusGroupMatchRaw, type VersusGroupRoundRaw, type VersusMatch, type VersusPrivate, type VersusRoom, type VersusRoomSummary, type VersusRole, type VersusRoundRow } from './versusRemote';
import { duosFirstAt, duosLobbySeatId, groupPairingAt, groupSeatOf, isDuosRaw, projectGroupMatch, projectGroupRounds } from './versusGroupView';
import { duosAfterRun, duosPull, duosReset } from './duosPasses';
import { versusOptionsSummary } from './versusOptionsUi';
import { newPublisher, nextSpectatorMessage, type SpectatorPublisher } from './spectatorView';
import { installSpectateIo, leaveTeammate, ownRunWhileWatching, receiveSpectate, receiveSpectatorCursor, resetSpectate, SPECTATE_KEY_EVENT, spectateSync, trackDuosMatch, useSpectate } from './spectate';
import { othersInStands, setWatchers, type Watcher } from './watchers';
import { combatBeatFor, hasPendingActs, setSpectatorTap, SPECTATE_CURSOR_EVENT, tapAct, takeActs, takeOdds, takeOverlay } from './spectateTap';
import { cancelRankedGate, requestRankedGate } from '../rankedGate/rankedGateController';
import { pixiFx } from '../pixiFx';
import { goodLuckIntro } from '../goodLuck/goodLuckIntroStore';
import { resumeAudio, stopAllAudio } from '../sfx';
import { buildGroupMatchRecord, buildVersusMatchRecord, type VersusMatchRecord } from './versusMatchRecord';
import { versusEndsNow, versusTurn, versusTurnHolds } from './versusTurn';

export type VersusScreen = 'browser' | 'room';

export interface VersusState {
  screen: VersusScreen;
  rooms: VersusRoomSummary[];
  loading: boolean;
  error: string | null;
  room: VersusRoom | null;
  match: VersusMatch | null;
  priv: VersusPrivate | null;
  /** My hidden three (Hero Select). */
  heroOffer: string[] | null;
  rounds: Record<number, VersusRoundRow>;
  /** The round I locked (End Turn or the deadline), awaiting the fight. */
  lockedRound: number | null;
  /** The round whose End Combat I pressed (ack sent), awaiting the other player or their 5 s. */
  readyRound: number | null;
  /** A signal to Recruit: run the real End Turn now, for this wave (the fight is in). */
  endTurnWave: number | null;
  /** Server minus local ms. */
  offsetMs: number;
  /** The match this player last finished, for the room's "Previous match stats". */
  lastMatch: VersusMatchRecord | null;
  /** The Previous match stats overlay is open (the end gate opens on it, owner 2026-10-14). */
  statsOpen: boolean;
  /** The match whose hero pick this client sent (or showed the ceremony for); the server refuses a second pick. */
  pickedFor: string | null;
  /** The run is built and waiting for Hero Select's launch to put it on screen. */
  runReady: boolean;
  /** THE HERO RE-ROLL (R-HERO-REROLL-01): my re-roll request is in flight (picks wait for it), and the match whose
   *  re-roll the server cannot take (no migration yet, or it refused): the control hides for that match. */
  rerollPending: boolean;
  rerollOffFor: string | null;
  /** MY SEAT MOVE IN FLIGHT (R-VERSUS-DRAG-SEAT-01): the role I asked the server for and have not heard back on. The
   *  room shows it at once (`roomWithSeatMove`); a refusal clears it and the card goes back. */
  seatMove: { role: VersusRole } | null;
  /** ROOM OPTIONS (R-VERSUS-OPTIONS-01): "Room options changed: ..." for a moment after the host changes them. */
  optionsNotice: string | null;
  /** VERSUS GROUP KNOCKOUT (R-VERSUS-GROUP-06): my placement, shown as I am moved into the stands to watch the rest. */
  knockout: { matchId: string; placement: number | null; of: number } | null;
}

export const useVersus = create<VersusState>(() => ({
  screen: 'browser', rooms: [], loading: false, error: null, room: null, match: null, priv: null, heroOffer: null,
  rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null, offsetMs: 0, lastMatch: null, statsOpen: false, pickedFor: null, runReady: false,
  rerollPending: false, rerollOffFor: null, seatMove: null, optionsNotice: null, knockout: null,
}));

const clock = new ServerClock();
const set = (p: Partial<VersusState>): void => useVersus.setState(p);
const get = (): VersusState => useVersus.getState();

/** THE STANDS (R-SPECTATE-WATCHERS-01): while I hold a seat, the room's spectators feed the top-left indicator
 *  (`WatchersBadge`). While I SPECTATE (`me`, my user id, a spectator in the room), the OTHER spectators feed my own
 *  top-left row (`SpectatorHud`), so a fellow spectator's emote pops from their chip (R-SPECTATE-EMOTE-01). From the
 *  member rows; `setWatchers` is a no-op unless someone joined or left. */
export function versusWatchersOf(room: VersusRoom | null, seated: boolean, me?: string | null): Watcher[] {
  if (!room) return [];
  const spectators = room.members.filter((m) => m.role === 'spectator');
  if (!seated && !(me && spectators.some((m) => m.userId === me))) return [];
  const list = spectators.map((m) => ({ id: m.userId, name: m.displayName, profile: m.profile ?? null }));
  // Seated: everyone in the stands but me. A player knocked out to the stands is still seated in the match while the
  // last fight plays, and must never see their own chip there (R-SPECTATE-WATCHERS-02). Spectating: the others, never
  // me (R-SPECTATE-HUD-02).
  return othersInStands(list, [me]);
}
useVersus.subscribe((st, prev) => {
  if (st.room === prev.room && st.match === prev.match) return;
  setWatchers(versusWatchersOf(st.room, !!st.room && !!mySeat(st.match), currentUserId()));
});

/** THE OPTIONS-CHANGED NOTICE (R-VERSUS-OPTIONS-01): when the room's options move (its `options_rev` grows) everyone
 *  but the host who changed them sees what they are now, for a moment. */
let optionsNoticeTimer = 0;
useVersus.subscribe((st, prev) => {
  const r = st.room;
  const p = prev.room;
  if (!r || !p || r.id !== p.id || (r.options_rev ?? 0) <= (p.options_rev ?? 0)) return;
  if (r.host_user_id === currentUserId()) return;
  const text = `Room options changed: ${versusOptionsSummary(r.options)}`;
  set({ optionsNotice: text });
  if (typeof window === 'undefined') return;
  window.clearTimeout(optionsNoticeTimer);
  optionsNoticeTimer = window.setTimeout(() => { if (get().optionsNotice === text) set({ optionsNotice: null }); }, 4500);
});

/** The host changes the room's options (Open rooms only; the server validates). */
export async function setRoomOptions(next: VersusRoomOptions): Promise<void> {
  const room = get().room;
  if (!room) return;
  try {
    set({ room: await versusRemote.setOptions(room.id, next), error: null });
  } catch (e) {
    flashError(errorText(e));
    void refreshRoom();
  }
}

/** Human copy for the SQL error codes a player can actually hit (no em dashes, short sentences). */
const ERROR_TEXT: Record<string, string> = {
  not_signed_in: 'Sign in to play Versus.',
  no_backend: 'Versus needs a connection to the game server.',
  already_in_room: 'You are already in a room. Leave it first.',
  room_not_open: 'That room has already started.',
  seats_full: 'Every player seat is taken. You can watch instead.',
  spectators_full: 'The stands are full.',
  version_mismatch: 'That room is on a different game version. Update to join it.',
  seat_taken: 'That seat was just taken.',
  need_two_players: 'You need an opponent to start.',
  need_three_players: 'You need three or four players to start.',
  eliminated: 'You are out of this match. You can watch the rest.',
  bad_mode: 'That mode is not available.',
  bad_modifiers: 'That modifier is not available.',
  bad_role: 'That seat is not open in this mode.',
  not_host: 'Only the host can do that.',
  gate_expired: 'The gate closed. The host can start again.',
  no_room: 'That room is gone.',
  network: 'Connection problem. Try again.',
  not_deployed: 'Versus is not open on the server yet.',
};
const errorText = (e: unknown): string => ERROR_TEXT[(e as VersusError)?.code] ?? ERROR_TEXT.network!;

async function timed<T>(fn: () => Promise<T>, nowOf?: (r: T) => string | undefined): Promise<T> {
  const sent = Date.now();
  const r = await fn();
  if (nowOf) clock.sample(sent, Date.now(), nowOf(r));
  set({ offsetMs: clock.offset() });
  return r;
}

function myIdentity(): { displayName: string; profile: Record<string, unknown>; setId: string; contentRevision: string } {
  const g = useGame.getState();
  const profile: Record<string, unknown> = g.playerAvatar ? { avatar: g.playerAvatar } : {};
  // SKINS (owner 2026-10-14: the combat scene 1:1 with the lobby, "opponent portrait, name, skin"): the cosmetic
  // snapshot a run would record rides the room profile, so the opponent's screen shows it as a lobby seat's. The
  // profile column caps at 4 KB: past that, the per-minion skins are dropped first, then the whole snapshot.
  const cos = currentRunCosmetics();
  if (cos) {
    const fits = (c: unknown): boolean => JSON.stringify({ ...profile, cosmetics: c }).length <= 3800;
    const lean = { ...cos, minionSkinByCardId: undefined };
    if (fits(cos)) profile.cosmetics = cos;
    else if (fits(lean)) profile.cosmetics = lean;
  }
  return { displayName: g.playerName || tempHandle(currentUserId()), profile, setId: activeSet().id, contentRevision: contentRevision() };
}

export function mySeat(match: VersusMatch | null = get().match): VersusSeat | null {
  const me = currentUserId();
  if (!match || !me) return null;
  return match.p1_user === me ? 'p1' : match.p2_user === me ? 'p2' : null;
}

export function myRole(room: VersusRoom | null = get().room): VersusRole | null {
  const me = currentUserId();
  return room?.members.find((m) => m.userId === me)?.role ?? null;
}

export const versusServerNow = (): number => clock.now();
export const versusRemainingMs = (iso: string | null | undefined): number | null => clock.remainingMs(iso);
/**
 * Time left on a SHOP deadline for the clock face and the 0:00 lock (R-VERSUS-CLOCK-LOCK-01): the synced estimate plus
 * the estimate's own uncertainty, so this client's 0:00 never comes before the server's. The display and the lock both
 * read this one value (`shopClockAt`).
 */
export const versusShopRemainingMs = (iso: string | null | undefined): number | null => {
  const r = clock.remainingMs(iso);
  return r == null ? null : r + clock.uncertaintyMs();
};

// ── the browser ────────────────────────────────────────────────────────────────────────────────────────────

export async function refreshRooms(): Promise<void> {
  set({ loading: true });
  try {
    set({ rooms: await versusRemote.listRooms(), error: null });
  } catch (e) {
    set({ error: errorText(e) });
  } finally {
    set({ loading: false });
  }
}

/**
 * EVERYONE ARRIVES IN THE HAND (owner 2026-10-21, R-VERSUS-ROOM-HAND-01: "when a player joins/creates a room, by
 * default put them in the hand"). The server seats a room's creator as player 1, so the creator steps down to the
 * stands before the room is shown (the existing take-seat RPC; the host stays the host). If that step fails the room
 * still opens, with the creator seated, rather than not at all.
 */
export async function createRoom(name: string): Promise<void> {
  try {
    let room = await timed(() => versusRemote.createRoom(name, myIdentity()), (r) => r.serverNow);
    try { room = await versusRemote.takeSeat(room.id, 'spectator'); } catch { /* opens seated (above) */ }
    enterRoom(room);
  } catch (e) {
    set({ error: errorText(e) });
  }
}

/** Join a room into the hand (R-VERSUS-ROOM-HAND-01); a seat is then one drag (or Join) away. Only when the stands
 *  are full does a `player` join take an open seat instead, so a full stand never locks a player out of a free seat. */
export async function joinRoom(roomId: string, as: 'player' | 'spectator'): Promise<void> {
  try {
    const room = await timed(() => versusRemote.joinRoom(roomId, 'spectator', myIdentity()), (r) => r.serverNow)
      .catch((e: unknown) => {
        if (as !== 'player' || (e as VersusError)?.code !== 'spectators_full') throw e;
        return timed(() => versusRemote.joinRoom(roomId, 'player', myIdentity()), (r) => r.serverNow);
      });
    enterRoom(room);
  } catch (e) {
    set({ error: errorText(e) });
    void refreshRooms();
  }
}

/** A short room message that clears itself (the seat-move refusal), unless something newer replaced it. */
let flashTimer = 0;
function flashError(msg: string): void {
  set({ error: msg });
  if (typeof window === 'undefined') return;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { if (get().error === msg) set({ error: null }); }, 3200);
}

/**
 * Take a seat, or move to the stands (`spectator`), through the existing `versus_take_seat` RPC. OPTIMISTIC
 * (R-VERSUS-DRAG-SEAT-01): the move shows at once (`seatMove`), so a dragged card lands in its seat on the drop and a
 * Join / Spectate press moves the card the same frame; if the server refuses (someone took the seat first), the move
 * is dropped, the card animates back and the reason shows for a moment. One move at a time. Resolves true on success.
 */
export async function takeSeat(role: VersusRole): Promise<boolean> {
  const st = get();
  const room = st.room;
  if (!room || st.seatMove) return false;
  const me = currentUserId();
  if (myRole(room) === role) return true;
  // A seat I can already see is taken: refuse here (the server would), no round trip.
  if (role !== 'spectator' && room.members.some((m) => m.role === role && m.userId !== me)) { flashError(ERROR_TEXT.seat_taken!); return false; }
  set({ seatMove: { role }, error: null });
  try {
    const next = await versusRemote.takeSeat(room.id, role);
    set({ room: next, seatMove: null, error: null });
    return true;
  } catch (e) {
    set({ seatMove: null });
    flashError(errorText(e));
    void refreshRoom();
    return false;
  }
}

export async function startGame(): Promise<void> {
  const room = get().room;
  if (!room) return;
  try {
    set({ room: await timed(() => versusRemote.startGame(room.id), (r) => r.serverNow), error: null });
  } catch (e) {
    set({ error: errorText(e) });
  }
}

export async function pressGate(): Promise<void> {
  const room = get().room;
  if (!room) return;
  try {
    const r = await versusRemote.pressGate(room.id);
    set({ room: r, error: null });
    if (r.current_match_id) await refreshMatch(r.current_match_id);
  } catch (e) {
    set({ error: errorText(e) });
    await refreshRoom();
  }
}

export async function leaveRoom(): Promise<void> {
  duosReset(); // VERSUS DUOS: no pass transport outlives the room
  const room = get().room;
  stopSession();
  set({ room: null, match: null, priv: null, heroOffer: null, rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null, statsOpen: false, seatMove: null, screen: 'browser' });
  if (useGame.getState().run.mode === 'versus') useGame.getState().leaveVersusRun();
  if (room) {
    try { await versusRemote.leaveRoom(room.id); } catch { /* the server prunes a silent member anyway */ }
  }
  void refreshRooms();
}

// ── the session loop ───────────────────────────────────────────────────────────────────────────────────────

let session: {
  roomId: string;
  matchId: string | null;
  channel: { send: (event: string, payload: unknown) => void; close: () => void } | null;
  beat: number;
  tick: number;
  wake: number | null;
  lastFinalize: number;
  candidateSeq: number;
  publisher: SpectatorPublisher | null;
  unsubRun: (() => void) | null;
  unsubGates: () => void;
} | null = null;

function enterRoom(room: VersusRoom): void {
  stopSession();
  set({ room, screen: 'room', error: null, seatMove: null, match: null, priv: null, heroOffer: null, rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null });
  session = { roomId: room.id, matchId: null, channel: null, beat: 0, tick: 0, wake: null, lastFinalize: 0, candidateSeq: 0, publisher: null, unsubRun: null, unsubGates: useVersus.subscribe(driveGates) };
  installSpectateIo({
    latestFrames: (id) => mx.latestFrames(id),
    requestKey: () => session?.channel?.send(SPECTATE_KEY_EVENT, {}),
    loadRounds: () => { const m = get().match; if (m) void loadRounds(m).then(() => spectateSync(get().match, get().rounds)); },
    lobbyFor: spectatorLobbyFor,
  });
  subscribe(room.current_match_id);
  session.beat = window.setInterval(() => void heartbeat(), 4000);
  session.tick = window.setInterval(onTick, 500);
  void heartbeat();
  if (room.current_match_id) void refreshMatch(room.current_match_id);
}

function stopSession(): void {
  if (!session) return;
  window.clearInterval(session.beat);
  window.clearInterval(session.tick);
  if (session.wake != null) window.clearTimeout(session.wake);
  session.channel?.close();
  session.unsubRun?.();
  session.unsubGates();
  if (entryGate) { entryGate.cancelled = true; cancelRankedGate(); entryGate = null; }
  uninstallVersusEmotes();
  uninstallSpectatorEmotes();
  installVersusHandlers(null);
  installSpectateIo(null);
  resetSpectate();
  setSpectatorTap(false, null, null);
  session = null;
}

function subscribe(matchId: string | null): void {
  if (!session) return;
  session.channel?.close();
  session.matchId = matchId;
  session.channel = versusRemote.subscribeRoom(session.roomId, matchId, (what) => {
    // Membership changes arrive as the ROOM's revision bump (join, leave, seat moves, knockouts and prunes all bump it);
    // heartbeats are not subscribed to at all (R-NET-REALTIME-01).
    scheduleRefresh(what);
  }, (event, payload) => {
    // A player's emote: the other player shows it on its foe; a SPECTATOR shows both players' where the watched seat's
    // screen does (R-SPECTATE-EMOTE-02). Never both: a seated client is a player.
    if (event === VERSUS_EMOTE_EVENT) {
      if (mySeat()) receiveVersusEmote(payload);
      else if (useSpectate.getState().active) receiveWatchedEmote(payload, useSpectate.getState().seat);
    }
    // A spectator's emote: the players and the other spectators show it from that spectator's chip (R-SPECTATE-EMOTE-01).
    else if (event === SPECTATOR_EMOTE_EVENT) receiveSpectatorEmote(payload);
    // VERSUS DUOS (R-DUOS-VIEW-01): a player caches their TEAMMATE's frames too (the live teammate view).
    else if (event === 'spectate') { if (!mySeat() || isMateFrame(payload)) receiveSpectate(payload); }
    else if (event === SPECTATE_CURSOR_EVENT) { if (!mySeat() || (useSpectate.getState().teammate && isMateFrame(payload))) receiveSpectatorCursor(payload); }
    // A spectator lost its place: the next deferred publish sends a keyframe (coalesced, never per spectator).
    else if (event === SPECTATE_KEY_EVENT) { if (mySeat() && session?.matchId) { keyWanted = true; frames.schedule({ matchId: session.matchId, forceKey: true }); } }
  });
  // A channel swap mid-match keeps the emote transport on the live channel.
  const seat = mySeat();
  if (seat && useGame.getState().run.mode === 'versus') installVersusEmotes(emoteSeatOf(get().match) ?? seat, session.channel.send);
  // A spectator ON THE WATCH SCREEN emotes on the same channel, as themselves (R-SPECTATE-EMOTE-01); a player never
  // does. A channel swap re-installs it on the live channel.
  syncSpectatorEmotes();
}

/** Spectator emotes are on exactly while I watch a Versus match with no seat (never for a seated player, whose own
 *  portrait menu must stay theirs). Re-checked on a channel swap and whenever the watch screen opens or closes. */
function syncSpectatorEmotes(): void {
  const me = currentUserId();
  if (session?.channel && me && !mySeat() && useSpectate.getState().active) installSpectatorEmotes(me, session.channel.send);
  else if (session) uninstallSpectatorEmotes();
}
useSpectate.subscribe((s, prev) => { if (s.active !== prev.active && session) syncSpectatorEmotes(); });

/** Realtime is a wake-up only: coalesce bursts and re-read the rows. */
let pendingWhat = new Set<string>();
function scheduleRefresh(what: string): void {
  if (!session) return;
  pendingWhat.add(what);
  if (session.wake != null) return;
  session.wake = window.setTimeout(() => {
    if (!session) return;
    session.wake = null;
    const w = pendingWhat;
    pendingWhat = new Set();
    if (w.has('room') || w.has('members')) void refreshRoom();
    const mid = get().room?.current_match_id ?? session.matchId;
    if (mid && (w.has('match') || w.has('rounds') || w.has('room'))) void refreshMatch(mid);
    // VERSUS DUOS: a teammate's pass (or an answer to mine) landed on the server.
    if (mid && w.has('passes')) pullDuosPasses(mid);
  }, 120);
}

async function refreshRoom(): Promise<void> {
  if (!session) return;
  try {
    const room = await versusRemote.room(session.roomId);
    if (!room) { await leaveRoom(); return; }
    set({ room });
    // A new spectator in the stands while I play: the next deferred publish sends them a keyframe.
    if (mySeat() && session.matchId && useGame.getState().run.mode === 'versus') frames.schedule({ matchId: session.matchId, forceKey: false });
    if (room.current_match_id && room.current_match_id !== session.matchId) {
      subscribe(room.current_match_id);
      await refreshMatch(room.current_match_id);
    }
  } catch { /* transient; the next wake or heartbeat retries */ }
}

async function refreshMatch(matchId: string): Promise<void> {
  if (!session) return;
  if (session.matchId !== matchId) subscribe(matchId);
  try {
    const match = await mx.match(matchId);
    if (!match) return;
    await onMatch(match);
    pullDuosPasses(matchId); // VERSUS DUOS: a no-op outside a Duos match
  } catch { /* transient */ }
}

let beats = 0;
async function heartbeat(): Promise<void> {
  if (!session) return;
  try {
    const r = await timed(() => versusRemote.heartbeat(session!.roomId), (x) => x.serverNow);
    if (r.match) await onMatch(r.match);
    // Duos: the heartbeat is the passes' BACKSTOP only (each pass row change already wakes the pull over Realtime), so it
    // reads them every third beat (12 s) rather than every beat (R-NET-BACKOFF-01).
    else if (r.groupMatch) { await onMatch(ingestGroup(r.groupMatch)); if (++beats % 3 === 0) pullDuosPasses(r.groupMatch.id); }
    // Pause detection rides the heartbeat: a running match is reconciled every beat, so an opponent who went
    // silent pauses the clock within a lease plus one beat (live test 2026-10-14: a 12 s modulo window let it slip
    // to ~20 s).
    const m = get().match;
    if (m && mySeat(m) && m.phase !== 'complete' && !m.paused_at) void mx.reconcile(m.id).then((x) => onMatch(x)).catch(() => undefined);
    // WHO IS BACK, while a match is paused (the "<name> is back" notice reads the absent player's last heartbeat).
    // Heartbeats no longer reach every client as Realtime member updates (R-NET-REALTIME-01: that was ~0.9 KB per
    // member per 4 s to every subscriber); a paused match reads presence from the heartbeat's answer instead, or, from
    // a server without that field, re-reads the room's members once per beat while paused.
    if (m && m.paused_at && m.phase !== 'complete') {
      if (r.seen) patchSeen(r.seen);
      else void refreshRoom();
    }
  } catch (e) {
    // Not in this room any more (left elsewhere, pruned, or the room is gone): stop the session instead of beating forever.
    const code = (e as VersusError).code;
    if (code === 'not_a_member' || code === 'no_room') await leaveRoom();
  }
}

/** Patch the members' last-seen times from a heartbeat's `seen` map (user id -> ISO time). */
function patchSeen(seen: Record<string, string>): void {
  const room = get().room;
  if (!room) return;
  let changed = false;
  const members = room.members.map((m) => {
    const t = seen[m.userId];
    if (!t || t === m.lastSeenAt) return m;
    changed = true;
    return { ...m, lastSeenAt: t };
  });
  if (changed) set({ room: { ...room, members } });
}

/**
 * THE TICK'S SERVER ASKS BACK OFF (R-NET-BACKOFF-01, perf 2026-10-26). Each ask is keyed by what it waits on: the
 * match's revision (a reconcile), the round (a finalize), the gate deadline (a room reconcile). A new key is asked at
 * once and then at the old 500 ms (2.5 s for a finalize) pace for the first few tries, so a deadline still lands on the
 * same tick as before; an answer that changes nothing (the same revision) or an error then doubles the wait, up to 15 s
 * (30 s for a finalize). A paused match used to be reconciled twice a second for as long as the tab stayed open.
 */
const reconcileGate = keyedBackoff({ base: 500, fastTries: 10, max: 15_000, hiddenFloor: 5_000 });
const finalizeGate = keyedBackoff({ base: 2500, fastTries: 4, max: 30_000, hiddenFloor: 10_000 });
const roomGate = keyedBackoff({ base: 500, fastTries: 6, max: 15_000, hiddenFloor: 5_000 });

/** Every 500 ms: deadlines that passed get reconciled, a resolving round gets finalized, my deadline locks. */
function onTick(): void {
  if (!session) return;
  const { room, match } = get();
  const now = Date.now();
  const hidden = pageHidden();
  if (room?.status === 'sealed' && (versusRemainingMs(room.gate_deadline) ?? 1) <= 0) {
    const key = `${room.id}|${room.gate_deadline ?? ''}|${room.revision}`;
    if (roomGate.ready(key, now)) {
      roomGate.asked(key, now, hidden);
      void versusRemote.reconcileRoom(room.id).then((r) => set({ room: r })).catch(() => undefined);
    }
  }
  if (!match || match.phase === 'complete') return;
  // A SPECTATOR never reconciles or finalizes (and so never takes the match row's lock): the players' clients drive
  // every deadline and every round, exactly as before; the stands only watch.
  const player = !!mySeat(match);
  const due = (iso: string | null): boolean => (versusRemainingMs(iso) ?? 1) <= 0;
  const leaseLate = !!match.paused_at && now % (VERSUS_LEASE_SECONDS * 1000) < 500; // a paused match re-checks for the return
  if (player && (match.paused_at ? due(match.pause_grace_until) || leaseLate || (!!match.resume_at && due(match.resume_at))
    : (match.phase === 'hero_select' && due(match.hero_deadline)) || (match.phase === 'shop' && due(match.shop_deadline))
      || (match.phase === 'combat' && due(match.combat_deadline)) || leaseLate)) {
    const key = `${match.id}|${match.revision}|${match.phase}|${match.paused_at ? 'p' : ''}|${match.resume_at ?? ''}`;
    if (reconcileGate.ready(key, now)) {
      reconcileGate.asked(key, now, hidden);
      void mx.reconcile(match.id).then((m) => onMatch(m)).catch(() => undefined);
    }
  }
  if (player && match.phase === 'resolving') {
    const key = `${match.id}|${match.round}`;
    if (finalizeGate.ready(key, now)) {
      finalizeGate.asked(key, now, hidden);
      session.lastFinalize = now;
      void mx.finalize(match.id, match.round, match.content_revision).then(() => refreshMatch(match.id)).catch(() => undefined);
    }
  }
  // My shared deadline, the fallback for a screen that is not driving the clock (`useVersusRecruit` locks on the
  // exact edge). It locks AT 0:00, never before (R-VERSUS-CLOCK-LOCK-01: it used to lock 400 ms early on a 500 ms tick,
  // so the shop held while the clock still read 0:01, the owner's "locking a second early"). The server accepts a final
  // side for 250 ms past its deadline, so a lock sent at 0:00 still lands as my own final side.
  const seat = mySeat(match);
  // VERSUS DUOS (R-DUOS-VIEW-01): the teammate view holds until the turn is over (the fight starts) or the match
  // pauses; never at a clock mark (owner 2026-10-25). Back on my board, the fight plays from my side.
  if (useSpectate.getState().teammate && teammateViewReturns(match)) {
    leaveTeammate();
    if (seat) driveRun(match, seat);
  }
  // My own run, even while my screen shows my teammate's: my clock still locks MY turn at 0:00 (`expireVersusShop`).
  const run = ownRunWhileWatching() ?? useGame.getState().run;
  if (seat && match.phase === 'shop' && !match.paused_at && run.mode === 'versus' && run.wave === match.round && get().lockedRound !== match.round
    && shopClockAt(versusShopRemainingMs(match.shop_deadline)).locked) {
    expireVersusShop();
  }
}
/**
 * VERSUS DUOS (R-DUOS-VIEW-01; owner 2026-10-25: "don't force the player back from the teammate view until the turn is
 * 'over.'"): does the game take me back to my own board now? Only when the turn is over: the shop has ended and the
 * fight is in (or the match ended), or the match paused. Never at a clock mark: my clock running out while I watch
 * locks my own turn as usual and I stay until the fight starts. 'resolving' (every side locked, the server settling
 * the round) is still the turn's end, not the fight, so the view holds through it.
 */
export function teammateViewReturns(match: Pick<VersusMatch, 'phase' | 'paused_at'>): boolean {
  return !!match.paused_at || (match.phase !== 'shop' && match.phase !== 'resolving');
}

// ── the match ──────────────────────────────────────────────────────────────────────────────────────────────

async function onMatch(match: VersusMatch): Promise<void> {
  if (!session) return;
  if (!match.group) setVersusEmoteSeatMap(null);
  const prev = get().match;
  if (prev && prev.id === match.id && prev.revision > match.revision) return; // an older read arriving late
  // A right-click inspect never outlives the moment it was opened in (live PvP 2026-10-14): a new phase or round, a
  // pause or a resume, or the match ending closes it.
  if (prev && (prev.id !== match.id || prev.phase !== match.phase || prev.round !== match.round || !!prev.paused_at !== !!match.paused_at)) {
    closeInspect();
  }
  // A pause drops any aim in progress (hero power / Equipment targeting): nothing may land under the veil.
  if (match.paused_at && match.phase !== 'complete' && (useGame.getState().heroArmed || useGame.getState().equipArmed)) {
    useGame.setState({ heroArmed: false, equipArmed: false });
  }
  set({ match });
  // ONE ROOM, MANY MATCHES (live bug 2026-10-14: spectators saw "combat from OUR game last game"): the committed rounds
  // are keyed by round NUMBER, which restarts every match, so they belong to one match and are dropped the moment the
  // room's match changes, for every member (players and the stands alike).
  if (roundsOf !== match.id) { roundsOf = match.id; groupRoundsRaw = {}; set({ rounds: {} }); }
  const seat = mySeat(match);
  if (!seat) {
    // A SPECTATOR (Versus phase 2): nothing to drive. The committed rounds feed the fights it watches.
    if (match.round > 0) await loadRounds(match);
    // A player knocked out of this group match watches it from the stands: their stats fill in as the table finishes.
    if (match.group && get().lastMatch?.matchId === match.id) {
      const rec = groupRecord(get().lastMatch?.myCosmetics ?? null);
      if (rec) set({ lastMatch: rec });
    }
    spectateSync(match, get().rounds);
    return;
  }
  // VERSUS DUOS: my teammate's frames are tracked for the live teammate view (R-DUOS-VIEW-01).
  trackDuosMatch(match.group?.duos && match.phase !== 'complete' ? match : null, get().rounds);
  // The fight is in (or a pause): back to my own board BEFORE anything below drives the run, so the fight's End Turn
  // and the fight itself play on MY run, never the teammate's on screen (R-DUOS-VIEW-01).
  if (useSpectate.getState().teammate && teammateViewReturns(match)) leaveTeammate();

  if (!get().priv || get().priv!.match_id !== match.id) {
    const priv = await mx.myPrivate(match.id).catch(() => null);
    if (priv) {
      // The server's row is the truth once registered: after a re-roll (R-HERO-REROLL-01) it is no longer the seeded three.
      const registered = priv.hero_offer && priv.hero_offer.length === 3 ? priv.hero_offer : null;
      const offer = registered ?? versusHeroOffer(Number(priv.hero_seed), Number(priv.run_seed), match.set_id as SetId);
      set({ priv, heroOffer: offer, rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null, rerollPending: false });
      if (!priv.hero_offer) void mx.registerOffer(match.id, offer).catch(() => undefined);
    }
  }
  if (match.round > 0) await loadRounds(match);
  if (match.phase === 'complete') settleVersusProgression(match);
  // Back in the room after a reload: the room's last match is still its current one, so "Previous match stats" can
  // be rebuilt from the server rows (the match screen builds it itself on the way out, `returnToRoom`).
  if (match.phase === 'complete' && get().lastMatch?.matchId !== match.id && useGame.getState().run.mode !== 'versus') {
    set({ lastMatch: (match.group ? groupRecord(currentRunCosmetics() ?? null) : null) ?? buildVersusMatchRecord(match, get().rounds, seat, currentRunCosmetics() ?? null, foeCosmeticsOf(match, seat)) });
  }
  if (match.phase !== 'hero_select') ensureRun(match, seat);
  syncVersusLobby();
  driveRun(match, seat);
  maybeEndGate();
}

/** The match the cached `rounds` belong to. */
let roundsOf: string | null = null;

/**
 * The newest round the server has COMMITTED (R-NET-ROUNDS-01, perf 2026-10-26): the current round once its fight is in
 * (`combat`, or `complete` for the deciding one), else the one before. Rounds are read only up to here: a read during
 * the shop asked for a round that could not exist yet, on every wake and every heartbeat (~50 empty reads a match).
 */
export function committedRound(match: Pick<VersusMatch, 'phase' | 'round'>): number {
  return match.phase === 'combat' || match.phase === 'complete' ? match.round : match.round - 1;
}

async function loadRounds(match: VersusMatch): Promise<void> {
  if (match.group) { await loadGroupRounds(match); return; }
  const have = get().rounds;
  const known = Object.keys(have).map(Number);
  const from = known.length ? Math.max(...known) + 1 : 1;
  if (from > committedRound(match)) return;
  try {
    const rows = (await versusRemote.rounds(match.id, from)).filter((r) => r.match_id === match.id);
    if (roundsOf !== match.id) return; // the room moved on to another match while this read was in flight
    if (rows.length) set({ rounds: { ...get().rounds, ...Object.fromEntries(rows.map((r) => [r.round, r])) } });
  } catch { /* retried on the next wake */ }
}

/**
 * VERSUS PROGRESSION (owner 2026-10-14: "versus can complete achievements and grant XP but no rank progress"): when a
 * match this player fought ends, settle it once through the ordinary progression queue. The server scores it from the
 * match row (`versus:<match id>`), so the client sends only which match plus the run's achievement metrics. Nothing
 * here, or on the server's Versus branch, touches rank, rating or MMR (R-VERSUS-RANK-01).
 */
const settledMatches = new Set<string>();
function settleVersusProgression(match: VersusMatch): void {
  // The server needs one fought round (`not_terminal` otherwise): a match conceded at Hero Select or before the
  // first fight settles nothing.
  if (settledMatches.has(match.id) || !mySeat(match) || Object.keys(get().rounds).length === 0) return;
  // VERSUS GROUP: settles under the same `versus:<match id>` the moment MY result is final (I went out, or the match
  // ended); the server reads my seat's placement (2026-10-24-versus-spectator-xp.sql, R-PROG-VERSUS-XP-01).
  settledMatches.add(match.id);
  const g = useGame.getState();
  const run = g.run;
  if (run.mode !== 'versus') return;
  const facts = progressionFactsOf(g.deriveState, run, { runId: versusRunId(match.id), mode: 'versus', patch: `${__APP_VERSION__}+${__BUILD_SHA__}`, placement: null });
  beginRunProgression(`versus:${match.id}`, { ...facts, terminal: true });
}

/**
 * THE TWO-SEAT LOBBY (owner 2026-10-14: the Versus match is played on the lobby screens 1:1). The live run carries
 * `versusLobby(...)`: me as seat s0 and the opponent as s1, hearts as their health, the opponent fielding the board
 * they actually fought each committed round with. Rebuilt only when its key moves (a round commits, the run lands,
 * settles or leaves a fight, the heroes are revealed), never per frame or per shop click. Display state only: the
 * reducer never settles it, and no persistence path takes it (the gates key on `mode: 'versus'`).
 */
/** The opponent's cosmetic snapshot, from their room profile (null when they carry none). */
function foeCosmeticsOf(match: VersusMatch, seat: VersusSeat): RunCosmeticSnapshot | null {
  const foeUser = seat === 'p1' ? match.p2_user : match.p1_user;
  return parseCosmeticSnapshot(get().room?.members.find((m) => m.userId === foeUser)?.profile?.cosmetics) ?? null;
}

let lobbyKey = '';
function versusLobbyInput(): VersusLobbyInput | null {
  const match = get().match;
  const seat = mySeat(match);
  const run = useGame.getState().run;
  if (!match || !seat || run.mode !== 'versus' || builtFor !== match.id) return null;
  return lobbyInputFor(match, seat, run);
}
/** The two-seat lobby input from `seat`'s side (a spectator builds it for the player it watches, too). */
function lobbyInputFor(match: VersusMatch, seat: VersusSeat, run: Pick<RunState, 'wave' | 'phase' | 'combatSettled' | 'heroId' | 'cosmetics'>): VersusLobbyInput {
  const other: VersusSeat = seat === 'p1' ? 'p2' : 'p1';
  const foeUser = other === 'p1' ? match.p1_user : match.p2_user;
  const foeProfile = get().room?.members.find((m) => m.userId === foeUser)?.profile;
  const foeCosmetics = parseCosmeticSnapshot(foeProfile?.cosmetics) ?? undefined;
  return {
    matchSeed: Number(match.seed),
    setId: match.set_id as SetId,
    seat,
    wave: run.wave,
    inCombat: run.phase === 'combat',
    combatSettled: !!run.combatSettled,
    me: { label: seat === 'p1' ? match.p1_name : match.p2_name, heroId: run.heroId, ...(run.cosmetics ? { cosmetics: run.cosmetics } : {}) },
    foe: { label: other === 'p1' ? match.p1_name : match.p2_name, heroId: (other === 'p1' ? match.p1_hero : match.p2_hero) ?? run.heroId, ...(foeCosmetics ? { cosmetics: foeCosmetics } : {}) },
    rounds: Object.values(get().rounds).map((r) => ({
      round: r.round, heartLostBy: r.heart_lost_by, mine: (seat === 'p1' ? r.p1_result : r.p2_result) as CombatResult,
      foeScout: (seat === 'p1' ? r.p2_scout : r.p1_scout) ?? null,
    })),
  };
}
/** A SPECTATOR's two-seat lobby for the player it watches, when that player's view carries none (a test bot). */
export function spectatorLobbyFor(seat: VersusGroupSeat, run: RunState): RunState['lobby'] {
  const match = get().match;
  if (!match) return undefined;
  if (match.group) {
    const lobby = versusGroupLobby(groupLobbyInputFor(match.group.raw, seat, run));
    resetLobbyDrivers(lobby.seats);
    return lobby;
  }
  if (seat !== 'p1' && seat !== 'p2') return undefined;
  const lobby = versusLobby(lobbyInputFor(match, seat, run));
  resetLobbyDrivers(lobby.seats);
  return lobby;
}

export function syncVersusLobby(): void {
  if (syncGroupLobby()) return;
  const input = versusLobbyInput();
  if (!input) return;
  const run = useGame.getState().run;
  const key = `${versusLobbyKey(input)}|${input.foe.cosmetics ? 1 : 0}`;
  if (key === lobbyKey && run.lobby) return;
  lobbyKey = key;
  const lobby = versusLobby(input);
  resetLobbyDrivers(lobby.seats); // the opponent seat's authored driver reads its boards at build time
  useGame.setState({ run: { ...run, lobby } });
}

const resultsFor = (seat: VersusSeat): Map<number, CombatResult> =>
  new Map(Object.values(get().rounds).map((r) => [r.round, (seat === 'p1' ? r.p1_result : r.p2_result) as CombatResult]));

let builtFor: string | null = null;

// ── VERSUS GROUP (R-VERSUS-GROUP-01): the 3-4 player match through this client ───────────────────────────────────
/** The latest raw group match (seats included) and its committed rounds, raw. The store's `match` / `rounds` are
 *  their projection from my seat (`versusGroupView.ts`). */
let groupRaw: VersusGroupMatchRaw | null = null;
let groupRoundsRaw: Record<number, VersusGroupRoundRaw> = {};
/** Which table each match id lives in (learned on its first read). */
const groupIds = new Set<string>();
const duelIds = new Set<string>();

/** Whose side a group match is seen from: mine while I hold a living seat, or my run of it is still on screen (the
 *  deciding fight); a player who is out and back in the room sees it as a spectator. */
function groupViewer(raw: VersusGroupMatchRaw): string | null {
  const me = currentUserId();
  const row = groupSeatOf(raw, me);
  if (!row) return null;
  if (row.eliminatedRound != null && builtFor !== raw.id) return null;
  return me;
}

/** My seat on the emote wire: my REAL seat in a group match (p1..p4), else the 1v1 seat. */
function emoteSeatOf(match: VersusMatch | null): VersusGroupSeat | null {
  return match?.group ? match.group.me : mySeat(match);
}

/** My "Previous match stats" for the current group match, from my seat (R-VERSUS-GROUP-07). */
function groupRecord(myCos: RunCosmeticSnapshot | null): VersusMatchRecord | null {
  const raw = groupRaw;
  const me = currentUserId();
  if (!raw || !me) return null;
  const members = get().room?.members ?? [];
  return buildGroupMatchRecord(raw, Object.values(groupRoundsRaw), me, myCos,
    (uid) => parseCosmeticSnapshot(members.find((m) => m.userId === uid)?.profile?.cosmetics) ?? null);
}

/** The group rail's seat id for `seat` as seen from `viewer` (the others in seat order are s1, s2, s3). */
function groupLobbySeatId(raw: VersusGroupMatchRaw, viewer: VersusGroupSeat, seat: VersusGroupSeat): string | null {
  return duosLobbySeatId(raw, viewer, seat); // the rail's own order (Duos: the teammate first)
}

/** Take a group match row (RPC answer or table read) and hand back its projection from my side. */
function ingestGroup(raw: VersusGroupMatchRaw): VersusMatch {
  groupIds.add(raw.id);
  // Group emotes land on the sender's own rail row (R-VERSUS-GROUP-03).
  setVersusEmoteSeatMap((seat, viewer) => (groupRaw ? groupLobbySeatId(groupRaw, viewer, seat) : null));
  if (!groupRaw || groupRaw.id !== raw.id || raw.revision >= groupRaw.revision) groupRaw = raw;
  // A concede leaves before the server has placed me: the knockout notice fills its placement in when it lands.
  const ko = get().knockout;
  if (ko && ko.matchId === groupRaw.id && ko.placement == null) {
    const p = groupSeatOf(groupRaw, currentUserId())?.placement ?? null;
    if (p != null) set({ knockout: { ...ko, placement: p } });
  }
  return projectGroupMatch(groupRaw, groupViewer(groupRaw));
}

async function loadGroupRounds(match: VersusMatch): Promise<void> {
  const raw = groupRaw;
  if (!raw || raw.id !== match.id) return;
  const known = Object.keys(groupRoundsRaw).map(Number);
  const from = known.length ? Math.max(...known) + 1 : 1;
  if (from <= committedRound(raw)) {
    try {
      const rows = await versusRemote.groupRounds(match.id, from);
      if (roundsOf !== match.id) return;
      for (const r of rows) groupRoundsRaw[r.round] = r;
    } catch { /* retried on the next wake */ }
  }
  set({ rounds: projectGroupRounds(raw, Object.values(groupRoundsRaw), groupViewer(raw)) });
}

/**
 * The match API: every match-scoped call goes to the 1v1 RPCs or the group ones, by the match id, and a group answer
 * comes back projected. Same signatures as `versusRemote`'s 1v1 calls.
 */
const G = (id: string): boolean => groupIds.has(id);
const mx = {
  async match(id: string): Promise<VersusMatch | null> {
    if (!G(id)) {
      const m = await versusRemote.match(id);
      if (m) { duelIds.add(id); return m; }
    }
    if (duelIds.has(id)) return null;
    const g = await versusRemote.groupMatch(id);
    return g ? ingestGroup(g) : null;
  },
  reconcile: (id: string): Promise<VersusMatch> => (G(id) ? versusRemote.groupReconcile(id).then(ingestGroup) : versusRemote.reconcile(id)),
  finalize: (id: string, round: number, content: string): Promise<void> => (G(id)
    ? (groupRaw?.id === id && isDuosRaw(groupRaw) ? versusRemote.finalizeDuos(id, round, content) : versusRemote.finalizeGroup(id, round, content))
    : versusRemote.finalize(id, round, content)),
  myPrivate: (id: string) => (G(id) ? versusRemote.groupMyPrivate(id) : versusRemote.myPrivate(id)),
  registerOffer: (id: string, offer: string[]): Promise<unknown> => (G(id) ? versusRemote.groupRegisterOffer(id, offer) : versusRemote.registerOffer(id, offer)),
  myLatestCheckpoint: (id: string) => (G(id) ? versusRemote.groupMyLatestCheckpoint(id) : versusRemote.myLatestCheckpoint(id)),
  introDone: (id: string): Promise<VersusMatch> => (G(id) ? versusRemote.groupIntroDone(id).then(ingestGroup) : versusRemote.introDone(id)),
  combatReady: (id: string, round: number): Promise<VersusMatch> => (G(id) ? versusRemote.groupCombatReady(id, round).then(ingestGroup) : versusRemote.combatReady(id, round)),
  submit: (id: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null): Promise<VersusMatch> =>
    (G(id) ? versusRemote.groupSubmit(id, round, seq, side, final, checkpoint, scout).then(ingestGroup) : versusRemote.submit(id, round, seq, side, final, checkpoint, scout)),
  publishFrame: (id: string, seq: number, round: number, frame: unknown): Promise<void> =>
    (G(id) ? versusRemote.groupPublishFrame(id, seq, round, frame) : versusRemote.publishFrame(id, seq, round, frame)),
  latestFrames: (id: string): Promise<{ seat: VersusGroupSeat; seq: number; round: number; frame: unknown }[]> =>
    (G(id) ? versusRemote.groupLatestFrames(id) : versusRemote.latestFrames(id)),
  pickHero: (id: string, index: number): Promise<VersusMatch> => (G(id) ? versusRemote.groupPickHero(id, index).then(ingestGroup) : versusRemote.pickHero(id, index)),
  requestResume: (id: string): Promise<VersusMatch> => (G(id) ? versusRemote.groupRequestResume(id).then(ingestGroup) : versusRemote.requestResume(id)),
  unpause: (id: string): Promise<VersusMatch> => (G(id) ? versusRemote.groupUnpause(id).then(ingestGroup) : versusRemote.unpause(id)),
  forfeit: (id: string): Promise<VersusMatch> => (G(id) ? versusRemote.groupForfeit(id).then(ingestGroup) : versusRemote.forfeit(id)),
  async rerollHero(id: string, slot: number, candidates: string[]): Promise<{ offer: string[]; reroll: unknown }> {
    if (!G(id)) return versusRemote.rerollHero(id, slot, candidates);
    const out = await versusRemote.groupRerollHero(id, slot, candidates);
    ingestGroup(out.match);
    return out;
  },
};

/** The group match's rail (the ranked lobby rail with every seat, and the Copy): `versusGroupLobby`. */
let groupLobbyKey = '';
function groupLobbyInput(): VersusGroupLobbyInput | null {
  const match = get().match;
  const run = useGame.getState().run;
  const g = match?.group;
  if (!match || !g || !g.me || run.mode !== 'versus' || builtFor !== match.id) return null;
  return groupLobbyInputFor(g.raw, g.me, run);
}
/** The group lobby input from `seat`'s side (a spectator builds it for the seat it watches). */
function groupLobbyInputFor(raw: VersusGroupMatchRaw, seat: VersusGroupSeat, run: Pick<RunState, 'wave' | 'phase' | 'combatSettled' | 'heroId' | 'cosmetics'>): VersusGroupLobbyInput {
  const members = get().room?.members ?? [];
  return {
    matchSeed: Number(raw.seed),
    setId: raw.set_id as SetId,
    me: seat,
    wave: run.wave,
    inCombat: run.phase === 'combat',
    combatSettled: !!run.combatSettled,
    seats: raw.seats.map((s) => {
      const cos = s.seat === seat ? run.cosmetics : parseCosmeticSnapshot(members.find((m) => m.userId === s.userId)?.profile?.cosmetics) ?? undefined;
      return {
        seat: s.seat, label: s.name, heroId: (s.seat === seat ? run.heroId : s.hero) ?? run.heroId,
        eliminatedRound: s.eliminatedRound, placement: s.placement, ...(cos ? { cosmetics: cos } : {}),
      };
    }),
    rounds: Object.values(groupRoundsRaw).map((r) => ({
      round: r.round, hearts: r.hearts,
      fights: r.fights.map((f) => ({ a: f.a_seat, b: f.b_seat, copy: f.b_copy, heartLostBy: f.heart_lost_by, aResult: f.a_result, aScout: f.a_scout, bScout: f.b_scout })),
    })),
    pairing: groupPairingAt(raw, run.wave),
    ...(isDuosRaw(raw) ? { duos: { first: duosFirstAt(raw, run.wave) } } : {}),
  };
}
/** Build / refresh the group rail. True when this is a group match (the 1v1 builder then stays out). */
function syncGroupLobby(): boolean {
  if (!get().match?.group) return false;
  const input = groupLobbyInput();
  if (!input) return true;
  const run = useGame.getState().run;
  const key = versusGroupLobbyKey(input);
  if (key === groupLobbyKey && run.lobby) return true;
  groupLobbyKey = key;
  const lobby = versusGroupLobby(input);
  resetLobbyDrivers(lobby.seats);
  useGame.setState({ run: { ...run, lobby } });
  return true;
}

/** The run for this match: built once, from my lock checkpoint + committed rounds on a reconnect. */
function ensureRun(match: VersusMatch, seat: VersusSeat): void {
  const game = useGame.getState();
  if (builtFor === match.id && game.run.mode === 'versus') return;
  if (endGated.has(match.id)) return; // conceded / over: never rebuilt behind (or after) the end gate
  const priv = get().priv;
  const offer = get().heroOffer;
  if (!priv || !offer) return;
  if (match.phase === 'complete') return;
  builtFor = match.id;
  void (async () => {
    const hero = (seat === 'p1' ? match.p1_hero : match.p2_hero) ?? offer[priv.hero_index ?? 0] ?? offer[0]!;
    // The MATCH's pinned room options (R-VERSUS-OPTIONS-01): a modifier pins its rift onto the run.
    let run: RunState = createVersusRun(Number(priv.run_seed), hero, match.set_id as SetId, match.options ? normalizeVersusOptions(match.options) : null);
    const rr = get().priv?.hero_reroll;
    if (isHeroReroll(rr)) run.heroReroll = { ...rr }; // the hero select's one re-roll (R-HERO-REROLL-01)
    const ck = await mx.myLatestCheckpoint(match.id).catch(() => null);
    if (ck?.checkpoint) {
      try { run = deserialize(ck.checkpoint); } catch { /* fall back to the fresh run */ }
    }
    run = catchUpVersusRun(run, resultsFor(seat), Number(match.seed), seat);
    if (!run.cosmetics) { const cos = currentRunCosmetics(); if (cos) run.cosmetics = cos; } // my skins, as a lobby run records them
    const present = (): void => {
      lobbyKey = '';
      groupLobbyKey = '';
      useGame.getState().startVersusRun(run);
      syncVersusLobby();
      // Reconnected after locking this round: the lock is irreversible, so the shop stays locked.
      const live = get().match ?? match;
      if (live.phase === 'shop' && run.wave === live.round && (seat === 'p1' ? live.p1_locked : live.p2_locked)) set({ lockedRound: live.round });
      startRunWatch(match.id, seat);
      driveRun(get().match ?? match, seat);
      pullDuosPasses(match.id); // VERSUS DUOS: passes that arrived while the run was being built
    };
    // HERO SELECT is on screen: the run waits for its own launch (the ceremony, then the cover), so the full game
    // start plays out (owner 2026-10-14). Otherwise (a reload into a running match) it goes straight on screen.
    if (versusHeroSelectOnScreen()) {
      pendingPresent = present;
      set({ runReady: true });
    } else {
      present();
      ackIntro(match.id);
    }
  })();
}

/** The built run, held until Hero Select's launch puts it on screen (`launchVersusHero`). */
let pendingPresent: (() => void) | null = null;
const versusHeroSelectOnScreen = (): boolean => {
  const g = useGame.getState();
  return g.heroChoices !== null && g.pendingMode === 'versus' && !g.showTitle;
};

/**
 * ROUND 1'S CLOCK starts when both players' game start has played out (owner 2026-10-14: "show the good luck screen,
 * then have the timer start per usual"): once this client's Good Luck intro is over (or it never played), tell the
 * server. The server starts the clock when both have, or at its silent cap.
 */
function ackIntro(matchId: string): void {
  window.setTimeout(() => {
    const send = (): void => {
      const m = get().match;
      if (!session || !m || m.id !== matchId || m.phase !== 'shop' || m.round !== 1 || m.shop_deadline) return;
      void mx.introDone(matchId).then((x) => onMatch(x)).catch(() => undefined);
    };
    if (!goodLuckIntro.isActive()) { send(); return; }
    const off = goodLuckIntro.subscribe(() => { if (!goodLuckIntro.isActive()) { off(); send(); } });
  }, 0);
}

/** React to the server state against the live run: land fights, fast-forward a stale fight, open the shop. */
function driveRun(match: VersusMatch, seat: VersusSeat): void {
  if (endGated.has(match.id)) return;
  // VERSUS DUOS: the screen shows my teammate's run; mine is set aside and driven once I am back (R-DUOS-VIEW-01).
  if (ownRunWhileWatching()) return;
  const g = useGame.getState();
  const run = g.run;
  if (run.mode !== 'versus' || builtFor !== match.id) return;
  const round = get().rounds[run.wave];
  // The fight for the round I am still shopping (or locked) is in: answer any open decision exactly as the lock
  // did, then let Recruit play the real End Turn; the commit lands this fight (`versusLand`).
  if (round && run.phase === 'recruit' && !g.presentationTx && get().endTurnWave !== run.wave) {
    const answered = versusAutoResolve(run, versusTimeoutRng(Number(match.seed), run.wave, seat));
    if (answered !== run) useGame.setState({ run: answered });
    set({ endTurnWave: run.wave });
  }
  // More than a round behind (a long reconnect): finish the old fight at once. One round behind is the ordinary
  // leave, which the fight screen plays through its own exit (`versusTurn` 'leave').
  if (run.phase === 'combat' && !run.pendingCombatSide && match.round > run.wave + 1 && (match.phase === 'shop' || match.phase === 'complete')) {
    if (!run.combatSettled) g.dispatch({ type: 'settleCombat' });
    g.dispatch({ type: 'resolveCombat' });
  }
  // Already past this fight (a reload rebuilt the run beyond it) but the server still waits on me: I am back.
  if (match.phase === 'combat' && run.phase === 'recruit' && run.wave > match.round && !match[`${seat}_ready`] && readySentFor !== `${match.id}:${match.round}`) {
    readySentFor = `${match.id}:${match.round}`;
    void mx.combatReady(match.id, match.round).then((m) => onMatch(m)).catch(() => { readySentFor = null; });
  }
}
/**
 * Is this player's input frozen (`versusRefuses`)? 'paused' for a disconnect pause and its 3-2-1 (the server clears
 * `paused_at` at the resume); 'held' while the shop is not this player's to play (`versusTurnHolds`).
 */
export function versusFreezeOf(st: Pick<VersusState, 'match' | 'lockedRound' | 'readyRound'>, run: RunState): VersusFreeze {
  const m = st.match;
  if (!m || m.phase === 'complete' || run.mode !== 'versus') return null;
  if (m.paused_at) return 'paused';
  const t = versusTurn({ match: m, seat: mySeat(m), lockedRound: st.lockedRound, readyRound: st.readyRound, run, now: versusServerNow() });
  return versusTurnHolds(t) ? 'held' : null;
}

/** Is the match paused right now (a disconnect pause or its 3-2-1)? Recruit holds its in-flight work on it. */
export const useVersusPaused = (): boolean => useVersus((s) => !!s.match?.paused_at && s.match.phase !== 'complete');

/** The fight this client last told the server it is back from (once per round). */
let readySentFor: string | null = null;

/** Watch the live run: candidates while shopping, the combat barrier on return, spectator frames. */
function startRunWatch(matchId: string, seat: VersusSeat): void {
  if (!session) return;
  session.unsubRun?.();
  session.publisher = newPublisher(emoteSeatOf(get().match) ?? seat);
  if (session.channel) { uninstallSpectatorEmotes(); installVersusEmotes(emoteSeatOf(get().match) ?? seat, session.channel.send); }
  installVersusHandlers({
    fightFor: (wave) => {
      const r = get().rounds[wave];
      return r ? ((seat === 'p1' ? r.p1_result : r.p2_result) as CombatResult) : null;
    },
    freeze: (run) => versusFreezeOf(get(), run),
    afterCommit: (action: Action, prev: RunState, next: RunState) => {
      if (next !== prev) tapAct(action); // the stands replay it (a no-op with nobody watching; never a rejected action)
      if (action.type === 'resolveCombat' && prev.phase === 'combat' && next.phase === 'recruit') {
        set({ endTurnWave: null });
        void mx.combatReady(matchId, prev.wave).then((m) => onMatch(m)).catch(() => undefined);
      }
    },
  });
  let lastRun: RunState | null = null;
  session.unsubRun = useGame.subscribe((st) => {
    if (st.run === lastRun || st.run.mode !== 'versus') return;
    if (ownRunWhileWatching()) return; // VERSUS DUOS: the screen shows my teammate's run; mine is set aside, unchanged
    const shopOpened = lastRun?.phase !== 'recruit' && st.run.phase === 'recruit';
    lastRun = st.run;
    syncVersusLobby(); // a no-op unless the wave / fight state moved (a fresh run object then re-enters here once)
    maybeEndGate(); // a finished match ends through the end gate once the last fight has been left
    candidates.schedule({ matchId, seat });
    frames.schedule({ matchId, forceKey: shopOpened });
    // VERSUS DUOS: my new passes go out, my hand room is reported (R-DUOS-PASS-01).
    const me = get().match?.group?.me;
    if (st.run.duos && me) duosAfterRun(matchId, me, st.run);
  });
  candidates.schedule({ matchId, seat });
  frames.schedule({ matchId, forceKey: true });
}

const candidates = createDeferredWriter<{ matchId: string; seat: VersusSeat }>(({ matchId, seat }) => {
  const match = get().match;
  const run = ownRunWhileWatching() ?? useGame.getState().run; // VERSUS DUOS: never the teammate's run on screen
  if (!session || !match || match.id !== matchId || match.phase !== 'shop' || run.mode !== 'versus' || run.phase !== 'recruit'
    || run.wave !== match.round || get().lockedRound === match.round) return;
  const side = buildVersusCandidate(run, versusTimeoutRng(Number(match.seed), run.wave, seat));
  if (!side) return;
  session.candidateSeq += 1;
  void mx.submit(matchId, match.round, session.candidateSeq, side, false, null, versusScoutOf(run)).catch(() => undefined);
}, 600);

/** How many spectators were in the room at the last publish: a new arrival gets a keyframe. */
let watchersSeen = 0;
/** A spectator asked for a keyframe: sticky until the next publish, whatever else was scheduled meanwhile. */
let keyWanted = false;
const frames = createDeferredWriter<{ matchId: string; forceKey: boolean }>(({ matchId, forceKey }) => {
  const pub = session?.publisher;
  const run = ownRunWhileWatching() ?? useGame.getState().run; // VERSUS DUOS: always MY run, even while I watch my teammate
  if (!session || !pub || run.mode !== 'versus') return;
  // No one watching: no projection work at all (a spectator never costs a player anything it does not need).
  // Who may be watching: the stands, and in a group match every player already out (R-VERSUS-GROUP-06: they watch the
  // rest; before the knockout-stands migration their room role is still their seat).
  const out = new Set(groupRaw && groupRaw.id === matchId ? groupRaw.seats.filter((x) => x.eliminatedRound != null).map((x) => x.userId) : []);
  // VERSUS DUOS: my teammate always watches (the live teammate view, R-DUOS-VIEW-01).
  const watchers = (get().room?.members.filter((m) => m.role === 'spectator' || out.has(m.userId)).length ?? 0) + (get().match?.group?.duos ? 1 : 0);
  const arrived = watchers > watchersSeen;
  watchersSeen = watchers;
  setSpectatorTap(watchers > 0, emoteSeatOf(get().match), session.channel?.send ?? null, () => frames.schedule({ matchId, forceKey: false }), () => frames.flush());
  if (watchers === 0) return;
  const msg = nextSpectatorMessage(pub, run, run.wave, forceKey || arrived || keyWanted, hasPendingActs());
  keyWanted = false;
  if (!msg) return;
  msg.m = matchId; // the stands drop anything from another match
  const acts = takeActs();
  if (acts.length) msg.acts = acts;
  const od = takeOdds(run, msg.kind === 'key'); // my fight's odds, for the stands' Summary (R-SPECTATE-LOCAL-01)
  if (od) msg.od = od;
  const ov = takeOverlay(msg.kind === 'key'); // which overlays I minimized (R-SPECTATE-OVERLAY-01)
  if (ov) msg.ov = ov;
  // Where my fight is, on a keyframe sent while it plays: a late joiner seeks to it (R-SPECTATE-JOIN-01). Never on
  // the persisted copy (its beat would be stale by the time someone reads it).
  const cb = msg.kind === 'key' ? combatBeatFor(run) : null;
  session.channel?.send('spectate', cb ? { ...msg, cb } : msg);
  if (msg.kind === 'key') void mx.publishFrame(matchId, msg.seq, msg.round, msg).catch(() => undefined);
}, 250);

/**
 * LOCK this round: End Turn, or the deadline. The final side is built on a clone with every open decision given
 * its random-legal answer (ruling 7); the checkpoint is that answered run (the reconnect restore point).
 * Irreversible on the server. The live run is untouched until the fight is in.
 */
/**
 * The shop clock reached 0:00 (R-VERSUS-CLOCK-LOCK-01, the lobby's R-TIMER-LOCK-01): the engine lock lands first (Shop
 * actions and hero powers refused, exactly as in a lobby), then my turn locks with the board as it stands at 0:00.
 * Idempotent: the reducer ignores a second expiry and `lockTurn` a second lock.
 */
export function expireVersusShop(): void {
  // VERSUS DUOS: 0:00 while I watch my teammate locks MY turn (my run, set aside), never the one on screen; I stay on
  // the view until the fight starts (R-DUOS-VIEW-01).
  if (ownRunWhileWatching()) { void lockTurn(); return; }
  const g = useGame.getState();
  if (g.run.mode !== 'versus' || g.run.phase !== 'recruit' || g.replaying) return;
  if (!g.run.shopClockExpired) g.dispatch({ type: 'shopClockExpired' });
  void lockTurn();
}

export async function lockTurn(): Promise<void> {
  const match = get().match;
  const seat = mySeat(match);
  const run = ownRunWhileWatching() ?? useGame.getState().run; // VERSUS DUOS: always MY run, even while I watch my teammate
  if (!match || !seat || run.mode !== 'versus' || run.phase !== 'recruit' || run.wave !== match.round || get().lockedRound === match.round) return;
  if (match.paused_at) return; // a paused match takes no End Turn
  set({ lockedRound: match.round });
  const rng = (): ReturnType<typeof versusTimeoutRng> => versusTimeoutRng(Number(match.seed), run.wave, seat);
  const answered = versusAutoResolve(structuredClone(run), rng());
  const ended = reduce(answered, { type: 'faceOmen', deferFight: true });
  if (!ended.pendingCombatSide) { set({ lockedRound: null }); return; }
  try {
    const m = await mx.submit(match.id, match.round, (session?.candidateSeq ?? 0) + 1, ended.pendingCombatSide, true, serialize(answered), versusScoutOf(answered));
    await onMatch(m);
  } catch (e) {
    // `deadline_passed` / `stale_round`: the server already promoted my newest candidate. Keep waiting for the fight.
    if ((e as VersusError).code !== 'deadline_passed' && (e as VersusError).code !== 'stale_round' && (e as VersusError).code !== 'already_locked') {
      set({ lockedRound: null, error: errorText(e) });
    }
  }
}

/** Hero Select: lock my pick (hidden until both are in or the clock runs out). */
export async function pickVersusHero(index: number): Promise<void> {
  const match = get().match;
  if (!match) return;
  try {
    await onMatch(await mx.pickHero(match.id, index));
  } catch (e) {
    set({ error: errorText(e) });
  }
}

/** Back from a disconnect: Unpause starts the 3-2-1 for both (`resume_at`); the server resumes the match at it. */
export async function resumeMatch(): Promise<void> {
  const match = get().match;
  if (!match) return;
  try { await onMatch(await mx.requestResume(match.id)); } catch (e) { set({ error: errorText(e) }); }
}

export async function unpauseMatch(): Promise<void> {
  const match = get().match;
  if (!match) return;
  try { await onMatch(await mx.unpause(match.id)); } catch (e) { set({ error: errorText(e) }); }
}

/** CONCEDE (the Esc menu's two-tap): the gate closes at once (owner 2026-10-14), while the server records it. */
export async function forfeitMatch(): Promise<void> {
  const match = get().match;
  if (!match || match.phase === 'complete') return;
  playVersusEndGate(match.id);
  try { await onMatch(await mx.forfeit(match.id)); } catch (e) { set({ error: errorText(e) }); }
}

/** The match ended: back to the room (ruling 10: no rematch room; the room itself lives on). */
export function returnToRoom(): void {
  const { match, rounds } = get();
  const seat = mySeat(match);
  if (match && seat && match.phase === 'complete') {
    const run = useGame.getState().run;
    // The end gate opens on the room with the match's stats already up (owner 2026-10-14). A group match: the whole
    // table (R-VERSUS-GROUP-07); a knocked-out player goes to the stands instead, the stats waiting in the room.
    const myCos = run.mode === 'versus' ? run.cosmetics ?? null : null;
    const groupRec = match.group ? groupRecord(myCos) : null;
    set({ lastMatch: groupRec ?? buildVersusMatchRecord(match, rounds, seat, myCos, foeCosmeticsOf(match, seat)), statsOpen: !match.group || groupRaw?.phase === 'complete' });
  } else if (match && seat) {
    set({ statsOpen: true }); // conceded at once: the record is built when the server confirms the result (`onMatch`)
  }
  builtFor = null;
  pendingPresent = null;
  lobbyKey = '';
  groupLobbyKey = '';
  goodLuckIntro.end();
  uninstallVersusEmotes();
  uninstallSpectatorEmotes();
  installVersusHandlers(null);
  session?.unsubRun?.();
  if (session) session.unsubRun = null;
  set({ lockedRound: null, readyRound: null, endTurnWave: null, screen: 'room' });
  useGame.getState().leaveVersusRun();
  // VERSUS GROUP: a player who is out of a match that goes on now sees it as the stands do.
  // KNOCKED OUT (owner 2026-10-24: "when a player loses/is knocked out in this mode they go into a spectator seat so
  // they can watch the rest of the game", R-VERSUS-GROUP-06): straight onto the watch screen of the same match (the
  // server has moved them to the stands), their placement shown as they arrive. Seen as the stands from here on.
  if (groupRaw && match && groupRaw.id === match.id) {
    const mine = groupSeatOf(groupRaw, currentUserId());
    if (groupRaw.phase !== 'complete' && mine) {
      set({ knockout: { matchId: match.id, placement: mine.placement, of: groupRaw.seat_count }, statsOpen: false });
      useSpectate.setState({ optedOut: null });
    }
    void onMatch(ingestGroup(groupRaw));
  }
  void refreshRoom();
}

/** The title's Versus card. */
export function openVersus(): void {
  set({ screen: get().room ? 'room' : 'browser', error: null });
  useGame.getState().setTitleView('versus');
  if (get().room) return;
  void refreshRooms();
  // A returning player (reload, new tab, crash) is still a member server-side: put them straight back in their room,
  // and from there into their running match (live test 2026-10-14: they used to see only "Watch").
  void rejoinMyRoom();
}

/**
 * At boot: if this account still holds a PLAYER seat in a room whose match is running, re-enter the room (the
 * session then rebuilds the run and puts the match back on screen). Waits briefly for the session to exist.
 */
export async function resumeVersusMatch(): Promise<void> {
  for (let i = 0; i < 20 && !currentUserId(); i++) await new Promise((r) => setTimeout(r, 500));
  const me = currentUserId();
  if (!me || get().room) return;
  try {
    const roomId = await versusRemote.myRoomId(me);
    if (!roomId || get().room) return;
    const room = await versusRemote.room(roomId);
    const role = room?.members.find((m) => m.userId === me)?.role;
    if (!room || room.status !== 'in_game' || !role || role === 'spectator') return;
    enterRoom(room);
  } catch { /* no backend / offline: nothing to resume */ }
}

async function rejoinMyRoom(): Promise<void> {
  const me = currentUserId();
  if (!me) return;
  try {
    const roomId = await versusRemote.myRoomId(me);
    if (!roomId || get().room) return;
    const room = await versusRemote.room(roomId);
    if (room) enterRoom(room);
  } catch { /* the browser stays up; Watch/Join still work */ }
}

export const clearVersusError = (): void => set({ error: null });
export const clearVersusKnockout = (): void => set({ knockout: null });
export const setVersusStatsOpen = (open: boolean): void => {
  useGame.setState({ inspect: null }); // an overlay opening or closing never leaves an inspect behind
  set({ statsOpen: open });
};

/**
 * END COMBAT in Versus (owner 2026-10-14): the press tells the server I am back, but I stay on the fight until the
 * next shop opens for both (the other presses, or their 5 s run out). True = handled here (stay); false = leave now
 * (the next shop is already open, or this is not a Versus fight).
 */
export function versusEndCombatPressed(run: RunState): boolean {
  const match = get().match;
  if (run.mode !== 'versus' || run.phase !== 'combat' || !match || !mySeat(match)) return false;
  if (match.phase !== 'combat' || match.round !== run.wave) return false; // the next shop is open: leave
  if (match.paused_at) return true; // paused: End Combat waits for the resume (swallowed, nothing sent)
  if (get().readyRound !== run.wave) {
    set({ readyRound: run.wave });
    void mx.combatReady(match.id, run.wave).then((m) => onMatch(m)).catch(() => undefined);
  }
  return true;
}

/** Close any open card inspect (the right-click preview). */
function closeInspect(): void {
  if (useGame.getState().inspect) useGame.setState({ inspect: null });
}

/** Re-read the match row now (the turn state found it out of date). At most once a second. */
let lastReread = 0;
export function rereadVersusMatch(): void {
  const m = get().match;
  if (!session || !m || Date.now() - lastReread < 1000) return;
  lastReread = Date.now();
  void mx.reconcile(m.id).then((x) => onMatch(x)).catch(() => undefined);
}

// ── the lobby gates (owner 2026-10-14: "the normal lobby gate close with the crystal"; the end gate) ───────────────

/** The entry gate in flight for one sealing of the room (the host's Start). */
let entryGate: { key: string; cancelled: boolean } | null = null;
/** Matches whose end gate has been asked for (once each). */
const endGated = new Set<string>();

/** Resolves true when this seat's Hero Select is ready (the match exists, my three are known), or false when the
 *  gate window closed instead (the room went back to Open). */
function heroSelectReady(gate: { cancelled: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const check = (st: VersusState): boolean => {
      if (gate.cancelled || !session) { resolve(false); return true; }
      const m = st.match;
      if (m && mySeat(m) && st.heroOffer && st.priv?.match_id === m.id && m.phase !== 'complete') { resolve(true); return true; }
      if (st.room?.status === 'open') { resolve(false); return true; }
      return false;
    };
    if (check(get())) return;
    const off = useVersus.subscribe((st) => { if (check(st)) off(); });
  });
}

/** Put this seat's three heroes on the ordinary Hero Select screen (`pendingMode: 'versus'`). */
function showVersusHeroSelect(): void {
  const offer = get().heroOffer;
  const g = useGame.getState();
  if (!offer || (g.run.mode === 'versus' && !g.showTitle)) return;
  const rr = get().priv?.hero_reroll;
  useGame.setState({ showTitle: false, pendingMode: 'versus', heroChoices: [...offer], heroReroll: isHeroReroll(rr) ? rr : null, avatarPickerOpen: false });
}

/**
 * THE HERO RE-ROLL in Versus (owner 2026-10-15, R-HERO-REROLL-01): the heroes my one re-roll may bring (my run's tribes
 * allow them, none is in my three), or [] when it is spent, in flight, picked, refused, or the server lacks it.
 */
export function versusRerollCandidates(st: VersusState = get()): string[] {
  const { match, priv, heroOffer } = st;
  if (!match || !priv || !heroOffer || priv.match_id !== match.id || match.phase !== 'hero_select') return [];
  if (st.rerollPending || st.rerollOffFor === match.id || st.pickedFor === match.id || priv.hero_index != null || priv.hero_reroll) return [];
  return versusHeroRerollCandidates(Number(priv.run_seed), match.set_id as SetId, heroOffer);
}

/** Spend my one re-roll on `slot`: the server draws the hero (match seed) and the swap lands on my screen only. The
 *  20 s clock keeps running. A server without the migration (`not_deployed`) or a refusal hides the control. */
export async function rerollVersusHero(slot: number): Promise<void> {
  const match = get().match;
  const candidates = versusRerollCandidates();
  if (!match || candidates.length === 0) return;
  set({ rerollPending: true });
  try {
    const out = await mx.rerollHero(match.id, slot, candidates);
    const priv = get().priv;
    const rr = out.reroll;
    if (!priv || priv.match_id !== match.id || !isHeroReroll(rr) || !Array.isArray(out.offer) || out.offer.length !== 3) return;
    set({ priv: { ...priv, hero_offer: out.offer, hero_reroll: rr }, heroOffer: [...out.offer] });
    const g = useGame.getState();
    if (g.pendingMode === 'versus' && g.heroChoices) useGame.setState({ heroChoices: [...out.offer], heroReroll: rr });
  } catch {
    set({ rerollOffFor: match.id });
  } finally {
    set({ rerollPending: false });
  }
}

/**
 * React to the room and the match (every Versus state change while in a room):
 *  - SEALED (the host pressed Start): each player gets the ranked entry gate. The crystal press is their "ready"
 *    (`pressGate`); it holds until the match exists, then shatters onto Hero Select. If the 30 s window closes first
 *    (the room goes back to Open) the doors part quietly on the room.
 *  - A player who comes back to a match still at Hero Select (reload) is put straight on the screen.
 *  - COMPLETE: once nothing is left to watch, the end gate closes over the match and opens on the room.
 */
function driveGates(st: VersusState): void {
  const { room, match } = st;
  if (!room || !session) return;
  const role = myRole(room);
  const player = !!role && role !== 'spectator';
  if (room.status === 'sealed' && player) {
    const key = `${room.id}|${room.gate_deadline ?? ''}`;
    if (entryGate?.key !== key) {
      const gate = { key, cancelled: false };
      entryGate = gate;
      closeInspect();
      void requestRankedGate(() => undefined, 'entry', {
        onPress: async () => {
          await pressGate();
          const ok = await heroSelectReady(gate);
          if (ok) showVersusHeroSelect(); // behind the shut doors
          return ok;
        },
      }).finally(() => { if (entryGate === gate) entryGate = null; });
    }
  } else if (entryGate && room.status === 'open') {
    entryGate.cancelled = true;
    cancelRankedGate();
    entryGate = null;
  }
  const seat = mySeat(match);
  if (!match || !seat) return;
  const g = useGame.getState();
  if (match.phase === 'hero_select' && !entryGate && g.heroChoices === null && g.run.mode !== 'versus' && st.heroOffer && st.priv?.match_id === match.id) {
    showVersusHeroSelect();
  }
}

/**
 * THE END GATE when the match is decided off the fight screen (a concede, missed rounds, both players gone): once
 * nothing is left to watch, the end gate closes over the match and opens on the room. A match decided by hearts ends
 * on its deciding fight's End Combat gem (`versusMatchEndsAtPress`), so its last fight is always watched. Called
 * after the match's rounds are loaded (`onMatch`) and on every run change, never on a bare match update (the
 * deciding round may not be loaded yet).
 */
function maybeEndGate(): void {
  const match = get().match;
  if (!session || !match || match.phase !== 'complete' || !mySeat(match) || endGated.has(match.id)) return;
  const g = useGame.getState();
  if (!versusEndsNow({ match, rounds: get().rounds, run: g.run, heroSelect: g.heroChoices !== null && g.pendingMode === 'versus' })) return;
  playVersusEndGate(match.id);
}

/** Close the end gate over the match and open it on the room (once per match). Behind the shut doors the game is
 *  torn down: the replay, its particles and sounds, any pending End of Turn, the run (`returnToRoom`). */
function playVersusEndGate(matchId: string): void {
  if (endGated.has(matchId)) return;
  endGated.add(matchId);
  closeInspect();
  // A fight may be playing (a concede lands mid-combat): its effects fade out as the doors close, never over them.
  pixiFx.setVisible(false, 180);
  void requestRankedGate(() => {
    pixiFx.clearParticles();
    stopAllAudio();
    returnToRoom();
    resumeAudio(); // the room's own sounds play on; only the match's were cut
    pixiFx.setVisible(true, 0);
  }, 'end');
}

/** The combat screen's End Combat gem: does leaving this fight end the match? Then it leaves through the end gate. */
export function versusMatchEndsAtPress(run: RunState): boolean {
  const match = get().match;
  return run.mode === 'versus' && run.phase === 'combat' && !!match && match.phase === 'complete' && !!mySeat(match) && !get().rounds[run.wave + 1];
}

/** Behind the end gate's shut doors (the End Combat press): leave the match for the room. */
export function finishVersusMatch(): void {
  const match = get().match;
  if (match) endGated.add(match.id);
  returnToRoom();
}

/**
 * HERO SELECT to the match (`HeroLaunchCurtain`, under its cover): lock my pick (hidden until both are in, ruling 3)
 * and wait for the run to be on screen. The curtain stays up while the opponent chooses.
 */
export function launchVersusHero(heroId: string): Promise<void> {
  lockVersusHeroPick(heroId);
  return new Promise((resolve) => {
    let offA: () => void = () => undefined;
    let offB: () => void = () => undefined;
    const done = (): boolean => {
      const g = useGame.getState();
      const m = get().match;
      if (pendingPresent && m) {
        const present = pendingPresent;
        pendingPresent = null;
        set({ runReady: false });
        present();
        ackIntro(m.id); // after the curtain has begun the Good Luck intro (same tick as this launch resolves)
        resolve();
        return true;
      }
      if (!session || !m || m.phase === 'complete' || g.showTitle) { resolve(); return true; }
      return false;
    };
    if (done()) return;
    offA = useGame.subscribe(() => { if (done()) { offA(); offB(); } });
    offB = useVersus.subscribe(() => { if (done()) { offA(); offB(); } });
  });
}

/**
 * Lock my hero the moment a card is chosen on Hero Select (the ceremony that follows takes seconds, and the 20 s clock
 * must not run out on a choice already made, live test 2026-10-14).
 */
export function lockVersusHeroPick(heroId: string): void {
  const match = get().match;
  const i = get().heroOffer?.indexOf(heroId) ?? -1;
  if (!match || i < 0 || get().pickedFor === match.id || get().priv?.hero_index != null || get().rerollPending) return;
  set({ pickedFor: match.id });
  void pickVersusHero(i);
}

/** Is my Versus pick in and waiting on the opponent (the launch curtain's caption)? */
export function useVersusAwaitingPick(): boolean {
  return useVersus((s) => !!s.match && s.match.phase === 'hero_select' && s.pickedFor === s.match.id);
}

/**
 * The hero the server picked for me when the 20 s ran out before I chose (ruling 2), so Hero Select can play the
 * same ceremony for it. Null while I can still choose, or once I have.
 */
export function useVersusTimeoutHero(): string | null {
  return useVersus((s) => {
    const m = s.match;
    const seat = mySeat(m);
    if (!m || !seat || !m.heroes_revealed || s.pickedFor === m.id) return null;
    return (seat === 'p1' ? m.p1_hero : m.p2_hero) ?? null;
  });
}

/** Both heroes are locked in (Versus Hero Select is over on the server). */
export function useVersusHeroesRevealed(): boolean {
  return useVersus((s) => !!s.match?.heroes_revealed);
}

/** The ceremony played for a timeout pick: the pick is the server's, so nothing is sent for it. */
export function markVersusPickShown(): void {
  const m = get().match;
  if (m) set({ pickedFor: m.id });
}

// THE VERSUS SESSION IS NOT HOT-SWAPPABLE (owner report 2026-10-14: "i got back from combat and was set in the ready
// state"). Like the main store (store.ts, 2026-09-23), a Vite HMR patch that re-executes this module mints a SECOND
// session store: the screen reads the new one (a frozen match row) while the old one keeps playing the match. A full
// reload is the only honest outcome; the match resumes from the server. Absent in production and in vitest.
if (import.meta.hot) {
  import.meta.hot.accept(() => { window.location.reload(); });
}

/** VERSUS DUOS: land my teammate's passes and the answers to mine (a realtime wake or a match refresh). */
function pullDuosPasses(matchId: string): void {
  const raw = groupRaw;
  const me = get().match?.group?.me;
  if (!raw || raw.id !== matchId || !isDuosRaw(raw) || !me || builtFor !== matchId) return;
  void duosPull(matchId, me, raw.round);
}

/** VERSUS DUOS: a spectator frame or cursor sample from my teammate's seat. */
function isMateFrame(payload: unknown): boolean {
  const mate = get().match?.group?.duos?.mate;
  return !!mate && !!payload && typeof payload === 'object' && (payload as { seat?: unknown }).seat === mate;
}
