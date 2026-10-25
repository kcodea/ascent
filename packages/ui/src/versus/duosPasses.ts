/**
 * VERSUS DUOS — the pass transport (owner 2026-10-25, R-DUOS-PASS-01). Pure plumbing between my run's recorded pass
 * actions and the server's `versus_duos_passes` rows; the run itself stays the authority on its hand and Gold.
 *
 *  - OUT: every new `duos.outbox` entry is sent once (`versus_duos_pass`). A server refusal ("Pass is refused if hand
 *    is full", the clock, the lock) gives the card and the Gold back at once (`passRefunded`).
 *  - IN: a teammate's pass row lands through `receivePass`; my run's answer (landed, or refused by a full hand) goes
 *    back to the server (`versus_duos_answer_pass`), which tells the sender.
 *  - REFUSED ON ARRIVAL: one of MY passes the teammate's full hand refused comes back through `passRefunded`.
 *  - HAND ROOM: my free hand slots, reported whenever they change, so the server refuses a pass to a full hand up front.
 * Network only off the hot path: nothing here runs per frame; a shop click never waits on it.
 */
import { handCap, type BoardCard, type RunState, type VersusGroupSeat } from '@game/sim';
import { useGame } from '../store';
import { VersusError, versusRemote, type VersusDuosPassRow } from './versusRemote';

/** Server refusals that mean "this pass will never be recorded": refund it now. */
const REFUSALS = new Set(['hand_full', 'locked', 'not_shop', 'deadline_passed', 'no_teammate', 'too_many_passes', 'bad_card', 'not_duos']);

interface DuosSession { matchId: string; me: VersusGroupSeat; shipped: number; inFlight: Set<number>; room: number | null; pulling: boolean; again: boolean }
let ses: DuosSession | null = null;

/** The latest server refusal reason for one of my passes (the drag's refusal pill reads it), cleared on the next pass. */
let lastRefusal: { seq: number; reason: string } | null = null;
export const duosLastRefusal = (): { seq: number; reason: string } | null => lastRefusal;

function session(matchId: string, me: VersusGroupSeat): DuosSession {
  if (!ses || ses.matchId !== matchId || ses.me !== me) ses = { matchId, me, shipped: -1, inFlight: new Set(), room: null, pulling: false, again: false };
  return ses;
}

const dispatch = (a: Parameters<ReturnType<typeof useGame.getState>['dispatch']>[0]): void => useGame.getState().dispatch(a);

/** After every committed change of my run: send new passes and report my hand room. */
export function duosAfterRun(matchId: string, me: VersusGroupSeat, run: RunState): void {
  if (!run.duos || run.mode !== 'versus') return;
  const s = session(matchId, me);
  // A restored run (a reload) starts its outbox again from its checkpoint: what it holds was sent before.
  if (s.shipped < 0) s.shipped = Math.max(-1, ...run.duos.outbox.filter((e) => e.wave < run.wave).map((e) => e.seq));
  for (const e of run.duos.outbox) {
    if (e.seq <= s.shipped || e.refunded || s.inFlight.has(e.seq)) continue;
    s.inFlight.add(e.seq);
    lastRefusal = null;
    const seq = e.seq;
    void versusRemote.duosPass(matchId, e.wave, seq, stripCard(e.card)).then(() => {
      s.shipped = Math.max(s.shipped, seq);
    }).catch((err: unknown) => {
      const code = err instanceof VersusError ? err.code : '';
      if (REFUSALS.has(code)) {
        s.shipped = Math.max(s.shipped, seq);
        lastRefusal = { seq, reason: code };
        dispatch({ type: 'passRefunded', seq });
      }
      // Anything else (offline, a blip): the next run change retries it.
    }).finally(() => s.inFlight.delete(seq));
  }
  // My free hand slots, when they changed.
  const room = Math.max(0, handCap(run) - run.hand.length);
  if (room !== s.room) {
    s.room = room;
    void versusRemote.duosHandRoom(matchId, room).catch(() => { if (ses === s) s.room = null; });
  }
}

/** A pass arrived or was answered (a realtime wake, or a match refresh): land / refund what is new. */
export async function duosPull(matchId: string, me: VersusGroupSeat, round: number): Promise<void> {
  const s = session(matchId, me);
  if (s.pulling) { s.again = true; return; }
  s.pulling = true;
  try {
    do {
      s.again = false;
      const rows = await versusRemote.duosPasses(matchId, Math.max(1, round - 1));
      if (ses !== s) return;
      applyRows(s, rows);
    } while (s.again);
  } catch { /* the next wake retries */ } finally { s.pulling = false; }
}

function applyRows(s: DuosSession, rows: readonly VersusDuosPassRow[]): void {
  for (const r of rows) {
    const run = useGame.getState().run;
    if (!run.duos) return;
    if (r.to_seat === s.me) {
      const key = `${r.from_seat}:${r.seq}`;
      const answered = run.duos.received.includes(key) || run.duos.refused.includes(key);
      if (!answered) dispatch({ type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card as unknown as BoardCard });
      if (r.status === 'sent') {
        const after = useGame.getState().run.duos;
        const landed = !!after?.received.includes(key);
        if (landed || after?.refused.includes(key)) void versusRemote.duosAnswerPass(s.matchId, r.from_seat, r.seq, landed).catch(() => undefined);
      }
    } else if (r.from_seat === s.me && r.status === 'refused') {
      const e = run.duos.outbox[r.seq];
      if (e && !e.refunded) { lastRefusal = { seq: r.seq, reason: 'hand_full' }; dispatch({ type: 'passRefunded', seq: r.seq }); }
    }
  }
}

/** The card as it travels: its own fields only (run-scoped presentation scratch never rides along). */
function stripCard(card: BoardCard): BoardCard {
  const { passedWave: _p, ...rest } = card;
  void _p;
  return rest as BoardCard;
}

/** Leaving the match. */
export function duosReset(): void { ses = null; lastRefusal = null; }
