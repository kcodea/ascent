import type { Rng } from './rng';
import type { CombatBus } from './events';

/** The five Set 2 "Dwarven Ale" spells — what a Dwarf's "get a Dwarven Ale" draws from. Lives in core because
 *  BOTH the recruit factories and the combat ones (Slaughter / Rally / Echo grants) need it. */
export const ALE_IDS: readonly string[] = ['wo_mine', 'wo_reinforcement', 'wo_champion', 'wo_health', 'wo_attack'];

export type Tribe = 'beast' | 'undead' | 'mech' | 'dragon' | 'demon' | 'neutral' | 'kobold' | 'dwarf' | 'celestial';

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
// NB: Transcendant grants Engraved as a LIVE ADJACENCY AURA rather than the keyword — see `engravedByAura`.

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

/**
 * A card's declared trigger multiplication. TWO KINDS, and the card's own printed wording says which — the
 * owner's vocabulary rule, 2026-08-28:
 *
 *   · **"trigger twice"** → a MULTIPLIER (`factor`). Copies of the SAME card do not stack (two Drakkos still
 *     mean twice), but different multiplier cards MULTIPLY with each other.
 *   · **"trigger 1 additional time"** → ADDITIVE (`extra`). Every copy counts, and every additive card counts.
 *
 * They combine as `(1 + Σ extra) × Π factor`, which is what makes the owner's worked examples come out:
 *   two Sylus (additive)            → (1 + 1 + 1) × 1 = 3 fires
 *   two Drakko (multiplier)         → (1)         × 2 = 2 fires
 *   Drakko + Zyff (mult + additive) → (1 + 1)     × 2 = 4 fires
 *
 * GOLDEN. An additive card doubles its `extra` (Sylus: +1 → +2). A multiplier card gains ONE more trigger
 * rather than doubling its factor — golden Drakko is "three times", not "four" (owner ruling 2026-08-28),
 * which preserves the power gilding had under the old additive model.
 */
export type TriggerMultiplierDef = {
  families: readonly TriggerFamily[];
} & (
  | {
    /** ADDITIVE: this many extra fires per copy, summed across every copy and every additive card. */
    extra: number;
    factor?: never;
    /** Additive cards always stack — kept for the schema's benefit and for older data. */
    stacks?: boolean;
  }
  | {
    /** MULTIPLIER: total fires are multiplied by this. Best single copy per card, product across cards. */
    factor: number;
    extra?: never;
    stacks?: never;
  }
);

/**
 * Total fires ONE non-golden copy of a multiplier card produces on its own — `1 + extra` for an additive
 * card, `factor` for a multiplier. The single place that knows how to read either shape, so a caller that
 * only wants "how much does this card multiply by" (the Doc Bot interaction sweep, live card text) never has
 * to branch on the union itself.
 */
export function declaredFireFactor(mult: TriggerMultiplierDef): number {
  return mult.factor !== undefined ? mult.factor : 1 + (mult.extra ?? 0);
}

/**
 * Extra fires contributed by the multiplier cards among `minions`, for one trigger family. Returns the
 * ADDITIONAL count (0 = no multiplier), so callers keep using `1 + extraTriggerFires(...)` — the whole model
 * lives in here, and no call site had to change when it was rewritten.
 *
 * `(1 + Σ extra) × Π factor`, minus the base 1. See `TriggerMultiplierDef` for the vocabulary rule this
 * implements and the owner's worked examples.
 */
export function extraTriggerFires(
  family: TriggerFamily,
  minions: readonly { cardId: string; golden?: boolean }[],
  getCard: (id: string) => CardDef | undefined,
): number {
  let extra = 0; // ADDITIVE cards (Sylus, Zyff, Uron): every copy of every card counts
  // MULTIPLIER cards (Drakko, Chronos): the best single copy PER CARD, multiplied across different cards.
  // Keyed by cardId so two Drakkos are still one ×2 while Drakko × a different multiplier is ×4.
  const factors = new Map<string, number>();
  for (const m of minions) {
    const mult = getCard(m.cardId)?.triggerMultiplier;
    if (!mult || !mult.families.includes(family)) continue;
    if (mult.factor !== undefined) {
      // Golden adds ONE more trigger rather than doubling the factor (owner ruling 2026-08-28): ×2 → ×3.
      const f = mult.factor + (m.golden ? 1 : 0);
      factors.set(m.cardId, Math.max(factors.get(m.cardId) ?? 0, f));
    } else {
      extra += (mult.extra ?? 0) * (m.golden ? 2 : 1);
    }
  }
  let total = 1 + extra;
  for (const f of factors.values()) total *= f;
  return total - 1;
}

/**
 * Rune of Twilight's extra Start-of-Combat passes — how many ADDITIONAL times each Start-of-Combat effect
 * fires beyond the base (+ Uron's card-data multiplier, which `extraTriggerFires` owns). THE single
 * definition consulted by BOTH the combat SC pass in `simulate` and the shop End-of-Turn replay under Rune
 * of Combat Prowess (owner reversal 2026-08-20: the two runes STACK — a trigger multiplier follows the
 * trigger to whatever phase it fires in), so the two counts can never drift.
 */
export function socTwilightExtraFires(mods: { runeTwilight?: boolean; flagCopies?: Record<string, number> } | undefined): number {
  // +1 extra Start-of-Combat pass per Twilight copy held (boolean-flag family, owner 2026-08-27) — the
  // `flagCopies` channel; single-copy runs and pre-counter snapshots read 1, byte-identical to before.
  return mods?.runeTwilight ? Math.max(1, mods.flagCopies?.runeTwilight ?? 1) : 0;
}

/**
 * THE Echo-multiplier set (owner principle 2026-08-20: trigger multipliers follow the trigger to whatever
 * phase it fires in). Both phases fold the SAME inputs additively — combat's `playerEchoExtras` and the
 * recruit-side `fireRecruitDeathrattles` each gather their phase's values and call this, so "how many extra
 * times does an Echo fire" has ONE definition:
 *   - `reaperExtras`  — Sylus (stacking) + Uron (best copy), from card data via `extraTriggerFires`;
 *   - `beastRitualExtra` — Elderhorn's Beast Ritual, for a BEAST echo only (caller gates the tribe);
 *   - `echoExtraAlways`  — Funeral Engine's permanent extra trigger;
 *   - `firstEchoBonus`   — Grave Contract / Last Rites / Rune of the Catacomb's first-Echo bonus, already
 *      gated + consumed by the caller for its own scope (per combat in a fight, per turn in the shop).
 */
export interface EchoExtraFireInputs { reaperExtras: number; beastRitualExtra: number; echoExtraAlways: number; firstEchoBonus: number }
export function foldEchoExtraFires(i: EchoExtraFireInputs): number {
  return i.reaperExtras + i.beastRitualExtra + i.echoExtraAlways + i.firstEchoBonus;
}

/** Shop tiers. 7 exists ONLY under the Summit rift — see `maxTierFor` in @game/sim, which is the
 *  single gate on whether a run can ever reach it. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Side = 'player' | 'enemy';

/** Trigger names the effect system can subscribe to. */
/**
 * CELESTIAL ALIGNMENT (owner spec 2026-08-03) — the board splits into two halves around its CENTRE:
 * **Dawn** on the left, **Dusk** on the right, and the exact middle body is **Eclipse**, which counts as
 * BOTH. Derived from the board's SIZE and a minion's index, not from fixed slot numbers, so it re-centres as
 * minions arrive and leave: one minion alone is Eclipsed; an EVEN board has no Eclipse at all (everything
 * pairs off to a side). See `alignmentAt` in @game/sim.
 *
 * Alignment is a RECRUIT-PHASE property. It moves freely while you rearrange the shop board, then LOCKS at
 * the moment combat starts (frozen onto `BoardMinion.align`) — combat deaths never re-centre the board, so a
 * minion fights the alignment you built it with (owner ruling 2026-08-03).
 */
export type Alignment = 'dawn' | 'dusk' | 'eclipse';

export type GameEvent =
  | 'onPlay'
  /** CELESTIAL ORBIT: a card was PLAYED FROM HAND into a slot adjacent to this minion (owner ruling
   *  2026-08-03 — from hand only; not a summoned token, not a reorder that slides someone next to you).
   *  The arriving minion rides in the payload as `minion`; the orbiting watcher is `self`. */
  | 'orbit'
  /** CELESTIAL: fires when ANY Orbit on your board resolves — the board-wide watcher ("Whenever an Orbit
   *  triggers…"). `params.others: true` excludes the watcher's own Orbit (Orrery's "another Orbit"). The
   *  arriving minion rides as `minion`; the minion whose Orbit fired rides as `source`. */
  | 'orbitFired'
  | 'onSummon'
  | 'onDeath'
  | 'onAttack'
  | 'onGainAttack' // a minion's Attack rose mid-combat (emitted by ctx.buff when the delta > 0) — Hunter
  | 'onDamaged' // a minion took damage that landed (emitted by dealDamage) — Gryphon
  | 'friendlyDemonDealtDamage' // Set 2: a FRIENDLY Demon dealt combat damage (attack, retaliation, or incidental) — Impossible Todd / Leech / Axeman. A Ward-absorbed (0-damage) hit never reaches the emit, so it doesn't count.
  | 'onLoseDivineShield'
  | 'onConsume'
  | 'onKill'
  | 'startOfCombat'
  | 'avenge' // after X friendly minions have died in combat
  | 'minionSold' // Set 2: another minion was sold (Voicekeeper watches)
  | 'spellCastOnThis' // Set 2: a targeted spell resolved ON this minion (Mirrorwing / Runefire)
  | 'onBuy'
  | 'endOfTurn' // recruit phase: the turn ends (End Turn / timer hits 0)
  | 'battlecryTriggered' // recruit phase: a Battlecry just resolved (fires per Drakko repeat) — Karwind
  | 'cast' // a spell's own effect resolves (its chosen target is in the payload)
  | 'spellCast' // recruit phase: any spell was cast (for spell-tracking minions)
  | 'summonOverflow' // recruit phase: a summon couldn't fit on the full board (Flowing Monk)
  | 'goldSpent' // recruit phase: the player spent Gold — fires per threshold (Acid, Banksly)
  | 'cardsBought' // recruit phase: the player bought a card — fires per threshold (Korok, Banksly)
  | 'cardsPlayed' // recruit phase: the player PLAYED a card — the play-count twin of `cardsBought` (Mountainbond)
  | 'chooseOnePlayed' // recruit phase: the player played a CHOOSE ONE card specifically (Ruby Roach)
  | 'onSell' // recruit phase: this minion is sold (Hoard Whelp — get Gold, Beggy — get Rubies)
  | 'startOfTurn' // recruit phase: a shop turn begins — the symmetric twin of `endOfTurn` (Gemline Martyr)
  | 'equip' // recruit phase: this minion GRANTS its Equipment — on play, and again at every Start of Turn
         // rebuild. Shout-shaped (it fires as the body enters play) but it is not a Shout: it re-fires on
         // the rebuild, and its payload is a grant to the PLAYER rather than an effect on the board.
  | 'onGainCard' // recruit phase: a card was added to your hand via the conjure/grant path (Gangplank)
  | 'onRubyPlayed' // set 2 recruit phase: a Ruby was played on THIS minion (Ruby Broker → Gold, Resonance Idol → bounce)
  | 'rubyPlayedAnywhere' // Candle Conduit: a Ruby was played on ANY friendly minion (passive marker — the ruby paths scan for it; never dispatched through the bus)
  | 'onGetRuby' // set 2 recruit phase: you gained a Ruby (Candle Conduit → cast one on a random Kobold)
  | 'rubyCast' // set 2 recruit phase: a Ruby was cast — fires per threshold (Gemgorge Fiend: every 3 → Consume)
  | 'shopRefreshed' // set 2 recruit phase: the tavern was rolled (Hellrider counts refreshes)
  | 'passive' // declared but NEVER dispatched: marks a card whose effect is read by another system rather
  //  than fired by an event (Deepdelve Paragon — `playRubyOn` scans the board for it). Keeping it in the
  //  effects list means the card is still data-driven and greppable, instead of a card id hardcoded in core.
  | 'spellBought'; // set 2 recruit phase: a Shop Spell was PURCHASED (Moonhowl Mentor teaches it to a Mage-Pup).
  //  Distinct from `onBuy`, which is minions only ("a spell isn't a minion") — widening onBuy would have
  //  changed what every existing buy-trigger sees.

/**
 * Identifiers of registered effect primitives. Cards reference these by name
 * (data, not code). The combat simulator implements the combat-time set; the
 * run loop (`@game/sim`, M1) implements the recruit-time set. Grows as new
 * primitives are genuinely needed.
 */
