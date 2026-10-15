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
  buildVersusCandidate, catchUpVersusRun, progressionFactsOf, createVersusRun, deserialize, reduce, resetLobbyDrivers, serialize, versusAutoResolve, versusHeroOffer,
  versusLobby, versusLobbyKey, versusScoutOf, versusTimeoutRng, VERSUS_LEASE_SECONDS, type Action, type RunState, type VersusLobbyInput, type VersusSeat,
} from '@game/sim';
import { parseCosmeticSnapshot, type RunCosmeticSnapshot } from '@game/progression';
import type { CombatResult } from '@game/core';
import type { SetId } from '@game/content';
import { versusRunId } from '@game/progression';
import { createDeferredWriter } from '../idleWork';
import { beginRunProgression } from '../progression/progressionStore';
import { currentUserId } from '../identity';
import { currentRunCosmetics, tempHandle, useGame } from '../store';
import { ServerClock } from './versusClock';
import { installVersusEmotes, receiveVersusEmote, uninstallVersusEmotes, VERSUS_EMOTE_EVENT } from './versusEmotes';
import { installVersusHandlers, type VersusFreeze } from './versusHooks';
import { VersusError, versusRemote, type VersusMatch, type VersusPrivate, type VersusRoom, type VersusRoomSummary, type VersusRole, type VersusRoundRow } from './versusRemote';
import { newPublisher, nextSpectatorMessage, type SpectatorPublisher } from './spectatorView';
import { installSpectateIo, receiveSpectate, receiveSpectatorCursor, resetSpectate, SPECTATE_KEY_EVENT, spectateSync } from './spectate';
import { hasPendingActs, setSpectatorTap, SPECTATE_CURSOR_EVENT, tapAct, takeActs } from './spectateTap';
import { cancelRankedGate, requestRankedGate } from '../rankedGate/rankedGateController';
import { pixiFx } from '../pixiFx';
import { goodLuckIntro } from '../goodLuck/goodLuckIntroStore';
import { resumeAudio, stopAllAudio } from '../sfx';
import { buildVersusMatchRecord, type VersusMatchRecord } from './versusMatchRecord';
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
}

export const useVersus = create<VersusState>(() => ({
  screen: 'browser', rooms: [], loading: false, error: null, room: null, match: null, priv: null, heroOffer: null,
  rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null, offsetMs: 0, lastMatch: null, statsOpen: false, pickedFor: null, runReady: false,
}));

const clock = new ServerClock();
const set = (p: Partial<VersusState>): void => useVersus.setState(p);
const get = (): VersusState => useVersus.getState();

