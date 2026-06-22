import { z } from 'zod';

/**
 * Runtime validation for card data (handoff C.5). The hand-written `CardDef`
 * type in `@game/core` is the canonical compile-time shape; this schema guards
 * the *data* at load and is kept in lockstep with it.
 */
export const TribeSchema = z.enum(['beast', 'undead', 'mech', 'dragon', 'demon', 'neutral']);

export const KeywordSchema = z.enum(['T', 'DS', 'V', 'W', 'R', 'C', 'M', 'SC', 'CN', 'FD', 'IMM', 'ST', 'RL', 'EG']);

export const GameEventSchema = z.enum([
  'onPlay',
  'onSummon',
  'onDeath',
  'onAttack',
  'onDamaged',
  'onLoseDivineShield',
  'onConsume',
  'onKill',
  'startOfCombat',
  'avenge',
  'onBuy',
  'onSell',
  'endOfTurn',
  'battlecryTriggered',
  'cast',
  'spellCast',
  'summonOverflow',
]);

export const EffectFactoryIdSchema = z.enum([
  'deathrattleSummon',
  'buffOnSummon',
  'deathrattleBuffTribe',
  'reAttackOnKill',
  'onKillBuffSelf',
  'deathrattleDamageAll',
  'deathrattleDestroyKiller',
  'deathrattleBuffTribeByTally',
  'scDamage',
  'scSplitDamage',
  'scAoePerTribe',
  'deathrattleBuffRandom',
  'onFriendDeathBuffRandom',
  'rallyBuff',
  'rallyProcDeathrattle',
  'deathrattleGrantSpell',
  'buffFodderEverywhere',
  'deathrattleFillTribe',
  'avengeBuff',
  'scGrantShieldTribe',
  'deathrattleGrantShield',
  'onShieldBreakGrantShield',
  'onShieldBreakDamage',
  'onShieldBreakBuffAll',
  'onFriendDeathSummon',
  'scDestroyHighestAttack',
  'battlecryBuffTribe',
  'battlecrySummon',
  'buffOnBuy',
  'battlecryGrantKeyword',
  'battlecryGainRandomMinion',
  'onBattlecryBuffTribe',
  'endOfTurnBuff',
  'endOfTurnMagnetizeMechs',
  'addTavernFodder',
  'avengeImproveSummon',
  'onConsumeBuffSelf',
  'onConsumeGrantSelfKeyword',
  'onConsumeShieldNextCombat',
  'spellBuffTarget',
  'spellBuffAll',
  'spellDevour',
  'castSpell',
  'gainEmbers',
  'spellCastBuffOthers',
  'overflowBuffRandom',
  'battlecryLinkDemon',
  'spellCastTransform',
  'spellCastBuffSelf',
  'summonBuffSelfTribe',
  'spellBuffShop',
  'gainMaxMana',
  'grantFreeRolls',
  'spellGainOfTargetTribe',
  'spellGainRandomMinion',
  'spellGildTarget',
  'spellBuffTargetEscalating',
  'spellGrantTribeAttack',
  'healHero',
  'conjureTribeArmy',
  'stealTavernMinion',
]);

export const EffectDefSchema = z.object({
  on: GameEventSchema,
  do: EffectFactoryIdSchema,
  params: z.record(z.unknown()).optional(),
});

export const CardDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tribe: TribeSchema,
  tribe2: TribeSchema.optional(),
  tier: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  attack: z.number().int().nonnegative(),
  health: z.number().int().positive(),
  keywords: z.array(KeywordSchema),
  effects: z.array(EffectDefSchema),
  // Body text is mechanical-only and may be empty for keyword-only cards
  // (the keyword badge + hover tooltip carry the meaning).
  text: z.string(),
  goldenText: z.string().optional(),
  token: z.boolean().optional(),
  spell: z.boolean().optional(),
  singleCast: z.boolean().optional(),
  cost: z.number().int().nonnegative().optional(),
  target: z.enum(['friendly', 'any']).optional(),
  targetTribe: TribeSchema.optional(),
  targetMaxTier: z.number().int().positive().optional(),
  fodderMult: z.number().int().positive().optional(),
  manaPerTurn: z.number().int().positive().optional(),
  chooseOne: z
    .array(z.object({ text: z.string(), effects: z.array(EffectDefSchema) }))
    .min(2)
    .optional(),
});
