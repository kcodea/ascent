import type { Rng } from './rng';
import type { CombatBus } from './events';

export type Tribe = 'beast' | 'undead' | 'mech' | 'dragon' | 'demon' | 'neutral';

/** Keyword codes (handoff A.4). */
export type Keyword =
  | 'T' // Taunt
  | 'DS' // Divine Shield
  | 'V' // Venomous — destroys what it damages; drops off after its first proc in combat
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
  | 'EG'; // Engraved — stat gains during combat carry back to the run board (permanent)

export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

export type Side = 'player' | 'enemy';

/** Trigger names the effect system can subscribe to. */
export type GameEvent =
  | 'onPlay'
  | 'onSummon'
  | 'onDeath'
  | 'onAttack'
  | 'onDamaged'
  | 'onLoseDivineShield'
  | 'onConsume'
  | 'onKill'
  | 'startOfCombat'
  | 'avenge' // after X friendly minions have died in combat
  | 'onBuy'
  | 'onSell'
  | 'endOfTurn' // recruit phase: the turn ends (End Turn / timer hits 0)
  | 'battlecryTriggered' // recruit phase: a Battlecry just resolved (fires per Drakko repeat) — Karwind
  | 'cast' // a spell's own effect resolves (its chosen target is in the payload)
  | 'spellCast' // recruit phase: any spell was cast (for spell-tracking minions)
  | 'summonOverflow'; // recruit phase: a summon couldn't fit on the full board (Flowing Monk)

/**
 * Identifiers of registered effect primitives. Cards reference these by name
 * (data, not code). The combat simulator implements the combat-time set; the
 * run loop (`@game/sim`, M1) implements the recruit-time set. Grows as new
 * primitives are genuinely needed.
 */
export type EffectFactoryId =
  // combat-time (resolved inside simulate)
  | 'deathrattleSummon'
  | 'buffOnSummon'
  | 'deathrattleBuffTribe'
  | 'reAttackOnKill'
  | 'onKillBuffSelf' // on kill: buff self — permanent via Engraved
  | 'onKillBuffSpellPower' // on kill: permanently raise run-wide spell power +atk/+hp, carried back (Gnasher)
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
  | 'rallyProcDeathrattle' // Rally: when this attacks, fire your leftmost minion's Deathrattle first (Deathsayer)
  | 'deathrattleGrantSpell' // Deathrattle: add a spell to your hand after combat (Arcane Weaver)
  | 'deathrattleGrantMagnetic' // Deathrattle: add a random Magnetic minion to your hand after combat (Junkyard Titan)
  | 'deathrattleBuffSpellPower' // Deathrattle: permanently raise the run-wide spell power (+atk/+hp to spells), carried back (Skullblade)
  | 'deathrattleBuffCardTypeRunWide' // Deathrattle: permanently buff a card type run-wide (board/hand/future), carried back (Grave Knit)
  | 'deathrattleFillTribe'
  | 'avengeBuff' // Avenge (X): after X friendly deaths, buff self (combat)
  // Mechs — Divine Shield walls + shield-break payoffs (resolved in combat)
  | 'scGrantShieldTribe'
  | 'deathrattleGrantShield'
  | 'onShieldBreakGrantShield'
  | 'onShieldBreakDamage'
  | 'onShieldBreakBuffAll'
  // Demons — Consume / destroy (combat-resolved half)
  | 'onFriendDeathSummon'
  | 'scDestroyHighestAttack'
  // recruit-time (resolved by @game/sim, baked into stats before combat)
  | 'battlecryBuffTribe'
  | 'battlecrySummon'
  | 'buffOnBuy'
  | 'battlecryGrantKeyword'
  | 'battlecryGainRandomMinion' // Battlecry: add a random minion of a tier to your hand (Buddy Buddy)
  | 'battlecryDiscoverSpell' // Battlecry: Discover a spell (golden: grants the pick + a second random spell) (Black Belt Brian)
  | 'onBattlecryBuffTribe' // when any Battlecry resolves, buff your tribe (Karwind)
  | 'onBattlecryBuffFodder' // when any Battlecry resolves, permanently buff the Fodder card type run-wide (Bane)
  | 'battlecryBuffSpellPower' // Battlecry: permanently raise the run-wide spell power (+atk/+hp to spells) (Cinderwing Matron)
  | 'endOfTurnBuff' // End of Turn: buff self (recruit)
  | 'endOfTurnMagnetizeMechs' // End of Turn: merge a token's stats into N friendly Mechs (Combinator)
  | 'buffFodderEverywhere' // End of Turn: buff the Fodder card type for the whole run (Ritualist)
  // Demons — Consume (recruit-resolved half)
  | 'addTavernFodder' // Soulfeeder (Battlecry) / Maw of the Pit (End of Turn): queue Fodder into the next tavern
  | 'deathrattleAddFodder' // Burial Imp: Deathrattle queues Fodder into your next tavern, carried back (Demon)
  | 'avengeImproveSummon' // Kennelmaster: Avenge (X) permanently improves its summon buff
  | 'avengeMaxGold' // Soulsman: Avenge (X) raises your max Gold by 1, carried back (Undead)
  | 'onConsumeBuffSelf'
  | 'onConsumeGrantSelfKeyword'
  | 'onConsumeShieldNextCombat' // Maw of the Pit: on consume, gain a Divine Shield for the next combat only
  // Spells (recruit-resolved): a spell's own effect, and minions that cast spells
  | 'spellBuffTarget' // cast: buff the chosen target +atk/+hp (+ optional keyword: Spirit Fire, Bulwark)
  | 'spellBuffAll' // cast: buff every friendly minion on the board (Growth) — scales with spell power
  | 'spellDevour' // cast: devour the target, spit its stats onto a random friend (Channeling the Devourer)
  | 'castSpell' // a minion casts a named spell (auto-targets a friend)
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
  | 'stealTavernMinion'; // cast: steal a random minion offer from the tavern into the hand (Lasso)

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
  /** Demons: stat multiplier when this minion consumes a Fodder (Voracious Imp = 2; golden = +1).
   *  Default (absent) is 1 — a plain Demon gains the fodder's base stats. */
  fodderMult?: number;
  /** Money Bot: while this (or a Mech it magnetized into) is on the board, the player's max mana
   *  per turn is raised by this much (golden doubles). Recruit-only; lost when the card leaves. */
  manaPerTurn?: number;
  /** Better Bot: base Rally amount — when this (or a Mech it's magnetized onto) attacks, your OTHER
   *  Mechs get +this Attack. Stacks: each Better Bot magnetized onto a host adds its amount to the host. */
  rallyMechAtk?: number;
  /** Choose One: when played, the player picks one of these options; its `effects` then resolve
   *  as the card's Battlecry (in place of `onPlay`). Each option carries its own display text. */
  chooseOne?: { text: string; effects: EffectDef[] }[];
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
  /** The originating recruit board card's uid, so combat can report per-instance state
   *  (e.g. Avenge improvements) back for the run to persist. */
  sourceUid?: string;
  /** The Reclaimer's mark: at the start of combat this minion is destroyed (Deathrattle fires) and
   *  an exact copy is resummoned if there's room. */
  resummon?: boolean;
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
  /** The originating run board card's uid (if any), for per-instance carry-back. */
  sourceUid?: string;
  /** Better Bot: total Rally-Mech Attack granted to other Mechs when this attacks (own base + welds). */
  rallyMechAtk?: number;
  /** Permanent stats this minion gained mid-combat (Flowing Monk's overflow gift) — carried back to
   *  the run board afterwards, unlike ordinary combat-only buffs. */
  permaGain?: { attack: number; health: number };
  /** The Reclaimer's mark (see BoardMinion.resummon) — processed once at the start of combat. */
  resummon?: boolean;
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
}