export type EffectFactoryId =
  // combat-time (resolved inside simulate)
  // ── GIFTS (owner design 2026-08-26) + the shared one-per-tribe buff Great Pot uses ──
  | 'buffOnePerTribe'
  | 'giftShoutExtraTurn'
  | 'giftRoyalAllowance'
  | 'giftShopBuffGame'
  | 'giftIroncladFavor'
  | 'giftUnbridledMight'
  | 'giftRegalia'
  | 'giftGrandLarceny'
  | 'giftSpellDiscountTurn'
  | 'giftMinionDiscountTurn'
  | 'giftUpgradeDiscount'
  | 'giftTierAboveMinion'
  | 'giftSecondCalling'
  | 'giftPartingGifts'
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
  | 'battlecryBuffTribeImproving' // Scalechanter: Shout — buff a tribe by base + its improvements
  | 'onBattlecryImproveSelf' // Scalechanter: every N Shouts triggered, improve its own magnitude
  | 'deathrattleQueueNextSpellCopy' // Mushy: Echo — copy the first spell you cast next turn
  | 'battlecryArmGrimoire' // Living Grimoire: Shout — charge the first-spell multiplier
  | 'onBattlecryRearmGrimoire' // Living Grimoire: every 3 Shouts, recharge it
  | 'onMinionSoldCopyFirstOfTribe' // Voicekeeper: copy the first tribe minion sold each turn
  | 'minionSoldGrantSpell'         // Set 2 — Runic Archivist: every N minions sold, get a Shop spell
  | 'endOfTurnTriggerAdjacentShouts' // Set 2 — Moira: End of Turn, trigger both neighbours' Shouts
  | 'onRallyPlayRubiesTribe'       // Set 2 — Mineral Master: any friendly Rally plays Rubies on your tribe
  | 'onRallyBuffOnePerTribe'       // Paragon: any friendly Rally buffs one minion of every type, permanently (`permanent: false` → for the fight only, and `selfOnly: true` → own Rally only, not a watcher: Standard Bearer)
  | 'onSpellCastOnThisRecast' // Mirrorwing Hatchling: the first spell on this each turn casts again
  | 'onSpellCastOnThisSpreadAdjacent' // Runefire: it also casts on adjacent Dragons
  | 'onSpellCastOnThisSpreadRandom' // Reflector (Yirin): it also casts on one random other friendly minion
  | 'onRubyPlayedSpreadAdjacent'
  | 'onRubyPlayedSpreadRandom' // Runefire: a RUBY played on it also lands on adjacent Dragons
  | 'scTriggerTribeShouts' // Thunderous Sovereign: Start of Combat — trigger your tribe's Shouts
  | 'rallyTriggerLeftmostTribeShout' // Chorus Drake: Rally — trigger your left-most other Dragon's Shout
  | 'onSpellCastBuffRandomTribe'
  | 'onSpellCastPlayRubiesAdjacent' // Runespark Channeler: a Shop spell casts Rubies on this minion's neighbours
  | 'summonBuffTribeAsym' // Groveweaver: a summoned tribe minion gets +atk/+hp at the current magnitude
  | 'onSpellCastImproveSummon' // Groveweaver: each spell cast improves that grant
  | 'battlecryCastNamedSpell' // Facetbound Martyr — cast a named Shop spell N times (recruit)
  | 'grantRandomChooseOne' // Flagrunner / Prismpick Artificer — a random Choose One card to hand
  | 'chooseOnePlayedPlayRubies' // Ruby Roach — a Choose One play casts Rubies on your board
  | 'armChooseBoth' // Dealer — arm THIS body's own first-Choose-One latch (per instance, not a run counter)
  | 'grantChooseBothCharges' // Dealer / Prismpick Artificer — the next N Choose Ones resolve both branches
  | 'battlecryCastTaughtSpell' // Mage-Pup: Shout — cast the spell this token was taught
  | 'grantMagePupTaught' // Moonhowl Mentor: a Shop Spell was bought — mint a Mage-Pup taught that spell, NOW
  | 'battlecryGrantBeastHunt' // Elderhorn (Hunt): your Beast Rallies + Slaughters fire an extra time
  | 'battlecryGrantBeastRitual' // Elderhorn (Ritual): your Beast Echoes fire an extra time
  | 'rallySpreadTribeBuff' // Sunmane Herald: Rally — buff your tribe AND graft this rally onto them
  | 'scSummonOnlyTribeAura' // Denkeeper Oona: minions you summon in combat enter buffed
  | 'rallyProcLeftmostEcho' // Echohorn Stag: Rally — trigger your left-most friendly Echo
  | 'deathrattleSummonRandomTribe' // Menagerie Mammoth: Echo — summon N random minions of a tribe
  | 'deathrattleSummonRandomTribeSetStats' // Bullseye: Echo — summon a random tribe minion set to fixed stats
  | 'onSummonTribeBuffFlat' // Beardsley: combat-only — a summoned tribe minion gets a flat +atk/+hp
  | 'avengeSummonImps' // Endless Overseer: Avenge (X) — summon N Imps with Taunt + Ward
  | 'avengeSummon' // Dunkey: Avenge (X) — summon a cardId (golden → gilded), no immediate attack
  | 'deathrattleBuffNextSummon' // Wolvie: Echo — the next Beast summoned this combat gets +atk/+hp (one-shot)
  | 'deathrattleBuffRightmostSlot' // Right Hand Hank: Echo — carry-back buff the right-most Shop slot
  | 'goldSpentBuffRightmostSlot' // Feastmaster Vhal: every N Gold spent, buff the right-most Shop slot
  | 'battlecryGrantSpellPowerRun' // Set 2 — Coppercoat Spellsword (Choose One): permanently raise run-wide spell power
  | 'endOfTurnCopyNeighbour' // Set 2 — Bellringer Voss: every N turns, a plain copy of the board neighbour(s) to hand
  | 'deathrattleSummonRandomTier' // Set 2 — Gravelight Acolyte (Echo): summon N random minions of an exact tier
  | 'summonImps' // Set 2 — Imp Wrangler: summon N Imps
  | 'rallySummonImpBuffImps' // Errand Fiend (2026-08-04): Rally — summon an Imp AND enchant your Imps +1/+1
  | 'deathrattleSummonRandomHandMinion' // Rope Wrangler (2026-08-04): Echo — summon a random minion FROM YOUR HAND (consumed)
  | 'rallyImpsAttackNow' // Set 2 — Riot Caller (Rally): your N left-most Imps attack immediately
  | 'onTribePlayedConsumeShop' // Set 2 — Chipper: playing a Demon makes a friendly Demon eat a Shop minion
  | 'onImpDeathSummonImp' // Set 2 — Endless Overseer: your first N Imp deaths each summon an Imp
  | 'onImpAttackSummonCopy' // Set 2 — Malphas (Legion): an attacking Imp summons a copy
  | 'endOfTurnEndDemonsConsumeSides' // Set 2 — Malphas (Feast): the end Demons eat their side of the row
  | 'onShopRefreshConsume' // Set 2 — Hellrider: every N refreshes, eat the right-most Shop minion
  | 'avengeImproveSummonBuff' // Set 2 — Broodwright: Avenge improves its own summon grant
  | 'onSummonImpBuff' // Set 2 — Broodwright: an Imp you summon gains +X/+Y (improvable via summonBonus)
  | 'scFillWithImpsAndBuff' // Set 2 — Legion Shepherd: fill the warband with Imps, then buff Imps per one summoned
  | 'onImpAttackBuffImps' // Set 2 — Rouge Rogue: an Imp attacking buffs your Imps, escalating
  | 'battlecryConsumeShopRandom' // Set 2 — Cinder Clerk: Shout — consume a random Shop minion
  | 'consumeShopRightmost' // Set 2 — Demon Horse / Hellrider: consume the right-most Shop minion
  | 'battlecryTargetConsumesShop' // Set 2 — Appetite Agent: the TARGET consumes N Shop minions
  | 'buffShopPermanent' // Set 2 — Contract Butcher / Soul Defiler: permanent buff to minions bought from the Shop
  | 'buffRightmostSlotPermanent' // Set 2 — Market Tormentor (Shout): the right-most Shop SLOT is buffed for the run
  | 'endOfTurnGainRightmostShopStats' // Set 2 — (legacy Bob Blart) gain the right-most shop minion's stats (no consume)
  | 'onShopRefreshGainRightmostShopStats' // Set 2 — Hellrider: every N refreshes, gain the right-most Shop minion's stats (no consume)
  | 'avengeGrantRandomTribeMinion' // Set 2 — Grobbus: Avenge (X) — get a random minion of a tribe
  | 'scBuffTribe' // Set 2 — Transcendant: Start of Combat, buff every friendly minion of a tribe
  | 'scBuffRandomTribePerAle' // Set 2 — Drunken Oaf: SoC buff a random tribe minion, once + once per Ale cast this turn
  | 'spellCopyTargetExact' // Copycat (rune gift): an EXACT copy of the target friendly minion, to hand
  | 'endOfTurnBuffSpellsAndImps' // Set 2 — Void Curator: buff your spells and Imps
  | 'onConsumeGoldFlat' // Set 2 — (legacy) the first consume each turn pays a flat Gold amount
  | 'onOtherDemonConsumeEcho' // Set 2 — Avarice Incarnate: another Demon's Shop consume makes Avarice consume too + Gold
  | 'spellCastDemonConsumesShop' // Set 2 — Baal: every N spells, a friendly Demon consumes a Shop minion
  | 'endOfTurnNeighboursConsumeShop' // Set 2 — Feastmaster Vhal: adjacent minions each consume N Shop minions
  | 'onBattlecryBuffTribeAdjacentMore' // Karwind: Shout triggers buff your tribe; neighbours get more instead
  | 'onSummonTribeBuffThenDouble' // Set 2 — King Oona: a summoned Beast gets +1/+1, then doubles (gilded: triples)
  | 'onSummonTribeBuffImproveSelf' // Set 2 — Menagerie Mammoth: a summoned Beast gets +N Attack; the grant improves permanently
  | 'deathrattleImpsOverflowGrant' // Set 2 — Legion Shepherd: Echo summon Imps; each overflow buffs your Imps everywhere
  | 'scGrantRightmostEcho'         // Set 2 — Endless Overseer: graft an Imp-summoning Echo onto your right-most minion
  | 'endOfTurnSelfAndNeighboursConsume' // Set 2 — Feastmaster Vhal: this minion + adjacent Demons each eat
  | 'rallyBuffShopPermanent' // Set 2 — Demon Horse: Rally buffs Shop minions permanently
  | 'deathrattleBuffShopPermanent' // Set 2 — Malphas Echo: death buffs Shop minions permanently
  | 'rallyBuffSelf' // Set 2 — Cinderchef: Rally gains +atk/+hp
  | 'rallyCastNamedSpell' // Set 2 — Flamebeat Drake: Rally casts a named spell (Dragonflame)
  | 'onTribeAttackCastNamedSpell' // Set 2 — Warflame: a friendly Dragon attacks → cast a named spell (Dragonflame)
  | 'rallyGrantRandomShoutMinion' // Set 2 — Roarcollector: Rally adds a random Shout minion to hand
  | 'rallyTriggerTribeShouts' // Set 2 — Embercrest: Rally re-triggers your Dragon Shouts
  | 'spellBuffRandomPerTribe' // Set 2 — Dragonflame: buff a friendly, repeat per Dragon (random)
  | 'spellBuffHealthGrantFlurryDragon' // Set 2 — Flutter: +Health; a Dragon also gains Flurry
  | 'onRallyProcLeftmostEcho' // Set 2 — Hawkus: any friendly Rally triggers your left-most Echo
  | 'scTriggerLeftmostEchoes' // Set 2 — Spots: Start of Combat triggers your N left-most Echoes
  | 'spellCastBuffImps' // Set 2 — Rouge Rogue: a Shop spell buffs your Imps everywhere
  | 'rallyGrantSpellPower' // Set 2 — Chorus Drake: Rally raises Shop-spell power
  | 'onBattlecryBuffSelf' // Set 2 — Embermouth Whelp: a triggered Shout grows this minion
  | 'orbitBuffArriver' // Celestial ORBIT: buff the minion that just landed next to this one
  | 'orbitBuffRandomFriend' // Orbiting Familiar: buff a RANDOM friendly minion (not the arriver)
  | 'orbitSellValue' // Starpath Vendor (Dawn): this minion gains sell value, capped
  | 'orbitBuffAlignedCelestials' // Constellation Tender: buff your DAWN or DUSK Celestials
  | 'orbitBuffLowest' // Equinox Channeler: buff your lowest-Attack / lowest-Health minion
  | 'orbitGrantSpellPower' // Star Cartographer: improve your Shop spells
  | 'orbitCastSpell' // Worldseed Gardener: cast a named spell on the cadence
  | 'orbitCopyFirstSpell' // Spellwheel Savant (Dawn): copy the turn's first Shop spell
  | 'onOrbitBuffShopRightmost' // Astral Shopkeeper: after N orbits anywhere, buff the right-most Shop offer
  | 'onOrbitBuffAll' // Worldline Weaver: whenever an Orbit triggers, buff your whole board
  | 'onOrbitBuffShop' // Orrery: whenever ANOTHER Orbit triggers, buff the Shop
  | 'scGainKeyword' // Twilight Sentinel: Start of Combat — gain a keyword (align-gated halves)
  | 'orbitGainArriverBonus' // Horizon Collector: take the arriver's bonus stats (+ pass one axis along)
  | 'triggerAdjacentOrbits' // Astral Relay: fire the Orbits either side of this minion, with no arrival
  | 'orbitBuffCelestialsPerBuffStack' // Celestial Crucible: pay per stack of Shop buffs on the arriver
  | 'orbitDevourArriver' // Constellation Broker / Orrery: destroy the arriver, hand on its bonus stats
  | 'orbitBuffSelf' // Celestial ORBIT: this minion grows when something lands next to it
  | 'scBuffSelf' // Celestial — Daybreak Acolyte: Start of Combat, this minion gains stats (align-gated halves)
  | 'rallyBuffCelestials' // Celestial — Equinox Duelist (Dawn Rally): buff your Celestials
  | 'deathrattleBuffCelestials' // Celestial — Equinox Duelist (Dusk Echo): buff your Celestials
  | 'battlecryGetRubies' // Set 2 — Veinbreaker (Choose One): mint N Rubies
  | 'battlecryPlayRubiesAll' // Set 2 — Frenzied Excavator: play a Ruby on every friendly minion
  | 'spellCastBuffAll' // Set 2 — Scalechanter: each Shop spell gives your whole board +Attack
  | 'battlecryGrantShoutDragon' // Set 2 — Commander Warpath: get a random Dragon that has a Shout
  | 'onTribeAttackBuffAttacker' // Set 2 — Traveling Skald: a friendly Dragon that attacks gets +2/+1
  | 'onFriendlyDemonDamageBuffSelf' // Set 2 — Impossible Todd / Leech / Axeman: buff self (and maybe Imps) when a friendly Demon deals damage
  | 'scPlayRubiesSelfAndAdjacentTribe' // Set 2 — Kobe (Start of Combat): play N permanent Rubies on self + adjacent same-tribe
  | 'rallyPlayRubiesSelf' // Set 2 — Boulderdash (Rally): play N permanent Rubies on itself
  | 'rallyPlayRubiesAll' // Set 2 — Blazer (Rally): play a permanent Ruby on all your minions
  | 'onSellGetRubies' // Set 2 — Beggy (onSell): get N Rubies when this is sold
  | 'startOfTurnGetSpellImproveRubies' // Set 2 — Gemline Martyr (Start of Turn): get a Veinstorm + improve your Rubies
  | 'goldSpentBuffRandomTribe' // Set 2 — Billings (goldSpent): give N random friendly tribe minions +atk/+hp
  | 'onGainCardBuffTribe' // Set 2 — Gangplank (onGainCard): a card added to hand buffs a friendly tribe minion
  | 'minionSoldConsumeRightmost' // Set 2 — Grevlin & Co. (minionSold): every N sells, a Demon consumes the right-most Shop minion
  | 'onConsumeBuffShop' // Set 2 — Enigma (onConsume): when this consumes a minion, buff Shop minions permanently
  | 'deathrattleDamageAllExceptTribe' // Set 2 — Fel Spikes (Echo): deal N to all minions except FRIENDLY <tribe>
  | 'deathrattleGrantWardRandom' // Set 2 — Lastlight: Echo — give N friendly minions Ward
  | 'onConsumeSelfGrantSpell'
  | 'spellPlayRubiesAll' // Ruby Excavation: play N Rubies on every friendly minion
  | 'spellGainSpellPower' // Quick Study (spell): permanently raise the run's spell power
  | 'spellDecoyNextCombat' // Decoy Sigil: bank a next-combat Training Dummy slot-filler
  | 'spellStealShop' // Deep Delve Writ / Ironclad Requisition: take Shop offers into hand for free
  | 'spellTargetConsumesShop' // Cupcakes: the targeted Demon Consumes N random Shop minions
  | 'deathrattleSummonGolemsWithRuby' // Geode Guardian: summon N Gemheart Golems with Taunt + play Rubies on them
  | 'rallyCastShopBuffSpell' // Ashen Broodlord: Rally casts a Staff of Guel (permanent tavern-buy buff)
  | 'spellWeakenNextCombat' // Weaken: bank a next-combat "set a random enemy to 1 Health" // Set 2 — Ashen Broodlord: when THIS consumes, get a Shop spell
  | 'rallyBuffSelfPerTribe' // Packstrider: Rally — buff self per friendly tribe minion
  | 'avengeCopyLeftmostHandSpell' // Vault Curator: Avenge — copy the left-most spell in your hand
  | 'avengeBuffSpellPower' // Ashen Broodlord: Avenge — improve your spells (spell power)
  | 'onSpellCastFirstBuffSelf' // Ashscribe Whelp: the first spell each turn permanently grows this
  | 'onSpellCastSecondCopyFirst' // Spellkeeper Drake: your 2nd spell each turn copies the 1st
  | 'endOfTurnRecastFirstSpell' // Runic Archivist: End of Turn — re-cast this turn's first spell
  | 'battlecryGrantShoutExtra' // Orivax (Chorus): your Shouts trigger an additional time
  | 'battlecryGrantFirstSpellMult' // Orivax (Spellweave): first spell each turn casts N times
  | 'battlecryGrantTribeAndSpell' // Traveling Skald: Shout — a random tribe minion AND a random spell
  | 'battlecryGrantRandomSpell' // Hoard Chronicler: Shout — add random Tavern spells to hand
  | 'battlecryCopyCastSpell' // Recaller: Shout — copy the first/last spell you cast this turn
  | 'endOfTurnCopyCastSpell' // Spellvault Drake: End of Turn — the same copy, on the EoT beat
  | 'battlecryBuffOtherTribe' // Embermouth Whelp: Shout — buff one OTHER friendly of a tribe
  | 'deathrattleGrantMagnetic' // Deathrattle: add a random Magnetic minion to your hand after combat (Junkyard Titan)
  | 'deathrattleBuffSpellPower' // Deathrattle: permanently raise the run-wide spell power (+atk/+hp to spells), carried back (Skullblade)
  | 'deathrattleBuffCardTypeRunWide' // Deathrattle: permanently buff a card type run-wide (board/hand/future), carried back (Grave Knit)
  | 'deathrattleFillTribe'
  | 'avengeBuff' // Avenge (X): after X friendly deaths, buff self (combat)
  // Mechs — Divine Shield walls + shield-break payoffs (resolved in combat)
  | 'scTribeBuffPerAle' // Bucky: Start of Combat — buff your tribe +A/+H per Dwarven Ale cast LAST turn
  | 'scCastLeftmostHandSpell' // Quil: Start of Combat — cast the left-most spell in your hand on adjacent Beasts
  | 'deathrattleCastLastSpell' // Sporebat: Echo — cast the run's LAST-cast Shop spell on a random friendly Beast
  | 'rallyCastRandomTargetedSpell' // Badgington: Rally — cast a random targeted spell on another friendly Beast + copy to hand
  | 'deathrattleTriggerAdjacentRally' // Scavvers: Echo — trigger an adjacent minion's Rally
  | 'rubyBounceExtra' // Candle Conduit (passive marker): every Ruby played on your side bounces to 1 more minion
  // Trouble (passive marker, set 3): when a Ruby is cast on ANOTHER friendly minion, cast that many on
  // this. Scanned in `playRubyOn` like the bounce above, never dispatched through the bus.
  | 'rubySelfCastPerOtherRuby'
  | 'avengeCastRandomHandSpell' // Menagerie Mammoth: Avenge (N) — cast a random spell from your hand (kept, not consumed)
  | 'scGrantSpellCastExtra' // Runebloom Matriarch: Start of Combat — your Shop Spells cast N extra times this fight
  | 'scGrantShieldTribe'
  | 'scGrantReborn' // Gravewarden: Start of Combat — give a friendly Undead (not self) Rise; golden two
  | 'grantEquipment' // the `equip` factory: hands the player the Equipment named by `params.equipmentId`
  | 'equipmentRubyDuel' // Dueling Rubetta's — improve your Rubies, then Ruby your end Kobolds
  | 'equipmentBuffTarget' // Bloodpot: one Equipment TRIGGER — +atk/+hp onto the chosen friendly minion
  | 'equipmentCastSpell' // an EQUIPMENT SPELL: casts its named Shop spell through the real cast pipeline
  | 'equipmentSetStats' // Titan Hammer: SETS the target's stats rather than adding to them
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
  | 'spellBuffTargetAndNeighbours' // Beefy: buff the chosen minion AND its two neighbours
  | 'spellMarkPartingCry'
  | 'spellMarkClosedCasket'
  | 'spellSolidGround'
  | 'spellContainFirstEnemySummon'
  | 'spellStolenInitiative'
  | 'spellGambleTierPull' // Gamble: roll 1-6, get a random minion or spell of that tier
  | 'spellBuffTarget' // cast: buff the chosen target +atk/+hp (+ optional keyword: Spirit Fire, Bulwark)
  | 'spellBuffTargetPerGold' // Patch Job: buff the target +atk/+hp per N Gold spent this turn (recruit)
  | 'spellBuffAll' // cast: buff every friendly minion on the board (Growth) — scales with spell power
  | 'spellSetStats' // Perfect Vision: cast — set the target's stats to a fixed value (absolute, no scaling)
  | 'spellStealAdjacentRubies' // Ruby Transfer: the target steals adjacent minions' Ruby buffs (board or shop row)
  | 'spellAverageStats' // Common Ground: cast — average two friendly minions' Attack and Health
  | 'spellSwapStats' // Turnabout: cast — swap the target's Attack and Health
  | 'spellGoldIfLostLast' // Insurance Policy: cast — gain Gold if you lost your last combat
  | 'spellBuffTavern' // Apples (Choose One): cast — buff every current tavern offer (lost on refresh, kept on freeze)
  | 'spellBuffNextShop' // Apples (Choose One): cast — bank a buff folded onto the NEXT tavern roll's offers
  | 'spellPendingSCBuff' // Fleeting Vigor: cast — bank a one-shot Start-of-Combat buff for the next combat
  | 'spellGrantKeywordNextCombat' // Field Maneuvers / Last Stand / Executioner's Edge: grant a keyword for the next combat only
  | 'spellNextSellBonus' // Quick Sale: cast — the next minion sold this turn is worth more
  | 'spellRefreshToTribe' // Sigil of Kinship: cast — refresh the shop with minions of the target's type
  | 'spellRefreshTierUp' // Elevation Ritual: cast — refresh the shop with minions one tier higher
  | 'spellLayaway' // Layaway: cast on an offer — keep it through rerolls and cut its cost
  | 'spellReturnToHand' // Second Draft: cast — return a friendly non-Gilded minion to hand
  | 'spellTransformSameTier' // Strange Revision: cast — transform a friendly minion into a random same-tier one, keeping its bonus stats
  | 'spellMarkEnemyTaunt' // Marked Target: cast — the enemy's right-most minion gets Taunt next combat
  | 'spellSummonImpsNextCombat' // Open the Gates: cast — bank Imps to enter the next combat
  | 'spellBuffShopByRuby' // Veinstorm: cast — give every shop offer stats equal to your Rubies
  | 'spellBuffPerDragonPlayed' // Hoardflame: cast — +4/+4 plus +1/+1 per Dragon played this turn
  | 'spellDiscoverFromLastOpponent' // Rival's Reflection: cast — Discover a plain copy from the last opponent's warband
  | 'spellScoutNextOpponent' // Farseer's Report: cast — reveal 3 minions from the next opponent's warband
  | 'spellDemonConsumeFodder' // Consume: cast — a chosen Demon creates and eats N Fodder
  | 'deathrattleGrantRandomSpell' // Sporebat: Deathrattle — grant N random tavern-tier spells to the hand (Beast)
  | 'onDamagedGrantRefresh' // Gryphon: on taking damage, bank a free shop reroll (once per combat) (Beast)
  | 'summonBuffTribeImprove' // Mama Bear: on summoning a beast, buff it + improve the buff in/out of combat (Beast)
  | 'countTribeSummon' // Pack Leader: on summoning a tribe member, accrue a permanent per-instance tally (summonBonus)
  | 'spellPowerShift' // Power Shifter: Discover a new hero power, replacing the one you wield
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
  | 'spellTauntNextSummons' // cast: the first N minions summoned in the NEXT combat gain Taunt (Summoning Bulwark)
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
  | 'battlecryConductorAdjacent' // Conductor: Shout — give adjacent minions +2N/+3N; N snowballs per Conductor played (×2 gilded)
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
  | 'spellBuffLeftmost' // Set 2 — Champion's Ale: buff your left-most board minion
  | 'spellBuffRandomFriendlies' // Set 2 — Defensive / Bloody Ale: buff N distinct random friendly minions
  | 'spellGrantTopTypeMinion' // Set 2 — Reinforcing Ale: get a minion of your most common tribe
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
  | 'endOfTurnCastSpellOnSelf' // Arnold: EoT casts a named spell aimed at this minion (recruit)
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
  | 'getRubies' // Set 2 — Shout/Rally: mint N Rubies into hand
  | 'endOfTurnGetRubies' // Set 2 — Wardstone Jeweler: End of Turn, mint Rubies (Warding Ruby)
  | 'rubyStatGain' // Set 2 — "Your Rubies gain +X/+Y": raise the run's Ruby strength (hand + future)
  | 'scPlayRubies' // Set 2 — Start of Combat: play N Rubies on your [tribe] minions (permanent carry-back)
  | 'avengePlayRubies' // Set 2 — Avenge (X): play N Rubies on your [tribe] minions
  | 'goldSpentGetRubiesPlayOnTribe' // Set 2 — Mountainbond: every N Gold, mint Rubies to hand + play one on each tribe minion
  | 'cardsBoughtGetRubies'
  | 'grantRandomAle' // Set 2 Dwarves
  | 'battlecryBuffTribeOthersAttack' // Set 2 Dwarves
  | 'battlecryGainKeyword' // Set 2 Dwarves
  | 'goldSpentBuffTribeAttack' // Set 2 Dwarves
  | 'battlecryBuffTargetPerGoldSpent' // Set 2 Dwarves
  | 'endOfTurnBuffEndsTribePerCard' // Set 2 Dwarves
  | 'cardsBoughtGrantRandomSpell' // Set 2 Dwarves
  | 'battlecryGildTarget' // Set 2 Dwarves
  | 'goldSpentGrantTribeMinion' // Set 2 Dwarves
  | 'combatGrantAle' // Set 2 Dwarves (combat)
  | 'rallyGiveAttackToOthers' // Set 2 Dwarves (combat)
  | 'echoSummonCopyNoEcho' // Set 2 Dwarves (combat)
  | 'impInheritOnDeath' // Ashen Heir: bank a dying friendly Imp's stats
  | 'impInheritOnSummon' // Ashen Heir: the next Imp to arrive inherits the bank
  | 'echoCastRememberedSpells' // Runesnout Archivist: cast the whole journal on random friendly Beasts
  | 'echoResummonDeadBeasts' // Mossmemory Colossus: bring back the first 3 other dead Beasts
  | 'setArmor' // Mend (2026-08-07): set Armor to N — a floor, not a grant
  | 'echoSummonInheritAttackAndCharge' // Set 2 Dwarves (combat)
  | 'battlecryGainGoldNextTurn' // Set 2 Dwarves — Paymaster Pimm
  | 'cardsPlayedPlayRubies' // Set 2 Dwarves — Mountainbond
  | 'onTribeSummonedBuffTribe' // Set 2 Dwarves — Chef Gary Toast (watches OTHER plays, not its own Shout)
  | 'onSpellCastBuffOnePerTribe' // Set 2 — Fatecarver (Choose One A)
  | 'spellCastTriggerAdjacentShouts' // Set 2 Dwarves — High King Mykel // Set 2 — Hoardmaster Krik: every N cards bought, mint Rubies to hand
  | 'rallyGetRubies' // Set 2 — Rally: get N Rubies (carried back to hand after combat)
  | 'avengeRubyStatGain' // Set 2 — Avenge (X): buff your Rubies +X/+Y (carried back to rubyBonus)
  | 'scPlayRubiesPerBuy' // Set 2 — Frenzied Excavator: SoC play N Rubies per M cards bought this turn
  | 'avengeGetRubies' // Set 2 — Gemline Martyr: Avenge (X) get N Rubies
  | 'avengePlayRubiesLeftmost' // Set 2 — Gemline Martyr: Avenge (X) play N Rubies on your left-most minion
  | 'rubyPlayedBounce' // Set 2 — Resonance Idol: a Ruby played on this bounces to both adjacent minions
  | 'rubyPlayedGold' // Set 2 — Ruby Broker: a Ruby played on this gives Gold (capped per turn)
  | 'rubyGainedCast' // Set 2 — Candle Conduit: getting a Ruby casts one on a random friendly Kobold
  | 'damagedGainRubyBonus' // Set 2 — Faultline Scrapper: on-damage, buff your Rubies +X/+Y
  | 'damagedGetRubies' // Set 2 — Candleback Bulwark: on-damage, get N Rubies (capped per fight)
  | 'rallyRubyStatGain' // Set 2 — Crownvein: Rally buff your Rubies +X/+Y
  | 'rallyPlayRubiesTargets' // Set 2 — Crownvein: Rally play N Rubies each on the first M friends of a tribe
  | 'deathrattleRubyStatGain' // Set 2 — Alchemist Brisbane (Echo): on death, buff your Rubies +X/+Y
  | 'deathrattlePlayRubiesAdjacent' // Set 2 — Geode Guardian (Echo): on death, play N Rubies on each neighbour
  | 'deathrattlePlayRubiesTribe' // Set 2 — Kobebes (Echo): on death, play N Rubies on each friendly `tribe`
  | 'onTribePlayedBuffSelfPerSpell' // Set 2 — Herzog: +N/+N when you play a `tribe`; N = base + floor(spellsCast/per)
  | 'endOfTurnPlayRuby' // Set 2 — Alchemist Brisbane (EoT): play N Rubies on a random friendly Kobold
  | 'deathrattleSummonRubyStats' // Set 2 — Gemheart Carver: Echo summon a token with stats = its Rubies
  | 'rubyStatMultiplier' // Set 2 — Deepdelve Paragon: Rubies applied IN COMBAT are worth 2× (3× Gilded)
  | 'rubyCastConsumeShop' // Set 2 — Gemgorge Fiend: every N Rubies cast, Consume a Shop minion
  // --- RUNE-ONLY minion batch (2026-08-20). Every one of these rides `token: true` (forge-only). ---
  | 'onGetRubyDuplicate' // Gem Sage: getting a Ruby mints an extra copy (never re-fires `onGetRuby` — no recursion)
  | 'goldSpentScaleSelf' // Ancient Wanderer: HAS +A/+H per N Gold spent this RUN — a synced stored buff, not a per-step grant
  | 'buffShopOffersThisTurn' // Night Market Horror: after a buy, minions in the shop get +A/+H for THIS TURN
  | 'onSellDiscoverSingleton' // Traveling Salesman: selling this Discovers among minions you own exactly one copy of
  | 'onGainAleBuffSelf' // Kegheart Dwarf: gaining a Dwarven Ale buffs this body +A/+H
  | 'onBuyGrantSpellSameTier' // Ninefold Broker: after a buy, a random Shop spell OF THAT TIER — N charges per run
  | 'endOfTurnCopyLeftmostHandCard' // Stonehorn Archivist: every N turns, a plain copy of your left-most HAND card
  | 'endOfTurnTransformLeftTierUp' // Skybound Ascendant: End of Turn, the minion to its left becomes one tier higher
  | 'minionSoldDemonGainStats' // Arcane Behemoth: selling a Demon feeds it that body's stats
  | 'onFriendDeathGainEcho' // Echo Mimic (combat): another friendly dies → this gains that minion's Echo for the fight
  | 'avengeSummonAttackImproving' // Muster General (combat): Avenge summons an improving token that strikes at once
  | 'rallyDoubleSelf'; // Evolving Abomination (combat): Rally doubles this minion's stats, capped per combat

