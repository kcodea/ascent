import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CardDef, Tribe } from '@game/core';
import { BUYABLE_CARDS, SPELL_CARDS } from '@game/content';
import { Card, type CardView } from './Card';
import { Icon } from './Icon';
import { useGame } from './store';

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
const PAGE_SIZE = 10;

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
 * The Minion Book (Tab) — a filterable codex of every minion + spell findable in the current run. A blurred
 * full-screen overlay styled like an open tome: tier filters (1–6) across the top, tribe + Spells categories
 * down the left (multi-select, both axes), and a paged gallery of cards you flip through. Right-click a card
 * for the enlarged inspect (the global Inspect overlay handles it). UI-only — reads `run.pool`'s eligibility
 * rule (neutral + active tribes) off `BUYABLE_CARDS` so the contents stay stable as you buy/sell.
 */
export function MinionBook() {
  const run = useGame((s) => s.run);
  const closeBook = useGame((s) => s.closeBook);

  const [tiers, setTiers] = useState<Set<number>>(() => new Set());
  const [cats, setCats] = useState<Set<Category>>(() => new Set());
  const [page, setPage] = useState(0);

  // Left-rail categories: the run's active tribes, then Neutral (always findable), then Spells.
  const categories: Category[] = useMemo(() => [...run.tribes, 'neutral', 'spells'], [run.tribes]);

  // Every card findable this run: minions whose tribe is neutral or an active tribe (mirrors `stockPool`),
  // plus every tavern spell. Tokens are excluded — `BUYABLE_CARDS` already drops them.
  const allCards = useMemo(() => {
    const minions = BUYABLE_CARDS.filter((c) => c.tribe === 'neutral' || run.tribes.includes(c.tribe));
    return [...minions, ...SPELL_CARDS];
  }, [run.tribes]);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp the page when the filtered set shrinks under it.
  const safePage = Math.min(page, pageCount - 1);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  const shown = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Reset to the first page whenever the filters change (so you're not stranded on an empty later page).
  useEffect(() => { setPage(0); }, [tiers, cats]);

  // Page flipping via the arrow keys (Esc/Tab to close are owned by Game's global handlers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') setPage((p) => Math.min(p + 1, pageCount - 1));
      else if (e.key === 'ArrowLeft') setPage((p) => Math.max(p - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pageCount]);

  const toggleTier = (t: number): void =>
    setTiers((prev) => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  const toggleCat = (c: Category): void =>
    setCats((prev) => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next; });

  return (
    <div className="book-ov" onClick={closeBook} role="dialog" aria-label="Minion Book — Esc or Tab to close">
      <div className="book" onClick={(e) => e.stopPropagation()}>
        <div className="book-head">
          <div className="book-title"><Icon name="house" /> Bestiary</div>
          <div className="book-sub">{filtered.length} of {allCards.length} cards findable this run</div>
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

          {/* The paged gallery. */}
          {shown.length > 0 ? (
            <div className="book-grid">
              {shown.map((c) => (
                <div className="book-cell" key={c.id}>
                  <Card card={toView(c)} forceFull suppressPop />
                </div>
              ))}
            </div>
          ) : (
            <div className="book-empty">No cards match these filters.</div>
          )}
        </div>

        <div className="book-foot">
          <button
            className="book-flip"
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
            disabled={safePage === 0}
            aria-label="Previous page"
          >
            ‹ Prev
          </button>
          <span className="book-page">Page {safePage + 1} / {pageCount}</span>
          <button
            className="book-flip"
            onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Next page"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
