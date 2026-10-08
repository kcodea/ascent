import { useEffect, useMemo, useRef, useState } from 'react';
import { StatBadgeField } from './StatBadgeField';
import { createPortal } from 'react-dom';
import { BUYABLE_CARDS } from '@game/content';
import type { Keyword } from '@game/core';
import { stageHost, stageViewport } from './stage';

/**
 * The sandbox unit editor — a popover anchored to one card, holding everything that can be set about it
 * directly: which card it is, its base attack and health, and its keywords.
 *
 * Presentation only. Every rule (the floors, the uid-preserving card swap, the board clamps) lives in
 * `sandboxEdit.ts`; this component reads a value and reports intent. That is what keeps the rules testable
 * in a repo with no jsdom.
 *
 * Portalled to `<body>` so it escapes the board's stacking contexts — a card sets its own z-index while
 * hovered/dragging, and an editor nested inside one would be clipped by the row it is editing.
 */

export interface UnitEditorValue {
  cardId: string;
  attack: number;
  health: number;
  keywords: Keyword[];
}

/**
 * The keywords worth a toggle. NOT every `Keyword` in the union: several are granted-only bookkeeping that a
 * body cannot meaningfully be given at rest, and offering them would suggest the rig can stage states the
 * sim never produces. These six are the ones that visibly change how a unit fights and how its card reads.
 */
export const EDITABLE_KEYWORDS: readonly Keyword[] = ['T', 'DS', 'V', 'W', 'R', 'C'];

// Player-facing labels, matching the B3 rename pass in `terms.ts` (Divine Shield -> Ward, Windfury -> Flurry,
// Venomous -> Execute, Reborn -> Rise). Taunt and Cleave are kept as-is by that same pass.
export const KEYWORD_LABEL: Record<string, string> = {
  T: 'Taunt', DS: 'Ward', V: 'Execute', W: 'Flurry', R: 'Rise', C: 'Cleave',
};

export function UnitEditor({
  value, anchor, onChange, onToggleKeyword, onRemove, onClose, cards: cardsProp, golden, onToggleGolden, lockedKeywords, searchable,
}: {
  value: UnitEditorValue;
  /** The edited card's rect, in viewport coordinates — the popover seats itself under it. */
  anchor: DOMRect;
  onChange: (patch: Partial<UnitEditorValue>) => void;
  onToggleKeyword: (kw: Keyword) => void;
  /** Present only for opponent slots, which can be removed; your own row is edited, never emptied here. */
  onRemove?: () => void;
  onClose: () => void;
  /**
   * The cards offered in the swap dropdown. When provided, replaces the internal `BUYABLE_CARDS` fallback —
   * that list is `@deprecated` and pinned to set 1, so a sandbox run on another set would otherwise be offered
   * the wrong cards. Callers that know the run's own pool (e.g. via `poolOf(run)`) should pass it.
   */
  cards?: { id: string; name: string; hay?: string }[];
  /**
   * Keywords printed on the card (the Stage Builder): shown on and disabled — the author adds keywords on top,
   * never strips a printed one. Absent = every toggle is live (the sandbox, which edits the keyword set whole).
   */
  lockedKeywords?: readonly Keyword[];
  /** Offer a search box over the swap list, for a long list (every minion card). Matches `hay`, else the name. */
  searchable?: boolean;
  /** Golden state + toggle, offered only when a handler is given (the sandbox enemy editor / Stage Builder). */
  golden?: boolean;
  onToggleGolden?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fallbackCards = useMemo(
    () => [...BUYABLE_CARDS].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name })),
    [],
  );
  const cards = useMemo<{ id: string; name: string; hay?: string }[]>(
    () => (cardsProp !== undefined ? [...cardsProp].sort((a, b) => a.name.localeCompare(b.name)) : fallbackCards),
    [cardsProp, fallbackCards],
  );
  const [query, setQuery] = useState('');
  const found = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (searchable !== true || terms.length === 0) return [];
    return cards.filter((c) => {
      const h = c.hay ?? c.name.toLowerCase();
      return terms.every((t) => h.includes(t));
    }).slice(0, 8);
  }, [cards, query, searchable]);
  const pick = (cardId: string): void => { onChange({ cardId }); setQuery(''); };

  // Escape closes, and a pointerdown anywhere outside closes. Both on the CAPTURE phase: the board beneath
  // has its own pointerdown handlers (drag, buy), and a bubbling listener would let the click start a drag
  // before the editor ever saw it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const onDown = (e: PointerEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  // Seated under the card, clamped into the viewport so an edit on the rightmost slot doesn't run off-screen.
  // `anchor` is STAGE px (the caller converts it); clamp against the window in stage px too (stage.ts).
  const vp = stageViewport();
  const width = 232;
  const left = Math.max(8, Math.min(vp.w - width - 8, anchor.left + anchor.width / 2 - width / 2));
  const top = Math.min(vp.h - 8, anchor.bottom + 6);

  return createPortal(
    <div className="uned" ref={ref} style={{ left, top, width }} onPointerDown={(e) => e.stopPropagation()}>
      <select
        className="uned-card"
        value={value.cardId}
        onChange={(e) => onChange({ cardId: e.target.value })}
        aria-label="Which card this unit is. Swapping gives it that card's original stats."
      >
        {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {searchable === true && (
        <input
          className="uned-find"
          value={query}
          placeholder="search cards to swap…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) { e.preventDefault(); pick(found[0].id); } }}
          aria-label="Search every card to swap this unit to. Enter picks the top match."
        />
      )}
      {found.length > 0 && (
        <div className="uned-found">
          {found.map((c) => (
            <button key={c.id} className="uned-foundrow" onClick={() => pick(c.id)}>{c.name}</button>
          ))}
        </div>
      )}
      {/* The game's own stat badges, typeable (owner ask 2026-09-16) — `.sb-stats` un-absolutes them. The floors
          (0 attack, 1 health) are applied by the field on commit AND by `sandboxEdit.ts` (the rules), so the
          badge always settles on what the sim accepted. */}
      <div className="uned-stats sb-stats">
        <StatBadgeField stat="atk" min={0} value={value.attack} onCommit={(n) => onChange({ attack: n })} title="Attack — click to type, ↑/↓ or wheel to step (Shift = 5)" />
        <StatBadgeField stat="hp" min={1} value={value.health} onCommit={(n) => onChange({ health: n })} title="Health — click to type, ↑/↓ or wheel to step (Shift = 5)" />
      </div>
      <div className="uned-kw">
        {EDITABLE_KEYWORDS.map((kw) => {
          const locked = lockedKeywords?.includes(kw) === true;
          const on = locked || value.keywords.includes(kw);
          return (
            <button
              key={kw}
              className={`uned-kwbtn${on ? ' on' : ''}${locked ? ' locked' : ''}`}
              disabled={locked}
              aria-pressed={on}
              onClick={() => { if (!locked) onToggleKeyword(kw); }}
              aria-label={`${KEYWORD_LABEL[kw] ?? kw}${locked ? ' (printed on the card)' : ''}`}
            >
              {KEYWORD_LABEL[kw] ?? kw}
            </button>
          );
        })}
      </div>
      {onToggleGolden !== undefined && (
        <button
          className={`uned-kwbtn uned-golden${golden === true ? ' on' : ''}`}
          onClick={onToggleGolden}
          aria-pressed={golden === true}
        >
          Golden
        </button>
      )}
      {onRemove !== undefined && (
        <button className="uned-remove" onClick={onRemove} aria-description="Remove this unit from the opponent board">
          remove
        </button>
      )}
    </div>,
    stageHost(),
  );
}
