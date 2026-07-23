import type { Rng } from './rng';
import type { CombatBus } from './events';

export type Tribe = 'beast' | 'undead' | 'mech' | 'dragon' | 'demon' | 'neutral' | 'kobold';

/** Keyword codes (handoff A.4). */
export type Keyword =
  | 'T' // Taunt
  | 'DS' // Divine Shield
  | 'V' // Venomous — destroys what it damages; drops off after its first CLASH (a Cleave clash is simultaneous, so one venom can fell up to three bodies before dropping)
  | 'W' // Windfury
  | 'R' // Reborn
  | 'C' // Cleave
  | 'M' // Magnetic
  | 'SC' // Start of Combat
  | 'CN' // Consume
  | 'FD' // Fodder — a cheap minion meant to be Consumed
  | 'IMM' // Immune — takes no damage
  | 'ST' // Stealth — can't be targeted by attacks; lost on attacking
  | 'RL' // Rally — triggers an effect each time this attacks
  | 'SL' // Slaughter — triggers an effect each time this kills an enemy minion
  | 'CR' // Critical Strike — a chance (see CardDef.critChance) to deal double damage on attack
  | 'EG'; // Engraved — stat gains during combat carry back to the run board (permanent)

/**
 * ── Trigger multipliers ────────────────────────────────────────────────────────────────────────────────
 * The families of trigger a card can make fire extra times. Before this existed, every multiplier
 * (Sylus, Drakko, Chronos) was a hardcoded `cardId === '…'` check in a DIFFERENT subsystem, with
 * inconsistent stacking rules and no single place to read them — the tech debt `docs/roadmap.md` flagged.
 * Uron, Oathbringer multiplies SIX families at once, which is what forced the generalisation.
 */
export type TriggerFamily =
  | 'battlecry' // Shout — onPlay
  | 'deathrattle' // Echo — onDeath
  | 'rally' // onAttack (RL)
  | 'slaughter' // onKill (SL)
  | 'endOfTurn'
  | 'startOfCombat';

/** A card's declared trigger multiplication. `extra` is the ADDITIONAL fires this copy grants (golden
 *  doubles it), so the total for a family is `1 + <contribution>`. `stacks` picks the combination rule:
 *  true sums every copy (Sylus), false takes the single best copy (Drakko, Chronos, Uron). */
export interface TriggerMultiplierDef {
  families: readonly TriggerFamily[];
  extra: number;
  stacks?: boolean;
}

/**
 * Extra fires contributed by the multiplier cards among `minions`, for one trigger family. Returns the
 * ADDITIONAL count (0 = no multiplier), so callers use `1 + extraTriggerFires(...)`.
 *
 * Stacking and non-stacking contributions combine ADDITIVELY with each other — a Sylus (stacking) plus a
 * Uron (non-stacking) grant +1 each. Within each rule the pre-existing semantics are preserved exactly:
 * stacking cards sum across copies, non-stacking cards contribute only their best single copy.
 */
export function extraTriggerFires(
  family: TriggerFamily,
  minions: readonly { cardId: string; golden?: boolean }[],
  getCard: (id: string) => CardDef | undefined,
): number {
  let summed = 0; // stacking cards (Sylus): every copy counts
  let best = 0; // non-stacking cards (Drakko / Chronos / Uron): the single best copy counts
  for (const m of minions) {
    const mult = getCard(m.cardId)?.triggerMultiplier;
    if (!mult || !mult.families.includes(family)) continue;
    const contribution = mult.extra * (m.golden ? 2 : 1);
    if (mult.stacks) summed += contribution;
    else best = Math.max(best, contribution);
  }
  return summed + best;
}

/** Shop tiers. 7 exists ONLY under the Summit rift — see `maxTierFor` in @game/sim, which is the
 *  single gate on whether a run can ever reach it. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Side = 'player' | 'enemy';

/** Trigger names the effect system can subscribe to. */
export type GameEvent =
  | 'onPlay'
  | 'onSummon'
  | 'onDeath'
  | 'onAttack'
  | 'onGainAttack' // a minion's Attack rose mid-combat (emitted by ctx.buff when the delta > 0) — Hunter
  | 'onDamaged' // a minion took damage that landed (emitted by dealDamage) — Gryphon
  | 'onLoseDivineShield'
  | 'onConsume'
  | 'onKill'
  | 'startOfCombat'
  | 'avenge' // after X friendly minions have died in combat
  | 'onBuy'
  | 'endOfTurn' // recruit phase: the turn ends (End Turn / timer hits 0)
  | 'battlecryTriggered' // recruit phase: a Battlecry just resolved (fires per Drakko repeat) — Karwind
  | 'cast' // a spell's own effect resolves (its chosen target is in the payload)
  | 'spellCast' // recruit phase: any spell was cast (for spell-tracking minions)
  | 'summonOverflow' // recruit phase: a summon couldn't fit on the full board (Flowing Monk)
  | 'goldSpent' // recruit phase: the player spent Gold — fires per threshold (Acid, Banksly)
  | 'cardsBought' // recruit phase: the player bought a card — fires per threshold (Korok, Banksly)
  | 'onSell'; // recruit phase: this minion is sold (Hoard Whelp — get Gold)

/**
 * Identifiers of registered effect primitives. Cards reference these by name
 * (data, not code). The combat simulator implements the combat-time set; the
 * run loop (`@game/sim`, M1) implements the recruit-time set. Grows as new
 * primitives are genuinely needed.
 */
