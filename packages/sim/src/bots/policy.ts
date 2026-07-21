/**
 * Bot policy framework (owner ask 2026-07-21; docs/bot-sims-handoff.md). A `BotPolicy` is a pure
 * `act(state) => Action` over the reducer's existing action space — the balance harness applies it in a loop
 * until the run terminates. The four shipped bots (greedy / tempo / midrange / meta) share ONE turn engine
 * here and differ only by their `BotWeights` + a few behaviour knobs; the meta bot layers combat rollout on
 * top (see rollout.ts).
 *
 * Everything is deterministic (no RNG of its own) so a report reproduces exactly.
 */
import type { Action } from '../state';
import type { RunState, BoardCard } from '../state';
import { CONFIG } from '../config';
import { reduce } from '../reducer';
import { refreshCostOf, upgradeCostOf } from '../reducer';
import { getHero } from '../heroes';
import { CARD_INDEX } from '@game/content';
import { cardScore, type BotWeights } from './scoring';
import { bestFinalArrangement } from './rollout';

export interface BotBehaviour {
  /** Buy nothing scoring below this. A low bar = grab everything (greedy); a high bar = hold out (tempo). */
  buyThreshold: number;
  /** Gold to keep in reserve rather than spend (economy discipline). */
  goldReserve: number;
  /** 0..1 eagerness to upgrade the tavern when affordable (past the reserve). */
  upgradeBias: number;
  /** Reroll when no shop offer clears `buyThreshold` and gold allows (past reserve + roll cost). */
  reroll: boolean;
  /** Sell the weakest body to make room for a clearly-better shop card when the board is full. */
  sellForUpgrade: boolean;
  /** Use combat rollout to choose the final board arrangement before ending the turn (meta bot). */
  rollout: boolean;
}

export interface BotPolicy {
  id: string;
  name: string;
  weights: BotWeights;
  behaviour: BotBehaviour;
  act(state: RunState): Action;
}

/** Does applying `action` actually change the state? (guards against returning a no-op that stalls the loop). */
function legal(state: RunState, action: Action): boolean {
  return reduce(state, action) !== state;
}

/** Hero powers whose value is ENABLING THIS TURN's economy — gold, cheap minions, a Discover, tier/quest
 *  access — so they should fire EARLY, before the buy loop, while there's still gold/board to use them on.
 *  Everything else (buffs, keyword grants, resummons, replays) fires LATE, after the board is built, so it
 *  lands on the finished board / a keeper rather than a random early minion. */
const EARLY_POWERS = new Set<string>([
  'scalingGold', 'sellGold', 'recurringGoldcrafter', 'gainMaxMana', 'cheapMinions', 'secondHand',
  'dynamiteDig', 'pathfinder', 'dragonTamer', 'discoLock', 'summitLock', 'chaos', 'spellAmplify',
  'quest', 'lesserQuest', 'questChronos', 'runeforge', 'epicRuneforge',
]);

/** Build the hero-power action: untargeted powers take no uid; targeted ones aim at the HIGHEST-value board
 *  minion (a buff/ward/gild wants your keeper, not `board[0]`). Returns the action, or null if it isn't
 *  legal right now (no charge / no valid target). */
function heroPowerAction(state: RunState, w: BotWeights): Action | null {
  const power = getHero(state.heroId).power;
  if (power.untargeted) {
    const a: Action = { type: 'heroPower' };
    return reduce(state, a) !== state ? a : null;
  }
  let best: BoardCard | undefined; let bestV = -Infinity;
  for (const c of state.board) { const d = CARD_INDEX[c.cardId]; const v = d ? cardScore(d, state, w) : 0; if (v > bestV) { bestV = v; best = c; } }
  if (!best) return null;
  const a: Action = { type: 'heroPower', uid: best.uid };
  return reduce(state, a) !== state ? a : null;
}

/** The shared turn engine. Every bot calls this; `w`/`b` are its personality. Returns ONE action — the loop
 *  calls repeatedly, so a turn is a sequence of these until `faceOmen`. */
