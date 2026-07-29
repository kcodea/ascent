/**
 * DIFFICULTY — weakness from thinking less, never from cheating.
 *
 * Every tier plays the same game with the same information. What changes is how far ahead it looks, how many
 * lines it keeps, and how often it takes a choice that isn't the best one it found. An Easy bot that got less
 * Gold or a worse shop would be a different game, and players notice.
 *
 * `blunderRate` + `maxRegret` together are what make a weak bot *believable*: a blunder is a seeded pick among
 * candidates whose utility is within `maxRegret` of the best. So a weak bot makes ordinary mistakes — the second
 * best buy — rather than selling its board or spending everything on refreshes, which reads as broken rather
 * than bad.
 */
export type BotDifficultyId = 'easy' | 'normal' | 'hard' | 'expert';

export interface BotDifficultyProfile {
  id: BotDifficultyId;
  /** Lines kept between plies. 1 = greedy. */
  beamWidth: number;
  /** How many actions deep a plan may go within one shop phase. */
  maxDepth: number;
  /** Hard ceiling on expanded nodes per decision — the real budget control. */
  maxNodes: number;
  /** Chance of taking a near-best action instead of the best. */
  blunderRate: number;
  /** How far from the best a "blunder" may be, as a fraction of the best score's magnitude. */
  maxRegret: number;
  /** Curated board orders tried at end of turn. */
  positioningCandidates: number;
}

export const DIFFICULTIES: Record<BotDifficultyId, BotDifficultyProfile> = {
  // Greedy and shallow: takes the locally best action and never plans a sequence. Still legal, still finishes
  // its turns — it just never sells to afford, or sequences a buy behind an upgrade.
  easy: { id: 'easy', beamWidth: 1, maxDepth: 1, maxNodes: 24, blunderRate: 0.22, maxRegret: 0.25, positioningCandidates: 0 },
  normal: { id: 'normal', beamWidth: 3, maxDepth: 3, maxNodes: 140, blunderRate: 0.08, maxRegret: 0.12, positioningCandidates: 3 },
  hard: { id: 'hard', beamWidth: 6, maxDepth: 5, maxNodes: 500, blunderRate: 0.02, maxRegret: 0.05, positioningCandidates: 8 },
  expert: { id: 'expert', beamWidth: 10, maxDepth: 7, maxNodes: 1400, blunderRate: 0, maxRegret: 0, positioningCandidates: 16 },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as BotDifficultyId[];
