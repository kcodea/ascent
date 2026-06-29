import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CardDef, Tribe } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX, SPELL_CARDS } from '@game/content';
import { Card, type CardView } from './Card';
import { Icon } from './Icon';
import { useGame } from './store';

/** Evolution units — non-buyable tokens a minion ascends/transforms into (Spirit Pup → Spirit Worgen,
 *  Tara → Taragosa). Detected from the card set (ascend targets + `spellCastTransform` destinations) so the
 *  Compendium can show these "secret" payoff forms even though they never appear in the shop. */
const EVOLUTION_CARDS: CardDef[] = (() => {
  const ids = new Set<string>();
  for (const c of Object.values(CARD_INDEX)) {
    if (c.ascendInto) ids.add(c.ascendInto);
    for (const e of c.effects) {
      if (e.do === 'spellCastTransform' && typeof e.params?.into === 'string') ids.add(e.params.into);
    }
  }
  return [...ids].map((id) => CARD_INDEX[id]).filter((c): c is CardDef => !!c);
})();

/** Left-rail category: a real tribe, or the tribe-less "spells" bucket. */
type Category = Tribe | 'spells';

const CAT_META: Record<Category, { label: string; icon: string }> = {
  beast: { label: 'Beasts', icon: 'paw' },
  dragon: { label: 'Dragons', icon: 'flame' },
  mech: { label: 'Mechs', icon: 'gear' },
  undead: { label: 'Undead', icon: 'skull' },
  demon: { label: 'Demons', icon: 'eye' },
  neutral: { label: 'Neutral', icon: 'star' },
  spells: { label: 'Spells', icon: 'sc' },
};

const TIERS = [1, 2, 3, 4, 5, 6] as const;
/** Every non-neutral tribe — the left-rail set when browsing the full game (from the title, pre-run). */
const ALL_TRIBES: Tribe[] = ['beast', 'dragon', 'mech', 'undead', 'demon'];

/** A book card def → the view object `Card` renders. Base (printed) stats only — the book is a static
 *  reference, not a live board, so no run buffs. */
function toView(c: CardDef): CardView {
  return {
    name: c.name,
    cardId: c.id,
    tribe: c.tribe,
    tribe2: c.tribe2,
    attack: c.attack,
    health: c.health,
    keywords: c.keywords,
    text: c.text,
    goldenText: c.goldenText,
    tier: c.tier,
    spell: c.spell,
    cost: c.cost,
    target: c.target === 'friendly' ? 'friendly' : undefined,
  };
}

/**
 * The Compendium (Tab) — a filterable codex of minions + spells: the whole card set when opened from the
 * title (pre-run), or scoped to the active run's tribes once a run is underway. A blurred
 * full-screen overlay styled like an open tome: tier filters (1–6) across the top, tribe + Spells categories
 * down the left (multi-select, both axes), and a single scrolling gallery of cards. Right-click a card
 * for the enlarged inspect (the global Inspect overlay handles it). UI-only — reads `run.pool`'s eligibility
 * rule (neutral + active tribes) off `BUYABLE_CARDS` so the contents stay stable as you buy/sell.
 */
export function MinionBook() {
  const run = useGame((s) => s.run);
  const showTitle = useGame((s) => s.showTitle);
  const closeBook = useGame((s) => s.closeBook);

  const [tiers, setTiers] = useState<Set<number>>(() => new Set());
  const [cats, setCats] = useState<Set<Category>>(() => new Set());

  // Opened from the title (no committed run) → browse the WHOLE card set; in a run → scope to its active
  // tribes (mirrors `stockPool`: neutral is always findable, so it's added below regardless).
  const tribes: Tribe[] = showTitle ? ALL_TRIBES : run.tribes;

  // Left-rail categories: the active (or all) tribes, then Neutral (always findable), then Spells.
  const categories: Category[] = useMemo(() => [...tribes, 'neutral', 'spells'], [tribes]);

  // Every eligible card: minions whose tribe is neutral or in `tribes`, plus every tavern spell. Tokens are
  // excluded — `BUYABLE_CARDS` already drops them.
  const allCards = useMemo(() => {
    const inScope = (c: CardDef): boolean => c.tribe === 'neutral' || tribes.includes(c.tribe);
    const minions = BUYABLE_CARDS.filter(inScope);
    // Evolution units (Spirit Worgen, Taragosa) — shown alongside their tribe's minions though never buyable.
    const evolutions = EVOLUTION_CARDS.filter(inScope);
    return [...minions, ...evolutions, ...SPELL_CARDS];
  }, [tribes]);

  const filtered = useMemo(() => {
    return allCards
      .filter((c) => {
        const tierOK = tiers.size === 0 || tiers.has(c.tier);
        const cardCats: Category[] = c.spell ? ['spells'] : [c.tribe, ...(c.tribe2 ? [c.tribe2] : [])];
        const catOK = cats.size === 0 || cardCats.some((x) => cats.has(x));
        return tierOK && catOK;
      })
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [allCards, tiers, cats]);

  const toggleTier = (t: number): void =>
    setTiers((prev) => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  const toggleCat = (c: Category): void =>
    setCats((prev) => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next; });

  return (
    <div className="book-ov" onClick={closeBook} role="dialog" aria-label="Compendium — Esc or Tab to close">
      <div className="book" onClick={(e) => e.stopPropagation()}>
        <div className="book-head">
          <div className="book-title"><Icon name="house" /> Compendium</div>
          <div className="book-sub">{filtered.length} of {allCards.length} cards {showTitle ? 'in the game' : 'findable this run'}</div>
          <button className="book-close" onClick={closeBook} aria-label="Close (Tab / Esc)">✕</button>
        </div>

        {/* Tier filters across the top (multi-select). */}
        <div className="book-tiers">
          <span className="book-axislabel">Tier</span>
          {TIERS.map((t) => (
            <button
              key={t}
              className={`book-tier${tiers.has(t) ? ' on' : ''}`}
              onClick={() => toggleTier(t)}
              aria-pressed={tiers.has(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="book-main">
          {/* Tribe + Spells filters down the left (multi-select). */}
          <div className="book-rail">
            {categories.map((c) => (
              <button
                key={c}
                className={`book-cat${cats.has(c) ? ' on' : ''}`}
                style={{ '--c': c === 'spells' ? 'var(--acc)' : `var(--t-${c})` } as CSSProperties}
                onClick={() => toggleCat(c)}
                aria-pressed={cats.has(c)}
                title={CAT_META[c].label}
              >
                <Icon name={CAT_META[c].icon} />
                <span className="book-catlabel">{CAT_META[c].label}</span>
              </button>
            ))}
          </div>

          {/* The scrolling gallery — all matching cards in one vertically-scrollable grid. */}
          {filtered.length > 0 ? (
            <div className="book-grid">
              {filtered.map((c) => (
                <div className="book-cell" key={c.id}>
                  <Card card={toView(c)} forceFull suppressPop />
                </div>
              ))}
            </div>
          ) : (
            <div className="book-empty">No cards match these filters.</div>
          )}
        </div>
      </div>
    </div>
  );
}
