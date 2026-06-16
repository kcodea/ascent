import { z } from 'zod';

/**
 * Runtime validation for card data (handoff C.5). The hand-written `CardDef`
 * type in `@game/core` is the canonical compile-time shape; this schema guards
 * the *data* at load and is kept in lockstep with it.
 */
export const TribeSchema = z.enum(['beast', 'undead', 'mech', 'dragon', 'demon', 'neutral']);

export const KeywordSchema = z.enum(['T', 'DS', 'P', 'W', 'R', 'C', 'M', 'SC', 'CN']);

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
  'onBuy',
  'onSell',
]);

export const EffectFactoryIdSchema = z.enum([
  'deathrattleSummon',
  'buffOnSummon',
  'deathrattleBuffTribe',
  'reAttackOnKill',
  'scDamage',
  'scSplitDamage',
  'scAoePerTribe',
  'deathrattleBuffRandom',
  'onFriendDeathBuffRandom',
  'deathrattleFillTribe',
  'battlecryBuffTribe',
  'battlecrySummon',
  'buffOnBuy',
  'battlecryGrantKeyword',
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
  text: z.string().min(1),
  token: z.boolean().optional(),
});
