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
import { duosWaitingCount, duosWireOf, handCap, mateTribeCounts, runReadsMateTribes, type BoardCard, type RunState, type VersusGroupSeat } from '@game/sim';
import { useGame } from '../store';
import { playArrival, playSpellPass } from './passLob';
import { notePassRefused } from './duosPassUi';
import { sfx } from '../sfx';
import { ownRunWhileWatching, setMateFrameHook, teammateViewOf } from './spectate';
import { VersusError, versusRemote, type VersusDuosPassRow } from './versusRemote';

/** Server refusals that mean "this pass will never be recorded": refund it now. */
const REFUSALS = new Set(['hand_full', 'locked', 'not_shop', 'deadline_passed', 'no_teammate', 'too_many_passes', 'bad_card', 'golden', 'not_duos', 'teammate_away']);

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

/**
 * REAL-TIME COMBAT TEAM EFFECTS (R-DUOS-RUNES-02). A fight's gifts to my teammate were queued on my outbox when it LANDED
 * (`combatIdx`), and each is HELD until my replay reaches its `teamSend` beat (`duosReleaseCombatFx`, from the combat
 * sync), so my teammate sees the card arrive at that moment of the fight. Once the fight is over (settled, skipped, a
 * reload into the next shop) nothing is held: the settle path is the fallback. One outbox entry each, shipped once.
 */
const releasedFx = { wave: -1, idx: new Set<number>() };
const heldForReplay = (run: RunState, e: { wave: number; combatIdx?: number }): boolean =>
  e.combatIdx != null && run.phase === 'combat' && !run.combatSettled && e.wave === run.wave
  && !(releasedFx.wave === e.wave && releasedFx.idx.has(e.combatIdx));

/** The replay reached these carry indices of my board's team effects: ship them now. */
export function duosReleaseCombatFx(idx: readonly number[]): void {
  const run = useGame.getState().run;
  if (releasedFx.wave !== run.wave) { releasedFx.wave = run.wave; releasedFx.idx = new Set(); }
  let fresh = false;
  for (const i of idx) if (!releasedFx.idx.has(i)) { releasedFx.idx.add(i); fresh = true; }
  if (fresh && ses) duosAfterRun(ses.matchId, ses.me, run);
}

/** After every committed change of my run: send new passes and report my hand room. */
export function duosAfterRun(matchId: string, me: VersusGroupSeat, run: RunState): void {
  if (!run.duos || run.mode !== 'versus') return;
  const s = session(matchId, me);
  if (!s.ready) { if (!s.reconciling) void reconcile(s); return; }
  for (const e of run.duos.outbox) {
    const idx = e.seq;
    if (idx < s.firstNew && !s.seqOf.has(idx)) continue; // sent before (in an earlier session of this match)
    if (s.shipped.has(idx) || e.refunded || s.inFlight.has(idx)) continue;
    if (heldForReplay(run, e)) continue; // a mid-fight gift waits for its beat (R-DUOS-RUNES-02)
    const seq = seqFor(s, idx);
    s.inFlight.add(idx);
    // A SPELL's pass (Handout, R-DUOS-CARDS-01): the minion streams from where it stood into the teammate portrait. This
    // runs inside the store's commit, before React drops the card, so its element is still there to start from.
    if (e.via === 'spell' && !ownRunWhileWatching()) playSpellPass(e.card.uid);
    if (!e.team) lastRefusal = null;
    void versusRemote.duosPass(matchId, e.wave, seq, duosWireOf(e)).then(() => {
      s.shipped.add(idx);
    }).catch((err: unknown) => {
      const code = err instanceof VersusError ? err.code : '';
      if (REFUSALS.has(code)) {
        s.shipped.add(idx);
        dispatch({ type: 'passRefunded', seq: idx });
        // A TEAM EFFECT (a gift, team max Gold) never took anything from me: nothing came back, so nothing to say.
        if (!e.team) { lastRefusal = { seq: idx, reason: code }; sayReturned(code); }
      }
      // Anything else (offline, a blip): the next run change retries it.
    }).finally(() => s.inFlight.delete(idx));
  }
  duosNoteMate(run);
  // My free hand slots, when they changed.
  // Effect passes still waiting for room (R-DUOS-EFFECT-PASS-QUEUE-01) take theirs first, so a drag pass is refused up front.
  const room = Math.max(0, handCap(run) - run.hand.length - duosWaitingCount(run));
  if (room !== s.room) {
    s.room = room;
    void versusRemote.duosHandRoom(matchId, room).catch(() => { if (ses === s) s.room = null; });
  }
}

