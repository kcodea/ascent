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
import { installVersusHandlers, releaseVersusFightWait, type VersusFreeze } from './versusHooks';
import { VersusError, versusRemote, type VersusGroupMatchRaw, type VersusGroupRoundRaw, type VersusMatch, type VersusPrivate, type VersusRoom, type VersusRoomSummary, type VersusRole, type VersusRoundRow } from './versusRemote';
import { duosFirstAt, duosLobbySeatId, groupPairingAt, groupSeatOf, isDuosRaw, projectGroupMatch, projectGroupRounds } from './versusGroupView';
import { isRankedDuosRaw, rankedCloseIso, rankedRoundsAsGroup, RANKED_DUOS_TEAM_COUNT, withServedSeats, type RankedDuosContext } from './rankedDuosView';
import type { RankedDuosRoundRow } from './versusRemote';
import type { RankResult } from '@game/sim';
import { duosAfterRun, duosPull, duosReset } from './duosPasses';
import { versusOptionsSummary } from './versusOptionsUi';
import { heroSelectFrame, newPublisher, nextHeroSelectMessage, nextSpectatorMessage, type HeroSelectFrame, type SpectatorPublisher } from './spectatorView';
import { useOwnHeroPick } from '../hero-select/ownHeroPick';
import { installSpectateIo, leaveTeammate, leaveTeammateHero, ownRunWhileWatching, receiveSpectate, receiveSpectatorCursor, resetSpectate, SPECTATE_KEY_EVENT, spectateSync, trackDuosMatch, useSpectate } from './spectate';
import { othersInStands, setWatchers, type Watcher } from './watchers';
import { combatBeatFor, hasPendingActs, setSpectatorTap, SPECTATE_CURSOR_EVENT, tapAct, takeActs, takeOdds, takeOverlay } from './spectateTap';
import { cancelRankedGate, requestRankedGate } from '../rankedGate/rankedGateController';
import { pixiFx } from '../pixiFx';
import { goodLuckIntro } from '../goodLuck/goodLuckIntroStore';
import { resumeAudio, stopAllAudio } from '../sfx';
import { buildGroupMatchRecord, buildVersusMatchRecord, type VersusMatchRecord } from './versusMatchRecord';
import { versusEndsNow, versusTurn, versusTurnHolds } from './versusTurn';
import { markFlow } from './flowTiming';
import { duosTeamArmorRaise, noteVersusEntering, versusEnteringFor } from './versusEntering';
export { versusFlowTimings } from './flowTiming';

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
  /** RANKED DUOS (phase 3): which play area the browser shows: Versus rooms, or Ranked Duos parties. */
  area: VersusArea;
  /** RANKED DUOS: my team's rating result for the match I just finished (`duos_rank_results`), shown after it. */
  duosResult: DuosResultView | null;
}

/** The two play areas over the one room system: Versus rooms, and Ranked Duos parties (owner 2026-10-26). They are
 *  separate places (owner 2026-10-27, R-RANKED-DUOS-SPLIT-01): neither shows up in the other's menus. */
export type VersusArea = 'versus' | 'duos';
/** A Ranked Duos party (a `ranked_duos` room), as opposed to a Versus room. */
export const isDuosParty = (r: { options?: { mode?: string } | null } | null | undefined): boolean => r?.options?.mode === 'ranked_duos';
/** The play area a room belongs to. */
export const areaOfRoom = (r: { options?: { mode?: string } | null } | null | undefined): VersusArea => (isDuosParty(r) ? 'duos' : 'versus');
/** My team's result for a finished Ranked Duos match (a RankResult-shaped row, team-owned). */
export interface DuosResultView { matchId: string; placement: number; result: RankResult | null; teamName: string | null; pending: boolean }

