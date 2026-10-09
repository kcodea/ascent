import { memo, useMemo, useState } from 'react';
import type { Tribe } from '@game/core';
import type { RunState } from '@game/sim';
import { type Guide } from './guides';
import { GuideEmblem, GuideText, GuideTribes, GuideUnits, guideAccent, guideCardIds, guideChips, useGuideViews } from './GuideParts';
import './lobbyGuides.css';
import './compendiumGuides.css';
import { LazyCell, LazyRootProvider } from '../bookLazy';

/**
 * THE COMPENDIUM'S GUIDES TAB (owner ask 2026-10-09: "a guides tab in the compendium that pulls the same guides from
 * the rail but in an expanded/full view"). The SAME `GUIDES` data and the same pieces as the lobby rail
 * (`GuideParts`), laid out for a big screen: every guide is open, two cards across on a wide window and one on a
 * narrow one, each with its art icon, title, tribe line + tagline, the full write-up (card names hoverable) and bigger
 * Core / Enablers portraits. Which guides show (set, tribe pills, search) is decided by the caller (MinionBook).
 *
 * PERFORMANCE. Guides mount lazily (all but the first two wait until near the viewport). Each guide card is memoized and its portraits are the memoized `Card` fed stabilized views. Off-screen
 * cards skip layout + paint (`content-visibility: auto`, compendiumGuides.css). Nothing animates.
 */
export const CompendiumGuides = memo(function CompendiumGuides({ guides, tribes, run }: {
  guides: readonly Guide[];
  /** The tribes the shown set (or run) has: a crossover chip shows only when its tribe is among them. */
  tribes: readonly Tribe[];
  /** The run to print live values from, only while the Compendium shows that run's own set. */
  run: RunState | undefined;
}): JSX.Element {
  // Lazy (perf 2026-10-09): the first two guides mount with the tab, the rest as they near the viewport (bookLazy.tsx),
  // so opening Guides builds two guides' portraits instead of every guide's.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  if (guides.length === 0) return <div className="book-empty">No guides match these filters.</div>;
  return (
    <div className="bookguides" ref={setRoot}>
      <LazyRootProvider root={root}>
        {guides.map((g, i) => (
          <LazyCell key={g.id} eager={i < 2} className="bookguide-slot">{() => <CompendiumGuide guide={g} tribes={tribes} run={run} />}</LazyCell>
        ))}
      </LazyRootProvider>
    </div>
  );
});

const CompendiumGuide = memo(function CompendiumGuide({ guide, tribes, run }: {
  guide: Guide; tribes: readonly Tribe[]; run: RunState | undefined;
}): JSX.Element {
  const chips = guideChips(guide, tribes);
  const ids = useMemo(() => guideCardIds(guide), [guide]);
  const { views, refs } = useGuideViews(ids, run);
  return (
    <article className="bookguide" data-guide={guide.id} style={guideAccent(chips)} aria-label={guide.title}>
      <header className="bookguide-head">
        <GuideEmblem guide={guide} chips={chips} />
        <div className="bookguide-headtext">
          <h3 className="bookguide-title">{guide.title}</h3>
          <div className="bookguide-tribes"><GuideTribes chips={chips} /></div>
          <div className="bookguide-tagline">{guide.tagline}</div>
        </div>
      </header>
      <div className="bookguide-body">
        <GuideText guide={guide} ids={ids} views={views} refs={refs} />
        {/* Core, then Enablers on its own line below (owner 2026-10-09: "always have core + enablers on different
            lines"). */}
        <GuideUnits label="Core" ids={guide.core} views={views} refs={refs} />
        {guide.enablers.length > 0 && <GuideUnits label="Enablers" ids={guide.enablers} views={views} refs={refs} />}
      </div>
    </article>
  );
});
