import { CARD_INDEX } from '@game/content';
import type { CardDef, Keyword } from '@game/core';
import type { BoardSnapshot } from '../../snapshot';
import type { BotVisibleState } from '../../productionBots/types';

/**
 * LEARNED VALUE — the ONE feature function (balance roadmap: "train a continuation model only after the
 * trajectories are valid"; owner 2026-09-15: "figure out how to make these bots strong enough to actually win").
 *
 * Training rows (the recorded player corpus + pinned-lobby pilot rounds) and inference (the pilot's
 * `BotVisibleState` mid-turn) both go through `featuresOfInput`. There is deliberately no second path: a feature
 * computed one way in the dataset builder and another way in the evaluator is the drift the roadmap warns about,
 * and it is invisible until the term quietly scores every board wrong.
 *
 * LEAKAGE RULES. Every feature is derived from what the PLAYER can see on their own screen at the end of a recruit
 * turn: the board, the hand, Gold, tier, own Resolve/Armor, the wave. Nothing from the opponent, the future shop,
 * the run seed or the fight result goes in. A recorded snapshot has no Gold, so that feature is `null` there and
 * is imputed to the wave mean (a standardised 0) rather than faked as 0 Gold.
 *
 * MECHANIC BUCKETS. Each minion's `CARD_INDEX[cardId].effects[]` is classified by `(on, do)` into the buckets
 * below (a card may land in several). The rules are on the effect VOCABULARY (`GameEventSchema` /
 * `EffectFactoryIdSchema` in `packages/content/src/schema.ts`), not on card ids, so a new card is bucketed the day
 * it ships. `MECHANIC_BUCKETS` documents each rule in words for the report.
 */

export interface ValueBody {
  cardId: string;
  attack: number;
  health: number;
  keywords: readonly Keyword[];
  golden?: boolean;
}

/** What the feature function reads. `null` = genuinely unknown for this row (imputed), never "zero". */
export interface ValueInput {
  wave: number;
  tier: number;
  board: readonly ValueBody[];
  /** Hand card ids (minions + spells). `null` when the source does not record the hand. */
  hand: readonly { cardId: string; golden?: boolean }[] | null;
  /** Gold left at the end of the recruit turn. `null` on a recorded snapshot (never captured). */
  goldUnspent: number | null;
  /** Own Resolve + Armor. `null` when unknown. */
  effectiveHp: number | null;
}

/**
 * The tier a competent recorded player holds at each wave — the diagnosis of 2026-09-15 (100 pinned lobbies): T2
 * by wave 2–3, T3 ≈ 5, T4 ≈ 8, T5 ≈ 10, T6 ≈ 12. A fixed table (not re-derived per dataset) so the feature means
 * the same thing in training and in the evaluator.
 */
export const EXPECTED_TIER_BY_WAVE: readonly number[] = [1, 1, 1.5, 2, 2.5, 3, 3.3, 3.7, 4, 4.5, 5, 5.5, 6];
export const expectedTier = (wave: number): number =>
  EXPECTED_TIER_BY_WAVE[Math.max(0, Math.min(EXPECTED_TIER_BY_WAVE.length - 1, Math.round(wave)))]!;

/** The keywords counted individually; everything else lands in `kw_other`. */
export const COUNTED_KEYWORDS: readonly Keyword[] = ['T', 'DS', 'W', 'R', 'C', 'V', 'SC', 'RL', 'CR', 'M'];
export const COUNTED_TRIBES = ['beast', 'undead', 'mech', 'dragon', 'demon', 'kobold', 'dwarf', 'celestial', 'spirit', 'neutral'] as const;

export interface MechanicBucket {
  id: string;
  /** Plain-English rule, printed in the report so the owner can read what the bucket means. */
  rule: string;
  test: (on: string, does: string) => boolean;
}

const SHOP_TURN_EVENTS = new Set(['endOfTurn', 'startOfTurn', 'goldSpent', 'cardsBought', 'cardsPlayed', 'onBuy', 'spellBought', 'shopRefreshed', 'minionSold', 'onSell', 'onGainCard', 'onGetRuby', 'rubyPlayedAnywhere', 'onRubyPlayed', 'starformGained']);
const PLAY_EVENTS = new Set(['onPlay', 'onSummon', 'onTribePlayed', 'battlecryTriggered', 'chooseOnePlayed', 'orbit', 'orbitFired']);
const DEATH_EVENTS = new Set(['onDeath', 'onRise', 'avenge']);
const SPELL_EVENTS = new Set(['spellCast', 'cast', 'spellCastOnThis', 'spellBought']);
const COMBAT_EVENTS = new Set(['onAttack', 'startOfCombat', 'onKill', 'onDamaged', 'friendlyDemonDealtDamage', 'onLoseDivineShield', 'onGainAttack']);