export const useVersus = create<VersusState>(() => ({
  screen: 'browser', rooms: [], loading: false, error: null, room: null, match: null, priv: null, heroOffer: null,
  rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null, offsetMs: 0, lastMatch: null, statsOpen: false, pickedFor: null, runReady: false,
  rerollPending: false, rerollOffFor: null, seatMove: null, optionsNotice: null, knockout: null, area: 'versus', duosResult: null,
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
  // RANKED DUOS (phase 3)
  friends_only: 'That party is for the host\'s friends.',
  hero_taken: 'Your teammate picked that hero.',
  room_not_sealed: 'The game is already starting.',
  team_in_game: 'Rename your team between games.',
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
    // Versus rooms only: a Ranked Duos party never shows in the Versus browser (the server lists one area since
    // 2026-11-02-ranked-duos-party-split.sql; this filter covers a server without it).
    set({ rooms: (await versusRemote.listRooms()).filter((r) => !isDuosParty(r)), error: null });
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
    // RANKED DUOS (phase 3): a party is two players, so joining one as a player takes its free seat at once.
    if (as === 'player' && isDuosParty(room) && room.status === 'open') {
      const free = (['p1', 'p2'] as const).find((r) => !room.members.some((m) => m.role === r));
      if (free) await takeSeat(free);
    }
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
    // A second press after the room already started (or reopened) is not a connection problem (live test 2026-10-26:
    // a double press showed "Connection problem. Try again."): the room moved on, so just re-read it.
    if ((e as VersusError)?.code !== 'room_not_sealed') set({ error: errorText(e) });
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
  /** Hero Select's frames (R-SPECTATE-HEROSELECT-01): the watchers' trigger (my screen's inputs moving). */
  unsubHero: () => void;
} | null = null;

function enterRoom(room: VersusRoom): void {
  stopSession();
  set({ room, area: areaOfRoom(room), screen: 'room', error: null, seatMove: null, match: null, priv: null, heroOffer: null, rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null });
  session = { roomId: room.id, matchId: null, channel: null, beat: 0, tick: 0, wake: null, lastFinalize: 0, candidateSeq: 0, publisher: null, unsubRun: null, unsubGates: useVersus.subscribe(driveGates), unsubHero: watchMyHeroSelect() };
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
  session.unsubHero();
  heroFrames.cancel();
  heroPub = null;
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
    else if (event === SPECTATE_KEY_EVENT) {
      if (mySeat() && session?.matchId) {
        // On Hero Select my screen goes out again (nothing of it is stored for a late joiner); else a keyframe.
        if (myHeroSelectOnScreen()) { heroKeyWanted = true; heroFrames.schedule({ matchId: session.matchId }); }
        else { keyWanted = true; frames.schedule({ matchId: session.matchId, forceKey: true }); }
      }
    }
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

/** Realtime is a wake-up only: coalesce bursts and re-read the rows. A round commit's events (the match row and the
 *  round insert) come from one transaction and arrive within a few ms of each other, so a short window still folds them
 *  into one read (DUOS FLOW 2026-10-26: was 120 ms, pure waiting between the commit and the fight). */
const WAKE_COALESCE_MS = 50;
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
    // A round just landed: its rows are read together with the match row (one round trip, R-DUOS-FLOW-01).
    if (mid && (w.has('match') || w.has('rounds') || w.has('room'))) void refreshMatch(mid, w.has('rounds'));
    // VERSUS DUOS: a teammate's pass (or an answer to mine) landed on the server.
    if (mid && w.has('passes')) pullDuosPasses(mid);
  }, WAKE_COALESCE_MS);
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

async function refreshMatch(matchId: string, withRounds = false): Promise<void> {
  if (!session) return;
  if (session.matchId !== matchId) subscribe(matchId);
  try {
    // A round was just committed (the resolver answered, or its insert woke us): the match row and the new round are read
    // in parallel, so the fight is ready the moment the row is (R-DUOS-FLOW-01). Otherwise the row alone, as before.
    const [match] = await Promise.all([mx.match(matchId), withRounds ? prefetchRounds(matchId) : Promise.resolve()]);
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
    if (m && mySeat(m) && m.phase !== 'complete' && !m.paused_at) void mx.reconcile(m.id).then((x) => onOwnAnswer(x)).catch(() => undefined);
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

/**
 * COMING BACK TO A LIVE MATCH (R-PHONE-RESUME-01, owner 2026-10-27 on his iPhone: "minimizing the game and coming
 * back"). iOS freezes a backgrounded page: no heartbeat, and the Realtime socket drops, so row changes made meanwhile
 * never arrive as wake-ups. The socket reconnects by itself and the 4 s heartbeat would resync within a beat; this
 * resyncs at once instead (the room, the match with its rounds, a heartbeat), so the screen is current the moment it
 * shows. A live match never pauses for this: the server's deadlines and its disconnect pause are the rule.
 */
export function resyncVersusSession(): void {
  if (!session) return;
  void heartbeat();
  void refreshRoom();
  const mid = get().room?.current_match_id ?? session.matchId;
  if (mid) void refreshMatch(mid, true);
}
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resyncVersusSession(); });
  window.addEventListener('online', resyncVersusSession);
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
  // RANKED DUOS: the shop closes at the end-turn gate's moment (`closeAt`), not at 0:00 (R-RANKED-DUOS-GATE-01).
  const rankedClose = match.group && isRankedDuosRaw(match.group.raw) ? rankedCloseIso(match.group.raw) : undefined;
  if (player && (match.paused_at ? due(match.pause_grace_until) || leaseLate || (!!match.resume_at && due(match.resume_at))
    : (match.phase === 'hero_select' && due(match.hero_deadline)) || (match.phase === 'shop' && (rankedClose !== undefined ? !!rankedClose && due(rankedClose) : due(match.shop_deadline)))
      || (match.phase === 'combat' && due(match.combat_deadline)) || leaseLate)) {
    const key = `${match.id}|${match.revision}|${match.phase}|${match.paused_at ? 'p' : ''}|${match.resume_at ?? ''}`;
    if (reconcileGate.ready(key, now)) {
      reconcileGate.asked(key, now, hidden);
      void mx.reconcile(match.id).then((m) => onOwnAnswer(m)).catch(() => undefined);
    }
  }
  // The round is closed and waits on the resolver. The client whose own call closed it asks at once (`onOwnAnswer`); every
  // other player asks only as a backstop, once the round has sat closed for a moment (R-DUOS-FLOW-01: one resolver call
  // per round instead of one per player, and none of them waiting for this 500 ms tick).
  if (player && match.phase === 'resolving' && (closedSeen?.key !== `${match.id}|${match.round}` || now - closedSeen.at >= FINALIZE_BACKSTOP_MS)) {
    kickFinalize(match);
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
/** How long a closed round may wait on another client's resolver call before this one asks too (the backstop). Long
 *  enough that a second call rarely overlaps the first: measured live 2026-10-26, a duplicate call in flight went with
 *  the 8-11 s resolver answers (a second resolver instance spinning up), the single calls with 1.6-2.6 s. */
const FINALIZE_BACKSTOP_MS = 4000;
/** When this client first saw the current round closed (`resolving`). */
let closedSeen: { key: string; at: number } | null = null;

/**
 * An answer to MY OWN call (my lock, my re-lock, my reconcile): if it closed the round, I am the one who asks the
 * resolver, now (R-DUOS-FLOW-01: before, every player waited for its next 500 ms tick and then all of them asked).
 */
async function onOwnAnswer(m: VersusMatch): Promise<void> {
  await onMatch(m);
  if (m.phase === 'resolving') kickFinalize(m);
}

/** Ask the resolver to settle the closed round (once per round through the backed-off gate), then read the match row and
 *  the committed round together, so the fight lands in one round trip. */
function kickFinalize(match: VersusMatch): void {
  if (!session || match.phase !== 'resolving' || !mySeat(match)) return;
  const key = `${match.id}|${match.round}`;
  const now = Date.now();
  if (!finalizeGate.ready(key, now)) return;
  finalizeGate.asked(key, now, pageHidden());
  session.lastFinalize = now;
  markFlow(match.id, match.round, 'finalize:start');
  void mx.finalize(match.id, match.round, match.content_revision)
    .then(() => { markFlow(match.id, match.round, 'finalize:done'); return refreshMatch(match.id, true); })
    .catch(() => undefined);
}

/**
 * THE CLOSE, ON TIME (R-DUOS-FLOW-01). The moment the shop is due to close (the shop deadline plus the server's grace;
 * Ranked Duos: the end-turn gate's moment), one reconcile goes out on a timer of its own, instead of on whichever 500 ms
 * tick comes after it. Re-armed on every match update (a teammate's End Turn moves the Ranked Duos gate).
 */
let closeTimer: { at: number; id: number } | null = null;
const SHOP_GRACE_MS = 250; // the server's `versus__shop_grace()`
function armCloseTimer(match: VersusMatch): void {
  if (typeof window === 'undefined') return;
  const g = match.group?.raw;
  const ranked = !!g && isRankedDuosRaw(g);
  const iso = match.phase !== 'shop' || match.paused_at || !mySeat(match) ? null : ranked ? rankedCloseIso(g!) : match.shop_deadline;
  const at = iso ? Date.parse(iso) + (ranked ? 0 : SHOP_GRACE_MS) + 30 : null;
  if (closeTimer && closeTimer.at === at) return;
  if (closeTimer) window.clearTimeout(closeTimer.id);
  closeTimer = null;
  if (at == null || !Number.isFinite(at)) return;
  const wait = Math.max(0, at - versusServerNow());
  if (wait > 120_000) return; // far off: a later match update re-arms it
  closeTimer = {
    at,
    id: window.setTimeout(() => {
      closeTimer = null;
      const m = get().match;
      if (!session || !m || m.id !== match.id || m.phase !== 'shop' || m.round !== match.round) return;
      void mx.reconcile(m.id).then((x) => onOwnAnswer(x)).catch(() => undefined);
    }, wait),
  };
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
  // The pools going into the round (R-VERSUS-LIVE-ARMOR-01): 1v1 here, a group match in `ingestGroup`.
  if (!match.group) noteVersusEntering(match.id, match.phase, match.round, { p1: { health: match.p1_health, armor: match.p1_armor }, p2: { health: match.p2_health, armor: match.p2_armor } });
  // The flow's timeline (R-DUOS-FLOW-01): when this client learned the round closed, and when its fight came in.
  if (match.phase === 'resolving' || (match.phase === 'combat' && prev?.id === match.id && prev.phase === 'shop' && prev.round === match.round)) {
    const key = `${match.id}|${match.round}`;
    if (closedSeen?.key !== key) closedSeen = { key, at: Date.now() };
    markFlow(match.id, match.round, 'closed:seen');
  }
  armCloseTimer(match);
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
  // VERSUS DUOS: my teammate's hero choices are only there while Hero Select is (R-DUOS-HEROSELECT-01).
  if (match.phase !== 'hero_select' && !myHeroSelectOnScreen()) leaveTeammateHero();

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
  await readDuelRounds(match.id, from);
}

/** 1v1: read committed rounds from `from` into the store. */
async function readDuelRounds(matchId: string, from: number): Promise<void> {
  try {
    const rows = (await versusRemote.rounds(matchId, from)).filter((r) => r.match_id === matchId);
    if (roundsOf !== matchId) return; // the room moved on to another match while this read was in flight
    if (rows.length) set({ rounds: { ...get().rounds, ...Object.fromEntries(rows.map((r) => [r.round, r])) } });
  } catch { /* retried on the next wake */ }
}

/**
 * A round was just COMMITTED (the resolver answered, or the round's insert woke this client): read it now, in parallel
 * with the match row (`refreshMatch(id, true)`), instead of after it. The match row then finds the round already here
 * and the fight lands in one round trip (R-DUOS-FLOW-01). Reads exactly what `loadRounds` would have read next.
 */
async function prefetchRounds(matchId: string): Promise<void> {
  if (roundsOf !== matchId) return;
  if (!groupIds.has(matchId)) {
    if (!duelIds.has(matchId)) return;
    const known = Object.keys(get().rounds).map(Number);
    await readDuelRounds(matchId, known.length ? Math.max(...known) + 1 : 1);
    return;
  }
  const raw = groupRaw;
  if (!raw || raw.id !== matchId) return;
  const known = Object.keys(groupRoundsRaw).map(Number);
  await readGroupRounds(raw, known.length ? Math.max(...known) + 1 : 1);
}

/** Group / Duos / Ranked Duos: read committed rounds from `from` into the raw cache (not projected here). */
async function readGroupRounds(raw: VersusGroupMatchRaw, from: number): Promise<void> {
  try {
    if (isRankedDuosRaw(raw)) {
      // RANKED DUOS: the committed rounds in the Duos shape (the live team's own fight in full, the other a result).
      const rows = await versusRemote.rankedRounds(raw.id, from);
      if (roundsOf !== raw.id || ranked.matchId !== raw.id) return;
      for (const r of rows) ranked.rows[r.round] = r;
      ranked = { ...ranked, rounds: Object.values(ranked.rows).sort((a, b) => a.round - b.round) };
      for (const r of rankedRoundsAsGroup(rows)) groupRoundsRaw[r.round] = r;
    } else {
      const rows = await versusRemote.groupRounds(raw.id, from);
      if (roundsOf !== raw.id) return;
      for (const r of rows) groupRoundsRaw[r.round] = r;
    }
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
 * `versusLobby(...)`: me as seat s0 and the opponent as s1 on their Health and Armor (R-VERSUS-HEALTH-01), the opponent fielding the board
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
      round: r.round, loser: r.heart_lost_by, mine: (seat === 'p1' ? r.p1_result : r.p2_result) as CombatResult,
      foeScout: (seat === 'p1' ? r.p2_scout : r.p1_scout) ?? null,
      ...(r.p1_health != null && r.p2_health != null
        ? { vitals: { p1: { health: r.p1_health, armor: r.p1_armor ?? 0 }, p2: { health: r.p2_health, armor: r.p2_armor ?? 0 } } }
        : {}),
    })),
    options: match.options ?? null,
    entering: versusEnteringFor<VersusSeat>(match.id),
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

// ── RANKED DUOS (owner 2026-10-26): the recorded teams, read once per shop (`versus_ranked_duos_table`) ─────────────
/** What this client knows about the recorded teams of the current Ranked Duos match. */
let ranked: RankedDuosContext & { matchId: string | null; tableRound: number; rows: Record<number, RankedDuosRoundRow> } =
  { matchId: null, table: null, teams: [], rounds: [], tableRound: -1, rows: {} };
/** The match row as the Duos helpers read it: a Ranked Duos row gets its recorded teams seated virtually. */
const viewRaw = (raw: VersusGroupMatchRaw): VersusGroupMatchRaw => (isRankedDuosRaw(raw) && ranked.matchId === raw.id ? withServedSeats(raw, ranked) : raw);
const rankedSeatGate = keyedBackoff({ base: 2000, fastTries: 3, max: 30_000, hiddenFloor: 10_000 });
const rankedTableGate = keyedBackoff({ base: 1000, fastTries: 3, max: 30_000, hiddenFloor: 10_000 });
/**
 * Keep the recorded table current (R-NET-BACKOFF-01: one ask per round, backed off on failure): once the heroes are in,
 * ask the server to seat it (idempotent; the first round's finalize would also seat it), then read it ONCE per shop
 * (the boards of the round, the pools after the last one). Players and spectators alike; never more than that.
 */
function syncRankedTable(raw: VersusGroupMatchRaw): void {
  if (!isRankedDuosRaw(raw) || !session) return;
  if (ranked.matchId !== raw.id) ranked = { matchId: raw.id, table: null, teams: [], rounds: [], tableRound: -1, rows: {} };
  const now = Date.now();
  const hidden = pageHidden();
  const player = !!groupSeatOf(raw, currentUserId());
  if (player && raw.phase !== 'hero_select' && raw.phase !== 'complete' && !raw.seated_at && !raw.seated) {
    const key = `${raw.id}|seat`;
    if (rankedSeatGate.ready(key, now)) {
      rankedSeatGate.asked(key, now, hidden);
      void versusRemote.seatRankedDuos(raw.id, raw.content_revision).then(() => rankedTableGate.reset()).catch(() => undefined);
    }
  }
  const seated = !!(raw.seated_at || raw.seated);
  const want = raw.phase === 'shop' || raw.phase === 'complete' || ranked.tableRound < 0;
  if (!seated || !want || ranked.tableRound === raw.round) return;
  const key = `${raw.id}|${raw.round}`;
  if (!rankedTableGate.ready(key, now)) return;
  rankedTableGate.asked(key, now, hidden);
  void Promise.all([versusRemote.rankedTable(raw.id), versusRemote.rankedTeams(raw.id)]).then(([table, teams]) => {
    if (ranked.matchId !== raw.id) return;
    ranked = { ...ranked, table, teams, tableRound: raw.round };
    if (groupRaw?.id === raw.id) void onMatch(ingestGroup(groupRaw));
  }).catch(() => undefined);
}
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
  // RANKED DUOS: the table includes the recorded teams (`viewRaw` seats them), so the stats show all four teams.
  return buildGroupMatchRecord(viewRaw(raw), Object.values(groupRoundsRaw), me, myCos,
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
  syncRankedTable(groupRaw);
  // The pools going into the round (R-VERSUS-LIVE-ARMOR-01): every seat's stored pool, a shop Mend included.
  const shown = viewRaw(groupRaw);
  noteVersusEntering(shown.id, shown.phase, shown.round, Object.fromEntries(shown.seats.map((x) => [x.seat, x])));
  return projectGroupMatch(shown, groupViewer(groupRaw));
}

async function loadGroupRounds(match: VersusMatch): Promise<void> {
  const raw = groupRaw;
  if (!raw || raw.id !== match.id) return;
  const known = Object.keys(groupRoundsRaw).map(Number);
  const from = known.length ? Math.max(...known) + 1 : 1;
  if (from <= committedRound(raw)) {
    await readGroupRounds(raw, from);
    if (roundsOf !== match.id) return;
  }
  set({ rounds: projectGroupRounds(viewRaw(raw), Object.values(groupRoundsRaw), groupViewer(raw)) });
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
  unready: (id: string, round: number, seq: number): Promise<VersusMatch> =>
    (G(id) ? versusRemote.groupUnready(id, round, seq).then(ingestGroup) : versusRemote.unready(id, round, seq)),
  finalize: (id: string, round: number, content: string): Promise<void> => (G(id)
    ? (groupRaw?.id === id && isRankedDuosRaw(groupRaw) ? versusRemote.finalizeRankedDuos(id, round, content)
      : groupRaw?.id === id && isDuosRaw(groupRaw) ? versusRemote.finalizeDuos(id, round, content) : versusRemote.finalizeGroup(id, round, content))
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
      round: r.round, vitals: r.vitals ?? {},
      fights: r.fights.map((f) => ({ a: f.a_seat, b: f.b_seat, copy: f.b_copy, loser: f.heart_lost_by, ...(f.damage != null ? { damage: f.damage } : {}), aResult: f.a_result, aScout: f.a_scout, bScout: f.b_scout })),
    })),
    options: raw.options ?? null,
    entering: versusEnteringFor<VersusGroupSeat>(raw.id),
    complete: raw.phase === 'complete',
    pairing: groupPairingAt(raw, run.wave),
    ...(isDuosRaw(raw) ? { duos: { first: duosFirstAt(raw, run.wave) } } : {}),
    // RANKED DUOS: each recorded member's board for the round being played (the rail and scout cards, R-LOBBY-SCOUT-01).
    ...(isRankedDuosRaw(raw) && ranked.matchId === raw.id && ranked.table && ranked.tableRound === run.wave
      ? { current: Object.fromEntries(ranked.table.served.filter((x) => x.board).map((x) => [`p${2 * (x.team.charCodeAt(0) - 97) + 1 + x.member}`, x.board!])) }
      : {}),
  };
}
/**
 * VERSUS DUOS: the run carries the TEAM's pool (R-DUOS-HEALTH-01), so my teammate's shop Mend is my Armor too
 * (R-VERSUS-LIVE-ARMOR-01). Once the server has it (the team's stored pool going into this round), my run, still in this
 * round's shop on the same Health, takes the raise: my Health box, my rail row and Mend's own "nothing to do" check all
 * read it. Never lowers anything and never touches Health; the fight lands the resolver's pools as always.
 */
