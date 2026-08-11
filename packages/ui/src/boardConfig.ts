/**
 * Board picker (owner ask 2026-08-11) — swap the in-game arena backdrop between the shipped board and a
 * "test board" still being trialled. It's a display-only preference: the choice overrides the `--board` CSS
 * var on the root (`.boardbg` + the hero-select preview read it), persists to localStorage, and applies once
 * at boot as a side-effect import so the pick survives a reload with no flash of the wrong art.
 *
 * The two arts share the SAME aspect (2.3578) and canvas size, so nothing else in the board layout changes —
 * `--board-aspect` / `--board-fill` / the tuned button offsets all still hold. If a future test board has a
 * different aspect, this needs to swap those too.
 */

export type BoardId = 'default' | 'august';

interface BoardOption {
  id: BoardId;
  label: string;
  blurb: string;
  /** The CSS `url(...)` for `--board`, or null to fall back to the stylesheet default. */
  url: string | null;
}

export const BOARDS: BoardOption[] = [
  { id: 'default', label: 'Classic', blurb: 'The shipped arena board', url: null },
  { id: 'august', label: 'Test board', blurb: 'New August board — in trial', url: "url('/newboardaugust.webp')" },
];

const KEY = 'ascent.board';

export function getBoard(): BoardId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && BOARDS.some((b) => b.id === v)) return v as BoardId;
  } catch { /* private mode / no storage — fall through to default */ }
  return 'default';
}

/** Push the chosen board's art into the `--board` var (or clear the override to restore the stylesheet default). */
function apply(id: BoardId): void {
  if (typeof document === 'undefined') return;
  const opt = BOARDS.find((b) => b.id === id) ?? BOARDS[0]!;
  const root = document.documentElement.style;
  if (opt.url) root.setProperty('--board', opt.url);
  else root.removeProperty('--board'); // let the :root stylesheet value win again
}

export function setBoard(id: BoardId): void {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  apply(id);
}

// Apply the saved pick at load (side-effect import), before first paint of the board.
apply(getBoard());
