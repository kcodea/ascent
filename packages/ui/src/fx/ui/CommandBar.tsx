import { useEffect, useRef, useState } from 'react';
import { buildCommands, nextHighlight, type CommandItem, type CommandSources } from './commandIndex';

export interface CommandBarProps {
  open: boolean;
  sources: CommandSources;
  onClose: () => void;
  onRun: (item: CommandItem) => void;
}

/**
 * The workbench's ⌘K command palette overlay. Presentation only — every bit of matching/ranking and the
 * highlight-wrap arithmetic live in `commandIndex.ts` (`buildCommands` / `nextHighlight`) so they stay
 * unit-testable without a DOM. This component just renders the result and turns keystrokes/clicks into
 * calls onto `nextHighlight`, `onRun` and `onClose`.
 *
 * Deliberately does NOT trap the global keydown: the search input is autofocused on open and owns its own
 * `onKeyDown` for Up/Down/Enter/Escape while it holds focus, the same pattern the rest of the workbench's
 * modal-ish surfaces (`.fxlib`) use.
 */
export function CommandBar({ open, sources, onClose, onRun }: CommandBarProps): React.ReactElement | null {
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the query on every false→true transition, and autofocus the input so ⌘K can be typed into
  // immediately — never on a `open === false` render, which would fight whatever's focused underneath.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHi(0);
    inputRef.current?.focus();
  }, [open]);

  // The highlighted row resets to 0 on every query change (including the open-triggered reset above, which
  // sets query to '' and lands here too) — a stale highlight from the previous search would otherwise point
  // at a row that no longer exists, or the wrong one.
  useEffect(() => {
    setHi(0);
  }, [query]);

  if (!open) return null;

  const items = buildCommands(sources, query);

  const run = (item: CommandItem | undefined): void => {
    if (item === undefined) return;
    onRun(item);
    onClose();
  };

  return (
    <div className="fxwb-cmd" onClick={onClose} role="dialog" aria-label="Command palette">
      {/* `.fxwb-cmd-panel` isn't in the brief's enumerated selector list, but this mirrors the codebase's
          established overlay+panel split (`.inspect-ov`/`.inspect-card`, `.discover-ov`): the OUTER element
          is the fixed, full-screen backdrop that closes on click; a plain click-stopping inner box is what
          keeps that click from also closing the input/list it wraps. */}
      <div className="fxwb-cmd-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="fxwb-cmd-input"
          type="text"
          spellCheck={false}
          placeholder="Jump to a layer, param, or action…"
          aria-label="Command search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => nextHighlight(h, items.length, 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => nextHighlight(h, items.length, -1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(items[hi]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="fxwb-cmd-list" role="listbox">
          {items.length === 0 && <div className="fxwb-cmd-empty">No matches.</div>}
          {items.map((item, i) => (
            <div
              key={item.id}
              role="option"
              aria-selected={i === hi}
              className={`fxwb-cmd-row${i === hi ? ' hi' : ''}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => run(item)}
            >
              <span className="fxwb-cmd-kind">{item.kind}</span>
              <span className="fxwb-cmd-label">{item.label}</span>
              {item.hint !== undefined && <span className="fxwb-cmd-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
