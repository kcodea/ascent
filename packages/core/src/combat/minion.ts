import type { BoardMinion, CardDef, Minion, Side } from '../types';

export type CardIndex = Record<string, CardDef>;

/**
 * Clone a board minion into a live combat instance. Pulls identity/effects from
 * the (immutable) CardDef and current stats from the BoardMinion. The CardDef
 * is never mutated.
 */
export function instantiate(
  board: BoardMinion,
  side: Side,
  cards: CardIndex,
  mkUid: () => string,
): Minion {
  const card = cards[board.cardId];
  if (!card) throw new Error(`Unknown card: ${board.cardId}`);
  const keywords = board.keywords ? [...board.keywords] : [...card.keywords];
  return {
    uid: mkUid(),
    cardId: card.id,
    name: card.name,
    tribe: card.tribe,
    attack: board.attack,
    health: board.health,
    maxHealth: board.health,
    keywords,
    divineShield: keywords.includes('DS'),
    rebornAvailable: keywords.includes('R'),
    reAttackOnKill: card.effects.some((e) => e.do === 'reAttackOnKill'),
    side,
    effects: card.effects,
    dead: false,
  };
}
