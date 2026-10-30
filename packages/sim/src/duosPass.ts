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
import type { TeamEffect, Tribe } from '@game/core';
import { handCap, type BoardCard, type RunState } from './state';
import { duosCatchBump, duosCatchLeft, type DuosRuneState } from './duosRunes';

/** The Gold a pass costs the sender. Pinned against `VERSUS_DUOS_PASS_GOLD` (versus/duos.ts) by test. */
export const DUOS_PASS_GOLD = 1;
/** Board slots (the run's board cap). */
const BOARD_MAX = 7;
/** The placeholder `cardId` a TEAM EFFECT entry travels under (it carries no card; `team` says what it does). Never a
 *  real card id, never lands in a hand. */
export const DUOS_TEAM_WIRE_ID = '__team';

export interface DuosOutboxEntry {
  seq: number;
  wave: number;
  /** The card that left. A TEAM EFFECT entry (`team`) carries a placeholder (`DUOS_TEAM_WIRE_ID`, uid `team<seq>`). */
  card: BoardCard;
  /** Where it left from, and at which index (a refund puts it back there when it can). 'hand' for a drag pass (the
   *  hand-only ruling, 2026-10-25; 'board' survives in older checkpoints). A SPELL pass (Handout, R-DUOS-CARDS-01)
   *  can take a 'board' minion or a 'shop' one. */
  from: 'hand' | 'board' | 'shop';
  index: number;
  /** The teammate's full hand refused it: the card and the Gold came back. */
  refunded?: true;
  /** The Gold this pass cost (refunded exactly). Absent = `DUOS_PASS_GOLD` (an older checkpoint). 0 for a free pass
   *  (Brian's Pal), a spell's pass and a team effect. */
  paid?: number;
  /** A pass a SPELL made (Handout): free, from the Shop or the board. Travels as `passFrom: 'spell'`. `'sale'` = a
   *  sold minion Salesman of the Year passed (R-DUOS-RUNES-01): free, MAY be Golden (owner 2026-10-30: "golden minions
   *  DO get passed in this case"), travels as `passFrom: 'sale'`, and a refusal returns nothing (the sale was paid). */
  via?: 'spell' | 'sale';
  /** Which free allowance a free MANUAL pass spent: Brian's Pal (`'pal'`) or the team's Playing Catch (`'catch'`). A
   *  refund gives back exactly that one. */
  free?: 'pal' | 'catch';
  /** REAL-TIME COMBAT TEAM EFFECT (R-DUOS-RUNES-02): this entry is the fight's `teamEffects[combatIdx]` (this run's own
   *  member carry), queued when the fight LANDED; the client holds it until its replay reaches that `teamSend` beat (or
   *  the fight is over), and settle never queues it again. */
  combatIdx?: number;
  /** DUOS-ONLY CARDS (R-DUOS-CARDS-01): this entry is a TEAM EFFECT, not a card. Travels as `passFrom: 'team'`. */
  team?: TeamEffect;
}

/** The run's Duos state (present only on a Duos seat's run). */
export interface DuosRunState {
  /** Passes this run SENT, in order (`seq` = index). Team effects ride the same list (`team`). */
  outbox: DuosOutboxEntry[];
  /** Every received pass key (`<fromSeat>:<seq>`) that LANDED. */
  received: string[];
  /** Every received pass key the full hand REFUSED. */
  refused: string[];
  /** Brian's Pal (R-DUOS-CARDS-01): free passes spent this turn, and the turn they were counted on. */
  freePassesUsed?: number;
  freePassWave?: number;
  /** The Duos runes' state (`duosRunes.ts`). */
  runes?: DuosRuneState;
  /** Matchmaker (R-DUOS-CARDS-05): the teammate's board as this run last saw it, minions per tribe of THEIR run
   *  (`noteMateTribes`). Absent = never seen (every tribe ties). */
  mateTribes?: Partial<Record<Tribe, number>>;
  /** EFFECT PASSES WAITING FOR HAND ROOM (owner 2026-10-30, R-DUOS-EFFECT-PASS-QUEUE-01: "if your teammate's hand is
   *  full, they get the card once there is space in their hand"). An effect pass (`passFrom: 'spell'`) that arrives to
   *  a full hand is LANDED (answered, the sender keeps nothing back) and waits here, in arrival order; `landWaitingPasses`
   *  moves each into the hand the moment there is room (after any action). Persisted with the run, so a reload keeps it. */
  waiting?: { key: string; card: BoardCard; gift?: true }[];
}