export type EffectFactoryId =
  // combat-time (resolved inside simulate)
  | 'deathrattleSummon'
  | 'deathrattleSummonOverflowBuff' // Nanon: Deathrattle — summon tokens; overflow buffs a tribe (Mech)
  | 'buffOnSummon'
  | 'deathrattleBuffTribe'
  | 'reAttackOnKill'
  | 'onKillBuffSelf' // on kill: buff self — permanent via Engraved
  | 'onKillBuffSpellPower' // on kill: permanently raise run-wide spell power +atk/+hp, carried back (Gnasher)
  | 'onKillGrantFreeRolls' // (dial) Slaughter — bank N free rerolls for next shop (carried back)
  | 'onKillGrantAttachmentRefreshes' // Moe: Slaughter — N free refreshes + N shops with a guaranteed Magnetic (carried back)
  | 'onKillGrantGold' // Bounty Bot: Slaughter — grant N Gold into the next shop (carried back)
  | 'onKillCastSpell' // Hoardbreaker Drake: Slaughter — cast a board-wide stat spell (Growth) in combat
  | 'rallyCastSpell' // Hoardbreaker Drake: Rally — cast that same board-wide stat spell on its own attack
  | 'rallyCastRandomStatSpell' // Spell Drummer: Rally — cast a random stat spell on a random friend + copy self to hand
  | 'avengeCastRandomStatSpell' // Spark Capacitor: Avenge — cast a random stat spell on your lowest-Health Mech
  | 'deathrattleDamageAll' // Deathrattle: damage every minion on both sides (Blaster)
  | 'deathrattleDestroyKiller' // Deathrattle: destroy the minion that dealt the killing blow (Jenkins & Fi)
  | 'deathrattleBuffTribeByTally' // Deathrattle: buff a tribe by +per per Deathrattle triggered this game (Grim)
  | 'scDamage'
  | 'scSplitDamage'
  | 'scAoePerTribe'
  | 'scArmBleed' // Bloodbinder: Start of Combat — arm Bleed (every N combat attacks, deal this minion's Attack to T random enemies)
  | 'scEngraveNeighbor' // Start of Combat: grant Engraved (EG) to the minion(s) adjacent to self (Taurus)
  | 'deathrattleBuffRandom'
  | 'deathrattleBuffAllRandomStat' // Deathrattle: coin-flip a stat, buff every friend +amount of it (Sporeling)
  | 'onFriendDeathBuffRandom'
  | 'rallyBuff' // Rally: when this attacks, buff your other minions (combat)
  | 'rallyGrantMagnetic' // Mechanical Jouster — Rally: when this attacks, add a random Magnetic Mech to hand
  | 'rallyProcDeathrattle' // Rally: when this attacks, fire your leftmost minion's Deathrattle first (Deathsayer)
  | 'deathrattleGrantSpell' // Deathrattle: add a spell to your hand after combat (Arcane Weaver)
  | 'deathrattleGrantMagnetic' // Deathrattle: add a random Magnetic minion to your hand after combat (Junkyard Titan)
  | 'deathrattleBuffSpellPower' // Deathrattle: permanently raise the run-wide spell power (+atk/+hp to spells), carried back (Skullblade)
  | 'deathrattleBuffCardTypeRunWide' // Deathrattle: permanently buff a card type run-wide (board/hand/future), carried back (Grave Knit)
  | 'deathrattleFillTribe'
  | 'avengeBuff' // Avenge (X): after X friendly deaths, buff self (combat)
  // Mechs — Divine Shield walls + shield-break payoffs (resolved in combat)
  | 'scGrantShieldTribe'
  | 'scGrantReborn' // Gravewarden: Start of Combat — give a friendly Undead (not self) Rise; golden two
  | 'deathrattleGrantShield'
  | 'onShieldBreakGrantShield'
  | 'onShieldBreakDamage'
  | 'onShieldBreakBuffAll'
  // Demons — Consume / destroy (combat-resolved half)
  | 'onFriendDeathSummon'
  | 'scDestroyHighestAttack'
  | 'scGrantEnemyTaunt' // Arena Heckler: Start of Combat — give the enemy's rightmost minion Taunt; golden the two rightmost
  | 'scSummonCopy' // Mirrorhide Rhino: Start of Combat — summon a copy of this minion's current body; golden two
  | 'scTribeBuffPerSpell' // (legacy) Start of Combat — buff a tribe +N/+N, +M per spell cast this turn
  | 'scTribeBuffPerProgress' // Runescale Drake (legacy): Start of Combat — buff a tribe +N/+N, +1 per spell cast while this was on board
  | 'scTribeBuffPerSpellImproving' // Runescale Drake: Start of Combat — buff a tribe by (rate × spells cast this turn), rate improves every N spells on board
  | 'scTribeBuffPerPlayed' // (retired dial) Start of Combat — buff Beasts +N/+N, +M per Beast played this turn
  | 'scTribeBuffImproving' // Pack Leader: Start of Combat — buff Beasts +M/+M (base + accrued), improve permanently
  // recruit-time (resolved by @game/sim, baked into stats before combat)
  | 'battlecryBuffTribe'
  | 'battlecryBuffTarget' // Twilight Emissary: Battlecry — buff a CHOSEN friendly minion +atk/+hp (targetTribe-restricted)
  | 'battlecrySummon'
  | 'buffOnBuy'
  | 'buffBoardOnBuy' // On buy: buff your whole board (Brightwing Broker)
  | 'battlecryGrantKeyword'
  | 'battlecryGainRandomMinion' // Battlecry: add a random minion of a tier to your hand (Buddy Buddy)
  | 'battlecryDiscoverSpell' // Battlecry: Discover a spell (golden: grants the pick + a second random spell) (Black Belt Brian)
  | 'onBattlecryBuffTribe' // when any Battlecry resolves, buff your tribe (Karwind)
  | 'onBattlecryBuffFodder' // when any Battlecry resolves, permanently buff the Fodder card type run-wide (Bane)
  | 'battlecryBuffFodder' // The Godfodder (Choose One): Battlecry — buff the Fodder card type +atk/+hp run-wide
  | 'battlecryBuffSpellPower' // Battlecry: permanently raise the run-wide spell power (+atk/+hp to spells) (Cinderwing Matron)
  | 'endOfTurnBuff' // End of Turn: buff self (recruit)
  | 'endOfTurnMagnetizeMechs' // End of Turn: merge a token's stats into N friendly Mechs (Combinator)
  | 'buffFodderEverywhere' // End of Turn: buff the Fodder card type for the whole run (Ritualist)
  // Demons — Consume (recruit-resolved half)
  | 'addTavernFodder' // Maw of the Pit (End of Turn): queue Fodder into the next tavern
  | 'addFodderNextShops' // Soulfeeder (Shout): queue Fodder across the next N shops (fodderSchedule)
  | 'deathrattleAddFodder' // Burial Imp: Deathrattle queues Fodder into your next tavern, carried back (Demon)
  | 'deathrattleBuffFodder' // Burial Imp: Deathrattle permanently buffs your Fodder +atk/+hp, carried back (Demon)
  | 'avengeAddFodder' // Pit Supplier: Avenge (N) queues a Fodder into your next shop, carried back (Demon)
  | 'avengeGrantSpellPower' // Spell Appraiser: Avenge (N) permanently raises run-wide spell power, carried back
  | 'rallyImproveSummonAura' // Baby Cub: Rally bumps a friendly Den Mother's summon aura (summonBonus), carried back
  | 'avengeImproveSummon' // Kennelmaster: Avenge (X) permanently improves its summon buff
  | 'avengeMaxGold' // Soulsman: Avenge (X) raises your max Gold by 1, carried back (Undead)
  | 'scConsumeWeakestBuffDemons' // (retired from Speed Demon) Start of Combat — consume your weakest minion, Demons gain % of its stats
  | 'scBuffAlliesPctSelf' // Speed Demon: Start of Combat — give every other friendly minion %-of-self's stats (golden doubles the %)
  | 'rallyGrantSelfCopy' // Herald of the Apocalypse: Rally — add a copy of this minion to your hand (golden 2 per attack)
  | 'scEngraveAll' // Taurus the Truth Bringer: Start of Combat — Engrave ALL your minions (triggers first) (neutral)
  | 'rallyGiveHealthToDragons' // Chimerus: Rally — give this minion's Health to 2 friendly Dragons (Dragon)
  | 'rallyGrantSpell' // Perfect Core: Rally (on-attack) — add a random spell to hand after combat (Mech)
  | 'rallyBuffAttachments' // Chorus Engine: Rally — buff your Magnetic ("Attachment") minions +atk/+hp in combat (Mech)
  | 'onKillGrantMagnetic' // Chorus Engine: Slaughter (on-kill) — add a random Magnetic minion to hand after combat (Mech)
  | 'avengeBonusGold' // Bone Taxer: Avenge (X) grants +amount Gold into your next shop, carried back (Undead)
  | 'deathrattleMaxGold' // Bone Taxer: Echo — permanently raise your max Gold by +amount, carried back (Undead)
  | 'avengeGrantSpell' // Arcane Weaver: Avenge (X) adds a copy of a spell to your hand after combat (Dragon)
  | 'deathrattleGrantReborn' // Mumi: Deathrattle — grant a random friendly Undead Rise (Undead)
  | 'deathrattleBuffAll' // Sporeling: Deathrattle — give all friendly minions +atk/+hp (Undead)
  | 'battlecryTriggeredOwnDeathrattle' // Sporeling: every Battlecry you trigger procs this minion's own Deathrattle (counts toward the tally)
  | 'avengeGiveAttack' // Stuntdrake: Avenge (X) hands this minion's Attack to N friends (Dragon)
  | 'endOfTurnGrantTribe' // Frontdrake: every N End-of-Turns, conjure a random minion of a tribe to hand (Dragon)
  | 'endOfTurnGrantRandomTierCard' // Hoard Whelp: End of Turn — conjure a random Tier-N card (spell OR minion) to hand
  | 'onFriendlyAttackBuffTribe' // Raptor: when another friendly minion of a tribe attacks, buff it (Beast)
  | 'onAllyAttackBuffAll' // Crypt Drake: when any ally attacks, buff your minions — improving every N attacks
  | 'onAllyAttackCastGrowth' // Taragosa: when any ally attacks, cast Growth (+atk/+hp to all friends); golden ×2
  | 'onGainAttackBuffAll' // (legacy) when this minion's Attack rises, buff your minions' Health
  | 'onGainAttackBuffImproving' // Hunter: when this gains Attack, buff your minions +M/+M (scaling per-instance)
  | 'battlecryDiscoverMinion' // Sea Urchin: Battlecry — Discover a minion of a tribe (Beast)
  | 'onConsumeBuffSelf'
  | 'onConsumeGrantSelfKeyword'
  | 'onConsumeShieldNextCombat' // Maw of the Pit: on consume, gain a Divine Shield for the next combat only
  // Spells (recruit-resolved): a spell's own effect, and minions that cast spells
  | 'spellBuffTarget' // cast: buff the chosen target +atk/+hp (+ optional keyword: Spirit Fire, Bulwark)
  | 'spellBuffTargetPerGold' // Patch Job: buff the target +atk/+hp per N Gold spent this turn (recruit)
  | 'spellBuffAll' // cast: buff every friendly minion on the board (Growth) — scales with spell power
  | 'spellSetStats' // Perfect Vision: cast — set the target's stats to a fixed value (absolute, no scaling)
  | 'spellBuffTavern' // Apples (Choose One): cast — buff every current tavern offer (lost on refresh, kept on freeze)
  | 'spellBuffNextShop' // Apples (Choose One): cast — bank a buff folded onto the NEXT tavern roll's offers
  | 'spellPendingSCBuff' // Fleeting Vigor: cast — bank a one-shot Start-of-Combat buff for the next combat
  | 'spellDemonConsumeFodder' // Consume: cast — a chosen Demon creates and eats N Fodder
  | 'deathrattleGrantRandomSpell' // Sporebat: Deathrattle — grant N random tavern-tier spells to the hand (Beast)
  | 'onDamagedGrantRefresh' // Gryphon: on taking damage, bank a free shop reroll (once per combat) (Beast)
  | 'summonBuffTribeImprove' // Mama Bear: on summoning a beast, buff it + improve the buff in/out of combat (Beast)
  | 'countTribeSummon' // Pack Leader: on summoning a tribe member, accrue a permanent per-instance tally (summonBonus)
  | 'spellDevour' // cast: devour the target, spit its stats onto a random friend (Channeling the Devourer)
  | 'castSpell' // a minion casts a named spell (auto-targets a friend)
  | 'endOfTurnGetRandomSpells' // Crypt Scribe: End of Turn — conjure N random spells to hand
  | 'gainEmbers' // cast: gain Embers (untargeted — Ember Pouch)
  | 'spellCastBuffOthers' // spellCast: give N other friendly minions +atk/+hp (Archmagus Guel)
  | 'overflowBuffRandom' // summonOverflow: buff a random friendly minion (Flowing Monk)
  | 'spellCastTransform' // spellCast: tick a per-instance counter; at the threshold, transform into another card (Spirit Pup → Worgen)
  | 'spellCastImproveSelf' // spellCast: tick this instance's on-board spell tally (Runescale Drake) — no other effect
  | 'spellCastBuffSelf' // spellCast: buff self +atk/+hp per spell cast (Spirit Worgen)
  | 'summonBuffSelfTribe' // onSummon: buff self when a friendly minion of a given tribe is summoned (Spirit Worgen)
  // Spells (batch): tavern + run-level effects
  | 'spellBuffShop' // cast: buff every tavern offer +atk/+hp (Staff of Guel)
  | 'gainMaxMana' // cast: raise max Mana permanently (Mana Font)
  | 'grantFreeRolls' // cast: bank N free rerolls (Refreshing Texts)
  | 'spellGainOfTargetTribe' // cast: conjure a random minion of the target's tribe to hand (Tribes Choice)
  | 'spellGainRandomMinion' // cast: conjure a random buyable minion of a tier to hand (Summon Stone)
  | 'spellGildTarget' // cast: make the target Golden if its tier ≤ targetMaxTier (Eyes of Aresmar)
  | 'spellBuffTargetEscalating' // cast: +X/+X to the target, escalating per cast this run (Front to Back)
  | 'spellGrantTribeAttack' // cast: a tribe gets +Attack for the rest of the run (Lantern of Souls)
  | 'healHero' // cast: heal the hero (capped at max Resolve — Mend)
  | 'conjureTribeArmy' // cast: conjure N copies of a random buyable minion of a tribe to hand (Undead Army)
  | 'stealTavernMinion' // cast: steal a random minion offer from the tavern into the hand (Lasso)
  // --- combat factories (new content batch) ---
  | 'deathrattleGiveHealth' // Trickster: Deathrattle — give a random friendly minion this minion's HP (golden: twice)
  | 'scGainFodderStats' // Abhorrent Horror: Start of Combat — gain stats equal to all Fodder consumed this turn
  | 'onSummonSelfBuff' // Thundering Abomination: on any friendly summon in combat, buff self +atk/+hp (Engraved)
  | 'onSummonOverflowBuffTribe' // Thundering Abomination: on overflow summon, buff tribe +atk/+hp
  | 'deathrattleBuffAllHealth' // Sergeant: Deathrattle — give all friends +HP; improves when Sergeant gains Attack
  | 'onGainAttackImproveHpGrant' // Sergeant: when this gains Attack in combat, improve the Deathrattle HP grant
  | 'spellCastBuffUndeadAttack' // Forsaken Weaver (combat): on spell cast, give your Undead +Attack
  | 'deathrattleGrantCardToHand' // Pillager: Deathrattle — add a specific card to hand after combat
  | 'onKillBuffUndeadAttack' // Karthus: when this kills an enemy, give your Undead +Attack permanently
  | 'onKillBuffFodderImps' // Commander Impala: when this kills an enemy, buff your Fodder + Imps permanently
  | 'onDamagedGainAttack' // Target Dummy: on taking damage, gain +Attack permanently (once per hit)
  | 'deathrattleBuffImps' // Imp King: Deathrattle — buff all friendly Imps +atk/+hp (combat)
  | 'avengeBuffImps' // Brood Matron: Avenge (X) — buff all friendly Imps +atk/+hp (combat)
  | 'deathrattleReplayAdjacentBattlecry' // Ryme: Deathrattle — re-fire an adjacent minion's Battlecry in combat
  | 'battlecryBonusGoldNextTurn' // Hoarder: Battlecry — gain extra Gold next turn (recruit)
  | 'endOfTurnBonusGold' // Scrap Vendor: End of Turn — bank Gold into your next shop (recruit)
  | 'battlecryAllDemonsConsume' // Herald of the Apocalypse: Battlecry — every friendly Demon Consumes a Fodder (recruit)
  | 'spellBuffImpsPerDemon' // Implosion: cast — buff your Imps +atk/+hp, recast once per Demon you control (recruit)
  | 'getEchoAndTrigger' // Crypt Broker: Battlecry — get a random Echo minion + trigger its Echo (recruit)
  // --- recruit factories (new content batch) ---
  | 'battlecryBuffUndeadAttack' // Deathswarmer: Battlecry — give your Undead +Attack wherever they are; stacks into future buys
  | 'battlecryBuffBeastAttack' // (legacy) give your Beasts +Attack wherever they are; stacks into future buys
  | 'battlecryScoutSpread' // Squirl Scout: Battlecry — give a random friendly +N/+N per Beast owned; N snowballs per Squirl Scout played
  | 'battlecryBuffMagnetics' // Scrap Herald: Battlecry — give your Magnetic minions +atk/+hp wherever they are; stacks into future buys
  | 'battlecryBuffImps' // Imp Overseer: Battlecry — give your Imps +atk/+hp run-wide (shared impBuff enchant)
  | 'goldSpentBuffFodder' // Koron: every N Gold spent, permanently buff your Fodder run-wide (+ queue a Fodder)
  | 'goldSpentMagnetize' // Banksly: every N Gold spent, weld a random Magnetic onto self
  // --- tavern-spell batch (2026-06-26) ---
  | 'spellBuffByTier' // Lantern Light: cast — give the target +Tavern Tier / +Tavern Tier (recruit)
  | 'spellSellToDemon' // Fodder Treatment: cast — sell the target, give its stats to your left-most Demon (recruit)
  | 'spellSellToBeast' // Feed the Alpha: cast — sell the target, give its stats to your right-most Beast (recruit)
  | 'spellReplayBattlecry' // Resonance: cast — re-trigger a friendly Battlecry minion's Battlecry (recruit)
  | 'spellExtraEndOfTurn' // Chrono Staff: cast — your End-of-Turn effects fire 1 extra time this turn (recruit)
  | 'spellGildRandomTavern' // Golden Touch: cast — make a random tavern minion Golden (recruit)
  | 'spellDisplace' // Displacement: cast — swap the target friendly minion with a random tavern minion (recruit)
  | 'spellCopyRecent' // Steward of Spells: End of Turn — copy the most recent spell cast to hand (recruit)
  | 'spellRefreshToSpells' // Spell Cart: cast — refresh the tavern full of spells (recruit)
  | 'battlecryTargetConsumeFodder' // Godfodder: Battlecry — targeted friendly minion consumes a Fodder from the shop
  // --- Slaughter (on-kill) + random-spell batch ---
  | 'avengeGrantRandomSpell' // Professor Greg: Avenge (X) — get a random tavern-tier spell (golden 2)
  | 'rallyGrantRandomSpell' // Badgington: Rally — when this attacks, get a random tavern-tier spell
  | 'onKillGrantRandomSpell' // Badgington: Slaughter — when this kills an enemy, get a random tavern-tier spell
  | 'onKillBuffFodder' // Sword and Bored: Slaughter — when this kills an enemy, buff your Fodder +atk/+hp
  // --- 2026-07-05 content batch ---
  | 'avengeSummonAttack' // Steadfast Champion: Avenge (X) — summon a `cardId` minion that attacks immediately
  | 'spellAttackFirst' // Pre-emptive Assault: cast — your board attacks first in the next combat (recruit)
  // --- 2026-07-06 content batch ---
  | 'scBeastAura' // Kennelmaster: Start of Combat — Beast aura +N/+N (grown by Avenge), catches combat summons
  | 'rallyTribeAura' // Solaris Fang: Rally — Beast aura +N/+N for the rest of combat (catches combat summons)
  | 'rallyTribeAuraGrowing' // Trophy Stalker: Rally — Beast aura +N/+N (grows +step each attack via summonBonus)
  | 'rallyGiveDemonAttack' // (retired from Bloodbinder) Rally — give another friendly Demon +Attack = this minion's Attack
  | 'rallyBuffFodderHalf' // Bloodbinder: Rally — give your Fodder half this minion's Attack, as Attack/Health alternating each turn
  | 'rallyBuffFodder' // The Godfodder: Rally — permanently buff your Fodder +atk/+hp (carried back)
  | 'rallyDamageRandomEnemy' // Philippe: Rally — also deal its Attack to a random enemy (golden +2), no retaliation
  | 'avengeShieldAttack' // Solaris Fang: Avenge (X) — gain a Divine Shield and attack immediately
  | 'endOfTurnGrantSpellChoice' // Money Maker: every N turns, add a random card from a list to hand (recruit)
  | 'spellRallyDoubleNext' // Rallying Offensive: cast — your Rally effects trigger twice next combat (recruit)
  | 'rallyCastTribeAttack' // Watcher: Rally — cast Lantern of Souls (Undead +Attack run-wide) as a real spell cast
  | 'battlecryDoubleNextSpell' // Nimbus: Battlecry arms the next Tavern spell to cast twice (recruit)
  | 'endOfTurnCastSpellEscalating' // Vineweaver Drake: EoT casts a spell once per End of Turn seen (recruit)
  | 'battlecryGrantSpell' // Field Mechanic: Battlecry adds a specific spell (Patch Job) to your hand (recruit)
  | 'battlecryGrantMinion' // Attachment Mechanic: Battlecry adds a specific minion (Money Bot) to your hand (recruit)
  | 'endOfTurnAdjacentConsumeFodder' // Abyssal Feeder: EoT — both board-adjacent minions Consume a Fodder (recruit)
  | 'endOfTurnFeastConsume' // Feasting Bogrot: EoT — self Consumes a Fodder + shares its stats to adjacent (recruit)
  | 'endOfTurnBuffPerTribePlayed' // Spirit Worgen: EoT — gain per Beast/Dragon played this turn, +per spell cast (recruit)
  | 'endOfTurnBuffWeakestDragon' // Skybound Archivist: EoT — weakest Dragon gains N% of strongest Dragon's stats (recruit)
  | 'onSellGainGold' // Hoard Whelp: Sell — gain Gold (recruit)
  | 'battlecryDestroyForSpell' // Graverobber: Battlecry — destroy a friendly (procs its DR), get a spell of its tier (recruit)
  | 'spellTriggerEcho' // Ossuary Rite: cast — trigger a friendly minion's Echo (Deathrattle) out of combat, without destroying it (recruit)
  | 'battlecryCopyEcho' // Gravetwin: Battlecry — copy a targeted friendly Echo minion's Deathrattle onto itself (recruit)
  | 'spellBloodlust' // Bloodlust: cast — mark a friendly minion to take an immediate immune attack at Start of Combat (recruit)
  | 'copyLeftmostEcho' // Grave Body: Start of Combat / on-summon — copy your leftmost friendly Echo as this minion's combat Deathrattle
  | 'deathrattleBuffAllByImpAura' // Chef Raag: Echo — give your minions stats equal to your Imp Aura (combat)
  | 'buffFodderImpsImproving' // Ritualist: End of Turn — buff Imps + Fodder, escalating each trigger (recruit)
  | 'spellAddTribe' // Anomaly Reactor: cast — give the target minion an extra tribe (a Mech type) for the run (recruit)
  | 'spellAddAllTribes' // Anomaly Reactor: cast — give the target minion ALL types for the run (recruit)
  | 'onAttackStripKeywords'
  // --- Tier 7 (Summit) minions, 2026-07-20 ---
  | 'onAllyTribeAttackBuffSelf' // Thundeer: an ally of a tribe attacks -> buff self, improving
  | 'deathrattleGrantRebornAll' // Anubis: Echo grants Rise to your whole board
  | 'deathrattleCastTribeAttack' // Anubis: Echo casts Lantern of Souls
  | 'onSellDiscover' // Salvatore McKlusky: selling this opens Discovers
  | 'deathrattleGainRandomMinion' // Lab Experiment: Echo conjures a random minion of a tier
  | 'deathrattleBuffImpsImproving' // Amun Rab: Echo buffs Imps, improving each proc;
  | 'getRubies' // Set 2 — Shout/Rally: mint N Rubies into hand
  | 'rubyStatGain' // Set 2 — "Your Rubies gain +X/+Y": raise the run's Ruby strength (hand + future)
  | 'scPlayRubies' // Set 2 — Start of Combat: play N Rubies on your [tribe] minions (permanent carry-back)
  | 'avengePlayRubies'; // Set 2 — Avenge (X): play N Rubies on your [tribe] minions

