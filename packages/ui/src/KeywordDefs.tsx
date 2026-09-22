import { useMemo } from 'react';
import { detectCardKeywords, type DetectableCard } from './detectCardKeywords';
import { Icon } from './Icon';
import { mechMedallionSrc } from './mechMedallion';
import type { Mechanic } from './mechanics';

/**
 * The keyword definition panel — a column of boxes shown beside the enlarged card (hover reveal + right-click
 * Inspect), one per glossary term the card's text uses. Word-led: the term's name on its own line, definition
 * below. Renders nothing when the card references no glossary terms. Static DOM — no per-frame work.
 *
 * `mech` is the card's resolved medallion mechanic (from `resolveMech`), passed only by the card surfaces that
 * have one (not runes/equipment). When it maps to one of the listed terms (`KeywordDef.mechanic === mech.id`),
 * that term is HOISTED to the top of the column and its title wears the same medallion icon the gem shows, so the
 * keyword on the unit's gem reads first and is unmistakably the one pictured (owner ask 2026-09-22).
 */
export function KeywordDefs({ card, mech }: { card: DetectableCard; mech?: Mechanic | null }): JSX.Element | null {
  const defs = useMemo(() => {
    const list = detectCardKeywords(card);
    if (!mech) return list;
    const i = list.findIndex((d) => d.mechanic === mech.id);
    if (i <= 0) return list; // absent, or already first — nothing to reorder
    return [list[i]!, ...list.slice(0, i), ...list.slice(i + 1)];
  }, [card.keywords, card.text, mech?.id]);
  if (defs.length === 0) return null;
  const medSrc = mech ? mechMedallionSrc(mech.id) : null;
  return (
    <div className="kwdefs" aria-label="Keyword definitions">
      {defs.map((d) => {
        const isMech = !!mech && d.mechanic === mech.id;
        return (
          <div className="kwbox" key={d.id}>
            <div className="kwbox-name">
              {isMech && (
                <span className="kwbox-ico" aria-hidden="true">
                  {medSrc ? <img decoding="sync" src={medSrc} alt="" /> : <Icon name={mech!.glyph} />}
                </span>
              )}
              {d.name}
            </div>
            <div className="kwbox-def">{d.def}</div>
          </div>
        );
      })}
    </div>
  );
}
