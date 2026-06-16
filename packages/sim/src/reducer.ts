import { makeRng, simulate, type BoardMinion, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CONFIG } from './config';
import { rollShop } from './shop';
import { buildEnemyBoard, selectThreat } from './threats';
import { applyOnBuy, playCard } from './recruit';
import { mixSeed, TAG, type Action, type BoardCard, type RunState } from './state';

/**
 * The run-loop state machine as a pure reducer: `(state, action) => state`
 * (handoff C.6). Never mutates its input — returns the same reference for a
 * no-op (invalid action) and a fresh state for a real transition.
 *
 * Recruit-phase card effects (Battlecries, buff-on-summon-on-buy) are not wired
 * yet — minions enter the board at their base stats. That's the next increment;
 * the combat-time effect system already works (see `@game/core`).
 */
export function reduce(state: RunState, action: Action): RunState {
  if (state.phase === 'gameover') return state;
  const s: RunState = structuredClone(state);

  // Recruit actions apply only in the recruit phase; `resolveCombat` only in combat.
  if (s.phase !== 'recruit' && action.type !== 'resolveCombat') return state;

  switch (action.type) {
    case 'buy': {
      const i = s.shop.findIndex((c) => c.uid === action.uid);
      if (i < 0 || s.embers < CONFIG.minionCost || s.hand.length >= CONFIG.handMax) return state;
      const offer = s.shop[i]!;
      const card = CARD_INDEX[offer.cardId];
      if (!card) return state;
      s.shop.splice(i, 1);
      s.embers -= CONFIG.minionCost;
      const bought: BoardCard = {
        uid: `b${s.uidSeq++}`,
        cardId: card.id,
        tribe: card.tribe,
        attack: card.attack,
        health: card.health,
        keywords: [...card.keywords],
        golden: false,
      };
      s.hand.push(bought); // buy → hand (Battlegrounds flow)
      applyOnBuy(s, bought); // buy-triggers (Broker) bake in now (handoff C.5)
      return s;
    }

    case 'play': {
      // hand → board (Battlegrounds: play to trigger summon-buffs + Battlecry)
      const i = s.hand.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const card = s.hand[i]!;

      // Magnetic (handoff A.4): a Cling Drone dropped directly onto a friendly
      // Mech merges its stats in instead of taking a board slot — so it works on
      // a full board and fires no summon-buff / Battlecry.
      if (card.keywords.includes('M') && action.toIndex !== undefined && action.toIndex < s.board.length) {
        const target = s.board[action.toIndex];
        if (target && target.tribe === 'mech') {
          s.hand.splice(i, 1);
          target.attack += card.attack;
          target.health += card.health;
          for (const k of card.keywords) {
            if (k !== 'M' && !target.keywords.includes(k)) target.keywords.push(k);
          }
          return s;
        }
      }

      if (s.board.length >= CONFIG.boardMax) return state;
      s.hand.splice(i, 1);
      const to =
        action.toIndex === undefined
          ? s.board.length
          : Math.max(0, Math.min(s.board.length, action.toIndex));
      s.board.splice(to, 0, card);
      playCard(s, card);
      return s;
    }

    case 'sell': {
      // Sell from the board or the hand.
      const bi = s.board.findIndex((c) => c.uid === action.uid);
      if (bi >= 0) {
        s.board.splice(bi, 1);
      } else {
        const hi = s.hand.findIndex((c) => c.uid === action.uid);
        if (hi < 0) return state;
        s.hand.splice(hi, 1);
      }
      s.embers = Math.min(s.maxEmbers, s.embers + CONFIG.sellValue);
      return s;
    }

    case 'roll': {
      if (s.embers < CONFIG.refreshCost) return state;
      s.embers -= CONFIG.refreshCost;
      s.frozen = false;
      rollShop(s);
      return s;
    }

    case 'freeze': {
      s.frozen = !s.frozen;
      return s;
    }

    case 'upgrade': {
      if (s.tier >= CONFIG.maxTier || s.embers < s.upgradeCost) return state;
      s.embers -= s.upgradeCost;
      s.tier += 1;
      s.upgradeCost = s.tier >= CONFIG.maxTier ? 0 : (CONFIG.upgradeCost[s.tier + 1] ?? 0);
      return s;
    }

    case 'reposition': {
      const i = s.board.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const to = Math.max(0, Math.min(s.board.length - 1, action.toIndex));
      const [card] = s.board.splice(i, 1);
      if (card) s.board.splice(to, 0, card);
      return s;
    }

    case 'heroPower': {
      if (!s.heroReady) return state;
      const card = s.board.find((c) => c.uid === action.uid);
      if (!card) return state;
      card.attack += 1;
      card.health += 1;
      s.heroReady = false;
      return s;
    }

    case 'faceOmen': {
      // Resolve combat now (deterministic) but don't apply the outcome yet —
      // the UI replays the event log, then dispatches `resolveCombat`.
      const enemy = buildEnemyBoard(s.threat, s.wave, makeRng(mixSeed(s.seed, s.wave, TAG.ENEMY)));
      const player: BoardMinion[] = s.board.map((b) => ({
        cardId: b.cardId,
        attack: b.attack,
        health: b.health,
        keywords: [...b.keywords],
      }));
      s.lastCombat = simulate(player, enemy, makeRng(mixSeed(s.seed, s.wave, TAG.COMBAT)), CARD_INDEX);
      s.phase = 'combat';
      return s;
    }

    case 'resolveCombat': {
      if (s.phase !== 'combat' || !s.lastCombat) return state;
      advanceAfterCombat(s, s.lastCombat);
      return s;
    }
  }
}

/** Apply a resolved combat's outcome and advance to the next wave — or end the run. */
function advanceAfterCombat(s: RunState, result: CombatResult): void {
  if (result.result === 'lose') s.resolve = Math.max(0, s.resolve - result.playerDamage);

  if (s.resolve <= 0) {
    s.best = Math.max(s.best, s.wave);
    s.phase = 'gameover';
    return;
  }

  // Advance to the next wave (handoff A.1 step 5).
  s.wave += 1;
  s.best = Math.max(s.best, s.wave);
  s.maxEmbers = Math.min(CONFIG.embersCap, s.maxEmbers + CONFIG.embersPerWave);
  s.embers = s.maxEmbers;
  s.heroReady = true;
  if (s.tier < CONFIG.maxTier) {
    s.upgradeCost = Math.max(CONFIG.upgradeCostFloor, s.upgradeCost - CONFIG.upgradeDiscountPerWave);
  }
  const previous = s.threat;
  s.threat = selectThreat(s.wave, makeRng(mixSeed(s.seed, s.wave, TAG.THREAT)), previous);

  if (s.frozen) s.frozen = false;
  else rollShop(s);
  s.phase = 'recruit';
}