/** A team-effect entry's placeholder card (it never lands anywhere). */
export function duosTeamCard(seq: number): BoardCard {
  return { uid: `team${seq}`, cardId: DUOS_TEAM_WIRE_ID, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false };
}

/** Is this wire card a TEAM EFFECT (`passFrom: 'team'`) rather than a card? */
export function isDuosTeamWire(card: unknown): card is BoardCard & { passFrom: 'team'; team: TeamEffect } {
  const c = card as { passFrom?: unknown; team?: unknown } | null;
  return !!c && c.passFrom === 'team' && !!c.team && typeof c.team === 'object';
}

/**
 * BRIAN'S PAL (owner 2026-10-30, R-DUOS-CARDS-01): "Your first pass each turn is free." The free passes a turn allows:
 * every `duosFirstPassFree` marker on the board adds its `passes` (Gilded doubles). Copies stack.
 */
export function duosFreePassesOf(s: Pick<RunState, 'board'>): number {
  let n = 0;
  for (const c of s.board) {
    const def = CARD_INDEX[c.cardId];
    for (const e of def?.effects ?? []) {
      if (e.do !== 'duosFirstPassFree') continue;
      const p = typeof e.params?.passes === 'number' ? e.params.passes : 1;
      n += p * (c.golden ? 2 : 1);
    }
  }
  return n;
}

/** The Gold the NEXT drag pass costs right now: 0 while Brian's Pal has a free pass left this turn, else
 *  `DUOS_PASS_GOLD`. The one price: the refusal check, the charge and the UI all read it. */
export function duosPassCost(s: RunState): number {
  const d = s.duos;
  if (!d) return DUOS_PASS_GOLD;
  return duosFreeKind(s) ? 0 : DUOS_PASS_GOLD;
}

/** Which free allowance the next manual pass would spend: Brian's Pal first (your own, per turn), then the team's
 *  Playing Catch (shared, per round), so one pass never spends both (owner 2026-10-30: "stacks with Brian's Pal
 *  sensibly"). Null = it costs Gold. */
export function duosFreeKind(s: RunState): 'pal' | 'catch' | null {
  const d = s.duos;
  if (!d) return null;
  const used = d.freePassWave === s.wave ? (d.freePassesUsed ?? 0) : 0;
  if (used < duosFreePassesOf(s)) return 'pal';
  return duosCatchLeft(s) ? 'catch' : null;
}

/** Why `uid` cannot be passed right now (null = it can). `mateHandFull` is the teammate's live hand state when the
 *  caller knows it (the UI, from the teammate's frame). The UI shows the refusal from this. */
export function duosPassBlocked(s: RunState, uid: string, mateHandFull = false): 'not_duos' | 'phase' | 'no_card' | 'board' | 'golden' | 'gold' | 'hand_full' | null {
  if (!s.duos) return 'not_duos';
  if (s.phase !== 'recruit') return 'phase';
  // HAND ONLY (owner 2026-10-25: "you aren't supposed to be able to pass a card off your board, only from hand").
  const card = s.hand.find((c) => c.uid === uid);
  if (!card) return s.board.some((c) => c.uid === uid) ? 'board' : 'no_card';
  // NO GOLDENS (owner 2026-10-30: "Golden minions CANNOT be passed").
  if (card.golden) return 'golden';
  if (mateHandFull) return 'hand_full';
  if (s.embers < duosPassCost(s)) return 'gold';
  return null;
}

/** The sender's half, on the reducer's draft. Returns false (refuse, no change) when the pass is not allowed. */
export function applyDuosPass(s: RunState, uid: string, spendGold: (s: RunState, amount: number) => void): boolean {
  if (duosPassBlocked(s, uid)) return false;
  const duos = s.duos!;
  const index = s.hand.findIndex((c) => c.uid === uid);
  const cost = duosPassCost(s);
  const free = cost > 0 ? null : duosFreeKind(s);
  const card = s.hand.splice(index, 1)[0];
  if (!card) return false;
  if (cost > 0) spendGold(s, cost);
  else if (free === 'catch') duosCatchBump(s, 1); // a Playing Catch pass: one of the team's this round
  else {
    // A Brian's Pal free pass: count it against this turn's allowance.
    if (duos.freePassWave !== s.wave) { duos.freePassWave = s.wave; duos.freePassesUsed = 0; }
    duos.freePassesUsed = (duos.freePassesUsed ?? 0) + 1;
  }
  duos.outbox.push({ seq: duos.outbox.length, wave: s.wave, card: structuredClone(card), from: 'hand', index, paid: cost, ...(free ? { free } : {}) });
  return true;
}

