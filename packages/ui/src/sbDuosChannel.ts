/**
 * THE SCENE BUILDER'S LOCAL TEAM CHANNEL (DEV, owner ask 2026-10-31, R-SB-DUOS-01). Pure over injected run access.
 *
 * In a real Duos match a pass travels my run's `duos.outbox` -> the Worker (`groupMatch.pass`, which may refuse it) ->
 * the teammate's run (`receivePass`) -> the answer back (a full hand's refusal comes home as `passRefunded`). The rig
 * has no Worker: its placeholder teammate is a second run in the browser. This is that round trip done locally, with
 * the SAME run actions on both sides (the reducer's `receivePass` / `passRefunded` / `noteMateTribes`, so
 * `receiveDuosPass`, `receiveTeamEffect`, the pass triggers, the waiting queue and the triple check all run exactly as
 * they do in a match) and the Worker's own refusals mirrored in between:
 *  - a Golden card never passes, except a Salesman of the Year sale (`passFrom: 'sale'`);
 *  - a manual drag pass is refused when the receiver has no hand room (its hand plus the effect passes waiting for
 *    room), never an effect pass (it waits on the receiver's run) or a team effect;
 *  - at most `VERSUS_DUOS_PASS_CAP` card passes per sender per round (team effects ride their own, wider cap).
 * Not mirrored, because the placeholder teammate never leaves or pauses: `teammate_away`, `no_teammate`, the shop clock.
 *
 * A combat team effect (`combatIdx`) is held while its fight is on screen until the replay reaches its `teamSend` beat
 * (`released`), exactly as `duosPasses.ts` holds it; once the fight is settled nothing is held.
 */
import { VERSUS_DUOS_PASS_CAP, duosWaitingCount, duosWireOf, handCap, mateTribeCounts, runReadsMateTribes, type Action, type DuosOutboxEntry, type RunState } from '@game/sim';

/** The two seats of the local team: p1 = the player, p2 = the placeholder teammate (the real Duos team's seat ids). */
export type SbSeat = 'p1' | 'p2';
export const SB_SEATS: readonly SbSeat[] = ['p1', 'p2'];
export const sbMateOf = (seat: SbSeat): SbSeat => (seat === 'p1' ? 'p2' : 'p1');

/** The Worker's own per-round cap on team-effect rows (`DUOS_TEAM_FX_CAP` in workers/versus groupMatch.ts). */
export const SB_TEAM_FX_CAP = 60;

/** What the channel has already done (one per local team; reset with the team). */
export interface SbLedger {
  /** Outbox indices already shipped (delivered or refused), per sender. */
  shipped: Record<SbSeat, Set<number>>;
  /** Rows "on the server" per sender and round, card passes and team effects counted apart (the caps). */
  rows: Record<SbSeat, Map<string, number>>;
  /** Combat team effects the replay has reached, per sender: wave -> carry indices. */
  released: Record<SbSeat, Map<number, Set<number>>>;
}

export function newSbLedger(): SbLedger {
  return {
    shipped: { p1: new Set(), p2: new Set() },
    rows: { p1: new Map(), p2: new Map() },
    released: { p1: new Map(), p2: new Map() },
  };
}

/** What happened on one delivery (the rig plays the FX / the refusal note from these). */
export type SbChannelEvent =
  | { kind: 'landed'; from: SbSeat; to: SbSeat; seq: number; team: boolean; uids: string[]; triple: boolean }
  | { kind: 'refused'; from: SbSeat; to: SbSeat; seq: number; team: boolean; reason: string };

/** The replay reached these `teamSend` beats of `seat`'s fight on `wave`. */
export function releaseSbCombatFx(ledger: SbLedger, seat: SbSeat, wave: number, idx: readonly number[]): void {
  const m = ledger.released[seat];
  const set = m.get(wave) ?? new Set<number>();
  for (const i of idx) set.add(i);
  m.set(wave, set);
}

/** A mid-fight gift waits for its beat (R-DUOS-RUNES-02), as `duosPasses.ts` holds it. */
function heldForReplay(run: RunState, e: DuosOutboxEntry, ledger: SbLedger, seat: SbSeat): boolean {
  return e.combatIdx != null && run.phase === 'combat' && !run.combatSettled && e.wave === run.wave
    && !(ledger.released[seat].get(e.wave)?.has(e.combatIdx) ?? false);
}

/** The receiver's free hand slots as the Worker sees them (`versus_duos_hand_room`: hand + waiting effect passes). */
export const sbHandRoom = (run: RunState): number => Math.max(0, handCap(run) - run.hand.length - duosWaitingCount(run));

