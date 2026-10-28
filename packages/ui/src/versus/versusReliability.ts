/**
 * VERSUS RELIABILITY (owner 2026-10-27: Versus 1v1, Group, Versus Duos and Ranked Duos "need to be spotless
 * experiences", after End of Turn freezes "completely locking us out" and reconnects where "it would simply pause when
 * someone returned"). The client-side rules found by the 2026-10-27 audit, as small pure pieces the session loop
 * (`versusStore.ts`) reads, so each one is pinned by a unit test:
 *
 *  - WHO ASKS THE RESOLVER (R-VERSUS-RELIABLE-02): only the client whose own call closed the round asks at once; every
 *    other client waits a backstop (4 s plus a little jitter, so they never all ask together) and asks only if the
 *    round is still closed by then. One resolver call in flight per client, ever.
 *  - A WAKING TAB NEVER PAUSES THE MATCH ON ITSELF (R-VERSUS-RELIABLE-03): a tab that comes back (visible, online, or a
 *    timer gap that says it was frozen) sends its heartbeat FIRST and holds every reconcile until that answers. A
 *    reconcile from a client whose last heartbeat is minutes old would find its own seat silent and pause the match.
 *  - LOST CALLS RECOVER (R-VERSUS-RELIABLE-05): a lost End Combat is sent again; an End Turn the game could not start
 *    is tried again.
 */
import type { VersusGroupMatchRaw, VersusMatch, VersusPhase } from './versusRemote';
import type { VersusSeat } from '@game/sim';

/** How long a closed round may wait on another client's resolver call before this one asks too. Long enough that a
 *  second call rarely overlaps the first (measured live 2026-10-26: a duplicate call in flight went with the 8-11 s
 *  resolver answers, the single calls with 1.6-2.6 s). */
export const FINALIZE_BACKSTOP_MS = 4000;
/** The backstop's spread, so the clients that did not close the round never ask in the same instant. */
export const FINALIZE_JITTER_MS = 1500;
/** After this many failed resolver calls in a row for one round the player sees a short neutral notice. */
export const RESOLVE_NOTICE_AFTER = 3;
/** A 500 ms tick that comes this late means the tab was frozen (backgrounded, asleep): treat it as a wake. */
export const WAKE_GAP_MS = 3000;

/** My heartbeat counts as fresh this long after its answer: two missed 4 s beats, well inside the 12 s lease. */
export const BEAT_FRESH_MS = 9000;
/** Is my last answered heartbeat recent enough that a reconcile from me cannot find my own seat silent? */
export const beatFresh = (now: number, beatOkAt: number): boolean => beatOkAt > 0 && now - beatOkAt < BEAT_FRESH_MS;

/** When a client that did not close the round may ask the resolver: its backstop, with `rand` in [0, 1). */
export function finalizeBackstopMs(rand: number): number {
  return FINALIZE_BACKSTOP_MS + Math.floor(Math.max(0, Math.min(0.999, rand)) * FINALIZE_JITTER_MS);
}

/**
 * Does THIS answer (to my own submit / reconcile) make me the client that asks the resolver now? `closed_by_me` is the
 * server's word when it sends it. An older server does not, so the fallback is one deterministic asker: the table's
 * first live seat (`leader`). Everyone else waits the backstop. Never 'now' for a round that is not closed.
 */
export function finalizeAsk(answer: Pick<VersusMatch, 'phase'> & { closed_by_me?: boolean; closedByMe?: boolean }, leader: boolean): 'now' | 'backstop' | 'none' {
  if (answer.phase !== 'resolving') return 'none';
  const flag = answer.closed_by_me ?? answer.closedByMe;
  if (flag === true) return 'now';
  if (flag === false) return 'backstop';
  return leader ? 'now' : 'backstop';
}

/** The read of `closed_by_me` off an RPC answer (snake or camel case; anything else is "not said"). */
export function closedByMeOf(raw: unknown): boolean | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { closed_by_me?: unknown; closedByMe?: unknown };
  const v = r.closed_by_me ?? r.closedByMe;
  return typeof v === 'boolean' ? v : undefined;
}