export function decide(state: RunState, w: BotWeights, b: BotBehaviour): Action {
  // ---- Forced / overlay decisions first (they gate progress) ----
  if (state.discover) {
    // Pick the highest-scoring Discover option. `state.discover` is the cardId list directly.
    const opts = state.discover;
    let bestI = 0, bestV = -Infinity;
    opts.forEach((id, i) => { const d = CARD_INDEX[id]; const v = d ? cardScore(d, state, w) : -Infinity; if (v > bestV) { bestV = v; bestI = i; } });
    return { type: 'discover', index: bestI };
  }
  if (state.chooseOne) return { type: 'chooseOne', index: 0 }; // valuing Choose One options is future work
  if (state.pendingTarget) {
    // Target the highest-value friendly (most buff-worthy body); fall back to the pending default.
    let best: BoardCard | undefined; let bestV = -Infinity;
    for (const c of state.board) { const d = CARD_INDEX[c.cardId]; const v = d ? cardScore(d, state, w) : 0; if (v > bestV) { bestV = v; best = c; } }
    return { type: 'battlecryTarget', targetUid: best?.uid ?? state.pendingTarget.uid };
  }
  if (state.questOffer) return { type: 'buyQuest', index: 0 };     // quest valuation is future work — take one
  if (state.runeforgeOffer) return { type: 'buyRune', index: 0 };  // rune valuation is future work — take one
  if (state.phase === 'combat') return { type: 'resolveCombat' };
  if (state.phase !== 'recruit') return { type: 'faceOmen' };

  // ---- Recruit turn ----
  // 1. Play a hand card when there's board room (free value; holding cards is almost never right for a bot).
  if (state.board.length < CONFIG.boardMax) {
    const playable = state.hand.find((c) => legal(state, { type: 'play', uid: c.uid }));
    if (playable) return { type: 'play', uid: playable.uid };
  }

  // 2. EARLY hero power — only the economy/enabling kinds, so their gold/cards fuel THIS turn's buys. Buff
  //    powers wait for step 5b (a built board / a keeper to land on).
  if (state.heroReady && EARLY_POWERS.has(getHero(state.heroId).power.kind)) {
    const hp = heroPowerAction(state, w);
    if (hp) return hp;
  }

  // 3. Buy the best shop offer above threshold, if there's room + gold (past the reserve).
  const spendable = state.embers - b.goldReserve;
  const roomOnBoard = state.board.length + state.hand.length < CONFIG.boardMax;
  const offers = state.shop.map((o) => ({ o, def: CARD_INDEX[o.cardId] })).filter((x) => x.def);
  const scored = offers
    .map((x) => ({ ...x, v: cardScore(x.def!, state, w) }))
    .sort((a, z) => z.v - a.v);
  const top = scored[0];

  if (top && roomOnBoard && top.v >= b.buyThreshold && spendable >= CONFIG.minionCost) {
    const buy: Action = { type: 'buy', uid: top.o.uid };
    if (legal(state, buy)) return buy;
  }

  // 3b. Board full but a shop card clearly beats our weakest body → sell the weakest, then buy next call.
  if (b.sellForUpgrade && !roomOnBoard && top && spendable >= CONFIG.minionCost) {
    let worst: BoardCard | undefined; let worstV = Infinity;
    for (const c of state.board) { const d = CARD_INDEX[c.cardId]; const v = d ? cardScore(d, state, w) : 0; if (v < worstV) { worstV = v; worst = c; } }
    if (worst && top.v > worstV + 3 && legal(state, { type: 'sell', uid: worst.uid })) return { type: 'sell', uid: worst.uid };
  }

  // 4. Upgrade the tavern (economy tempo) when affordable past the reserve and the bot leans into it.
  const upCost = upgradeCostOf(state);
  if (b.upgradeBias > 0 && state.tier < CONFIG.maxTier && state.embers - upCost >= b.goldReserve) {
    // Bias gates HOW eagerly: <1 only upgrades when nothing worth buying is on offer.
    const worthBuying = top && top.v >= b.buyThreshold && roomOnBoard;
    if (b.upgradeBias >= 1 || !worthBuying) {
      if (legal(state, { type: 'upgrade' })) return { type: 'upgrade' };
    }
  }

  // 5a. LATE hero power — buff/board kinds fire now, after buying, on the best keeper (targeting fixed).
  if (state.heroReady && !EARLY_POWERS.has(getHero(state.heroId).power.kind)) {
    const hp = heroPowerAction(state, w);
    if (hp) return hp;
  }

  // 5. Reroll to dig for something better, if the bot rerolls and gold allows past the reserve.
  if (b.reroll && roomOnBoard) {
    const rollCost = refreshCostOf(state);
    const nothingGood = !top || top.v < b.buyThreshold;
    if (nothingGood && state.embers - rollCost >= b.goldReserve && legal(state, { type: 'roll' })) {
      return { type: 'roll' };
    }
  }

  // 6. Meta rollout: choose the final board arrangement by simulating vs the pinned opponent, then end.
  if (b.rollout) {
    const repo = bestFinalArrangement(state, w);
    if (repo) return repo;
  }

  // 7. Nothing left to do — end the turn.
  return { type: 'faceOmen' };
}
