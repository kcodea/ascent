import { SPEC } from './goodLuck/goodLuckIntroConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the "GOOD LUCK" game-start intro (owner ask 2026-09-24): the dim, the words' size, the spark
 * count, and every beat of the timeline. The ▶ replay action plays it over the current board, so there is no
 * need to start a new game for every adjustment. Production always plays the baked defaults.
 */
export function GoodLuckIntroTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
