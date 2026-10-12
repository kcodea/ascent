import { memo, useMemo, useState } from 'react';
import type { CardDef } from '@game/core';
import { poolFor, type SetId } from '@game/content';

/**
 * THE GUIDE EDITOR'S CARD PICKER: search this set's cards by name and pick one (a Core card, an Enabler, the art
 * icon). Inline, under the row it adds to. Names only, no portraits: it is a search list, and the picked card shows
 * as a real portrait in the row the moment it is added.
 *
 * It does not handle Esc. The editor claims Esc for the whole tab and closes the picker first (GuideEditor).
 */
const MAX_ROWS = 12;

const kindOf = (c: CardDef): string => (c.spell ? 'Spell' : c.token ? 'Token' : `Tier ${c.tier}`);

export const GuideCardPicker = memo(function GuideCardPicker({ setId, label, exclude, onPick }: {
  setId: SetId;
  /** What picking does ("Add a Core card"); read by screen readers on the search box. */
  label: string;
  /** Card ids not to offer (the ones already in this row). */
  exclude?: readonly string[];
  onPick: (cardId: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const cards = useMemo(() => [...poolFor(setId).all].sort((a, b) => a.name.localeCompare(b.name)), [setId]);
  const found = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const skip = new Set(exclude ?? []);
    const out: CardDef[] = [];
    for (const c of cards) {
      if (skip.has(c.id)) continue;
      const hay = c.name.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      out.push(c);
      if (out.length === MAX_ROWS) break;
    }
    return out;
  }, [cards, query, exclude]);
  return (
    <div className="gpick" role="group" aria-label={label}>
      <input
        className="gedit-input gpick-find"
        autoFocus
        value={query}
        placeholder="Search cards"
        aria-label={`${label}. Search this set's cards. Enter picks the top match.`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) { e.preventDefault(); onPick(found[0].id); } }}
      />
      <div className="gpick-list">
        {found.map((c) => (
          <button type="button" className="gpick-row" key={c.id} onClick={() => onPick(c.id)}>
            <span className="gpick-name">{c.name}</span>
            <span className="gpick-kind">{kindOf(c)}</span>
          </button>
        ))}
        {found.length === 0 && <span className="gpick-none">No card matches.</span>}
      </div>
    </div>
  );
});