export interface EffectDef {
  on: GameEvent;
  do: EffectFactoryId;
  params?: Record<string, unknown>;
  /**
   * CELESTIAL gate — this effect only fires while its owner holds the named alignment. `'dawn'` fires for a
   * Dawn or ECLIPSE minion, `'dusk'` for a Dusk or Eclipse one; absent means "always", so every existing card
   * is unaffected. Eclipse getting BOTH halves falls straight out of that rule rather than needing a third
   * branch — which is the whole reason the gate lives on the effect instead of on a pair of card fields.
   */
  align?: 'dawn' | 'dusk';
  /**
   * COMBAT-ONLY gate (owner ruling 2026-08-20, Sunmane Herald): this effect fires in COMBAT only — the shop
   * dispatchers (`fireShopRally` / `socBoardEffects`) skip it entirely, so it never gets an End-of-Turn beat
   * and never counts as "a Rally/SoC to trigger" in the shop. Data-level, not a phase check inside a body:
   * Sunmane's viral Rally graft loops unboundedly under Rune of Lasting Cadence (every grant mints new
   * permanent ralliers), so the card is scoped out of the shop at the definition. Absent = fires in both
   * phases, so every existing card is unaffected.
   */
  combatOnly?: boolean;
}

/** Does an effect gated on `align` fire for a minion currently holding `have`? Eclipse counts as both sides;
 *  an ungated effect always fires; a gated effect on a board with no alignment context does not. */
