/**
 * BALANCE BOT B4 — THE STRATEGY PACKAGE ROSTER (docs/balance-bot-roadmap.md, "Pilots that exercise the game").
 *
 * A PACKAGE is a strategy the game's content supports: the Ruby engine, the Dwarven Ale/Gold line, Demon Consume,
 * Beast summon/Echo, the Dragon Shout+spell engine, … Every package here is DERIVED FROM THE CONTENT: membership
 * is a predicate over the real `CardDef` (tribe, keywords, effect ids, trigger events, printed text), rune
 * affinity a predicate over the real `RuneDef` (the `runeSynergies` tag vocabulary + reward kinds + tribe gate),
 * so a content change re-derives the roster instead of leaving a stale annotation behind. The ONE hand-maintained
 * part is the hero-affinity INTENT MANIFEST (`heroes`): which hero powers help which line is a design intent,
 * not something a predicate can read off a power's `kind` — it is small, documented per entry, and reviewable.
 *
 * Doctrine (roadmap): "Priors guide construction; they do not replace engine outcomes." Nothing here scores a
 * board's strength — `packageCensus` counts what a set offers, `lines.ts` ranks fit for a run, and the strategist's
 * prior (`prior.ts`) turns membership into a SMALL term beside the fight-grounded evaluator.
 *
 * A package whose tribe a set does not field is still declared (Mech / Undead below): the census then reports it
 * with ZERO drawable members, and `lines.ts` never selects it for a run whose tribes cannot support it — the
 * roadmap's "every intended package has a competent pilot or is explicitly labeled unsupported".
 */
import { ALE_IDS, type CardDef, type RuneDef, type Tribe } from '@game/core';
import { RUNES, SETS, poolFor, runeSynergies, type SetId, type SynergyTag } from '@game/content';
import { HEROES, playableHeroes } from '../../heroes';

/** Membership strength: 0 = not a member; 1 = supporting (on-tribe body / generic enabler); 2 = an ENGINE piece
 *  (the thing the line is built around); 3 = a PAYOFF (what the engine is for). */
export type MemberScore = 0 | 1 | 2 | 3;

/** How a line likes to spend: the wave by which it wants each Shop tier (index = tier; `[,,3,5,8,11,14]` = tier
 *  2 by wave 3, 3 by 5, 4 by 8, 5 by 11, 6 by 14). Gold does not carry between turns (it resets to the max), so
 *  "hold Gold toward a tier-up" is an in-turn preference — upgrade before buying when the curve is due. */
export interface EconomyProfile {
  id: 'tempo' | 'engine' | 'economy';
  /** `tierByWave[t]` = the wave by which tier `t` should be reached (tiers 2..6). */
  tierByWave: readonly [undefined, undefined, number, number, number, number, number];
  /** Prose for the census. */
  note: string;
}

/**
 * The profiles are anchored on the REAL set-2 player curve (70 recorded runs, measured 2026-09-15 against 100
 * pinned generalist lobbies): players reach T2 by wave 2–3, T3 ~5, T4 ~8, T5 ~10, T6 ~12, holding only 1–2
 * bodies early — the generalist spent every coin on bodies and ran a full tier late (w5 2.02 vs 3.09, w8 3.94
 * vs 4.58) and was eliminated at a median round 9. `engine` IS that curve; `tempo` lags it by about a wave;
 * `economy` leads it.
 */
export const ECONOMY_PROFILES: Record<EconomyProfile['id'], EconomyProfile> = {
  // Tempo lags the player curve by ~1 wave: stats now, tier when the shop runs dry.
  tempo: { id: 'tempo', tierByWave: [undefined, undefined, 3, 6, 9, 11, 13], note: 'the player curve lagged by ~1 wave; Gold into bodies first' },
  // An engine line rides the measured player curve: its tier-3/4 pieces arrive when players find theirs.
  engine: { id: 'engine', tierByWave: [undefined, undefined, 3, 5, 8, 10, 12], note: 'the measured set-2 player tier curve' },
  // Economy-to-tier leads the curve by ~1 wave: T2 at wave 2, T3 at 4, T4 at 7, T5 at 9, T6 at 11.
  economy: { id: 'economy', tierByWave: [undefined, undefined, 2, 4, 7, 9, 11], note: 'the player curve led by ~1 wave' },
};

