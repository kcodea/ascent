import type { BoardMinion, CardDef, Minion, Side } from '../types';

export type CardIndex = Record<string, CardDef>;

/** Whether a card re-attacks on kill (Gnasher) — a constant per CardDef, memoized so `instantiate` (run
 *  for every minion in every one of the ~1001 sims per faceOmen) doesn't re-scan `effects` on each clone. */
const reAttackCache = new Map<string, boolean>();
function cardReAttacksOnKill(card: CardDef): boolean {
  let v = reAttackCache.get(card.id);
  if (v === undefined) {
    v = card.effects.some((e) => e.do === 'reAttackOnKill');
    reAttackCache.set(card.id, v);
  }
  return v;
}

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
  // Better Bot: own base Rally (×golden for a standalone Better Bot) + any welded onto it (already
  // golden-baked at weld time, stored on board.rallyMechAtk).
  const rallyMechAtk = (board.rallyMechAtk ?? 0) + (card.rallyMechAtk ?? 0) * (board.golden ? 2 : 1);
  return {
    uid: mkUid(),
    cardId: card.id,
    name: card.name,
    tribe: card.tribe,
    tribe2: card.tribe2,
    attack: board.attack,
    health: board.health,
    maxHealth: board.health,
    keywords,
    divineShield: keywords.includes('DS'),
    rebornAvailable: keywords.includes('R'),
    golden: board.golden ?? false,
    reAttackOnKill: cardReAttacksOnKill(card),
    summonBonus: board.summonBonus ?? 0,
    overflowBonus: board.overflowBonus, // Flowing Monk: flat grant bonus from the triple combine
    hpGrantBonus: board.hpGrantBonus, // Sergeant: seed the Deathrattle HP-grant accrual from the run board
    ascendProgress: board.ascendProgress, // Tara: seed the ascend tally so the live tracker shows the total
    spellProgress: board.spellProgress, // Guel: seed the per-instance spell tally for the live combat text
    sourceUid: board.sourceUid,
    rallyMechAtk: rallyMechAtk > 0 ? rallyMechAtk : undefined,
    resummon: board.resummon, // The Reclaimer's start-of-combat destroy + resummon mark
    buffs: board.buffs, // recruit-phase buff breakdown, carried into the snapshot for the combat inspect
    side,
    effects: card.effects,
    dead: false,
  };
}
