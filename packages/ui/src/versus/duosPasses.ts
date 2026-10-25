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
import { oppHandBackSrc } from '../oppHandModel';
import { publicArt } from '../phoneArt';
import { playArrival } from './passLob';
import { notePassRefused } from './duosPassUi';
import { sfx } from '../sfx';
import { ownRunWhileWatching } from './spectate';
import { VersusError, versusRemote, type VersusDuosPassRow } from './versusRemote';

/** Server refusals that mean "this pass will never be recorded": refund it now. */
const REFUSALS = new Set(['hand_full', 'locked', 'not_shop', 'deadline_passed', 'no_teammate', 'too_many_passes', 'bad_card', 'not_duos', 'teammate_away']);

/** A pass came back (the card and the Gold are mine again): say so on the teammate's portrait, with the deny sound, so
 *  a card reappearing is never a silent surprise (phase-3 live test, 2026-10-25). */
function sayReturned(code: string): void {
  if (ownRunWhileWatching()) return;
  sfx.deny?.();
  notePassRefused(code === 'hand_full' ? 'Their hand was full. You got it back.' : code === 'teammate_away' ? 'Your teammate is away. You got it back.' : 'Pass returned. You got it back.');
}

interface DuosSession {
  matchId: string; me: VersusGroupSeat; inFlight: Set<number>; room: number | null; pulling: boolean; again: boolean;
  /** RESTORE (a reload mid-match): my run came back from its last lock, so its outbox may lag what the server already
   *  holds. `ready` once reconciled; outbox index -> server seq for the entries reconciled, then `base` onwards. */
  ready: boolean; reconciling: boolean; seqOf: Map<number, number>; base: number; firstNew: number; shipped: Set<number>;
}
let ses: DuosSession | null = null;

/** The latest server refusal reason for one of my passes (the drag's refusal pill reads it), cleared on the next pass. */
let lastRefusal: { seq: number; reason: string } | null = null;
export const duosLastRefusal = (): { seq: number; reason: string } | null => lastRefusal;

function session(matchId: string, me: VersusGroupSeat): DuosSession {
  if (!ses || ses.matchId !== matchId || ses.me !== me) {
    ses = { matchId, me, inFlight: new Set(), room: null, pulling: false, again: false, ready: false, reconciling: false, seqOf: new Map(), base: 0, firstNew: 0, shipped: new Set() };
  }
  return ses;
}

const dispatch = (a: Parameters<ReturnType<typeof useGame.getState>['dispatch']>[0]): void => useGame.getState().dispatch(a);

/** After every committed change of my run: send new passes and report my hand room. */
export function duosAfterRun(matchId: string, me: VersusGroupSeat, run: RunState): void {
  if (!run.duos || run.mode !== 'versus') return;
  const s = session(matchId, me);
  if (!s.ready) { if (!s.reconciling) void reconcile(s); return; }
  for (const e of run.duos.outbox) {
    const idx = e.seq;
    if (idx < s.firstNew && !s.seqOf.has(idx)) continue; // sent before (in an earlier session of this match)
    if (s.shipped.has(idx) || e.refunded || s.inFlight.has(idx)) continue;
    const seq = seqFor(s, idx);
    s.inFlight.add(idx);
    lastRefusal = null;
    void versusRemote.duosPass(matchId, e.wave, seq, stripCard(e.card)).then(() => {
      s.shipped.add(idx);
    }).catch((err: unknown) => {
      const code = err instanceof VersusError ? err.code : '';
      if (REFUSALS.has(code)) {
        s.shipped.add(idx);
        lastRefusal = { seq: idx, reason: code };
        dispatch({ type: 'passRefunded', seq: idx });
        sayReturned(code);
      }
      // Anything else (offline, a blip): the next run change retries it.
    }).finally(() => s.inFlight.delete(idx));
  }
  // My free hand slots, when they changed.
  const room = Math.max(0, handCap(run) - run.hand.length);
  if (room !== s.room) {
    s.room = room;
    void versusRemote.duosHandRoom(matchId, room).catch(() => { if (ses === s) s.room = null; });
  }
}

const seqFor = (s: DuosSession, idx: number): number => s.seqOf.get(idx) ?? s.base + (idx - s.firstNew);
const idxFor = (s: DuosSession, seq: number): number | null => {
  for (const [i, q] of s.seqOf) if (q === seq) return i;
  const i = s.firstNew + (seq - s.base);
  return seq >= s.base && i >= s.firstNew ? i : null;
};

/**
 * HOW MY RESTORED OUTBOX LINES UP WITH THE SERVER'S ROWS (pure). Matched by IDENTITY, never by position: an entry and a
 * row are the same pass when they carry the same card (uid) in the same round, and a row the receiver refused pairs
 * with a refunded entry while a sent or landed row pairs with one that was not. (By position was wrong: a pass the
 * server refused up front never gets a row, so every later entry slid onto the wrong row and a restored run could pass
 * a card twice; found in the phase-3 live test, 2026-10-25.)
 *  - `seqOf`: outbox index -> the server seq it already is;
 *  - `repass`: rows the server holds that my restored run has no entry for (played again on my run when the card is
 *    still here, so the card leaves and the Gold is paid as it was the first time);
 *  - `unsent`: entries the server never recorded and never refused (they still go out, under fresh numbers).
 */