export interface StrategyPackage {
  id: string;
  name: string;
  /** The tribe(s) the line is built on. Empty = tribe-agnostic. */
  tribes: readonly Tribe[];
  /** When true the line is UNSUPPORTED on a run that rolled none of `tribes` (fit 0). Tribe-agnostic lines and
   *  lines with a neutral core leave it false. */
  requiresTribe: boolean;
  /** Membership predicate over the real card definition. */
  member: (def: CardDef) => MemberScore;
  /** The `runeSynergies` tags that mark a rune as affine. */
  runeTags: readonly SynergyTag[];
  /** An extra rune-text predicate for affinity the tag vocabulary is too coarse for (optional). */
  runeText?: RegExp;
  /** HERO INTENT MANIFEST: hero id → affinity multiplier (>1 helps, <1 hinders; absent = 1). Hand-maintained. */
  heroes: Readonly<Record<string, number>>;
  economy: EconomyProfile;
  /** How much the line depends on finding specific pieces before it pays. */
  risk: 'low' | 'medium' | 'high';
  summary: string;
}

// ── shared predicate helpers ───────────────────────────────────────────────────────────────────────────────

const onTribe = (def: CardDef, tribe: Tribe): boolean => def.tribe === tribe || def.tribe2 === tribe || !!def.universalTribe;
const hasEffect = (def: CardDef, re: RegExp): boolean => def.effects.some((e) => re.test(e.do));
const hasTrigger = (def: CardDef, re: RegExp): boolean => def.effects.some((e) => re.test(e.on));
const text = (def: CardDef, re: RegExp): boolean => re.test(def.text) || (!!def.goldenText && re.test(def.goldenText));
const kw = (def: CardDef, k: string): boolean => def.keywords.includes(k as never);
const drawable = (def: CardDef): boolean => !def.token && !def.henchman && !def.gift && !def.rewardSpell;

// ── the roster ─────────────────────────────────────────────────────────────────────────────────────────────

