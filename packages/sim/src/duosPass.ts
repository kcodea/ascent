/**
 * VERSUS DUOS: PASSING A CARD TO YOUR TEAMMATE (owner 2026-10-25, R-DUOS-PASS-01).
 *
 *   "a pass slot: drag a card from your hand/board to your teammate's portrait to give it to them."
 *   "passing should cost 1 gold" (closes at your End Turn).
 *   "Pass is refused if hand is full." (the sender keeps the card and is not charged)
 *   "you should be able to pass cards back to your teammate" (2026-10-25: a card just passed to you can go straight
 *   back, and any card can be passed again later the same turn; every pass costs its 1 Gold).
 *   "you aren't supposed to be able to pass a card off your board, only from hand." (2026-10-25: HAND ONLY.)
 *
 * Three recorded run actions, so a restore or a replay reproduces them:
 *  - `passCard { uid }` (the SENDER's run): the HAND card leaves, 1 Gold is spent through the one Gold-spend
 *    chokepoint, and the card AS IT LEFT (and where it came from) is appended to `duos.outbox`. The Versus store ships
 *    each entry to the server once (`versus_duos_pass`, which refuses a pass to a hand the teammate reported full).
 *  - `receivePass { from, seq, card }` (the RECEIVER's run): with room in the hand the card lands with a fresh uid and
 *    everything it carried, stamped with the pass key it came through (`passKey`, identity for a restore, never a
 *    restriction: it can be passed straight back); a FULL hand refuses it (recorded
 *    in `duos.refused`; the store answers the server, which tells the sender). A pass key lands or is refused once.
 *  - `passRefunded { seq }` (the SENDER's run, when the teammate's hand refused it): the card comes back where it was
 *    and the 1 Gold is given back (the Gold-spent tallies too: the pass was never paid), exactly once.
 */
import { CARD_INDEX } from '@game/content';
import { handCap, type BoardCard, type RunState } from './state';

/** The Gold a pass costs the sender. Pinned against `VERSUS_DUOS_PASS_GOLD` (versus/duos.ts) by test. */
export const DUOS_PASS_GOLD = 1;
/** Board slots (the run's board cap). */
const BOARD_MAX = 7;

export interface DuosOutboxEntry {
  seq: number;
  wave: number;
  card: BoardCard;
  /** Where it left from, and at which index (a refund puts it back there when it can). Always 'hand' since the
   *  hand-only ruling (2026-10-25); 'board' survives only in older checkpoints. */
  from: 'hand' | 'board';
  index: number;
  /** The teammate's full hand refused it: the card and the Gold came back. */
  refunded?: true;
}

/** The run's Duos state (present only on a Duos seat's run). */
export interface DuosRunState {
  /** Passes this run SENT, in order (`seq` = index). */
  outbox: DuosOutboxEntry[];
  /** Every received pass key (`<fromSeat>:<seq>`) that LANDED. */
  received: string[];
  /** Every received pass key the full hand REFUSED. */
  refused: string[];
}

/** Why `uid` cannot be passed right now (null = it can). `mateHandFull` is the teammate's live hand state when the
 *  caller knows it (the UI, from the teammate's frame). The UI shows the refusal from this. */
export function duosPassBlocked(s: RunState, uid: string, mateHandFull = false): 'not_duos' | 'phase' | 'no_card' | 'board' | 'gold' | 'hand_full' | null {
  if (!s.duos) return 'not_duos';
  if (s.phase !== 'recruit') return 'phase';
  // HAND ONLY (owner 2026-10-25: "you aren't supposed to be able to pass a card off your board, only from hand").
  if (!s.hand.some((c) => c.uid === uid)) return s.board.some((c) => c.uid === uid) ? 'board' : 'no_card';
  if (mateHandFull) return 'hand_full';
  if (s.embers < DUOS_PASS_GOLD) return 'gold';
  return null;
}