/** The Worker's refusal of this row before it reaches the teammate (`groupMatch.pass`), or null. */
export function sbWorkerRefusal(e: DuosOutboxEntry, to: RunState, ledger: SbLedger, from: SbSeat): string | null {
  const wire = duosWireOf(e);
  const team = wire.passFrom === 'team';
  if (!team && wire.passFrom !== 'spell' && wire.passFrom !== 'sale' && sbHandRoom(to) <= 0) return 'hand_full';
  if (!team && wire.golden === true && wire.passFrom === 'spell') return 'golden'; // R-DUOS-PASS-GOLDEN-MANUAL-01
  const rowKey = `${e.wave}:${team ? 'team' : 'card'}`;
  if ((ledger.rows[from].get(rowKey) ?? 0) >= (team ? SB_TEAM_FX_CAP : VERSUS_DUOS_PASS_CAP)) return 'too_many_passes';
  return null;
}

/**
 * Deliver everything new, both ways, until nothing moves (a pass that lands can trigger a team effect back: Hitchhiker,
 * Spell Theory). `get` reads a seat's live run; `act` applies a run action to it (the on-screen run through the store's
 * dispatch, the other through `reduce`). Bounded: every entry ships once, and the loop stops after a few rounds.
 */
export function deliverSbTeam(get: (seat: SbSeat) => RunState, act: (seat: SbSeat, a: Action) => void, ledger: SbLedger): SbChannelEvent[] {
  const events: SbChannelEvent[] = [];
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const from of SB_SEATS) {
      const to = sbMateOf(from);
      const outbox = get(from).duos?.outbox ?? [];
      for (let i = 0; i < outbox.length; i++) {
        const e = get(from).duos?.outbox[i];
        if (!e || ledger.shipped[from].has(e.seq)) continue;
        if (e.refunded) { ledger.shipped[from].add(e.seq); continue; }
        if (heldForReplay(get(from), e, ledger, from)) continue;
        if (!get(to).duos) continue; // the teammate is not a Duos run (yet): it waits
        ledger.shipped[from].add(e.seq);
        moved = true;
        const team = !!e.team;
        const why = sbWorkerRefusal(e, get(to), ledger, from);
        if (why) {
          act(from, { type: 'passRefunded', seq: e.seq });
          events.push({ kind: 'refused', from, to, seq: e.seq, team, reason: why });
          continue;
        }
        const rowKey = `${e.wave}:${team ? 'team' : 'card'}`;
        ledger.rows[from].set(rowKey, (ledger.rows[from].get(rowKey) ?? 0) + 1);
        const before = new Set(get(to).hand.map((c) => c.uid));
        const triples = get(to).triplesMade ?? 0;
        act(to, { type: 'receivePass', from, seq: e.seq, card: duosWireOf(e) });
        const key = `${from}:${e.seq}`;
        const after = get(to);
        if (after.duos?.refused.includes(key)) {
          // The receiver's run refused it (a full hand, a gift with no room): the sender gets the card back.
          act(from, { type: 'passRefunded', seq: e.seq });
          events.push({ kind: 'refused', from, to, seq: e.seq, team, reason: 'hand_full' });
          continue;
        }
        const uids = after.hand.filter((c) => !before.has(c.uid)).map((c) => c.uid);
        events.push({ kind: 'landed', from, to, seq: e.seq, team, uids, triple: (after.triplesMade ?? 0) !== triples });
      }
    }
    if (!moved) break;
  }
  noteSbMateTribes(get, act);
  return events;
}

/** MATCHMAKER (R-DUOS-CARDS-05): each run records its teammate's board when it holds a card that reads it, only when
 *  the counts changed (the `duosNoteMate` rule). */
export function noteSbMateTribes(get: (seat: SbSeat) => RunState, act: (seat: SbSeat, a: Action) => void): void {
  for (const seat of SB_SEATS) {
    const run = get(seat);
    if (!runReadsMateTribes(run)) continue;
    const mate = get(sbMateOf(seat));
    const tribes = mateTribeCounts(mate.board, mate.tribes);
    const had = run.duos?.mateTribes ?? {};
    const keys = new Set([...Object.keys(had), ...Object.keys(tribes)]) as Set<keyof typeof tribes>;
    for (const k of keys) {
      if ((had[k] ?? -1) !== (tribes[k] ?? -1)) { act(seat, { type: 'noteMateTribes', tribes }); break; }
    }
  }
}