export const STRATEGY_PACKAGES: readonly StrategyPackage[] = [
  {
    id: 'ruby',
    name: 'Ruby engine (Kobold)',
    tribes: ['kobold'],
    requiresTribe: true,
    member: (def) => {
      if (def.ruby) return 1;
      const rubyText = text(def, /\brub(?:y|ies)\b/i) || hasEffect(def, /rub(y|ies)/i);
      // Payoffs multiply or mass-apply Rubies; engines generate or improve them; any Kobold body supports.
      if (rubyText && (hasEffect(def, /PlayRubies|rubyStatMultiplier|StealAdjacentRubies|BuffShopByRuby/i) || text(def, /\bcast\b.*\brub/i))) return 3;
      if (rubyText) return 2;
      if (onTribe(def, 'kobold')) return 1;
      return 0;
    },
    runeTags: ['ruby', 'kobold'],
    heroes: {
      fibbsy: 1.6, // Get 2 Rubies, twice a turn — the engine's own fuel
      rohan: 1.3, // starts with a Reflector: Rubies cast on it also land elsewhere
      myra: 1.1, // replays Chipwick / Excavator Shouts
    },
    economy: ECONOMY_PROFILES.engine,
    risk: 'medium',
    summary: 'Generate Rubies, improve them, then mass-cast them onto Kobolds (Kobebes, Excavator, Kobe).',
  },
  {
    id: 'ale',
    name: 'Ale & Gold (Dwarf)',
    tribes: ['dwarf'],
    requiresTribe: true,
    member: (def) => {
      if (ALE_IDS.includes(def.id)) return 1;
      const ale = text(def, /\bales?\b/i) || hasEffect(def, /Ale/);
      const gold = hasTrigger(def, /^goldSpent$/) || text(def, /\bspend\b.*\bGold\b/i);
      if (onTribe(def, 'dwarf') && (ale || gold) && (text(def, /\btwice\b|every|\+\d+\/\+\d+ for every/i) || hasEffect(def, /PerAle|goldSpentBuff|goldSpentGrant|goldSpentGet/))) return 3;
      if (ale || gold) return 2;
      if (onTribe(def, 'dwarf')) return 1;
      return 0;
    },
    runeTags: ['ale', 'dwarf', 'gold'],
    heroes: {
      flint: 1.6, // Dwarves cost 2 Gold
      nadja: 1.3, // +1 max Gold: more spend per turn for the Gold-spent triggers
      baggerben: 1.2, // Rascal's banked Gold spikes a spend turn
      gambler: 1.2,
      bram: 1.1,
    },
    economy: ECONOMY_PROFILES.engine,
    risk: 'medium',
    summary: 'Spend Gold to trigger Dwarf buffs; brew Ales (Brunni, Brewer, Tapkeeper) for Edward / Bucky / Kegheart payoffs.',
  },
  {
    id: 'demonConsume',
    name: 'Demon Consume',
    tribes: ['demon'],
    requiresTribe: true,
    member: (def) => {
      const consume = kw(def, 'CN') || kw(def, 'FD') || text(def, /\bconsumes?\b/i) || hasEffect(def, /Consume/);
      const shopBuff = hasEffect(def, /buffShop|RightmostSlot|ShopRightmost|BuffShop|Shop\b/) || text(def, /\bin the shop\b/i);
      if (consume && (onTribe(def, 'demon') || def.spell)) return 3;
      if (shopBuff && onTribe(def, 'demon')) return 2;
      if (shopBuff || consume) return 2;
      if (onTribe(def, 'demon') || def.imp) return 1;
      return 0;
    },
    runeTags: ['consume', 'demon'],
    runeText: /\bshop\b.*\+\d+\/\+\d+|\bimps?\b/i,
    heroes: {
      devourer: 1.3, // Consume a friendly minion — the same mechanic, fed by the Shop buffs
      frank: 1.2, // cheap refreshed Shops to eat
      harlan: 1.2, // Buyout takes every buffed offer
      pete: 1.1,
    },
    economy: ECONOMY_PROFILES.engine,
    risk: 'medium',
    summary: 'Buff the Shop permanently (Butcher, Tormentor, Defiler), then Consume the buffed offers (Agent, Chipper, Blart, Cupcakes).',
  },
  {
    id: 'beastSummon',
    name: 'Beast summon & Echo',
    tribes: ['beast'],
    requiresTribe: true,
    member: (def) => {
      const beast = onTribe(def, 'beast');
      const summons = hasEffect(def, /Summon|summon/) || text(def, /\bsummons?\b/i);
      const onSummon = hasTrigger(def, /^onSummon$/) || text(def, /\bBeast Aura\b|whenever you summon|when you summon/i);
      if (beast && onSummon) return 3;
      if (beast && (summons || hasTrigger(def, /^onDeath$/))) return 2;
      if (def.spell && summons) return 1;
      if (beast) return 1;
      return 0;
    },
    runeTags: ['beast', 'summon'],
    heroes: {
      rayse: 1.5, // minions summoned in combat gain +2/+3 and Taunt
      soren: 1.3, // resummon a copy at Start of Combat: a summon
      cindara: 1.2, // Whelps summoned on Avenge
      xerox: 1.1,
    },
    economy: ECONOMY_PROFILES.engine,
    risk: 'medium',
    summary: 'Echo bodies that summon Beasts (T-Rex, Bullseye, Mammoth) into the Beast Aura / on-summon payoffs (Beardsley, Oona, Kennelmaster).',
  },
  {
    id: 'dragon',
    name: 'Dragon Shout & spell',
    tribes: ['dragon'],
    requiresTribe: true,
    member: (def) => {
      const dragon = onTribe(def, 'dragon');
      const shout = hasTrigger(def, /^(onPlay|battlecryTriggered)$/) || text(def, /\bShouts?\b|\bBattlecry\b/i);
      const spell = hasTrigger(def, /^(spellCast|spellCastOnThis)$/) || hasEffect(def, /GrantSpell|GrantRandomSpell|CopyCastSpell|CastNamedSpell/) || text(def, /\bShop spells?\b/i);
      if (dragon && (hasTrigger(def, /^(battlecryTriggered|spellCast|spellCastOnThis)$/) || hasEffect(def, /TriggerTribeShouts|CastNamedSpell|BuffTribe/))) return 3;
      if (dragon && (shout || spell)) return 2;
      if (!dragon && (def.triggerMultiplier?.families?.includes('battlecry') || text(def, /\bShouts?\b.*\b(twice|additional)\b/i) || text(def, /\bDragons?\b/i))) return 2;
      if (dragon) return 1;
      return 0;
    },
    runeTags: ['dragon', 'shout'],
    heroes: {
      tiff: 1.6, // Discover a Dragon
      drakko: 1.4, // buy 5 Shout minions → Drakko (Shouts twice)
      myra: 1.4, // replay a Shout (Karwind / Embermouth payoffs)
      merrin: 1.2, // a free Shop spell for the spell-side Dragons
      hunch: 1.2,
    },
    economy: ECONOMY_PROFILES.engine,
    risk: 'medium',
    summary: 'Shout Dragons under Karwind / Embermouth / Embercrest, and the spell-side Dragons (Earthbreaker, Mirrorwing, Warden).',
  },
  {
    id: 'spellEngine',
    name: 'Spell engine',
    tribes: [],
    requiresTribe: false,
    member: (def) => {
      if (hasTrigger(def, /^(spellCast|spellCastOnThis|spellBought)$/) || hasEffect(def, /SpellPower|spellCopy|CopyCastSpell|DoubleNextSpell|spellGainSpellPower|Grimoire/) || def.triggerMultiplier?.families?.some((f) => /spell/i.test(f))) return 3;
      if (text(def, /\bShop spells?\b.*\b(twice|again|additional|copy|cost)\b/i) || text(def, /\btargeted\b.*\bspells?\b/i)) return 3;
      if (def.spell && !def.ruby && (hasEffect(def, /Discover|GrantRandomSpell|spellRefreshToSpells|spellReplayBattlecry/) || text(def, /\bDiscover\b.*\bspell\b/i))) return 2;
      if (hasEffect(def, /GrantSpell|GrantRandomSpell/) || text(def, /\bget a (?:random )?(?:Tier \d )?Spell\b/i)) return 2;
      if (!def.spell && text(def, /\bShop spells?\b/i)) return 2; // Spellsword's Choose One, Wardkeeper: Spell Power without an effect id
      if (def.spell && !def.ruby && !ALE_IDS.includes(def.id)) return 1;
      return 0;
    },
    runeTags: ['spells'],
    heroes: {
      merrin: 1.5, // a random Shop spell every turn
      hunch: 1.5, // copy the last spell cast
      vale: 1.4, // +1/+1 per spell cast this game at Start of Combat
      tiff: 1.1,
    },
    economy: ECONOMY_PROFILES.engine,
    risk: 'high',
    summary: 'Cast Shop spells for the cast-count payoffs (Earthbreaker, Fatecarver, Vaultkeeper) with Spell Power and recursion (Steward, Nimbus, Yazzus).',
  },
  {
    id: 'echo',
    name: 'Echo & Rise (Undead)',
    tribes: ['undead'],
    // The Echo line has a NEUTRAL core (Sylus, Zyff, Echo Mimic, Corpse Board) and every tribe fields Echo bodies,
    // so it stays selectable without the Undead tribe — with reduced availability (`lines.ts`).
    requiresTribe: false,
    member: (def) => {
      const echo = hasTrigger(def, /^onDeath$/) || text(def, /\bEcho\b|\bDeathrattle\b/i);
      const rise = kw(def, 'R') || hasTrigger(def, /^onRise$/) || text(def, /\bRise\b|\bReborn\b/i);
      if (def.triggerMultiplier?.families?.includes('deathrattle') || hasEffect(def, /ProcLeftmostEcho|TriggerLeftmostEchoes|GainEcho|TriggerAdjacentEcho/) || text(def, /\bEcho(?:es)?\b.*\b(twice|additional|trigger)\b/i)) return 3;
      if (onTribe(def, 'undead') && (echo || rise)) return 3;
      if ((def.spell && (echo || rise)) || (echo && hasEffect(def, /Summon/))) return 2;
      if (echo || rise) return 1;
      if (onTribe(def, 'undead')) return 1;
      return 0;
    },
    runeTags: ['echo', 'undead'],
    heroes: {
      risen: 1.5, // give a minion Rise
      underdweller: 1.3, // Discover a minion that died last combat
      soren: 1.2, // destroy-and-resummon triggers the Echo
    },
    economy: ECONOMY_PROFILES.engine,
    risk: 'medium',
    summary: 'Echo bodies under Sylus / Zyff / Echohorn / Spots multipliers; Rise where the set fields it.',
  },
  {
    id: 'mechAttach',
    name: 'Mech & Attachment',
    tribes: ['mech'],
    requiresTribe: true,
    member: (def) => {
      if (kw(def, 'M')) return 3;
      if (text(def, /\bAttachments?\b|\bMagnetic\b/i)) return 2;
      if (onTribe(def, 'mech')) return 1;
      return 0;
    },
    runeTags: ['mech'],
    runeText: /\battachments?\b/i,
    heroes: { chaos: 1.5 },
    economy: ECONOMY_PROFILES.tempo,
    risk: 'medium',
    summary: 'Magnetic Attachments stacked onto Mech bodies (set 1 only today).',
  },
  {
    id: 'rally',
    name: 'Rally',
    tribes: [],
    requiresTribe: false,
    member: (def) => {
      const rally = kw(def, 'RL') || hasTrigger(def, /^onAttack$/);
      if (def.triggerMultiplier?.families?.includes('rally') || hasEffect(def, /^onRally|RallyDouble|rallyRepeat/) || text(def, /\bRall(?:y|ies)\b.*\b(twice|additional|trigger)\b/i) || text(def, /\bwhen(?:ever)? you trigger a \*{0,2}Rally/i)) return 3;
      if (rally && (hasEffect(def, /Tribe|All|Others|Spread/) || kw(def, 'W'))) return 2;
      if (rally) return 1;
      return 0;
    },
    runeTags: ['rally'],
    heroes: {
      gorun: 1.4, // +3 Attack when your minions attack: every Rally body swings harder
      aevor: 1.1,
    },
    economy: ECONOMY_PROFILES.tempo,
    risk: 'medium',
    summary: 'Rally bodies (Blazer, Boulderdash, Standard Bearer) with the on-Rally payoffs (Paragon, Hawkus, Mineral Master) and Flurry.',
  },
  {
    id: 'tempo',
    name: 'Tempo (stats)',
    tribes: [],
    requiresTribe: false,
    member: (def) => {
      if (def.spell) {
        if (def.ruby || ALE_IDS.includes(def.id)) return 0;
        // Stats NOW is the payoff of a tempo line: a stat spell is what it spends on.
        return hasEffect(def, /^spellBuff|spellSetStats|spellGild|buffOnePerTribe/) ? 3 : 0;
      }
      if (def.token) return 0;
      const combatKw = ['T', 'DS', 'W', 'C', 'V', 'CR'].filter((k) => kw(def, k)).length;
      const stats = def.attack + def.health;
      const perTier = stats / Math.max(1, def.tier + 1);
      // A body that is ALL stats — no effects, no Choose One, no trigger multiplier, and a text that names at most
      // its keywords (bold words + punctuation) — either above curve or carrying combat keywords.
      const keywordOnlyText = def.text.replace(/\*\*[^*]+\*\*|[.,\s]/g, '') === '';
      const vanilla = def.effects.length === 0 && !def.chooseOne?.length && !def.triggerMultiplier && keywordOnlyText;
      if (vanilla && (perTier >= 2.4 || combatKw >= 2)) return 3;
      if (vanilla || (combatKw >= 1 && perTier >= 2.2)) return 2;
      if (text(def, /\bgive (?:a|your|adjacent)\b.*\+\d+\/\+\d+/i) && !text(def, /\brub|ale\b/i)) return 1;
      return 0;
    },
    runeTags: [],
    runeText: /\+\d+\/\+\d+|\bWard\b|\bdouble the stats\b|\btriple its Health\b|\bGilded\b/i,
    heroes: {
      warden: 1.3, // Ward + Attack for Gold
      indy: 1.2, // gild one minion
      gildmaster: 1.2,
      midas: 1.2,
      gorun: 1.2,
      aevor: 1.1,
      keshi: 1.1,
    },
    economy: ECONOMY_PROFILES.tempo,
    risk: 'low',
    summary: 'Biggest bodies and keywords for the tier, stat spells on them; tiers late.',
  },
  {
    id: 'economy',
    name: 'Economy to tier',
    tribes: [],
    requiresTribe: false,
    member: (def) => {
      const gold = hasEffect(def, /^gainEmbers|gainMaxMana|GoldNextTurn|BonusGold|spellGoldIfLostLast|NextSellBonus|grantFreeRolls|spellLayaway/) || text(def, /\bgain\b.*\bGold\b|\bmax(?:imum)? Gold\b/i);
      const tierPull = hasEffect(def, /DiscoverMinion|onSellDiscover|spellRefreshTierUp|TransformLeftTierUp|spellGambleTierPull/) || text(def, /\bDiscover\b.*\b(?:Tier [4567]|one tier higher|one Tier above)\b/i) || text(def, /\bTier 6\b|\bTier 7\b/i);
      if (def.spell && gold) return 3;
      if (tierPull) return 3;
      if (gold) return 2;
      if (hasTrigger(def, /^onSell$/) && text(def, /\bget\b/i)) return 1;
      return 0;
    },
    runeTags: ['gold'],
    runeText: /\bDiscover\b.*\bTier [4567]\b|\bupgrade cost\b|\bmax(?:imum)? Gold\b/i,
    heroes: {
      nadja: 1.5, // +1 max Gold
      emeraldwarden: 1.5, // a minion from the new tier on every tier-up
      bram: 1.3,
      gambler: 1.3,
      baggerben: 1.3,
      discodan: 1.3,
      brackus: 1.2,
      robin: 1.2,
      hermithank: 1.2,
    },
    economy: ECONOMY_PROFILES.economy,
    risk: 'high',
    summary: 'Gold spells and Gold-next-turn bodies into an early tier climb, cashed in through tier Discovers (Joker, Salvatore, Beyond the Summit).',
  },
];

