/**
 * Board picker (owner ask 2026-08-11) — swap the in-game arena backdrop. The FULL board is the default now
 * (owner promoted it 2026-08-17); the previous wide August board and the original Classic stone board are
 * togglable alternates. It's a display-only preference: the choice overrides the `--board` CSS var on the root
 * (`.boardbg` + the hero-select preview read it), persists to localStorage, and applies once at boot as a
 * side-effect import so the pick survives a reload with no flash of the wrong art.
 *
 * The arts no longer share one aspect: the default is 16:9 (1.7919) while both alternates are 21:9 (2.3578).
 * `.boardbg` computes the art's WIDTH from the stage height × `--board-aspect` × `--board-fill`, so an art
 * served under the wrong aspect gets stretched and throws the frame off the stage. Hence the optional
 * `aspect` / `fill` per option, which `apply()` pushes onto those two vars alongside `--board` — and REMOVES
 * for any option that sets neither, so the stylesheet default keeps winning. The tuned button offsets are
 * calibrated against the DEFAULT board, so an alternate may need the layout lab (`--board-zoom` / `--board-x` /
 * `--board-y`) to re-seat.
 */

export type BoardId = 'default' | 'august' | 'classic';

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

// The two wide boards share one canvas shape, so they share these numbers — see the stylesheet's `--board-fill`
// comment for where 1.0132 comes from.
const WIDE_ASPECT = 2.3578;
const WIDE_FILL = 1.0132;

export const BOARDS: BoardOption[] = [
  // `default` is the FULL board now — url null means it reads the stylesheet `--board` (augustfullboard.webp),
  // along with the 16:9 aspect/fill that ships with it.
  { id: 'default', label: 'Full Board', blurb: 'The arena board', url: null },
  { id: 'august', label: 'August Wide', blurb: 'The previous 21:9 board', url: "url('/newboardaugust.webp')", aspect: WIDE_ASPECT, fill: WIDE_FILL },
  { id: 'classic', label: 'Classic', blurb: 'The original stone board', url: "url('/ascentboardnostuff.webp')", aspect: WIDE_ASPECT, fill: WIDE_FILL },
];

const KEY = 'ascent.board';

export function getBoard(): BoardId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && BOARDS.some((b) => b.id === v)) return v as BoardId;
  } catch { /* private mode / no storage — fall through to default */ }
  // Also the landing spot for a retired id (the short-lived `augustfull` test pick), which resolves to the
  // default — now the same art it named.
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
