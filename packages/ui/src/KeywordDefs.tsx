import { useMemo } from 'react';
import { detectCardKeywords, type DetectableCard } from './detectCardKeywords';

/**
 * The keyword definition panel — a column of boxes shown beside the enlarged card (hover reveal + right-click
 * Inspect), one per glossary term the card's text uses. Word-led: the term's name on its own line, definition
 * below. Renders nothing when the card references no glossary terms. Static DOM — no per-frame work.
 */
export function KeywordDefs({ card }: { card: DetectableCard }): JSX.Element | null {
  const defs = useMemo(() => detectCardKeywords(card), [card.keywords, card.text]);
  if (defs.length === 0) return null;
  return (
    <div className="kwdefs" aria-label="Keyword definitions">
      {defs.map((d) => (
        <div className="kwbox" key={d.id}>
          <div className="kwbox-name">{d.name}</div>
          <div className="kwbox-def">{d.def}</div>
        </div>
      ))}
    </div>
  );
}