export const PACKAGE_INDEX: Readonly<Record<string, StrategyPackage>> = Object.fromEntries(STRATEGY_PACKAGES.map((p) => [p.id, p]));

export function packageById(id: string): StrategyPackage {
  const p = PACKAGE_INDEX[id];
  if (!p) throw new Error(`balance/strategy: unknown package '${id}' (known: ${STRATEGY_PACKAGES.map((x) => x.id).join(', ')})`);
  return p;
}

// ── rune affinity ──────────────────────────────────────────────────────────────────────────────────────────

/** Is this rune offerable at all in `setId` (the forge's own `sets` gate)? */
export const runeInSet = (rune: RuneDef, setId: SetId): boolean => !rune.sets || rune.sets.includes(setId);

/**
 * How well a rune serves a package, in [0, 1]: 1 when a synergy tag matches the package's own tags, 0.7 when
 * only the package's extra text predicate matches, 0 otherwise. Availability (set / run tribes) is NOT folded in
 * — the forge already filters offers; `lines.ts` and the prior apply it where the run is known.
 */
export function runeAffinity(pkg: StrategyPackage, rune: RuneDef): number {
  const tags = runeSynergies(rune);
  if (pkg.runeTags.some((t) => tags.includes(t))) return 1;
  if (pkg.runeText && pkg.runeText.test(rune.text)) return 0.7;
  return 0;
}

