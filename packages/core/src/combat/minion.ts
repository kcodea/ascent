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
    // Anomaly Reactor: fold a spell-added instance tribe into the free tribe2 slot, so every combat tribe check
    // (m.tribe2 === 'mech' — Rally-Mech, Shared Circuit, …) honors it. (A minion that already has a printed
    // tribe2 keeps it — a rare dual-tribe body can't take a third tribe in combat.)
    tribe2: card.tribe2 ?? board.addedTribes?.find((t) => t !== card.tribe),
    attack: board.attack,
    health: board.health,
    maxHealth: board.health,
    keywords,
    divineShield: keywords.includes('DS'),
    rebornAvailable: keywords.includes('R'),
    golden: board.golden ?? false,
    reAttackOnKill: cardReAttacksOnKill(card),
    summonBonus: board.summonBonus ?? 0,
    attackImmuneLeft: card.attackImmuneTurns, // Bounty Bot: fresh each combat — immune for its first N swings, spent per attack

    overflowBonus: board.overflowBonus, // Flowing Monk: flat grant bonus from the triple combine
    hpGrantBonus: board.hpGrantBonus, // Sergeant: seed the Deathrattle HP-grant accrual from the run board
    ascendProgress: board.ascendProgress, // Tara: seed the ascend tally so the live tracker shows the total
    spellProgress: board.spellProgress, // Guel: seed the per-instance spell tally for the live combat text
    sourceUid: board.sourceUid,
    rallyMechAtk: rallyMechAtk > 0 ? rallyMechAtk : undefined,
    // Perfect Core (welded): the host grants this-many random spells on attack. Welded portion only —
    // a standalone Perfect Core grants via its own onAttack `rallyGrantSpell` effect, so no double-count.
    rallySpellWeld: board.rallySpellWeld && board.rallySpellWeld > 0 ? board.rallySpellWeld : undefined,
    bloodlust: board.bloodlust, // Bloodlust: an immediate immune attack at Start of Combat (one combat)
    bloodbinderMode: board.bloodbinderMode, // Bloodbinder: which stat its Rally gives Fodder this fight (atk/hp)
    universalTribe: board.universalTribe || card.universalTribe || undefined, // counts as every tribe (Anomaly Reactor "All" OR a universal-tribe CardDef like Chaos Attachment)
    bloodlustRally: board.bloodlustRally, // Bloodlust's welded Rally: give a friendly minion this minion's Attack (one combat)
    resummon: board.resummon, // The Reclaimer's start-of-combat destroy + resummon mark
    buffs: board.buffs, // recruit-phase buff breakdown, carried into the snapshot for the combat inspect
    side,
    // Gravetwin carries its copied Echo into combat as a real Deathrattle, so it PROCS when Gravetwin dies in
    // combat (not only at the next shop if it survives) — including growth effects like Grim's (owner 2026-07-13).
    effects: board.copiedEcho?.length ? [...card.effects, ...board.copiedEcho] : card.effects,
    dead: false,
  };
}