/**
 * MATCHMAKER (R-DUOS-CARDS-05): my run's record of my teammate's board (minions per tribe of their run), from their
 * live frame. Dispatched (`noteMateTribes`, a recorded action, so a replay reproduces the Shout's pick) only when it
 * CHANGED and only while my run holds a card that reads it, so an ordinary Duos game records nothing extra. Called
 * after my run changes and when a frame of theirs arrives. Never while my screen shows their run.
 */
export function duosNoteMate(run: RunState = useGame.getState().run): void {
  if (!ses || run.mode !== 'versus' || !runReadsMateTribes(run) || ownRunWhileWatching()) return;
  const mate = mateOf(ses.me);
  const view = teammateViewOf(mate) as unknown as { board?: unknown; tribes?: unknown } | null;
  if (!view || !Array.isArray(view.board) || !Array.isArray(view.tribes)) return;
  const tribes = mateTribeCounts(view.board as BoardCard[], view.tribes as RunState['tribes']);
  const had = run.duos?.mateTribes ?? {};
  const keys = new Set([...Object.keys(had), ...Object.keys(tribes)]) as Set<keyof typeof tribes>;
  for (const k of keys) {
    if ((had[k] ?? -1) !== (tribes[k] ?? -1)) { dispatch({ type: 'noteMateTribes', tribes }); return; }
  }
}

setMateFrameHook(() => duosNoteMate());

