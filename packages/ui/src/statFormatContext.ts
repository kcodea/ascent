import { createContext } from 'react';
import { formatStat } from './formatStat';

/** How a `Card` prints its stat badges. In-game it is always `formatStat`; a menu board (Recent Games, Career,
 *  Hall of Champions, Match details) provides `formatStatCompact` so a big number never overruns its badge. */
export const StatFormatContext = createContext<(n: number) => string>(formatStat);
