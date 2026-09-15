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
 *
 * B2 (balance roadmap, 2026-09-15) — every mechanic in scope has a generator here: buy (Starform included, at
 * its live price), sell, play (minions at curated seats, spells at every friendly target and — for `any` — at
 * every non-spell offer), freeze / roll, upgrade, every wielded hero power with its target shape (board, shop,
 * commission, flash pick, Void's second slot), Equipment select + activate (with targets), and the whole
 * mandatory family (Discover, Choose One, aim, quest, power offer, Runeforge, scout). A targeted MINION Shout
 * is a two-step in this engine — `play` opens the aim, `battlecryTarget` answers it — so the play carries no
 * `targetUid` (the reducer ignores one on a minion) and the target is generated as the mandatory follow-up;
 * search resolves that continuation before scoring the play (see `pilotSearch.ts`).
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
      return m.options.map((_, index) => ({ action: { type: 'chooseOne', index }, tag: `chooseOne #${index}${m.equipmentId ? ` (${m.equipmentId})` : ''}` }));
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

const COMMISSIONS = ['discover', 'gold', 'spell', 'citadel', 'fortress'] as const;

/** Every activation of every wielded power that is ready, shaped by its targeting. */
export function heroPowerCandidates(v: BotVisibleState): Candidate[] {
  const out: Candidate[] = [];
  for (const p of v.hero.powers) {
    if (!p.ready) continue;
    const slot = p.slot === 1 ? { slot: 1 as const } : {};
    const label = `power ${p.kind}${p.slot === 1 ? '#2' : ''}`;
    switch (p.targeting) {
      case 'passive':
        break;
      case 'untargeted':
        out.push({ action: { type: 'heroPower', ...slot }, tag: label });
        break;
      case 'commission':
        for (const commission of COMMISSIONS) out.push({ action: { type: 'heroPower', commission, ...slot }, tag: `${label} ${commission}` });
        break;
      case 'flashPick':
        for (const flashPick of ['first', 'last'] as const) out.push({ action: { type: 'heroPower', flashPick, ...slot }, tag: `${label} ${flashPick}` });
        break;
      case 'friendlyOrShop':
        for (const o of v.shop) out.push({ action: { type: 'heroPower', uid: o.uid, ...slot }, tag: `${label} @shop ${o.cardId}` });
        for (const c of v.board) out.push({ action: { type: 'heroPower', uid: c.uid, ...slot }, tag: `${label} @${c.cardId}` });
        break;
      case 'friendly':
        for (const c of v.board) out.push({ action: { type: 'heroPower', uid: c.uid, ...slot }, tag: `${label} @${c.cardId}` });
        break;
    }
  }
  return out;
}

/**
 * Equipment: activate the SELECTED one (with every friendly target when it aims), and SELECT any other held
 * Equipment that could then be activated — a swap is free, so it is only worth a node as a step toward a use.
 */
export function equipmentCandidates(v: BotVisibleState): Candidate[] {
  const out: Candidate[] = [];
  const usable = v.equipment.filter((e) => e.charges > 0 && e.cost <= v.economy.gold);
  const selected = usable.find((e) => e.selected);
  if (selected) {
    if (selected.targetMode === 'friendly') {
      for (const c of v.board) out.push({ action: { type: 'activateEquipment', targetUid: c.uid }, tag: `use ${selected.equipmentId} on ${c.cardId}` });
    } else {
      out.push({ action: { type: 'activateEquipment' }, tag: `use ${selected.equipmentId}` });
    }
  }
  for (const e of usable) {
    if (e.selected) continue;
    if (e.targetMode === 'friendly' && v.board.length === 0) continue;
    out.push({ action: { type: 'selectEquipment', equipmentId: e.equipmentId }, tag: `select ${e.equipmentId}` });
  }
  return out;
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

  // BUY — every affordable offer there is room for (the Starform token is an ordinary offer here, at its live
  // ticking price).
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
    // A RUBY (set 2) is `ruby: true`, not `spell: true` — a spell-like token cast on a minion or an offer. It used
    // to fall through to the MINION branch here (a seat index, gated on a full board), which the reducer refuses
    // (a Ruby needs a target), so the pilot could never cast one: the recorded pinned lobbies show hands of six
    // Rubies held to elimination (B6, 2026-09-15). It is generated like the `any`-target spell it plays as.
    if (def?.spell || def?.ruby) {
      if (def.chooseOne?.length) {
        // A Choose One spell opens its prompt first (choose → target → resolve); the pick and the aim are
        // generated as mandatory follow-ups, so the play itself carries no target.
        out.push({ action: { type: 'play', uid: c.uid }, tag: `cast ${c.cardId} (choose)` });
      } else if (def.target === 'friendly' || def.target === 'any') {
        // One candidate per friendly target. The board caps at 7, spells in hand are rare, and which minion
        // a buff lands on is exactly the decision search exists to make — don't pre-curate it.
        for (const t of v.board) {
          out.push({ action: { type: 'play', uid: c.uid, targetUid: t.uid }, tag: `cast ${c.cardId} on ${t.cardId}` });
        }
        // An `any` spell (a Ruby, Apples) can also land on a tavern offer — buffing it before the buy.
        if (def.target === 'any') {
          for (const o of v.shop) {
            if (o.spell) continue;
            out.push({ action: { type: 'play', uid: c.uid, targetUid: o.uid }, tag: `cast ${c.cardId} on offer ${o.cardId}` });
          }
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

  out.push(...heroPowerCandidates(v));
  out.push(...equipmentCandidates(v));

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
