/**
 * VERSUS PHASE 2 — SPECTATING (blueprint 8; owner 2026-10-14: "spectators should be able to change the player they are
 * spectating within a spectator ui"). A spectator watches ONE player's full game screen at a time, rendered by the
 * REAL shop and combat components (Recruit, the board, the hand, the HUD, the opponent block, the clock), fed from the
 * spectator projection (`spectatorView.ts`): both seats' latest views are cached here, so switching between them is
 * instant, with no fetch.
 *
 *  - IN: on a live match (shop onwards) a member with no seat enters the watch screen: the store takes a synthetic run
 *    built from the watched seat's view, and `replaying` is armed, the same render-only mode the replay viewer uses
 *    (every live dispatch is swallowed, the board is inert, nothing persists). A right-click inspect still opens.
 *  - DATA: each seat's keyframe is read from `versus_spectator_frames`; its deltas arrive on the room's broadcast
 *    channel. A sequence gap (or a delta with no base) re-reads the keyframes and asks the players for a fresh one
 *    (`SPECTATE_KEY_EVENT`, coalesced on the player's side into its ordinary deferred publish).
 *  - COMBAT: the watched seat's fight is that seat's own `CombatResult` from the committed round row (rounds are
 *    public), so the arena plays it from that player's side; switching seats in a fight shows it from the other side.
 *  - OUT: the match ending, or Leave, restores the store slice taken on the way in and returns to the room.
 *
 * Renders are coalesced to one per animation frame, and the run object keeps every unchanged field's reference, so a
 * delta re-renders only what it touched. A spectator sends nothing to the players beyond the rare keyframe request.
 */