export interface EffectDef {
  on: GameEvent;
  do: EffectFactoryId;
  params?: Record<string, unknown>;
}

/** Immutable card definition (data). Never mutated — cloned into Minions. */
export interface CardDef {
  id: string;
  name: string;
  tribe: Tribe;
  /** Optional second tribe — a dual-type minion (e.g. Heckbinder = Demon/Mech). Counts as both
   *  tribes for tribe checks (Magnetic targeting, tribe buffs) and renders a split-hue card. */
  tribe2?: Tribe;
  /** Counts as EVERY non-neutral tribe simultaneously: receives all tribe buffs and can Magnetize onto
   *  any non-neutral minion (Chaos Attachment). Absent = normal tribe matching. */
  universalTribe?: boolean;
  /** An "Imp" — the target of imp-buff effects (Fodder Feeder, Imp King, Brood Matron, Ritualist, Bane).
   *  Currently the 1/1 Imp token only. Run-wide imp buffs accrue into `RunState.impBuff` and apply to these
   *  in combat (imps are combat-summoned tokens); combat imp buffs target these directly. */
  imp?: boolean;
  tier: Tier;
  attack: number;
  health: number;
  keywords: Keyword[];
  effects: EffectDef[];
  /** Exact newcomer-facing text (handoff A.7), shipped verbatim. */
  text: string;
  /** Explicit golden (tripled) text — used verbatim when the card is golden, overriding the naive
   *  number-doubler. Needed when golden changes a *count* (Buddy Buddy adds two minions, Soulfeeder
   *  two Fodder) or for grammar ("1 more time" → "2 more times"). Cards where doubling the printed
   *  numbers is already correct leave this unset. */
  goldenText?: string;
  /** Non-buyable token (e.g. Pup, Stray, Imp). */
  token?: boolean;
  /** Tara → Taragosa: after being granted stats `ascendAt` times in combat, this card ascends to
   *  `ascendInto` at settle — keeping its accumulated (Engraved) stats, like Spirit Pup's transform. */
  ascendAt?: number;
  /** Bounty Bot: "immune while attacking" for this many combats after it enters play — the attacker takes no
   *  retaliation on its own swings. Tracked per-instance via `BoardMinion.attackImmuneLeft`. */
  attackImmuneTurns?: number;
  /** Mauron: "Immune while attacking" with NO charge limit — it never takes retaliation on its own swings.
   *  `attackImmuneTurns` is a DEPLETING counter (Bounty Bot spends one per swing), so an always-on version
   *  needs its own flag rather than a large sentinel number. Seeds `attackImmuneLeft` to 1 and the swing
   *  site skips the decrement, which keeps the per-instance value JSON-safe (no Infinity in a save). */
  attackImmuneAlways?: boolean;
  /** Mauron: when this attacks it also damages an ADJACENT enemy — ONE of them, or BOTH when gilded. Not
   *  Cleave, which always hits both and is a player-facing keyword; this is a per-card splash. */
  splashAdjacent?: boolean;
  /** This card makes whole FAMILIES of trigger fire extra times (Sylus, Drakko, Chronos, Uron). Resolved
   *  through `extraTriggerFires` — never by a hardcoded card-id check. */
  triggerMultiplier?: TriggerMultiplierDef;
  ascendInto?: string;
  /** Combat: this minion attacks immediately when summoned mid-fight, out of turn order — then joins the
   *  normal rotation (Twilight Whelp's 3/3 Whelp). Drained by the immediate-attack queue in `simulate`. */
  attackOnSummon?: boolean;
  /** A spell, not a minion: cast from hand for an effect, never takes a board slot. */
  spell?: boolean;
  /** A **Ruby** (set 2 Kobolds): a spell-like token that is NOT a Shop Spell — it plays from hand like a
   *  targeted spell (drag onto a minion) to grant that minion the Ruby's current Attack/Health as a buff,
   *  but it does NOT count for Shop-Spell triggers (Archmagus Guel, `spellsCast`). Rubies have their own
   *  cast counter; some cards trigger on the umbrella of BOTH (see the cast taxonomy in the reducer). A Ruby
   *  carries stats (base 1/1 + the run's `rubyBonus`, baked when minted) and is consumed on cast. */
  ruby?: boolean;
  /** This spell resolves exactly once — spell-quantity multipliers can't make it fire twice
   *  (Channeling the Devourer: devouring two minions would be absurd). */
  singleCast?: boolean;
  /** Purchase cost. Minions omit this (they use CONFIG.minionCost); spells set it. */
  cost?: number;
  /** Requires picking a target when played/cast. `'friendly'` = a friendly board minion only (spells
   *  whose text says "a FRIENDLY minion", targeted Battlecries); `'any'` = a friendly minion OR a tavern
   *  offer — buff it pre-buy (spells whose text says just "a minion", e.g. Shatter, Front to Back). */
  target?: 'friendly' | 'any';
  /** Restricts a `target: 'friendly'` pick to one tribe and excludes self (Toxin Tender →
   *  another friendly Undead). Absent = any friendly minion may be chosen. */
  targetTribe?: Tribe;
  /** Restricts a `target: 'friendly'` pick to minions of this tier or lower (Eyes of Aresmar → a
   *  Tier 4 or lower minion). Absent = no tier cap on the pick. */
  targetMaxTier?: number;
  /** Excludes golden (tripled) minions from a `target: 'friendly'` pick (Displacement — you can't trade
   *  away a triple). Absent = goldens are valid targets. Mirrored by Darah's Displace power in `swapWithTavern`. */
  targetNoGolden?: boolean;
  /** Excludes the SOURCE minion from its own `target: 'friendly'` pick (Graverobber can't destroy itself).
   *  `targetTribe` already implies this; use this flag for an otherwise-unrestricted pick. Absent = self is a
   *  legal target. Enforced in the reducer (`battlecryTarget`, authoritative) and mirrored by the aim UI. */
  targetNotSelf?: boolean;
  /** Demons: stat multiplier when this minion consumes a Fodder (Voracious Imp = 2; golden = +1).
   *  Default (absent) is 1 — a plain Demon gains the fodder's base stats. */
  fodderMult?: number;
  /** Commander Impala: Critical Strike — the probability (0–1) that each of this minion's attack swings
   *  deals DOUBLE damage. Seeded off the combat RNG, rolled per swing. Pairs with the 'CR' keyword pill. */
  critChance?: number;
  /** Money Bot: while this (or a Mech it magnetized into) is on the board, the player's max mana
   *  per turn is raised by this much (golden doubles). Recruit-only; lost when the card leaves. */
  manaPerTurn?: number;
  /** Better Bot: base Rally amount — when this (or a Mech it's magnetized onto) attacks, your OTHER
   *  Mechs get +this Attack. Stacks: each Better Bot magnetized onto a host adds its amount to the host. */
  rallyMechAtk?: number;
  /** Harry Botter: passive spell-power aura — while this (or a Mech it magnetized into) is on the board,
   *  stat-granting spells get +this/+this (golden doubles). Recruit-only; read by `spellStatBonus`. */
  spellAura?: number;
  /** Heckbinder: passive Fodder aura — while this (or a host it magnetized into) is on the board, every
   *  NEW Fodder (tavern offer, conjure, steal) gets +attack/+health more (golden doubles). Recruit-only;
   *  folded into `cardBuff` via `fodderAuraLiveBonus`. */
  fodderAura?: { attack: number; health: number };
  /** Choose One: when played, the player picks one of these options; its `effects` then resolve
   *  as the card's Battlecry (in place of `onPlay`). Each option carries its own display text. */
  chooseOne?: { text: string; goldenText?: string; effects: EffectDef[]; target?: 'friendly' | 'any' }[];
  /** Discover-on-play: playing this card opens a Discover (a peek) and consumes the card — no board slot,
   *  no `cast` effect, and never multiplied by spell-quantity (Yazzus). Used by the tavern Discover spells
   *  (Sprout, Help Wanted, Tribe Portal, Corpse Board) and the golden Triple Reward token. The tier/tribe
   *  are resolved at play time from the live run (see `DiscoverOnPlay`). Replaces what was a per-card-id
   *  branch in the reducer — new Discover spells are now data-only. */
  discoverOnPlay?: DiscoverOnPlay;
}

/** Declarative spec for {@link CardDef.discoverOnPlay}. The offer tier is `exactTier` if set, otherwise the
 *  current tavern tier plus `tierOffset` (default 0). A bare `{}` Discovers from EVERY tier up to the current
 *  one (the standard Discover pool). Set `exactCurrentTier` to restrict the pool to your current tier ONLY. */
export interface DiscoverOnPlay {
  /** Fixed offer tier, ignoring the tavern tier (Sprout = always Tier 1). */
  exactTier?: number;
  /** Restrict the pool to your CURRENT tavern tier only (Key Findings: "a minion from your tier"), resolved at
   *  play time. Distinct from `exactTier` (a fixed number) — this tracks the live tier. */
  exactCurrentTier?: boolean;
  /** Added to the current tavern tier to choose the offer tier, engine-capped (Triple Reward = +1). */
  tierOffset?: number;
  /** Narrow the pool to minions with this trigger. */
  filter?: 'battlecry' | 'deathrattle';
  /** Restrict to one tribe; `'dominant'` resolves to the player's most-common board tribe at play time
   *  (Tribe Portal). A tribe-less board falls back to an unfiltered Discover. */
  tribe?: Tribe | 'dominant';
  /** Bias the offer toward the highest eligible tier when the pool spans tiers (the reward's peek-up bias). */
  topTierFirst?: boolean;
}

// ── Quests ───────────────────────────────────────────────────────────────────────────────────────────────
/** A quest's tier — one per quest-turn: wave 4 = lesser, wave 8 = greater, wave 12 = capstone. */
export type QuestTier = 'lesser' | 'greater' | 'capstone';
/**
 * The player action a quest objective counts. Two families:
 *  - RECRUIT-phase (ticked +1 per action in the reducer): `buy` / `play` / `sell` / `roll`; `summon` counts
 *    every minion that ENTERS your board during recruit (plays PLUS tokens from Shouts/Echoes); `shout` counts
 *    Battlecry minions you play. `tribe` narrows `buy` / `summon` to one tribe.
 *  - COMBAT-phase (tallied inside `simulate()`, applied +N post-combat in settleCombat): `attack` = your
 *    minions' attacks; `summonCombat` = minions summoned to your board mid-fight; `slaughter` = enemy minions
 *    your minions kill (the on-kill / Slaughter hook); `deathrattle` = your Deathrattles ("Echoes") that fire.
 *    `tribe` narrows `attack` / `summonCombat` / `slaughter` to the acting/summoned minion's tribe. */
export type QuestObjectiveEvent =
  | 'buy' | 'play' | 'sell' | 'roll' | 'summon' | 'shout'
  | 'attack' | 'summonCombat' | 'slaughter' | 'deathrattle'
  // The Red Trail: `slaughterKeyword` counts Slaughter-KEYWORD triggers — a player minion with an on-kill effect
  // felling an enemy by attacking (distinct from `slaughter`, which counts ANY kill and reads "Kill N enemies").
  | 'slaughterKeyword'
  // Dragon set: `spendGold` counts Gold spent (advances by the amount); `endOfTurn` counts End-of-Turn effect
  // TRIGGERS (Chronos + the Parliament reward multiply it); `tribeStats` counts +Attack/+Health BUFFS granted to
  // `tribe` (base stats excluded) — advances by (attack + health) per buff.
  | 'spendGold' | 'endOfTurn' | 'tribeStats'
  // Undead set: `friendlyDeath` counts friendly minions that DIE in combat — a raw entity-death count, so unlike
  // `deathrattle` (Echo TRIGGERS, which Sylus/doublers multiply) it does NOT scale with echo doublers.
  | 'friendlyDeath'
  // Mech/neutral set: `rally` counts player Rally (on-attack) TRIGGERS incl. doubler re-fires (like `shout`);
  // `playAttachment` counts Magnetic ("Attachment") minions you play.
  | 'rally' | 'playAttachment'
  // Demon set: `consumeFodder` counts Fodder Consumed; `consumeStats` counts the total stats (Attack+Health) of
  // Consumed Fodder; `summonImp` counts Imps summoned (combat + recruit).
  | 'consumeFodder' | 'consumeStats' | 'summonImp'
  // Rulebreaker (neutral) set: `winRound` counts combat wins; `castSpell` counts spells cast; `authorsHand` is the
  // compound Shout+Echo+Rally objective (each must reach `count`; per-key progress in `ActiveQuest.subProgress`).
  | 'winRound' | 'castSpell' | 'authorsHand'
  // Compound (Fried Circuits / Forsaken Will): a general multi-part objective — `QuestObjective.parts` holds the
  // sub-objectives (each its own event + count), and the quest completes when ALL parts fill.
  | 'compound';
