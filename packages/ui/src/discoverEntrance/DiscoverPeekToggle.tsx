/**
 * THE DISCOVER PEEK TOGGLE (owner ask 2026-09-25: "can you make the minimize button better"): the one button pinned
 * just below the Discover cards that flips between PEEK (hide the offer, look at the board) and RETURN (bring the
 * offer back). Restyled to match the ornate gold banner and the spotlight backdrop: dark glass, a gold gradient trim,
 * small gold diamonds on its ends and an inline SVG icon.
 *
 * It stays ONE button in ONE fixed spot for both states (the B2 contract: the player flips back and forth without
 * moving the mouse). Hover and press are transform + opacity only, over a STATIC glow (see `.disc-peek` in
 * `discoverEntrance.css`); the game's gauntlet cursor comes from the global `button` rule.
 */
export function DiscoverPeekToggle({ minimized, options, onToggle }: {
  minimized: boolean;
  /** How many options the hidden Discover holds (shown while minimized). */
  options: number;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`disc-toggle disc-peek${minimized ? ' is-min' : ''}`}
      onClick={onToggle}
      aria-pressed={minimized}
      aria-description={minimized ? 'Bring your Discover back' : 'Hide the Discover to look at your board, then return to choose'}
    >
      <span className="disc-peek-glow" aria-hidden="true" />
      {minimized ? <ReturnIcon /> : <PeekIcon />}
      <span className="disc-peek-label">{minimized ? 'Return to Discover' : 'Peek at board'}</span>
      {minimized && <span className="disc-peek-count">{options} {options === 1 ? 'option' : 'options'}</span>}
    </button>
  );
}

/** An open eye with a gold iris: "look at the board". */
function PeekIcon(): JSX.Element {
  return (
    <svg className="disc-peek-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12c2.6-4.1 6-6.2 9.5-6.2s6.9 2.1 9.5 6.2c-2.6 4.1-6 6.2-9.5 6.2S5.1 16.1 2.5 12z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.3" fill="currentColor" />
      <circle cx="13.2" cy="10.9" r="1" fill="#1a1109" />
    </svg>
  );
}

/** Three fanned cards rising: "bring the offer back". */
function ReturnIcon(): JSX.Element {
  return (
    <svg className="disc-peek-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.2" y="8" width="7" height="10" rx="1.4" transform="rotate(-14 6.7 13)" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <rect x="13.8" y="8" width="7" height="10" rx="1.4" transform="rotate(14 17.3 13)" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <rect x="8.5" y="6.5" width="7" height="10.5" rx="1.4" fill="currentColor" />
      <path d="M12 2.2l2.6 2.8h-5.2z" fill="currentColor" />
    </svg>
  );
}
