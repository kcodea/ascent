/**
 * VERSUS — the match's seam into the ordinary Recruit screen (owner 2026-10-14: a Versus match is a lobby game, 1:1).
 *
 *  - `useVersusRecruit`: End Turn locks the round; the shared server deadline drives `turnClock` (a shop whose clock
 *    has not started shows its full turn); the real End Turn re-enters once the round's fight is committed; and the
 *    READY state: while this player waits on the other one (ended the turn early, back from the fight early, or past
 *    the Good Luck intro first) the shop is held and the End Turn gem's own pill reads "Players ready N/2".
 *  - `VersusHud`: an invisible input hold while waiting (the board stays exactly as it is: no text, no dimming), and
 *    the disconnect pause, in the game's own dialog panel.
 * Every surface here re-renders on Versus state only (a few times per round), never per frame.
 */
import { DuosMateDock } from './DuosMateDock';
import { DuosOrderPlate } from './DuosOrderPlate';
import { TeammateFrame, useTeammateViewKeys } from './teammateView';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunState } from '@game/sim';
import { useGame } from '../store';
import { useScreenSwapped, useSwapRef } from '../screenSwap';
import { standardTurnSeconds, turnClock } from '../turnClock';
import { displaySeconds, shopClockAt } from './versusClock';
import { driveVersusClock, nextObserveMs } from './versusClockFx';
import { expireVersusShop, lockTurn, unreadyTurn, mySeat, rereadVersusMatch, resumeMatch, unpauseMatch, useVersus, useVersusPaused, versusRemainingMs, versusServerNow, versusShopRemainingMs, type VersusState } from './versusStore';
import type { VersusMatch } from './versusRemote';
import { ownRunWhileWatching, useSpectate } from './spectate';
import { VERSUS_LEASE_SECONDS } from '@game/sim';
import { sfx } from '../sfx';
import { versusReadyLabel, versusTurn, versusTurnHolds, versusTurnLocksGem, versusTurnNote, versusTurnReady, type VersusTurn } from './versusTurn';
import { markFlow } from './flowTiming';
import { SpectatorBar } from './SpectatorBar';
import { useDuosLivePublisher } from './duosLive';
import { emitPressCue } from '../pressCue';
import { endTurnStalled } from './versusReliability';
import { versusFightWaitHeld } from './versusHooks';
import './versus.css';

/** How often the End Turn watchdog looks (R-VERSUS-RELIABLE-05). */
const END_TURN_RETRY_MS = 1500;
/** Is the match paused right now (outside React)? */
const pausedNow = (): boolean => { const m = useVersus.getState().match; return !!m?.paused_at && m.phase !== 'complete'; };

/** This player's turn state (`versusTurn`), from the session store and the run. */
function turnOf(st: Pick<VersusState, 'match' | 'lockedRound' | 'readyRound'>, run: Pick<RunState, 'mode' | 'phase' | 'wave'>): VersusTurn {
  return versusTurn({ match: st.match, seat: mySeat(st.match), lockedRound: st.lockedRound, readyRound: st.readyRound, run, now: versusServerNow() });
}

/** The turn state as a hook: re-renders only when the kind or the ready count changes. A stale row is re-read. The key
 *  carries every field, the teammate's name included (it used to drop `mate`, so the Ranked Duos pills never named
 *  them on screen, R-VERSUS-READY-02). */
function useVersusTurn(run: Pick<RunState, 'mode' | 'phase' | 'wave'>): VersusTurn {
  const key = useVersus((s) => JSON.stringify(turnOf(s, run)));
  const turn = useMemo(() => JSON.parse(key) as VersusTurn, [key]);
  useEffect(() => { if (turn.stale) rereadVersusMatch(); }, [turn.stale, key]);
  return turn;
}