/** A quest objective: reach `count` of `event`. `tribe` narrows a tribe-aware objective (e.g. "Summon 4 Undead",
 *  "Give Dragons 80 stats"). `filter: 'shout'` narrows a `buy` to Battlecry minions ("Buy 3 Shout minions").
 *  `event: 'compound'` uses `parts` (each a normal objective) — all parts must fill. Live progress lives on the
 *  run's `ActiveQuest` (`partProgress` for compound). */
export interface QuestObjective {
  event: QuestObjectiveEvent;
  count: number;
  tribe?: Tribe;
  filter?: 'shout';
  /** Compound objective only: the sub-objectives (each its own event + count). All must fill to complete. */
  parts?: { event: QuestObjectiveEvent; count: number; tribe?: Tribe }[];
}
/**
 * What a completed quest grants — a discriminated union; the reward palette grows as content lands:
 *  - `buffBoard`   — a flat +atk/+hp to the whole board.
 *  - `grant`       — conjure cards to hand: `randomCount` random minions of `randomTribe`, plus every id in
 *                    `cards` (e.g. a Gold Pouch). `repeatInTurns` re-applies the WHOLE reward once, that many
 *                    recruit-turns later (Trail Rations' "repeat in 2 turns").
 *  - `shoutDouble` — your next `count` Shouts (Battlecry minions you play) each trigger twice (Warm Embers).
 */
export type QuestReward =
  | { kind: 'buffBoard'; attack: number; health: number }
  // `randomFilter` conjures a random buyable MINION matching a keyword/effect class (a Shout=Battlecry, an
  // End-of-Turn, an Echo=Deathrattle, a Rally, or an Attachment=Magnetic) — ≤ current tier, or EXACTLY current
  // tier when `randomFilterExactTier` (fallback ≤ tier if none). Powers the Mech/neutral "get a random X minion".
  // `randomTier` grants `randomCount` random minions of EXACTLY that Tier (any of your tribes / neutral) — Rune of
  // the Pair ("2 random Tier 4 minions").
  // `grantGolden` conjures each id as a GILDED (golden) copy — Rune of Stormcalling's "Gilded Karwind", Frontline
  // Glory's "Gilded Yazzus".
  | { kind: 'grant'; randomTribe?: Tribe; randomCount?: number; randomSpell?: number; randomFilter?: 'shout' | 'endOfTurn' | 'echo' | 'rally' | 'attachment'; randomFilterCount?: number; randomFilterExactTier?: boolean; randomTier?: number; cards?: string[]; grantGolden?: string[]; grantKeywords?: Keyword[]; repeatInTurns?: number }
  | { kind: 'shoutDouble'; count: number }
  // A persistent "your <tribe> have +A/+H wherever they are" run aura (Den Marker) — folds into the tribe's
  // buy-time aura channel so current AND future minions of the tribe carry it (like Squirl Scout's board buff).
  | { kind: 'tribeAura'; tribe: Tribe; attack: number; health: number }
  // As `tribeAura`, but the aura GROWS: +stepAttack/+stepHealth each time `per` of `event` accrues over the run
  // (Pack Mentality: +3/+1, improve every 5 Beasts summoned in combat). Growth is tallied in settleCombat.
  | { kind: 'scalingTribeAura'; tribe: Tribe; attack: number; health: number; per: number; event: QuestObjectiveEvent; stepAttack: number; stepHealth: number }
  // Conjure `cards` to hand at the END OF EACH TURN, for the rest of the run (Feed the Alpha's recurring spell).
  | { kind: 'recurringGrant'; cards: string[] }
  // Imp Census: permanently improve your Imps by +A/+H run-wide (bumps `impBuff`, so every current + future
  // friendly Imp inherits it). Repeats via the reward's `repeatInTurns` (folded through `multi`).
  | { kind: 'impAura'; attack: number; health: number }
  // Den Marker: a run-wide Den-Mother-style aura — every Beast you play/summon gains +attack/+health, and that
  // magnitude improves by +step/+step every `per` Beasts. Armed as `RunState.denMarker`, applied in the onSummon path.
  | { kind: 'beastPlayBuff'; attack: number; health: number; step: number; per: number }
  // Arm a run-wide combat modifier consumed by `simulate()` (see QuestCombatMods): Blood Trail, Echoing Coop,
  // Law of Teeth, The Old Hunt. `amount` parameterizes the flag where it needs a magnitude (Old Hunt's aura step).
  | { kind: 'combatFlag'; flag: QuestCombatFlag; amount?: number }
  // Dragon Shout rewards: `always` grants a permanent extra Battlecry trigger (Hoardwake / The Hoard Wakes,
  // stacks like Drakko); `firstEachRound` makes the FIRST Shout you play each turn trigger twice (Warm Embers).
  | { kind: 'shoutRepeat'; scope: 'always' | 'firstEachRound' }
  // Parliament of Flame: your End-of-Turn effects trigger an extra time (permanent, stacks like Chronos).
  | { kind: 'endOfTurnRepeat' }
  // A run-wide recurring End-of-Turn EFFECT granted by a quest: re-fire your leftmost Shout (Echoing Roar), or
  // conjure a random Shout minion to hand (The Hoard Wakes). Applied every End of Turn for the rest of the run.
  // `runeSpending` (Rune of Spending): End of Turn — +1 max Gold, and buff your leftmost minion +N/+N where N =
  // the Gold you spent this turn.
  // `runeAction` (Rune of Action): End of Turn — give your leftmost minion +1/+1 for every card you played this turn.
  // `triggerLeftmostEcho` (Rune of the Reliquary): End of Turn — fire your leftmost minion's Echo (Deathrattle).
  // `weldMoneyBotsEdgeMechs` (Rune of Banking): End of Turn — weld a Money Bot onto your leftmost + rightmost Mech.
  // `buffMechsPerAttachment` (Blueprint Cache): End of Turn — give each friendly Mech +2/+2 for every Attachment
  // (Magnetic minion) welded onto it.
  // `undeadPlayedAtk` (Forsaken Speed): End of Turn — your Undead gain +3 Attack for each card you played this turn.
  // `attachClingDrones` (Clinging On): End of Turn — weld a Cling Drone onto up to 3 random friendly Mechs.
  | { kind: 'recurringEndOfTurn'; effect: 'triggerLeftmostShout' | 'grantRandomShout' | 'grantRandomAttachments' | 'buffMechsPerAttachment' | 'runeSpending' | 'runeAction' | 'triggerLeftmostEcho' | 'weldMoneyBotsEdgeMechs' | 'undeadPlayedAtk' | 'attachClingDrones' | 'recastFirstSpell' }
  // ── Runeforge runes (Runesmith) — purchased in the turn-6 Runeforge; no objective, effect for the run. ──
  // Rune of Spellslinging: every `per` Gold you spend, get a random spell.
  | { kind: 'runeSpellDrip'; per: number }
  // Rune of Structure: each Attachment (Magnetic) you PLAY from hand also gives you a random spell.
  | { kind: 'runeStructure' }
  // Rune of Consumption: every Fodder you Consume permanently bumps your run-wide Fodder aura +attack/+health.
  | { kind: 'runeConsume'; attack: number; health: number }
  // Rune of Pillaging half: your Gold Pouches are worth `value` Gold for the rest of the run.
  | { kind: 'goldPouchValue'; value: number }
  // Rune of Summoning: each spell you cast permanently improves your Imps +1/+1 wherever they are.
  | { kind: 'runeSummoning' }
  // Rune of Kindling: each spell you cast gives your leftmost minion +3/+3.
  | { kind: 'runeKindling' }
  // Rune of Scales: each spell you cast gives your Dragons +1/+1 (board + hand).
  | { kind: 'runeScales' }
  // Rune of Bartering: your Shout (Battlecry) minions sell for 2 Gold.
  | { kind: 'runeBartering' }
  // Rune of Twin Gilding: you only need 2 copies of a card to Gild (triple) it.
  | { kind: 'runeTwinGilding' }
  // Rune of the Den Mother: your Den Mother also buffs herself when she buffs another Beast.
  | { kind: 'runeDenMother' }
  // Rune of Scale (Epic): every time you spend Gold, give `count` random board minions +attack/+health.
  | { kind: 'runeScale'; count: number; attack: number; health: number }
  // Rune of Copies (Epic): copy a random board minion to your hand now, and again at the start of every turn.
  | { kind: 'runeCopies' }
  // Rune of Tempering: the first Attachment you play each turn also gives that minion Ward.
  | { kind: 'runeTempering' }
  // Rune of Replication (Epic): the first Attachment you play each turn also welds a copy onto your leftmost Mech.
  | { kind: 'runeReplication' }
  // Rune of Refrain: after your third Shout minion each turn, the first Shout you played returns to your hand.
  | { kind: 'runeRefrain' }
  // Rune of Transfusion (Epic): whenever a Demon Consumes Fodder, your leftmost minion also gains its stats.
  | { kind: 'runeTransfusion' }
  // Rune of Endless Appetite (Epic): the first Fodder Consume each turn — all your other Demons Consume a copy.
  | { kind: 'runeEndlessAppetite' }
  // Rune of the Conductor (Epic): at the start of every shop, trigger all your End of Turn effects.
  | { kind: 'runeConductor' }
  /** Rune of the Summit: every 2nd shop opens a Tier 7 Discover (a counter, not a per-turn flag — the
   *  every-other-turn cadence is not expressible with `recurringEndOfTurn`, which fires every turn). */
  | { kind: 'runeSummit' }
  // Rune of Mastery (Epic): whenever one of your effects Improves, it improves an additional time.
  | { kind: 'runeMastery' }
  // Rune of Empowerment (Epic): your hero power's effect triggers twice (only offered to heroes whose power
  // benefits — see the sim's DOUBLEABLE_POWERS gate).
  | { kind: 'runeEmpowerment' }
  // Open the EPIC Runeforge — a quest reward that presents the Epic runeset (a random few of `EPIC_RUNES`) to
  // buy ONE, exactly like the Runesmith's forge but reachable by any hero via a quest.
  | { kind: 'openEpicRuneforge' }
  // Schedule a Runeforge visit at the start of a future turn (any hero). `forge` picks the runeset; `onWave` opens
  // it on that absolute wave (Rune of the Epic Forge → turn 9), else it opens NEXT turn (The Runeforge quest);
  // `gold` is granted that turn. Buying/skipping this forge never spends a hero-power charge.
  | { kind: 'scheduleRuneforge'; forge: 'basic' | 'epic'; onWave?: number; gold?: number }
  // Undead: `gainGold` grants Gold immediately on completion (Bone Ledger's "Get 10 Gold").
  | { kind: 'gainGold'; amount: number; immediate?: boolean }
  // Undead Echo rewards: `always` grants a permanent extra Echo (Deathrattle) trigger (Funeral Engine, stacks
  // like Sylus); `firstEachCombat` makes the FIRST Echo you trigger each combat fire one extra time (Grave
  // Contract / Last Rites, additive with itself + Funeral Engine + Sylus on that first Echo).
  | { kind: 'echoRepeat'; scope: 'always' | 'firstEachCombat' }
  // The Bone Throne: every `every` friendly deaths in combat, trigger your leftmost Echo (permanent).
  | { kind: 'boneThrone'; every: number }
  // Mech/neutral Rally rewards: `always` = a permanent extra Rally trigger (Infinite Assembly, stacks like
  // Law of Teeth); `firstEachCombat` = the FIRST Rally you trigger each combat fires an extra time (Spark
  // Permit / Overclocked Core, additive with itself + `always`).
  | { kind: 'rallyRepeat'; scope: 'always' | 'firstEachCombat' }
  // Demon (Small Offering): add `fodder` Fodder to your next shop AND give your Fodder a persistent +atk/+hp.
  | { kind: 'fodderReward'; fodder?: number; attack?: number; health?: number }
  // Rulebreaker (neutral) rewards. `gainMaxGold` raises max Gold. `discover` opens a minion Discover at your tier.
  // `dupeFirstBuy` = the first minion you buy each turn is duplicated to hand. `spellRepeat` = your spells cast
  // twice (`always` = Ancient Runes; `firstEachTurn` = Spell Thesis). `minionCost` overrides shop minion cost.
  // `slaughterRepeat` = your first Slaughter each combat fires an extra time (Author's Hand).
  | { kind: 'gainMaxGold'; amount: number }
  // `discover` opens a minion Discover — at your current tavern tier, or at `tier` when given (Rune of the Scout →
  // Tier 5, Rune of the Champion → Tier 6).
  | { kind: 'discover'; tier?: number }
  // Rune of the Second Path: Discover one of the minions that Greater Quests grant as rewards (a fixed pool).
  | { kind: 'discoverGreaterQuest' }
  | { kind: 'dupeFirstBuy' }
  | { kind: 'spellRepeat'; scope: 'always' | 'firstEachTurn' }
  | { kind: 'minionCost'; cost: number }
  | { kind: 'slaughterRepeat'; scope: 'firstEachCombat' }
  // Twin Sun Oath (Dragon capstone): every Shout you TRIGGER buffs your leftmost + rightmost board minion +atk/+hp.
  | { kind: 'shoutEdgeBuff'; attack: number; health: number }
  // Food for Gold (Demon greater): every `per` Gold spent adds a Fodder to your next shop AND bumps the run-wide
  // Fodder aura by +attack/+health.
  | { kind: 'goldFodder'; per: number; attack: number; health: number }
  // Attachment Issues (Mech capstone): every shop is guaranteed a Magnetic ("Attachment") offer, and every
  // Attachment in the shop costs `cost` Gold — for the rest of the run.
  | { kind: 'attachmentDeal'; cost: number }
  // Fried Circuits (Mech capstone): each minion you buy buffs every Mech OFFER in the shop, escalating by `step`
  // per purchase (buy 1 → +step, buy 2 → +2·step, …).
  | { kind: 'friedCircuits'; stepAttack: number; stepHealth: number }
  // Forsaken Will (Undead greater): each spell you cast permanently grants your Undead aura +`attack` Attack
  // (applies in the shop AND combat, like Lantern of Souls).
  | { kind: 'undeadSpellAura'; attack: number }
  // Bane's Existence: after this, your Banes' after-Battlecry buff also gives all your Demons +A/+H run-wide.
  | { kind: 'baneDemonAura'; attack: number; health: number }
  // A quest that grants SEVERAL of the above at once (The Hoard Wakes = shoutRepeat + recurringEndOfTurn).
  | { kind: 'multi'; rewards: QuestReward[] };