export const MECHANIC_BUCKETS: readonly MechanicBucket[] = [
  { id: 'mech_perTurn', rule: 'fires every shop turn: on endOfTurn / startOfTurn / goldSpent / cardsBought / onBuy / onSell / shopRefreshed / Ruby-got (a per-turn scaler)', test: (on) => SHOP_TURN_EVENTS.has(on) },
  { id: 'mech_onPlay', rule: 'fires when a card is played or summoned: onPlay / onSummon / onTribePlayed / battlecryTriggered / Orbit (Shout and play-synergy scalers)', test: (on) => PLAY_EVENTS.has(on) },
  { id: 'mech_death', rule: 'fires on death: onDeath / onRise / avenge (Echo, Rise and Avenge — deathrattle value)', test: (on) => DEATH_EVENTS.has(on) },
  { id: 'mech_summon', rule: 'the effect id names a Summon (tokens that arrive mid-fight or on play)', test: (_on, does) => /summon/i.test(does) },
  { id: 'mech_spell', rule: 'spell synergy: on spellCast / cast / spellCastOnThis / spellBought, or an effect that grants, casts, copies or empowers a spell', test: (on, does) => SPELL_EVENTS.has(on) || /spell/i.test(does) },
  { id: 'mech_ruby', rule: 'the Ruby engine (Set 2 Kobolds): on a Ruby event, or an effect whose id names Ruby / Rubies', test: (on, does) => /rub(y|ies)/i.test(does) || /rub(y|ies)/i.test(on) },
  { id: 'mech_ale', rule: 'the Ale economy (Set 2 Dwarves): an effect whose id names Ale(s)', test: (_on, does) => /ale(s)?(?=[A-Z]|$)/.test(does) || /grantRandomAle|PerAle|grantAles/.test(does) },
  { id: 'mech_consume', rule: 'Consume: on onConsume, or an effect whose id names Consume', test: (on, does) => on === 'onConsume' || /consume/i.test(does) },
  { id: 'mech_attach', rule: 'Attachments / Magnetic / Mech welding: an effect whose id names attach, magnetic or weld', test: (_on, does) => /attach|magnetic|weld/i.test(does) },
  { id: 'mech_combat', rule: 'combat-time scaling: on onAttack (Rally) / startOfCombat / onKill / onDamaged / demon-damage / shield-break', test: (on) => COMBAT_EVENTS.has(on) },
  { id: 'mech_shopBuff', rule: 'permanent or per-turn shop buffs: an effect whose id names buffShop, a permanent slot buff or the tavern', test: (_on, does) => /buffShop|ShopPermanent|SlotPermanent|tavern|buffShopOffers/i.test(does) },
  { id: 'mech_generate', rule: 'card generation: Discover, gain/grant a minion or spell, or a card to hand', test: (_on, does) => /discover|gainRandomMinion|grantMinion|grantRandomTribeMinion|grantTribeMinion|grantCardToHand|grantSpell|grantRandomSpell/i.test(does) },
];

/** Feature names, in the exact column order `featuresOfInput` emits. `wave` MUST stay at index 0 (the band key). */
export const VALUE_FEATURE_NAMES: readonly string[] = [
  'wave', 'tier', 'tierGap', 'goldUnspent', 'boardSize', 'handSize', 'totalAttack', 'totalHealth', 'logTotalStats',
  'maxAttack', 'maxHealth', 'goldenCount', 'avgMinionTier', 'maxMinionTier', 'pairsHeld', 'effectiveHp',
  ...COUNTED_KEYWORDS.map((k) => `kw_${k}`), 'kw_other',
  ...COUNTED_TRIBES.map((t) => `tribe_${t}`), 'dominantShare',
  ...MECHANIC_BUCKETS.map((b) => b.id),
];