function syncDuosTeamArmor(input: VersusGroupLobbyInput): void {
  if (!input.duos || ownRunWhileWatching()) return;
  const run = useGame.getState().run;
  const armor = duosTeamArmorRaise(input.entering, input.me, run);
  if (armor != null) useGame.setState({ run: { ...run, armor, maxArmor: Math.max(run.maxArmor ?? 0, armor) } });
}
/** Build / refresh the group rail. True when this is a group match (the 1v1 builder then stays out). */
function syncGroupLobby(): boolean {
  if (!get().match?.group) return false;
  const input = groupLobbyInput();
  if (!input) return true;
  syncDuosTeamArmor(input);
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
    // VERSUS DUOS (R-DUOS-HEALTH-01): the run carries the TEAM's pool, so it needs my teammate's hero too.
    const mateSeat = match.group?.duos?.mate ?? null;
    const mateHero = mateSeat ? match.group?.raw.seats.find((x) => x.seat === mateSeat)?.hero ?? null : null;
    let run: RunState = createVersusRun(Number(priv.run_seed), hero, match.set_id as SetId, match.options ? normalizeVersusOptions(match.options) : null, mateHero);
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
  // EARLY END TURN (R-VERSUS-EARLY-EOT-01, owner 2026-10-27: "going into combat from shop seems to hang?"): the same,
  // the moment the server CLOSES this round (`resolving`), while the resolver settles it. The End of Turn beats play
  // during that wait; their commit holds until the fight is in (`holdUntilVersusFight`), then lands it as before.
  const closed = match.phase === 'resolving' && match.round === run.wave;
  if (round) markFlow(match.id, run.wave, 'combat:seen');
  if ((round || closed) && run.phase === 'recruit' && !g.presentationTx && get().endTurnWave !== run.wave) {
    const answered = versusAutoResolve(run, versusTimeoutRng(Number(match.seed), run.wave, seat));
    if (answered !== run) useGame.setState({ run: answered });
    set({ endTurnWave: run.wave });
  }
  // The fight is in: an End Turn that started early commits now, landing it. Off this call stack (a store commit inside
  // `onMatch` would re-enter the session), on the next task, as the ordinary End Turn's effect always did.
  if (round) { const wave = run.wave; setTimeout(() => releaseVersusFightWait(wave), 0); }
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
  // Above any Hero Select message this session sent, so the first run keyframe always outranks it.
  session.publisher = newPublisher(emoteSeatOf(get().match) ?? seat, Math.max(Date.now(), (heroPub?.seq ?? 0) + 1));
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
    if (lastRun?.phase === 'recruit' && st.run.phase === 'combat') markFlow(matchId, st.run.wave, 'fight:on');
    lastRun = st.run;
    syncVersusLobby(); // a no-op unless the wave / fight state moved (a fresh run object then re-enters here once)
    maybeEndGate(); // a finished match ends through the end gate once the last fight has been left
    candidates.schedule({ matchId, seat });
    relocks.schedule({ matchId, seat }); // a ready player still playing sends the board again (R-VERSUS-READY-01)
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

/**
 * END TURN IS A READY SIGNAL, IN EVERY VERSUS MODE (owner 2026-10-26: "hitting end turn shouldn't restrict anything, it
 * should just signal that you are ready to move on"; "the end turn ready-signal should be the same for versus modes too";
 * R-VERSUS-READY-01). After End Turn the shop stays fully playable, so the board that
 * fights is whatever my board is when the round actually CLOSES: every change I make while ready goes to the server again
 * as my final side (a re-lock: a newer seq, the seat stays ready). Built exactly as the lock is (`readySideOf`), on a clone,
 * idle, debounced (a drag's several commits are one send), and skipped when nothing in it changed.
 */
let lastRelock: string | null = null;
const relocks = createDeferredWriter<{ matchId: string; seat: VersusSeat }>(({ matchId, seat }) => {
  const match = get().match;
  const run = ownRunWhileWatching() ?? useGame.getState().run; // never the teammate's run on screen
  if (!session || !match || match.id !== matchId || match.phase !== 'shop' || match.paused_at || run.mode !== 'versus'
    || run.phase !== 'recruit' || run.wave !== match.round || get().lockedRound !== match.round) return;
  const ready = readySideOf(run, match, seat);
  if (!ready || ready.checkpoint === lastRelock) return;
  lastRelock = ready.checkpoint;
  const seq = nextSeq();
  void inOrder(() => mx.submit(matchId, match.round, seq, ready.side, true, ready.checkpoint, ready.scout))
    .then((m) => onOwnAnswer(m)).catch(() => undefined);
}, 200);

/** The next submission number for my seat this match (candidates, locks, re-locks and un-readies share one counter). */
function nextSeq(): number {
  if (!session) return 1;
  session.candidateSeq += 1;
  return session.candidateSeq;
}

/** My ready-state calls (End Turn, its re-locks, un-ready) go out ONE AT A TIME in press order, so an un-ready can never
 *  overtake the ready it takes back, or a re-lock the un-ready that ended it (R-VERSUS-READY-01). */
let readyChain: Promise<unknown> = Promise.resolve();
function inOrder<T>(call: () => Promise<T>): Promise<T> {
  const next = readyChain.then(call, call);
  readyChain = next.catch(() => undefined);
  return next;
}

/** My final side for this round, built on a clone with every open decision answered (ruling 7), plus the checkpoint (the
 *  answered run, the reconnect restore point) and my scout. Null when the run cannot end its turn. */
function readySideOf(run: RunState, match: VersusMatch, seat: VersusSeat): { side: PreparedCombatSide; checkpoint: string; scout: VersusSeatScout } | null {
  const answered = versusAutoResolve(structuredClone(run), versusTimeoutRng(Number(match.seed), run.wave, seat));
  const ended = reduce(answered, { type: 'faceOmen', deferFight: true });
  if (!ended.pendingCombatSide) return null;
  return { side: ended.pendingCombatSide, checkpoint: serialize(answered), scout: versusScoutOf(answered) };
}

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
  const watchers = watcherCount(matchId);
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

/** Who may be watching my screen: the stands, every player already out of a group match (R-VERSUS-GROUP-06: they watch
 *  the rest; before the knockout-stands migration their room role is still their seat), and in Duos my teammate, who
 *  always may (R-DUOS-VIEW-01). Zero: nothing is published at all. */
function watcherCount(matchId: string): number {
  const out = new Set(groupRaw && groupRaw.id === matchId ? groupRaw.seats.filter((x) => x.eliminatedRound != null).map((x) => x.userId) : []);
  return (get().room?.members.filter((m) => m.role === 'spectator' || out.has(m.userId)).length ?? 0) + (get().match?.group?.duos ? 1 : 0);
}

/**
 * HERO SELECT, PUBLISHED (owner 2026-10-26: "I want spectating to show up when a player goes into hero select. this should
 * work in all modes"; R-SPECTATE-HEROSELECT-01, and the Duos teammate's choices, R-DUOS-HEROSELECT-01). While my Hero
 * Select is on screen, its state (my three, my re-roll, my pick) goes to the people watching me on the room's channel:
 * on every change (coalesced into one idle publish), and again when a watcher asks. Only while someone may watch; the
 * same cadence rules as the run's frames, no timer of its own. NEVER stored (`versus_spectator_frames` is readable by
 * every member, and my offer is private): a late joiner asks and gets it on my next publish. The other team's or my
 * opponent's client receives the room's broadcast like any member's but never draws it (only the stands and my Duos
 * teammate render frames).
 */
let heroPub: SpectatorPublisher | null = null;
let heroPubFor: string | null = null;
let heroKeyWanted = false;
let heroWatchersSeen = 0;
/**
 * Is my Versus Hero Select on my screen? From the offer until the launch curtain takes it (`startVersusRun`). NOT the
 * match phase: the last pick in ends Hero Select on the server at once, while my screen still plays that pick's ceremony
 * for seconds, and the people watching me must see it (found live 2026-10-26: the last pick never reached the stands).
 */
function myHeroSelectOnScreen(): boolean {
  const g = useGame.getState();
  const m = get().match;
  return g.pendingMode === 'versus' && !!g.heroChoices && !!m && m.phase !== 'complete' && !!mySeat(m);
}
/** My Versus Hero Select as it stands, or null when it is not on my screen. */
export function myVersusHeroFrame(): HeroSelectFrame | null {
  const g = useGame.getState();
  const st = get();
  if (!myHeroSelectOnScreen()) return null;
  return heroSelectFrame({
    offer: g.heroChoices, picked: useOwnHeroPick.getState().heroId, reroll: g.heroReroll,
    canReroll: versusRerollCandidates(st).length > 0, mode: 'versus',
  });
}
const heroFrames = createDeferredWriter<{ matchId: string }>(({ matchId }) => {
  const match = get().match;
  const seat = emoteSeatOf(match);
  if (!session || !match || match.id !== matchId || !seat) return;
  const frame = myVersusHeroFrame();
  const watchers = watcherCount(matchId);
  const arrived = watchers > heroWatchersSeen;
  heroWatchersSeen = watchers;
  if (!frame || watchers === 0) return;
  if (!heroPub || heroPubFor !== matchId || heroPub.seat !== seat) { heroPub = newPublisher(seat); heroPubFor = matchId; }
  const msg = nextHeroSelectMessage(heroPub, frame, heroKeyWanted || arrived);
  heroKeyWanted = false;
  if (!msg) return;
  msg.m = matchId;
  session.channel?.send('spectate', msg);
}, 120);
/** The trigger: my Hero Select's inputs moved (the offer, its re-roll, my pick, the room's stands, the match). */
function watchMyHeroSelect(): () => void {
  let last: unknown[] = [];
  const poke = (): void => {
    const g = useGame.getState();
    const v = get();
    const now = [g.heroChoices, g.heroReroll, g.pendingMode, useOwnHeroPick.getState().heroId, v.match?.phase, v.match?.id, v.room, v.rerollPending, v.rerollOffFor];
    if (now.every((x, i) => x === last[i])) return;
    last = now;
    const m = v.match;
    if (session && m && myHeroSelectOnScreen()) heroFrames.schedule({ matchId: m.id });
  };
  const a = useGame.subscribe(poke);
  const b = useVersus.subscribe(poke);
  const c = useOwnHeroPick.subscribe(poke);
  return () => { a(); b(); c(); };
}

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
  // RANKED DUOS (owner 2026-10-26, R-RANKED-DUOS-GATE-01): 0:00 ends SHOPPING (the lobby's lock), not the turn: re-order,
  // freeze and the teammate view stay open, and the round goes when the server closes it (both ready, R-RANKED-DUOS-GATE-02;
  // a dropped teammate counts as ready; the 30 s AFK backstop). My own run takes the engine lock even while I watch my teammate.
  if (groupRaw && isRankedDuosRaw(groupRaw)) {
    // Watching my teammate: nothing to buy on that screen; my own run takes the lock when I am back (`onTick`).
    if (ownRunWhileWatching()) return;
    const g = useGame.getState();
    if (g.run.mode === 'versus' && g.run.phase === 'recruit' && !g.replaying && !g.run.shopClockExpired) g.dispatch({ type: 'shopClockExpired' });
    return;
  }
  // VERSUS DUOS: 0:00 while I watch my teammate locks MY turn (my run, set aside), never the one on screen; I stay on
  // the view until the fight starts (R-DUOS-VIEW-01).
  // READY: a re-lock still waiting for idle time goes NOW, inside the server's grace (R-VERSUS-READY-01).
  relocks.flush();
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
  const ready = readySideOf(run, match, seat);
  if (!ready) { set({ lockedRound: null }); return; }
  readyPressedAt = Date.now();
  lastRelock = ready.checkpoint;
  markFlow(match.id, match.round, 'ready:sent');
  const seq = nextSeq();
  try {
    await onOwnAnswer(await inOrder(() => mx.submit(match.id, match.round, seq, ready.side, true, ready.checkpoint, ready.scout)));
  } catch (e) {
    // `deadline_passed` / `stale_round` / `already_locked`: the server already has my side for this round (it promoted my
    // newest candidate, or an earlier press got there first). Keep waiting for the fight. Anything else: the lock did not
    // land, so the gem relights and can be pressed again. No notice: the room screen's error line is not on screen in a
    // match, and a "Connection problem" waiting there after the match misled (owner 2026-10-26, a double press).
    const code = (e as VersusError).code;
    if (code !== 'deadline_passed' && code !== 'stale_round' && code !== 'already_locked' && get().lockedRound === match.round) set({ lockedRound: null });
  }
}