/** Human copy for the SQL error codes a player can actually hit (no em dashes, short sentences). */
const ERROR_TEXT: Record<string, string> = {
  not_signed_in: 'Sign in to play Versus.',
  no_backend: 'Versus needs a connection to the game server.',
  already_in_room: 'You are already in a room. Leave it first.',
  room_not_open: 'That room has already started.',
  seats_full: 'Both player seats are taken. You can watch instead.',
  spectators_full: 'The stands are full.',
  version_mismatch: 'That room is on a different game version. Update to join it.',
  seat_taken: 'That seat was just taken.',
  need_two_players: 'You need an opponent to start.',
  not_host: 'Only the host can start the game.',
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

export async function createRoom(name: string): Promise<void> {
  try {
    const room = await timed(() => versusRemote.createRoom(name, myIdentity()), (r) => r.serverNow);
    enterRoom(room);
  } catch (e) {
    set({ error: errorText(e) });
  }
}

export async function joinRoom(roomId: string, as: 'player' | 'spectator'): Promise<void> {
  try {
    const room = await timed(() => versusRemote.joinRoom(roomId, as, myIdentity()), (r) => r.serverNow);
    enterRoom(room);
  } catch (e) {
    set({ error: errorText(e) });
    void refreshRooms();
  }
}

export async function takeSeat(role: VersusRole): Promise<void> {
  const room = get().room;
  if (!room) return;
  try {
    set({ room: await versusRemote.takeSeat(room.id, role), error: null });
  } catch (e) {
    set({ error: errorText(e) });
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
  const room = get().room;
  stopSession();
  set({ room: null, match: null, priv: null, heroOffer: null, rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null, statsOpen: false, screen: 'browser' });
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
  set({ room, screen: 'room', error: null, match: null, priv: null, heroOffer: null, rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null });
  session = { roomId: room.id, matchId: null, channel: null, beat: 0, tick: 0, wake: null, lastFinalize: 0, candidateSeq: 0, publisher: null, unsubRun: null, unsubGates: useVersus.subscribe(driveGates) };
  installSpectateIo({
    latestFrames: (id) => versusRemote.latestFrames(id),
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
  session.channel = versusRemote.subscribeRoom(session.roomId, matchId, (what, row) => {
    // A heartbeat only moves `last_seen_at`: patch it in place instead of re-reading the room (every member beats
    // every 4 s; re-reading on each would cost every client a query per beat).
    if (what === 'members' && row && patchMemberSeen(row)) return;
    scheduleRefresh(what);
  }, (event, payload) => {
    if (event === VERSUS_EMOTE_EVENT) receiveVersusEmote(payload);
    else if (event === 'spectate') { if (!mySeat()) receiveSpectate(payload); }
    else if (event === SPECTATE_CURSOR_EVENT) { if (!mySeat()) receiveSpectatorCursor(payload); }
    // A spectator lost its place: the next deferred publish sends a keyframe (coalesced, never per spectator).
    else if (event === SPECTATE_KEY_EVENT) { if (mySeat() && session?.matchId) { keyWanted = true; frames.schedule({ matchId: session.matchId, forceKey: true }); } }
  });
  // A channel swap mid-match keeps the emote transport on the live channel.
  const seat = mySeat();
  if (seat && useGame.getState().run.mode === 'versus') installVersusEmotes(seat, session.channel.send);
}

function patchMemberSeen(row: Record<string, unknown>): boolean {
  const room = get().room;
  if (!room) return false;
  const i = room.members.findIndex((m) => m.userId === row.user_id);
  if (i < 0 || room.members[i]!.role !== row.role) return false; // a seat change: re-read
  const members = room.members.slice();
  members[i] = { ...members[i]!, lastSeenAt: String(row.last_seen_at ?? members[i]!.lastSeenAt) };
  set({ room: { ...room, members } });
  return true;
}

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
    const match = await versusRemote.match(matchId);
    if (!match) return;
    await onMatch(match);
  } catch { /* transient */ }
}

async function heartbeat(): Promise<void> {
  if (!session) return;
  try {
    const r = await timed(() => versusRemote.heartbeat(session!.roomId), (x) => x.serverNow);
    if (r.match) await onMatch(r.match);
    // Pause detection rides the heartbeat: a running match is reconciled every beat, so an opponent who went
    // silent pauses the clock within a lease plus one beat (live test 2026-10-14: a 12 s modulo window let it slip
    // to ~20 s).
    const m = get().match;
    if (m && mySeat(m) && m.phase !== 'complete' && !m.paused_at) void versusRemote.reconcile(m.id).then((x) => onMatch(x)).catch(() => undefined);
  } catch (e) {
    if ((e as VersusError).code === 'not_a_member') await leaveRoom();
  }
}

/** Every 500 ms: deadlines that passed get reconciled, a resolving round gets finalized, my deadline locks. */
function onTick(): void {
  if (!session) return;
  const { room, match } = get();
  if (room?.status === 'sealed' && (versusRemainingMs(room.gate_deadline) ?? 1) <= 0) void versusRemote.reconcileRoom(room.id).then((r) => set({ room: r })).catch(() => undefined);
  if (!match || match.phase === 'complete') return;
  const due = (iso: string | null): boolean => (versusRemainingMs(iso) ?? 1) <= 0;
  const leaseLate = !!match.paused_at && Date.now() % (VERSUS_LEASE_SECONDS * 1000) < 500; // a paused match re-checks for the return
  if (match.paused_at ? due(match.pause_grace_until) || leaseLate || (!!match.resume_at && due(match.resume_at))
    : (match.phase === 'hero_select' && due(match.hero_deadline)) || (match.phase === 'shop' && due(match.shop_deadline))
      || (match.phase === 'combat' && due(match.combat_deadline)) || leaseLate) {
    void versusRemote.reconcile(match.id).then((m) => onMatch(m)).catch(() => undefined);
  }
  if (match.phase === 'resolving' && Date.now() - session.lastFinalize > 2500) {
    session.lastFinalize = Date.now();
    void versusRemote.finalize(match.id, match.round, match.content_revision).then(() => refreshMatch(match.id)).catch(() => undefined);
  }
  // My shared deadline: lock a beat before the server's, so my own final side (not an older candidate) is used.
  const seat = mySeat(match);
  const run = useGame.getState().run;
  if (seat && match.phase === 'shop' && !match.paused_at && run.mode === 'versus' && run.wave === match.round && get().lockedRound !== match.round
    && (versusRemainingMs(match.shop_deadline) ?? 1e9) <= 400) {
    void lockTurn();
  }
}

// ── the match ──────────────────────────────────────────────────────────────────────────────────────────────

async function onMatch(match: VersusMatch): Promise<void> {
  if (!session) return;
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
  if (roundsOf !== match.id) { roundsOf = match.id; set({ rounds: {} }); }
  const seat = mySeat(match);
  if (!seat) {
    // A SPECTATOR (Versus phase 2): nothing to drive. The committed rounds feed the fights it watches.
    if (match.round > 0) await loadRounds(match);
    spectateSync(match, get().rounds);
    return;
  }

  if (!get().priv || get().priv!.match_id !== match.id) {
    const priv = await versusRemote.myPrivate(match.id).catch(() => null);
    if (priv) {
      const offer = versusHeroOffer(Number(priv.hero_seed), Number(priv.run_seed), match.set_id as SetId);
      set({ priv, heroOffer: offer, rounds: {}, lockedRound: null, readyRound: null, endTurnWave: null });
      if (!priv.hero_offer) void versusRemote.registerOffer(match.id, offer).catch(() => undefined);
    }
  }
  if (match.round > 0) await loadRounds(match);
  if (match.phase === 'complete') settleVersusProgression(match);
  // Back in the room after a reload: the room's last match is still its current one, so "Previous match stats" can
  // be rebuilt from the server rows (the match screen builds it itself on the way out, `returnToRoom`).
  if (match.phase === 'complete' && get().lastMatch?.matchId !== match.id && useGame.getState().run.mode !== 'versus') {
    set({ lastMatch: buildVersusMatchRecord(match, get().rounds, seat, currentRunCosmetics() ?? null, foeCosmeticsOf(match, seat)) });
  }
  if (match.phase !== 'hero_select') ensureRun(match, seat);
  syncVersusLobby();
  driveRun(match, seat);
  maybeEndGate();
}

/** The match the cached `rounds` belong to. */
let roundsOf: string | null = null;

async function loadRounds(match: VersusMatch): Promise<void> {
  const have = get().rounds;
  const known = Object.keys(have).map(Number);
  const from = known.length ? Math.max(...known) + 1 : 1;
  if (from > match.round) return;
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
export function spectatorLobbyFor(seat: VersusSeat, run: RunState): RunState['lobby'] {
  const match = get().match;
  if (!match) return undefined;
  const lobby = versusLobby(lobbyInputFor(match, seat, run));
  resetLobbyDrivers(lobby.seats);
  return lobby;
}

export function syncVersusLobby(): void {
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
    let run: RunState = createVersusRun(Number(priv.run_seed), hero, match.set_id as SetId);
    const ck = await versusRemote.myLatestCheckpoint(match.id).catch(() => null);
    if (ck?.checkpoint) {
      try { run = deserialize(ck.checkpoint); } catch { /* fall back to the fresh run */ }
    }
    run = catchUpVersusRun(run, resultsFor(seat), Number(match.seed), seat);
    if (!run.cosmetics) { const cos = currentRunCosmetics(); if (cos) run.cosmetics = cos; } // my skins, as a lobby run records them
    const present = (): void => {
      lobbyKey = '';
      useGame.getState().startVersusRun(run);
      syncVersusLobby();
      // Reconnected after locking this round: the lock is irreversible, so the shop stays locked.
      const live = get().match ?? match;
      if (live.phase === 'shop' && run.wave === live.round && (seat === 'p1' ? live.p1_locked : live.p2_locked)) set({ lockedRound: live.round });
      startRunWatch(match.id, seat);
      driveRun(get().match ?? match, seat);
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
      void versusRemote.introDone(matchId).then((x) => onMatch(x)).catch(() => undefined);
    };
    if (!goodLuckIntro.isActive()) { send(); return; }
    const off = goodLuckIntro.subscribe(() => { if (!goodLuckIntro.isActive()) { off(); send(); } });
  }, 0);
}

/** React to the server state against the live run: land fights, fast-forward a stale fight, open the shop. */
function driveRun(match: VersusMatch, seat: VersusSeat): void {
  if (endGated.has(match.id)) return;
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
    void versusRemote.combatReady(match.id, match.round).then((m) => onMatch(m)).catch(() => { readySentFor = null; });
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
  session.publisher = newPublisher(seat);
  if (session.channel) installVersusEmotes(seat, session.channel.send);
  installVersusHandlers({
    fightFor: (wave) => {
      const r = get().rounds[wave];
      return r ? ((seat === 'p1' ? r.p1_result : r.p2_result) as CombatResult) : null;
    },
    freeze: (run) => versusFreezeOf(get(), run),
    afterCommit: (action: Action, prev: RunState, next: RunState) => {
      tapAct(action); // the stands replay it (a no-op with nobody watching)
      if (action.type === 'resolveCombat' && prev.phase === 'combat' && next.phase === 'recruit') {
        set({ endTurnWave: null });
        void versusRemote.combatReady(matchId, prev.wave).then((m) => onMatch(m)).catch(() => undefined);
      }
    },
  });
  let lastRun: RunState | null = null;
  session.unsubRun = useGame.subscribe((st) => {
    if (st.run === lastRun || st.run.mode !== 'versus') return;
    const shopOpened = lastRun?.phase !== 'recruit' && st.run.phase === 'recruit';
    lastRun = st.run;
    syncVersusLobby(); // a no-op unless the wave / fight state moved (a fresh run object then re-enters here once)
    maybeEndGate(); // a finished match ends through the end gate once the last fight has been left
    candidates.schedule({ matchId, seat });
    frames.schedule({ matchId, forceKey: shopOpened });
  });
  candidates.schedule({ matchId, seat });
  frames.schedule({ matchId, forceKey: true });
}

const candidates = createDeferredWriter<{ matchId: string; seat: VersusSeat }>(({ matchId, seat }) => {
  const match = get().match;
  const run = useGame.getState().run;
  if (!session || !match || match.id !== matchId || match.phase !== 'shop' || run.mode !== 'versus' || run.phase !== 'recruit'
    || run.wave !== match.round || get().lockedRound === match.round) return;
  const side = buildVersusCandidate(run, versusTimeoutRng(Number(match.seed), run.wave, seat));
  if (!side) return;
  session.candidateSeq += 1;
  void versusRemote.submit(matchId, match.round, session.candidateSeq, side, false, null, versusScoutOf(run)).catch(() => undefined);
}, 600);

/** How many spectators were in the room at the last publish: a new arrival gets a keyframe. */
let watchersSeen = 0;
/** A spectator asked for a keyframe: sticky until the next publish, whatever else was scheduled meanwhile. */
let keyWanted = false;
const frames = createDeferredWriter<{ matchId: string; forceKey: boolean }>(({ matchId, forceKey }) => {
  const pub = session?.publisher;
  const run = useGame.getState().run;
  if (!session || !pub || run.mode !== 'versus') return;
  // No one watching: no projection work at all (a spectator never costs a player anything it does not need).
  const watchers = get().room?.members.filter((m) => m.role === 'spectator').length ?? 0;
  const arrived = watchers > watchersSeen;
  watchersSeen = watchers;
  setSpectatorTap(watchers > 0, mySeat(), session.channel?.send ?? null, () => frames.schedule({ matchId, forceKey: false }));
  if (watchers === 0) return;
  const msg = nextSpectatorMessage(pub, run, run.wave, forceKey || arrived || keyWanted, hasPendingActs());
  keyWanted = false;
  if (!msg) return;
  msg.m = matchId; // the stands drop anything from another match
  const acts = takeActs();
  if (acts.length) msg.acts = acts;
  session.channel?.send('spectate', msg);
  if (msg.kind === 'key') void versusRemote.publishFrame(matchId, msg.seq, msg.round, msg).catch(() => undefined);
}, 250);

/**
 * LOCK this round: End Turn, or the deadline. The final side is built on a clone with every open decision given
 * its random-legal answer (ruling 7); the checkpoint is that answered run (the reconnect restore point).
 * Irreversible on the server. The live run is untouched until the fight is in.
 */
export async function lockTurn(): Promise<void> {
  const match = get().match;
  const seat = mySeat(match);
  const run = useGame.getState().run;
  if (!match || !seat || run.mode !== 'versus' || run.phase !== 'recruit' || run.wave !== match.round || get().lockedRound === match.round) return;
  if (match.paused_at) return; // a paused match takes no End Turn
  set({ lockedRound: match.round });
  const rng = (): ReturnType<typeof versusTimeoutRng> => versusTimeoutRng(Number(match.seed), run.wave, seat);
  const answered = versusAutoResolve(structuredClone(run), rng());
  const ended = reduce(answered, { type: 'faceOmen', deferFight: true });
  if (!ended.pendingCombatSide) { set({ lockedRound: null }); return; }
  try {
    const m = await versusRemote.submit(match.id, match.round, (session?.candidateSeq ?? 0) + 1, ended.pendingCombatSide, true, serialize(answered), versusScoutOf(answered));
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
    await onMatch(await versusRemote.pickHero(match.id, index));
  } catch (e) {
    set({ error: errorText(e) });
  }
}

/** Back from a disconnect: Unpause starts the 3-2-1 for both (`resume_at`); the server resumes the match at it. */
export async function resumeMatch(): Promise<void> {
  const match = get().match;
  if (!match) return;
  try { await onMatch(await versusRemote.requestResume(match.id)); } catch (e) { set({ error: errorText(e) }); }
}

export async function unpauseMatch(): Promise<void> {
  const match = get().match;
  if (!match) return;
  try { await onMatch(await versusRemote.unpause(match.id)); } catch (e) { set({ error: errorText(e) }); }
}

/** CONCEDE (the Esc menu's two-tap): the gate closes at once (owner 2026-10-14), while the server records it. */
export async function forfeitMatch(): Promise<void> {
  const match = get().match;
  if (!match || match.phase === 'complete') return;
  playVersusEndGate(match.id);
  try { await onMatch(await versusRemote.forfeit(match.id)); } catch (e) { set({ error: errorText(e) }); }
}

/** The match ended: back to the room (ruling 10: no rematch room; the room itself lives on). */
export function returnToRoom(): void {
  const { match, rounds } = get();
  const seat = mySeat(match);
  if (match && seat && match.phase === 'complete') {
    const run = useGame.getState().run;
    // The end gate opens on the room with the match's stats already up (owner 2026-10-14).
    set({ lastMatch: buildVersusMatchRecord(match, rounds, seat, run.mode === 'versus' ? run.cosmetics ?? null : null, foeCosmeticsOf(match, seat)), statsOpen: true });
  } else if (match && seat) {
    set({ statsOpen: true }); // conceded at once: the record is built when the server confirms the result (`onMatch`)
  }
  builtFor = null;
  pendingPresent = null;
  lobbyKey = '';
  goodLuckIntro.end();
  uninstallVersusEmotes();
  installVersusHandlers(null);
  session?.unsubRun?.();
  if (session) session.unsubRun = null;
  set({ lockedRound: null, readyRound: null, endTurnWave: null, screen: 'room' });
  useGame.getState().leaveVersusRun();
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
    if (!room || room.status !== 'in_game' || (role !== 'p1' && role !== 'p2')) return;
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
    void versusRemote.combatReady(match.id, run.wave).then((m) => onMatch(m)).catch(() => undefined);
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
  void versusRemote.reconcile(m.id).then((x) => onMatch(x)).catch(() => undefined);
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
  useGame.setState({ showTitle: false, pendingMode: 'versus', heroChoices: [...offer], avatarPickerOpen: false });
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
  const player = role === 'p1' || role === 'p2';
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
  if (!match || i < 0 || get().pickedFor === match.id || get().priv?.hero_index != null) return;
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
