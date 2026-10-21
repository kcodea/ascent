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
import { setSpectatorHover, watchLocalHover } from './spectatorHover';
import type { CursorSample, SpectatorAct, WireDecision, WireOdds, WireOverlay } from './spectateTap';
import { applySpectatorMessage, newReceiver, type CombatBeat, type SpectatorMessage, type SpectatorReceiver, type VersusSpectatorView } from './spectatorView';
import type { VersusMatch, VersusRoundRow } from './versusRemote';

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
  if (!match || !live) { if (useSpectate.getState().active) stopSpectating(); return; }
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
    void fetchKeyframes();
  }
  if (useSpectate.getState().optedOut === match.id) return;
  schedule();
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
  const prevRun = useGame.getState().run;
  const behind = queue.length >= BEHIND;
  const flight = behind ? null : item.acts.find((a) => a.drag && playableDragPath(a.drag) && !(a.uid && liveDragShown(a.uid)));
  if (flight?.drag) {
    // The card flies the player's own drag path over the screen as it was, then lands (the replay viewer's ghost).
    const drag = flight.drag;
    const view = ghostCardView(prevRun as never, drag.cardId);
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

function land(item: Pending, prevRun: RunState): void {
  // The card in the hand that let go of it (the flight's ghost, or the live drag's): where its plate dissolves from.
  const plate = document.querySelector<HTMLElement>('.replay-dragghost .ghostcardwrap .card')?.getBoundingClientRect() ?? null;
  // ONE ACTION, ONE PRESENTATION (`actionPresenter.ts`): what the player's input showed before its dispatch...
  const pre = item.acts.map((a) => presentBefore(a, prevRun));
  releaseGhostHold();
  if (useGame.getState().replayDragGhost) useGame.setState({ replayDragGhost: null });
  shownView = item.view;
  render();
  const nextRun = useGame.getState().run;
  let eot: SpectatorAct['eot'] | null = null;
  item.acts.forEach((a, i) => {
    // The fight's Skip (R-SPECTATE-SKIP-01): this screen's replay skips with the player's, only while it is still
    // playing a fight (a screen already past it, or back in the shop, has nothing to skip).
    if (a.t === 'skipCombat') {
      const g = useGame.getState();
      if (g.run.phase === 'combat' && !g.combatReplayDone) emitPressCue('skipCombat');
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

/** A cursor sample landed on THIS screen (screen px, `cursorSpace.decodePoint`). */
export interface CursorPoint { t: number; x: number; y: number }
/** The player's live aim line, landed on this screen (screen px). */
export interface CursorAim { x: number; y: number; on: boolean; def?: string; end?: { x: number; y: number } | null }
/** The card in the player's hand, and (R-SPECTATE-DRAGGAP-01) the drop gap their rows open for it right now. */
export interface CursorDrag { uid: string; source: string; cardId: string; overZone: Zone | null; decision: DragDecision }
/** The live cursor the overlay draws (`SpectatorCursor`): a short buffer of samples, the card in hand, hidden. */
export const cursorFeed: { pts: CursorPoint[]; drag: CursorDrag | null; aim: CursorAim | null; hidden: boolean; version: number } = { pts: [], drag: null, aim: null, hidden: true, version: 0 };
const dragSeen = new Map<string, number>();
const liveDragShown = (uid: string): boolean => performance.now() - (dragSeen.get(uid) ?? -1e9) < 2500;
const cursorListeners = new Set<() => void>();
export function onCursorFeed(fn: () => void): () => void { cursorListeners.add(fn); return () => { cursorListeners.delete(fn); }; }

/** A cursor sample from a player (only the watched player's is drawn). */
export function receiveSpectatorCursor(payload: unknown): void {
  const c = payload as CursorSample;
  if (!c || c.seat !== useSpectate.getState().seat || !useSpectate.getState().active) return;
  if (c.hide) {
    cursorFeed.hidden = true;
    cursorFeed.aim = null;
    setAimTarget(null);
    // An idle hand still over a card keeps its preview open (the player is reading it); a hidden tab clears it.
    setSpectatorHover(c.an?.k ?? null);
  } else {
    cursorFeed.hidden = false;
    // Landed on THIS screen: on the same element, else the same spot of the game box (R-SPECTATE-CURSOR-01).
    const at = decodePoint(c);
    cursorFeed.pts.push({ t: performance.now(), x: at.x, y: at.y });
    if (cursorFeed.pts.length > 12) cursorFeed.pts.splice(0, cursorFeed.pts.length - 12);
    if (c.drag && c.drag.uid !== cursorFeed.drag?.uid) presentAction({ kind: 'touch' }); // the pick-up
    cursorFeed.drag = c.drag ? { uid: c.drag.uid, source: c.drag.source, cardId: c.drag.cardId, ...wireDecision(c.drag.g) } : null;
    const from = c.aim ? decodePoint(c.aim) : null;
    // The aim's END snaps to the minion the player's aim is on (R-SPECTATE-AIM-01): its centre on this screen.
    const end = c.aim?.t ? decodePoint({ x: 0, y: 0, an: { k: `u:${c.aim.t}`, fx: 0.5, fy: 0.5 } }) : null;
    cursorFeed.aim = c.aim && from ? { x: from.x, y: from.y, on: c.aim.on, ...(c.aim.def ? { def: c.aim.def } : {}), end: end?.el ? { x: end.x, y: end.y } : null } : null;
    setAimTarget(c.aim?.t ?? null);
    if (c.drag) dragSeen.set(c.drag.uid, performance.now());
    // The player's hover preview (R-SPECTATE-HOVER-01): the element under their hand, unless a card is in it or an
    // aim line is out (their own screen opens no preview then).
    setSpectatorHover(!c.drag && !c.aim ? c.an?.k ?? null : null);
  }
  cursorFeed.version += 1;
  for (const fn of cursorListeners) fn();
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

function resetCursor(): void {
  setSpectatorHover(null);
  setAimTarget(null);
  cursorFeed.pts = [];
  cursorFeed.drag = null;
  cursorFeed.aim = null;
  cursorFeed.hidden = true;
  cursorFeed.version += 1;
  for (const fn of cursorListeners) fn();
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
  if (useSpectate.getState().seek) useSpectate.setState({ seek: null });
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
