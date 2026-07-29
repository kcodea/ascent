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
  // DEPTH IS NOT THE DIAL. Measured over 15 seeds once the evaluator was fight-grounded and the
  // never-waste-gold rule was in: depth 1 scored 7.33 wins, depth 3 scored 5.60, depth 5 scored 3.87 — skill
  // fell monotonically as the bot searched deeper. More search does not find better play against an evaluator
  // it can exploit; it finds better ways to exploit it. Until the evaluator is strong enough to reward depth,
  // difficulty scales the things that reliably do help: how often the bot takes a worse move on purpose, and
  // how hard it works on the final board arrangement.
  //
  // Depth is left at 1-2 rather than removed, so the machinery stays exercised and the day the evaluator
  // improves this is a one-line change rather than a rewrite.
  // Every tier is the SAME search config, scaled only by how often it deliberately takes a worse move. That is
  // the honest reading of the measurements: with search depth, beam width and positioning effort all
  // anti-correlated with skill, blunder rate is the one dial that behaves. Expert is simply the config with the
  // mistakes turned off.
  easy: { id: 'easy', beamWidth: 1, maxDepth: 1, maxNodes: 40, blunderRate: 0.45, maxRegret: 0.40, positioningCandidates: 2 },
  normal: { id: 'normal', beamWidth: 1, maxDepth: 1, maxNodes: 40, blunderRate: 0.22, maxRegret: 0.20, positioningCandidates: 2 },
  hard: { id: 'hard', beamWidth: 1, maxDepth: 1, maxNodes: 40, blunderRate: 0.08, maxRegret: 0.10, positioningCandidates: 2 },
  expert: { id: 'expert', beamWidth: 1, maxDepth: 1, maxNodes: 40, blunderRate: 0, maxRegret: 0, positioningCandidates: 2 },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as BotDifficultyId[];
