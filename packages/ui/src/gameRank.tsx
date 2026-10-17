/** THE RANK TAG (R-GAME-RANK-01): the presentation half of `gameRankData.ts` (where the rank comes from lives there). */
import { rankLabel } from './rank/types';
import { RankCrest } from './rank/RankBar';
import { shortRankLabel } from './gameRankData';

/** The rank tag: the medal crest (no plate; the numeral is in the text) and the division's name. `compact` = the list
 *  row's mini crest + short label; otherwise the detail header's crest + full label ("Platinum III"). */
export function GameRank({ divisionIndex, compact = false }: { divisionIndex: number; compact?: boolean }): JSX.Element {
  const full = rankLabel(divisionIndex);
  return (
    <span className={`gamerank${compact ? ' compact' : ''}`} aria-label={`Played at ${full}`}>
      <RankCrest divisionIndex={divisionIndex} size="mini" hideDivision />
      <span className="gamerank-l" aria-hidden="true">{compact ? shortRankLabel(divisionIndex) : full}</span>
    </span>
  );
}
