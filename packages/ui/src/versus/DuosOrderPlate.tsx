/**
 * VERSUS DUOS — WHO FIGHTS FIRST (owner ruling 2026-10-25, R-DUOS-ORDER-01: "I want the 'who fights first' to be a
 * 50/50, not a player decision for duos teams. Every round it should say who fights first but players cannot decide
 * who it is."). One static plate under the rail says whose board of my team goes first this round. The pick is the
 * seeded 50/50 (`duosRandomFirst` from the match seed + round), known from the start of the shop and identical on every
 * client and the resolver. Display only: no click, no hover look (`.duosorder` takes no pointer events).
 */
import { memo } from 'react';
import { useVersus } from './versusStore';

export const DuosOrderPlate = memo(function DuosOrderPlate(): JSX.Element | null {
  const label = useVersus((s) => {
    const g = s.match?.group;
    const d = g?.duos;
    if (!g || !d || !g.me) return null;
    const first = d.first[d.team];
    if (first === g.me) return 'You fight first';
    const name = g.raw.seats.find((x) => x.seat === first)?.name;
    return name ? `${name} fights first` : null;
  });
  if (!label) return null;
  return <div className="vsplate duosorder" role="status" aria-live="polite">{label}</div>;
});