import { create } from 'zustand';
import type { CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { chooseOneNeedsChoice, resetLobbyDrivers, sellValueWithBonus, type RunState, type VersusSeat } from '@game/sim';
import { presentAction, type ScreenPoint } from '../actionPresenter';
import { playsAsSpell } from '../instView';
import { actionSfx, useGame } from '../store';
import { emitPressCue, type PressCue } from '../pressCue';
import { ghostCardView, holdGhostCard, playableDragPath, releaseGhostHold } from '../replay/replayPlayer';
import type { DragDecision, Zone } from '../dragDecision';
import { NO_DRAG_DECISION } from '../dragDecision';
import { dragStore } from '../dragStore';
import { decodePoint } from './cursorSpace';
import { addPoint, localTimeOf, newRemoteClock, noteDelivery, playbackTime, type PlaybackPoint, type RemoteClock } from './cursorPlayback';
import { setSpectatorHover, watchLocalHover } from './spectatorHover';
import type { CursorSample, SpectatorAct, WireDecision, WireOdds, WireOverlay } from './spectateTap';
import { applySpectatorMessage, newReceiver, type CombatBeat, type SpectatorMessage, type SpectatorReceiver, type VersusSpectatorView } from './spectatorView';
import type { VersusMatch, VersusRoundRow } from './versusRemote';
import { endWatchedGame, startSpectatorBeat, stopSpectatorBeat } from '../live/spectatorEnd';

/** The broadcast event a spectator sends when it needs a fresh keyframe (a gap it could not repair from the table). */
export const SPECTATE_KEY_EVENT = 'spectate_key';

export interface SpectateState {
  /** On the watch screen. */
  active: boolean;
  /** Whose screen is shown. */
  seat: VersusSeat;
  /** The spectator chose to step back to the room for this match (no auto re-entry until they press Watch). */
  optedOut: string | null;
  /** The watched player's name when the screen's own lobby does not carry it (a live ranked lobby game: seat s0 is
   *  labelled for its owner, not by name). */
  name?: string | null;
  /** Seek the fight on screen to the watched player's beat (a late joiner catching up, R-SPECTATE-JOIN-01); `n`
   *  bumps per request, so the same beat can be asked twice. Recruit performs it. */
  seek?: { wave: number; beat: number; n: number } | null;
  /** The watched player skipped the fight of `wave` (R-SPECTATE-SKIP-01); `n` bumps per request. Recruit performs it
   *  once that fight is playing on this screen. */
  skip?: { wave: number; n: number } | null;
  /** Each watched player's own odds for the fight they are in (`spectateTap.tapOdds`): the Summary's numbers. */
  odds?: Partial<Record<VersusSeat, WireOdds>>;
  /** Each watched player's minimized shop overlays (`spectateTap.tapOverlay`); absent = an older player: all open. */
  overlay?: Partial<Record<VersusSeat, WireOverlay>>;
}

export const useSpectate = create<SpectateState>(() => ({ active: false, seat: 'p1', optedOut: null, seek: null }));

interface Io {
  latestFrames(matchId: string): Promise<{ seat: VersusSeat; frame: unknown }[]>;
  requestKey(): void;
  loadRounds(): void;
  /** The two-seat lobby from a seat's side, for a view that carries none (a test bot's). */
  lobbyFor(seat: VersusSeat, run: RunState): RunState['lobby'];
  /** Where Leave and the end return to (default: the Versus room). The live ranked-lobby viewer returns to its list. */
  returnTo?(): Partial<ReturnType<typeof useGame.getState>>;
}

let io: Io | null = null;
let matchId: string | null = null;
let rx: Record<VersusSeat, SpectatorReceiver> = { p1: newReceiver(), p2: newReceiver() };
let rounds: Record<number, VersusRoundRow> = {};
let fetching = false;
let lastKeyAsk = 0;
let raf = 0;
let unsubDone: (() => void) | null = null;
let lobbyCache: { key: string; lobby: RunState['lobby'] } | null = null;
let last: { view: VersusSpectatorView; fight: unknown; seat: VersusSeat; run: RunState } | null = null;
/** The store slice replaced on the way in, restored on the way out. */
let snapshot: Partial<ReturnType<typeof useGame.getState>> | null = null;
const SNAPSHOT_KEYS = ['run', 'showTitle', 'heroChoices', 'inspect', 'heroArmed', 'equipArmed', 'replaying', 'titleView'] as const;

export function installSpectateIo(next: Io | null): void { io = next; }

/** The synthetic run for a seat's view (RunState-shaped, render-only; see `synthRunFromShopView`). */
export function spectatorRunOf(view: VersusSpectatorView, seat: VersusSeat, id: string, round: VersusRoundRow | undefined): RunState | null {
  const base = {
    ...view,
    seed: 0,
    runId: `spectate:${id}:${seat}`,
    pool: {},
    pendingTavern: [],
    rngCursor: 0,
    runDamage: {},
    runProcs: {},
  } as unknown as RunState;
  // A LIVE RANKED LOBBY game's own seat is labelled "You" (for its player): the watch screen names the WATCHED player
  // there instead (the rail, the recaps). Cached per lobby object, so an unchanged lobby keeps its reference.
  const named = useSpectate.getState().name;
  if (named && view.lobby) (base as { lobby?: RunState['lobby'] }).lobby = watchedLobby(view.lobby as NonNullable<RunState['lobby']>, named);
  // The game's own end screen is never drawn for a spectator (its buttons act on the store): the last frame holds and
  // the watch chrome shows the placement instead (live/LiveWatchBar).
  if (view.phase === 'gameover' || view.phase === 'victory') return null;
  // A LIVE RANKED LOBBY view carries its own fight (lobby combat is computed on the player's client, `msg.fight`); it
  // shows only while the view is in that fight.
  if (view.phase !== 'combat') {
    if (!('lastCombat' in base)) return base;
    const { lastCombat: _drop, ...rest } = base as RunState & { lastCombat?: unknown };
    void _drop;
    return rest as RunState;
  }
  if (base.lastCombat) return base;
  const fight = round ? ((seat === 'p1' ? round.p1_result : round.p2_result) as CombatResult | null) : null;
  return fight ? { ...base, lastCombat: fight } : null; // the round row is not here yet: hold the previous frame
}

let watchedLobbies = new WeakMap<NonNullable<RunState['lobby']>, { name: string; lobby: NonNullable<RunState['lobby']> }>();

/**
 * The watched game's RECORDED SEATS just became resolvable (`live/liveWatch.ts` fetched their recordings,
 * R-SPECTATE-SEATS-01): the lobby on screen is re-issued as a new object, so the rail (memoised on it) and the opponent
 * preview re-read the seats' real boards. Mid-fight only the cache is dropped: the next view change re-issues it, and
 * the fight on screen is never rebuilt under the player.
 */
export function refreshSpectatorSeats(): void {
  watchedLobbies = new WeakMap();
  if (useGame.getState().run.phase === 'combat') return;
  last = null;
  schedule();
}
/** The lobby with its own seat (`s0`) labelled by the watched player's name. */
function watchedLobby(lobby: NonNullable<RunState['lobby']>, name: string): NonNullable<RunState['lobby']> {
  const hit = watchedLobbies.get(lobby);
  if (hit && hit.name === name) return hit.lobby;
  const out = { ...lobby, seats: lobby.seats.map((seat) => (seat.id === 's0' ? { ...seat, label: name } : seat)) };
  watchedLobbies.set(lobby, { name, lobby: out });
  return out;
}

/** Live match state from the session: enter, keep, or leave the watch screen. Only ever called for a seatless member. */
export function spectateSync(match: VersusMatch | null, allRounds: Record<number, VersusRoundRow>): void {
  rounds = allRounds;
  const live = !!match && (match.phase === 'shop' || match.phase === 'resolving' || match.phase === 'combat');
  // THE MATCH ENDED while this spectator watched it (owner 2026-10-24, R-SPECTATE-END-01): the screen plays the last fight
  // out, then the end gate shuts over it and opens on the room with the result and the XP for watching it.
  if (match && match.phase === 'complete' && match.id === matchId && useSpectate.getState().active && useSpectate.getState().optedOut !== match.id) {
    watchEnded(match);
    return;
  }
  if (!match || !live) { stopSpectatorBeat(); if (useSpectate.getState().active) stopSpectating(); return; }
  if (matchId !== match.id) {
    // A NEW MATCH in the room: nothing of the last one survives (views, queue, cursor, caches).
    if (useSpectate.getState().active) stopSpectating();
    matchId = match.id;
    rx = { p1: newReceiver(), p2: newReceiver() };
    lobbyCache = null;
    last = null;
    resumeAt = null;
    rounds = allRounds;
    useSpectate.setState({ odds: {}, overlay: {} });
    endWatch = null;
    void fetchKeyframes();
  }
  if (useSpectate.getState().optedOut === match.id) { stopSpectatorBeat(); return; }
  // The watch record for the XP of watching it to the end (R-PROG-SPECTATE-XP-01): beats while this screen is the one on.
  startSpectatorBeat('versus', match.id);
  schedule();
}

/** A finished match still on the watch screen, waiting for its last fight to play out. */
let endWatch: { match: VersusMatch; at: number; timer: number | null } | null = null;
/** The fight the screen last played to its end (its strike included): `${matchId}|${wave}`. */
let fightShown: string | null = null;
/** The longest the screen waits for the last fight before the end gate closes anyway (a fight is capped at 90 s). */
export const VERSUS_END_HOLD_MAX_MS = 60_000;

function watchEnded(match: VersusMatch): void {
  if (endWatch?.match.id === match.id) { endWatch.match = match; maybeEndWatch(); return; }
  endWatch = { match, at: Date.now(), timer: window.setTimeout(() => maybeEndWatch(), VERSUS_END_HOLD_MAX_MS) };
  schedule();
  maybeEndWatch();
}

/**
 * Close the end gate once the player's last fight has played out on this screen: at once when the match ended without
 * one (a concede, missed rounds, abandoned), else when the screen finished the final round's fight and its strike, or
 * at the latest `VERSUS_END_HOLD_MAX_MS` after the end. The doors open on the room (the place this screen came from)
 * with the watched player's result and the XP for watching (`live/spectatorEnd.ts`).
 */
function maybeEndWatch(): void {
  const e = endWatch;
  if (!e) return;
  const m = e.match;
  const lastFightShown = m.end_reason !== 'hearts' || fightShown === `${m.id}|${m.round}` || Date.now() - e.at >= VERSUS_END_HOLD_MAX_MS;
  if (!lastFightShown) return;
  if (e.timer != null) window.clearTimeout(e.timer);
  endWatch = null;
  const seat = useSpectate.getState().seat;
  const name = seat === 'p1' ? m.p1_name : m.p2_name;
  const placement = m.winner_seat ? (m.winner_seat === seat ? 1 : 2) : null;
  void endWatchedGame({ kind: 'versus', target: m.id, name, placement, leave: () => stopSpectating() });
}

/**
 * LIVE RANKED LOBBY GAMES (owner-approved 2026-10-15): watch ONE player's ranked lobby game with this same screen. The
 * game id stands in for the match id; the player's fight rides its messages (`msg.fight`); there is one seat (p1).
 * Null leaves. The caller installs the IO (keyframe read, key request, where Leave returns to).
 */
export function liveSync(gameId: string | null): void {
  if (!gameId) { if (useSpectate.getState().active) stopSpectating(); matchId = null; return; }
  if (matchId !== gameId) {
    if (useSpectate.getState().active) stopSpectating();
    matchId = gameId;
    rx = { p1: newReceiver(), p2: newReceiver() };
    lobbyCache = null;
    last = null;
    resumeAt = null;
    rounds = {};
    useSpectate.setState({ seat: 'p1', optedOut: null, odds: {}, overlay: {} });
    void fetchKeyframes();
  }
  schedule();
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A player's odds as they travel (`od`), validated; null when malformed. Pure. */
export function parseWireOdds(v: unknown): WireOdds | null {
  const p = v as { w?: unknown; o?: Record<string, unknown> } | null;
  const o = p?.o;
  if (!p || !finite(p.w) || !o || typeof o !== 'object') return null;
  if (![o.win, o.draw, o.lose, o.avgLossDamage].every(finite)) return null;
  const range = Array.isArray(o.lossDamageRange) && o.lossDamageRange.length === 2 && o.lossDamageRange.every(finite) ? (o.lossDamageRange as [number, number]) : undefined;
  return {
    w: p.w,
    o: {
      win: o.win as number, draw: o.draw as number, lose: o.lose as number, avgLossDamage: o.avgLossDamage as number,
      ...(range ? { lossDamageRange: range } : {}),
      ...(finite(o.avgWinDamage) ? { avgWinDamage: o.avgWinDamage } : {}),
    },
  };
}

const overlayKey = (o: WireOverlay | undefined): string => (o ? `${o.d ?? 0}${o.p ?? 0}${o.q ?? 0}${o.f ?? 0}` : '');
/** A player's minimized overlays as they travel (`ov`), validated; null when absent or malformed. Pure. */
export function parseWireOverlay(v: unknown): WireOverlay | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: WireOverlay = {};
  for (const k of ['d', 'p', 'q', 'f'] as const) if (o[k] === 1) out[k] = 1;
  return out;
}

/** The overlays a watched player's state minimizes (the spectator's screen applies exactly these). Pure. */
export function overlayMinOf(o: WireOverlay): { discover: boolean; power: boolean; quest: boolean; forge: boolean } {
  return { discover: o.d === 1, power: o.p === 1, quest: o.q === 1, forge: o.f === 1 };
}

/** A broadcast frame from a player. */
export function receiveSpectate(payload: unknown): void {
  const msg = payload as SpectatorMessage;
  if (!msg || (msg.seat !== 'p1' && msg.seat !== 'p2') || typeof msg.seq !== 'number') return;
  if (!matchId || (msg.m && msg.m !== matchId)) return; // another match's frame (a room hosts match after match)
  const prevView = rx[msg.seat].view;
  const applied = applySpectatorMessage(rx[msg.seat], msg);
  const { needKeyframe } = applied;
  let next = applied.rx;
  // A live ranked lobby game's fight rides the message (the view never carries the heavy result itself).
  // The SAME fight arriving again (a later keyframe) keeps the object on screen, so the arena never restarts its replay.
  if (msg.fight && next.view) next = { ...next, view: { ...next.view, lastCombat: sameFight(rx[msg.seat].view, msg.fight) } };
  rx[msg.seat] = next;
  // The player's own odds for this fight (their probe's result): the stands' Summary shows exactly these.
  const od = parseWireOdds(msg.od);
  if (od) { const cur = useSpectate.getState().odds ?? {}; if (cur[msg.seat]?.w !== od.w || cur[msg.seat]?.o.win !== od.o.win) useSpectate.setState({ odds: { ...cur, [msg.seat]: od } }); }
  // Which shop overlays the player has minimized: the stands minimize and restore with them (R-SPECTATE-OVERLAY-01).
  const ov = parseWireOverlay(msg.ov);
  if (ov) { const cur = useSpectate.getState().overlay ?? {}; if (overlayKey(cur[msg.seat]) !== overlayKey(ov)) useSpectate.setState({ overlay: { ...cur, [msg.seat]: ov } }); }
  // Where the watched player's fight is (a broadcast keyframe while it plays): catch the screen up to it.
  if (msg.cb && msg.seat === useSpectate.getState().seat) syncFightBeat(msg.cb);
  if (needKeyframe) { askForKey(); void fetchKeyframes(); return; }
  if (msg.seat !== useSpectate.getState().seat) return;
  // The watched player's ACTIONS: their screen moves one action at a time, each with the animation and cue the
  // player saw (`playActs`). A message with no actions just renders (coalesced).
  if (msg.acts?.length || queue.length || busy) {
    queue.push({ view: next.view!, acts: msg.acts ?? [], before: prevView });
    pump();
  } else schedule();
}

// ── the watched player's actions, replayed in order ────────────────────────────────────────────────────────

/** `before`: the view the message applied to (what the screen showed before these actions). */
interface Pending { view: VersusSpectatorView; acts: SpectatorAct[]; before?: VersusSpectatorView | null }
let queue: Pending[] = [];
/** The view on screen while the queue plays (null: the latest received). */
let shownView: VersusSpectatorView | null = null;
let busy: number | null = null;
let ghostKey = 0;
/** A drag flight is at most this long (the player's real drag duration, capped), halved when behind. */
const MAX_FLIGHT_MS = 900;
/** The pause between two queued actions. */
const ACT_GAP_MS = 60;
/** Queued actions past this many are compressed: they land without a flight, so the screen never falls behind. */
const BEHIND = 2;
/** The longest an action waits for the drawn hand to reach it. */
const MAX_LAND_WAIT_MS = 400;
/** The drag-drop FLIP a landing action primes, by action (the player's own `onUp` decides the same from its drop). */
const DROP_OF: Partial<Record<string, 'place' | 'reposition' | 'reorderShop' | 'sell' | 'buy'>> = {
  play: 'place', reposition: 'reposition', reorderShop: 'reorderShop', sell: 'sell', buy: 'buy',
};

/** Waiting for the screen to leave the fight before the queued shop actions play (`pump`). */
let awaitingShop = false;

/** The press cue a button action replays (its own press visual, `pressCue.ts`). */
const PRESS: Partial<Record<string, PressCue>> = { roll: 'refresh', freeze: 'freeze', upgrade: 'upgrade', heroPower: 'heroPower', endTurn: 'endTurn' };

/** The fight on screen when `fight` is the same one (a later keyframe of the same live lobby fight), else `fight`. */
function sameFight(view: VersusSpectatorView | null, fight: unknown): unknown {
  const cur = (view as { lastCombat?: unknown } | null)?.lastCombat;
  if (!cur || cur === fight) return fight;
  try { return JSON.stringify(cur) === JSON.stringify(fight) ? cur : fight; } catch { return fight; }
}

/** Where the player let go of the card (the drag path's last point, in screen px), when the action was dragged. */
function releasePoint(a: SpectatorAct): ScreenPoint | null {
  const d = playableDragPath(a.drag);
  const last = d?.pts[d.pts.length - 1];
  return last ? { x: last[0] * window.innerWidth, y: last[1] * window.innerHeight } : null;
}
/** A card's centre on screen right now, by uid. */
function centreOf(uid: string | undefined): ScreenPoint | null {
  const el = uid ? document.querySelector<HTMLElement>(`[data-uid="${uid}"]`) : null;
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}
const screenCentre = (): ScreenPoint => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

/** What the player's input presented BEFORE its dispatch (`actionPresenter.ts`), on the screen as it still stands.
 *  Returns what the after-commit presentation needs (the card as it was, where it was let go). */
function presentBefore(a: SpectatorAct, prevRun: RunState): { at: ScreenPoint | null; card?: RunState['hand'][number] } {
  if (a.t === 'play') {
    const card = prevRun.hand.find((c) => c.uid === a.uid);
    const def = card ? CARD_INDEX[card.cardId] : undefined;
    if (card && def && !playsAsSpell(def) && !def.ruby) presentAction({ kind: 'placing', uid: card.uid });
    return { at: releasePoint(a) ?? centreOf(a.uid), ...(card ? { card } : {}) };
  }
  if (a.t === 'sell') {
    const card = prevRun.board.find((c) => c.uid === a.uid);
    const at = releasePoint(a) ?? centreOf(a.uid) ?? screenCentre();
    if (card) presentAction({ kind: 'sold', at, amount: sellValueWithBonus(card, prevRun) });
    return { at };
  }
  return { at: null };
}

/** What the player's input presented AFTER its dispatch. */
function presentAfter(a: SpectatorAct, prevRun: RunState, pre: ReturnType<typeof presentBefore>, plate: DOMRect | null): void {
  if (a.t === 'reposition' && a.uid) { presentAction({ kind: 'repositioned', uid: a.uid }); return; }
  if (a.t !== 'play' || !pre.card) return;
  const card = pre.card;
  const def = CARD_INDEX[card.cardId];
  if (!def) return;
  if (!playsAsSpell(def) && !def.ruby) { presentAction({ kind: 'played', uid: card.uid, plate }); return; }
  presentAction({
    kind: 'cast', cardId: card.cardId, at: pre.at ?? screenCentre(), card,
    ...(a.targetUid ? { targetUid: a.targetUid } : { asksFirst: chooseOneNeedsChoice(prevRun, card, def) }),
  });
}

/** The recorded End of Turn the watched player's screen is playing: the SAME player Recruit runs for a replay
 *  (`replayEotCue`), over the shop on screen; resolves when it reports done (or the safety net). */
const EOT_SAFETY_MS = 20_000;
let eotKey = 1_000_000; // apart from the replay viewer's keys (Recruit plays a cue key once)
let eotUnsub: (() => void) | null = null;
function playEot(eot: NonNullable<SpectatorAct['eot']>, done: () => void): void {
  eotKey += 1;
  const key = eotKey;
  const finish = (): void => {
    eotUnsub?.();
    eotUnsub = null;
    if (busy != null) { window.clearTimeout(busy); busy = null; }
    if (useGame.getState().replayEotCue?.key === key) useGame.setState({ replayEotCue: null });
    done();
  };
  eotUnsub = useGame.subscribe((st) => { if (st.replayEotDone === key) finish(); });
  busy = window.setTimeout(finish, EOT_SAFETY_MS);
  useGame.setState({ replayEotCue: { key, eot: { batch: eot.batch, atMs: 0, ...(eot.lassoFx ? { lassoFx: eot.lassoFx } : {}) } as never, speed: 1, hold: true } });
}

function pump(): void {
  if (busy != null || awaitingShop) return;
  const item = queue.shift();
  if (!item) { shownView = null; schedule(); return; }
  // THE PLAYER IS BACK IN THE SHOP while this screen still shows the fight (they skipped it, or this screen is behind):
  // the screen leaves the fight FIRST (the exit curtain, then the shop as it stood before these actions), and only then
  // plays them, on the shop they were made in (R-SPECTATE-SKIP-01). Never a shop action presented over a fight.
  if (useGame.getState().run.phase === 'combat' && item.view.phase === 'recruit') {
    queue.unshift(item);
    awaitingShop = true;
    shownView = item.before?.phase === 'recruit' ? item.before : item.view;
    render();
    if (awaitingShop && useGame.getState().run.phase !== 'combat') { awaitingShop = false; pump(); }
    return;
  }
  // ON THE HAND'S CLOCK (R-SPECTATE-SMOOTH-01): an action lands when the drawn hand reaches the moment it happened on
  // the player's screen, not when its message arrived (which is usually before the hand gets there). Capped, and only
  // while the screen is not behind.
  const due = queue.length < BEHIND ? cursorDueAt(item.acts.find((a) => typeof a.ts === 'number')?.ts) : null;
  const wait = due === null ? 0 : Math.min(MAX_LAND_WAIT_MS, due - performance.now());
  if (wait > 4) {
    queue.unshift(item);
    busy = window.setTimeout(() => { busy = null; pump(); }, wait);
    return;
  }
  const prevRun = useGame.getState().run;
  const behind = queue.length >= BEHIND;
  const flight = behind ? null : item.acts.find((a) => a.drag && playableDragPath(a.drag) && !(a.uid && liveDragShown(a.uid)));
  if (flight?.drag) {
    // The card flies the player's own drag path over the screen as it was, then lands (the replay viewer's ghost).
    const drag = flight.drag;
    const view = ghostCardView(prevRun as never, drag.cardId, drag.uid);
    const durMs = Math.min(drag.durMs, MAX_FLIGHT_MS) / (queue.length ? 2 : 1);
    ghostKey += 1;
    presentAction({ kind: 'touch' }); // the pick-up, as the player's press on the card sounded it
    useGame.setState({ replayDragGhost: { ...drag, durMs, key: ghostKey, view, ...(flight.t === 'play' ? { fromHand: true } : {}) } });
    holdGhostCard(prevRun as never, item.view as never, flight.t as never, drag, view);
    busy = window.setTimeout(() => land(item, prevRun), durMs);
    return;
  }
  land(item, prevRun);
}

/**
 * THE LIVE DROP (R-SPECTATE-SMOOTH-01): the card the watched hand is holding (or parked where it was let go) is the one
 * this action moved. The rows are snapshotted with its gap still open and the card slides home from where it is,
 * exactly as the player's own drop does, so the board settles once instead of closing the gap and re-opening it. Call
 * it BEFORE the next view renders. Shared by the watch screen (`land`) and the replay viewer, which plays a recorded
 * stream through this same feed (R-REPLAY-PLAYBACK-01). Returns true when a drop was presented.
 */
export function presentHeldDrop(acts: readonly { t: string; uid?: string }[], prevRun: RunState, nextView: { hand?: { uid: string }[]; triplesMade?: number }): boolean {
  for (const a of acts) {
    if (!a.uid) continue;
    const held = takeLanding(a.uid);
    const drop = DROP_OF[a.t];
    if (!held || !drop) continue;
    const card = a.t === 'play' ? prevRun.hand.find((c) => c.uid === a.uid) : undefined;
    const def = card ? CARD_INDEX[card.cardId] : undefined;
    if (a.t === 'play' && (!def || playsAsSpell(def) || def.ruby)) continue; // a spell is cast, not placed
    // A buy's hand copy is a new uid: the one card the next hand has that this one lacked (none if a triple took it).
    const nextHand = nextView.hand ?? [];
    const bought = drop === 'buy' && nextView.triplesMade === prevRun.triplesMade
      ? nextHand.filter((c) => !prevRun.hand.some((h) => h.uid === c.uid)) : [];
    presentAction({ kind: 'dropping', uid: a.uid, drop, from: held.rect, ...(bought.length === 1 ? { boughtUid: bought[0]!.uid } : {}) });
    return true;
  }
  return false;
}

function land(item: Pending, prevRun: RunState): void {
  // The card in the hand that let go of it (the flight's ghost, or the live drag's): where its plate dissolves from.
  const plate = document.querySelector<HTMLElement>('.replay-dragghost .ghostcardwrap .card')?.getBoundingClientRect() ?? null;
  presentHeldDrop(item.acts, prevRun, item.view as { hand?: { uid: string }[]; triplesMade?: number });
  // ONE ACTION, ONE PRESENTATION (`actionPresenter.ts`): what the player's input showed before its dispatch...
  const pre = item.acts.map((a) => presentBefore(a, prevRun));
  releaseGhostHold();
  if (useGame.getState().replayDragGhost) useGame.setState({ replayDragGhost: null });
  shownView = item.view;
  render();
  const nextRun = useGame.getState().run;
  let eot: SpectatorAct['eot'] | null = null;
  item.acts.forEach((a, i) => {
    // The fight's Skip (R-SPECTATE-SKIP-01): this screen's replay skips with the player's. Recruit performs the request
    // once that fight is actually playing here (a Skip that lands during the entrance waits), and not once it is done.
    if (a.t === 'skipCombat') {
      if (item.view.phase === 'combat') { seekSeq += 1; useSpectate.setState({ skip: { wave: item.view.wave, n: seekSeq } }); }
      return;
    }
    const cue = PRESS[a.t];
    if (cue) emitPressCue(cue);
    if (a.t !== 'heroPower' && a.t !== 'endTurn') { try { actionSfx({ type: a.t, ...(a.uid ? { uid: a.uid } : {}), ...(a.index != null ? { index: a.index } : {}) } as never, prevRun, nextRun); } catch { /* a cue never breaks the view */ } }
    presentAfter(a, prevRun, pre[i]!, plate); // ...and after it
    if (a.t === 'endTurn' && a.eot) eot = a.eot;
  });
  // End Turn: its beats play over the shop exactly as the player's screen played them, then the queue goes on (the
  // fight arrives behind them). Skipped when far behind (the screen catches up instead).
  if (eot && queue.length < 4) { playEot(eot, () => pump()); return; }
  busy = window.setTimeout(() => { busy = null; pump(); }, item.acts.length ? ACT_GAP_MS : 0);
}

/** Drop whatever is queued or flying (a seat switch, Leave): the screen jumps to the latest view. */
function clearQueue(): void {
  if (busy != null) { window.clearTimeout(busy); busy = null; }
  eotUnsub?.();
  eotUnsub = null;
  if (useGame.getState().replayEotCue) useGame.setState({ replayEotCue: null });
  queue = [];
  shownView = null;
  awaitingShop = false;
  releaseGhostHold();
  if (useGame.getState().replayDragGhost) useGame.setState({ replayDragGhost: null });
}

// ── the watched player's cursor ────────────────────────────────────────────────────────────────────────────

/** A cursor sample landed on THIS screen (screen px, `cursorSpace.decodePoint`). Kept for the older wire's tests. */
export interface CursorPoint { t: number; x: number; y: number }
/** The player's live aim line, landed on this screen (screen px). */
export interface CursorAim { x: number; y: number; on: boolean; def?: string; end?: { x: number; y: number } | null }
/** The card in the player's hand, and (R-SPECTATE-DRAGGAP-01) the drop gap their rows open for it right now. */
export interface CursorDrag { uid: string; source: string; cardId: string; overZone: Zone | null; decision: DragDecision }

/**
 * One message's STATE, stamped on the player's clock and applied when playback reaches it (R-SPECTATE-SMOOTH-01): the
 * card in hand, the aim, the hovered element and a drop all happen as the drawn hand gets there, not ~100 ms early.
 */
interface FeedState {
  s: number;
  hidden: boolean;
  drag: CursorDrag | null;
  aim: CursorAim | null;
  aimT: string | null;
  hover: string | null;
  de?: 'c' | 'x';
}

/**
 * The live cursor the overlay draws (`SpectatorCursor`): the points (on the PLAYER's clock, or the arrival clock for an
 * older player that sends none), the clock that maps them, the state applied so far, and the held card's afterlife:
 * `landing` = a committed drop parked where it was let go until its action lands (`takeLanding`), `spring` = a refused
 * or cancelled drop flying back to its slot.
 */
export const cursorFeed: {
  pts: PlaybackPoint[];
  clock: RemoteClock;
  /** The sender stamps nothing (an older client): points are stamped on arrival and drawn a fixed buffer behind. */
  legacy: boolean;
  pending: FeedState[];
  drag: CursorDrag | null;
  aim: CursorAim | null;
  hidden: boolean;
  landing: { drag: CursorDrag; until: number } | null;
  spring: CursorDrag | null;
  /** Arrival time of the newest message (the overlay stops its loop when the hand goes quiet). */
  lastAt: number;
  version: number;
} = { pts: [], clock: newRemoteClock(), legacy: true, pending: [], drag: null, aim: null, hidden: true, landing: null, spring: null, lastAt: -1e9, version: 0 };
/** A committed drop waits this long at most for its action (a lost message must never strand the card mid-air). */
export const LAND_WAIT_MS = 1200;
/** An older player's points are drawn this far behind their arrival (the pre-2026-10-20 behaviour). */
export const LEGACY_BUFFER_MS = 100;
const dragSeen = new Map<string, number>();
const liveDragShown = (uid: string): boolean => performance.now() - (dragSeen.get(uid) ?? -1e9) < 2500;
const cursorListeners = new Set<() => void>();
export function onCursorFeed(fn: () => void): () => void { cursorListeners.add(fn); return () => { cursorListeners.delete(fn); }; }
const notifyCursor = (): void => { cursorFeed.version += 1; for (const fn of cursorListeners) fn(); };

/**
 * THE REPLAY'S CLOCK (R-REPLAY-PLAYBACK-01): a replay plays its recorded stream through this same feed, on the replay
 * frames' clock instead of a network clock. While set, the hand is drawn at `feedClock(now)` (the recorded messages
 * carry that clock), and no delivery jitter is measured: recorded data has none.
 */
let feedClock: ((now: number) => number) | null = null;
/** Whether a pick-up plays its touch sound (a replay's Sounds toggle; always on the watch screen). */
let pickupSound: () => boolean = () => true;
export function setCursorFeedClock(clock: ((now: number) => number) | null, sound?: () => boolean): void {
  feedClock = clock;
  pickupSound = clock && sound ? sound : () => true;
}

/** The PLAYER-clock moment the hand is drawn at, local time `now`. */
export function cursorPlayback(now: number): number {
  if (feedClock) return feedClock(now);
  return cursorFeed.legacy ? now - LEGACY_BUFFER_MS : playbackTime(cursorFeed.clock, now);
}

/** A cursor sample from a player (only the watched player's is drawn). */
export function receiveSpectatorCursor(payload: unknown): void {
  const c = payload as CursorSample;
  if (!c || c.seat !== useSpectate.getState().seat || !useSpectate.getState().active) return;
  ingestCursor(c, performance.now());
}

/**
 * One cursor message into the feed: its points land on THIS screen and its state waits for playback to reach it. The
 * watch screen calls it per received message; the replay viewer per recorded message (R-REPLAY-PLAYBACK-01), the same
 * message the live sender built (`cursorSource.ts`). `atOnce`: apply the state now, with no pick-up cue and no drop
 * verdict (a replay seek rebuilding the hand at its target, never replaying a pick-up or a drop).
 */
export function ingestCursor(c: Omit<CursorSample, 'seat' | 'x' | 'y'> & { x?: number; y?: number }, now: number, atOnce = false): void {
  const stamped = typeof c.ts === 'number' && Number.isFinite(c.ts);
  if (stamped !== !cursorFeed.legacy) { cursorFeed.legacy = !stamped; cursorFeed.pts = []; cursorFeed.clock = newRemoteClock(); }
  if (stamped && !feedClock) noteDelivery(cursorFeed.clock, c.ts!, now);
  const s = stamped ? c.ts! : now;
  cursorFeed.lastAt = now;
  // Landed on THIS screen: on the same element, else the same spot of the game box (R-SPECTATE-CURSOR-01). One rect
  // read per anchor per message, shared by its points.
  const rects = new Map<string, DOMRect | null>();
  let aim: CursorAim | null = null;
  if (!c.hide) {
    for (const t of c.tr ?? []) {
      if (!Array.isArray(t) || typeof t[0] !== 'number') continue;
      const at = decodePoint({ x: 0, y: 0, gx: t[1], gy: t[2], ...(typeof t[3] === 'string' ? { an: { k: t[3], fx: t[4] as number, fy: t[5] as number } } : {}) }, document, rects);
      addPoint(cursorFeed.pts, { s: s - t[0], x: at.x, y: at.y });
    }
    const at = decodePoint({ x: c.x ?? 0, y: c.y ?? 0, gx: c.gx, gy: c.gy, an: c.an }, document, rects);
    addPoint(cursorFeed.pts, { s, x: at.x, y: at.y });
    const from = c.aim ? decodePoint(c.aim, document, rects) : null;
    // The aim's END snaps to the minion the player's aim is on (R-SPECTATE-AIM-01): its centre on this screen.
    const end = c.aim?.t ? decodePoint({ x: 0, y: 0, an: { k: `u:${c.aim.t}`, fx: 0.5, fy: 0.5 } }, document, rects) : null;
    aim = c.aim && from ? { x: from.x, y: from.y, on: c.aim.on, ...(c.aim.def ? { def: c.aim.def } : {}), end: end?.el ? { x: end.x, y: end.y } : null } : null;
  }
  const state: FeedState = {
    s,
    hidden: !!c.hide,
    drag: !c.hide && c.drag ? { uid: c.drag.uid, source: c.drag.source, cardId: c.drag.cardId, ...wireDecision(c.drag.g) } : null,
    aim,
    aimT: !c.hide ? c.aim?.t ?? null : null,
    // The player's hover preview (R-SPECTATE-HOVER-01): the element under their hand, unless a card is in it or an aim
    // line is out (their own screen opens no preview then). An idle hand still over a card keeps its preview open (the
    // player is reading it); a hidden tab clears it.
    hover: c.hide ? c.an?.k ?? null : !c.drag && !c.aim ? c.an?.k ?? null : null,
    ...(c.de ? { de: c.de } : {}),
  };
  // An older player's state applies on arrival, as it always did; a stamped one waits for playback to reach it. A seek's
  // state applies now, without its drop verdict (the hand is simply where it was).
  if (atOnce) { delete state.de; cursorFeed.pending = []; applyFeedState(state, now, true); }
  else if (cursorFeed.legacy) applyFeedState(state, now);
  else {
    // In player-clock order (one socket keeps them in order; a reconnect might not).
    const q = cursorFeed.pending;
    let i = q.length;
    while (i > 0 && q[i - 1]!.s > state.s) i--;
    q.splice(i, 0, state);
    if (q.length > 64) applyFeedState(q.shift()!, now);
  }
  notifyCursor();
}

/** Apply every stamped state playback has reached (the overlay's frame loop). Returns true when one applied. */
export function advanceCursorFeed(now: number): boolean {
  const at = cursorPlayback(now);
  let any = false;
  while (cursorFeed.pending.length && cursorFeed.pending[0]!.s <= at) { applyFeedState(cursorFeed.pending.shift()!, now); any = true; }
  // A committed drop whose action never came: let it go (it springs back, as a refused one does).
  if (cursorFeed.landing && now > cursorFeed.landing.until) { cursorFeed.spring = cursorFeed.landing.drag; cursorFeed.landing = null; any = true; }
  if (any) notifyCursor();
  return any;
}

function applyFeedState(e: FeedState, now: number, quiet = false): void {
  const prev = cursorFeed.drag;
  if (e.hidden) {
    cursorFeed.hidden = true;
    cursorFeed.aim = null;
    setAimTarget(null);
    setSpectatorHover(e.hover);
    return;
  }
  cursorFeed.hidden = false;
  if (e.drag && e.drag.uid !== prev?.uid) {
    if (!quiet && pickupSound()) presentAction({ kind: 'touch' }); // the pick-up (a seek lands mid-drag silently)
    // A new pick-up ends whatever the last drop left behind.
    cursorFeed.landing = null;
    cursorFeed.spring = null;
  }
  // THE DROP (R-SPECTATE-SMOOTH-01): the card the hand held is let go. A committed drop stays where it was let go (the
  // rows keep its gap open) until its action lands (`takeLanding`); a refused one springs back to its slot. An older
  // player says neither: the card is simply let go, as before.
  if (prev && e.drag?.uid !== prev.uid && e.de) {
    if (e.de === 'c') cursorFeed.landing = { drag: prev, until: now + LAND_WAIT_MS };
    else cursorFeed.spring = prev;
  }
  cursorFeed.drag = e.drag;
  cursorFeed.aim = e.aim;
  setAimTarget(e.aimT);
  if (e.drag) dragSeen.set(e.drag.uid, now);
  setSpectatorHover(e.hover);
}

/**
 * THE ACTION LANDS (`land`): if the watched hand holds (or has just let go of) the card this action moved, hand back
 * where that card is on screen (for the drop's FLIP, `presentAction('dropping')`) and clear it: the parked card, the
 * live hold, and any queued state that would pick it up again. Null when no held card belongs to the action.
 */
export function takeLanding(uid: string | undefined): { rect: DOMRect | null; source: string } | null {
  const held = cursorFeed.landing?.drag ?? (cursorFeed.drag && !cursorFeed.legacy ? cursorFeed.drag : null);
  if (!held || (uid && held.uid !== uid)) return null;
  const card = document.querySelector<HTMLElement>('.vsspec-cursor .ghostcardwrap .card');
  const rect = card ? card.getBoundingClientRect() : null;
  cursorFeed.landing = null;
  cursorFeed.spring = null;
  if (cursorFeed.drag?.uid === held.uid) cursorFeed.drag = null;
  // The player let go before these were drawn: they must not lift the card again once it has landed.
  for (const p of cursorFeed.pending) if (p.drag?.uid === held.uid) { p.drag = null; delete p.de; }
  notifyCursor();
  return { rect: rect && rect.width > 0 ? rect : null, source: held.source };
}

/** The drop's spring-back finished (the overlay's animation). */
export function endSpring(): void {
  if (!cursorFeed.spring) return;
  cursorFeed.spring = null;
  notifyCursor();
}

/** When playback reaches the player-clock moment `ts` (local ms), or null if this hand carries no clock. */
export function cursorDueAt(ts: number | undefined): number | null {
  if (typeof ts !== 'number' || cursorFeed.legacy || performance.now() - cursorFeed.lastAt > 3000) return null;
  return localTimeOf(cursorFeed.clock, ts);
}

/** The drop gap the player's rows open for the held card (R-SPECTATE-DRAGGAP-01), one object per distinct decision so
 *  the drag store notifies (and the rows slide) only when it actually moves. An older sender's drag has none: the
 *  card is lifted with no gap, as before. */
let decisionCache: { key: string; out: { overZone: Zone | null; decision: DragDecision } } | null = null;
export function wireDecision(g: WireDecision | undefined | null): { overZone: Zone | null; decision: DragDecision } {
  const key = g ? JSON.stringify(g) : '';
  if (decisionCache?.key === key) return decisionCache.out;
  const out = g
    ? {
        overZone: g.z ?? null,
        decision: {
          ...NO_DRAG_DECISION,
          gapIndex: g.gi ?? -1, shopGapIndex: g.sg ?? -1, handGapIndex: g.hg ?? -1,
          overWarband: !!g.ow, collapsedLift: !!g.cl, wouldMagnetize: !!g.mg,
        },
      }
    : { overZone: null, decision: { ...NO_DRAG_DECISION, collapsedLift: true } };
  decisionCache = { key, out };
  return out;
}

/** The watched player's aim target, lit with the game's own `targeted` highlight (the drag store's aim target). The
 *  viewer's own mouse never writes it on the watch screen (Recruit skips its aim listeners while viewing). */
let aimLit: string | null = null;
function setAimTarget(uid: string | null): void {
  if (uid === aimLit) return;
  aimLit = uid;
  dragStore.set({ aimTargetUid: uid });
}

/** Clear the hand (a replay seek or a replay ending; the watch screen's own seat switch and exit). */
export function resetCursorFeed(): void {
  resetCursor();
}

function resetCursor(): void {
  setSpectatorHover(null);
  setAimTarget(null);
  cursorFeed.pts = [];
  cursorFeed.pending = [];
  cursorFeed.clock = newRemoteClock();
  cursorFeed.legacy = true;
  cursorFeed.drag = null;
  cursorFeed.aim = null;
  cursorFeed.landing = null;
  cursorFeed.spring = null;
  cursorFeed.hidden = true;
  notifyCursor();
}

function askForKey(force = false): void {
  if (!force && Date.now() - lastKeyAsk < 2000) return;
  lastKeyAsk = Date.now();
  io?.requestKey();
}

async function fetchKeyframes(): Promise<void> {
  if (!io || !matchId || fetching) return;
  fetching = true;
  const id = matchId;
  try {
    const rows = await io.latestFrames(id);
    if (id !== matchId) return;
    for (const r of rows) {
      const msg = r.frame as SpectatorMessage;
      if (msg?.m && msg.m !== id) continue;
      if (msg?.kind === 'key') {
        const k = applySpectatorMessage(rx[r.seat], msg).rx;
        rx[r.seat] = msg.fight && k.view ? { ...k, view: { ...k.view, lastCombat: msg.fight } } : k;
      }
    }
    schedule();
  } catch { /* retried on the next gap */ } finally { fetching = false; }
}

/** One render per animation frame, whatever the burst. */
function schedule(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

function render(): void {
  if (!matchId || useSpectate.getState().optedOut === matchId) return;
  const seat = useSpectate.getState().seat;
  const latest = shownView ?? rx[seat].view;
  if (!latest) return; // nothing to show for this seat yet: the keyframe is on its way
  // THE PLAYER LEFT THE FIGHT: the screen follows them out at once, however far its own replay has got (owner 2026-10-20:
  // "if a player skips combat the spectator should follow their view back to shop in real time", R-SPECTATE-SKIP-01).
  // The pin only ever holds a fight the player is still IN (their settle arriving before this screen's strike); it never
  // holds the screen a fight behind a player who has gone back to the shop. A late join is the same rule
  // (R-SPECTATE-JOIN-01).
  const now = rx[seat].view;
  if (pin && !pin.released && now && (now.phase !== 'combat' || pin.key !== `${matchId}|${seat}|${now.wave}`)) {
    pin.released = true;
    if (releaseTimer != null) { window.clearTimeout(releaseTimer); releaseTimer = null; }
  }
  const view = pinnedView(seat, latest);
  const round = rounds[view.wave];
  const fight = round ? (seat === 'p1' ? round.p1_result : round.p2_result) : undefined;
  // Same view, same fight: the same run object (a re-render with nothing new does nothing).
  const run = last && last.view === view && last.fight === fight && last.seat === seat ? last.run : spectatorRunOf(view, seat, matchId, round);
  if (run && run !== last?.run && !run.lobby && io) {
    // Rebuilt only when what it reads moves (a round commits, the fight lands or settles), never per shop delta.
    const key = `${matchId}|${seat}|${run.wave}|${run.phase}|${run.combatSettled ? 1 : 0}|${Object.keys(rounds).length}`;
    if (lobbyCache?.key !== key) lobbyCache = { key, lobby: io.lobbyFor(seat, run) };
    run.lobby = lobbyCache.lobby;
  }
  if (run) last = { view, fight, seat, run };
  if (!run) { io?.loadRounds(); return; }
  if (!snapshot) enter(view);
  const cur = useGame.getState().run;
  if (cur === run) return;
  // LEAVING A FIGHT: the player's End Combat (its relight and pulse) and the exit curtain, then the shop under it, as
  // the player saw it. The swap waits for the curtain's full cover (`spectatorFightCovered`).
  if (cur.phase === 'combat' && run.phase === 'recruit' && cur.runId === run.runId && leaving !== 'covered') {
    if (leaving === 'no') startLeaving();
    return;
  }
  leaving = 'no';
  freshDrivers(run.lobby);
  useGame.setState({ run });
  // Out of the fight: the shop actions held for it play now, on the shop they were made in.
  if (awaitingShop && run.phase !== 'combat') { awaitingShop = false; window.setTimeout(pump, 0); }
}

/**
 * THE LOBBY ON SCREEN IS READ FRESH (owner report 2026-10-18: spectating a Versus match with the same hero on both seats,
 * "opponent info isnt showing in combat"; R-SPECTATE-SAMEHERO-01). An authored seat's driver (the Versus opponent, whose
 * boards grow a round at a time) reads its table when it is built and is cached by key; the player's own client evicts
 * it on every rebuild, but the watch screen renders the lobby the player SENT, so it must evict too: whenever a new lobby
 * object goes on screen (a round, a seat switch), its authored seats' drivers are dropped and rebuilt from it. Only
 * authored seats (cheap tables); a live lobby game's recorded seats are never rebuilt here.
 */
let driversOf: RunState['lobby'] | null = null;
function freshDrivers(lobby: RunState['lobby']): void {
  if (!lobby || lobby === driversOf) return;
  driversOf = lobby;
  const authored = lobby.seats.filter((st) => st.kind === 'authored');
  if (authored.length) resetLobbyDrivers(authored);
}

/** Leaving the fight on screen: 'covering' while the exit curtain closes, 'covered' once it has. */
let leaving: 'no' | 'covering' | 'covered' = 'no';
let leaveTimer: number | null = null;
/** If no screen answers (nothing mounted to draw the curtain), the swap still happens. */
const LEAVE_SAFETY_MS = 3000;
function startLeaving(): void {
  leaving = 'covering';
  leaveTimer = window.setTimeout(spectatorFightCovered, LEAVE_SAFETY_MS);
  emitPressCue('endCombat'); // the gem's relight + pulse, and Recruit's exit curtain (whose full cover calls back)
}
/** Recruit, at the exit curtain's full cover on the watch screen: swap to the shop now, out of sight. */
export function spectatorFightCovered(): void {
  if (leaveTimer != null) { window.clearTimeout(leaveTimer); leaveTimer = null; }
  if (leaving === 'no') return;
  leaving = 'covered';
  render();
}

function enter(view: VersusSpectatorView): void {
  // Arriving mid-fight: the fight on screen is a late one, and the player is asked where it is (their keyframe answer
  // carries the beat, `cb`, which the screen seeks to).
  if (view.phase === 'combat') askForKey(true);
  const s = useGame.getState();
  const snap: Record<string, unknown> = {};
  for (const k of SNAPSHOT_KEYS) snap[k] = s[k];
  snapshot = snap as typeof snapshot;
  useSpectate.setState({ active: true });
  watchLocalHover(true); // the spectator's own rune hover (R-SPECTATE-RUNEHOVER-01)
  unsubDone = useGame.subscribe((st, prev) => { if (st.combatReplayDone !== prev.combatReplayDone) onReplayDone(st.combatReplayDone); });
  useGame.setState({ replaying: true, showTitle: false, heroChoices: null, inspect: null, heroArmed: false, equipArmed: false });
}

// ── the fight on screen: played out in full, and continued across a seat switch ─────────────────────────────

/**
 * THE FIGHT IS WATCHED WHOLE (live playtest 2026-10-14: "spectating makes the combat look really weird too, not getting
 * full lunge logic"). The watched player's client settles its fight on its own clock, and its settled view (hearts
 * dropped, `combatSettled`) used to arrive while the spectator's replay was still playing, cutting the hero strike.
 * The first combat view of a fight is PINNED (unsettled) until the spectator's own replay has finished and its hero
 * strike has had its time; then the screen catches up to the latest view.
 */
let pin: { key: string; view: VersusSpectatorView; released: boolean; late: boolean } | null = null;
/** The next fight pinned was joined part way through (entering the watch screen, or coming back to it). */
let lateEntry = true;
let releaseTimer: number | null = null;
/** The hero strike's time after the replay is done, before the pinned fight lets go. */
const STRIKE_MS = 2600;
function pinnedView(seat: VersusSeat, view: VersusSpectatorView): VersusSpectatorView {
  if (view.phase === 'combat') {
    const key = `${matchId}|${seat}|${view.wave}`;
    if (pin?.key !== key) pin = { key, view: { ...view, combatSettled: false }, released: false, late: lateEntry };
  }
  lateEntry = false;
  return pin && !pin.released ? pin.view : view;
}
function onReplayDone(done: boolean): void {
  // A finished match waits for its last fight (and the strike after it) before the end gate (R-SPECTATE-END-01).
  // (Noted on every finished fight: the match row can complete after the screen has already played the last one.)
  if (done) {
    const key = `${matchId}|${useGame.getState().run.wave}`;
    window.setTimeout(() => { fightShown = key; maybeEndWatch(); }, STRIKE_MS);
  }
  if (!done || !pin || pin.released || releaseTimer != null) return;
  releaseTimer = window.setTimeout(() => { releaseTimer = null; if (pin) pin.released = true; schedule(); }, STRIKE_MS);
}

/** Where the fight on screen is (Recruit reports it while a spectator watches one). */
let fightBeat: { key: string; beat: number } | null = null;
let resumeAt: { wave: number; beat: number } | null = null;
export function noteSpectatorBeat(wave: number, beat: number): void { fightBeat = { key: `${matchId}|${wave}`, beat }; }
/** The beat to continue the fight at after a seat switch (once), or null. Both sides of the one fight have the same
 *  beats (R-VERSUS-PERSPECTIVE-01), so the same index is the same moment. */
export function takeSpectatorResume(wave: number): number | null {
  if (!resumeAt || resumeAt.wave !== wave) return null;
  const b = resumeAt.beat;
  resumeAt = null;
  return b;
}

/** A spectator this many beats behind the player's fight is seeked; closer than that it plays on (no visible jump). */
export const SEEK_LAG_BEATS = 3;
/** Every seek request's number, never reused (across watch sessions too), so a request runs exactly once. */
let seekSeq = 0;
/**
 * LATE JOIN (owner 2026-10-15: "i left a game as a spectator and came back in combat, and it started combat from the
 * start ... can we just sync the viewer up either mid fight"; R-SPECTATE-JOIN-01). The player's broadcast keyframe
 * says which beat its fight is on. A fight already on screen and behind it SEEKS there (the replay's own `seekTo`:
 * the frame snaps to that moment, no fast-forward through the beats, their FX, sounds or announcer lines); a fight
 * not mounted yet starts there (`takeSpectatorResume`).
 */
export function syncFightBeat(cb: CombatBeat): void {
  if (!cb || typeof cb.w !== 'number' || typeof cb.b !== 'number' || cb.b <= 0) return;
  const run = useGame.getState().run;
  const fb = fightBeat;
  const onScreen = useSpectate.getState().active && run.phase === 'combat' && run.wave === cb.w && fb?.key === `${matchId}|${cb.w}`;
  if (onScreen && fb) {
    if (cb.b - fb.beat >= SEEK_LAG_BEATS) { seekSeq += 1; useSpectate.setState({ seek: { wave: cb.w, beat: cb.b, n: seekSeq } }); }
    return;
  }
  resumeAt = { wave: cb.w, beat: cb.b };
}

/** Watch the other player (hotkeys 1 / 2, the spectator bar). Instant: both views are already cached. In a fight it
 *  continues from the same moment, from the other side. */
export function watchSeat(seat: VersusSeat): void {
  if (useSpectate.getState().seat === seat) return;
  const run = useGame.getState().run;
  if (run.phase === 'combat' && fightBeat?.key === `${matchId}|${run.wave}`) resumeAt = { wave: run.wave, beat: fightBeat.beat };
  // The pin follows the fight, not the seat: carry its state to the other side.
  if (pin && run.phase === 'combat') {
    const other = rx[seat].view;
    if (other && other.phase === 'combat') pin = { key: `${matchId}|${seat}|${other.wave}`, view: { ...other, combatSettled: false }, released: pin.released, late: pin.late };
  }
  useGame.setState({ inspect: null });
  clearQueue();
  resetCursor();
  useSpectate.setState({ seat });
  schedule();
}

/** Leave the watch screen for the room (the match keeps running; Watch brings you back). */
export function leaveSpectating(): void {
  useSpectate.setState({ optedOut: matchId });
  stopSpectatorBeat();
  stopSpectating();
}

/** Back to watching after Leave. */
export function resumeSpectating(): void {
  useSpectate.setState({ optedOut: null });
  // Coming back mid-fight is a late join: ask where the fight is (R-SPECTATE-JOIN-01).
  lateEntry = true;
  if (rx[useSpectate.getState().seat].view?.phase === 'combat') askForKey(true);
  schedule();
}

export function stopSpectating(): void {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  clearQueue();
  resetCursor();
  const snap = snapshot;
  snapshot = null;
  last = null;
  driversOf = null;
  unsubDone?.();
  unsubDone = null;
  if (releaseTimer != null) { window.clearTimeout(releaseTimer); releaseTimer = null; }
  pin = null;
  lateEntry = true;
  fightBeat = null;
  resumeAt = null;
  if (useSpectate.getState().seek || useSpectate.getState().skip) useSpectate.setState({ seek: null, skip: null });
  leaving = 'no';
  if (leaveTimer != null) { window.clearTimeout(leaveTimer); leaveTimer = null; }
  useSpectate.setState({ active: false });
  watchLocalHover(false);
  // Back where the spectator came from: the Versus room (its title view), whatever the snapshot says, or the live
  // games list for a ranked lobby game (`Io.returnTo`).
  if (snap) useGame.setState({ ...snap, inspect: null, replaying: false, showTitle: true, titleView: 'versus', ...(io?.returnTo?.() ?? {}) });
}

/** The session ended (the room was left): forget the match. */
export function resetSpectate(): void {
  if (endWatch?.timer != null) window.clearTimeout(endWatch.timer);
  endWatch = null;
  fightShown = null;
  stopSpectatorBeat();
  stopSpectating();
  matchId = null;
  rx = { p1: newReceiver(), p2: newReceiver() };
  rounds = {};
  useSpectate.setState({ seat: 'p1', optedOut: null, name: null, odds: {}, overlay: {} });
}

/**
 * THE WATCHED PLAYER'S NAME (live bug 2026-10-14: "it shows the spectators name in the bottom left"), or null when not
 * spectating. Read off the watched run's own two-seat lobby (seat s0 = that player, labelled from the match), so it
 * can never be the local profile's. Every "you" surface on the watch screen uses it.
 */
export function useWatchedName(): string | null {
  const active = useSpectate((s) => s.active);
  const named = useSpectate((s) => s.name ?? null);
  const label = useGame((s) => s.run.lobby?.seats[0]?.label ?? null);
  return active ? named ?? label ?? '' : null;
}

/** For the tests: the beat the fight on this screen is on (null outside a fight). */
export const spectatorFightBeat = (): number | null => fightBeat?.beat ?? null;
/** For the tests: a seat's cached view. */
export const spectatorViewOf = (seat: VersusSeat): VersusSpectatorView | null => rx[seat].view;