export type QuestRewardKind = QuestReward['kind'];
/** A run-wide combat modifier a completed quest arms; `simulate()` reads them via `QuestCombatMods`. */
export type QuestCombatFlag = 'bloodTrail' | 'echoingCoop' | 'lawOfTeeth' | 'oldHunt' | 'sharedCircuit'
  | 'deepHunger' | 'contractRewrite' | 'pitWithoutEnd' | 'doubleLeftmostAttack' | 'feedingLine' | 'umbralEnergy' | 'emptyGraves' | 'assemblyLine' | 'crateringMissive' | 'passingSpears'
  // Runes (Runesmith): runeWarding = Start of Combat give your leftmost minion Ward; runeFury = your Avenges
  // trigger twice; runeSlaying = every Slaughter this combat banks +2 Gold for next turn (read at settle).
  | 'runeWarding' | 'runeFury' | 'runeSlaying'
  // Rune of Forthcoming: you always attack first in combat.
  | 'runeForthcoming'
  // Rune of Rallying: at Start of Combat, trigger each of your minions' Rally (on-attack) effects once.
  | 'runeRallying'
  // Epic combat runes (run-wide, no minion source): Rising Graves = Start of Combat give 2 Undead Rise;
  // Broodpit = Avenge 6 summon 2 Taunt Imps; Spearline = Avenge 4 summon a Spear Warden that attacks now;
  // Appraisal = Avenge 4 improve your spells +1/+1.
  | 'runeRisingGraves' | 'runeBroodpit' | 'runeSpearline' | 'runeAppraisal'
  // Rune of Soul Taxes: every 4 friendly deaths, gain +1 max Gold (carried back).
  | 'runeSoulTaxes'
  // First Claws (SoC: leftmost+rightmost Beasts attack now); Packcraft (on combat summon → Beasts +1 Atk);
  // Inheritance (leftmost dies → rightmost gains its stats); Salvage (friendly Mech loses Ward → Attachment to hand).
  | 'runeFirstClaws' | 'runePackcraft' | 'runeInheritance' | 'runeSalvage'
  // Rune of Twilight: your Start-of-Combat effects trigger an ADDITIONAL time each fight (the "End of Turn" echo —
  // SoC effects run in the combat context, so they re-fire here rather than during the recruit End of Turn).
  | 'runeTwilight'
  // Rune of the Warden: at Start of Combat, if your board has room, summon a Spear Warden.
  | 'runeWarden'
  // Batch 7 combat runes: Rebirth (Rise with full Health), Aftershocks (Echo summons +4/+4), Undertow (Echo
  // summons attack immediately), Mirror March (SoC: summon a copy of your leftmost when there's room), Trophy
  // (first Slaughter each combat → a plain copy of the slaughtering minion lands in hand next shop).
  | 'runeRebirth' | 'runeAftershocks' | 'runeUndertow' | 'runeMirrorMarch' | 'runeTrophy';
/** Quest-armed combat modifiers threaded into `simulate()` (one trailing options arg). Beast quest capstones +
 *  greaters live here so the pure combat engine can honor them without new positional params per flag. */
export interface QuestCombatMods {
  /** Pack Mentality's Health half of the Beast aura — the `beastBuyHp` sibling of `beastBuyAtk`, re-added to
   *  from-base Beast bodies (summons / Reborn) so "+/+H wherever they are" catches combat summons. */
  beastAuraHp?: number;
  /** Pack Mentality's LIVE growth: every `per` Beasts summoned in combat, the run-wide Beast aura grows by
   *  `stepAttack`/`stepHealth` — applied immediately to every living Beast this fight and carried back via
   *  `playerBeastBuyAtkGain` / `playerBeastBuyHpGain` (+ leftover `progress` via `playerBeastScaleProgress`).
   *  Player-side only (a served enemy has no run to grow); absent when no such quest is armed. */
  beastSummonScale?: { per: number; stepAttack: number; stepHealth: number; progress: number };
  /** Blood Trail: at Start of Combat your leftmost minion gains "Slaughter: get a random Beast" for this fight. */
  bloodTrail?: boolean;
  /** Echoing Coop: at Start of Combat, trigger every one of your minions' Echoes (Deathrattles) once. */
  echoingCoop?: boolean;
  /** Law of Teeth: your Beasts' Slaughters (on-kill) AND Rallies (on-attack) each trigger one extra time. */
  lawOfTeeth?: boolean;
  /** The Old Hunt: >0 arms it — every Beast attack pumps your run-wide Beast Attack aura by this much
   *  (live this fight + carried back via `playerBeastBuyAtkGain`). */
  oldHuntStep?: number;
  /** Funeral Engine: every one of your Echoes (Deathrattles) triggers this many extra times (stacks with
   *  Sylus + The Bone Throne's leftmost trigger — all additive). */
  echoExtraAlways?: number;
  /** Grave Contract / Last Rites: the FIRST Echo you trigger each combat fires this many extra times (on top of
   *  `echoExtraAlways` + Sylus for that first Echo). Additive across both quests. */
  echoFirstEachCombat?: number;
  /** The Bone Throne: >0 arms it — every this-many friendly deaths in combat, trigger your leftmost Echo. */
  boneThroneStep?: number;
  /** Assembly Line: >0 arms it — every this-many friendly deaths in combat, add a Money Bot to your hand
   *  (Avenge N). Player-only (`grantToHand` no-ops for a served enemy). */
  assemblyLineStep?: number;
  /** Infinite Assembly: every Rally (on-attack) trigger fires this many extra times (stacks with Law of Teeth +
   *  Rallying Offensive + Spark Permit — all additive). */
  rallyExtraAlways?: number;
  /** Spark Permit / Overclocked Core: the FIRST Rally you trigger each combat fires this many extra times (on
   *  top of `rallyExtraAlways` for that first Rally). Additive across both quests. */
  rallyFirstEachCombat?: number;
  /** Shared Circuit: >0 arms it — at Start of Combat, give this many friendly Mechs a Divine Shield (Ward). */
  sharedCircuitWard?: number;
  /** Deep Hunger: at Start of Combat your leftmost Demon gains "Slaughter: add 3 Fodder to your next shop". */
  deepHunger?: boolean;
  /** Contract Rewrite: at Start of Combat your rightmost Demon gains "Echo: summon 2 Imps with Ward". */
  contractRewrite?: boolean;
  /** Pit Without End: >0 arms it — the friendly death that empties your board summons this many Imps (once). */
  pitWithoutEndImps?: number;
  /** Rulebreaker's Crown: at Start of Combat your leftmost minion gains +Attack equal to its Attack (doubles it). */
  doubleLeftmostAttack?: boolean;
  /** Atrius's Possession (hero): at Start of Combat the leftmost living minion gains the rightmost's Attack, and
   *  the rightmost gains the leftmost's Health (simultaneous — both read pre-buff values; 1-minion boards no-op).
   *  Rides the quest-mods channel so a served Atrius board replays it. */
  possession?: boolean;
  /** Author's Hand: your FIRST Slaughter (on-kill) each combat fires this many extra times (additive with Law of
   *  Teeth). */
  slaughterFirstEachCombat?: number;
  /** Feeding Line (Beast capstone): whenever a Beast Slaughters (fells an enemy by attacking), your NEXT living
   *  Beast (in board order, after the killer) immediately takes an out-of-turn attack. Can chain (a granted
   *  attack that slaughters grants another), bounded by the immediate-attack guard. */
  feedingLine?: boolean;
  /** Umbral Energy (Dragon greater): at Start of Combat, give your Dragons +2/+2 for every spell cast this game
   *  (read from the run's `spellsCast`). */
  umbralEnergy?: boolean;
  /** Cratering Missive (Undead capstone): your Cratering Hulks' overflow Engrave buffs ALL your minions, not just
   *  your Undead — the sim reads this to drop the tribe filter on `onSummonOverflowBuffTribe`. */
  crateringMissive?: boolean;
  /** Passing Spears (Undead capstone): your Spear Wardens gain "Echo: when this dies, give its stats to a friendly
   *  minion" — the sim watches Spear Warden deaths and transfers their stats to your strongest other minion. */
  passingSpears?: boolean;
  /** Empty Graves (Undead capstone): the FIRST friendly death each combat summons a 1/1 Gravebody (which copies
   *  your leftmost Echo on summon). Once per fight. */
  emptyGraves?: boolean;
  /** Rune of Warding: at Start of Combat, give your leftmost living minion a Ward (Divine Shield). */
  runeWarding?: boolean;
  /** Rune of Fury: every Avenge you trigger fires one extra time (its effect runs twice). */
  runeFury?: boolean;
  /** Rune of Rallying: at Start of Combat, trigger each of your minions' Rally (on-attack) effects once. */
  runeRallying?: boolean;
  /** Rune of Rising Graves: at Start of Combat, give two friendly Undead Rise (Reborn). */
  runeRisingGraves?: boolean;
  /** Rune of the Broodpit: every 6 friendly deaths, summon 2 Imps with Taunt. */
  runeBroodpit?: boolean;
  /** Rune of the Spearline: every 4 friendly deaths, summon a Spear Warden that attacks immediately. */
  runeSpearline?: boolean;
  /** Rune of Appraisal: every 4 friendly deaths, improve your spells +1/+1 (carried back as spell power). */
  runeAppraisal?: boolean;
  /** Rune of Soul Taxes: every 4 friendly deaths, gain +1 max Gold (carried back). */
  runeSoulTaxes?: boolean;
  /** Rune of First Claws: at Start of Combat, your leftmost + rightmost Beasts attack immediately. */
  runeFirstClaws?: boolean;
  /** Rune of Packcraft: whenever you summon a minion in combat, your Beasts gain +1 Attack (aura, carried back). */
  runePackcraft?: boolean;
  /** Rune of Inheritance: when your leftmost minion dies, your rightmost living minion gains its stats. */
  runeInheritance?: boolean;
  /** Rune of Salvage: whenever a friendly Mech loses its Ward, a random Attachment lands in your hand next shop. */
  runeSalvage?: boolean;
  /** Rune of Twilight: your Start-of-Combat effects trigger an additional time each fight. */
  runeTwilight?: boolean;
  /** Rune of the Warden: at Start of Combat, if your board has room, summon a Spear Warden. */
  runeWarden?: boolean;
  /** Rune of Rebirth: your minions Rise (Reborn) with FULL Health instead of 1. */
  runeRebirth?: boolean;
  /** Rune of Aftershocks: minions summoned by your Echoes (Deathrattles) gain +4/+4. */
  runeAftershocks?: boolean;
  /** Rune of the Undertow: minions summoned by your Echoes (Deathrattles) attack immediately. */
  runeUndertow?: boolean;
  /** Rune of the Mirror March: at Start of Combat, if your board has room, summon a copy of your leftmost
   *  minion (current combat stats). */
  runeMirrorMarch?: boolean;
  /** Rune of the Trophy: the first friendly Slaughter each combat records the slaughtering minion — a plain
   *  copy is conjured to hand next shop (carried back via `playerSlaughterCopy`). */
  runeTrophy?: boolean;
  /** Rune of Mastery (Epic): every "Improve" step this side's effects take applies twice (read via
   *  `CombatContext.improveRepsFor`; the recruit engine mirrors it off `RunState.runeMastery`). */
  runeMastery?: boolean;
}
/** Immutable quest definition (data, never mutated). Offered in the quest shop on waves 4/8/12, "bought" for
 *  0 Gold; its objective ticks during play and, when met, applies its reward. `tribe: 'neutral'` is the
 *  build-agnostic slot offered every quest-turn. Objective/reward display text is DERIVED from this data. */
export interface QuestDef {
  id: string;
  name: string;
  tribe: Tribe; // 'neutral' = the always-offered, build-agnostic slot
  tier: QuestTier;
  objective: QuestObjective;
  reward: QuestReward;
  /** Which quest turn this quest is offered on (owner's two-bucket table). Absent = derived from `tier`
   *  (Capstone → turn 11, else → turn 5); set explicitly only when a quest's bucket differs from that default
   *  (e.g. a Greater quest promoted into the turn-11 bucket). `questBucketFor` in @game/sim reads it. */
  wave?: 5 | 11;
  /** Undead (Ossuary Rite): a repeatable quest re-arms on completion (progress resets, reward can fire again)
   *  instead of staying done. */
  repeatable?: boolean;
}

/** Immutable Rune definition (data). Runes are sold in the Runesmith's turn-6 Runeforge — a random 5 are
 *  offered, you buy ONE for its `cost` in Gold, and its `reward` applies for the rest of the run (no objective,
 *  it just takes effect). Reuses the quest `QuestReward` application engine. */
export interface RuneDef {
  id: string;
  name: string;
  /** Gold to buy it in the Runeforge. */
  cost: number;
  /** Effect text (markdown) shown on the rune card + its run-buff badge. */
  text: string;
  reward: QuestReward;
  /** Part of the Epic Runeforge set (higher-power, quest-reached). Drives the forge's Epic styling/label. */
  epic?: boolean;
  /** Only offer this rune to heroes whose power gets value from a double trigger (the sim's DOUBLEABLE_POWERS
   *  set). Rune of Empowerment uses this so it never appears for a targeted/passive-power hero. */
  requiresDoublePower?: boolean;
}

/** One source's per-instance stat-buff contribution, surfaced in the inspect-panel breakdown
 *  ("Spirit Fire ×2: +6/+6"). Structurally mirrors `@game/sim`'s recruit-phase `CardBuff` so the
 *  run board's breakdown can ride into combat (carried through the snapshot to the combat inspect),
 *  and so the UI can merge in the buffs a minion gains mid-fight under the same shape. `count` = how
 *  many times that source buffed this minion. */
export interface MinionBuff {
  source: string;
  attack: number;
  health: number;
  count: number;
}

/**
 * A board minion as it enters combat — a card id plus its *current* stats
 * (after recruit-phase buffs have been baked in by `@game/sim`). For M0 the
 * harness constructs these directly.
 */
