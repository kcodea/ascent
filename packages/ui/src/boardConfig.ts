/**
 * Board picker (owner ask 2026-08-11) — swap the in-game arena backdrop. The AUGUST board is the default now;
 * the Classic (original stone) board is a togglable alternate. It's a display-only preference: the choice
 * overrides the `--board` CSS
 * var on the root (`.boardbg` + the hero-select preview read it), persists to localStorage, and applies once
 * at boot as a side-effect import so the pick survives a reload with no flash of the wrong art.
 *
 * The two ORIGINAL arts share the SAME aspect (2.3578) and canvas size, so nothing else in the board layout
 * changes for them. A board whose art has a different aspect (e.g. the 16:9 `augustfull` test board) carries its
 * own `aspect` / `fill` here, and `apply()` pushes those onto `--board-aspect` / `--board-fill` alongside the
 * art — otherwise `.boardbg` would size the new art off the old art's proportions and stretch the frame off the
 * stage. The tuned button offsets are still calibrated against the DEFAULT board's art size, so a
 * different-aspect board may need the layout lab (`--board-zoom` / `--board-x` / `--board-y`) to re-seat.
 */

export type BoardId = 'default' | 'classic' | 'augustfull';

interface BoardOption {
  id: BoardId;
  label: string;
  blurb: string;
  /** The CSS `url(...)` for `--board`, or null to fall back to the stylesheet default. */
  url: string | null;
  /** Art aspect (w/h) when it differs from the stylesheet `--board-aspect`; omit to keep the default. */
  aspect?: number;
  /** Horizontal overscan when it differs from the stylesheet `--board-fill`; omit to keep the default. */
  fill?: number;
}

export const BOARDS: BoardOption[] = [
  // `default` is the AUGUST board now (owner promoted it 2026-08-11) — url null means it reads the stylesheet
  // `--board`, which points at newboardaugust.webp. `classic` overrides back to the original stone board.
  { id: 'default', label: 'August', blurb: 'The arena board', url: null },
  { id: 'classic', label: 'Classic', blurb: 'The original stone board', url: "url('/ascentboardnostuff.webp')" },
  // Test board (owner ask 2026-08-17): AugustFullBoard, a 16:9 art (3840x2143) rather than the 21:9 the other
  // two use — so it fills the stage exactly at fill 1.0 and there is no wide art left over to bleed into the
  // side margins on a monitor wider than 16:9 (those fall back to `--bg`).
  { id: 'augustfull', label: 'August Full', blurb: 'Full-board art (16:9)', url: "url('/augustfullboard.webp')", aspect: 1.7919, fill: 1 },
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
  // Same rule for the art's proportions: only a board that differs from the stylesheet default sets them.
  if (opt.aspect != null) root.setProperty('--board-aspect', String(opt.aspect));
  else root.removeProperty('--board-aspect');
  if (opt.fill != null) root.setProperty('--board-fill', String(opt.fill));
  else root.removeProperty('--board-fill');
}

export function setBoard(id: BoardId): void {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  apply(id);
}

// Apply the saved pick at load (side-effect import), before first paint of the board.
apply(getBoard());
