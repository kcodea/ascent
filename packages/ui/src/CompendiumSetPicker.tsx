import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SetId } from '@game/content';

/** One row of the picker: a set from the registry, and whether it is the set new runs play right now. */
export interface SetPickerOption {
  id: SetId;
  name: string;
  live: boolean;
}

/**
 * The Compendium's SET PICKER (owner ask 2026-09-24): a custom dropdown at the far right of the tier bar that
 * swaps which card set the book shows. View-only: it only reports the chosen id to the book, never touches the
 * active set or any run.
 *
 * A listbox, not a native `<select>` (the owner wants it in the game's own style). Keyboard: Enter / Space /
 * ArrowDown opens it, arrows move, Home / End jump, Enter / Space picks, Esc or Tab closes. A click anywhere
 * else closes it. Esc is claimed in the CAPTURE phase while open, so it closes the dropdown and not the book.
 * The open/close is a one-shot opacity + transform transition (no looping paint).
 */
export function CompendiumSetPicker({ options, value, onChange }: {
  options: readonly SetPickerOption[];
  value: SetId;
  onChange: (id: SetId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const optRefs = useRef<(HTMLLIElement | null)[]>([]);
  const listId = useId();
  const current = options.find((o) => o.id === value) ?? options[0];

  const openList = (): void => {
    setFocusIdx(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  };
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };
  const pick = (id: SetId): void => {
    if (id !== value) onChange(id);
    close(true);
  };

  // While open: a click outside closes it, and Esc closes it WITHOUT reaching the book's own Esc (which would
  // close the whole Compendium). Capture phase on window runs before the Game's bubble-phase Esc handler.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Keep DOM focus on the highlighted option so screen readers follow it.
  useEffect(() => {
    if (open) optRefs.current[focusIdx]?.focus();
  }, [open, focusIdx]);

  const onButtonKey = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(); }
  };
  const onListKey = (e: ReactKeyboardEvent): void => {
    const last = options.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx((i) => Math.min(last, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setFocusIdx(0); }
    else if (e.key === 'End') { e.preventDefault(); setFocusIdx(last); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = options[focusIdx]; if (o) pick(o.id); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  return (
    <div className={`book-setpick${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="book-setpick-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Card set: ${current?.name ?? ''}. Choose a set to browse.`}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKey}
      >
        <span className="book-setpick-cap">Set</span>
        <span className="book-setpick-name">{current?.name}</span>
        {current?.live && <span className="book-setpick-live">Live</span>}
        <svg className="book-setpick-caret" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M5 8.5h14L12 17z" />
        </svg>
      </button>
      <ul
        id={listId}
        className="book-setpick-list"
        role="listbox"
        aria-label="Card sets"
        aria-hidden={!open}
        onKeyDown={onListKey}
      >
        {options.map((o, i) => (
          <li
            key={o.id}
            ref={(el) => { optRefs.current[i] = el; }}
            role="option"
            aria-selected={o.id === value}
            tabIndex={open ? (i === focusIdx ? 0 : -1) : undefined}
            className={`book-setpick-opt${o.id === value ? ' on' : ''}${i === focusIdx ? ' is-focus' : ''}`}
            onClick={() => pick(o.id)}
            onPointerEnter={() => setFocusIdx(i)}
          >
            <span className="book-setpick-optname">{o.name}</span>
            {o.live && <span className="book-setpick-live">Live</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