export function alignAllows(effect: EffectDef, have: Alignment | undefined): boolean {
  if (!effect.align) return true;
  if (!have) return false;
  return have === 'eclipse' || have === effect.align;
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
  /** CELESTIAL — this card's text changes with its board ALIGNMENT (Dawn / Dusk / Eclipse). Drives the
   *  alignment HUD: the strip appears once any Celestial is on the board. See `Alignment`. */
  celestial?: boolean;
  /** Binary Star: Orbits on the minions ADJACENT to this one trigger an additional time. */
  orbitExtraAdjacent?: boolean;
  /** Astraeus, Totality: while THIS is Eclipsed, every Orbit on your board triggers an additional time. */
  orbitExtraBoard?: boolean;
  /** HENCHMAN — a hero-bound recruit (owner spec 2026-08-03). A minion like any other, but never offered
   *  in shops: it is reachable only through the hero that names it (`HeroDef.henchman` in @game/sim), at a
   *  Gold cost that falls each round (win −3 / loss −2). Global-registry doctrine, same as tokens. */
  henchman?: boolean;
  /** This card NEVER combines into a golden, however many copies you hold. For cards whose identity lives on
   *  the INSTANCE rather than the def: a Mage-Pup carries the spell it was taught (`taughtSpellId`), so three
   *  of them are three different cards wearing one id, and a triple would have to silently pick one spell and
   *  bin the other two (owner ruling 2026-07-24: Mage-Pups cannot be tripled in any circumstance). */
  noTriple?: boolean;
  /** A REWARD SPELL (Copycat): a token that is NOT a Shop spell — the reducer resolves it once, with no cast
   *  bookkeeping and no multipliers. Narrower than `token` on purpose: Implosion is a token AND a real
   *  Shop spell, so gating on `token` alone silenced its Nimbus doubling (caught by test 2026-08-02).
   *
   *  RENAMED from `gift` on 2026-08-26, when GIFTS became a real player-facing card class (see `gift`). The
   *  two are deliberately different: a reward spell counts as NO cast at all, while a Gift DOES count as a
   *  spell cast — it is only barred from being a *Shop* spell (no copies, no multipliers). */
  rewardSpell?: boolean;
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
  /** Porkbelly (set 3): when this attacks, it first summons a Gemheart Golem carrying this minion's Ruby
   *  tally (doubled when gilded), and the GOLEM takes the swing at Porkbelly's own target. If the golem
   *  fells it, Porkbelly settles — no swing, no retaliation. A card-def flag rather than an `onAttack`
   *  effect because it INTERRUPTS the exchange, which no effect factory can reach. */
  vanguardGolem?: boolean;
  /** This card makes whole FAMILIES of trigger fire extra times (Sylus, Drakko, Chronos, Uron). Resolved
   *  through `extraTriggerFires` — never by a hardcoded card-id check. */
  triggerMultiplier?: TriggerMultiplierDef;
  ascendInto?: string;
  /** Combat: this minion attacks immediately when summoned mid-fight, out of turn order — then joins the
   *  normal rotation (Twilight Whelp's 3/3 Whelp). Drained by the immediate-attack queue in `simulate`. */
  attackOnSummon?: boolean;
  /** A spell, not a minion: cast from hand for an effect, never takes a board slot. */
  spell?: boolean;
  /** A GIFT (owner design 2026-08-26). A Gift is a `spell` in every presentational sense — same plate, same
   *  art frame, cast from hand — and it DOES count as a spell cast (tallies, `spellCast` watchers, the
   *  Ruby+Spell umbrella). What it is NOT is a **Shop spell**: it never appears in the shop, is never offered
   *  by a spell Discover or a random-spell grant, and can never be duplicated by the spell-copy effects
   *  (Steward, Recaller, Recurrence, Mushy, the echo runes) or repeated by a cast multiplier. Gifts live
   *  outside every set manifest, so they are absent from `poolOf()` by construction; this flag is what the
   *  cast-time copy/repeat paths key on. Gifts are free (`cost: 0`) and arrive in hand from a rune or hero. */
  gift?: boolean;
  /** Warding Ruby (set 2): a Ruby that ALSO grants this keyword (Ward = `DS`) to the minion it's played on —
   *  permanent when cast in the shop phase (the reducer's play-Ruby branch bakes it onto the board card). */
  rubyGrantKeyword?: Keyword;
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
  /** Prismcaster (set 2): while this (× golden) is on the board, a Ruby played FROM HAND casts this many EXTRA
   *  times — its buff (and any `onRubyPlayed`) applies `1 + Σ rubyExtraCast` times. Recruit-only. */
  rubyExtraCast?: number;
  /** Heckbinder: passive Fodder aura — while this (or a host it magnetized into) is on the board, every
   *  NEW Fodder (tavern offer, conjure, steal) gets +attack/+health more (golden doubles). Recruit-only;
   *  folded into `cardBuff` via `fodderAuraLiveBonus`. */
  fodderAura?: { attack: number; health: number };
  /** Choose One: when played, the player picks one of these options; its `effects` then resolve
   *  as the card's Battlecry (in place of `onPlay`). Each option carries its own display text. */
  chooseOne?: { text: string; goldenText?: string; effects: EffectDef[]; target?: 'friendly' | 'any' }[];
  /** Set 2 — Orivax: when GOLDEN, a Choose-One applies ALL its options instead of the one picked ("Gilded:
   *  Gain both"). General flag, not Orivax-specific. Only meaningful with `chooseOne`. */
  chooseBothWhenGolden?: boolean;
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
  /** Discover a SHOP SPELL instead of a minion (Rift-Sunk Codex). When set, every other field is ignored —
   *  a spell Discover always draws from the tavern spell pool up to the current tier. */
  spell?: boolean;
  /** Hourglass Reserve: the picked minion is locked in hand until NEXT turn (can't be played this turn). */
  lockUntilNextTurn?: boolean;
  /** Funeral on Loan: the picked minion is BORROWED — playing it triggers its Echo (Deathrattle) and destroys
   *  it instead of putting it on the board. */
  borrowed?: boolean;
  /** Cap the offer tier at this value instead of the rift's normal maximum, so a Discover can reach a tier the
   *  player couldn't otherwise (Beyond the Summit: current + 1, "up to Tier 7"). */
  maxTier?: number;
  /** Keywords baked onto the PICKED card as it enters hand (Grave Invitation: an Echo minion that also gains
   *  Rise + Taunt). Applied once, at the pick — the same shape the quest rewards' `grantKeywords` uses. */
  grantKeywords?: Keyword[];
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
  // Set 2 (Kobold): `castRuby` counts RUBIES cast — its own meter, NOT `castSpell`. The two are deliberately
  // separate: a Kobold quest reading "Cast 8 Rubies" must not be filled by Shop Spells, and `castSpell`
  // (Shop Spells) must not be filled by Rubies. Advances by the multiplied cast count, so a Ruby that casts
  // 3 times moves the meter 3.
  | 'castRuby'
  // Set 2 (Demon): `shopStats` counts +Attack/+Health granted to SHOP minions — both direct offer buffs and
  // increases to the run's buy-bonus (which every future offer inherits). Advances by (attack + health).
  | 'shopStats'
  // Set 2 (Demon): `consumeShopMinion` counts SHOP minions your Demons eat — distinct from `consumeFodder`,
  // which counts set-1 Fodder. The two consume mechanics must not fill each other's quests.
  | 'consumeShopMinion'
  // HERO QUESTS (Fi / Coran, 2026-08-21): `journey` is the single shared counter every hero quest uses — the
  // "steps down the road" meter. It advances +1 for each MINION PLAYED from hand, each SPELL CAST, and each
  // SHOP UPGRADE. Deliberately ONE event for all ten hero quests: their objectives differ only in the number,
  // so the player never has to re-read what a given quest is asking for, only how far it is.
  | 'journey'
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
  | { kind: 'grant'; randomTribe?: Tribe; randomCount?: number; randomSpell?: number; /** Set 2 — N random Dwarven Ales (owner 2026-07-29: random, not a fixed trio). */ randomAle?: number; /** Set 2 — N Rubies, minted at the run's live `rubyBonus` like any other Ruby you're handed. */ randomRuby?: number; randomFilter?: 'shout' | 'endOfTurn' | 'echo' | 'rally' | 'attachment'; randomFilterCount?: number; randomFilterExactTier?: boolean; randomTier?: number; cards?: string[]; grantGolden?: string[]; grantKeywords?: Keyword[]; repeatInTurns?: number }
  | { kind: 'shoutDouble'; count: number }
  // A persistent "your <tribe> have +A/+H wherever they are" run aura (Den Marker) — folds into the tribe's
  // buy-time aura channel so current AND future minions of the tribe carry it (like Squirl Scout's board buff).
  | { kind: 'tribeAura'; tribe: Tribe; attack: number; health: number }
  // As `tribeAura`, but the aura GROWS: +stepAttack/+stepHealth each time `per` of `event` accrues over the run
  // (Pack Mentality: +3/+1, improve every 5 Beasts summoned in combat). Growth is tallied in settleCombat.
  | { kind: 'scalingTribeAura'; tribe: Tribe; attack: number; health: number; per: number; event: QuestObjectiveEvent; stepAttack: number; stepHealth: number }
  // Conjure `cards` to hand at the END OF EACH TURN, for the rest of the run (Feed the Alpha's recurring spell).
  /**
   * `everyTurns` (2026-08-20) is the general CADENCE field the recurring rewards were missing: absent = every
   * turn (what every existing user wants), `2` = every OTHER turn. Added because three runes in the 2026-08-20
   * batch are "every 2 turns, get a <minion>" and the alternative was three bespoke flags. NB: `turns` on
   * `recurringEndOfTurn` means something DIFFERENT (how many times it fires before stopping), which is exactly
   * why the cadence needed its own name rather than overloading that one.
   */
  | { kind: 'recurringGrant'; cards: string[]; everyTurns?: number }
  // ── 2026-08-19 owner rune batch ────────────────────────────────────────────────────────────────────────
  /** Rune of Basic/Epic <tribe>: every turn setup, conjure `count` random minions of `tribe` (the `runeDeep`
   *  shape, tribe-filtered instead of tier-filtered). Basic grants 1, Epic 2. */
  | { kind: 'runeTribeDrip'; tribe: Tribe; count: number }
  /** Rune of Hoardflame / Dragon Breath: THIS spell id casts an extra time. Card-scoped rather than global
   *  (the Ancient Runes / Spell Thesis shape), so only the granted spell multiplies — and because `spellCasts`
   *  is what the UI's ×N badge reads, the multicast modifier shows automatically while it is armed. */
  | { kind: 'runeSpellDouble'; spellId: string }
  /** Rune of the Glider: whenever you play a card, give a Dragon +atk/+hp. */
  | { kind: 'runeGlider'; attack: number; health: number }
  /** Rune of the Pendant: each turn setup, gild a random friendly minion of `maxTier` or below. */
  | { kind: 'runePendant'; maxTier: number }
  /** Rune of the War Drum: ONE Shout each turn triggers `extra` additional times (a per-turn charge). */
  | { kind: 'runeWarDrum'; extra: number }
  /** Rune of the Baller: each minion sold buffs your board, the magnitude climbing +`step` per sale and
   *  ALTERNATING Attack / Health (sale 1 = +1 Atk, sale 2 = +2 Health, sale 3 = +3 Atk, …). */
  | { kind: 'runeBaller'; step: number }
  | { kind: 'runeEmbers' }
  | { kind: 'runeRefreshments' }
  /** Rune of the Wishbone: your Hero Power triggers twice (gated to the powers that can express it). */
  | { kind: 'runeWishbone' }
  /** Rune of Might: every Shop spell you cast also casts Might of Aeon. */
  | { kind: 'runeMight' }
  /** Rune of Held Strength: your left- and right-most minions gain the stats of your left-most hand card. */
  | { kind: 'runeHeldStrength' }
  /** Rune of the Chipper Sticker: playing a Demon makes ANOTHER friendly Demon eat a Shop minion. A RECRUIT
   *  effect (the play happens in the shop), so it is its own reward rather than a `combatFlag`. */
  | { kind: 'runeChipperSticker' }
  // ── 2026-08-20 owner rune batch ────────────────────────────────────────────────────────────────────────
  /**
   * Rune of Living Magic (`uses: 1`) / Rune of Perfect Recall (`uses: 2`): after you cast a Shop spell, a COPY
   * of it lands in your hand — `uses` times per turn. ONE budget, parameterised: the two runes are the same
   * mechanism at different sizes, and holding both simply raises the ceiling.
   */
  | { kind: 'runeSpellEcho'; uses: number }
  /** Rune of Draconic Curiosity: taking a DRAGON out of a Discover hands you a random Shop spell. */
  | { kind: 'runeDraconicCuriosity' }
  /**
   * Rune of the Seasoned Ledger: every minion you PLAY from hand gains +attack/+health, and the grant itself
   * improves by the same amount every `per` minions played. The live magnitude is what the badge prints.
   */
  | { kind: 'runeSeasonedLedger'; attack: number; health: number; per: number }
  /** Rune of Echoed Arrival: every `per`-th Echo (Deathrattle) minion you play triggers its Echo on arrival. */
  | { kind: 'runeEchoedArrival'; per: number }
  /** Rune of Shared Spoils: a stat gain on your left-most Dwarf is mirrored onto your right-most Dwarf. */
  | { kind: 'runeSharedSpoils' }
  /** Rune of Heavy Payroll: whenever a DWARF arrives in your hand, your left-most minion gains +A/+H. */
  | { kind: 'runeHeavyPayroll'; attack: number; health: number }
  // Imp Census: permanently improve your Imps by +A/+H run-wide (bumps `impBuff`, so every current + future
  // friendly Imp inherits it). Repeats via the reward's `repeatInTurns` (folded through `multi`).
  | { kind: 'impAura'; attack: number; health: number }
  // Den Marker: a run-wide Den-Mother-style aura — every Beast you play/summon gains +attack/+health, and that
  // magnitude improves by +step/+step every `per` Beasts. Armed as `RunState.denMarker`, applied in the onSummon path.
  | { kind: 'beastPlayBuff'; attack: number; health: number; step: number; per: number }
  // Arm a run-wide combat modifier consumed by `simulate()` (see QuestCombatMods): Blood Trail, Echoing Coop,
  // Law of Teeth, The Old Hunt. `amount` parameterizes the flag where it needs a magnitude (Old Hunt's aura step).
  | { kind: 'combatFlag'; flag: QuestCombatFlag; amount?: number }
  /** "Your <tribe> Rallies and Slaughters trigger an additional time" — the tribe-scoped twin of the Beast-only
   *  `lawOfTeeth` flag, so any tribe's version is data rather than a new hard-coded flag. */
  | { kind: 'tribeRallySlaughterExtra'; tribe: Tribe }
  /** "Your Dwarven Ales trigger an additional time" — run-wide, additive with Edward Keg-hands. */
  | { kind: 'aleExtraCasts'; amount?: number }
  /** "Every N Gold spent, give your <tribe> +X/+X" — threshold-based and tribe-scoped. */
  | { kind: 'questGoldTribeBuff'; tribe: Tribe; per: number; attack: number; health: number }
  /** "Give your Rubies +X/+X permanently" — raises the run's Ruby STRENGTH (`rubyBonus`), so every Ruby still in
   *  hand AND every future one is minted stronger. Rubies already CAST keep the stats they landed with. */
  | { kind: 'rubyStatGain'; attack: number; health: number }
  /** "Your Rubies cast an additional time" — run-level extra casts, additive with Prismcaster. `scope`
   *  `firstEachTurn` limits it to the turn's FIRST Ruby (Gem Circuit); `always` applies to every Ruby
   *  (Unstable Riches). */
  | { kind: 'rubyExtraCasts'; amount: number; scope: 'always' | 'firstEachTurn'; /** With `firstEachTurn`:
   *  how many leading Ruby PLAYS each turn get the extra cast (default 1 — Gem Circuit; Resonance uses 2). */ firstN?: number }
  /** "Give Shop minions +X/+X" — one-shot, into the same `tavernBuyBonus` channel the Staff of Guel uses, so a
   *  quest and a card buffing the shop are the same mechanic. */
  | { kind: 'shopBuff'; attack: number; health: number }
  /** Bane's Presence: every `per` Shouts you trigger, buff the shop +X/+X. The remainder banks across turns. */
  | { kind: 'shopBuffPerShouts'; per: number; attack: number; health: number }
  /** Endless Inventory: after each shop refresh, buff the shop +X/+X — and improve THAT by +step/+step every
   *  `per` refreshes, so the reward compounds over a roll-heavy run. */
  | { kind: 'shopBuffOnRefresh'; attack: number; health: number; step: number; per: number }
  /** The Company Store: your Shop spells cost `cost` less for the rest of the run (the spell-side twin of
   *  `minionCost`). Feeds `spellCostMod`, which Lazarus also writes to, so the two stack. */
  | { kind: 'spellCost'; cost: number }
  /** The Endless Verse: the first spell each turn casts twice — and triggering `per` Shouts RE-ARMS it within
   *  the same turn, so a Shout-heavy board can spend the doubler more than once a turn. */
  | { kind: 'endlessVerse'; per: number }
  /** Motherlode: whenever you GET a Ruby, cast a copy of it on `count` random friendly Kobolds. */
  /**
   * A THRESHOLD rune: every `per` of `meter`, do one thing. One reward kind rather than a family of near-identical
   * ones, because the runes in this group differ only in which meter they watch and what they pay — Cindergem
   * (3 Rubies → Imps +2/+2), Infernal Ink (3 spells → Shop +3/+3), Overtime (15 Gold → an Ale), the Chorus
   * (3 Shouts → a spell), the Long Shift (3 buys → a spell), the Showcase (10 Gold → the right-most offer +4/+4).
   *
   * The remainder BANKS across transactions, like every other threshold in the game. `oncePerTurn` caps payouts
   * at one per turn (the Merchant's Chorus).
   */
  | { kind: 'runeThreshold'; meter: 'gold' | 'spellCast' | 'spellCastNonAle' | 'castRuby' | 'cardsBought' | 'cardsPlayed' | 'playDragon' | 'shout' | 'consume'; per: number;
      grantSpell?: number; grantAle?: number; grantRuby?: number;
      /** Rune of the Deep Feast: hand over these exact card ids when the meter trips (the `grant` reward's
       *  `cards`, on a meter). Overflow-safe like every other earned reward. */
      grantCards?: string[];
      /** Rune of the Gilded Ledger: CAST that many random stat-granting Shop spells when the meter trips. */
      castStatSpell?: number;
      /** `tribe` targets a tribe wherever it is (board + hand) — Compounding Wages' Dwarves. `step` makes the
       *  payout ESCALATE: every payout adds `step` to the grant, so the rune improves itself. */
      buff?: { target: 'imps' | 'shop' | 'shopRightmost' | 'shopTurn' | 'spells' | 'tribe'; tribe?: Tribe; attack: number; health: number; step?: { attack: number; health: number } };
      /** Rune of the Bubble Crown: pay ONCE ever, then the meter stops (its x/N counter stops with it). */
      once?: boolean;
      /** Rune of Gemspam: play a Ruby on EVERY friendly minion when the meter trips. */
      rubyAll?: boolean;
      /** Rune of the Gem Dividend: pay Gold into NEXT turn's bank when the meter fills. */
      grantGoldNextTurn?: number;
      /** The meter is a per-TURN window (no remainder carries across the rollover). */
      resetEachTurn?: boolean;
      oncePerTurn?: boolean }
  /** Rune of the Brokerage: your Ruby Brokers lose their per-turn cap. */
  | { kind: 'runeBrokerage' }
  /** Rune of the Shared Table: every Dwarven Ale cast gives one friendly minion of each type +X/+X. */
  | { kind: 'runeSharedTable'; attack: number; health: number }
  /** Rune of Redirection: a Ruby played on your left-most minion also casts on your right-most. */
  | { kind: 'runeRedirection' }
  /** Rune of Distillation: a spell cast on a SHOP minion also casts on your left-most board minion. */
  | { kind: 'runeDistillation' }
  /** Rune of Liquidation: selling a minion gives its BONUS stats to the right-most Shop minion. */
  | { kind: 'runeLiquidation' }
  /** Rune of Facetwright: your Facetwright's Choice casts give BOTH halves instead of one. */
  | { kind: 'runeFacetwright' }
  /** Rune of Duplication: after you forge your Epic Rune, this becomes a copy of it — its reward applies a
   *  second time. */
  | { kind: 'runeDuplication' }
  /** Rune of Profit Sharing: whenever you GAIN Gold, give your <tribe> +X/+X wherever they are. */
  | { kind: 'runeProfitSharing'; tribe: Tribe; attack: number; health: number }
  /** Rune of the White Wolf: once per turn, buying a Shop spell teaches it to a Mage-Pup. */
  | { kind: 'runeWhiteWolf' }
  /** Rune of the Spellstone: Rubies you cast count as Shop spells. */
  | { kind: 'runeSpellstone' }
  /** Rune of Investment: selling a minion mints `count` Rubies. */
  | { kind: 'runeSellRubies'; count: number }
  /** Rune of the Open Market: the FIRST Shop minion your Demons Consume each turn buffs the Shop +X/+X
   *  permanently. Shares the Bottomless Banquet trigger, not its effect. */
  | { kind: 'runeOpenMarket'; attack: number; health: number }
  | { kind: 'motherlode'; count: number; /** Absent = ANY friendly minion (Rune of the Motherlode); set = tribe-scoped (the quest). */ tribe?: Tribe }
  /** Bottomless Banquet: the first Shop minion your Demons Consume each turn, they Consume another. */
  | { kind: 'consumeDoubleFirstEachTurn' }
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
  /** `turns` (optional) BOUNDS the recurrence: it fires that many End-of-Turns and then stops, instead of
   *  lasting the run. Absent = forever, which is what every effect but Quick Study wants. */
  | { kind: 'recurringEndOfTurn'; turns?: number; effect: 'triggerLeftmostShout' | 'grantRandomShout' | 'grantRandomAttachments' | 'buffMechsPerAttachment' | 'runeSpending' | 'runeAction' | 'triggerLeftmostEcho' | 'weldMoneyBotsEdgeMechs' | 'undeadPlayedAtk' | 'attachClingDrones' | 'recastFirstSpell' | 'grantAles' | 'grantAles3' | 'quickStudy' | 'copyFirstSpell' | 'grantRuby' | 'grantRuby2' | 'demonEatsRightmostShop' | 'grantFacetwright' | 'lassoing' }
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
  // Rune of the Long Shift: at the start of each turn, Discover 2 Shop spells.
  | { kind: 'runeLongShift' }
  | { kind: 'runeHappyBirthday' } // GIFTS: a random Gift now, then another every 2 turns
  | { kind: 'runeMerryChristmas' } // GIFTS (epic): Discover a Gift now, then every Start of Turn
  // Rune of Bartering: your Shout (Battlecry) minions sell for 2 Gold.
  | { kind: 'runeBartering' }
  // Rune of Twin Gilding: you only need 2 copies of a card to Gild (triple) it.
  | { kind: 'runeTwinGilding' }
  // Rune of the Den Mother: your Den Mother also buffs herself when she buffs another Beast.
  | { kind: 'runeDenMother' }
  // Rune of the Display Case: your Market Tormentors also enchant the LEFT-most Shop slot (permanently).
  | { kind: 'runeDisplayCase' }
  // Rune of Blart: your Bob Blarts gain the stats of BOTH the left and right-most Shop minions at End of Turn.
  | { kind: 'runeBlart' }
  // Rune of the Vaultkeeper: your Vaultkeepers also give their per-Dragon grant to an adjacent minion.
  | { kind: 'runeVaultkeeper' }
  // Aug-11 economy runes (recruit-phase flags).
  | { kind: 'runeSellersMarket' }   // whenever you sell a minion, give your minions +4/+3
  | { kind: 'runeFreshPages' }      // Discover a Shop spell, repeated every Start of Turn
  | { kind: 'runeStrangeCaravan' }  // Start of Turn: get a random minion from a type you do NOT control
  | { kind: 'runeWindowShopping' }  // your first 4 Refreshes each turn are free
  | { kind: 'runeOpenEnrollment' }  // after you Refresh, the Shop offers an extra minion of your most common type
  | { kind: 'runeShopkeep' }        // reduce your Shop's upgrade cost by 3; End of Turn: repeat
  | { kind: 'runeTradeIn' }         // after your first sale each turn, your next minion of that type costs 1 less
  | { kind: 'runeRestocking' }      // the first minion you buy each turn refills its slot with a same-Tier 1-Gold minion
  | { kind: 'runeCollector' }       // buy 3 different types in a turn → Discover a minion of one of them (once/turn)
  | { kind: 'runeBargainBin' }      // your first Refresh each turn fills the Shop with 1-Gold minions that sell for 0
  // Rune of Scale (Epic): every time you spend Gold, give `count` random board minions +attack/+health.
  | { kind: 'runeScale'; count: number; attack: number; health: number; /** Gold threshold: pay once per `per` Gold, banking the remainder. Absent = once per spend transaction. */ per?: number }
  // Rune of Copies (Epic): copy a random board minion to your hand now, and again at the start of every turn.
  | { kind: 'runeCopies' }
  // Rune of Tempering: the first Attachment you play each turn also gives that minion Ward.
  | { kind: 'runeTempering' }
  // Rune of Replication (Epic): the first Attachment you play each turn also welds a copy onto your leftmost Mech.
  | { kind: 'runeReplication' }
  // Rune of Refrain: after your third Shout minion each turn, the first Shout you played returns to your hand.
  | { kind: 'runeRefrain' }
  | { kind: 'runeCoffers' } // End of Turn: max Gold +1
  | { kind: 'runeEnchantment' } // per Shop-spell cast: your minions +1/+1 (combat casts give +2/+2)
  | { kind: 'runeCrown'; per: number; attack: number; health: number } // after `per` casts, spells give +A/+H extra
  | { kind: 'runeLapidary' } // End of Turn: a Ruby on one friendly minion of each type
  | { kind: 'runeLastingCadence' } // End of Turn: trigger ALL your Rally effects (one beat each)
  | { kind: 'runeCombatProwess' } // your Start of Combat effects also trigger at End of Turn (one beat per effect)
  | { kind: 'runeDeep'; tier: number } // each turn: a random minion of `tier`
  | { kind: 'runeGuidingCandle'; count: number; tier: number } // the first `count` refreshes each turn are all `tier`
  | { kind: 'runeMuster' } // one free refresh stocked with plain copies of your board
  | { kind: 'runeFoundry'; per: number } // every `per` minions sold: a random Dragon
  | { kind: 'runeCorruptedTome' } // a Triple Reward grants two instead
  | { kind: 'runeGroveweaver' } // a Groveweaver's summon-buff also lands on itself
  | { kind: 'runeSharedPour' } // the first Ale each turn casts an extra time
  | { kind: 'runeAftermarket' } // the first sell each turn feeds the current Shop
  | { kind: 'runeSpellhide' } // the turn's first stat spell on a Beast re-casts at Start of Combat
  | { kind: 'runeSpellmarket' } // …and also feeds the right-most Shop minion
  | { kind: 'runeLastWord' } // selling a Dragon with a Shout triggers it first
  | { kind: 'runeRunicHoard' } // a copied Shop spell gives your Dragons +1/+1
  | { kind: 'runeBanquetHall' } // the turn's first Shop-buffed buy feeds one minion of each type
  | { kind: 'runeCrucibleChoir' } // End of Turn: the left-most Shout, then the left-most Echo
  | { kind: 'runeFullMeasure' } // Baby Gastrid also grants Attack, 1:1 with the Health
  | { kind: 'runeMountainTrade' } // a Mountainbond Ruby play also hands over an Ale
  | { kind: 'runeOpenAppetite' } // Appetite Agent's aim loses its Demon restriction
  | { kind: 'runeBroodmaster' } // a Broodwright's Imp buff also lands on itself
  | { kind: 'runeSecondLife' } // your Scavvers carry Taunt + Rise
  | { kind: 'runeSharedReflection' } // Mirrorwing's first spell each turn also casts on adjacent Dragons
  | { kind: 'runeUnbrokenVein' } // Veinbreaker applies both Choose One options
  | { kind: 'runeLivingGrowth' } // each Growth Mushy creates improves Growth permanently
  | { kind: 'runeHoardcalling' } // the first Dragon Shout each turn grants a Shop spell
  | { kind: 'runeConduit' } // every Ruby played bounces one extra time
  | { kind: 'runeVault' } // 10 Gold at shop tier 5
  | { kind: 'runeAltar'; goldPer: number } // sell the whole board, +goldPer each
  | { kind: 'runeLorekeeping' } // targeted Shop spells give the target an extra +4/+4
  | { kind: 'runeThrift' } // stat-granting Shop spells cost 2 less
  | { kind: 'runeFlagship' } // per Shop-spell cast: Dwarves +2/+2
  | { kind: 'runeBrew' } // per Gold spend: a random friendly Dwarf +4/+3
  | { kind: 'runeEvolution'; tier: number } // transform the board into random minions of `tier`
  | { kind: 'runeTranscription'; count: number } // the next N buys each come with a free copy
  | { kind: 'runeTreasureMap'; turns: number; gold: number } // countdown payout
  | { kind: 'runeGoldenSplinter'; at: number; tier: number } // once: golden T`tier` minion at `at` Gold
  // Rune of Transfusion (Epic): whenever a Demon Consumes Fodder, your leftmost minion also gains its stats.
  | { kind: 'runeTransfusion' }
  // Rune of Endless Appetite (Epic): the first Fodder Consume each turn — all your other Demons Consume a copy.
  | { kind: 'runeEndlessAppetite' }
  // Rune of the Conductor (Epic): at the start of every shop, trigger all your End of Turn effects.
  | { kind: 'runeConductor' }
  | { kind: 'runeMatriarch' } // Runebloom Matriarchs trigger twice
  | { kind: 'runeContraband' } // first Ruby/turn → an Ale; first Ale/turn → a Ruby
  | { kind: 'runeCadence' } // buy-a-minion ↔ cast-a-spell alternating 1-Gold discounts
  | { kind: 'runeGemscript' } // first spell/turn → Ruby power +1/+1; first Ruby/turn → spell power +1/+1
  | { kind: 'mintRubies'; count: number; attack: number; health: number } // Gemcutting: Rubies at a FIXED stat line
  | { kind: 'runeSecondPath' } // Discover 2 Tier 6 minions, stats set to 20/20
  | { kind: 'runeChampion' } // Discover a T4, T5 and T6 minion of the board's dominant tribe
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
  | { kind: 'discover'; tier?: number; /** Rune of the Catacomb: narrow the offer to Echo (Deathrattle) minions. */ filter?: 'battlecry' | 'deathrattle'; /** Rune of Rising Echoes: the pick arrives carrying these keywords. */ grantKeywords?: Keyword[] }
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
  /** Rune of the Wheel (2026-08-21): shop minions have a STANDING +A/+H aura, and the aura's magnitude grows
   *  +step/+step once every `per` refreshes. Distinct from `shopBuffOnRefresh` (Endless Inventory), which
   *  grants a NEW permanent buff on EVERY refresh — the rune shipped on that kind and stacked +2/+2 per
   *  refresh, ~5× its printed text. */
  | { kind: 'shopAuraGrowing'; attack: number; health: number; step: number; per: number }
  // ── Hero quest rewards (Fi / Coran, 2026-08-21) ──────────────────────────────────────────────────────
  /** Spare Forge / Runic Passage: hand over a random rune of that rarity IMMEDIATELY — no forge, no choice,
   *  no Gold. Distinct from `scheduleRuneforge` (which opens a picker next turn) and `openEpicRuneforge`. */
  | { kind: 'grantRune'; rarity: 'basic' | 'epic' }
  /** First Pick: the first shop MINION you buy each turn is free — the same channel the Freedom rift uses
   *  (`freeBuyUsedThisTurn`), so the two can never double-charge or double-refund. */
  | { kind: 'freeFirstBuy' }
  /** Open Road / Summit Passage: Tier 7 is unlocked for the rest of the run (sets `tier7Access`, the flag
   *  `hasTier7Access` already reads). */
  | { kind: 'tier7Access' }
  /** Gilded Shortcut: Gilding needs only `copies` copies instead of three. Read through `gildCopiesNeeded`. */
  | { kind: 'gildCopies'; copies: number }
  /** Summit Passage: raise the Shop tier by `by` right now, FREE, honouring the run's ceiling (including a
   *  Tier 7 unlocked in the same `multi` reward). */
  | { kind: 'upgradeShopTier'; by: number }
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
  // 2026-08-19 rune batch: Ruins = a friendly Demon dealing damage buffs your minions (combat-only unless the
  // body is Engraved); Golems = a dying friendly Kobold summons a Gemheart Golem carrying its Rubies;
  // EngravingGems = Rubies applied in combat carry back to the run board.
  | 'runeRuins' | 'runeGolems' | 'runeEngravingGems'
  | 'runeHerdingHorn' // every Rally triggered banks a free Shop refresh
  | 'runeDeathtouchedApple' // a minion that Rises gets Rise back (2 per combat)
  | 'runeStokedMenagerie' // SoC: controlling every active type doubles 3 random minions
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
  | 'runeRebirth' | 'runeAftershocks' | 'runeEngraving' | 'runeUnderdog' | 'runeGemGolem' | 'runeChef' | 'runeCarrionCoin' | 'runeFiveBanners' | 'runeCenterline' | 'runeSecondLitter' | 'runeDragonscale' | 'runeTemperedTime' | 'runeSavagery' | 'runeCrucible' | 'runeHerald' | 'runeUndertow' | 'runeMirrorMarch' | 'runeTrophy'
  // Aug-11 minion-grant runes: Wrangler (Imp Wrangler's imps get Ward+Taunt), Living Geode (Geode Guardian's
  // Gemheart Golems get Ward), Dawnclaw (Dawnclaws also fire their Echo at Start of Combat), Sylus (Sylus
  // doubles its own Health at Start of Combat).
  | 'runeWrangler' | 'runeLivingGeode' | 'runeDawnclaw' | 'runeSylus'
  // Aug-12 Beast batch: Jungle (a summoned Beast doubles its Health), Burrow (first Echo-Beast death each
  // combat is resummoned without its Echo), Beastial Swarm (your Beasts gain +N/+N on each friendly Beast death;
  // Avenge(2) raises N permanently).
  | 'runeJungle' | 'runeBurrow' | 'runeBeastialSwarm' | 'runeZoo'
  // Rune of the Old Pack: the first Beast you resummon each combat returns with its FULL stats.
  | 'oldPack'
  // The Sealed Vault: your FIRST Avenge each combat triggers twice — the once-per-fight sibling of `runeFury`
  // (which doubles every Avenge). Tracked per side, so a served enemy holding it gets its own single re-fire.
  | 'avengeFirstDouble'
  // Set 2 quests: candlelightToll = a friendly Kobold dying grants you a Ruby; gemheartCharge = Gemheart
  // Golems attack the moment they're summoned; burningLegion = an attacking Imp summons a copy of itself
  // (bounded by `burningLegionUses`, since an unbounded version fills the board on the first swing).
  | 'candlelightToll' | 'gemheartCharge' | 'burningLegion'
  // Rune batch 3: vanguard = SoC give your 3 left-most Critical Strike + Ward; finality = your LAST minion
  // dying summons 7 Imps with Ward (the Warded sibling of pitWithoutEnd); hatchery = Echo summons enter
  // +3/+3 with Taunt.
  | 'runeVanguard' | 'runeFinality' | 'runeHatchery'
  // Avenge runes (batch 5), all riding the existing `runeAvenge` helper: lastCall = an Ale to hand;
  // cinderLedger = improve your Imps run-wide; procession = double your right-most minion's stats.
  | 'runeLastCall' | 'runeCinderLedger' | 'runeProcession'
  // Rune of Gemstorm: Avenge (2) — play 2 Rubies on each friendly Kobold.
  | 'runeGemstorm'
  // Batch 7: bloodAndCoin = every N friendly deaths banks Gold for next turn; wildHunt = a Beast attacking
  // pumps a run-wide Health aura, escalating; livingTreasure = your Gemheart Golems gain Rise.
  | 'runeBloodAndCoin' | 'runeWildHunt' | 'runeLivingTreasure'
  // remains = every 5 combat summons buffs the Shop; reinvestment = after combat, the Shop gains per summon.
  | 'runeRemains' | 'runeReinvestment'
  // Rune of the Hunting Bell: Avenge (3) — trigger your left-most Rally, free.
  | 'runeHuntingBell'
  // Batch 10: brood = while there is room, summon a Warded+Taunt Imp (bounded); livingEchoes = the same shape
  // with a Sunmane Herald that strikes on arrival; warChorus = your first Rally each combat fires your
  // left-most Shout.
  | 'runeBrood' | 'runeLivingEchoes' | 'runeWarChorus'
  // Rune of the Warpath: the left-most minion's attack chains into the right-most's.
  | 'runeWarpath'
  | 'runeEmberline' // the first Imp to die each combat feeds the next one summoned
  | 'runeAshenPayroll' // 3 Imps summoned in a combat pays Gold next turn (once per combat)
  | 'runeBackbeat' // the first Echo each combat also fires the left-most Rally
  | 'runeSpareChair'
  | 'runeAncestralRoar' // your Dragons with a Shout gain "Echo: trigger this minion's Shout"
  | 'runeRubyShrapnel' // a dying Ruby-buffed minion splits its Ruby stats among the survivors
  | 'runeSharedScripture'
  | 'runeMoonhowl' // Mage-Pups gain "Echo: cast the Shop spell this learned"
  | 'runeFloodedVault' // Water Dragon's Avenge also casts the left-most hand spell, unconsumed
  | 'runeBattleRefraction'
  // Rune of the Mammoth: Menagerie Mammoths give Health too (1:1 with the Attack grant).
  | 'runeMammoth'
  // foodChain = your first summon inherits your left-most Demon's stats; attackingGems = every friendly attack
  // plays a Ruby on your whole board.
  | 'runeFoodChain' | 'runeAttackingGems'
  // Rune of Overflow: a summon that does not fit permanently buffs your whole warband.
  | 'runeOverflow'
  // Rune of Counterpoint: a friendly death sends your left-most minion in for a free swing.
  | 'runeCounterpoint'
  // ── 2026-08-20 rune batch ──
  // returningPack = every 6 Beasts you summon in combat hands you a random Beast next shop;
  // graveRefreshment = every 2 friendly Echoes triggered banks a free Shop refresh;
  // shiftingFacets = Avenge (3) improves your Rubies on ONE axis, alternating every turn;
  // deepeningVein = Avenge (3) improves your Rubies +1/+1 AND plays a Ruby on every friendly Kobold;
  | 'runeReturningPack' | 'runeGraveRefreshment' | 'runeShiftingFacets' | 'runeDeepeningVein';
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
  /** Gorun's Blade Mastery: a friendly attack grants the ATTACKER +3 Attack for the rest of the fight, and the
   *  grant improves by +3 for every 8 attacks made. `attacks` is the run-lifetime count BEFORE this fight, so
   *  the grant keeps stepping up mid-combat as the count rises past each multiple of 8 — the same total the
   *  shop panel prints. Per side: a served rival running Gorun brings its own offset through its snapshot. */
  bladeMastery?: { attacks: number };
  /** Cindara's Hoard: Avenge (4) summons a Whelp that attacks immediately, then improves EVERY living Whelp on
   *  that side by +2/+2 — retroactively, so two Whelps are never different sizes (owner ruling 2026-08-23).
   *  The value here is the banked improvement above the token's 1/1 base at the START of the fight; growth
   *  during the fight is carried back via `playerHoardGain`. Per side, like the Avenge runes. */
  hoard?: { attack: number; health: number };
  /** Sable's Soulbind: two bound player uids. A stat gain on either is mirrored onto the other, in full and
   *  ONCE (no echo back — owner ruling 2026-08-16). The bond lasts a single turn, so this is present only for
   *  the fight it was forged for; the recruit phase mirrors the same rule through `addBuff`. */
  soulbind?: { a: string; b: string };
  /** Flash's armed claim. Resolved INSIDE the fight so the copy flies to hand as it is earned, rather than
   *  materialising at resolution. `first` grants on the opening kill; `last` can only be known once the fight
   *  ends, so it grants at the final step — still within the replay, so it animates like any other grant. */
  flashPick?: 'first' | 'last';
  /** Rune of the Wishbone on Flash: how many copies the claim grants (2 while armed, else 1). */
  flashCopies?: number;
  /** Blood Trail: at Start of Combat your leftmost minion gains "Slaughter: get a random Beast" for this fight. */
  bloodTrail?: boolean;
  /** Echoing Coop: at Start of Combat, trigger every one of your minions' Echoes (Deathrattles) once. */
  echoingCoop?: boolean;
  /** Law of Teeth: your Beasts' Slaughters (on-kill) AND Rallies (on-attack) each trigger one extra time. */
  lawOfTeeth?: boolean;
  /**
   * The TRIBE-parameterised twin of `lawOfTeeth` ("your <tribe> Rallies and Slaughters trigger an additional
   * time"). Added because War Council needed the Dwarf version and `lawOfTeeth` is hard-gated on
   * `isBeast(attacker)` — reusing it would have silently granted BEAST triggers on a Dwarf quest. Any future
   * tribe gets this for free as data.
   */
  tribeRallySlaughterExtra?: Tribe;
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
  /** The Sealed Vault: the first Avenge each combat re-fires (once per side per fight). */
  avengeFirstDouble?: boolean;
  /** Rune of the Vanguard: Start of Combat, give your 3 left-most minions Critical Strike and Ward. */
  runeVanguard?: boolean;
  /** Rune of Finality: how many WARDED Imps your last minion's death summons. */
  runeFinality?: number;
  /** Rune of the Hatchery: Echo summons enter with +attack/+health and Taunt. */
  runeHatchery?: { attack: number; health: number };
  /** Rune of Last Call: Avenge (3) — a random Dwarven Ale to hand. */
  runeLastCall?: boolean;
  /** Rune of the Cinder Ledger: Avenge (3) — improve your Imps by +6/+6 wherever they are. */
  runeCinderLedger?: number;
  /** Rune of the Procession: Avenge (4) — double your right-most minion's stats. */
  runeProcession?: boolean;
  /** How many COPIES of each rune-granted combat flag the run holds (Rune of Duplication). 1 = the normal
   *  single copy and is what an absent entry means, so every existing consumer reads correctly untouched.
   *  Only the DISPATCHERS consult it — a duplicated boolean rune fires its effect twice rather than setting
   *  the same `true` twice, which is why Duplication used to be a no-op on 23 combat-flag runes (owner
   *  report 2026-08-06: two Rune of the Procession, one trigger). Amount-carrying flags instead ACCUMULATE
   *  their amount (owner ruling: two Finality = 14 Imps), so they need no entry here. */
  flagCopies?: Record<string, number>;
  /** Rune of Gemstorm: Rubies played on each friendly Kobold at every second friendly death. */
  runeGemstorm?: number;
  /** Rune of Blood and Coin: Gold banked for next turn per 4 friendly deaths. */
  runeBloodAndCoin?: number;
  /** Rune of the Wild Hunt: Health granted board-wide per Beast attack, escalating by the same step. */
  runeWildHunt?: number;
  /** Rune of Living Treasure: your Gemheart Golems enter with Rise. */
  runeLivingTreasure?: boolean;
  /** Rune of the Remains: Shop buff per 5 friendly minions summoned in combat. */
  runeRemains?: number;
  /** Rune of Reinvestment: Shop buff per friendly minion summoned, paid once when the fight settles. */
  runeReinvestment?: number;
  /** Rune of the Hunting Bell: every 3 friendly deaths, fire your left-most Rally without an attack. */
  runeHuntingBell?: boolean;
  /** Rune of the Brood: how many times a free board slot summons a Warded, Taunting Imp this combat. */
  runeBrood?: number;
  /** Rune of Living Echoes: how many times a free board slot summons a Sunmane Herald that attacks now. */
  runeLivingEchoes?: number;
  /** Rune of the War Chorus: your first Rally each combat also triggers your left-most Shout. */
  runeWarChorus?: boolean;
  /** Rune of the Food Chain: the first minion summoned each combat gains your left-most Demon's stats. */
  runeFoodChain?: boolean;
  /** Rune of Attacking Gems: how many Rubies land on your whole board per friendly attack. */
  runeAttackingGems?: number;
  /** Rune of the Matriarch: Runebloom Matriarchs trigger twice — threaded so the COMBAT half of her
   *  per-spell proc doubles exactly like the shop half (owner audit 2026-08-02). */
  runeMatriarch?: boolean;
  /** Rune of the Mammoth: Menagerie Mammoths' grant is 1:1 symmetric (+3/+3 instead of +3 Attack). */
  runeMammoth?: boolean;
  /** Rune of the Warpath: after your LEFT-most minion attacks, your RIGHT-most attacks too. */
  runeWarpath?: boolean;
  /** Bane's Existence (quest): the Demon-widen amounts. Carried into combat since the 2026-08-04 owner
   *  ruling — the widen fires on combat-triggered Battlecries too. */
  baneDemonWiden?: { attack: number; health: number };
  /** Rune of Overflow: stats granted to your whole board, permanently, per summon that does not fit. */
  runeOverflow?: number;
  /** Rune of Counterpoint: a friendly death makes your left-most living minion attack immediately. */
  runeCounterpoint?: boolean;
  // ── 2026-08-20 rune batch ──
  /** Rune of the Returning Pack: every N Beasts summoned this combat hands over a random Beast. The number
   *  IS the threshold, so a duplicate rune can't express "more" and the flag stays a plain count. */
  runeReturningPack?: number;
  /** Rune of Grave Refreshment: every N friendly Echoes triggered this combat banks a free Shop refresh. */
  runeGraveRefreshment?: number;
  /** Rune of Shifting Facets: Avenge (3) improves the side's Rubies on ONE axis. Which axis alternates every
   *  turn, so the value carried in is the axis in force for THIS fight — not a boolean. */
  runeShiftingFacets?: 'attack' | 'health';
  /** Rune of the Deepening Vein: Avenge (3) improves Rubies +1/+1 and plays a Ruby on every friendly Kobold. */
  runeDeepeningVein?: boolean;
  /** Rune of the War Drum's UNSPENT shop charge (owner ruling 2026-08-26: "1/1 use, resets at start of turn —
   *  if it is not used in shop, the first shout triggered in combat should work"). Present ONLY when the
   *  per-turn charge went unspent; the FIRST Shout triggered in combat on this side fires this many extra
   *  times. Consumed once per combat (its own latch, so it stacks with `shoutDoubleCharges` — mirroring the
   *  recruit counter's stacking in `playedShoutRepeats`). */
  warDrumExtra?: number;
  /** Warm Embers' legacy `shoutDouble` charges still unspent at combat (same 2026-08-26 ruling, extended):
   *  each of the next N Shouts triggered in combat fires twice (one extra fire per charge). */
  shoutDoubleCharges?: number;
  /** Demand an Encore's turn-scoped Shout extras (R-TURN-01, owner ruling 2026-08-27: "'This turn'
   *  terminology runs from shop through that turn's combat"). Unlike the charge channels above this is a
   *  turn-long BUFF, exactly as in the shop counter: EVERY Shout triggered in combat fires this many extra
   *  times, nothing is consumed. */
  encoreExtra?: number;
  /** Rune of Lasting Cadence: at Start of Combat, EVERY rally-capable friendly fires its Rally once (the
   *  board-wide sibling of `runeRallying`, which fires only the left-most). */
  /** Candlelight Toll: a friendly Kobold dying grants a Ruby to hand (carried back like any hand grant). */
  candlelightToll?: boolean;
  /** Heart of the Mountain: Gemheart Golems attack immediately when summoned. */
  gemheartCharge?: boolean;
  /** The Burning Legion: how many times an attacking Imp may summon a copy of itself this combat. */
  burningLegionUses?: number;
  /** Rune of Rallying: at Start of Combat, trigger each of your minions' Rally (on-attack) effects once. */
  runeRallying?: boolean;
  /** Rune of Forthcoming (2026-07-31 rework): Start of Combat — the left-most minion gains Ward and attacks
   *  immediately. (Was a turn-priority flag read by the reducer, not a combat mod.) */
  runeForthcoming?: boolean;
  /** Rune of the Spellstone, combat half (owner ask 2026-07-31): a Ruby played IN combat also counts as a
   *  spell cast — it fires the `spellCast` trigger, so per-spell improvers (Groveweaver) advance. */
  runeSpellstone?: boolean;
  /** Decoy Sigil (next-combat spell): summon this many 1/1 Training Dummies (Taunt + Ward), one at a time,
   *  far right, whenever the board first has room — the Rune-of-the-Brood slot-filler machinery. */
  decoySigils?: number;
  /** Weaken (next-combat spell): at Start of Combat, set this many random living enemies to 1 Health. */
  weakenTargets?: number;
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
  runeEngraving?: boolean;
  runeUnderdog?: boolean;
  runeGemGolem?: boolean;
  /** Rune of the Chef: an attacking Chef Gary Toast buffs a random Dwarf by its banked `chefGrantedLast`. */
  runeChef?: boolean;
  /** Rune of Carrion Coin: Avenge (N) grants a random Shop spell. */
  runeCarrionCoin?: number;
  /** Rune of the Five Banners: Start of Combat, one friendly of each type gains +6/+6. */
  runeFiveBanners?: boolean;
  /** Solid Ground (spell): the first N minions you summon next combat gain +4/+4. Counts DOWN as they land. */
  solidGroundLeft?: number;
  /** Solid Ground: the per-summon grant (so the number lives with the spell, not the engine). */
  solidGroundStat?: number;
  /** Containment Rune (spell): set the FIRST enemy minion summoned next combat to 1/1. */
  containFirstEnemySummon?: boolean;
  /** Stolen Initiative (spell): after the enemy's FIRST attack, your right-most minion attacks immediately. */
  stolenInitiative?: boolean;
  /** Emissary Vale (United Front): Start of Combat, one friendly of each type gains +N/+N (N = the hero's
   *  Tavern Tier when the fight began). Same "one banner per body" rule as Five Banners, just tier-scaled. */
  unitedFront?: number;
  /** Rune of the Centerline: SoC — mismatched end types give the middle minion Ward + Critical Strike. */
  runeCenterline?: boolean;
  /** Rune of the Second Litter: the first Beast summoned each combat summons another copy. */
  runeSecondLitter?: boolean;
  /** Rune of Emberline: the first friendly Imp to die hands its stats to the next Imp summoned. */
  runeEmberline?: boolean;
  /** Rune of Ashen Payroll: Imps-summoned threshold (3) for its once-per-combat Gold payout. Read at settle. */
  runeAshenPayroll?: number;
  /** Rune of Backbeat: the first Echo triggered each combat also fires your left-most Rally. */
  runeBackbeat?: boolean;
  /** Rune of the Spare Chair: on a board of exactly 6, the first minion summoned gets Ward + attacks now. */
  runeSpareChair?: boolean;
  /** Rune of Ancestral Roar: a dying Dragon with a Shout fires that Shout as an Echo. */
  runeAncestralRoar?: boolean;
  /** Rune of Ruby Shrapnel: a dying Ruby-buffed body splits its Ruby stats among the survivors. */
  runeRubyShrapnel?: boolean;
  /** Rune of Shared Scripture: the warband's first combat Shop-spell cast fires the left-most Shout + Rally. */
  runeSharedScripture?: boolean;
  /** Rune of the Broodmaster: a Broodwright's Imp buff also lands on itself (combat half). */
  runeBroodmaster?: boolean;
  /** Rune of Moonhowl: a dying Mage-Pup casts its taught spell (Echo). */
  runeMoonhowl?: boolean;
  /** Rune of the Flooded Vault: Water Dragon's Avenge also casts the left-most hand spell, unconsumed. */
  runeFloodedVault?: boolean;
  /** Rune of Battle Refraction: Prismcasters repeat Rubies played during combat too. */
  runeBattleRefraction?: boolean;
  /** Rune of the Wrangler: Imps summoned by your Imp Wranglers have Ward + Taunt. */
  runeWrangler?: boolean;
  /** Rune of the Living Geode: Gemheart Golems summoned by your Geode Guardians have Ward. */
  runeLivingGeode?: boolean;
  /** Rune of Dawnclaw: your Dawnclaws also trigger their Echo at Start of Combat. */
  runeDawnclaw?: boolean;
  /** Rune of Sylus: your Sylus double their own Health at Start of Combat. */
  runeSylus?: boolean;
  /** Rune of the Groveweaver: a Groveweaver's summon grant also lands on itself, in combat as well as shop. */
  runeGroveweaver?: boolean;
  /** Rune of Enchantment (combat half): a combat cast gives your minions +4/+6. Carries the COPY COUNT since
   *  the 2026-08-27 duplicate rulings (a duplicate doubles the grant); `true` in older snapshots reads as 1. */
  runeEnchantment?: number | boolean;
  /** Rune of Dragonscale: how many Dragon attacks still earn Ward this combat (the printed 3). */
  runeDragonscale?: number;
  runeTemperedTime?: boolean;
  runeSavagery?: boolean;
  /** Rune of the Jungle: a Beast summoned in combat doubles its Health (the Health sibling of Savagery). */
  runeJungle?: boolean;
  /** Rune of the Burrow: the first friendly Beast with an Echo that dies each combat is resummoned without it. */
  runeBurrow?: boolean;
  /** Rune of Beastial Swarm: your Beasts gain +N/+N when a friendly Beast dies; Avenge(2) raises N. `N` (the
   *  current per-death amount, ≥2) rides in on `beastialSwarmLevel` and the improved value carries back. */
  runeBeastialSwarm?: boolean;
  /** Rune of Beastial Swarm — the current per-death buff amount (starts 2, +2 per Avenge(2), run-persisted). */
  beastialSwarmLevel?: number;
  /** Rune of the Zoo — your Beardsleys' summon buff scales with the running combat-summon count. */
  runeZoo?: boolean;
  // 2026-08-19 rune batch.
  runeRuins?: boolean;
  runeGolems?: boolean;
  runeEngravingGems?: boolean;
  runeHerdingHorn?: boolean;
  runeDeathtouchedApple?: boolean;
  /** Rune of the Stoked Menagerie: SoC — controlling every active type doubles 3 random minions. */
  runeStokedMenagerie?: boolean;
  /** Summoning Bulwark: how many of the minions summoned in combat still get Taunt (the spell banks 2). */
  summonTaunts?: number;
  /** Rune of the Crucible: how many left-most minions to sacrifice at Start of Combat (the printed 3). */
  runeCrucible?: number;
  runeHerald?: boolean;
  /** Rune of the Undertow: minions summoned by your Echoes (Deathrattles) attack immediately. */
  /** Rune of the Undertow — how many combat summons may take a Ward (4). `boolean` is accepted because a
   *  run saved before the cap stored a bare `true`; the combat half reads that as the default 4. */
  runeUndertow?: number | boolean;
  /** Rune of the Mirror March: at Start of Combat, if your board has room, summon a copy of your leftmost
   *  minion (current combat stats). */
  runeMirrorMarch?: boolean;
  /** Rune of the Trophy: the first friendly Slaughter each combat records the slaughtering minion — a plain
   *  copy is conjured to hand next shop (carried back via `playerSlaughterCopy`). */
  runeTrophy?: boolean;
  /** Rune of Mastery (Epic): +1 extra "Improve" step per copy held (read via `CombatContext.improveRepsFor`;
   *  the recruit engine mirrors it off `RunState.runeMastery`). Carries the COPY COUNT since the 2026-08-27
   *  duplicate rulings; `true` in older snapshots reads as 1 (= the classic double). */
  runeMastery?: number | boolean;
  /** Rune of the Old Pack: the first Beast resummoned each combat returns with its full stats. */
  oldPack?: boolean;
  /** Rune of Held Strength (owner rework 2026-08-27): Start of Combat, this side's left and right-most
   *  minions gain `attack`/`health` — the stats of the left-most non-spell card the run held in hand when the
   *  combat was built. `copies` fires the grant once per rune copy held (default 1). */
  runeHeldStrength?: { attack: number; health: number; copies?: number };
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
  /**
   * Which card SETS may offer this quest. Absent = every set. Mirrors `RuneDef.sets`, and for the same reason:
   * the set-1 and set-2 quest lists are DIFFERENT (owner 2026-07-29), and a quest whose objective names another
   * set's mechanics — Fodder, Attachments, Rubies, Ales — can never be completed in this run.
   */
  sets?: readonly ('set1' | 'set2' | 'set3')[];
  reward: QuestReward;
  /** Which quest turn this quest is offered on (owner's two-bucket table). Absent = derived from `tier`
   *  (Capstone → turn 11, else → turn 5); set explicitly only when a quest's bucket differs from that default
   *  (e.g. a Greater quest promoted into the turn-11 bucket). `questBucketFor` in @game/sim reads it. */
  wave?: 5 | 11;
  /** Undead (Ossuary Rite): a repeatable quest re-arms on completion (progress resets, reward can fire again)
   *  instead of staying done. */
  repeatable?: boolean;
  /**
   * HERO QUEST (Fi / Coran, 2026-08-21). Set = this quest belongs to that hero's own turn-1 Discover and is
   * NEVER drawn by the universal turn-5/11 offer (`generateQuestOffer` filters it out both ways). Hero quests
   * all share the `journey` objective and differ only in their count and reward.
   */
  heroQuest?: string;
  /**
   * Mutually-exclusive family. Opening Act (Fi) and Resonant Path (Coran) are each authored as THREE quests —
   * a Shout, an Echo and a Rally variant — and the owner's rule is that a player is never offered more than
   * one of a family at a time. The offer generator picks at most one quest per `variantGroup`.
   */
  variantGroup?: string;
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
  /** Card ids the forge's hover preview shows IN ADDITION to the reward's own grants — for a rune whose TEXT
   *  names a card its reward doesn't grant (Rune of Banking names Money Bot; Living Echoes names Sunmane
   *  Herald). Owner rule 2026-08-01: any rune that references a card shows that card on hover. Pinned by the
   *  runePreview audit test, which cross-checks every rune's text against the card index. */
  previewCards?: string[];
  /**
   * Which card SETS may offer this rune. Absent = every set (a rune built only from general mechanics).
   *
   * Load-bearing, because a rune's reward names mechanics that only exist in one set: a Fodder/Attachment/Undead
   * rune is dead weight in a set-2 run, and a Ruby/Ale rune is unbuyable filler in set 1 — both silently waste
   * one of the forge's few offer slots on something the run can never use (owner report 2026-07-29).
   */
  /** Mirrors `SetId` in `@game/content`, spelled out because content depends on core and not the reverse. */
  sets?: readonly ('set1' | 'set2' | 'set3')[];
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
  /** CELESTIAL: the alignment this minion LOCKED IN when combat started. Stamped by the reducer at combat
   *  setup from the recruit board's live centring, then never recomputed — combat deaths don't re-centre
   *  (owner ruling 2026-08-03). Absent for every non-Celestial board. */
  align?: Alignment;
  /** Overrides the card's keywords if present (e.g. a granted Poison). */
  keywords?: Keyword[];
  golden?: boolean;
  /** Executioner's Edge: a spell-seeded per-swing Critical Strike chance (0–1) for THIS combat, overriding the
   *  CardDef's `critChance` at `instantiate`. Absent for everyone else (they fall back to the CardDef value). */
  critChance?: number;
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
  /** Effects GRAFTED onto this body at runtime in the shop (Echo Mimic, Grave Body, Contract Rewrite's quest
   *  graft, Rune of Rebirth's shop half) — folded into the live `Minion.effects` at `instantiate`, the same
   *  channel `copiedEcho` rides, so a grafted Deathrattle fires in combat and on served boards
   *  (owner ruling 2026-08-27, q-snap-granted-effects). */
  grantedEffects?: EffectDef[];
  /** Exgalloper / Rune of Rebirth: a shop-created copy summoned "without Echo". `instantiate` filters the
   *  `onDeath` effects out of the live minion (the same rule combat's own `stripEchoes` applies), so a
   *  shop-stripped body stays silent when it dies in a fight (owner ruling 2026-08-27, q-snap-echostripped). */
  echoStripped?: boolean;
  /** Ashen Heir: the SHOP-banked Imp stats, riding into combat so the bank pays out to an Imp summoned
   *  mid-fight (`impInheritOnSummon` reads the live `Minion.impBank`, which `instantiate` seeds from this).
   *  Cloned at every boundary — combat spends its own copy; the run's bank is never consumed by a fight
   *  (owner ruling 2026-08-27, q-snap-impbank). */
  impBank?: { attack: number; health: number };
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
  /** Choose One: the branch this instance picked in the shop (`BoardCard.chosenOption`). Display-only in
   *  combat — the chosen effects were already baked in during recruit — but carried so the combat card reads
   *  the SAME single branch the board showed, instead of reverting to the both-options printed text. */
  chosenOption?: number;
  /** Mage-Pup: the spell it was taught — display-only, so the combat card names the spell its Shout cast
   *  instead of the "the spell this was taught" placeholder. */
  taughtSpellId?: string;
  /** Extra magnitude added to this minion's summon-buff effect (Kennelmaster's Avenge
   *  improvements, persisted across the run). Default 0. */
  /** Chef Gary Toast: the COMBINED stats this instance handed out last shop turn (Rune of the Chef spends it
   *  as a combat Rally). `chefGranted` accrues during the current turn; the rollover moves it here. */
  chefGrantedLast?: number;
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
  /** Parting Cry (spell): this body's SHOUT fires when it dies next combat. */
  partingCry?: boolean;
  /** Closed Casket (spell): its Echo fires at Start of Combat, and is suppressed on its first death. */
  closedCasket?: boolean;
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
  /**
   * DISPLAY-ONLY: the card's NAME and TRIBE at capture time, baked in beside `text` for the same reason —
   * a stored board must not depend on the viewing build still having the card.
   *
   * Added 2026-08-20 after boards in the Career rendered as `d2_transcendence` / NEUTRAL with placeholder art.
   * Career + Leaderboard history is fetched from the SERVER, so a row can be written by one build and read by
   * another (two devs on divergent content branches share one database, and a packaged build lags the branch
   * that played the run). The reader resolved name/tribe from its own `CARD_INDEX` and fell back to the raw
   * id, which leaked an internal id into the UI. `text` was already baked, which is exactly why those cards
   * showed correct rule text under a wrong name — the tell that identified the bug.
   *
   * Art cannot be fixed this way: it is a local asset keyed by card id, so an unknown card still shows the
   * placeholder. Absent on pool/combat snapshots and on rows written before this shipped.
   */
  name?: string;
  tribe?: Tribe;
}

