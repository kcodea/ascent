import { z } from 'zod';
import { TRIBES, type Keyword } from '@game/core';
import { CARD_INDEX } from '../index';
import { RUNE_INDEX } from '../runes';
import { GAUNTLET_BOARD_MAX, GAUNTLET_ROUNDS, type GauntletStage } from './types';

/** Every keyword code — complete BY CONSTRUCTION: the `Record<Keyword, true>` fails to compile if the union gains a
 *  member this list lacks (core exports no runtime keyword list). */
const KEYWORD_SET: Record<Keyword, true> = {
  T: true, DS: true, V: true, W: true, R: true, C: true, M: true, SC: true, CN: true, FD: true,
  IMM: true, ST: true, RL: true, SL: true, CR: true, EG: true, RB: true, RW: true,
};
const KEYWORDS = Object.keys(KEYWORD_SET) as [Keyword, ...Keyword[]];
const STAGE_TRIBES = TRIBES.filter((t) => t !== 'neutral') as [string, ...string[]];

const minionSchema = z.object({
  cardId: z.string().min(1),
  attack: z.number().int().min(0),
  health: z.number().int().min(1),
  golden: z.boolean().optional(),
  addedKeywords: z.array(z.enum(KEYWORDS)).optional(),
  cardVersion: z.string(),
});
const stageSchema = z.object({
  number: z.number().int().min(1).max(10),
  name: z.string().min(1),
  opponentName: z.string().min(1),
  portraitCardId: z.string().optional(),
  tribe: z.enum(STAGE_TRIBES).optional(),
  status: z.enum(['draft', 'ready']),
  runes: z.object({ round6: z.string().optional(), round9: z.string().optional() }).strict(),
  rounds: z.array(z.object({ tier: z.number().optional(), board: z.array(minionSchema) })),
});

/** Every problem with a stage, as human-readable lines (empty = valid). Used by CI and the Stage Builder's Save. */
export function validateStage(stage: GauntletStage): string[] {
  const parsed = stageSchema.safeParse(stage);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const issues: string[] = [];
  if (stage.portraitCardId !== undefined && !CARD_INDEX[stage.portraitCardId]) issues.push(`portraitCardId: unknown card '${stage.portraitCardId}'`);
  if (stage.rounds.length !== GAUNTLET_ROUNDS) issues.push(`stage ${stage.number} must have exactly ${GAUNTLET_ROUNDS} rounds (has ${stage.rounds.length})`);
  stage.rounds.forEach((r, i) => {
    const round = i + 1;
    if (r.tier !== undefined && (!Number.isInteger(r.tier) || r.tier < 1 || r.tier > 6)) issues.push(`round ${round}: tier must be 1–6 (got ${r.tier})`);
    if (r.board.length > GAUNTLET_BOARD_MAX) issues.push(`round ${round}: board has more than ${GAUNTLET_BOARD_MAX} minions`);
    if (stage.status === 'ready' && r.board.length === 0) issues.push(`round ${round}: board is empty (a ready stage fields a board every round)`);
    r.board.forEach((m, j) => {
      const def = CARD_INDEX[m.cardId];
      if (!def) issues.push(`round ${round}, slot ${j + 1}: unknown card '${m.cardId}'`);
      else if (def.spell) issues.push(`round ${round}, slot ${j + 1}: '${m.cardId}' is a spell, not a minion`);
    });
  });
  for (const [slot, id] of Object.entries(stage.runes)) {
    if (id && !RUNE_INDEX[id]) issues.push(`${slot}: unknown rune '${id}'`);
  }
  return issues;
}