export interface BoardMinion {
  cardId: string;
  attack: number;
  health: number;
  /** Overrides the card's keywords if present (e.g. a granted Poison). */
  keywords?: Keyword[];
  golden?: boolean;
  /** Anomaly Reactor: extra instance tribes (a spell-added Mech type), folded into the combat minion's `tribe2`
   *  at `instantiate` when its `tribe2` slot is free. */
  addedTribes?: Tribe[];
  /** Better Bot: accrued Rally-Mech Attack this minion grants on attack (its own base + every Better Bot
   *  magnetized onto it). Combat reads it to buff other Mechs when this attacks. */
  rallyMechAtk?: number;
  /** Perfect Core: accrued "Rally: get a random spell" welded onto this minion. Combat reads it to grant
   *  this-many random spells when this attacks (standalone Perfect Core uses its own effect instead). */
  rallySpellWeld?: number;
  /** Gravetwin: the Deathrattle (onDeath EffectDefs) it copied from a friendly Echo minion — carried into combat
   *  as real Deathrattle effects so it procs when Gravetwin dies mid-fight (not only at the next shop). */
  copiedEcho?: EffectDef[];
  /** Anomaly Reactor's "All" mode: this minion counts as every tribe (mirrors the CardDef `universalTribe`, but
   *  per-instance). Combat tribe checks OR it in. */
  universalTribe?: boolean;
  /** Bloodbinder: which stat its Rally gives Fodder this fight — `'hp'` on even turns, else Attack. Alternates
   *  each turn on the run board; read (not changed) in combat. */
  bloodbinderMode?: 'atk' | 'hp';
  /** Bloodlust: at Start of Combat this minion takes an immediate out-of-turn attack, immune to retaliation for
   *  that swing ("cannot die from that attack"). Spell-applied in recruit; consumed by this one combat. */
  bloodlust?: boolean;
  /** Bloodlust weld: the Bloodlust spell also grants its target a Rally — on each of its own attacks, give a
   *  random friendly minion Attack equal to this minion's Attack. One-fight, like `bloodlust` (stripped at settle). */
  bloodlustRally?: boolean;
  /** Extra magnitude added to this minion's summon-buff effect (Kennelmaster's Avenge
   *  improvements, persisted across the run). Default 0. */
  summonBonus?: number;
  /** Ritualist: accrued End-of-Turn Fodder/Imp grant (climbs by `step` each trigger) — carried into combat so the
   *  live card text shows its current per-tick value there too. */
  eotBonus?: number;
  /** Trail Forager: accrued sell-value bonus (+1 per Beast played) — carried into combat purely so its card text
   *  reads its current sell value there too (no combat effect). */
  sellBonus?: number;
  /** Cadence/escalating End-of-Turn counter (Frontdrake, Money Maker, Vineweaver) — carried into combat so the
   *  live text shows the same "next in N turns" / cast-count read-out on mouseover. */
  eotTick?: number;
  /** Flowing Monk: flat +X/+X on top of the stepped overflow grant — created by the TRIPLE combine (the
   *  golden starts at the SUM of the two highest copies' current grants). Static during combat. */
  overflowBonus?: number;
  /** Sergeant: accrued Deathrattle HP-grant bonus, seeded from the run board so combat continues from the
   *  shop-accumulated value (raised every time Sergeant gains Attack). Default 0. */
  hpGrantBonus?: number;
  /** Tara: accrued stat-grant count toward ascension, seeded from the run board so the live in-combat
   *  "N to ascend" tracker reflects the TOTAL (prior combats + this one), not just this fight. Default 0. */
  ascendProgress?: number;
  /** Guel: spells cast while this card has been on the run board — seeds the live combat card text
   *  (his per-instance improvement). Display-only in combat; no combat behavior reads it. */
  spellProgress?: number;
  /** The originating recruit board card's uid, so combat can report per-instance state
   *  (e.g. Avenge improvements) back for the run to persist. */
  sourceUid?: string;
  /** The Reclaimer's mark: at the start of combat this minion is destroyed (Deathrattle fires) and
   *  an exact copy is resummoned if there's room. */
  resummon?: boolean;
  /** Per-source recruit-phase buff breakdown carried from the run board, so the combat inspect panel can
   *  itemize where this minion's stats came from (Spirit Fire, triples, Battlecries…) — same as the shop. */
  buffs?: MinionBuff[];
  /** DISPLAY-ONLY: the minion's LIVE, end-of-run rule text (scaling values folded in — Sergeant's climbing
   *  grant, Guel, Taragosa, …), baked in when the *final* board is captured for the leaderboard / Career so
   *  those static views read the end-of-run magnitude, not the printed base. Absent on pool/combat snapshots
   *  (they fall back to the printed card text). Combat + matchmaking never read this. */
  text?: string;
  /** DISPLAY-ONLY: the golden variant of `text`, baked alongside it (see `text`). */
  goldenText?: string;
}

/** A live combat instance. Mutable for the duration of one `simulate()` call. */
export interface Minion {
  uid: string;
  cardId: string;
  name: string;
  tribe: Tribe;
  /** Optional second tribe (dual-type, e.g. Heckbinder = Demon/Mech) — counts for tribe buffs too. */
  tribe2?: Tribe;
  attack: number;
  health: number;
  maxHealth: number;
  keywords: Keyword[];
  divineShield: boolean;
  rebornAvailable: boolean;
  /** Tripled minion — combat-time effects fire at doubled magnitude. */
  golden: boolean;
  /** Derived combat capability (Gnasher): attacks again after a kill. */
  reAttackOnKill: boolean;
  /** Commander Impala: Critical Strike — per-swing chance (0–1) to deal double damage. From the CardDef. */
  critChance?: number;
  /** Extra magnitude on this minion's summon-buff (Kennelmaster), grown by Avenge in
   *  combat and carried back to the run board afterwards. */
  summonBonus: number;
  /** Ritualist: accrued End-of-Turn grant seeded from the run board — read (not changed) in combat for live text. */
  eotBonus?: number;
  /** Trail Forager sell bonus / cadence End-of-Turn counter — seeded from the run board, read (not changed) in
   *  combat, purely for the live card text. */
  sellBonus?: number;
  eotTick?: number;
  /** Bounty Bot: swings of "immune while attacking" remaining this combat (>0 → this minion takes no
   *  retaliation on its own attack, then spends one charge). Seeded fresh each combat from CardDef.attackImmuneTurns. */
  attackImmuneLeft?: number;
  /** Flowing Monk: flat grant bonus from the triple combine (see BoardMinion.overflowBonus). Static. */
  overflowBonus?: number;
  /** Guel: spells-cast-while-on-board (seeded from the run card) — feeds the live combat text only. */
  spellProgress?: number;
  /** The originating run board card's uid (if any), for per-instance carry-back. */
  sourceUid?: string;
  /** Better Bot: total Rally-Mech Attack granted to other Mechs when this attacks (own base + welds). */
  rallyMechAtk?: number;
  /** Perfect Core (welded): number of random spells granted when this attacks. Standalone Perfect Core
   *  grants via its own onAttack effect instead, so a host never double-counts. */
  rallySpellWeld?: number;
  /** Empty Graves: granted at Start of Combat to your left-most minion — each time it attacks (Rally) it
   *  triggers your left-most living Echo. Combat-only (never persisted to a run board card). */
  emptyGravesRally?: boolean;
  /** Bloodlust: at Start of Combat, take an immediate out-of-turn attack, immune to retaliation for that swing. */
  bloodlust?: boolean;
  /** Bloodlust weld: on each of its own attacks, give a random friendly minion Attack equal to this minion's
   *  Attack (the Rally the Bloodlust spell grants alongside the immune swing). One-fight. */
  bloodlustRally?: boolean;
  /** Bloodbinder: which stat its Rally gives Fodder this fight (`'hp'` = Health, else Attack). Seeded from the
   *  run board (alternates each turn); read by its Rally factory. */
  bloodbinderMode?: 'atk' | 'hp';
  /** Anomaly Reactor's "All" mode: counts as every tribe (per-instance mirror of the CardDef `universalTribe`). */
  universalTribe?: boolean;
  /** Permanent stats this minion gained mid-combat (Flowing Monk's overflow gift) — carried back to
   *  the run board afterwards, unlike ordinary combat-only buffs. */
  permaGain?: { attack: number; health: number };
  /** Multiplier on every combat stat-gain this minion receives (golden Taurus doubles its neighbors'
   *  combat gains). Applied at the top of `ctx.buff`; absent/1 = normal. */
  gainMult?: number;
  /** Crypt Drake: how many ally attacks this minion has seen this combat — drives its "improve every N
   *  attacks" buff. Per-combat (reset each fight); absent = 0. */
  attackSeen?: number;
  /** Gryphon: how many free refreshes it has banked this combat — it grants one per hit up to a cap
   *  (so a Taunt soaking many hits doesn't roll unlimited refreshes). Absent = 0. */
  grantedRefresh?: number;
  /** Sergeant: accumulated HP bonus on its Deathrattle (grows each time Sergeant gains Attack in
   *  combat). Applied on top of the base params.health when the Deathrattle fires. Absent = 0. */
  hpGrantBonus?: number;
  /** Tara: prior accumulated ascend grant-count seeded from the run board, so the live "N to ascend"
   *  tracker reads the TOTAL across combats rather than just this fight's grants. Absent = 0. */
  ascendProgress?: number;
  /** Brood Matron: how many Imps it has bred this combat — caps its friend-death summons. Absent = 0. */
  bredCount?: number;
  /** The Reclaimer's mark (see BoardMinion.resummon) — processed once at the start of combat. */
  resummon?: boolean;
  /** Recruit-phase buff breakdown carried from the run board (see BoardMinion.buffs) — passed into the
   *  combat snapshot so the inspect panel itemizes recruit buffs in combat. Combat-only minions (summoned
   *  tokens, Reborn bodies) have none. */
  buffs?: MinionBuff[];
  side: Side;
  effects: EffectDef[];
  dead: boolean;
}

export interface MinionSnapshot {
  uid: string;
  cardId: string;
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  /** Tripled — so the UI can render the golden treatment in combat too. */
  golden?: boolean;
  /** Current summon-buff bonus (Kennelmaster) — for the live combat card text. */
  summonBonus?: number;
  /** Ritualist: current End-of-Turn grant step (seeded) — for the live combat card text (per-tick Fodder/Imp value). */
  eotBonus?: number;
  /** Trail Forager sell bonus / cadence End-of-Turn counter (seeded) — for the live combat card text. */
  sellBonus?: number;
  eotTick?: number;
  /** Flowing Monk's flat grant bonus (triple combine) — for the live combat card text. */
  overflowBonus?: number;
  /** Current Sergeant Deathrattle HP-grant bonus (seeded value) — for the live combat card text from frame 1. */
  hpGrantBonus?: number;
  /** Tara's prior ascend progress (seeded from the run board) — so the live combat "N to ascend" tracker
   *  starts from the real total and counts up, matching the shop card. */
  ascendProgress?: number;
  /** Guel's spells-cast-while-on-board (seeded from the run board) — for the live combat card text. */
  spellProgress?: number;
  /** Per-source recruit-phase buff breakdown (see Minion.buffs) — lets the combat inspect panel itemize a
   *  minion's recruit buffs, the same breakdown the shop shows. Absent for combat-summoned tokens. */
  buffs?: MinionBuff[];
}

/**
 * The replayable combat log. The UI animates these on its own clock and never
 * recomputes outcomes. Vocabulary matches the prototype's proven set plus
 * `summon`/`buff` for combat-time effects (Deathrattles, summon buffs).
 */
/** Resolution-step tag: `simulate()` stamps every event with the id of the atomic resolution that emitted
 *  it (one attack swing's exchange, one death's rattle, one Start-of-Combat cast, …). Pure presentation
 *  metadata — it never affects outcomes — letting the UI's moment compiler know true simultaneity instead
 *  of inferring it. Optional so synthetic fixtures (tests) can omit it; real sim output always carries it. */
export type CombatEvent = (
  | { type: 'sc'; source: string; text: string; cast?: true } // `cast` = a genuine Start-of-Combat damage cast (UI plays the zap + bolt + flash); absent = mid-combat narration (spell-power gain, etc.) — log + trigger pulse only
  | { type: 'attack'; attacker: string; defender: string; swing: number; crit?: boolean }
  | { type: 'dmg'; target: string; amount: number; remainingHp: number }
  | { type: 'shield'; target: string }
  | { type: 'shieldUp'; target: string }
  | { type: 'poison'; target: string }
  | { type: 'reborn'; target: string; hp: number; attack: number; keywords: Keyword[]; after?: string } // returns at base stats; `after` = the uid the Rise re-slots to the RIGHT of (a Rise whose Deathrattle summoned tokens into its old slot)
  | { type: 'death'; target: string; side: Side; rise?: true } // `side` lets the UI count enemy kills (Cassen) without uid-matching; `rise` marks a Rise's FIRST death — shown (the body vacates its slot) but NOT counted as a kill, since it returns
  | { type: 'reveal'; target: string } // a Stealth minion attacked and lost Stealth
  | { type: 'tribeAura'; side: Side; tribe: Tribe | 'any'; attack?: number; health?: number; aura?: string } // a run-wide aura rose in combat (Ryme / Lantern / Imp King / Fodder Feeder …). UI blooms the board wash (by `tribe`) AND ticks the matching Buffs-panel row live (by `aura` key + amounts), mirroring recruit-phase `auraFxSeq`
  | { type: 'keyword'; target: string; keyword: Keyword; source?: string } // a combat effect grants a keyword (Mumi → Rise, Ryme-replayed keyword battlecries) — the UI folds it into the unit's pills
  | { type: 'keywordLost'; target: string; keyword: Keyword; source?: string } // a combat effect STRIPS a keyword (Tauntbreaker → Taunt/Rise off the enemy it hit) — the UI drops that pill
  | { type: 'venomLost'; target: string } // a Venomous minion procced and lost Venomous
  | { type: 'summon'; minion: MinionSnapshot; side: Side; index: number; source?: string }
  | { type: 'ascend'; target: string; into: string } // mid-combat transform (Tara → Taragosa, Spirit Pup → Spirit Worgen)
  | { type: 'buff'; target: string; attack: number; health: number; source: string }
  | { type: 'improve'; target: string; amount: number } // Kennelmaster's Avenge strengthens its summon aura
  | { type: 'rally'; source: string; target: string } // Deathsayer's Rally fires `target`'s Deathrattle
  | { type: 'maxGold'; target: string; side: Side; amount: number } // Soulsman's Avenge raises your max Gold
  | { type: 'toHand'; cardId: string; side: Side; source?: string } // a combat effect adds a card to your hand (Arcane Weaver)
  | { type: 'hpGrant'; target: string; amount: number } // Sergeant: live HP-grant amount after each Attack-gain improvement
  | { type: 'spellProgress'; target: string; amount: number } // Archmagus Guel: on-board spell tally after a combat cast (live countdown)
  | { type: 'questTrigger'; flag: string; side: Side } // a completed quest / owned rune's COMBAT effect fired — `flag` maps to its badge id so the UI can pulse the node
  | { type: 'questComplete'; questId: string; side: Side } // a quest completed MID-COMBAT (its objective crossed): the UI lights its node + its reward activates from this beat (see PendingCombatQuest)
) & { step?: number; avenge?: true }; // `avenge`: this event was emitted by an Avenge handler (payoff for the death count hitting a threshold). Pure presentation metadata (like `step`) — never affects outcomes — so the replay can defer Avenge beats until AFTER the death's summons have deployed.

