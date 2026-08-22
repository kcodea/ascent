import type { Action } from '../state';
import { ACTION_CATALOG } from './actionCatalog';
import { CARD_INDEX } from '@game/content';
import type { BotVisibleState } from './types';

/**
 * Candidate generation, from the VISIBLE state only.
 *
 * These are *plausible* actions, not guaranteed-legal ones — `transition.ts` validates each against the real
 * reducer, which stays the only authority on legality. Generating from the projection is what keeps the bot
 * honest: it physically cannot propose an action informed by hidden state.
 *
 * The job here is BOUNDING as much as enumerating. A full board and hand with every target and every insertion
 * index is thousands of candidates per node, nearly all of them equivalent; a search that expands them all
 * spends its whole budget on permutations of the same idea. So positions and targets are curated down to the
 * ones that can differ in outcome.
 */

/** A candidate, with the tags search and tracing need. */
export interface Candidate {
  action: Action;
  /** Short reason, for traces: "buy Kennelmaster", "sell dominated body". */
  tag: string;
}

/** Board slots worth trying for a played minion: the edges and beside each existing card. More than that is
 *  permutation noise — adjacency effects only ever read a neighbour, never a distance. */
function playIndices(boardSize: number): number[] {
  if (boardSize === 0) return [0];
  if (boardSize === 1) return [0, 1];
  // Left edge, right edge, and one interior seat. Interior positions differ from each other only for adjacency
  // effects, and those care about WHO is beside you — covered by trying each neighbour pair via the edges plus
  // a middle sample at higher depths.
  return [0, Math.floor(boardSize / 2), boardSize];
}

/** The mandatory family, when the run is blocked. Nothing else is legal until one of these is taken. */
export function mandatoryCandidates(v: BotVisibleState): Candidate[] {
  const m = v.mandatoryDecision;
  if (!m) return [];
  switch (m.kind) {
    case 'discover':
      return m.options.map((cardId, index) => ({ action: { type: 'discover', index }, tag: `discover ${cardId}` }));
    case 'chooseOne':
      return m.options.map((_, index) => ({ action: { type: 'chooseOne', index }, tag: `chooseOne #${index}` }));
    case 'battlecryTarget':
      return m.legalTargets.map((targetUid) => ({ action: { type: 'battlecryTarget', targetUid }, tag: `target ${targetUid}` }));
    case 'quest':
      return m.options.map((questId, index) => ({ action: { type: 'buyQuest', index }, tag: `quest ${questId}` }));
    case 'powerOffer':
      return m.options.map((heroId, index) => ({ action: { type: 'pickPower', index }, tag: `power ${heroId}` }));
    case 'runeforge': {
      const out: Candidate[] = m.options.map((runeId, index) => ({ action: { type: 'buyRune', index }, tag: `rune ${runeId}` }));
      if (m.canReroll) out.push({ action: { type: 'rerollRuneforge' }, tag: 'reroll forge' });
      if (m.canSkip) out.push({ action: { type: 'skipRuneforge' }, tag: 'skip forge' });
      return out;
    }
    case 'scout':
      return [{ action: { type: 'closeScout' }, tag: 'close scout' }];
  }
}

/**
 * Ordinary shop-phase candidates.
 *
 * `faceOmen` is deliberately absent: ending the turn is a terminal move the controller adds after final
 * positioning, never something broad search wanders into — otherwise every branch terminates immediately and
 * the beam explores nothing.
 */
