import { z } from 'zod';
import { CARD_INDEX } from '../index';
import { RUNE_INDEX } from '../runes';
import { GAUNTLET_BOARD_MAX, GAUNTLET_ROUNDS, type GauntletStage } from './types';

const minionSchema = z.object({
  cardId: z.string().min(1),
  attack: z.number().int().min(0),
  health: z.number().int().min(1),
  golden: z.boolean().optional(),
  addedKeywords: z.array(z.string()).optional(),
  cardVersion: z.string(),
});
const stageSchema = z.object({
  number: z.number().int().min(1).max(10),
  name: z.string().min(1),
  opponentName: z.string().min(1),
  tribe: z.string().optional(),
  status: z.enum(['draft', 'ready']),
  runes: z.object({ round6: z.string().optional(), round9: z.string().optional() }),
  rounds: z.array(z.object({ tier: z.number().optional(), board: z.array(minionSchema) })),
});

/** Every problem with a stage, as human-readable lines (empty = valid). Used by CI and the Stage Builder's Save. */
export function validateStage(stage: GauntletStage): string[] {
  const parsed = stageSchema.safeParse(stage);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const issues: string[] = [];
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