/** When this client last pressed End Turn: a second press inside a double-click is the same press, not an un-ready. */
let readyPressedAt = 0;
const DOUBLE_PRESS_MS = 450;

/**
 * TAKE BACK MY END TURN, any Versus mode (R-VERSUS-READY-01; lead reading of the owner's 2026-10-26 ask, confirmed for
 * every mode: "Pressing End Turn again while the clock is above 0:00 un-readies (default)"). Only while the round is open and its clock is above 0:00 (the 0:00 rules stay: from then on
 * the signal stands). Optimistic: the gem relights at once; if the server says the round already closed (or 0:00 came
 * first) I am still ready, and the gem goes back to pressed. True when the press was taken as an un-ready.
 */
export function unreadyTurn(): boolean {
  const match = get().match;
  const seat = mySeat(match);
  const run = ownRunWhileWatching() ?? useGame.getState().run;
  if (!match || !seat || run.mode !== 'versus' || run.phase !== 'recruit' || run.wave !== match.round || get().lockedRound !== match.round) return false;
  if (Date.now() - readyPressedAt < DOUBLE_PRESS_MS) return true; // the second click of a double-click: still the one press
  if (match.phase !== 'shop' || match.paused_at || run.shopClockExpired || !((versusShopRemainingMs(match.shop_deadline) ?? 0) > 0)) return true;
  relocks.cancel();
  lastRelock = null;
  set({ lockedRound: null });
  const seq = nextSeq();
  void inOrder(() => mx.unready(match.id, match.round, seq))
    .then((m) => onMatch(m))
    .catch(() => {
      // The round closed (or the clock hit 0:00) before the un-ready landed: the server still has me ready.
      const m = get().match;
      if (m && m.id === match.id && m.round === match.round && get().lockedRound == null) set({ lockedRound: match.round });
    });
  candidates.schedule({ matchId: match.id, seat });
  return true;
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
  // RANKED DUOS: the team's rating change and medal, as the solo end screen shows them (R-RANKED-DUOS-RATING-01).
  if (match && seat && groupRaw && groupRaw.id === match.id && isRankedDuosRaw(groupRaw)) {
    const mine = groupSeatOf(groupRaw, currentUserId());
    const place = mine?.placement ?? (groupRaw.winner_seat ? 1 : null);
    if (place != null && !groupRaw.unrated) void loadDuosResult(match.id, place, groupRaw.teamName ?? null);
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
      set({ knockout: { matchId: match.id, placement: mine.placement, of: isRankedDuosRaw(groupRaw) ? RANKED_DUOS_TEAM_COUNT : groupRaw.seat_count }, statsOpen: false });
      useSpectate.setState({ optedOut: null });
    }
    void onMatch(ingestGroup(groupRaw));
  }
  void refreshRoom();
}