export function lineUpOutbox(
  outbox: readonly { wave: number; card: { uid?: unknown }; refunded?: true }[],
  rows: readonly Pick<VersusDuosPassRow, 'seq' | 'round' | 'card' | 'status'>[],
): { seqOf: Map<number, number>; repass: Pick<VersusDuosPassRow, 'seq' | 'round' | 'card' | 'status'>[]; unsent: number[] } {
  const seqOf = new Map<number, number>();
  const repass: Pick<VersusDuosPassRow, 'seq' | 'round' | 'card' | 'status'>[] = [];
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  for (const r of sorted) {
    const uid = typeof r.card.uid === 'string' ? r.card.uid : null;
    const refusedRow = r.status === 'refused';
    let hit = -1;
    for (let i = 0; i < outbox.length && hit < 0; i++) {
      const e = outbox[i]!;
      if (seqOf.has(i) || e.wave !== r.round || e.card.uid !== uid) continue;
      if (!!e.refunded === refusedRow) hit = i;
    }
    // A row still 'sent' whose entry my run already refunded (the answer crossed the reload): the same pass.
    if (hit < 0) for (let i = 0; i < outbox.length && hit < 0; i++) {
      const e = outbox[i]!;
      if (!seqOf.has(i) && e.wave === r.round && e.card.uid === uid) hit = i;
    }
    if (hit >= 0) seqOf.set(hit, r.seq); else repass.push(r);
  }
  const unsent: number[] = [];
  outbox.forEach((e, i) => { if (!seqOf.has(i) && !e.refunded) unsent.push(i); });
  return { seqOf, repass, unsent };
}

/** RESTORE (a reload mid-match): line my run's outbox up with the passes the server already holds from me. */
async function reconcile(s: DuosSession): Promise<void> {
  s.reconciling = true;
  try {
    const rows = (await versusRemote.duosPasses(s.matchId, 1)).filter((r) => r.from_seat === s.me);
    if (ses !== s) return;
    const plan = lineUpOutbox(useGame.getState().run.duos?.outbox ?? [], rows);
    let next = rows.length ? Math.max(...rows.map((r) => r.seq)) + 1 : 0;
    for (const [i, q] of plan.seqOf) { s.seqOf.set(i, q); s.shipped.add(i); }
    // Entries the server never saw keep their place in line, under fresh numbers.
    for (const i of plan.unsent) s.seqOf.set(i, next++);
    // Refunded entries with no row (refused up front) are done.
    (useGame.getState().run.duos?.outbox ?? []).forEach((e, i) => { if (!s.seqOf.has(i) && e.refunded) s.shipped.add(i); });
    for (const r of plan.repass) {
      const uid = typeof r.card.uid === 'string' ? r.card.uid : null;
      const live = useGame.getState().run;
      const here = !!uid && [...live.hand, ...live.board].some((c) => c.uid === uid);
      if (!here || r.round !== live.wave) continue;
      const before = live.duos?.outbox.length ?? 0;
      dispatch({ type: 'passCard', uid: uid! });
      const after = useGame.getState().run.duos?.outbox.length ?? 0;
      if (after > before) { s.seqOf.set(before, r.seq); s.shipped.add(before); }
    }
    s.firstNew = useGame.getState().run.duos?.outbox.length ?? 0;
    s.base = next;
    s.ready = true;
  } catch { /* retried on the next run change */ } finally { s.reconciling = false; }
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
      if (!answered) {
        const before = new Set(run.hand.map((c) => c.uid));
        dispatch({ type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card as unknown as BoardCard });
        // The lob in (R-DUOS-PASS-01): the card drops out of my teammate's portrait into my hand.
        const got = useGame.getState().run.hand.find((c) => !before.has(c.uid));
        if (got && !ownRunWhileWatching()) playArrival(got.uid, oppHandBackSrc(null, publicArt('frames/cardplate-standard.webp')));
      }
      if (r.status === 'sent') {
        const after = useGame.getState().run.duos;
        const landed = !!after?.received.includes(key);
        if (landed || after?.refused.includes(key)) void versusRemote.duosAnswerPass(s.matchId, r.from_seat, r.seq, landed).catch(() => undefined);
      }
    } else if (r.from_seat === s.me && r.status === 'refused' && s.ready) {
      const idx = idxFor(s, r.seq);
      const e = idx == null ? undefined : run.duos.outbox[idx];
      if (e && !e.refunded) { lastRefusal = { seq: idx!, reason: 'hand_full' }; dispatch({ type: 'passRefunded', seq: idx! }); sayReturned('hand_full'); }
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