/**
 * A SPELL's pass (Handout, R-DUOS-CARDS-01: "Pass a minion"): `card` has ALREADY left the Shop or the board; this
 * records it on the outbox, free (the spell is the price). A Golden minion is never passed (owner 2026-10-30): the
 * caller refuses it before removing anything. Returns false outside a Duos run.
 */
export function recordSpellPass(s: RunState, card: BoardCard, from: 'board' | 'shop' | 'hand', index: number, via: 'spell' | 'sale' = 'spell'): boolean {
  const duos = s.duos;
  if (!duos) return false;
  duos.outbox.push({ seq: duos.outbox.length, wave: s.wave, card: structuredClone(card), from, index, paid: 0, via });
  return true;
}

/** Queue a TEAM EFFECT for the teammate (R-DUOS-CARDS-01). The receiving run resolves it. No-op outside Duos. */
export function queueTeamEffect(s: RunState, effect: TeamEffect, combatIdx?: number): void {
  const duos = s.duos;
  if (!duos) return;
  const seq = duos.outbox.length;
  duos.outbox.push({ seq, wave: s.wave, card: duosTeamCard(seq), from: 'hand', index: -1, paid: 0, team: structuredClone(effect), ...(combatIdx != null ? { combatIdx } : {}) });
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

/** An outbox ENTRY as it travels: a drag pass as `duosWireCard` (`passFrom: 'hand'`), a spell's pass as
 *  `passFrom: 'spell'`, a team effect as `passFrom: 'team'` with its `team` payload (R-DUOS-CARDS-01). */
export function duosWireOf(e: DuosOutboxEntry): BoardCard & { passFrom: 'hand' | 'spell' | 'sale' | 'team'; team?: TeamEffect; teamCatch?: number } {
  if (e.team) return { ...e.card, passFrom: 'team', team: structuredClone(e.team) };
  const wire = duosWireCard(e.card);
  if (e.via) return { ...wire, passFrom: e.via };
  // A Playing Catch pass tells the teammate's run, so the team's shared count moves on both runs (R-DUOS-RUNES-01).
  return e.free === 'catch' ? { ...wire, teamCatch: e.wave } : wire;
}

/** A fresh draft that shares the two large read-only structures (the reducer's own carve-out). */
export function duosDraft(state: RunState): RunState {
  const { lastCombat, servedBoards, ...rest } = state;
  const s = structuredClone(rest) as RunState;
  s.lastCombat = lastCombat;
  s.servedBoards = servedBoards;
  return s;
}

/** The receiver's half: a fresh draft, or `state` itself when the pass is not for this run or already answered. A
 *  full hand refuses it. Any phase: a pass sent at the end of the shop can arrive while the fight is on. */
export function receiveDuosPass(state: RunState, from: string, seq: number, card: BoardCard): RunState {
  if (!state.duos || !card || typeof card.cardId !== 'string' || !CARD_INDEX[card.cardId] || isDuosTeamWire(card)) return state;
  const key = `${from}:${seq}`;
  if (state.duos.received.includes(key) || state.duos.refused.includes(key)) return state;
  const s = duosDraft(state);
  const duos = s.duos!;
  // AN EFFECT PASS IS NEVER REFUSED FOR A FULL HAND (owner 2026-10-30, R-DUOS-EFFECT-PASS-QUEUE-01): it is landed (the
  // sender is told it arrived) and waits for room, behind any effect pass already waiting (in order).
  // An effect pass travels as `spell` (Handout, CueBee's Pass, Matchmaker) or `sale` (Salesman of the Year).
  const pf = (card as { passFrom?: unknown }).passFrom;
  const effectPass = pf === 'spell' || pf === 'sale';
  if (effectPass && (s.hand.length >= handCap(s) || (duos.waiting?.length ?? 0) > 0)) {
    duos.received.push(key);
    (duos.waiting ??= []).push({ key, card: landedCard(card) });
    return s;
  }
  if (s.hand.length >= handCap(s)) {
    duos.refused.push(key);
    return s;
  }
  duos.received.push(key);
  // The transport's markers (`passFrom`, the server's hand-only check; `teamCatch`) never ride into the hand.
  const { passFrom: _f, team: _t, teamCatch, ...landed } = structuredClone(card) as BoardCard & { passFrom?: unknown; team?: unknown; teamCatch?: unknown };
  void _t;
  void _f;
  // My teammate's Playing Catch pass of THIS round: one of the team's free passes is gone (R-DUOS-RUNES-01).
  if (typeof teamCatch === 'number') duosCatchBump(s, 1, teamCatch);
  s.hand.push({ ...landed, uid: `b${s.uidSeq++}`, passKey: key });
  return s;
}

/** A wire card as it waits / lands: the transport's markers (`passFrom`, `team`, `teamCatch`) never ride into the hand. */
function landedCard(card: BoardCard): BoardCard {
  const { passFrom: _f, team: _t, teamCatch: _g, ...landed } = structuredClone(card) as BoardCard & { passFrom?: unknown; team?: unknown; teamCatch?: unknown };
  void _f; void _t; void _g;
  return landed;
}

/** How many effect passes are waiting for hand room (the "waiting" pill, the hand room this run reports). */
export function duosWaitingCount(s: Pick<RunState, 'duos'>): number {
  return s.duos?.waiting?.length ?? 0;
}

/**
 * Land WAITING effect passes into the hand while there is room (R-DUOS-EFFECT-PASS-QUEUE-01), in arrival order. Pure:
 * `state` itself when nothing can land, else a fresh draft. The reducer runs it after every action, so a card lands the
 * moment a play, sale, pass or the turn's flip makes room; deterministic (a function of the run alone).
 */
export function landWaitingPasses(state: RunState): RunState {
  const w = state.duos?.waiting;
  if (!w?.length || state.hand.length >= handCap(state)) return state;
  const s = duosDraft(state);
  const d = s.duos!;
  while (d.waiting!.length > 0 && s.hand.length < handCap(s)) {
    const next = d.waiting!.shift()!;
    // A gift's card is not a pass (no pass key: it never travelled as a card); an effect pass keeps the key it came by.
    s.hand.push({ ...next.card, uid: `b${s.uidSeq++}`, ...(next.gift ? {} : { passKey: next.key }) });
  }
  if (d.waiting!.length === 0) d.waiting = undefined;
  return s;
}

/** The sender's refund, when the teammate's full hand refused pass `seq`. Exactly once. */
export function refundDuosPass(state: RunState, seq: number): RunState {
  const entry = state.duos?.outbox[seq];
  if (!entry || entry.refunded) return state;
  const s = duosDraft(state);
  const e = s.duos!.outbox[seq]!;
  e.refunded = true;
  // A TEAM EFFECT refused (the teammate away, a full hand for a gift): nothing left this run, nothing comes back.
  // Nor does a Salesman sale's pass: the minion was SOLD (its Gold paid), the pass was a bonus (R-DUOS-RUNES-01).
  if (e.team || e.via === 'sale') return s;
  // Back where it was when there is room (a board card to its slot), else to the hand. A SHOP minion a spell passed
  // goes back to the Shop row while the Shop is open (never into the hand: the spell never bought it).
  const back = structuredClone(e.card);
  if (e.from === 'board' && s.board.length < BOARD_MAX) s.board.splice(Math.min(e.index, s.board.length), 0, back);
  else if (e.from === 'shop' && s.phase === 'recruit') {
    const def = CARD_INDEX[back.cardId];
    const atk = back.attack - (def?.attack ?? back.attack), hp = back.health - (def?.health ?? back.health);
    s.shop.splice(Math.min(e.index, s.shop.length), 0, { uid: back.uid, cardId: back.cardId, ...(atk ? { atk } : {}), ...(hp ? { hp } : {}) });
  } else s.hand.splice(e.from === 'hand' ? Math.min(e.index, s.hand.length) : s.hand.length, 0, back);
  // The pass was never paid: the Gold and the Gold-spent tallies of its turn come back (a free pass: its allowance).
  const paid = e.paid ?? DUOS_PASS_GOLD;
  if (paid > 0) {
    s.embers += paid;
    s.goldSpent = Math.max(0, (s.goldSpent ?? 0) - paid);
    if (e.wave === s.wave) s.goldSpentThisTurn = Math.max(0, (s.goldSpentThisTurn ?? 0) - paid);
  } else if (e.free === 'catch') {
    duosCatchBump(s, -1, e.wave); // a Playing Catch pass: the team's allowance comes back
  } else if (!e.via && s.duos!.freePassWave === e.wave && e.wave === s.wave) {
    s.duos!.freePassesUsed = Math.max(0, (s.duos!.freePassesUsed ?? 0) - 1);
  }
  return s;
}