/** The title's Versus card (and a friend's Versus invite / Watch; `area` 'duos' = a Ranked Duos party invite). */
export function openVersus(area: VersusArea = 'versus'): void {
  // THE SPLIT (R-RANKED-DUOS-SPLIT-01): a room of the OTHER area is never shown here. One still open (nothing started,
  // so leaving costs nothing) is left; a running one is the player's live game and shows in its own area.
  const held = get().room;
  if (held && areaOfRoom(held) !== area) {
    if (held.status === 'open') void leaveRoom();
    else area = areaOfRoom(held);
  }
  set({ screen: get().room ? 'room' : 'browser', error: null, area });
  useGame.getState().setTitleView('versus');
  if (get().room) return;
  if (area === 'versus') void refreshRooms();
  // A returning player (reload, new tab, crash) is still a member server-side: put them straight back in their room,
  // and from there into their running match (live test 2026-10-14: they used to see only "Watch").
  void rejoinMyRoom(area);
}

// ── RANKED DUOS (phase 3): the party ───────────────────────────────────────────────────────────────────────────────
/** The room options of a Ranked Duos party (the live rules: no modifier). */
export const RANKED_DUOS_OPTIONS: VersusRoomOptions = Object.freeze({ v: 1, mode: 'ranked_duos', modifiers: [] }) as VersusRoomOptions;