/**
 * The replayable combat log. The UI animates these on its own clock and never
 * recomputes outcomes. Vocabulary matches the prototype's proven set plus
 * `summon`/`buff` for combat-time effects (Deathrattles, summon buffs).
 */
export type CombatEvent =
  | { type: 'sc'; source: string; text: string }
  | { type: 'attack'; attacker: string; defender: string; swing: number }
  | { type: 'dmg'; target: string; amount: number; remainingHp: number }
  | { type: 'shield'; target: string }
  | { type: 'shieldUp'; target: string }
  | { type: 'poison'; target: string }
  | { type: 'reborn'; target: string; hp: number; attack: number; keywords: Keyword[] } // returns at base stats
  | { type: 'death'; target: string; side: Side } // `side` lets the UI count enemy kills (Cassen) without uid-matching
  | { type: 'reveal'; target: string } // a Stealth minion attacked and lost Stealth
  | { type: 'venomLost'; target: string } // a Venomous minion procced and lost Venomous
  | { type: 'summon'; minion: MinionSnapshot; side: Side; index: number; source?: string; echo?: boolean }
  | { type: 'buff'; target: string; attack: number; health: number; source: string }
  | { type: 'improve'; target: string; amount: number } // Kennelmaster's Avenge strengthens its summon aura
  | { type: 'rally'; source: string; target: string } // Deathsayer's Rally fires `target`'s Deathrattle
  | { type: 'toHand'; cardId: string; side: Side; source?: string }; // a combat effect adds a card to your hand (Arcane Weaver)

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
  /** Permanent max-Gold increase from this combat (Soulsman's Avenge). Applied to `maxEmbers` in
   *  settleCombat. Absent if 0. */
  playerMaxGoldGain?: number;
  /** Outcome odds (fractions summing to 1) — estimated by the run loop re-simulating these boards
   *  on many independent seeds. Not produced by `simulate` itself (a single fight); the run loop fills it. */
  odds?: { win: number; draw: number; lose: number };
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
  /** Spells cast this turn (recruit), frozen at combat start — scales Spirit Worgen's in-combat buff. */
  readonly spellsThisTurn: number;
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
  summon(side: Side, card: CardDef, nearUid?: string): Minion;
  /** Queue a card to be added to that side's hand after combat (player only is persisted). */
  grantToHand(cardId: string, side: Side, sourceUid?: string): void;
  /** Permanently raise the run-wide spell power by +atk/+hp (Skullblade's Deathrattle). Player-only;
   *  accumulated and carried back via `CombatResult.playerSpellPower`, applied in the run loop. */
  grantSpellPower(attack: number, health: number, side: Side): void;
  /** Permanently buff a card type run-wide by +atk/+hp (Grave Knit's combat death). Player-only;
   *  accumulated and carried back via `CombatResult.playerCardBuffs`, applied in the run loop. */
  grantCardBuff(cardId: string, attack: number, health: number, side: Side): void;
  /** Queue `count` Fodder into the player's next tavern (Burial Imp's Deathrattle). Player-only;
   *  carried back via `CombatResult.playerFodderGrants`, pushed onto pendingTavern in settleCombat. */
  grantTavernFodder(count: number, side: Side): void;
  /** Permanently raise the player's max Gold by `amount` (Soulsman's Avenge). Player-only; carried
   *  back via `CombatResult.playerMaxGoldGain`, applied to maxEmbers in settleCombat. */
  grantMaxGold(amount: number, side: Side): void;
  /** Deal damage to a combat minion (used by Start-of-Combat and on-break effects). */
  damage(target: Minion, amount: number, poison?: boolean, bypassShield?: boolean): void;
}