export function recruitCandidates(v: BotVisibleState): Candidate[] {
  if (v.mandatoryDecision) return mandatoryCandidates(v);
  const out: Candidate[] = [];
  const boardFull = v.board.length >= 7;
  const handFull = v.hand.length >= 10;

  // BUY — every affordable offer there is room for.
  for (const o of v.shop) {
    if (o.cost > v.economy.gold) continue;
    if (handFull) continue;
    out.push({ action: { type: 'buy', uid: o.uid }, tag: `buy ${o.cardId}` });
  }
  if (v.spellOffer && v.spellOffer.cost <= v.economy.gold && !handFull) {
    out.push({ action: { type: 'buy', uid: v.spellOffer.uid }, tag: `buy ${v.spellOffer.cardId}` });
  }

  // PLAY — minions to seats, spells to targets. These are different actions wearing the same type.
  //
  // The first version detected spells by looking the hand card up IN THE SHOP (`v.shop.some(o => o.uid ===
  // c.uid)`) — vestigial nonsense, since a bought card is no longer a shop offer. The consequences stacked into
  // the single biggest hole the bot had: aimed spells were generated with no `targetUid` (the reducer fizzles
  // them), and EVERYTHING in hand was gated on `boardFull` — so from the moment the board filled (wave ~6, the
  // exact onset of the measured round-7 collapse) the bot could not cast ANY spell, including untargeted
  // economy and the board-wide buffs that are how human boards compound (94 -> 387 -> 9,680 power).
  for (const c of v.hand) {
    const def = CARD_INDEX[c.cardId];
    if (def?.spell) {
      if (def.target === 'friendly' || def.target === 'any') {
        // One candidate per friendly target. The board caps at 7, spells in hand are rare, and which minion
        // a buff lands on is exactly the decision search exists to make — don't pre-curate it.
        for (const t of v.board) {
          out.push({ action: { type: 'play', uid: c.uid, targetUid: t.uid }, tag: `cast ${c.cardId} on ${t.cardId}` });
        }
      } else {
        out.push({ action: { type: 'play', uid: c.uid }, tag: `cast ${c.cardId}` });
      }
      continue; // a spell never needs a board seat, so `boardFull` must not gate it
    }
    if (boardFull) continue;
    for (const index of playIndices(v.board.length)) {
      out.push({ action: { type: 'play', uid: c.uid, toIndex: index }, tag: `play ${c.cardId}@${index}` });
    }
  }

  // SELL — every board minion. Cheap to generate and the evaluator decides; a curated "dominated only" filter
  // here would pre-empt exactly the decision search exists to make.
  for (const c of v.board) {
    out.push({ action: { type: 'sell', uid: c.uid }, tag: `sell ${c.cardId}` });
  }

  // ECONOMY
  if (v.economy.upgradeCost <= v.economy.gold) out.push({ action: { type: 'upgrade' }, tag: 'upgrade tier' });
  if (v.economy.refreshCost <= v.economy.gold || v.economy.freeRolls > 0) {
    out.push({ action: { type: 'roll' }, tag: 'refresh' });
  }
  // Freezing is only meaningful when there is something worth keeping — a toggle on an empty or worthless shop
  // is a wasted node.
  if (!v.frozen && v.shop.length > 0) out.push({ action: { type: 'freeze' }, tag: 'freeze shop' });
  else if (v.frozen) out.push({ action: { type: 'freeze' }, tag: 'unfreeze shop' });

  if (v.hero.powerReady) out.push({ action: { type: 'heroPower' }, tag: 'hero power' });

  return out;
}

/** Reposition candidates for FINAL arrangement: curated orders, not permutations. */
export function positionCandidates(v: BotVisibleState): Candidate[] {
  const n = v.board.length;
  if (n < 2) return [];
  const out: Candidate[] = [];
  // Moving one minion to either edge covers most of what matters (who attacks first, who soaks). Full
  // permutation search is Ticket 7's job, gated on difficulty.
  for (let from = 0; from < n; from++) {
    for (const to of [0, n - 1]) {
      if (from === to) continue;
      out.push({ action: { type: 'reposition', uid: v.board[from]!.uid, toIndex: to }, tag: `move ${v.board[from]!.cardId}→${to}` });
    }
  }
  return out;
}

/** Everything the bot may consider right now, mandatory family first. */
export function candidatesFor(v: BotVisibleState): Candidate[] {
  return v.mandatoryDecision ? mandatoryCandidates(v) : recruitCandidates(v);
}

/** Sanity net used by tests: no candidate may name an action the catalog says is never generated. */
export function violatesCatalog(c: Candidate): boolean {
  const d = ACTION_CATALOG[c.action.type];
  return d.generation === 'never' || d.generation === 'automatic';
}