/** 1v1: seat p1 asks first when the server does not say who closed the round. */
export const duelLeader = (seat: VersusSeat | null): boolean => seat === 'p1';

/** A group / Duos / Ranked Duos table: the first seat still playing in person (not out, not on auto, not a recorded
 *  team member) asks first when the server does not say who closed the round. */
export function groupLeader(raw: Pick<VersusGroupMatchRaw, 'seats'>, me: string | null): boolean {
  if (!me) return false;
  const live = raw.seats
    .filter((s) => s.eliminatedRound == null && !s.auto && !s.served)
    .sort((a, b) => (a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0));
  return live[0]?.userId === me;
}

/**
 * ONE RESOLVER CALL AT A TIME (R-VERSUS-RELIABLE-02), and the failure count behind the notice. `start` says whether a
 * call may go now; `done` / `failed` close it. The streak counts failures for ONE round and resets on a success or a
 * new round.
 */
export function createResolverFlight() {
  let inFlight = false;
  let streakKey: string | null = null;
  let streak = 0;
  return {
    start(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    done(key: string): void {
      inFlight = false;
      if (streakKey === key) streak = 0;
    },
    /** A failed call; returns the failures in a row for `key`. */
    failed(key: string): number {
      inFlight = false;
      if (streakKey !== key) { streakKey = key; streak = 0; }
      streak += 1;
      return streak;
    },
    busy: (): boolean => inFlight,
    reset(): void { inFlight = false; streakKey = null; streak = 0; },
  };
}

/**
 * A WAKING TAB (R-VERSUS-RELIABLE-03): `wake(beat)` runs the heartbeat once (a second wake while it is out joins it) and
 * holds reconciles until it settles, answered or failed. `held()` is what every reconcile path checks.
 */
export function createWakeGate() {
  let pending: Promise<void> | null = null;
  return {
    wake(beat: () => Promise<unknown>): Promise<void> {
      if (pending) return pending;
      const p: Promise<void> = Promise.resolve()
        .then(beat)
        .then(() => undefined, () => undefined)
        .finally(() => { if (pending === p) pending = null; });
      pending = p;
      return p;
    },
    held: (): boolean => pending !== null,
  };
}

/**
 * IS MY END COMBAT OWED TO THE SERVER? (R-VERSUS-RELIABLE-05) The fight is still the server's (`combat`, this round),
 * the row does not have me back yet, and this client IS back (it pressed End Combat for this round, or its run already
 * left the fight). A lost `combatReady` used to leave the table waiting on me for the whole combat cap.
 */
export function combatReadyOwed(x: {
  match: Pick<VersusMatch, 'phase' | 'round' | 'paused_at' | 'p1_ready' | 'p2_ready'> | null;
  seat: VersusSeat | null;
  readyRound: number | null;
  run: { mode?: string; phase: string; wave: number };
}): boolean {
  const m = x.match;
  if (!m || !x.seat || m.phase !== ('combat' as VersusPhase) || m.paused_at || x.run.mode !== 'versus') return false;
  if (m[`${x.seat}_ready`]) return false;
  const pressed = x.readyRound === m.round && x.run.phase === 'combat' && x.run.wave === m.round;
  const left = x.run.phase === 'recruit' && x.run.wave > m.round;
  return pressed || left;
}

/**
 * THE FIGHT IS IN BUT ITS END TURN NEVER STARTED (R-VERSUS-RELIABLE-05): the signal to play End Turn is up for this wave,
 * the run is still shopping it, nothing is animating and the match is not paused. The HUD's watchdog asks End Turn
 * again (it ignores a second call while its beats play).
 */
export function endTurnStalled(x: { endTurnWave: number | null; run: { mode?: string; phase: string; wave: number }; presenting: boolean; paused: boolean }): boolean {
  return x.run.mode === 'versus' && x.run.phase === 'recruit' && x.endTurnWave === x.run.wave && !x.presenting && !x.paused;
}