/** A rune that pays EVERY TURN (its value scales with the rounds left) versus a one-shot grant. Read off the
 *  reward kind first, the printed text second. */
export function runeIsRecurring(rune: RuneDef): boolean {
  const k = rune.reward.kind;
  if (/^(grant|gainGold|discover|mintRubies|multi|scheduleRuneforge|runeTreasureMap|runeAltar|runeEvolution|runeTop|runeSummit|runePair)$/i.test(k)) {
    // `multi` mixes: a recurring text wins.
    if (k !== 'multi') return false;
  }
  // "Once per run" / "(Once)" / a single reached threshold are one-shots however they are phrased.
  if (/\bonce\b|\bwhen you reach\b|\bin \d+ turns\b/i.test(rune.text) && !/\brepeat/i.test(rune.text)) return false;
  return /\b(every|each|whenever|end of turn|start of turn|when you|after you|per|first .* each)\b/i.test(rune.text);
}

// ── census ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface PackageMember { cardId: string; name: string; tier: number; score: MemberScore; spell: boolean }

export interface PackageCensusRow {
  id: string;
  name: string;
  tribes: readonly Tribe[];
  /** The set fields at least one of the package's tribes (tribe-agnostic packages are always supported). */
  tribeSupported: boolean;
  members: number;
  engines: number;
  payoffs: number;
  /** Top ~8 members by score then tier (highest first) then pool order. */
  keyCards: PackageMember[];
  affineRunes: number;
  affineRuneIds: string[];
  affineHeroes: string[];
  economy: EconomyProfile['id'];
  risk: StrategyPackage['risk'];
  /** Explicit label — a package with no drawable members in this set cannot be piloted here. */
  status: 'supported' | 'thin' | 'unsupported';
}

