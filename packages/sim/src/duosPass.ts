/**
 * VERSUS DUOS: PASSING A CARD TO YOUR TEAMMATE (owner 2026-10-25, R-DUOS-PASS-01).
 *
 *   "a pass slot: drag a card from your hand/board to your teammate's portrait to give it to them."
 *   "passing should cost 1 gold" (each card once per turn; refused on a full hand; closes at your End Turn).
 *
 * The two halves are ordinary recorded run actions, so a restore or a replay reproduces them:
 *  - `passCard { uid }` (the SENDER's run): the hand or board card leaves, 1 Gold is spent through the one Gold-spend
 *    chokepoint (so "when you spend Gold" payoffs hear it, cross-phase by default), and the card AS IT LEFT is
 *    appended to `duos.outbox`. The Versus store ships each outbox entry to the server once (`versus_duos_pass`).
 *  - `receivePass { from, seq, card }` (the RECEIVER's run): the card arrives with a fresh uid, everything it carried
 *    (stats, keywords, enchantments, Gilded, per-instance counters) intact, marked as passed this turn (it cannot be
 *    passed straight back). It lands in the hand; if the hand is full it waits in `duos.inbox` and lands the moment
 *    there is room. A pass key (`from:seq`) lands at most once, however often the server re-delivers it. Arriving in
 *    the hand is "a card added to your hand" like any other (the reducer's hand diff fires those triggers).
 *
 * What passes: minions and spells (the cards a hand or board holds). Runes, Equipment, quests and the Starform are
 * not cards in hand or on the board, so there is nothing to drag.
 */
import { CARD_INDEX } from '@game/content';
import { handCap, type BoardCard, type RunState } from './state';

/** The Gold a pass costs the sender. Pinned against `VERSUS_DUOS_PASS_GOLD` (versus/duos.ts) by test. */
export const DUOS_PASS_GOLD = 1;

/** The run's Duos state (present only on a Duos seat's run). */
export interface DuosRunState {
  /** Passes this run SENT, in order (`seq` = index): the card exactly as it left. */
  outbox: { seq: number; wave: number; card: BoardCard }[];
  /** Passes RECEIVED while the hand was full: they land in order the moment there is room. */
  inbox: BoardCard[];
  /** Every received pass key (`<fromSeat>:<seq>`), so a re-delivered pass never lands twice. */
  received: string[];
}

/** Why `uid` cannot be passed right now (null = it can). The UI greys the teammate portrait from this. */
export function duosPassBlocked(s: RunState, uid: string): 'not_duos' | 'phase' | 'no_card' | 'passed_this_turn' | 'gold' | null {
  if (!s.duos) return 'not_duos';
  if (s.phase !== 'recruit') return 'phase';
  const card = s.hand.find((c) => c.uid === uid) ?? s.board.find((c) => c.uid === uid);
  if (!card) return 'no_card';
  if (card.passedWave === s.wave) return 'passed_this_turn';
  if (s.embers < DUOS_PASS_GOLD) return 'gold';
  return null;
}

/** The sender's half, on the reducer's draft. Returns false (refuse, no change) when the pass is not allowed. */
export function applyDuosPass(s: RunState, uid: string, spendGold: (s: RunState, amount: number) => void): boolean {
  if (duosPassBlocked(s, uid)) return false;
  const duos = s.duos!;
  let card: BoardCard | undefined;
  const hi = s.hand.findIndex((c) => c.uid === uid);
  if (hi >= 0) card = s.hand.splice(hi, 1)[0];
  else {
    const bi = s.board.findIndex((c) => c.uid === uid);
    card = s.board.splice(bi, 1)[0];
  }
  if (!card) return false;
  spendGold(s, DUOS_PASS_GOLD);
  duos.outbox.push({ seq: duos.outbox.length, wave: s.wave, card: structuredClone(card) });
  return true;
}

/** The receiver's half: a fresh draft, or `state` itself when the pass is not for this run or already landed. */
export function receiveDuosPass(state: RunState, from: string, seq: number, card: BoardCard): RunState {
  if (!state.duos || !card || typeof card.cardId !== 'string' || !CARD_INDEX[card.cardId]) return state;
  const key = `${from}:${seq}`;
  if (state.duos.received.includes(key)) return state;
  // The same carve-out the reducer uses: share the two large read-only structures, clone the rest.
  const { lastCombat, servedBoards, ...rest } = state;
  const s = structuredClone(rest) as RunState;
  s.lastCombat = lastCombat;
  s.servedBoards = servedBoards;
  const duos = s.duos!;
  duos.received.push(key);
  const arrived: BoardCard = { ...structuredClone(card), uid: `b${s.uidSeq++}`, passedWave: s.wave };
  duos.inbox.push(arrived);
  landDuosInbox(s);
  return s;
}

/** Land waiting passes while the hand has room (in the Shop only: a card never appears mid-fight). */
export function landDuosInbox(s: RunState): void {
  const duos = s.duos;
  if (!duos || duos.inbox.length === 0 || s.phase !== 'recruit') return;
  while (duos.inbox.length > 0 && s.hand.length < handCap(s)) s.hand.push(duos.inbox.shift()!);
}