/** My teammate's seat (Duos teams: p1 + p2, p3 + p4). */
const mateOf = (me: VersusGroupSeat): VersusGroupSeat => ({ p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' } as Record<string, VersusGroupSeat>)[me] ?? me;

const seqFor = (s: DuosSession, idx: number): number => s.seqOf.get(idx) ?? s.base + (idx - s.firstNew);
const idxFor = (s: DuosSession, seq: number): number | null => {
  for (const [i, q] of s.seqOf) if (q === seq) return i;
  const i = s.firstNew + (seq - s.base);
  return seq >= s.base && i >= s.firstNew ? i : null;
};

/**
 * HOW MY RESTORED OUTBOX LINES UP WITH THE SERVER'S ROWS (pure). Matched by IDENTITY, never by position: an entry and a
 * row are the same pass when they carry the same card in the same round, where the card is its uid AND the pass key it
 * last arrived through (`passKey`, absent on a card I never received), and a row the receiver refused pairs with a
 * refunded entry while a sent or landed row pairs with one that was not. (By position was wrong: a pass the server
 * refused up front never gets a row, so every later entry slid onto the wrong row and a restored run could pass a card
 * twice; found in the phase-3 live test, 2026-10-25. The pass key keeps a card passed back and forth in one round,
 * A->B->A, one pass per row: owner 2026-10-25, "you should be able to pass cards back to your teammate".)
 *  - `seqOf`: outbox index -> the server seq it already is;
 *  - `repass`: rows the server holds that my restored run has no entry for (played again on my run when the card is
 *    still here, so the card leaves and the Gold is paid as it was the first time);
 *  - `unsent`: entries the server never recorded and never refused (they still go out, under fresh numbers).
 */
type LineUpRow = Pick<VersusDuosPassRow, 'seq' | 'round' | 'card' | 'status'> & { created_at?: string };
export function lineUpOutbox<R extends LineUpRow>(
  outbox: readonly { wave: number; card: { uid?: unknown; passKey?: unknown }; refunded?: true }[],
  rows: readonly R[],
): { seqOf: Map<number, number>; repass: R[]; unsent: number[] } {
  const seqOf = new Map<number, number>();
  const repass: R[] = [];
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  for (const r of sorted) {
    const uid = typeof r.card.uid === 'string' ? r.card.uid : null;
    const key = keyOf(r.card);
    const refusedRow = r.status === 'refused';
    const same = (e: (typeof outbox)[number]): boolean => e.wave === r.round && e.card.uid === uid && keyOf(e.card) === key;
    let hit = -1;
    for (let i = 0; i < outbox.length && hit < 0; i++) {
      const e = outbox[i]!;
      if (!seqOf.has(i) && same(e) && !!e.refunded === refusedRow) hit = i;
    }
    // A row still 'sent' whose entry my run already refunded (the answer crossed the reload): the same pass.
    if (hit < 0) for (let i = 0; i < outbox.length && hit < 0; i++) {
      if (!seqOf.has(i) && same(outbox[i]!)) hit = i;
    }
    if (hit >= 0) seqOf.set(hit, r.seq); else repass.push(r);
  }
  const unsent: number[] = [];
  outbox.forEach((e, i) => { if (!seqOf.has(i) && !e.refunded) unsent.push(i); });
  return { seqOf, repass, unsent };
}

const keyOf = (card: { passKey?: unknown }): string | null => (typeof card.passKey === 'string' ? card.passKey : null);

/** A server timestamp in microseconds (Postgres text keeps them: `2026-10-25T12:00:00.12345+00:00`), for the replay
 *  order. Null when absent or unreadable (the replay then falls back to round and seq). */
export function atMicros(at: unknown): number | null {
  if (at instanceof Date) return at.getTime() * 1000;
  if (typeof at !== 'string' || !at) return null;
  const m = /^([^.]*?)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(at.replace(' ', 'T'));
  if (!m) return null;
  const whole = Date.parse(`${m[1]}${m[3] ?? 'Z'}`);
  if (!Number.isFinite(whole)) return null;
  return whole * 1000 + Number(`${m[2] ?? ''}000000`.slice(0, 6));
}

type ReplayAction =
  | { type: 'receivePass'; from: string; seq: number; card: BoardCard }
  | { type: 'passCard'; uid: string }
  | { type: 'passRefunded'; seq: number };

/**
 * THE RESTORE REPLAY (pure over the injected run access; a reload mid-match). My run came back from its last lock, so
 * this round's passes, both ways, are missing from it. Line my outbox up with my rows (`lineUpOutbox`), then replay the
 * round in the ORDER THE SERVER RECORDED IT: a teammate's pass lands (`receivePass`; a refused row never lands, its
 * sender already got the card back), and one of mine is played again (`passCard`, so the card leaves and the Gold is
 * paid; a receiver-refused one is refunded at once, so the card is there for a later pass of it). The card a row names
 * is found by the pass key it arrived through when it has one (a restored run gives a re-landed card a fresh uid), else
 * by its uid among the cards I never received. So A->B->A->B lands exactly once per hop after a reload, with each hop's
 * Gold paid once: nothing duplicates, nothing vanishes (owner 2026-10-25, passing back).
 */
export function replayRestore(
  getRun: () => RunState,
  act: (a: ReplayAction) => void,
  me: VersusGroupSeat,
  rows: readonly VersusDuosPassRow[],
): { seqOf: Map<number, number>; shipped: Set<number>; next: number; answers: { from: VersusGroupSeat; seq: number; landed: boolean }[] } {
  const mine = rows.filter((r) => r.from_seat === me);
  const plan = lineUpOutbox(getRun().duos?.outbox ?? [], mine);
  let next = mine.length ? Math.max(...mine.map((r) => r.seq)) + 1 : 0;
  const seqOf = new Map<number, number>();
  const shipped = new Set<number>();
  for (const [i, q] of plan.seqOf) { seqOf.set(i, q); shipped.add(i); }
  // Entries the server never saw keep their place in line, under fresh numbers.
  for (const i of plan.unsent) seqOf.set(i, next++);
  // Refunded entries with no row (refused up front) are done.
  (getRun().duos?.outbox ?? []).forEach((e, i) => { if (!seqOf.has(i) && e.refunded) shipped.add(i); });
  const answered = (r: VersusDuosPassRow): boolean => {
    const d = getRun().duos;
    const key = `${r.from_seat}:${r.seq}`;
    return !d || d.received.includes(key) || d.refused.includes(key);
  };
  const at = (r: VersusDuosPassRow): number => atMicros(r.created_at) ?? 0;
  const events = [
    ...rows.filter((r) => r.to_seat === me && r.status !== 'refused' && !answered(r)).map((r) => ({ r, inbound: true })),
    ...plan.repass.map((r) => ({ r, inbound: false })),
  ].sort((a, b) => a.r.round - b.r.round || at(a.r) - at(b.r) || (a.inbound === b.inbound ? a.r.seq - b.r.seq : a.inbound ? -1 : 1));
  const answers: { from: VersusGroupSeat; seq: number; landed: boolean }[] = [];
  for (const { r, inbound } of events) {
    if (inbound) {
      if (answered(r)) continue;
      act({ type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card as unknown as BoardCard });
      const d = getRun().duos;
      const key = `${r.from_seat}:${r.seq}`;
      const landed = !!d?.received.includes(key);
      if (r.status === 'sent' && (landed || d?.refused.includes(key))) answers.push({ from: r.from_seat, seq: r.seq, landed });
      continue;
    }
    const live = getRun();
    if (r.round !== live.wave) continue;
    const key = keyOf(r.card);
    const uid = typeof r.card.uid === 'string' ? r.card.uid : null;
    const card = key ? live.hand.find((c) => c.passKey === key) : live.hand.find((c) => c.uid === uid && !c.passKey);
    if (!card) continue;
    const before = live.duos?.outbox.length ?? 0;
    act({ type: 'passCard', uid: card.uid });
    if ((getRun().duos?.outbox.length ?? 0) <= before) continue;
    seqOf.set(before, r.seq);
    shipped.add(before);
    if (r.status === 'refused') act({ type: 'passRefunded', seq: before });
  }
  return { seqOf, shipped, next, answers };
}

/** RESTORE (a reload mid-match): line my run's outbox up with the passes the server already holds, both ways. */
async function reconcile(s: DuosSession): Promise<void> {
  s.reconciling = true;
  try {
    const rows = await versusRemote.duosPasses(s.matchId, 1);
    if (ses !== s) return;
    const res = replayRestore(() => useGame.getState().run, dispatch, s.me, rows);
    for (const [i, q] of res.seqOf) s.seqOf.set(i, q);
    for (const i of res.shipped) s.shipped.add(i);
    for (const a of res.answers) void versusRemote.duosAnswerPass(s.matchId, a.from, a.seq, a.landed).catch(() => undefined);
    s.firstNew = useGame.getState().run.duos?.outbox.length ?? 0;
    s.base = res.next;
    s.ready = true;
  } catch { /* retried on the next run change */ } finally { s.reconciling = false; }
  // Anything recorded while the replay ran (the pull waits for the replay: it must never land a pass out of order).
  if (s.ready && ses === s) void duosPull(s.matchId, s.me, useGame.getState().run.wave);
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
  // Until the restore replay has run, nothing lands here: it lands this round's passes itself, in the server's order.
  if (!s.ready) return;
  for (const r of rows) {
    const run = useGame.getState().run;
    if (!run.duos) return;
    if (r.to_seat === s.me) {
      const key = `${r.from_seat}:${r.seq}`;
      const answered = run.duos.received.includes(key) || run.duos.refused.includes(key);
      // A row my run already refused (before a reload) never lands: its sender has that card back.
      if (!answered && r.status !== 'refused') {
        const before = new Set(run.hand.map((c) => c.uid));
        const triples = run.triplesMade ?? 0;
        dispatch({ type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card as unknown as BoardCard });
        // The lob in (R-DUOS-PASS-01): the card drops out of my teammate's portrait into my hand. A pass that completed
        // a triple (R-DUOS-PASS-06) shows the Gild instead (Recruit's `triplesMade` watcher: the trails into the golden).
        const after = useGame.getState().run;
        const got = after.hand.find((c) => !before.has(c.uid));
        if (got && (after.triplesMade ?? 0) === triples && !ownRunWhileWatching()) playArrival(got.uid);
      }
      if (r.status === 'sent') {
        const after = useGame.getState().run.duos;
        const landed = !!after?.received.includes(key);
        if (landed || after?.refused.includes(key)) void versusRemote.duosAnswerPass(s.matchId, r.from_seat, r.seq, landed).catch(() => undefined);
      }
    } else if (r.from_seat === s.me && r.status === 'refused') {
      const idx = idxFor(s, r.seq);
      const e = idx == null ? undefined : run.duos.outbox[idx];
      if (e && !e.refunded) {
        dispatch({ type: 'passRefunded', seq: idx! });
        if (!e.team) { lastRefusal = { seq: idx!, reason: 'hand_full' }; sayReturned('hand_full'); }
      }
    }
  }
}


/** Leaving the match. */
export function duosReset(): void { ses = null; lastRefusal = null; }