/** Every drawable member of `pkg` in `setId`'s pool, in pool order. */
export function packageMembers(pkg: StrategyPackage, setId: SetId): PackageMember[] {
  const out: PackageMember[] = [];
  for (const def of poolFor(setId).all) {
    if (!drawable(def)) continue;
    const score = pkg.member(def);
    if (score > 0) out.push({ cardId: def.id, name: def.name, tier: def.tier, score, spell: !!def.spell });
  }
  return out;
}

export function keyCardsOf(pkg: StrategyPackage, setId: SetId, limit = 8): PackageMember[] {
  return [...packageMembers(pkg, setId)]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.score - a.m.score || b.m.tier - a.m.tier || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.m);
}

/** The set's census row for one package — what the roster derives from the content today. */
export function packageCensusRow(pkg: StrategyPackage, setId: SetId): PackageCensusRow {
  const setTribes: readonly Tribe[] = SETS[setId]?.tribes ?? [];
  const tribeSupported = pkg.tribes.length === 0 || pkg.tribes.some((t) => setTribes.includes(t));
  const members = packageMembers(pkg, setId);
  const engines = members.filter((m) => m.score === 2).length;
  const payoffs = members.filter((m) => m.score === 3).length;
  const affine = RUNES.filter((r) => runeInSet(r, setId) && (!r.tribes || r.tribes.some((t) => setTribes.includes(t))) && runeAffinity(pkg, r) > 0);
  const heroes = playableHeroes(setTribes).filter((h) => (pkg.heroes[h.id] ?? 1) > 1).map((h) => h.id);
  const usable = tribeSupported || !pkg.requiresTribe;
  const status: PackageCensusRow['status'] = !usable || members.length === 0 ? 'unsupported' : payoffs === 0 || members.length < 6 ? 'thin' : 'supported';
  return {
    id: pkg.id, name: pkg.name, tribes: pkg.tribes, tribeSupported,
    members: members.length, engines, payoffs,
    keyCards: keyCardsOf(pkg, setId),
    affineRunes: affine.length, affineRuneIds: affine.map((r) => r.id),
    affineHeroes: heroes,
    economy: pkg.economy.id, risk: pkg.risk, status,
  };
}