/** Open a party: a Ranked Duos room with me in the first seat (a party is two players; nobody needs the hand). */
export async function createDuosParty(name: string): Promise<void> {
  try {
    const room = await timed(() => versusRemote.createRoom(name, myIdentity(), RANKED_DUOS_OPTIONS), (r) => r.serverNow);
    enterRoom(room);
  } catch (e) {
    set({ error: errorText(e) });
  }
}

/** THE DUO DOOR (owner 2026-10-26: "a toggle above 'play' that says solo/duo. if duo is selected it then puts you into a
 *  room specific for duo's where you can invite a friend"): Duo + Play lands in MY party. Already in a room (a party I
 *  left the screen of, or a reload): back into it. Otherwise a new party, me in the first seat. */
export async function enterDuosParty(name: string): Promise<void> {
  // THE SPLIT (R-RANKED-DUOS-SPLIT-01): a Versus room I still hold, open (nothing started), is left first; a running
  // Versus game is shown where it belongs instead (never inside the party flow).
  const held = get().room;
  if (held && !isDuosParty(held) && held.status === 'open') await leaveRoom();
  const room = get().room;
  set({ area: room ? areaOfRoom(room) : 'duos', error: null, screen: room ? 'room' : 'browser' });
  useGame.getState().setTitleView('versus');
  if (room) return;
  await rejoinMyRoom('duos');
  if (get().room) return;
  await createDuosParty(name);
}