/** Whole seconds until `ms` (server time), ticking while `on`. */
function useSecondsUntil(ms: number | undefined, on: boolean): number {
  const left = (): number => (ms ? Math.max(0, Math.ceil((ms - versusServerNow()) / 1000)) : 0);
  const [s, setS] = useState(left);
  useEffect(() => {
    if (!on || !ms) return undefined;
    const tick = (): void => setS(left());
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [ms, on]);
  return s;
}

/**
 * Recruit's Versus seam. `endTurn` is Recruit's stable End Turn; `endCombat` its End Combat (the fight's exit).
 * `readyNote` is the End Turn / End Combat gem's pill; `gemLocked` says the gem is spent while this player waits.
 */
export function useVersusRecruit(run: RunState, endTurn: () => void, endCombat: () => void, screen = ''): { intercept: () => boolean; readyNote: string | null; gemLocked: boolean; gemReady: boolean; gemLabel: string | null; clockQuiet: boolean } {
  const versus = run.mode === 'versus';
  const endTurnWave = useVersus((s) => s.endTurnWave);
  const match = useVersus((s) => s.match);
  const resolveSlow = useVersus((s) => s.resolveSlow);
  const turn = useVersusTurn(run);
  const secondsLeft = useSecondsUntil(turn.deadline, turn.kind === 'foeReady');
  // LEAVE THE FIGHT TOGETHER (owner 2026-10-14): the next shop is open (both pressed End Combat, or the 5 s ran out),
  // so this fight leaves through its ordinary exit, a replay still playing included. Once per wave.
  // `screen`: the run on screen (Recruit's `screenId`). A Duos teammate swap no longer remounts Recruit, so the once-per-wave
  // marks below reset on it as they did with the remount (R-DUOS-VIEW-NOREMOUNT-01).
  const swapped = useScreenSwapped(screen);
  const leftRef = useSwapRef<number | null>(null, swapped);
  useEffect(() => {
    if (!versus || turn.kind !== 'leave' || leftRef.current === run.wave) return;
    leftRef.current = run.wave;
    endCombat();
  }, [versus, turn.kind, run.wave, endCombat]);
  // The fight is in: play the real End Turn (its commit lands the fight). Once per wave.
  const firedRef = useSwapRef<number | null>(null, swapped);
  // A pause holds it (the action layer would refuse it) and it plays on the resume.
  const paused = useVersusPaused();
  useEffect(() => {
    if (!versus || paused || run.phase !== 'recruit' || endTurnWave !== run.wave || firedRef.current === run.wave) return;
    const wave = run.wave;
    const t = window.setTimeout(() => {
      firedRef.current = wave;
      markFlow(useVersus.getState().match?.id, wave, 'endturn:fired');
      // The gem's strike releases the crystal fuse's charge on this path too (it dedupes a ready click's strike).
      emitPressCue('endTurn');
      endTurn();
    }, 0); // marked when it plays, not when queued
    return () => window.clearTimeout(t);
  }, [versus, paused, endTurnWave, run.wave, run.phase, endTurn]);
  // THE WATCHDOG (R-VERSUS-RELIABLE-05): End Turn can return without starting (its beats were still settling, a card
  // play's animation held it), and `firedRef` then said it had played, so it never did: the fight sat unplayed while the
  // table waited on this player ("completely locking us out"). While the fight is in and the run is still shopping it,
  // with nothing animating and no early End Turn's commit held for its fight (`versusFightWaitHeld`, R-VERSUS-EARLY-EOT-01),
  // End Turn is asked again (a call while its beats play is ignored by End Turn itself).
  useEffect(() => {
    if (!versus || paused || run.phase !== 'recruit' || endTurnWave !== run.wave) return undefined;
    const wave = run.wave;
    const id = window.setInterval(() => {
      const g = useGame.getState();
      if (firedRef.current !== wave) return; // not played yet: the effect above plays it
      if (!endTurnStalled({ endTurnWave: useVersus.getState().endTurnWave, run: g.run, presenting: !!g.presentationTx || versusFightWaitHeld(), paused: pausedNow() })) return;
      endTurn();
    }, END_TURN_RETRY_MS);
    return () => window.clearInterval(id);
  }, [versus, paused, endTurnWave, run.wave, run.phase, endTurn]);
  // The shared clock: the server deadline, offset-adjusted, never paused locally (a pause is the server's). A shop
  // whose clock has not started (the other player is not back yet, or round 1 before both intros) shows its full turn.
  const deadline = match?.shop_deadline ?? null;
  const pausedAt = match?.paused_at ?? null;
  // RANKED DUOS (R-RANKED-DUOS-GATE-02, owner 2026-10-27: "don't do the 5s timer when a player readies at 0 seconds"):
  // past 0:00 the round waits for both teammates to be ready, so the clock face simply stays at 0:00 (no countdown).
  const live = versus && match?.phase === 'shop' && match.round === run.wave && !!deadline;
  // QUIET AFTER END TURN (owner 2026-10-16, R-VERSUS-TIMER-FX-01): the player on screen ended the turn early and waits
  // on the other one, so the clock's sounds stop and the charge glyph fades, as a lobby End Turn does. The clock face
  // keeps counting (it is the round's). "On screen" = my own seat, or the seat a spectator is watching; the other
  // player still shopping hears the clock as normal. A lock AT 0:00 is not early: the 0:00 cues and the glyph's
  // completion play out over it.
  const spectating = useSpectate((s) => (s.active ? s.seat : null));
  const viewLocked = useVersus((s) => {
    const m = s.match;
    if (!versus || !m || m.phase !== 'shop' || m.round !== run.wave) return false;
    const seat = mySeat(m) ?? spectating;
    if (!seat) return false;
    if (s.lockedRound === m.round) return true;
    // VERSUS GROUP: the watched seat's own lock, off the table (p3 / p4 have no 1v1 column).
    if (m.group) return !!m.group.raw.seats.find((x) => x.seat === (mySeat(m) ? m.group!.me : seat))?.locked;
    return seat === 'p1' ? m.p1_locked : seat === 'p2' ? m.p2_locked : false;
  });
  const [clockQuiet, setClockQuiet] = useState(false);
  const quietRef = useRef(false);
  useEffect(() => {
    const q = viewLocked && turnClock.get() > 0;
    quietRef.current = q;
    setClockQuiet(q);
  }, [viewLocked, run.wave]);
  useEffect(() => {
    if (!versus || run.phase !== 'recruit') return undefined;
    if (!live) {
      // This round's fight is being resolved: the clock stays where it stopped. The next shop is not open yet (or
      // round 1 before the intros): its full turn.
      if (match?.round !== run.wave || !deadline) turnClock.set(standardTurnSeconds(run.wave));
      return undefined;
    }
    // The clock's cues and the 20 s charge glyph ride this same deadline (R-VERSUS-TIMER-FX-01): `driveVersusClock`
    // marks the clock running (or frozen while paused) and plays the lobby's ticks at the lobby's seconds. Observed
    // just past each whole-second edge, so a tick lands on its second. A spectator mirrors the watched player's clock
    // through this same hook, so it hears and sees the same; the announcer speaks to the player only.
    // THE 0:00 LOCK (R-VERSUS-CLOCK-LOCK-01): the face and the lock read ONE time-left value (`versusShopRemainingMs`,
    // which never runs ahead of the server), shown as ceil(ms / 1000) and locked only at ms <= 0, so the lock lands as
    // the clock reads 0:00, never while it still reads 0:01.
    const end = Date.parse(deadline!);
    const key = `${match!.id}|shop|${match!.round}`;
    let id = 0;
    const update = (): void => {
      const remaining = pausedAt ? end - Date.parse(pausedAt) : (versusShopRemainingMs(deadline) ?? 0);
      driveVersusClock({ key, remainingMs: remaining, moving: !pausedAt, explode: true, quiet: quietRef.current, announceWave: useGame.getState().replaying ? null : run.wave });
      if (!pausedAt && shopClockAt(remaining).locked) expireVersusShop();
      if (!pausedAt && remaining > 0) id = window.setTimeout(update, nextObserveMs(remaining));
    };
    update();
    return () => { window.clearTimeout(id); turnClock.hold(performance.now()); };
  }, [versus, live, deadline, pausedAt, run.phase, run.wave, match?.round, match?.id]);
  return {
    intercept: () => {
      if (!versus) return false;
      // VERSUS DUOS: watching my teammate, my End Turn is inert (their screen's run is on screen, never mine to end;
      // my own turn still locks at 0:00, `expireVersusShop`). R-DUOS-VIEW-01.
      if (ownRunWhileWatching()) return true;
      if (useVersus.getState().endTurnWave === run.wave) return false; // the fight is in: the real End Turn
      // VERSUS (R-VERSUS-READY-01): End Turn is a ready signal; pressed again above 0:00 it takes the signal back.
      if (unreadyTurn()) return true;
      void lockTurn();
      return true;
    },
    // LIVE READY (R-VERSUS-READY-02): while the clock is above 0:00 the ready pill says a press takes it back; past 0:00
    // in Ranked Duos (the round waits for both teammates) it names the teammate. THE FIGHT IS SLOW TO SETTLE
    // (R-VERSUS-RELIABLE-05): the resolver calls for this closed round keep failing (they retry on their own); the pill
    // says so plainly instead of sitting silent.
    readyNote: versus
      ? (resolveSlow && match?.phase === 'resolving' && match.round === run.wave ? VERSUS_SLOW_NOTE
        : versusTurnNote(turn, secondsLeft, { cancellable: !run.shopClockExpired, overtime: !!run.shopClockExpired }))
      : null,
    // Ready stays pressable (to un-ready) until 0:00; from 0:00 the signal stands, so the gem is spent.
    gemLocked: versus && (versusTurnLocksGem(turn) || (versusTurnReady(turn) && !!run.shopClockExpired)),
    gemReady: versus && versusTurnReady(turn),
    // The gem's hover label while I am not ready: a live game's End Turn reads as a READY toggle.
    gemLabel: versus ? versusReadyLabel(turn) : null,
    clockQuiet: versus && clockQuiet,
  };
}

function useSecondsTo(iso: string | null | undefined, on: boolean): number {
  const [s, setS] = useState(() => displaySeconds(versusRemainingMs(iso)));
  useEffect(() => {
    if (!on) return undefined;
    const tick = (): void => setS(displaySeconds(versusRemainingMs(iso)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [iso, on]);
  return s;
}

/** The End Turn pill while the resolver keeps failing for this round (R-VERSUS-RELIABLE-05). Neutral: it retries. */
export const VERSUS_SLOW_NOTE = 'The fight is on its way';

/**
 * The hold and the pause.
 *  - The HOLD is invisible: while the player waits on the other one (the gem's pill says so) the shop takes no input
 *    and nothing on the board changes.
 *  - The PAUSE (owner 2026-10-14: "when a player d/cs add an overlay for the reconnect time. when that player
 *    reconnects allow them to unpause which shows a 3/2/1"): the game's dark gold-rimmed panel over a dimmed screen
 *    (`VersusPauseVeil`). The opponent sees the reconnect time; the player who came back gets Unpause; then both see
 *    3, 2, 1.
 */
export function VersusHud() {
  // RANKED DUOS: the team's Live Games row (first seat only; R-RANKED-DUOS-PARTY-01).
  useDuosLivePublisher();
  const match = useVersus((s) => s.match);
  const mode = useGame((s) => s.run.mode);
  const phase = useGame((s) => s.run.phase);
  const wave = useGame((s) => s.run.wave);
  const seat = mySeat(match);
  const paused = !!match?.paused_at && match.phase !== 'complete';
  // Held whenever this shop is not this player's to play right now (`versusTurn`): nothing on the board changes.
  const held = versusTurnHolds(useVersusTurn({ mode, phase, wave }));
  // VERSUS DUOS (R-DUOS-VIEW-01): watching my teammate's screen (Tab / their rail portrait), and the way back.
  const watchingMate = useSpectate((s) => s.teammate === true);
  // (On Hero Select the Hero Select watch layer owns these keys: `hero-select/HeroSelectWatch.tsx`.)
  const heroSelectUp = useGame((s) => s.heroChoices !== null);
  useTeammateViewKeys(!!seat && !!match?.group?.duos && !heroSelectUp);
  // A SPECTATOR (Versus phase 2): the seat switcher, and no player controls.
  if (match && !seat) return <SpectatorBar />;
  if (!match || !seat) return null;
  if (watchingMate) return <><TeammateFrame /><DuosMateDock watching /></>;

  return (
    <>
      {held && !paused && <div className="vshold" aria-hidden="true" />}
      {match.group?.duos && !paused && phase === 'recruit' && <DuosOrderPlate />}
      {/* The teammate portrait stays bottom right in combat too (owner 2026-10-25: "also keep the teammate portrait in the
          bottom right during combat too"); there it only shows who your teammate is (passing and watching are shop-only). */}
      {match.group?.duos && !paused && (phase === 'recruit' || phase === 'combat') && <DuosMateDock watching={false} inCombat={phase === 'combat'} />}
      {/* On Hero Select its own veil draws over the picker (`VersusHeroSelectPause`); never two. */}
      {paused && !heroSelectUp && <VersusPauseVeil />}
    </>
  );
}

/**
 * THE PAUSE ON HERO SELECT (R-VERSUS-RELIABLE-04; audit 2026-10-27): `VersusHud` lives in the shop screen, which is not
 * mounted while the heroes are picked, so a disconnect during Hero Select froze the pick clock with nothing on screen
 * saying why, and no Unpause anywhere. The same veil, over the picker, for a seated player of a paused Versus match.
 */
export function VersusHeroSelectPause(): JSX.Element | null {
  const show = useVersus((s) => !!s.match && !!s.match.paused_at && s.match.phase !== 'complete' && !!mySeat(s.match));
  const picking = useGame((s) => s.heroChoices !== null && s.pendingMode === 'versus');
  return show && picking ? <VersusPauseVeil /> : null;
}

/**
 * The pause panel (`VersusHud`, and over Hero Select). Who sees what:
 *  - the absent player, back: "Welcome back", Unpause (a 3-2-1 for everyone);
 *  - everyone else, inside the reconnect time: who dropped and the seconds left;
 *  - everyone else once the absent player is back: "X is back", and AFTER the reconnect time an Unpause of their own
 *    (R-VERSUS-RELIABLE-04; owner 2026-10-27: "it would simply pause when someone returned". It used to wait on the
 *    returning player's press forever);
 *  - everyone else after the reconnect time with the absent player still gone: Unpause, their last board fights;
 *  - a running 3-2-1 (from any Unpause, or the server resuming a returning heartbeat by itself): the count, cleanly.
 */
export function VersusPauseVeil(): JSX.Element | null {
  const match = useVersus((s) => s.match);
  const room = useVersus((s) => s.room);
  const seat = mySeat(match);
  const paused = !!match?.paused_at && match.phase !== 'complete';
  const graceIn = useSecondsTo(match?.pause_grace_until, paused);
  const resumeIn = useSecondsUntil(match?.resume_at ? Date.parse(match.resume_at) : undefined, paused && !!match?.resume_at);
  if (!match || !seat || !paused) return null;
  const view = versusPauseView({
    match, seat, graceIn,
    absentBack: absentIsBack(match, room?.members ?? [], versusServerNow()),
  });
  return (
    <div className="vsveil" role="status" aria-live="polite" onContextMenuCapture={blockInspect}>
      {view.kind === 'count' ? (
        <div className="vscount" aria-label={`Resuming in ${Math.max(1, resumeIn)}`}>
          <span key={resumeIn} className="endplace-num vscount-num">{Math.max(1, resumeIn)}</span>
        </div>
      ) : (
        <div className="vspanel">
          <div className="vspanel-title">{view.title}</div>
          {view.body && <div className="vspanel-body">{view.body}</div>}
          {view.action && (
            <div className="vspanel-actions">
              <button type="button" className="vsplate vsstartbtn" onClick={() => { sfx.pulse(); void (view.action === 'resume' ? resumeMatch() : unpauseMatch()); }}>Unpause</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The server's presence lease for the "is back" read: 14 s since fix/versus-server-reliability (`versus__lease()`; the
 *  sim's `VERSUS_LEASE_SECONDS` stays 12, pinned to the original migration by `versusSchema.db.test.ts`). */
export const VERSUS_PRESENCE_LEASE_SECONDS = Math.max(VERSUS_LEASE_SECONDS, 14);
/** The absent player is back in the room (a heartbeat inside the lease) but the match is still paused. */
export function absentIsBack(match: VersusMatch, members: readonly { userId: string; lastSeenAt: string }[], now: number): boolean {
  const absentUser = match.paused_seat === 'p1' ? match.p1_user : match.group?.pausedUser ?? match.p2_user;
  const seen = members.find((m) => m.userId === absentUser)?.lastSeenAt;
  return !!seen && now - Date.parse(seen) < VERSUS_PRESENCE_LEASE_SECONDS * 1000;
}

/** What the pause panel shows (pure; the rules above). `action`: `resume` (mine, I came back) or `unpause` (theirs). */
export function versusPauseView(x: { match: VersusMatch; seat: 'p1' | 'p2'; graceIn: number; absentBack: boolean }):
  { kind: 'count' } | { kind: 'panel'; title: string; body: string | null; action: 'resume' | 'unpause' | null } {
  const m = x.match;
  if (m.resume_at) return { kind: 'count' };
  // VERSUS GROUP: the absent player is whoever the table says (named on `match.group`), not "the opponent".
  const names = { p1: m.p1_name, p2: m.group?.pausedName ?? m.p2_name };
  const absent = m.paused_seat;
  const name = absent ? names[absent] : 'A player';
  if (absent === x.seat) return { kind: 'panel', title: 'Welcome back', body: 'The match is paused for you. Unpause when you are ready.', action: 'resume' };
  if (x.absentBack && x.graceIn > 0) return { kind: 'panel', title: `${name} is back`, body: 'Waiting for them to unpause.', action: null };
  if (x.absentBack) return { kind: 'panel', title: `${name} is back`, body: 'Unpause to play on.', action: 'unpause' };
  if (x.graceIn > 0) return { kind: 'panel', title: `${name} disconnected`, body: `Reconnect time ${x.graceIn}s`, action: null };
  return { kind: 'panel', title: `${name} has not come back`, body: 'Unpause to play on. Their last board fights for them, and three missed rounds forfeit.', action: 'unpause' };
}

/** Overlays stop the card inspect on whatever is behind them (live PvP 2026-10-14: right-click went through). */
export function blockInspect(e: { preventDefault: () => void; stopPropagation: () => void }): void {
  e.preventDefault();
  e.stopPropagation();
}