export function packageCensus(setId: SetId): PackageCensusRow[] {
  return STRATEGY_PACKAGES.map((p) => packageCensusRow(p, setId));
}

/** Markdown for the CLI / a test snapshot. */
export function renderPackageCensus(setId: SetId): string {
  const rows = packageCensus(setId);
  const lines = [
    `## Strategy packages — ${setId}`,
    '',
    '| package | tribes | status | members (eng/pay) | affine runes | affine heroes | economy | risk | key cards |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.tribes.join('/') || '—'} | ${r.status} | ${r.members} (${r.engines}/${r.payoffs}) | ${r.affineRunes} | ${r.affineHeroes.join(', ') || '—'} | ${r.economy} | ${r.risk} | ${r.keyCards.map((k) => `${k.name} (T${k.tier}${k.spell ? ' spell' : ''})`).join(', ')} |`);
  }
  return lines.join('\n');
}

/** Hero ids the intent manifest names that do not exist — a test pins this empty. */
export function unknownManifestHeroes(): string[] {
  const ids = new Set(HEROES.map((h) => h.id));
  const bad: string[] = [];
  for (const p of STRATEGY_PACKAGES) for (const id of Object.keys(p.heroes)) if (!ids.has(id)) bad.push(`${p.id}:${id}`);
  return bad;
}