/**
 * BACK from the party (owner 2026-10-27: "a back button to get back to the play screen" and "you shouldn't lose mmr
 * for leaving that lobby", R-RANKED-DUOS-SPLIT-01): the mode screen, and out of the party. Before its game starts the
 * party is only a waiting room, so leaving it costs nothing (no match exists: no placement, no rating). A game already
 * running is never conceded from here: Back only shows the mode screen.
 */
export async function leaveDuosParty(): Promise<void> {
  const { room, match } = get();
  useGame.getState().setTitleView('modes');
  set({ duosResult: null });
  const role = myRole(room);
  if (room?.status === 'in_game' && role && role !== 'spectator' && match && match.phase !== 'complete') return;
  await leaveRoom();
}

/** The host lists the party publicly (default) or keeps it to friends (owner Q6). */
export async function setFriendsOnly(on: boolean): Promise<void> {
  const room = get().room;
  if (!room) return;
  try {
    set({ room: { ...(await versusRemote.setFriendsOnly(room.id, on)) }, error: null });
  } catch (e) {
    flashError(errorText(e));
    void refreshRoom();
  }
}

/** Name (or, blank, un-name) my team with my partner (R-RANKED-DUOS-NAME-01). Resolves the stored name, or throws the
 *  server's reason (`name_length`, `name_chars`, `name_blocked`, `name_reserved`, `team_in_game`). */