/** Per-card bucket membership, memoised (the card pool is static). */
const bucketCache = new Map<string, readonly number[]>();
export function bucketsOfCard(cardId: string): readonly number[] {
  const hit = bucketCache.get(cardId);
  if (hit) return hit;
  const def: CardDef | undefined = CARD_INDEX[cardId];
  const out = MECHANIC_BUCKETS.map((b) => (def ? (def.effects.some((e) => b.test(e.on, e.do)) ? 1 : 0) : 0));
  bucketCache.set(cardId, out);
  return out;
}

/** The feature vector. `null` entries are unknown-for-this-row and are imputed by the model's standardisation. */
export function featuresOfInput(x: ValueInput): (number | null)[] {
  const defs = x.board.map((c) => CARD_INDEX[c.cardId]);
  const n = x.board.length;
  let totalAttack = 0, totalHealth = 0, maxAttack = 0, maxHealth = 0, golden = 0, tierSum = 0, maxTier = 0;
  const kw = new Map<string, number>();
  let kwOther = 0;
  const tribes = new Map<string, number>();
  const buckets = new Array<number>(MECHANIC_BUCKETS.length).fill(0);
  x.board.forEach((c, i) => {
    totalAttack += c.attack; totalHealth += c.health;
    if (c.attack > maxAttack) maxAttack = c.attack;
    if (c.health > maxHealth) maxHealth = c.health;
    if (c.golden) golden++;
    const def = defs[i];
    const t = def?.tier ?? 1;
    tierSum += t; if (t > maxTier) maxTier = t;
    for (const k of c.keywords) {
      if ((COUNTED_KEYWORDS as readonly string[]).includes(k)) kw.set(k, (kw.get(k) ?? 0) + 1);
      else kwOther++;
    }
    const tribe = def?.tribe ?? 'neutral';
    tribes.set(tribe, (tribes.get(tribe) ?? 0) + 1);
    if (def?.tribe2) tribes.set(def.tribe2, (tribes.get(def.tribe2) ?? 0) + 1);
    const b = bucketsOfCard(c.cardId);
    for (let j = 0; j < b.length; j++) buckets[j]! += b[j]!;
  });
  const copies = new Map<string, number>();
  for (const c of [...x.board, ...(x.hand ?? [])]) if (!c.golden) copies.set(c.cardId, (copies.get(c.cardId) ?? 0) + 1);
  let pairs = 0;
  for (const k of copies.values()) pairs += Math.floor(k / 2);
  let dominant = 0;
  for (const [t, k] of tribes) if (t !== 'neutral' && k > dominant) dominant = k;
  return [
    x.wave, x.tier, x.tier - expectedTier(x.wave), x.goldUnspent, n, x.hand ? x.hand.length : null,
    totalAttack, totalHealth, Math.log1p(totalAttack + totalHealth),
    maxAttack, maxHealth, golden, n ? tierSum / n : 0, maxTier, pairs, x.effectiveHp,
    ...COUNTED_KEYWORDS.map((k) => kw.get(k) ?? 0), kwOther,
    ...COUNTED_TRIBES.map((t) => tribes.get(t) ?? 0), n ? dominant / n : 0,
    ...buckets,
  ];
}

/** The pilot's own visible state, mid- or end-of-turn. Reads nothing hidden (the projection already withholds it). */
export function featuresOf(v: BotVisibleState): (number | null)[] {
  return featuresOfInput({
    wave: v.wave,
    tier: v.economy.tier,
    board: v.board,
    hand: v.hand,
    goldUnspent: v.economy.gold,
    effectiveHp: v.hero.resolve + v.hero.armor,
  });
}

/** A recorded board (the corpus, or a pinned round's snapshot). `wave` overrides the snapshot's when given. */
export function featuresOfSnapshot(s: BoardSnapshot, wave = s.wave, ctx: { goldUnspent?: number | null; hand?: readonly { cardId: string; golden?: boolean }[] | null } = {}): (number | null)[] {
  const hand = ctx.hand !== undefined
    ? ctx.hand
    : [...(s.handMinions ?? []).map((m) => ({ cardId: m.cardId, golden: m.golden })), ...(s.handSpellIds ?? []).map((cardId) => ({ cardId }))];
  return featuresOfInput({
    wave,
    tier: s.tier,
    board: s.minions.map((m) => ({ cardId: m.cardId, attack: m.attack, health: m.health, keywords: m.keywords ?? [], golden: m.golden })),
    hand,
    goldUnspent: ctx.goldUnspent ?? null,
    effectiveHp: s.resolve + (s.armor ?? 0),
  });
}