export type CombatOutcome = 'win' | 'lose' | 'draw';

/** One side's complete run-level combat context — the SAME struct for the player and the enemy. Combat is
 *  symmetric: every scaler an effect reads per-side (auras, spell power, tribe tallies, quest/rune mods, tavern
 *  tier, active tribes) lives here, so `simulate()` takes `playerState` + `enemyState` of this one type instead
 *  of the old asymmetric split (player as ~23 positional args, enemy as an `EnemyScalers` bag). The player's is
 *  built from live `RunState`; the enemy's is reconstituted from its board snapshot (a served foe) or left at
 *  defaults (the procedural threat / a synthetic board with no run economy). Build one with `combatSide(...)`.
 *  NOTE: the boards themselves stay separate positional args to `simulate` — this struct is the run-state context
 *  that rides alongside each board, the piece that used to be asymmetric. */
export interface CombatSideState {
  /** Spells cast THIS recruit turn (Spirit Worgen / Runescale per-turn scalers). */
  spellsThisTurn: number;
  /** Lifetime spells cast this run (Umbral Energy scales Dragons +N per spell; seeds the combat spell tally). */
  spellsCast: number;
  /** Deathrattles triggered this run (Forsaken tally payoffs). */
  deathrattles: number;
  /** Run-wide spell power (Skullblade etc.) folded into this side's spell grants. */
  spellPowerAtk: number;
  spellPowerHp: number;
  /** Undead Lantern aura (Lantern of Souls / Watcher) — applies to ALL of this side's Undead in combat. */
  undeadAtk: number;
  undeadHp: number;
  /** Undead buy-time Attack slice (Deathswarmer / Forsaken Weaver / Karthus) — re-added to from-base Undead. */
  undeadBuyAtk: number;
  /** Imp Aura (Fodder Feeder / Ritualist / Bane) — sizes this side's Imp summons. */
  impAtk: number;
  impHp: number;
  /** Fodder consumed this turn (Abhorrent Horror's Start-of-Combat payoff). */
  fodderConsumedAtk: number;
  fodderConsumedHp: number;
  /** Run-wide Beast Attack aura (The Old Hunt / Pack Mentality's Attack half). */
  beastBuyAtk: number;
  /** Beasts played this recruit turn (legacy — retained for the ctx accessor + result echo). */
  beastsPlayed: number;
  /** Attachment/Magnetic aura (Scrap Herald / Banksly welds) — sizes this side's from-base Magnetics. */
  magneticAtk: number;
  magneticHp: number;
  /** Set 2 — this side's Ruby STRENGTH (the run's `rubyBonus`): the extra Attack/Health on top of a Ruby's
   *  base 1/1, so a combat-cast Ruby (Avenge / Rally / Start-of-Combat "Play a Ruby") applies the same amount
   *  the shop does. Default zero (a Ruby is 1/1). Player-authoritative today. */
  rubyBonus: { attack: number; health: number };
  /** This side's tavern tier. The player's drives token/spell generation; the enemy's drives loss-damage. */
  tier: number;
  /** This side's active tribes — the generation pool filter. */
  tribes: string[];
  /** Per-card run enchants (Fodder Aura / Eternal Knight), keyed by cardId. Player-authoritative today. */
  cardBuffs: Record<string, { attack: number; health: number }>;
  /** This side's quest/rune COMBAT modifiers (assembled `questCombatMods` output). */
  questMods: QuestCombatMods;
  /** Active, INCOMPLETE quests whose objective is a combat event (kill / summon / attack …). `simulate` tracks
   *  their live tally and, the moment one crosses its threshold MID-COMBAT, activates its reward's ongoing combat
   *  mods (merged into `questMods` so effects like Feeding Line trigger for the rest of the fight — Start-of-Combat
   *  rewards, already past, don't retro-fire) and emits a `questComplete` (+ `toHand` for a card reward) event.
   *  Player-authoritative; the actual completion + grant still settles in the reducer. Omitted when none. */
  pendingQuests?: PendingCombatQuest[];
}

/** A player quest that may complete DURING combat (its objective counts combat events). Threaded into
 *  `simulate` via `CombatSideState.pendingQuests`; see the field doc. */
export interface PendingCombatQuest {
  questId: string;
  /** The combat objective event this quest counts (attack / summonCombat / slaughter / slaughterKeyword). */
  event: QuestObjectiveEvent;
  /** Threshold to complete. */
  count: number;
  /** Tribe filter on the objective, if any (e.g. Feeding Line: kill with BEASTS). */
  tribe?: Tribe;
  /** Progress already accrued before this combat. */
  progress: number;
  /** The reward's ONGOING combat mods to fold into `questMods` on completion (Feeding Line → `{feedingLine:true}`).
   *  Only ongoing-trigger flags do anything mid-fight; Start-of-Combat / non-combat mods are harmless no-ops. */
  mods?: QuestCombatMods;
  /** A card the reward grants — flown to hand (`toHand`) on completion for the live visual. */
  rewardCardId?: string;
}

/** Combat-resolution flags that are genuinely player-only one-fight overrides (runes), not per-side run state. */
export interface CombatConfig {
  /** Rune Forthcoming / attack-first-next: the player's board strikes first this fight. */
  playerAttacksFirst?: boolean;
  /** Rallying Offensive: the player's Rally triggers fire twice this fight. */
  playerRallyDouble?: boolean;
}

export interface CombatResult {
  events: CombatEvent[];
  result: CombatOutcome;
  /** The enemy board's run-level scalers at combat start (from its snapshot) — so the UI can render an ENEMY
   *  Grim / Taragosa / Pack Leader / Runescale card at the OPPONENT's value, not the current player's. Absent
   *  for the procedural threat / when nothing scaled. Mirrors the values threaded into `simulate` as
   *  `enemyScalers` and used per-side by the combat effects. */
  enemyScalers?: { spellPower: { attack: number; health: number }; spellsThisTurn: number; beastsPlayed: number; deathrattles: number };
  /** Resolve the player loses on defeat (handoff A.3 step 9). 0 otherwise. */
  playerDamage: number;
  /** Player-side Deathrattles that fired this combat — the run loop accumulates these into the run-wide
   *  "this game" count Grim reads. */
  playerDeathrattles: number;
  /** Player-side minions that DIED this combat — a raw entity-death count (Rise re-slots don't count) feeding the
   *  Undead `friendlyDeath` quest objective. Unlike `playerDeathrattles` this does NOT scale with echo doublers.
   *  Optional for back-compat with hand-built test fixtures (missing → 0). */
  playerDeaths?: number;
  /** Player Rally (on-attack) triggers this combat, incl. doubler re-fires (Law of Teeth / Rallying Offensive /
   *  Infinite Assembly / Spark Permit) — feeds the `rally` quest objective. Optional (missing → 0). */
  playerRallies?: number;
  /** Imps the player summoned this combat (Imp King / Brood Matron / Pit Without End / Contract Rewrite) — feeds
   *  the `summonImp` objective. Optional (missing → 0). */
  playerImpsSummoned?: number;
  /** cardIds of the player minions still ALIVE at combat end — Gravetwin reads this to fire its copied Echo next
   *  shop only when it survived. Absent when nothing survived. */
  playerSurvivorCardIds?: string[];
  /** Enemy-side minions that died this combat — Cassen's Collision banks these toward "kill 5 enemy
   *  minions → get a top-type minion" (the run loop accumulates them). */
  enemyDeaths: number;
  /** Combat-phase quest tallies for this fight — fed to the active quests in settleCombat (+N, tribe-narrowed).
   *  `attack` / `summonCombat` / `slaughter` are the player-side totals; the `*ByTribe` maps break each down by
   *  the acting/summoned minion's tribe (dual-types count for both) so "with Beasts" objectives resolve. The
   *  Echo (Deathrattle) objective reuses `playerDeathrattles`. Absent when nothing tallied. */
  playerQuestTally?: {
    attack: number;
    summonCombat: number;
    slaughter: number;
    /** The Red Trail: Slaughter-KEYWORD triggers (a kill by a minion with an on-kill effect). Tribe-agnostic. */
    slaughterKeyword: number;
    attackByTribe: Partial<Record<Tribe, number>>;
    summonCombatByTribe: Partial<Record<Tribe, number>>;
    slaughterByTribe: Partial<Record<Tribe, number>>;
    /** Σ positive +Attack/+Health granted to a PLAYER minion in combat, per tribe — so the `tribeStats` quest
     *  ("Give Dragons N total stats": Skybound Pact / Taragosa's Inheritance) counts combat buffs, not just recruit. */
    statGainByTribe: Partial<Record<Tribe, number>>;
  };
  /** The Old Hunt + Pack Mentality: run-wide Beast Attack aura gained this combat (Old Hunt step × Beast
   *  attacks + Pack Mentality stepAttack × improves). Stacks into `beastBuyAtk` + applied to existing run-board
   *  Beasts in settleCombat. Absent if 0. */
  playerBeastBuyAtkGain?: number;
  /** Pack Mentality: run-wide Beast HEALTH aura gained this combat (stepHealth × improves). Stacks into
   *  `beastBuyHp` + applied to existing run-board Beasts in settleCombat. Absent if 0. */
  playerBeastBuyHpGain?: number;
  /** Pack Mentality: the leftover Beast-summon progress after this combat's live growth — written back onto the
   *  scaling aura so the countdown continues next fight (the magnitude grew live, so settle skips re-growing it). */
  playerBeastScaleProgress?: number;
  /** Step-tagged timeline of combat quest-objective ticks (one per increment) so the UI can LIVE-TICK quest
   *  progress during the replay: an entry with `step` ≤ the replay's current step is already counted. `tribes`
   *  narrows tribe-scoped objectives ("…with Beasts"); deathrattle (Echo) entries carry no tribe. */
  playerQuestEvents?: { step: number; kind: 'attack' | 'summonCombat' | 'slaughter' | 'slaughterKeyword' | 'deathrattle' | 'friendlyDeath' | 'rally' | 'summonImp'; tribes: Tribe[] }[];
  /** Starting rosters, for the UI to render before replaying the log. */
  initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] };
  /** Per-instance state to persist on the run board after combat, keyed by the board
   *  card's uid (Kennelmaster's Avenge-improved summon bonus). Only entries that changed. */
  playerSummonBonus?: { sourceUid: string; bonus: number }[];
  /** Sergeant's Deathrattle HP-grant bonus after this combat, keyed by board card uid — the seeded value
   *  plus any improvements from Attack gained in combat. Persisted to the run board so the improvement is
   *  permanent across fights (only minions whose bonus is > 0). */
  playerHpGrantBonus?: { sourceUid: string; bonus: number }[];
  /** Archmagus Guel's on-board spell tally after this combat, per board card uid — the seeded value plus this
   *  combat's spell casts (spells cast WITH him on board count too, matching the recruit half). Persisted to
   *  the run board so his per-instance improvement is permanent. */
  playerSpellProgress?: { sourceUid: string; progress: number }[];
  /** Tara's stat-grant tally this combat, per board card uid — accumulated onto `ascendProgress` and, at the
   *  threshold, transformed to its ascend form in settleCombat. */
  playerAscendCount?: { sourceUid: string; count: number }[];
  /** Permanent stats a minion keeps from this combat, keyed by the recipient's board card uid — applied
   *  to the run board after combat, win or lose. Two sources: Flowing Monk's overflow gift (`engraved:
   *  false` — a one-off gift to a non-EG carrier) and Engraved minions keeping their own combat gains
   *  (`engraved: true` — native EG like Gnasher/Flowing-Monk-recipient, or EG granted at Start of Combat
   *  by Taurus). `engraved` only drives the inspect-panel source label; the stats apply either way. */
  playerPermaBuffs?: { sourceUid: string; attack: number; health: number; engraved: boolean }[];
  /** Card ids the player's combat deathrattles grant to the hand after combat (Arcane Weaver). */
  playerHandGrants?: string[];
  /** Rune of the Trophy: the card id of the first friendly minion to Slaughter this combat — a plain copy is
   *  conjured to hand in settleCombat ("get a copy of it next Shop"). Absent when no Slaughter fired. */
  playerSlaughterCopy?: string;
  /** Permanent run-wide spell-power gain from this combat (Skullblade's Deathrattle: +Attack to your
   *  spells). Summed across all firings; applied to the run's `spellBonus` in settleCombat. Absent if 0. */
  playerSpellPower?: { attack: number; health: number };
  /** Permanent run-wide card-type buffs from this combat (Grave Knit's death: all Grave Knits +3/+2).
   *  One entry per (cardId) accrued; applied via the run loop's run-wide card-type buff in settleCombat. */
  playerCardBuffs?: { cardId: string; attack: number; health: number }[];
  /** Fodder to queue into the next tavern from this combat (Burial Imp's Deathrattle). A count of
   *  `fred` tokens; pushed onto `pendingTavern` in settleCombat. Absent if 0. */
  playerFodderGrants?: number;
  /** Fodder scheduled across the next several shops from this combat (Pit Supplier's Avenge): `[i]` = Fodder for
   *  the shop `i` from now. Merged into `fodderSchedule` in settleCombat. Absent if none. */
  playerFodderSchedule?: number[];
  /** Economy Battlecries Ryme re-fired in combat (Soulfeeder's Fodder, Hoarder's Gold, Demonic Anomaly's shop
   *  buff, gain-a-minion) — recorded here (cardId + its golden state) and replayed through the real recruit
   *  factory in settleCombat, where they have full RunState access. Combat-meaningful Battlecries (summon /
   *  buff / discover / grant-keyword / spell-power) run in combat instead and are NOT listed here. */
  playerDeferredBattlecries?: { cardId: string; golden: boolean }[];
  /** Free shop rerolls banked from this combat (Gryphon's on-damaged). Added to `freeRolls` in settleCombat. */
  playerFreeRolls?: number;
  /** Moe: number of upcoming shops that must contain a guaranteed Magnetic offer. Added to the run's counter. */
  playerGuaranteedAttachments?: number;
  /** Permanent max-Gold increase from this combat (Soulsman's Avenge). Applied to `maxEmbers` in
   *  settleCombat. Absent if 0. */
  playerMaxGoldGain?: number;
  /** Bounty Bot: one-time Gold to add to the next shop (→ bonusEmbersNextTurn in settleCombat). */
  playerBonusGold?: number;
  /** Spells the player cast IN this combat (Taragosa's Growth). Added to the run's `spellsCast` in
   *  settleCombat — so combat casts permanently improve spell-count payoffs (Archmagus Guel). Absent if 0. */
  playerSpellsCast?: number;
  /** Permanent Undead Attack bonus from this combat (Karthus on-kill). Stacks into `undeadBuyAtk` and is
   *  also applied to existing run-board Undead immediately after combat. Absent if 0. */
  playerUndeadBuyAtkGain?: number;
  /** Permanent Undead AURA gained this combat (Watcher casting Lantern of Souls: +Attack/+Health to your
   *  Undead everywhere). Added to `undeadAttackBonus`/`undeadHealthBonus` in settleCombat — the same channel a
   *  shop-cast Lantern uses. Absent if 0/0. */
  playerUndeadAuraGain?: { attack: number; health: number };
  /** Permanent Imp buff gained this combat (Imp King Deathrattle, Brood Matron Avenge) — added to
   *  RunState.impBuff so future Imps inherit it. Absent if 0/0. */
  playerImpBuffGain?: { attack: number; health: number };
  /** Permanent run-wide Fodder enchant gained this combat (Bane reacting to Ryme's battlecry replays) —
   *  applied via `buffFodderRunWide` so every Fodder (board, hand, future copies) inherits it, mirroring the
   *  recruit-phase Bane. Absent if 0/0. */
  playerFodderBuffGain?: { attack: number; health: number };
  /** Outcome odds (fractions summing to 1) — estimated by the run loop re-simulating these boards
   *  on many independent seeds. Not produced by `simulate` itself (a single fight); the run loop fills it.
   *  `avgLossDamage` is the mean Resolve lost across the losing sims (round-capped), i.e. how much damage
   *  you'd take on a typical loss of this matchup — 0 when no sim lost. */
  odds?: { win: number; draw: number; lose: number; avgLossDamage: number };
}

