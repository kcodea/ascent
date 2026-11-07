import { memo, useMemo } from 'react';
import { getHero } from '@game/sim';
import { heroArt } from './art';
import type { HeroCount } from './heroFilter';
import { PhSelect } from './partyHome/kit';

const gamesText = (n: number): string => `${n} ${n === 1 ? 'game' : 'games'}`;
/** "All heroes" in the select (PhSelect values are strings; the filter's own "none" is null). */
const ALL = '';

/**
 * THE HERO FILTER (Recent Games): ONE dropdown, not a row of chips (owner 2026-11-07: "remove these buttons and instead have a
 * hero select dropdown"). The kit's select, the same thin gold pill as Practice's Opponent rank: "All heroes" first, then every
 * hero in the loaded games, most played first, each with its portrait and game count. Typing a name's first letters jumps to it.
 */
export const HeroFilterChips = memo(function HeroFilterChips({ counts, value, onChange }: {
  counts: readonly HeroCount[];
  value: string | null;
  onChange: (heroId: string | null) => void;
}): JSX.Element | null {
  const options = useMemo(() => [
    { value: ALL, label: 'All heroes', text: 'all heroes' },
    ...counts.map((c) => {
      const name = getHero(c.id).name;
      return {
        value: c.id, text: name, thumb: heroArt(c.id) ?? undefined,
        label: <span className="rg-heroopt"><span className="rg-heroname">{name}</span><span className="rg-heron">{gamesText(c.n)}</span></span>,
      };
    }),
  ], [counts]);
  if (counts.length === 0) return null;
  const shown = value !== null && counts.some((c) => c.id === value) ? value : ALL;
  return (
    <div className="rg-filters" role="group" aria-label="Filter by hero">
      <PhSelect className="rg-herosel" label="Filter by hero" value={shown} options={options} onChange={(v) => onChange(v === ALL ? null : v)} />
    </div>
  );
});
