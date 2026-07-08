import type { Rng } from './rng';
import type { CombatBus } from './events';

export type Tribe = 'beast' | 'undead' | 'mech' | 'dragon' | 'demon' | 'neutral';

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
  | 'EG'; // Engraved — stat gains during combat carry back to the run board (permanent)

export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

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
  | 'goldSpent'; // recruit phase: the player spent Gold — fires per threshold (Acid, Banksly)

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
  | 'onKillGrantFreeRolls' // Moe: Slaughter — bank N free rerolls for next shop (carried back)
  | 'onKillGrantGold' // Bounty Bot: Slaughter — grant N Gold into the next shop (carried back)
  | 'onKillCastSpell' // Hoardbreaker Drake: Slaughter — cast a board-wide stat spell (Growth) in combat
  | 'rallyCastRandomStatSpell' // Spell Drummer: Rally — cast a random stat spell on a random friend + copy self to hand
  | 'avengeCastRandomStatSpell' // Spark Capacitor: Avenge — cast a random stat spell on your lowest-Health Mech
  | 'deathrattleDamageAll' // Deathrattle: damage every minion on both sides (Blaster)
  | 'deathrattleDestroyKiller' // Deathrattle: destroy the minion that dealt the killing blow (Jenkins & Fi)
  | 'deathrattleBuffTribeByTally' // Deathrattle: buff a tribe by +per per Deathrattle triggered this game (Grim)
  | 'scDamage'
  | 'scSplitDamage'
  | 'scAoePerTribe'
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
  | 'scTribeBuffPerSpell' // Runescale Drake: Start of Combat — buff a tribe +N/+N, +M per spell cast this turn
  | 'scTribeBuffPerPlayed' // (retired dial) Start of Combat — buff Beasts +N/+N, +M per Beast played this turn
  | 'scTribeBuffImproving' // Pack Leader: Start of Combat — buff Beasts +M/+M (base + accrued), improve permanently
  // recruit-time (resolved by @game/sim, baked into stats before combat)
  | 'battlecryBuffTribe'
  | 'battlecrySummon'
  | 'buffOnBuy'
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
  | 'addTavernFodder' // Soulfeeder (Battlecry) / Maw of the Pit (End of Turn): queue Fodder into the next tavern
  | 'deathrattleAddFodder' // Burial Imp: Deathrattle queues Fodder into your next tavern, carried back (Demon)
  | 'avengeAddFodder' // Pit Supplier: Avenge (N) queues a Fodder into your next shop, carried back (Demon)
  | 'avengeGrantSpellPower' // Spell Appraiser: Avenge (N) permanently raises run-wide spell power, carried back
  | 'rallyImproveSummonAura' // Baby Cub: Rally bumps a friendly Den Mother's summon aura (summonBonus), carried back
  | 'avengeImproveSummon' // Kennelmaster: Avenge (X) permanently improves its summon buff
  | 'avengeMaxGold' // Soulsman: Avenge (X) raises your max Gold by 1, carried back (Undead)
  | 'avengeGrantSpell' // Arcane Weaver: Avenge (X) adds a copy of a spell to your hand after combat (Dragon)
  | 'deathrattleGrantReborn' // Mumi: Deathrattle — grant a random friendly Undead Rise (Undead)
  | 'deathrattleBuffAll' // Sporeling: Deathrattle — give all friendly minions +atk/+hp (Undead)
  | 'battlecryTriggeredOwnDeathrattle' // Sporeling: every Battlecry you trigger procs this minion's own Deathrattle (counts toward the tally)
  | 'avengeGiveAttack' // Stuntdrake: Avenge (X) hands this minion's Attack to N friends (Dragon)
  | 'endOfTurnGrantTribe' // Frontdrake: every N End-of-Turns, conjure a random minion of a tribe to hand (Dragon)
  | 'onFriendlyAttackBuffTribe' // Raptor: when another friendly minion of a tribe attacks, buff it (Beast)
  | 'onAllyAttackBuffAll' // Crypt Drake: when any ally attacks, buff your minions — improving every N attacks
  | 'onAllyAttackCastGrowth' // Taragosa: when any ally attacks, cast Growth (+atk/+hp to all friends); golden ×2
  | 'onGainAttackBuffAll' // Hunter: when this minion's Attack rises, buff your minions' Health
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
  | 'spellDevour' // cast: devour the target, spit its stats onto a random friend (Channeling the Devourer)
  | 'castSpell' // a minion casts a named spell (auto-targets a friend)
  | 'endOfTurnGetRandomSpells' // Crypt Scribe: End of Turn — conjure N random spells to hand
  | 'gainEmbers' // cast: gain Embers (untargeted — Ember Pouch)
  | 'spellCastBuffOthers' // spellCast: give N other friendly minions +atk/+hp (Archmagus Guel)
  | 'overflowBuffRandom' // summonOverflow: buff a random friendly minion (Flowing Monk)
  | 'spellCastTransform' // spellCast: tick a per-instance counter; at the threshold, transform into another card (Spirit Pup → Worgen)
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
  // --- recruit factories (new content batch) ---
  | 'battlecryBuffUndeadAttack' // Deathswarmer: Battlecry — give your Undead +Attack wherever they are; stacks into future buys
  | 'battlecryBuffBeastAttack' // Squirl Scout: Battlecry — give your Beasts +Attack wherever they are; stacks into future buys
  | 'battlecryBuffImps' // Imp Overseer: Battlecry — give your Imps +atk/+hp run-wide (shared impBuff enchant)
  | 'goldSpentBuffFodder' // Koron: every N Gold spent, permanently buff your Fodder run-wide (+ queue a Fodder)
  | 'goldSpentMagnetize' // Banksly: every N Gold spent, weld a random Magnetic onto self
  // --- tavern-spell batch (2026-06-26) ---
  | 'spellBuffByTier' // Lantern Light: cast — give the target +Tavern Tier / +Tavern Tier (recruit)
  | 'spellSellToDemon' // Fodder Treatment: cast — sell the target, give its stats to your left-most Demon (recruit)
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
  | 'rallyGiveDemonAttack' // Bloodbinder: Rally — give another friendly Demon +Attack = this minion's Attack
  | 'avengeShieldAttack' // Solaris Fang: Avenge (X) — gain a Divine Shield and attack immediately
  | 'endOfTurnGrantSpellChoice' // Money Maker: every N turns, add a random card from a list to hand (recruit)
  | 'spellRallyDoubleNext' // Rallying Offensive: cast — your Rally effects trigger twice next combat (recruit)
  | 'rallyCastTribeAttack' // Watcher: Rally — cast Lantern of Souls (Undead +Attack run-wide) as a real spell cast
  | 'battlecryDoubleNextSpell' // Nimbus: Battlecry arms the next Tavern spell to cast twice (recruit)
  | 'endOfTurnCastSpellEscalating' // Vineweaver Drake: EoT casts a spell once per End of Turn seen (recruit)
  | 'battlecryGrantSpell' // Field Mechanic: Battlecry adds a specific spell (Patch Job) to your hand (recruit)
  | 'endOfTurnAdjacentConsumeFodder' // Abyssal Feeder: EoT — both board-adjacent minions Consume a Fodder (recruit)
  | 'endOfTurnBuffPerTribePlayed' // Spirit Worgen: EoT — gain per Beast/Dragon played this turn, +per spell cast (recruit)
  | 'battlecryDestroyForSpell'; // Graverobber: Battlecry — destroy a friendly (procs its DR), get a spell of its tier (recruit)

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
  ascendInto?: string;
  /** Combat: this minion attacks immediately when summoned mid-fight, out of turn order — then joins the
   *  normal rotation (Twilight Whelp's 3/3 Whelp). Drained by the immediate-attack queue in `simulate`. */
  attackOnSummon?: boolean;
  /** A spell, not a minion: cast from hand for an effect, never takes a board slot. */
  spell?: boolean;
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
  /** Demons: stat multiplier when this minion consumes a Fodder (Voracious Imp = 2; golden = +1).
   *  Default (absent) is 1 — a plain Demon gains the fodder's base stats. */
  fodderMult?: number;
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
  chooseOne?: { text: string; effects: EffectDef[]; target?: 'friendly' | 'any' }[];
  /** Discover-on-play: playing this card opens a Discover (a peek) and consumes the card — no board slot,
   *  no `cast` effect, and never multiplied by spell-quantity (Yazzus). Used by the tavern Discover spells
   *  (Sprout, Help Wanted, Tribe Portal, Corpse Board) and the golden Triple Reward token. The tier/tribe
   *  are resolved at play time from the live run (see `DiscoverOnPlay`). Replaces what was a per-card-id
   *  branch in the reducer — new Discover spells are now data-only. */
  discoverOnPlay?: DiscoverOnPlay;
}

