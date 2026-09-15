/**
 * IMITATION (balance bot B7) — public surface.
 *
 *   trajectoriesOf / isSurvivor        the corpus as run trajectories + the survival label
 *   studyCorpus / renderStudy          the player study (docs/balance-bot-player-study.md)
 *   fitImitation / scoreBoard          the per-card log-odds table + its board score
 *   imitationTermOf                    the evaluator hook
 *   lineSurvivorAffinity               what the survivors say about a strategy line
 *   loadDefaultImitationModel(setId)   the committed model for a set (`models/<set>-v1.json`), or null
 */
import set2v1 from './models/set2-v1.json';
import { validateImitationModel, type ImitationModel } from './model';

export * from './trajectories';
export * from './study';
export * from './model';
export * from './term';
export * from './lineFit';

const COMMITTED: Record<string, unknown> = { set2: set2v1 };

export function loadDefaultImitationModel(setId: string): ImitationModel | null {
  const m = COMMITTED[setId];
  return m && validateImitationModel(m) ? m : null;
}