/** A live combat instance. Mutable for the duration of one `simulate()` call. */
export interface Minion {
  /** CELESTIAL: the alignment this body LOCKED IN when combat began (see `Alignment`). Never recomputed
   *  mid-fight — deaths don't re-centre the board. Absent for non-Celestial boards. */
  align?: Alignment;
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
  chefGrantedLast?: number;
  summonBonus: number;
  /** Ritualist: accrued End-of-Turn grant seeded from the run board — read (not changed) in combat for live text. */
  eotBonus?: number;
  /** Choose One: the branch this body picked in the shop — display-only in combat (the effects already baked
   *  in during recruit), carried so the combat card prints that single branch, not both options. */
  chosenOption?: number;
  /** Sunmane Herald's escalating rally: the Attack this body grants on its NEXT rally attack. Doubles for every
   *  carrier each time any of them attacks. Per-INSTANCE and combat-only, deliberately: a body that dies loses
   *  its stacks (a Rise/resummon re-enters at the printed base), and one summoned mid-fight has none until a
   *  carrier attacks — both owner rules (2026-07-25), and both fall out of living on the instance.
   *  Absent = "use the printed base". Never carried back to the run. */
  rallySpreadAtk?: number;
  /** Mage-Pup: the spell it was taught — display-only, so the combat card names the spell its Shout cast
   *  instead of the "the spell this was taught" placeholder. */
  taughtSpellId?: string;
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
  /** Set when a gain was engraved by Transcendant's live adjacency aura rather than the EG keyword. */
  auraEngraved?: boolean;
  /** The RUBY share of `permaGain`. Rubies applied in combat are permanent, and without knowing which part of
   *  the carry-back came from them the run board labelled the gain "Flowing Monk" — the only non-Engraved
   *  source that existed before Set 2. Subtracted out at collection so each share is labelled correctly. */
  permaRuby?: { attack: number; health: number };
  /** Set 2 — stats from RUBIES played onto this minion during COMBAT (`playRubyOn`). Tracked separately from
   *  the recruit-phase `Ruby` entry in `buffs` because `buffs` is SHARED BY REFERENCE with the run's board card
   *  (see `combat/minion.ts`) — appending to it from inside the simulation would mutate run state and break the
   *  pure-function contract. Read alongside that entry by anything that scales off "the Rubies on this minion"
   *  (Gemheart Carver), so a Ruby counts the same whether it was played in the shop or mid-fight. */
  rubyGain?: { attack: number; health: number };
  /** Set 2 — Candleback Bulwark: times this minion's on-damage Ruby has fired THIS combat (its per-fight cap).
   *  A fresh Minion per fight, so it resets naturally between combats. */
  rubyRecvTick?: number;
  /** A RISEN body's Avenge floor: friendly deaths tallied BEFORE its Rise no longer count as its progress
   *  (owner ruling 2026-08-08 — a risen 1/3 Avenge restarts at 0/3). Every avenge factory reads its count
   *  through `avengeCountFor`, which subtracts this. Absent = 0 = the whole side tally counts. */
  avengeBaseline?: number;
  /** Ashen Heir: stats banked from friendly Imps that have died, waiting for the next Imp to inherit them.
   *  Per-instance and per-combat, so two Heirs each keep their own bank and both pay out. */
  impBank?: { attack: number; health: number };
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
  /** Parting Cry (spell): when this body dies next combat, its SHOUT fires. One-shot, spent on the death. */
  partingCry?: boolean;
  /** Closed Casket (spell): this body is DESTROYED at Start of Combat — a real death, so its Echo (and every
   *  other death watcher) fires naturally. */
  closedCasket?: boolean;
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
  chefGrantedLast?: number;
  summonBonus?: number;
  /** Ritualist: current End-of-Turn grant step (seeded) — for the live combat card text (per-tick Fodder/Imp value). */
  eotBonus?: number;
  /** Choose One: the branch this body picked in the shop — display-only in combat (the effects already baked
   *  in during recruit), carried so the combat card prints that single branch, not both options. */
  chosenOption?: number;
  /** Sunmane Herald's escalating rally — the Attack it grants on its next rally attack, so the combat card can
   *  print its CURRENT value rather than the printed base. Display-only. */
  rallySpreadAtk?: number;
  /** Mage-Pup: the spell it was taught — display-only, so the combat card names the spell its Shout cast
   *  instead of the "the spell this was taught" placeholder. */
  taughtSpellId?: string;
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
  | { type: 'sc'; source: string; text: string; cast?: true; side?: Side; grantsEcho?: true; spellId?: string } // `cast` = a genuine Start-of-Combat damage cast (UI plays the zap + bolt + flash); absent = mid-combat narration (spell-power gain, etc.) — log + trigger pulse only. `side` is stamped on side-scoped gain telegraphs (Ruby Power — BOTH sides can gain it) so the Buffs drawer counts only the player's; player-only channels (Spell Power) never emit for an enemy and need no tag. `grantsEcho` marks the ONE minion a Start-of-Combat grant handed an exact-copy Echo (Rune of Rebirth), so the UI can print the rule on THAT body instead of on every minion you control. `spellId` is the CARD ID of the spell this cast resolved, stamped by every "X casts Y" emit: without it a cast is identified only by the BODY that cast it, so an authored spell effect had to be bound to each caster and a new caster arrived silently unanimated (owner ask 2026-09-01: Dragonflame's animation must play "anytime dragonflame is played … anything").
  | { type: 'attack'; attacker: string; defender: string; swing: number; crit?: boolean }
  | { type: 'dmg'; target: string; amount: number; remainingHp: number; source?: string } // `source` = the uid that dealt this hit (attacker, poisoner, an AoE's caster). Optional: truly sourceless damage omits it. Lets presentation attribute a sourceless-looking damage MOMENT to its actor — e.g. Fel Spikes' Echo volley fires FROM the dying body (source→target FX), the way an `sc` event carries a Start-of-Combat cast's source.
  | { type: 'proccrit'; source: string; mult: number }
  | { type: 'spellcast'; side: Side; count: number } // a Shop Spell resolved mid-fight (Quil/Mammoth/Taragosa/…). `count` = that side's running total. The UI's live counters (Yirin's Attunement, Guel-style tallies) tick off this — carry-backs land at settle, so without it nothing can move in real time. // a chance-to-repeat effect rolled its multiplier (Karwind's 20% double) — the UI floats a crit-style "Nx" above `source`. Presentation only; the repeat itself is already in the buff events.
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
  // `ruby`: this stat gain came from a RUBY landing on `target` (set 2 Kobolds), not from an ordinary buff.
  // Pure presentation metadata in the same spirit as `avenge` below — never read by the sim, never affects
  // outcomes. It exists because `applyRubyStats` routes through the same `ctx.buff` as every other stat gain,
  // leaving a Ruby indistinguishable in the log; the UI needs to tell them apart to play the Ruby cue on the
  // minion that received it (`ruby-gem-apply`) without firing on all 40-odd other buff sources.
  | { type: 'buff'; target: string; attack: number; health: number; source: string; ruby?: true; spellId?: string } // `spellId` = the spell whose cast produced this buff, when one did. Same purpose as the field on `sc`: a buff WAVE is its own presentation moment (the tendril channel lives there), so without this the wave is attributed to the BODY that cast — and an authored spell effect could not replace the stock tendril for the spell that caused it (owner report 2026-09-01: Dragonflame's casters "are triggering tendrils instead").
  | { type: 'improve'; target: string; amount: number; display?: number } // an Improve accrual ticked: `amount` = the accrual-field delta (what the replay folds into `summonBonus`); `display` = the magnitude to NARRATE when it differs (Mammoth: amount 1 proc, display +3)
  | { type: 'shout'; source: string; target: string } // a combat Shout RE-FIRE — one per FIRE, so Drakko's repeats are countable at the signal: `source` = the re-triggering unit (Dawnclaw / Ryme / Thunderous Sovereign / Chorus Drake / Embercrest…), `target` = the Shout's owner. Mirrors `rally` (2026-09-01: three Drakko-repeated fires read as one on screen because they were narration).
  | { type: 'rally'; source: string; target: string } // Deathsayer's Rally fires `target`'s Deathrattle
  | { type: 'maxGold'; target: string; side: Side; amount: number } // Soulsman's Avenge raises your max Gold
  | { type: 'toHand'; cardId: string; side: Side; source?: string } // a combat effect adds a card to your hand (Arcane Weaver)
  | { type: 'hpGrant'; target: string; amount: number } // Sergeant: live HP-grant amount after each Attack-gain improvement
  | { type: 'spellProgress'; target: string; amount: number } // Archmagus Guel: on-board spell tally after a combat cast (live countdown)
  | { type: 'questTrigger'; flag: string; side: Side } // a completed quest / owned rune's COMBAT effect fired — `flag` maps to its badge id so the UI can pulse the node
  | { type: 'questComplete'; questId: string; side: Side } // a quest completed MID-COMBAT (its objective crossed): the UI lights its node + its reward activates from this beat (see PendingCombatQuest)
) & { step?: number; avenge?: true; key?: string; srcCard?: string; wave?: number };
// `wave` (Fel Spikes / multi-pass echo pacing): a stable presentation tag marking which AoE PASS ("wave") an
// event belongs to. Unlike `step` — which deaths bump mid-pass (`killOrReborn` calls `nextStep`) — a wave id
// stays constant across a whole pass, so all of a pass's damage + its synchronous reactor buffs + resulting
// deaths share one id. The replay groups a contiguous same-`wave` run into ONE moment (a simultaneous volley),
// and a change in `wave` id splits the moment (a short pause between passes). Opt-in: only an effect that wraps
// a pass in `ctx.wave(fn)` stamps it, so untagged combat is byte-identical. Pure presentation metadata like
// `step` — never read by resolution, never affects outcomes.
// `key`/`srcCard` (CHOREOGRAPHER PR 23): the registry key of the minion EFFECT that emitted this event
// (`factory:<do>:<on>`) and the card that ran it — stamped by the simulator's dispatch context, exactly like
// `step`/`avenge`. Pure presentation metadata: never read by resolution, so outcomes cannot depend on it.
// This is what makes minion combat triggers (Oona's onSummon, every onAttack/onDeath/avenge) ADDRESSABLE as
// a class instead of identity-less moments the Beat Lab can only display. // `avenge`: this event was emitted by an Avenge handler (payoff for the death count hitting a threshold). Pure presentation metadata (like `step`) — never affects outcomes — so the replay can defer Avenge beats until AFTER the death's summons have deployed.

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
  /** The card ids this run may DRAW from — its pinned set's pool.
   *
   *  Every random pick in combat (a Slaughter's spell, a random-minion grant, a magnetic roll) used to filter
   *  the GLOBAL `CARD_INDEX`, so a Set-1 run could be handed a Set-2 card: Badgington's Slaughter produced a
   *  Set-2 spell and Sea Urchin a Mushy (owner report 2026-07-27). Recruit-phase picks already go
   *  through `poolOf(state)`; combat simply never had the set threaded in.
   *
   *  Empty/undefined = UNRESTRICTED, which keeps `EMPTY_SIDE` (the harness, the procedural threat, tests that
   *  only care about minions) behaving exactly as before. */
  poolIds?: readonly string[];
  /** Rune of the Wild Hunt's accrued escalation, carried run-wide. The rune's text says "improve this by 3
   *  PERMANENTLY" but the counter used to start at 0 every combat (owner report 2026-08-01) — this seeds the
   *  fight with what earlier combats grew, and `playerWildHuntGrown` on the result carries it back out. */
  wildHuntGrown?: number;
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
  /** CONDUCTOR's run-wide snowball N, carried in so a Shout RE-FIRED mid-fight grants the accumulated
   *  +(2N)/+(3N) rather than nothing. Read-only in combat — the increment is a play-time event. */
  conductorBuff: number;
  /** Fodder consumed this turn (Abhorrent Horror's Start-of-Combat payoff). */
  fodderConsumedAtk: number;
  fodderConsumedHp: number;
  /** Run-wide Beast Attack aura (The Old Hunt / Pack Mentality's Attack half). */
  beastBuyAtk: number;
  /** Beasts played this recruit turn (legacy — retained for the ctx accessor + result echo). */
  beastsPlayed: number;
  /** Set 2 — cards bought this recruit turn (Frenzied Excavator's Start-of-Combat scaler). Player-authoritative. */
  cardsBoughtThisTurn: number;
  /** Attachment/Magnetic aura (Scrap Herald / Banksly welds) — sizes this side's from-base Magnetics. */
  magneticAtk: number;
  magneticHp: number;
  /** Set 2 — this side's Ruby STRENGTH (the run's `rubyBonus`): the extra Attack/Health on top of a Ruby's
   *  base 1/1, so a combat-cast Ruby (Avenge / Rally / Start-of-Combat "Play a Ruby") applies the same amount
   *  the shop does. Default zero (a Ruby is 1/1). Player-authoritative today. */
  rubyBonus: { attack: number; health: number };
  /** Set 2 — the card ids of the SPELLS in this side's hand at combat start, in hand order (Vault Curator
   *  copies the left-most). Player-only in practice; the enemy side leaves it empty. Read-only in combat —
   *  the sim never mutates the run hand. */
  handSpellIds?: readonly string[];
  /** Dwarven Ales this side cast LAST shop turn (Bucky's Start of Combat scales off it). */
  alesLastTurn?: number;
  /** The side's accumulated escalating-spell bonus (Front to Back) going into this fight, so a combat cast
   *  grants what a hand cast would grant right now. Snapshot fidelity: a served enemy carries its owner's. */
  spellEscalation?: { attack: number; health: number };
  /** The LAST Shop spell this side's owner cast, by card id (Sporebat's stored spell). */
  lastSpellCastId?: string;
  /** Runesnout Archivist: the FIRST Shop spell cast on each turn an Archivist was on the board, in order.
   *  Run-level and snapshot-captured (like `lastSpellCastId`) so a served Archivist replays its own journal
   *  rather than borrowing the player's. */
  rememberedSpellIds?: string[];
  /** Rune of Spellhide: {spellId, uid} pairs re-cast at Start of Combat onto the Beast that was buffed. */
  spellhide?: { spellId: string; uid: string }[];
  /** Rune of Living Growth: the run's accrued Growth improvement, added to every combat Growth cast. */
  growthBonus?: number;
  /** The MINIONS in this side's hand at combat start, in hand order, with their live (buffed) stats — Rope
   *  Wrangler's Echo summons one at random, CONSUMING it (`uid` is the run hand card's uid; settle removes
   *  the summoned ones via `CombatResult.playerHandSummoned`). Player-only in practice. */
  handMinions?: readonly { uid: string; cardId: string; attack: number; health: number; keywords: readonly Keyword[]; golden: boolean }[];
  /** Set 2 — Elderhorn's chosen mode(s): extra fires for this side's BEAST triggers. `beastHuntExtra` applies
   *  to Rally + Slaughter, `beastRitualExtra` to Echo (Deathrattle). Tribe-scoped by design — unlike the
   *  card-level `triggerMultiplier` (Drakko/Uron), which is board-wide. */
  beastHuntExtra?: number;
  beastRitualExtra?: number;
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
  /** TUTORIAL ONLY: force the enemy's FIRST attack to target the player minion with this card id, if one is
   *  alive — so a scripted lesson (e.g. "the enemy kills your T-Rex, watch its Echo fire") lands no matter
   *  where the player placed it. Ignored in every real run; targeting is otherwise random. */
  forceEnemyFirstTargetCard?: string;
}

