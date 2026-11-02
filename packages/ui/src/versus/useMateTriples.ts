/**
 * The screen side of R-DUOS-MATE-TRIPLE-01 (`mateTriples.ts`): the key of the card ids my teammate is one copy short of
 * a Gild on, for MY own screen. '' when there is no teammate, and while I watch my teammate's screen (their shop is
 * theirs: their own triple hint already shows there). One primitive string, so the shop only re-renders when it changes.
 */
import { useLocalMate } from './localMate';
import { useMateTriples } from './mateTriples';
import { useSpectate } from './spectate';
import { useVersus } from './versusStore';

export function useMateTripleKey(): string {
  const local = useLocalMate((s) => s.mate !== null);
  const watching = useSpectate((s) => !!s.teammate);
  const mate = useVersus((s) => (local ? null : s.match?.group?.duos?.mate ?? null));
  return useMateTriples((st) => (watching ? '' : local ? st.local : mate ? st.bySeat[mate] ?? '' : ''));
}
