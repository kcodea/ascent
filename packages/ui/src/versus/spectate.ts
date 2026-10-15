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
import { chooseOneNeedsChoice, sellValueWithBonus, type RunState, type VersusSeat } from '@game/sim';
import { presentAction, type ScreenPoint } from '../actionPresenter';
import { playsAsSpell } from '../instView';
import { actionSfx, useGame } from '../store';
import { emitPressCue, type PressCue } from '../pressCue';
import { ghostCardView, holdGhostCard, playableDragPath, releaseGhostHold } from '../replay/replayPlayer';
import type { CursorSample, SpectatorAct } from './spectateTap';
import { applySpectatorMessage, newReceiver, type SpectatorMessage, type SpectatorReceiver, type VersusSpectatorView } from './spectatorView';
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
}

export const useSpectate = create<SpectateState>(() => ({ active: false, seat: 'p1', optedOut: null }));

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
    rounds = allRounds;
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
    rounds = {};
    useSpectate.setState({ seat: 'p1', optedOut: null });
    void fetchKeyframes();
  }
  schedule();
}

/** A broadcast frame from a player. */
export function receiveSpectate(payload: unknown): void {
  const msg = payload as SpectatorMessage;
  if (!msg || (msg.seat !== 'p1' && msg.seat !== 'p2') || typeof msg.seq !== 'number') return;
  if (!matchId || (msg.m && msg.m !== matchId)) return; // another match's frame (a room hosts match after match)
  const applied = applySpectatorMessage(rx[msg.seat], msg);
  const { needKeyframe } = applied;
  let next = applied.rx;
  // A live ranked lobby game's fight rides the message (the view never carries the heavy result itself).
  if (msg.fight && next.view) next = { ...next, view: { ...next.view, lastCombat: msg.fight } };
  rx[msg.seat] = next;
  if (needKeyframe) { askForKey(); void fetchKeyframes(); return; }
  if (msg.seat !== useSpectate.getState().seat) return;
  // The watched player's ACTIONS: their screen moves one action at a time, each with the animation and cue the
  // player saw (`playActs`). A message with no actions just renders (coalesced).
  if (msg.acts?.length || queue.length || busy) {
    queue.push({ view: next.view!, acts: msg.acts ?? [] });
    pump();
  } else schedule();
}

// ── the watched player's actions, replayed in order ────────────────────────────────────────────────────────

interface Pending { view: VersusSpectatorView; acts: SpectatorAct[] }
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

/** The press cue a button action replays (its own press visual, `pressCue.ts`). */
const PRESS: Partial<Record<string, PressCue>> = { roll: 'refresh', freeze: 'freeze', upgrade: 'upgrade', heroPower: 'heroPower', endTurn: 'endTurn' };

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
  if (busy != null) return;
  const item = queue.shift();
  if (!item) { shownView = null; schedule(); return; }
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
  releaseGhostHold();
  if (useGame.getState().replayDragGhost) useGame.setState({ replayDragGhost: null });
}

// ── the watched player's cursor ────────────────────────────────────────────────────────────────────────────

export interface CursorPoint { t: number; x: number; y: number }
/** The live cursor the overlay draws (`SpectatorCursor`): a short buffer of samples, the card in hand, hidden. */
export const cursorFeed: { pts: CursorPoint[]; drag: CursorSample['drag']; aim: CursorSample['aim']; hidden: boolean; version: number } = { pts: [], drag: null, aim: null, hidden: true, version: 0 };
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
  } else {
    cursorFeed.hidden = false;
    cursorFeed.pts.push({ t: performance.now(), x: c.x, y: c.y });
    if (cursorFeed.pts.length > 12) cursorFeed.pts.splice(0, cursorFeed.pts.length - 12);
    if (c.drag && c.drag.uid !== cursorFeed.drag?.uid) presentAction({ kind: 'touch' }); // the pick-up
    cursorFeed.drag = c.drag ?? null;
    cursorFeed.aim = c.aim ?? null;
    if (c.drag) dragSeen.set(c.drag.uid, performance.now());
  }
  cursorFeed.version += 1;
  for (const fn of cursorListeners) fn();
}

function resetCursor(): void {
  cursorFeed.pts = [];
  cursorFeed.drag = null;
  cursorFeed.aim = null;
  cursorFeed.hidden = true;
  cursorFeed.version += 1;
  for (const fn of cursorListeners) fn();
}

function askForKey(): void {
  if (Date.now() - lastKeyAsk < 2000) return;
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
  if (!snapshot) enter();
  const cur = useGame.getState().run;
  if (cur === run) return;
  // LEAVING A FIGHT: the player's End Combat (its relight and pulse) and the exit curtain, then the shop under it, as
  // the player saw it. The swap waits for the curtain's full cover (`spectatorFightCovered`).
  if (cur.phase === 'combat' && run.phase === 'recruit' && cur.runId === run.runId && leaving !== 'covered') {
    if (leaving === 'no') startLeaving();
    return;
  }
  leaving = 'no';
  useGame.setState({ run });
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

function enter(): void {
  const s = useGame.getState();
  const snap: Record<string, unknown> = {};
  for (const k of SNAPSHOT_KEYS) snap[k] = s[k];
  snapshot = snap as typeof snapshot;
  useSpectate.setState({ active: true });
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
let pin: { key: string; view: VersusSpectatorView; released: boolean } | null = null;
let releaseTimer: number | null = null;
/** The hero strike's time after the replay is done, before the pinned fight lets go. */
const STRIKE_MS = 2600;
function pinnedView(seat: VersusSeat, view: VersusSpectatorView): VersusSpectatorView {
  if (view.phase === 'combat') {
    const key = `${matchId}|${seat}|${view.wave}`;
    if (pin?.key !== key) pin = { key, view: { ...view, combatSettled: false }, released: false };
  }
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

/** Watch the other player (hotkeys 1 / 2, the spectator bar). Instant: both views are already cached. In a fight it
 *  continues from the same moment, from the other side. */
export function watchSeat(seat: VersusSeat): void {
  if (useSpectate.getState().seat === seat) return;
  const run = useGame.getState().run;
  if (run.phase === 'combat' && fightBeat?.key === `${matchId}|${run.wave}`) resumeAt = { wave: run.wave, beat: fightBeat.beat };
  // The pin follows the fight, not the seat: carry its state to the other side.
  if (pin && run.phase === 'combat') {
    const other = rx[seat].view;
    if (other && other.phase === 'combat') pin = { key: `${matchId}|${seat}|${other.wave}`, view: { ...other, combatSettled: false }, released: pin.released };
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
  schedule();
}

export function stopSpectating(): void {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  clearQueue();
  resetCursor();
  const snap = snapshot;
  snapshot = null;
  last = null;
  unsubDone?.();
  unsubDone = null;
  if (releaseTimer != null) { window.clearTimeout(releaseTimer); releaseTimer = null; }
  pin = null;
  fightBeat = null;
  resumeAt = null;
  leaving = 'no';
  if (leaveTimer != null) { window.clearTimeout(leaveTimer); leaveTimer = null; }
  useSpectate.setState({ active: false });
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
  useSpectate.setState({ seat: 'p1', optedOut: null, name: null });
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

/** For the tests: a seat's cached view. */
export const spectatorViewOf = (seat: VersusSeat): VersusSpectatorView | null => rx[seat].view;