/** Declarative spec for {@link CardDef.discoverOnPlay}. The offer tier is `exactTier` if set, otherwise the
 *  current tavern tier plus `tierOffset` (default 0). All fields optional → a bare `{}` Discovers from the
 *  current tier with no filter. */
export interface DiscoverOnPlay {
  /** Fixed offer tier, ignoring the tavern tier (Sprout = always Tier 1). */
  exactTier?: number;
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
/** The player action a quest objective counts. `summon` counts every minion that ENTERS your board (plays
 *  PLUS tokens from Shouts/Echoes); `shout` counts Battlecry minions you play. Grows as objectives expand. */
export type QuestObjectiveEvent = 'buy' | 'play' | 'sell' | 'roll' | 'summon' | 'shout';
/** A quest objective: reach `count` of `event`. `tribe` narrows a `summon` objective to one tribe (e.g.
 *  "Summon 4 Undead"). Live progress lives on the run's `ActiveQuest`, not here. */
export interface QuestObjective {
  event: QuestObjectiveEvent;
  count: number;
  tribe?: Tribe;
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
  | { kind: 'grant'; randomTribe?: Tribe; randomCount?: number; cards?: string[]; repeatInTurns?: number }
  | { kind: 'shoutDouble'; count: number };
export type QuestRewardKind = QuestReward['kind'];
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
  /** Better Bot: accrued Rally-Mech Attack this minion grants on attack (its own base + every Better Bot
   *  magnetized onto it). Combat reads it to buff other Mechs when this attacks. */
  rallyMechAtk?: number;
  /** Extra magnitude added to this minion's summon-buff effect (Kennelmaster's Avenge
   *  improvements, persisted across the run). Default 0. */
  summonBonus?: number;
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
  /** Extra magnitude on this minion's summon-buff (Kennelmaster), grown by Avenge in
   *  combat and carried back to the run board afterwards. */
  summonBonus: number;
  /** Flowing Monk: flat grant bonus from the triple combine (see BoardMinion.overflowBonus). Static. */
  overflowBonus?: number;
  /** Guel: spells-cast-while-on-board (seeded from the run card) — feeds the live combat text only. */
  spellProgress?: number;
  /** The originating run board card's uid (if any), for per-instance carry-back. */
  sourceUid?: string;
  /** Better Bot: total Rally-Mech Attack granted to other Mechs when this attacks (own base + welds). */
  rallyMechAtk?: number;
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
  | { type: 'attack'; attacker: string; defender: string; swing: number }
  | { type: 'dmg'; target: string; amount: number; remainingHp: number }
  | { type: 'shield'; target: string }
  | { type: 'shieldUp'; target: string }
  | { type: 'poison'; target: string }
  | { type: 'reborn'; target: string; hp: number; attack: number; keywords: Keyword[]; after?: string } // returns at base stats; `after` = the uid the Rise re-slots to the RIGHT of (a Rise whose Deathrattle summoned tokens into its old slot)
  | { type: 'death'; target: string; side: Side; rise?: true } // `side` lets the UI count enemy kills (Cassen) without uid-matching; `rise` marks a Rise's FIRST death — shown (the body vacates its slot) but NOT counted as a kill, since it returns
  | { type: 'reveal'; target: string } // a Stealth minion attacked and lost Stealth
  | { type: 'keyword'; target: string; keyword: Keyword; source?: string } // a combat effect grants a keyword (Mumi → Rise, Ryme-replayed keyword battlecries) — the UI folds it into the unit's pills
  | { type: 'venomLost'; target: string } // a Venomous minion procced and lost Venomous
  | { type: 'summon'; minion: MinionSnapshot; side: Side; index: number; source?: string }
  | { type: 'ascend'; target: string; into: string } // mid-combat transform (Tara → Taragosa, Spirit Pup → Spirit Worgen)
  | { type: 'buff'; target: string; attack: number; health: number; source: string }
  | { type: 'improve'; target: string; amount: number } // Kennelmaster's Avenge strengthens its summon aura
  | { type: 'rally'; source: string; target: string } // Deathsayer's Rally fires `target`'s Deathrattle
  | { type: 'maxGold'; target: string; side: Side; amount: number } // Soulsman's Avenge raises your max Gold
  | { type: 'toHand'; cardId: string; side: Side; source?: string } // a combat effect adds a card to your hand (Arcane Weaver)
  | { type: 'hpGrant'; target: string; amount: number } // Sergeant: live HP-grant amount after each Attack-gain improvement
) & { step?: number };

export type CombatOutcome = 'win' | 'lose' | 'draw';

export interface CombatResult {
  events: CombatEvent[];
  result: CombatOutcome;
  /** Resolve the player loses on defeat (handoff A.3 step 9). 0 otherwise. */
  playerDamage: number;
  /** Player-side Deathrattles that fired this combat — the run loop accumulates these into the run-wide
   *  "this game" count Grim reads. */
  playerDeathrattles: number;
  /** Enemy-side minions that died this combat — Cassen's Collision banks these toward "kill 5 enemy
   *  minions → get a top-type minion" (the run loop accumulates them). */
  enemyDeaths: number;
  /** Starting rosters, for the UI to render before replaying the log. */
  initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] };
  /** Per-instance state to persist on the run board after combat, keyed by the board
   *  card's uid (Kennelmaster's Avenge-improved summon bonus). Only entries that changed. */
  playerSummonBonus?: { sourceUid: string; bonus: number }[];
  /** Sergeant's Deathrattle HP-grant bonus after this combat, keyed by board card uid — the seeded value
   *  plus any improvements from Attack gained in combat. Persisted to the run board so the improvement is
   *  permanent across fights (only minions whose bonus is > 0). */
  playerHpGrantBonus?: { sourceUid: string; bonus: number }[];
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
  /** Permanent run-wide spell-power gain from this combat (Skullblade's Deathrattle: +Attack to your
   *  spells). Summed across all firings; applied to the run's `spellBonus` in settleCombat. Absent if 0. */
  playerSpellPower?: { attack: number; health: number };
  /** Permanent run-wide card-type buffs from this combat (Grave Knit's death: all Grave Knits +3/+2).
   *  One entry per (cardId) accrued; applied via the run loop's run-wide card-type buff in settleCombat. */
  playerCardBuffs?: { cardId: string; attack: number; health: number }[];
  /** Fodder to queue into the next tavern from this combat (Burial Imp's Deathrattle). A count of
   *  `fred` tokens; pushed onto `pendingTavern` in settleCombat. Absent if 0. */
  playerFodderGrants?: number;
  /** Economy Battlecries Ryme re-fired in combat (Soulfeeder's Fodder, Hoarder's Gold, Demonic Anomaly's shop
   *  buff, gain-a-minion) — recorded here (cardId + its golden state) and replayed through the real recruit
   *  factory in settleCombat, where they have full RunState access. Combat-meaningful Battlecries (summon /
   *  buff / discover / grant-keyword / spell-power) run in combat instead and are NOT listed here. */
  playerDeferredBattlecries?: { cardId: string; golden: boolean }[];
  /** Free shop rerolls banked from this combat (Gryphon's on-damaged). Added to `freeRolls` in settleCombat. */
  playerFreeRolls?: number;
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
  /** Spells cast this turn (recruit), frozen at combat start — scales Runescale Drake's Start-of-Combat buff. */
  readonly spellsThisTurn: number;
  /** Beasts you PLAYED this turn (recruit), frozen at combat start — scales Pack Leader's Start-of-Combat buff. */
  readonly beastsPlayedThisTurn: number;
  /** The run's spell power at combat start ({attack, health} — hero amplify + card spell bonus). Taragosa's
   *  Growth is a real spell cast, so it inherits this just like a shop-cast Growth does. */
  readonly spellPower: { attack: number; health: number };
  /** Deathrattles triggered this game so far: the run-wide base (passed in) + this combat's player
   *  Deathrattles. Grim scales its buff by this. */
  deathrattleTally(): number;
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
  summon(side: Side, card: CardDef, nearUid?: string, grantKeywords?: Keyword[], golden?: boolean, attackNow?: boolean): Minion;
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
  /** Abhorrent Horror: total Fodder stats consumed this turn (attack + health), passed in from RunState.
   *  The `scGainFodderStats` factory reads these at Start of Combat. 0 if no Fodder was eaten. */
  readonly fodderConsumedAtk: number;
  readonly fodderConsumedHp: number;
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
  /** Bane (combat, reacting to Ryme's battlecry replays): permanently enchant the Fodder card type run-wide
   *  by +atk/+hp (player only). Carried back via CombatResult.playerFodderBuffGain → `buffFodderRunWide`. */
  grantFodderBuff(attack: number, health: number, side: Side): void;
  /** Deal damage to a combat minion (used by Start-of-Combat and on-break effects). */
  damage(target: Minion, amount: number, poison?: boolean, bypassShield?: boolean): void;
}
