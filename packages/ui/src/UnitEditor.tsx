import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BUYABLE_CARDS } from '@game/content';
import type { Keyword } from '@game/core';

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
const KEYWORD_LABEL: Record<string, string> = {
  T: 'Taunt', DS: 'Ward', V: 'Execute', W: 'Flurry', R: 'Rise', C: 'Cleave',
};

export function UnitEditor({
  value, anchor, onChange, onToggleKeyword, onRemove, onClose,
}: {
  value: UnitEditorValue;
  /** The edited card's rect, in viewport coordinates — the popover seats itself under it. */
  anchor: DOMRect;
  onChange: (patch: Partial<UnitEditorValue>) => void;
  onToggleKeyword: (kw: Keyword) => void;
  /** Present only for opponent slots, which can be removed; your own row is edited, never emptied here. */
  onRemove?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cards = useMemo(
    () => [...BUYABLE_CARDS].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name })),
    [],
  );

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
  const width = 232;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left + anchor.width / 2 - width / 2));
  const top = Math.min(window.innerHeight - 8, anchor.bottom + 6);

  return createPortal(
    <div className="uned" ref={ref} style={{ left, top, width }} onPointerDown={(e) => e.stopPropagation()}>
      <select
        className="uned-card"
        value={value.cardId}
        onChange={(e) => onChange({ cardId: e.target.value })}
        title="Which card this unit is — swapping adopts its printed stats"
      >
        {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="uned-stats">
        <label className="uned-num">
          <span>atk</span>
          <input
            type="number" min={0} value={value.attack}
            onChange={(e) => onChange({ attack: Number(e.target.value) })}
          />
        </label>
        <label className="uned-num">
          <span>hp</span>
          <input
            type="number" min={1} value={value.health}
            onChange={(e) => onChange({ health: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="uned-kw">
        {EDITABLE_KEYWORDS.map((kw) => (
          <button
            key={kw}
            className={`uned-kwbtn${value.keywords.includes(kw) ? ' on' : ''}`}
            onClick={() => onToggleKeyword(kw)}
            title={KEYWORD_LABEL[kw] ?? kw}
          >
            {KEYWORD_LABEL[kw] ?? kw}
          </button>
        ))}
      </div>
      {onRemove !== undefined && (
        <button className="uned-remove" onClick={onRemove} title="Remove this unit from the opponent board">
          remove
        </button>
      )}
    </div>,
    document.body,
  );
}
