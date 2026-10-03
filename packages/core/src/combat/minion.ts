import { type BoardMinion, type CardDef, type Minion, type Side, type Tribe } from '../types';

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
 * The ONE fold of an instance's extra tribes into the two tribe slots every combat check and every card face reads
 * (`tribe` / `tribe2`). Printed tribes keep their slots; extras (`addedTribes`: Anomaly Reactor's added type, Rune of
 * Soul Script's Undead Starform, Rune of Drakko's run-wide Dragon + Spirit) fill what is free, and a NEUTRAL printed
 * tribe is "no type", so it yields its slot: a neutral Drakko with Dragon + Spirit is a Dragon / Spirit. A body never
 * holds more than two (a printed dual keeps its pair). Pure; shared by combat `instantiate` and the UI's tribe line.
 */
/** A combat body's second tribe when it was ADDED (folded in by `foldTribes`), i.e. differs from the card's printed
 *  one; undefined otherwise. The combat snapshot carries only this, so the card face can print it. */
export function addedSecondTribe(m: { cardId: string; tribe2?: Tribe }, cards: Record<string, CardDef | undefined>): Tribe | undefined {
  const printed = cards[m.cardId]?.tribe2;
  return m.tribe2 && m.tribe2 !== printed ? m.tribe2 : undefined;
}

export function foldTribes<T extends string>(tribe: T, tribe2: T | undefined, extra: readonly T[] | undefined): { tribe: T; tribe2?: T } {
  if (!extra || extra.length === 0) return tribe2 === undefined ? { tribe } : { tribe, tribe2 };
  const seen: T[] = [];
  for (const t of [tribe, tribe2, ...extra]) if (t && t !== 'neutral' && !seen.includes(t)) seen.push(t);
  if (seen.length === 0) return tribe2 === undefined ? { tribe } : { tribe, tribe2 };
  return seen[1] === undefined ? { tribe: seen[0]! } : { tribe: seen[0]!, tribe2: seen[1] };
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
  // The live effects list: printed + Gravetwin's copied Echo + runtime shop grafts (Echo Mimic / Grave Body /
  // Contract Rewrite / Rune of Rebirth) — one channel, so a grafted Deathrattle is as real in combat as a
  // printed one (owner ruling 2026-08-27). An `echoStripped` body ("summon a copy WITHOUT the Echo", marked
  // in the shop where there is no per-instance effects list to filter) drops every `onDeath` effect here —
  // the exact rule combat's own `stripEchoes` applies to copies created mid-fight.
  let effects = board.copiedEcho?.length || board.grantedEffects?.length
    ? [...card.effects, ...(board.copiedEcho ?? []), ...(board.grantedEffects ?? [])]
    : card.effects;
  if (board.echoStripped) effects = effects.filter((e) => e.on !== 'onDeath');
  const keywords = board.keywords ? [...board.keywords] : [...card.keywords];
  // A RESILIENT Ward is always a Ward too ('RW' rides beside 'DS'): normalise a body that carries only 'RW'.
  if (keywords.includes('RW') && !keywords.includes('DS')) keywords.push('DS');
  // Better Bot: own base Rally (×golden for a standalone Better Bot) + any welded onto it (already
  // golden-baked at weld time, stored on board.rallyMechAtk).
  const rallyMechAtk = (board.rallyMechAtk ?? 0) + (card.rallyMechAtk ?? 0) * (board.golden ? 2 : 1);
  return {
    uid: mkUid(),
    cardId: card.id,
    name: card.name,
    // Added instance tribes (Anomaly Reactor, Soul Script, Rune of Drakko's run-wide types) fold into the two slots
    // through `foldTribes`, so every combat tribe check (m.tribe / m.tribe2) honours them. A printed dual keeps its pair.
    ...foldTribes(card.tribe, card.tribe2, board.addedTribes),
    attack: board.attack,
    health: board.health,
    maxHealth: board.health,
    keywords,
    divineShield: keywords.includes('DS'),
    rebornAvailable: keywords.includes('R'),
    golden: board.golden ?? false,
    // CELESTIAL: the alignment locked in at combat setup (recruit-phase centring). Carried onto the combat
    // instance so alignment-gated effects can read it; combat never recomputes it.
    align: board.align,
    reAttackOnKill: cardReAttacksOnKill(card),
    critChance: board.critChance ?? card.critChance, // Commander Impala: per-swing double-damage chance (constant per CardDef); a spell (Executioner's Edge) can seed one onto the combat board for one fight

    summonBonus: board.summonBonus ?? 0,
    chefGrantedLast: board.chefGrantedLast, // Rune of the Chef: last shop turn's granted total
    eotBonus: board.eotBonus, // Ritualist: seed the End-of-Turn grant accrual so the live combat text shows its per-tick value
    chosenOption: board.chosenOption, // Choose One: display-only, so the combat card prints the branch it became
    taughtSpellId: board.taughtSpellId, // Mage-Pup: display-only, so the combat card names the spell it cast
    sellBonus: board.sellBonus, // Trail Forager: seed the accrued sell value for the live combat text (no combat effect)
    eotTick: board.eotTick, // Frontdrake / Money Maker / Vineweaver: seed the cadence counter for the live combat text
    // Bounty Bot: fresh each combat — immune for its first N swings, spent per attack. Mauron
    // (attackImmuneAlways) seeds 1 and never spends it (see the swing site in simulate).
    attackImmuneLeft: card.attackImmuneAlways ? 1 : card.attackImmuneTurns,

    overflowBonus: board.overflowBonus, // Flowing Monk: flat grant bonus from the triple combine
    hpGrantBonus: board.hpGrantBonus, // Sergeant: seed the Deathrattle HP-grant accrual from the run board
    ascendProgress: board.ascendProgress, // Tara: seed the ascend tally so the live tracker shows the total
    spiritTally: board.spiritTally, // Set 3 Spirits: Forest Colossus's Start of Combat reads it
    // Pummel (Han Gover, Goldvein): seed the LIFETIME damage meter from the run card (or the served snapshot), so
    // the tally continues from where the last fight left it — carry-over ruling 2026-09-21. Only the PAYOUT is
    // once per combat (`pummelFired`, fresh on this new instance); the count never resets.
    damageDealt: board.damageDealt,
    soldProgress: board.soldProgress, // Runic Archivist: display-only, so the combat card reads its live count
    boardFirstSpellId: board.boardFirstSpellId, // Spell Warden: display-only
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
    // Ashen Heir: seed the SHOP bank into the fight — CLONED, so combat banking/payouts mutate this fight's
    // copy and never the run's (or the shared snapshot's) bank (owner ruling 2026-08-27).
    impBank: board.impBank ? { ...board.impBank } : undefined,
    resummon: board.resummon, // The Reclaimer's start-of-combat destroy + resummon mark
    partingCry: board.partingCry,   // Parting Cry: its Shout fires as it dies this fight
    closedCasket: board.closedCasket, // Closed Casket: Echo at SoC, suppressed on the first death
    buffs: board.buffs, // recruit-phase buff breakdown, carried into the snapshot for the combat inspect
    side,
    // Gravetwin's copied Echo + runtime shop grafts + the echoStripped filter — assembled above.
    effects,
    dead: false,
  };
}
