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
import { standardTurnSeconds, turnClock } from '../turnClock';
import { displaySeconds, shopClockAt } from './versusClock';
import { driveVersusClock, nextObserveMs } from './versusClockFx';
import { expireVersusShop, lockTurn, unreadyTurn, mySeat, rereadVersusMatch, resumeMatch, unpauseMatch, useVersus, useVersusPaused, versusRemainingMs, versusServerNow, versusShopRemainingMs, type VersusState } from './versusStore';
import { ownRunWhileWatching, useSpectate } from './spectate';
import { VERSUS_LEASE_SECONDS } from '@game/sim';
import { sfx } from '../sfx';
import { versusReadyLabel, versusTurn, versusTurnHolds, versusTurnLocksGem, versusTurnNote, versusTurnReady, type VersusTurn } from './versusTurn';
import { markFlow } from './flowTiming';
import { SpectatorBar } from './SpectatorBar';
import { useDuosLivePublisher } from './duosLive';
import { emitPressCue } from '../pressCue';
import './versus.css';

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
export function useVersusRecruit(run: RunState, endTurn: () => void, endCombat: () => void): { intercept: () => boolean; readyNote: string | null; gemLocked: boolean; gemReady: boolean; gemLabel: string | null; clockQuiet: boolean } {
  const versus = run.mode === 'versus';
  const endTurnWave = useVersus((s) => s.endTurnWave);
  const match = useVersus((s) => s.match);
  const turn = useVersusTurn(run);
  const secondsLeft = useSecondsUntil(turn.deadline, turn.kind === 'foeReady');
  // LEAVE THE FIGHT TOGETHER (owner 2026-10-14): the next shop is open (both pressed End Combat, or the 5 s ran out),
  // so this fight leaves through its ordinary exit, a replay still playing included. Once per wave.
  const leftRef = useRef<number | null>(null);
  useEffect(() => {
    if (!versus || turn.kind !== 'leave' || leftRef.current === run.wave) return;
    leftRef.current = run.wave;
    endCombat();
  }, [versus, turn.kind, run.wave, endCombat]);
  // The fight is in: play the real End Turn (its commit lands the fight). Once per wave.
  const firedRef = useRef<number | null>(null);
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
    // in Ranked Duos (the round waits for both teammates) it names the teammate.
    readyNote: versus ? versusTurnNote(turn, secondsLeft, { cancellable: !run.shopClockExpired, overtime: !!run.shopClockExpired }) : null,
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

/**
 * The hold and the pause.
 *  - The HOLD is invisible: while the player waits on the other one (the gem's pill says so) the shop takes no input
 *    and nothing on the board changes.
 *  - The PAUSE (owner 2026-10-14: "when a player d/cs add an overlay for the reconnect time. when that player
 *    reconnects allow them to unpause which shows a 3/2/1"): the game's dark gold-rimmed panel over a dimmed screen.
 *    The opponent sees the reconnect time; the player who came back gets Unpause; then both see 3, 2, 1.
 */
export function VersusHud() {
  // RANKED DUOS: the team's Live Games row (first seat only; R-RANKED-DUOS-PARTY-01).
  useDuosLivePublisher();
  const match = useVersus((s) => s.match);
  const room = useVersus((s) => s.room);
  const mode = useGame((s) => s.run.mode);
  const phase = useGame((s) => s.run.phase);
  const wave = useGame((s) => s.run.wave);
  const seat = mySeat(match);
  const paused = !!match?.paused_at && match.phase !== 'complete';
  const graceIn = useSecondsTo(match?.pause_grace_until, paused);
  const resumeIn = useSecondsUntil(match?.resume_at ? Date.parse(match.resume_at) : undefined, paused && !!match?.resume_at);
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
  // VERSUS GROUP: the absent player is whoever the table says (named on `match.group`), not "the opponent".
  const names = { p1: match.p1_name, p2: match.group?.pausedName ?? match.p2_name };
  const absent = match.paused_seat;
  const iAmAbsent = absent === seat;
  // The absent player is back in the room (fresh heartbeat) but has not pressed Unpause yet.
  const absentUser = absent === 'p1' ? match.p1_user : match.group?.pausedUser ?? match.p2_user;
  const seen = room?.members.find((m) => m.userId === absentUser)?.lastSeenAt;
  const absentBack = !!seen && versusServerNow() - Date.parse(seen) < VERSUS_LEASE_SECONDS * 1000;

  let title = '';
  let body: string | null = null;
  let action: { label: string; press: () => void } | null = null;
  if (paused && match.resume_at) {
    title = 'Resuming';
  } else if (paused && iAmAbsent) {
    title = 'Welcome back';
    body = 'The match is paused for you. Unpause when you are ready.';
    action = { label: 'Unpause', press: () => { void resumeMatch(); } };
  } else if (paused && absentBack) {
    title = `${names[absent!]} is back`;
    body = 'Waiting for them to unpause.';
  } else if (paused && graceIn > 0) {
    title = `${names[absent!]} disconnected`;
    body = `Reconnect time ${graceIn}s`;
  } else if (paused) {
    title = `${names[absent!]} has not come back`;
    body = 'Unpause to play on. Their last board fights for them, and three missed rounds forfeit.';
    action = { label: 'Unpause', press: () => { void unpauseMatch(); } };
  }

  return (
    <>
      {held && !paused && <div className="vshold" aria-hidden="true" />}
      {match.group?.duos && !paused && phase === 'recruit' && <DuosOrderPlate />}
      {/* The teammate portrait stays bottom right in combat too (owner 2026-10-25: "also keep the teammate portrait in the
          bottom right during combat too"); there it only shows who your teammate is (passing and watching are shop-only). */}
      {match.group?.duos && !paused && (phase === 'recruit' || phase === 'combat') && <DuosMateDock watching={false} inCombat={phase === 'combat'} />}
      {paused && (
        <div className="vsveil" role="status" aria-live="polite" onContextMenuCapture={blockInspect}>
          {match.resume_at ? (
            <div className="vscount" aria-label={`Resuming in ${resumeIn}`}>
              <span key={resumeIn} className="endplace-num vscount-num">{Math.max(1, resumeIn)}</span>
            </div>
          ) : (
            <div className="vspanel">
              <div className="vspanel-title">{title}</div>
              {body && <div className="vspanel-body">{body}</div>}
              {action && (
                <div className="vspanel-actions">
                  <button type="button" className="vsplate vsstartbtn" onClick={() => { sfx.pulse(); action!.press(); }}>{action.label}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Overlays stop the card inspect on whatever is behind them (live PvP 2026-10-14: right-click went through). */
export function blockInspect(e: { preventDefault: () => void; stopPropagation: () => void }): void {
  e.preventDefault();
  e.stopPropagation();
}
