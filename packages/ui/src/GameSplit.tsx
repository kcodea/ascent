/**
 * THE GAME SPLIT (UI pass 2, 2026-10-16; owner: "that B. style view you had in an earlier build was pretty slick" and
 * "maybe even do something like that for career"). ONE list + detail view for a list of finished games, used by
 * Recent Games and by the Career's Match History and Practice tabs:
 *
 *   LEFT    a compact game list: placement (band colour, the crown on a 1st), the hero portrait, a title + sub line,
 *           and at the right the rating change and when it was played. Light rows: no boards, so 50 of them mount at
 *           once with no lazy rows.
 *   RIGHT   the selected game in full: the shared GameCard in its `gc-detail` layout (board, runes, Replay, meta) with
 *           the lobby standings under it. Only this one game's board is ever mounted.
 *
 * Up / Down move the selection while the list has focus. The host owns the data and the detail node; this is layout.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { bandOf, placeText } from './GameCard';
import { sfx } from './sfx';

export interface GameListItem {
  key: string;
  place: number | null;
  /** The hero portrait in its recorded frame. */
  portrait: ReactNode;
  title: string;
  sub?: string;
  /** "Oct 16, 12:39 PM". */
  when?: string;
  /** The rating change the game settled (ranked only); nothing when null or 0. */
  delta?: number | null;
  /** The whole row, for assistive tech. */
  label: string;
}

export function GameSplit({ items, selected, onPick, detail, label, className = '' }: {
  items: readonly GameListItem[];
  selected: string | null;
  onPick: (key: string) => void;
  /** The selected game's full card (the host renders it; keyed here so it re-enters on a new pick). */
  detail: ReactNode;
  label: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // Keep the picked row in view (a pick from outside, e.g. Recent Games opening a Career on one game). `nearest` never
  // jumps a row that is already visible.
  useEffect(() => {
    const on = listRef.current?.querySelector<HTMLElement>('.gs-item.on');
    if (on && typeof on.scrollIntoView === 'function') on.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = items.findIndex((it) => it.key === selected);
    const next = items[Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i) + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next && next.key !== selected) { sfx.tick(); onPick(next.key); }
  };
  return (
    <div className={`gsplit ${className}`.trim()}>
      <div className="gs-list" role="listbox" aria-label={label} ref={listRef} tabIndex={0} onKeyDown={onKey}>
        {items.map((it) => {
          const band = bandOf(it.place);
          const on = it.key === selected;
          return (
            <button
              type="button" role="option" aria-selected={on} key={it.key} tabIndex={-1} aria-label={it.label}
              className={`gs-item gc-${band}${on ? ' on' : ''}`}
              onClick={() => { if (!on) { sfx.tick(); onPick(it.key); } }}
            >
              <span className={`gs-place ${band}`}>
                {band === 'won' && <span className="gs-crown" aria-hidden><Icon name="crown" /></span>}
                {placeText(it.place)}
              </span>
              <span className="gs-portrait">{it.portrait}</span>
              <span className="gs-who">
                <span className="gs-title">{it.title}</span>
                {it.sub && <span className="gs-sub">{it.sub}</span>}
              </span>
              <span className="gs-end">
                {it.delta != null && it.delta !== 0 && <span className={`gs-delta ${it.delta > 0 ? 'up' : 'down'}`}>{it.delta > 0 ? `+${it.delta}` : it.delta}</span>}
                {it.when && <span className="gs-when">{it.when}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="gs-detail">{detail && <div key={selected ?? ''} className="gs-in">{detail}</div>}</div>
    </div>
  );
}