export async function saveTeamName(partner: string, name: string): Promise<string | null> {
  const out = await versusRemote.setTeamName(partner, name);
  return out.name ?? null;
}

/** Read my team's result for a finished Ranked Duos match (once; the server settles it in the round commit). */
export async function loadDuosResult(matchId: string, placement: number, teamName: string | null): Promise<void> {
  set({ duosResult: { matchId, placement, result: null, teamName, pending: true } });
  for (let i = 0; i < 4; i++) {
    const row = await versusRemote.duosResult(matchId).catch(() => null);
    if (get().duosResult?.matchId !== matchId) return;
    if (row) { set({ duosResult: { matchId, placement: row.placement, result: row, teamName, pending: false } }); return; }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  if (get().duosResult?.matchId === matchId) set({ duosResult: { matchId, placement, result: null, teamName, pending: false } });
}

export function closeDuosResult(): void {
  set({ duosResult: null });
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

/** Back into the room this account still holds, when it belongs to `area` (R-RANKED-DUOS-SPLIT-01). One of the other
 *  area is left when it is still open (free, nothing started), or shown in its own area when its game is running. */
async function rejoinMyRoom(area: VersusArea): Promise<void> {
  const me = currentUserId();
  if (!me) return;
  try {
    const roomId = await versusRemote.myRoomId(me);
    if (!roomId || get().room) return;
    const room = await versusRemote.room(roomId);
    if (!room || get().room) return;
    if (areaOfRoom(room) !== area && room.status === 'open') {
      await versusRemote.leaveRoom(room.id).catch(() => undefined);
      return;
    }
    enterRoom(room);
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