/**
 * The combat-time API exposed to effect factories. Factories mutate state and
 * push events only through this surface.
 */
export interface CombatContext {
  readonly rng: Rng;
  readonly bus: CombatBus;
  readonly boards: Record<Side, Minion[]>;
  readonly events: CombatEvent[];
  /** Spells cast this turn (recruit) for the PLAYER, frozen at combat start. Prefer `spellsThisTurnFor(side)`
   *  so an ENEMY Runescale Drake scales with the OPPONENT's spells (captured in its board snapshot), not yours. */
  readonly spellsThisTurn: number;
  /** Beasts the PLAYER played this turn (recruit), frozen at combat start. Prefer `beastsPlayedFor(side)` so an
   *  ENEMY Pack Leader scales with the OPPONENT's Beasts-played. */
  readonly beastsPlayedThisTurn: number;
  /** The PLAYER's live spell power ({attack, health}) — grows in place via `grantSpellPower`. Prefer
   *  `spellPowerFor(side)` for effects on either board; an ENEMY Taragosa/Watcher/Hoardbreaker must scale with
   *  the OPPONENT's captured spell power (`enemySpellPower`), not the current player's. */
  readonly spellPower: { attack: number; health: number };
  /** The enemy board's spell power at combat start ({attack, health}), from its board snapshot — static
   *  (enemies never gain spell power mid-fight). 0 for the procedural threat / legacy boards. */
  readonly enemySpellPower: { attack: number; health: number };
  /** Per-side spell power: the player's live value, or the enemy's captured value. Use this in any combat
   *  effect that casts a spell / folds spell power, keyed on the acting minion's `side`. */
  spellPowerFor(side: Side): { attack: number; health: number };
  /** Per-side Ruby strength (set 2): the extra Attack/Health a combat-cast Ruby carries on top of its base
   *  1/1 (the run's `rubyBonus`). Player-authoritative today; the enemy side is zero. */
  rubyBonusFor(side: Side): { attack: number; health: number };
  /** Per-side "spells cast this turn" — player's, or the opponent's captured value. */
  spellsThisTurnFor(side: Side): number;
  /** How many times an "Improve" step applies for `side` — 2 under Rune of Mastery, else 1. Every combat
   *  factory whose card text says **Improve** multiplies its improvement increment by this. */
  improveRepsFor(side: Side): number;
  /** Per-side "Beasts played this turn" — player's, or the opponent's captured value. */
  beastsPlayedFor(side: Side): number;
  /** Deathrattles triggered this game so far, for `side`: for the PLAYER the run-wide base + this combat's
   *  player Deathrattles; for the ENEMY the opponent's captured tally. Grim scales its buff by this. */
  deathrattleTally(side: Side): number;
  log(event: CombatEvent): void;
  living(side: Side): Minion[];
  getCard(id: string): CardDef;
  /** Every card definition the run knows about — for effects that pick a random card matching a
   *  property rather than a fixed id (Junkyard Titan → a random Magnetic minion). */
  allCards(): CardDef[];
  buff(target: Minion, attack: number, health: number, source: string): void;
  /** Register a tribe buff that persists for the rest of combat: a friend of `tribe` on `side`
   *  summoned *after* this also gains +atk/+hp (Grim's Deathrattle). Current friends are buffed by the caller. */
  addTribeAura(side: Side, tribe: Tribe | 'any', attack: number, health: number, source: string): void;
  /** Summon `card` onto `side`. `nearUid` positions it beside an existing unit.
   *  `grantKeywords` are applied to the minion BEFORE the `summon` event is emitted, so the UI
   *  sees the correct keyword set from the first frame (Broodmother → Taunt on her Whelps).
   *  `golden` summons the token GILDED — doubled base stats + the golden flag (Manasaber's golden
   *  cubs are 0/4) — for summoners whose golden form upgrades the token instead of the count. */
  summon(side: Side, card: CardDef, nearUid?: string, grantKeywords?: Keyword[], golden?: boolean, attackNow?: boolean, copyStats?: { attack: number; health: number; maxHealth: number; divineShield?: boolean; rebornAvailable?: boolean }): Minion;
  /** Graft extra combat Deathrattle (`onDeath`) effects onto a minion mid-fight, registering them so they fire on
   *  its death (Grave Body copying your leftmost Echo). The effects fire with the grafted minion as `self`. */
  grantDeathrattle(target: Minion, effects: EffectDef[]): void;
  /** Flush the attack-on-summon queue immediately (Twilight Whelp: each spawned Whelp attacks
   *  before the next one may spawn, so a full board doesn't block the second if the first dies). */
  flushImmediateAttacks?(): void;
  /** Solaris Fang: make an existing minion take an extra attack immediately, out of turn order (the same
   *  attack-on-summon queue, drained by the next flushImmediateAttacks). The minion still attacks in its
   *  normal rotation too — this is a bonus strike. */
  attackNow?(minion: Minion, shieldFirst?: boolean): void;
  /** Count a Deathrattle *triggered without a death* (Sporeling's Battlecry-proc'd rattle) toward the
   *  side's Deathrattle tally — feeds Grim + the run's deathrattlesTriggered carry-back. Player-side only. */
  countDeathrattle?(side: Side): void;
  /** Queue a card to be added to that side's hand after combat (player only is persisted). */
  grantToHand(cardId: string, side: Side, sourceUid?: string): void;
  /** Permanently raise the run-wide spell power by +atk/+hp (Skullblade's Deathrattle). Player-only;
   *  accumulated and carried back via `CombatResult.playerSpellPower`, applied in the run loop. `sourceUid`
   *  (the granting minion) telegraphs it mid-combat as an `sc` narration. */
  grantSpellPower(attack: number, health: number, side: Side, sourceUid?: string): void;
  /** Permanently buff a card type run-wide by +atk/+hp (Grave Knit's combat death). Player-only;
   *  accumulated and carried back via `CombatResult.playerCardBuffs`, applied in the run loop. */
  grantCardBuff(cardId: string, attack: number, health: number, side: Side): void;
  /** Queue `count` Fodder into the player's next tavern (Burial Imp's Deathrattle). Player-only;
   *  carried back via `CombatResult.playerFodderGrants`, pushed onto pendingTavern in settleCombat. */
  grantTavernFodder(count: number, side: Side): void;
  /** Queue Fodder across the next several shops (Pit Supplier's Avenge → "2 Fodder to your next 2 shops"):
   *  `counts[i]` = Fodder for the shop `i` from now. Player-only; carried back via `playerFodderSchedule`. */
  scheduleFodder(counts: number[], side: Side): void;
  /** Record an economy Battlecry (Ryme re-firing Soulfeeder / Hoarder / Demonic Anomaly / a gain-minion) to be
   *  replayed through its recruit factory at settle. Player-only; carried back via
   *  `CombatResult.playerDeferredBattlecries`. `golden` is the re-fired minion's golden state (so the factory
   *  doubles correctly). */
  deferBattlecry(cardId: string, golden: boolean, side: Side): void;
  /** Permanently raise the player's max Gold by `amount` (Soulsman's Avenge). Player-only; carried
   *  back via `CombatResult.playerMaxGoldGain`, applied to maxEmbers in settleCombat. */
  grantMaxGold(amount: number, side: Side): void;
  /** Bounty Bot: grant one-time Gold into the next shop; carried back via `CombatResult.playerBonusGold`. */
  grantBonusGold(amount: number, side: Side): void;
  /** Bank `count` free shop rerolls for the player from combat (Gryphon). Player-only; carried back via
   *  CombatResult.playerFreeRolls. */
  grantFreeRolls(count: number, side: Side): void;
  /** Moe: bank `count` upcoming shops that each guarantee a Magnetic offer (carried back to the run). */
  grantGuaranteedAttachments(count: number, side: Side): void;
  /** Grant `count` random tavern-tier spells to the player's hand after combat (Sporebat, and a Discover-spell
   *  Battlecry re-fired in combat by Ryme). Player-only. Picks the ACTUAL spell(s) now (the run's tavern tier
   *  is threaded into combat) and routes each through `grantToHand` — so the replay shows the real card flying
   *  (`toHand`) and settle just adds the carried cardId. `sourceUid` is the granting minion. */
  grantRandomSpell(count: number, side: Side, sourceUid?: string): void;
  /** Grant `count` random pool minions of `tribe` to the player's hand after combat — from a Discover-minion
   *  Battlecry re-fired in combat (Ryme → Sea Urchin). Player-only. Picks the actual minion(s) now from the
   *  buyable pool (≤ tavern tier, active tribes, tribe-filtered, excluding `exclude`) and routes each through
   *  `grantToHand`, so the real card animates in. `sourceUid` is the granting minion. */
  grantRandomMinion(count: number, tribe: string | undefined, side: Side, exclude?: string, sourceUid?: string): void;
  /** A minion casts a spell mid-combat (Taragosa's Growth). Tallies the cast (the running per-side count
   *  is reported in the `spellCast` event payload so Guel scales) and, for the player, carries it back via
   *  `CombatResult.playerSpellsCast` to permanently bump the run's `spellsCast`. The spell's actual effect
   *  (the buff/damage) is applied by the caller — this just fires the `spellCast` trigger + counts it. */
  castSpell(side: Side): void;
  /** Abhorrent Horror: total Fodder stats consumed this turn for a given side (attack + health) — the player's
   *  live run state, or a served enemy's captured tally. `scGainFodderStats` reads its OWN side at Start of
   *  Combat (so an enemy Horror gains the ENEMY's consumed stats, not the player's). {0,0} if none. */
  fodderConsumedFor(side: Side): { attack: number; health: number };
  /** Karthus: permanently raise run-wide Undead buy-time attack by `amount` (player only). Carried back
   *  via CombatResult.playerUndeadBuyAtkGain, stacked into undeadBuyAtk and applied to the run board. */
  grantUndeadBuyAtk(amount: number, side: Side): void;
  /** Watcher (casting Lantern of Souls): permanently raise the run-wide Undead aura by +attack/+health
   *  (player only) — the Lantern channel (`undeadAttackBonus`/`undeadHealthBonus`). Live for this fight's
   *  later summons + carried back via CombatResult.playerUndeadAuraGain. */
  grantUndeadAura(attack: number, health: number, side: Side): void;
  /** Imp King / Brood Matron Avenge: permanently raise the run-wide Imp buff by +atk/+hp (player only).
   *  Carried back via CombatResult.playerImpBuffGain → added to RunState.impBuff so future Imps inherit it. */
  grantImpBuff(attack: number, health: number, side: Side): void;
  /** The side's LIVE Imp Aura this fight (seeded from run state, advanced by in-combat Imp buffs). Chef Raag
   *  reads it to give your minions stats equal to it. */
  impAura(side: Side): { attack: number; health: number };
  /** Bane (combat, reacting to Ryme's battlecry replays): permanently enchant the Fodder card type run-wide
   *  by +atk/+hp (player only). Carried back via CombatResult.playerFodderBuffGain → `buffFodderRunWide`. */
  grantFodderBuff(attack: number, health: number, side: Side): void;
  /** Deal damage to a combat minion (used by Start-of-Combat and on-break effects). */
  damage(target: Minion, amount: number, poison?: boolean, bypassShield?: boolean): void;
  /** Bloodbinder: arm Bleed for this fight — MARK up to `targets` random enemies now (Start of Combat), then every
   *  `everyN` attacks made in the combat (either side), deal this minion's Attack to those SAME marked enemies that
   *  are still alive (never re-rolled; ends the moment the bleeder dies). `targets` already folds in golden. */
  armBleed(minion: Minion, everyN: number, targets: number): void;
}