export interface CombatResult {
  events: CombatEvent[];
  result: CombatOutcome;
  /** The enemy board's run-level scalers at combat start (from its snapshot) — so the UI can render an ENEMY
   *  Grim / Taragosa / Pack Leader / Runescale card at the OPPONENT's value, not the current player's. Absent
   *  for the procedural threat / when nothing scaled. Mirrors the values threaded into `simulate` as
   *  `enemyScalers` and used per-side by the combat effects. */
  enemyScalers?: { spellPower: { attack: number; health: number }; spellsThisTurn: number; beastsPlayed: number; deathrattles: number; conductorBuff: number };
  /** Resolve the player loses on defeat (handoff A.3 step 9). 0 otherwise. */
  playerDamage: number;
  /** The itemized contributions behind `playerDamage` — the opponent's tavern tier plus one entry per
   *  surviving enemy minion. Present only on a loss. The defeat animation tallies THESE so the counter it
   *  shows and the hit that lands can never be two different numbers; it used to recompute them from
   *  `nextOpponent()` and the replay frame, which can disagree with what the fight actually used.
   *  Sums to `playerDamage` (before the run loop's round cap). */
  damageBreakdown?: { oppTier: number; survivorTiers: number[] };
  /** Damage the ENEMY side takes on ITS loss — the exact mirror of `playerDamage`, by the same formula.
   *  Unused by a single-player run (the enemy has no Resolve pool); the lobby needs both sides' damage out of
   *  ONE authoritative fight, since resolving it twice with the sides swapped can disagree.
   *
   *  OPTIONAL like every other non-core result field: dozens of tests build partial `CombatResult` fixtures,
   *  and making a lobby-only number required would tax all of them for nothing. Absent = 0. */
  enemyDamage?: number;
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
  /** Flash: the cardId of the FIRST and LAST enemy minion the player killed this combat. Identity, not a
   *  count — `enemyDeaths` already carries the count, and Flash needs to know WHICH body it was. Absent when
   *  nothing died. Player-perspective like every other `player*` carry-back. */
  playerFirstKill?: string;
  playerLastKill?: string;
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
  /** Everything the DEFERRED odds probe needs to re-run this matchup (perf audit 2026-08-01: the 200 Monte
   *  Carlo sims used to run synchronously inside `faceOmen` — ~10 ms on the End Turn click, 2-3 dropped
   *  frames at 240 Hz, feeding nothing but a display bar). The reducer now stashes the sim inputs here —
   *  plain serializable data, so a mid-combat save/resume can still compute — and the UI runs the probe in
   *  idle time after the combat transition (see `computeCombatOdds` in @game/sim). Same seeds → identical
   *  numbers to the old inline path. */
  oddsInput?: {
    player: BoardMinion[];
    enemy: BoardMinion[];
    playerState: CombatSideState;
    enemyState: CombatSideState;
    config: CombatConfig;
  };
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
  playerPermaBuffs?: { sourceUid: string; attack: number; health: number; engraved: boolean; ruby?: boolean }[];
  /** Card ids the player's combat deathrattles grant to the hand after combat (Arcane Weaver). */
  playerHandGrants?: string[];
  /** Set 2 — Rubies to mint into the hand after combat (Rikk / Gemline "Get N Rubies" in combat). Minted with
   *  the run's live `rubyBonus` at settle, so they match a shop-minted Ruby. */
  playerRubyGrants?: number;
  /** Set 2 — Ruby STRENGTH gained this combat (Veinbreaker "Avenge: buff your Rubies +X/+Y"). Applied to the
   *  run's `rubyBonus` at settle (grows held + future Rubies). */
  playerRubyBonusGain?: { attack: number; health: number };
  /** Set 2 — Rubies a combat-refired "get N Rubies" Shout minted; settle runs the run's real `mintRubies`. */
  playerRubyMints?: number;
  /** Hand-card uids a combat effect SUMMONED out of the hand (Rope Wrangler's Echo) — settle removes them
   *  from the run hand: the minion fought, so it is spent whether it lived or died. */
  playerHandSummoned?: readonly string[];
  /** Set 2 — Demon Horse: a Rally that permanently buffs SHOP minions. A Rally fires in COMBAT, but the tavern
   *  buff is run state, so it can only reach the run through a carry-back like every other combat→run effect
   *  (Ruby strength, spell power, the Undead aura). Applied to `tavernBuyBonus` at settle — the Staff of Guel
   *  channel, per the owner's rule that "give minions in the Shop" means permanent, not just this shop. */
  playerTavernBuyGain?: { attack: number; health: number };
  /** Rune of the Wild Hunt: the escalation the player's side ended the fight with — written back to the run
   *  so the next combat's first Beast attack continues from it instead of restarting at the base step. */
  playerWildHuntGrown?: number;
  /** Set 2 — Mushy Echoes that fired this combat: how many next-turn first-spell copies to queue. */
  playerNextTurnSpellCopies?: number;
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
  /** Discover spells cast mid-combat (by card id, one entry per cast). Settle re-derives each spell's
   *  Discover spec and queues it, so the player picks in the next shop — the modal can't open in a fight. */
  playerDiscoverCasts?: string[];
  /** Shop-buff spells cast mid-combat: a one-time buff for the NEXT shop (the `nextShopBuff` channel). */
  playerNextShopBuff?: { attack: number; health: number };
  /** Front to Back improved itself during this combat (Quil casting it). Added to the run's
   *  `frontToBackBonus`/`frontToBackBonusH` in settleCombat: the buff the cast handed out was temporary, but
   *  the SPELL keeps what it learned (owner ruling 2026-08-07). Absent if 0. */
  playerSpellEscalationGain?: { attack: number; health: number };
  /** Permanent Undead Attack bonus from this combat (Karthus on-kill). Stacks into `undeadBuyAtk` and is
   *  also applied to existing run-board Undead immediately after combat. Absent if 0. */
  playerUndeadBuyAtkGain?: number;
  /** Elderhorn refired in combat: extra fires for BEAST triggers (`hunt` → Rally/Slaughter, `ritual` → Echo).
   *  Reads live for the REST of this fight too; settle stacks the player half into the run. */
  playerBeastExtraGain?: { hunt: number; ritual: number };
  /** Permanent Undead AURA gained this combat (Watcher casting Lantern of Souls: +Attack/+Health to your
   *  Undead everywhere). Added to `undeadAttackBonus`/`undeadHealthBonus` in settleCombat — the same channel a
   *  shop-cast Lantern uses. Absent if 0/0. */
  playerUndeadAuraGain?: { attack: number; health: number };
  /** Permanent Imp buff gained this combat (Imp King Deathrattle, Brood Matron Avenge) — added to
   *  RunState.impBuff so future Imps inherit it. Absent if 0/0. */
  playerImpBuffGain?: { attack: number; health: number };
  /** Cindara's Hoard: the improvement her Whelps GAINED this combat (+2/+2 per Avenge (4) fire). Added to
   *  `RunState.hoardWhelpBuff` at settle, so the next fight's Whelps open at the size the last one left them.
   *  Absent if 0/0 — a fight where the Avenge never reached 4 deaths banks nothing. */
  playerHoardGain?: { attack: number; health: number };
  /** Permanent right-most Shop-slot buff earned this combat (Right Hand Hank's Echo) — added to
   *  RunState.rightmostSlotBuff so the next shop's right-most offer carries it. Absent if 0/0. */
  playerRightmostSlotBuff?: { attack: number; health: number };
  /** Rune of Beastial Swarm — the grown per-death buff amount, if the Avenge(2) improvement fired this combat.
   *  Written to RunState.beastialSwarmLevel so the bigger per-death buff persists. Absent if unchanged. */
  playerBeastialSwarmLevel?: number;
  /** A PERMANENT buff earned in combat for your whole warband, carried back onto the run's board (Rune of
   *  Overflow). Every other carry-back is tribe-scoped — Imps, Beasts, Fodder, Rubies — so "your minions"
   *  needed its own untyped channel; without one, a combat buff simply vanishes at settle and a rune whose
   *  text says "permanently" does nothing. */
  playerBoardBuffGain?: { attack: number; health: number };
  /** Chorus Engine's Rally: the permanent ATTACHMENT enchant earned this combat. Applied at settle exactly like
   *  Scrap Herald — every Magnetic on board/in hand gains it and `magneticBuyAtk/Hp` stacks, so it reaches
   *  welded, held and future Attachments ("wherever they are"). Absent = none. */
  playerMagneticBuffGain?: { attack: number; health: number };
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
  /**
   * The spell currently being cast, if one is — set for the duration of a named-spell cast and restored after
   * (see `castNamedSpellInCombat`). MUTABLE on purpose: it is a scope marker, not state. Every event emitted
   * inside that window can stamp it, which is what gives a spell's consequences the spell's identity rather
   * than only its caster's (owner ask 2026-09-01 — Dragonflame must animate as Dragonflame whichever minion
   * cast it, and its authored effect must replace the stock buff tendril for that wave).
   */
  castingSpellId?: string;
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
  /** This side's live tavern tier — used to cap random-minion generation (e.g. Bullseye / Menagerie Mammoth). */
  tierFor(side: Side): number;
  spellsThisTurnFor(side: Side): number;
  /** How many times an "Improve" step applies for `side` — 2 under Rune of Mastery, else 1. Every combat
   *  factory whose card text says **Improve** multiplies its improvement increment by this. */
  improveRepsFor(side: Side): number;
  /** SHOP→COMBAT CARRY-OVER (owner ruling 2026-08-26): extra fires for a Shout TRIGGERED in combat, consumed
   *  per call — the first Shout gets an unspent War Drum charge (`warDrumExtra`), and each of the next N
   *  Shouts gets one extra fire while `shoutDoubleCharges` last. Optional: contexts without it (recruit
   *  arena, tests) get plain single fires. Implemented in `simulate()`; consumed by `replayCombatBattlecry`. */
  shoutCarryExtras?(side: Side): number;
  /** Rune of the Matriarch reps for this side (2 with the rune, else 1) — the combat mirror of the
   *  recruit engine's `state.runeMatriarch` wrapper. */
  matriarchRepsFor(side: Side): number;
  /** This side's active tribes (the run's generation pool filter), for tier/tribe-scoped random grants. */
  activeTribesFor(side: Side): string[];
  /** Bane's Existence widen for this side, if the quest is armed (owner ruling 2026-08-04). */
  baneDemonWidenFor(side: Side): { attack: number; health: number } | undefined;
  /** Rune of the Mammoth for this side — the Mammoth grant gives Health 1:1 with its Attack. */
  mammothHealthFor(side: Side): boolean;
  /** Per-side "Beasts played this turn" — player's, or the opponent's captured value. */
  beastsPlayedFor(side: Side): number;
  /** Per-side cards bought this recruit turn (Frenzied Excavator's Start-of-Combat Ruby scaler). */
  cardsBoughtThisTurnFor(side: Side): number;
  /** Deathrattles triggered this game so far, for `side`: for the PLAYER the run-wide base + this combat's
   *  player Deathrattles; for the ENEMY the opponent's captured tally. Grim scales its buff by this. */
  deathrattleTally(side: Side): number;
  log(event: CombatEvent): void;
  living(side: Side): Minion[];
  /** Like {@link living}, but RETAINS a body already at ≤0 HP whose death is being deferred across a multi-
   *  volley Echo (Fel Spikes) — so a later volley / re-fire re-hits the same accumulating set. Equals
   *  {@link living} outside a deferred-death scope. */
  onBoard(side: Side): Minion[];
  getCard(id: string): CardDef;
  /** Every card definition the run knows about — for effects that pick a random card matching a
   *  property rather than a fixed id (Junkyard Titan → a random Magnetic minion). */
  allCards(): CardDef[];
  /** `allCards()` narrowed to the run's pinned set (see `CombatSideState.poolIds`). EVERY random pick must use
   *  this rather than `allCards()`, or it can hand a Set-1 run a Set-2 card. Falls back to `allCards()` when a
   *  side carries no pool (the harness / procedural threats). */
  poolCards(side: Side): CardDef[];
  /** `ruby`: tag the emitted `buff` event as a Ruby landing (presentation only — see the `buff` event's own
   *  note). Only `applyRubyStats` passes it; every other caller leaves it off and behaves exactly as before. */
  buff(target: Minion, attack: number, health: number, source: string, ruby?: true): void;
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
  /** How many EXTRA times `minion`'s Echo fires, from every Echo multiplier that side has — Sylus / Uron
   *  (card-data driven), Elderhorn's Beast Ritual, Funeral Engine's `echoExtraAlways`, Grave Contract's
   *  first-Echo bonus. THE canonical read: `simulate` uses it for real deaths, and the Rally-proc factories
   *  (Echohorn, Deathsayer) now use the same one instead of their own partial views — Echohorn consulted NO
   *  multiplier at all (Sylus contributed exactly zero through it) and Deathsayer hardcoded a `cardId ===
   *  'sylus'` scan that silently dropped Zyff / Funeral Engine / Elderhorn / Grave Contract.
   *  NOTE: this CONSUMES the once-per-combat first-Echo bonus, which is correct — a proc'd Echo is an Echo
   *  firing — so call it once per proc batch, not speculatively. */
  echoExtras?(minion: Minion): number;
  /** Run `fn` as ONE ECHO TRIGGER, through the same chokepoint a real death uses. Every "an Echo fired"
   *  payoff hangs off this — Rune of Aftershocks (+4/+4 to the board), Rune of the Burrow (a free refresh on
   *  a Beast Echo) — so a FORCED trigger (Echohorn Stag / Hawkus / Spots, Rune of the Herald, Rune of
   *  Dawnclaw) pays exactly like a death-fired one. Owner report 2026-08-20: Aftershocks only ever fired on
   *  a real death, because those forced paths called the `onDeath` factories directly and never came
   *  through here. Wrap ONE TRIGGER — never one effect (a body with two Echo effects is still one trigger)
   *  and never one watcher; each extra proc from a multiplier IS its own trigger. `source` is the body whose
   *  Echo it is (Burrow reads its tribe). */
  asEcho?(side: Side, fn: () => void, source?: Minion): void;
  /** Queue a card to be added to that side's hand after combat (player only is persisted). */
  grantToHand(cardId: string, side: Side, sourceUid?: string): void;
  /** Permanently raise the run-wide spell power by +atk/+hp (Skullblade's Deathrattle). Player-only;
   *  accumulated and carried back via `CombatResult.playerSpellPower`, applied in the run loop. `sourceUid`
   *  (the granting minion) telegraphs it mid-combat as an `sc` narration. */
  grantSpellPower(attack: number, health: number, side: Side, sourceUid?: string): void;
  /** Permanently buff a card type run-wide by +atk/+hp (Grave Knit's combat death). Player-only;
   *  accumulated and carried back via `CombatResult.playerCardBuffs`, applied in the run loop. */
  grantCardBuff(cardId: string, attack: number, health: number, side: Side): void;
  /** Set 2 — mint `count` Rubies into hand after combat (Rikk / Gemline). Player-only; carried back. */
  grantRubies(count: number, side: Side, sourceUid?: string): void;
  /** Set 2 — raise the run's Ruby strength after combat (Veinbreaker). Player-only; carried back. */
  /** Set 2 — raise the run's RUBY strength (player-only; carried back at settle). `sourceUid` is optional and
   *  presentation-only: with it the sim emits an `sc` narration so the UI can telegraph the gain mid-combat,
   *  exactly as `grantSpellPower` does. Without it the gain still applies, just silently. */
  gainRubyBonus(attack: number, health: number, side: Side, sourceUid?: string): void;
  /** Set 2 — a combat-refired "get N Rubies" Shout: the replay sees each Ruby fly to hand (`toHand`), and
   *  settle mints them through the run's REAL `mintRubies` — rubyBonus baked in, Candle Conduit fired, hand
   *  cap respected. Player-only (enemies have no hand). Carried back via `CombatResult.playerRubyMints`. */
  mintRubies(count: number, side: Side, sourceUid?: string): void;
  /** Rope Wrangler's Echo: draw one not-yet-taken MINION from this side's hand snapshot (uniform via the
   *  combat rng), marking it consumed for this fight AND recording its uid for settle removal. Undefined when
   *  the snapshot has no minion left (a spell-only or empty hand — clean no-op). */
  takeRandomHandMinion(side: Side): { uid: string; cardId: string; attack: number; health: number; keywords: readonly Keyword[]; golden: boolean } | undefined;
  /** Permanently buff every future Shop minion (Demon Horse's Rally) — carried back via `playerTavernBuyGain`. */
  /** `sourceUid` is what lets the gain be TELEGRAPHED mid-combat. Without it the buff applies silently at
   *  settle and the player sees nothing happen (owner report 2026-07-31). */
  gainTavernBuy(attack: number, health: number, side: Side, sourceUid?: string): void;
  /** Set 2 — Mushy: queue `count` next-turn first-spell copies (player-only; carried back). */
  queueNextTurnSpellCopy(count: number, side: Side): void;
  /** Set 2 — the card id of the LEFT-MOST spell in that side's hand at combat start, or undefined if none. */
  leftmostHandSpellFor(side: Side): string | undefined;
  /** ALL the spell ids in that side's hand at combat start, in hand order (Menagerie Mammoth casts a random
   *  one). The same snapshot `leftmostHandSpellFor` reads — combat never mutates the run hand. */
  handSpellsFor?(side: Side): readonly string[];
  /** The side's accumulated Front-to-Back escalation going INTO this fight, plus anything earned during it —
   *  so a combat cast grants what a hand cast would grant right now. */
  spellEscalationFor?(side: Side): { attack: number; health: number };
  /** A combat cast of an escalating spell improved it. The STATS it handed out are temporary like any combat
   *  buff, but this improvement is PERMANENT (owner ruling 2026-08-07) and carries back via
   *  `CombatResult.playerSpellEscalationGain`. Player-only; an enemy's cast advances only its own fight. */
  grantSpellEscalation?(attack: number, health: number, side: Side): void;
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
  grantRandomMinion(count: number, tribe: string | undefined, side: Side, exclude?: string, sourceUid?: string, fixedTier?: number, shoutOnly?: boolean): void;
  /** A minion casts a spell mid-combat (Taragosa's Growth). Tallies the cast (the running per-side count
   *  is reported in the `spellCast` event payload so Guel scales) and, for the player, carries it back via
   *  `CombatResult.playerSpellsCast` to permanently bump the run's `spellsCast`. The spell's actual effect
   *  (the buff/damage) is applied by the caller — this just fires the `spellCast` trigger + counts it. */
  castSpell(side: Side): void;
  /** Rune of the Spellstone (combat half): is the mod armed for `side`? Read by the Ruby-play primitive. */
  spellstoneFor?(side: Side): boolean;
  /** Rune of the Groveweaver: is the self-buff armed for `side`? */
  groveweaverSelfFor?(side: Side): boolean;
  /** Bucky: Dwarven Ales that side cast LAST shop turn. */
  alesLastTurnFor?(side: Side): number;
  /** Announce that a `doubleChance`-style roll came up, so the UI can float a crit-style "Nx" above the
   *  proccing minion (Karwind). Purely presentational — the extra repetitions are applied by the caller. */
  crit?(sourceUid: string, mult: number): void;
  /** How many times ONE Shop Spell cast by `side` resolves in combat — 1 normally, more when something has
   *  granted extra casts (Runebloom Matriarch). Read by `castInCombat`, the single combat cast path. */
  spellCastRepsFor?(side: Side): number;
  /** Grant `side` N extra combat casts of every Shop Spell (Runebloom Matriarch's Start of Combat). */
  grantSpellCastExtra?(side: Side, n: number): void;
  /** The card id of the LAST Shop spell this side's owner cast, if any (Sporebat's stored spell). */
  lastSpellCastFor?(side: Side): string | undefined;
  /** Rune of Shared Scripture's hook — every resolved combat Shop-spell cast reports itself here. */
  onCombatSpellCast?(side: Side): void;
  /** Rune of the Broodmaster — does a Broodwright on this side also buff itself? (mirrors `groveweaverSelfFor`) */
  broodmasterSelfFor?(side: Side): boolean;
  /** Rune of the Flooded Vault — does Water Dragon's Avenge also cast the left-most hand spell? */
  floodedVaultFor?(side: Side): boolean;
  /** Rune of Battle Refraction — extra combat-Ruby repeats this side's living Prismcasters grant. */
  battleRefractionRepsFor?(side: Side): number;
  /** Rune of Engraving Gems: this side's combat Rubies carry back to the run board (see `playRubyOn`). */
  rubiesPermanentFor?(side: Side): boolean;
  /** Rune of Living Growth — this side's accrued Growth improvement (added to combat Growth casts). */
  growthBonusFor?(side: Side): number;
  /** Runesnout Archivist's journal for this side (see `CombatSideState.rememberedSpellIds`). */
  rememberedSpellsFor?(side: Side): readonly string[];
  /** Mossmemory Colossus — resummon up to `count` of the Beasts that died EARLIEST this combat on `side`,
   *  excluding `excludeUid` (the Colossus itself: the printed rule says "other Beasts"). Returns how many
   *  actually came back — the board cap can refuse some. */
  resummonDeadBeasts?(side: Side, count: number, excludeUid: string): number;
  /** Fire one minion's Rally WITHOUT an attack (Scavvers' Echo) — the shared free-rally primitive, so the
   *  tally bump and quest halves ride along exactly as an attack-path rally would. */
  triggerRally?(m: Minion): void;
  /** A Discover spell was cast mid-combat (Quil / Sporebat / a taught Pup). The modal can't open in a fight,
   *  so the CAST carries back (`playerDiscoverCasts`) and settle queues the real Discover. Player-only. */
  queueDiscoverCast?(spellId: string, side: Side): void;
  /** A shop-buff spell was cast mid-combat: bank a one-time buff for the NEXT shop (the run's `nextShopBuff`
   *  channel, via `playerNextShopBuff`). Player-only. */
  gainNextShopBuff?(attack: number, health: number, side: Side): void;
  /** Abhorrent Horror: total Fodder stats consumed this turn for a given side (attack + health) — the player's
   *  live run state, or a served enemy's captured tally. `scGainFodderStats` reads its OWN side at Start of
   *  Combat (so an enemy Horror gains the ENEMY's consumed stats, not the player's). {0,0} if none. */
  fodderConsumedFor(side: Side): { attack: number; health: number };
  /** Karthus: permanently raise run-wide Undead buy-time attack by `amount` (player only). Carried back
   *  via CombatResult.playerUndeadBuyAtkGain, stacked into undeadBuyAtk and applied to the run board. */
  grantUndeadBuyAtk(amount: number, side: Side): void;
  /** Elderhorn's extra BEAST trigger fires. BOTH sides accumulate (the value reads live for the rest of the
   *  fight — an enemy Elderhorn's Ritual must grow its own later Echoes too); only the player half carries
   *  back via `CombatResult.playerBeastExtraGain`. */
  gainBeastExtra(hunt: number, ritual: number, side: Side, sourceUid?: string): void;
  /** Watcher (casting Lantern of Souls): permanently raise the run-wide Undead aura by +attack/+health
   *  (player only) — the Lantern channel (`undeadAttackBonus`/`undeadHealthBonus`). Live for this fight's
   *  later summons + carried back via CombatResult.playerUndeadAuraGain. */
  grantUndeadAura(attack: number, health: number, side: Side): void;
  /** Imp King / Brood Matron Avenge: permanently raise the run-wide Imp buff by +atk/+hp (player only).
   *  Carried back via CombatResult.playerImpBuffGain → added to RunState.impBuff so future Imps inherit it. */
  /** No `sourceUid`: unlike `gainTavernBuy`, this already emits a `tribeAura` event, which the replay blooms
   *  as the board aura-wash — so the gain is cued without needing a second channel. */
  grantImpBuff(attack: number, health: number, side: Side): void;
  /** Right Hand Hank (Echo) — from combat, grow the run's right-most Shop-slot buff by +atk/+hp (player only).
   *  Carried back via CombatResult.playerRightmostSlotBuff → added to RunState.rightmostSlotBuff (the same
   *  accumulator Market Tormentor grows), which applyShopRefreshed re-lands on the next roll's right-most. */
  grantRightmostSlotBuff(attack: number, health: number, side: Side): void;
  /** Wolvie (Echo) — queue a one-shot buff for the NEXT `tribe` minion `side` summons this combat. Consumed at
   *  the summon chokepoint (front of the queue), so two Wolvies stack as two separate next-summon grants. */
  queueNextSummonBuff(side: Side, tribe: Tribe, attack: number, health: number): void;
  /** Rune of the Zoo — how many times Beardsley's summon buff should apply to the CURRENT summon: the running
   *  combat-summon ordinal for `side` when the rune is held (1st summon → 1×, 2nd → 2×, …), else 1. */
  zooReps(side: Side): number;
  /** Chorus Engine — raise the run's ATTACHMENT (Magnetic) enchant from combat. The recruit twin is Scrap
   *  Herald's `battlecryBuffMagnetics`: buff every Magnetic on board + in hand, and stack the aura so future
   *  Attachments inherit it. Only the player carries back (the enemy is regenerated each wave). */
  grantMagneticBuff(attack: number, health: number, side: Side): void;
  /** The side's LIVE Imp Aura this fight (seeded from run state, advanced by in-combat Imp buffs). Chef Raag
   *  reads it to give your minions stats equal to it. */
  impAura(side: Side): { attack: number; health: number };
  /** CONDUCTOR's carried snowball for a side (see `CombatSideState.conductorBuff`). */
  conductorTally(side: Side): number;
  /** Bane (combat, reacting to Ryme's battlecry replays): permanently enchant the Fodder card type run-wide
   *  by +atk/+hp (player only). Carried back via CombatResult.playerFodderBuffGain → `buffFodderRunWide`. */
  grantFodderBuff(attack: number, health: number, side: Side): void;
  /** Deal damage to a combat minion (used by Start-of-Combat and on-break effects). `source` credits the
   *  damaging minion — pass it so effects keyed on "a friendly Demon dealt damage" (and kill attribution) see
   *  it (e.g. Fel Spikes' Echo attributing each hit to itself). */
  damage(target: Minion, amount: number, poison?: boolean, bypassShield?: boolean, source?: Minion): void;
  /** Deal damage to `target` WITHOUT resolving its death (overkill: a body already at ≤0 still reads it). For a
   *  multi-volley Echo (Fel Spikes, gilded / Sylus / Echohorn) that hits the SAME captured targets each pass and
   *  DEFERS every death to the end via `resolveEchoDeath` — so a token a victim summons on death (Void Panther's
   *  cubs) is created after all the damage, not caught by a later volley, and a low-HP victim reads each volley's
   *  number and procs the per-volley reactors instead of vanishing after the first. */
  damageDeferred(target: Minion, amount: number, source?: Minion): void;
  /** Resolve a death that `damageDeferred` left pending: if `target` is at ≤0 and not yet dead, kill it now
   *  (firing its Deathrattle / Rise). Call after the LAST volley so consequences land once, after the damage. */
  resolveEchoDeath(target: Minion, source?: Minion): void;
  /** Run `fire` inside a multi-fire echo DEFER scope: every `resolveEchoDeath` inside it QUEUES its death, and
   *  the whole set flushes ONCE when the outermost scope closes — so a golden Echohorn's two rally triggers (or
   *  any stacked forced Echo) accumulate onto the same board with NO death resolved between them, exactly like a
   *  death-fired spray. Optional: a context without it (recruit arena, tests) runs `fire` directly, as before. */
  withEchoDefer?<T>(fire: () => T): T;
  /** Bloodbinder: arm Bleed for this fight — MARK up to `targets` random enemies now (Start of Combat), then every
   *  `everyN` attacks made in the combat (either side), deal this minion's Attack to those SAME marked enemies that
   *  are still alive (never re-rolled; ends the moment the bleeder dies). `targets` already folds in golden. */
  armBleed(minion: Minion, everyN: number, targets: number): void;
  /** Run `fn` inside a fresh presentation WAVE: every event emitted during `fn` (its direct damage, the
   *  synchronous reactor buffs those hits fire, and any deaths they resolve) is stamped with one stable `wave`
   *  id, so the replay shows them as a single simultaneous volley and inserts a short pause before the next
   *  wave. Used by multi-pass AoE echoes (Fel Spikes) to pace each pass. Purely presentational — it changes no
   *  resolution order or outcome; nesting is supported (an inner wave shadows the outer for its duration). */
  wave<T>(fn: () => T): T;
}