/** The sender's half, on the reducer's draft. Returns false (refuse, no change) when the pass is not allowed. */
export function applyDuosPass(s: RunState, uid: string, spendGold: (s: RunState, amount: number) => void): boolean {
  if (duosPassBlocked(s, uid)) return false;
  const duos = s.duos!;
  const index = s.hand.findIndex((c) => c.uid === uid);
  const card = s.hand.splice(index, 1)[0];
  if (!card) return false;
  spendGold(s, DUOS_PASS_GOLD);
  duos.outbox.push({ seq: duos.outbox.length, wave: s.wave, card: structuredClone(card), from: 'hand', index });
  return true;
}

/**
 * The card AS IT TRAVELS to the server (`versus_duos_pass`): its own fields, plus `passFrom: 'hand'`, the marker the
 * server's hand-only check reads (owner 2026-10-25: "only from hand"). Its `passKey` (the key it last arrived through,
 * if any) rides along: on a reload the sender re-finds the card by it (`lineUpOutbox` / the restore replay). The
 * receiver drops `passFrom` and stamps its own `passKey`.
 */
export function duosWireCard(card: BoardCard): BoardCard & { passFrom: 'hand' } {
  const { passedWave: _old, ...rest } = card as BoardCard & { passedWave?: unknown }; // an older checkpoint's scratch
  void _old;
  return { ...rest, passFrom: 'hand' };
}

/** A fresh draft that shares the two large read-only structures (the reducer's own carve-out). */
function draft(state: RunState): RunState {
  const { lastCombat, servedBoards, ...rest } = state;
  const s = structuredClone(rest) as RunState;
  s.lastCombat = lastCombat;
  s.servedBoards = servedBoards;
  return s;
}

/** The receiver's half: a fresh draft, or `state` itself when the pass is not for this run or already answered. A
 *  full hand refuses it. Any phase: a pass sent at the end of the shop can arrive while the fight is on. */
export function receiveDuosPass(state: RunState, from: string, seq: number, card: BoardCard): RunState {
  if (!state.duos || !card || typeof card.cardId !== 'string' || !CARD_INDEX[card.cardId]) return state;
  const key = `${from}:${seq}`;
  if (state.duos.received.includes(key) || state.duos.refused.includes(key)) return state;
  const s = draft(state);
  const duos = s.duos!;
  if (s.hand.length >= handCap(s)) {
    duos.refused.push(key);
    return s;
  }
  duos.received.push(key);
  // The transport's marker (`passFrom`, the server's hand-only check) never rides into the hand.
  const { passFrom: _f, ...landed } = structuredClone(card) as BoardCard & { passFrom?: unknown };
  void _f;
  s.hand.push({ ...landed, uid: `b${s.uidSeq++}`, passKey: key });
  return s;
}

/** The sender's refund, when the teammate's full hand refused pass `seq`. Exactly once. */
export function refundDuosPass(state: RunState, seq: number): RunState {
  const entry = state.duos?.outbox[seq];
  if (!entry || entry.refunded) return state;
  const s = draft(state);
  const e = s.duos!.outbox[seq]!;
  e.refunded = true;
  // Back where it was when there is room (a board card to its slot), else to the hand.
  const back = structuredClone(e.card);
  if (e.from === 'board' && s.board.length < BOARD_MAX) s.board.splice(Math.min(e.index, s.board.length), 0, back);
  else s.hand.splice(e.from === 'hand' ? Math.min(e.index, s.hand.length) : s.hand.length, 0, back);
  // The pass was never paid: the Gold and the Gold-spent tallies of its turn come back.
  s.embers += DUOS_PASS_GOLD;
  s.goldSpent = Math.max(0, (s.goldSpent ?? 0) - DUOS_PASS_GOLD);
  if (e.wave === s.wave) s.goldSpentThisTurn = Math.max(0, (s.goldSpentThisTurn ?? 0) - DUOS_PASS_GOLD);
  return s;
}
