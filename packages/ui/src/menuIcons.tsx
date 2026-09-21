/**
 * The main-menu glyphs shared by the title screen's plaques (`Title.tsx`) and the ladder pages' menu sidebar
 * (`MenuSidebar.tsx`), so the same destination always wears the same icon wherever it is offered.
 */

/** The crest gem — the Play / Continue mark (also the logo's gem). */
export const Crest = () => (
  <svg viewBox="0 0 24 24" className="crest" aria-hidden="true">
    <path d="M12 1.5l3.4 3.9 5-1-1 5 3.6 3.6-3.6 3.6 1 5-5-1L12 24l-3.4-3.8-5 1 1-5L1 12.6l3.6-3.6-1-5 5 1z" fill="#c9a24e" />
    <path d="M12 4.6l6.4 7.4L12 19.4 5.6 12z" fill="#0f1c34" />
    <path d="M12 6.6l4.7 5.4L12 17.4 7.3 12z" fill="#3f9ae0" />
    <path d="M12 6.6l4.7 5.4L12 12z" fill="#7fd0ff" opacity="0.9" />
  </svg>
);

/** The trophy — the player Leaderboard. */
export const IconTrophy = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.4A6 6 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A6 6 0 0 1 7.4 12H7a4 4 0 0 1-4-4V5h3V3zm0 4H5v1a2 2 0 0 0 1 1.7V7zm12 0v2.7A2 2 0 0 0 19 8V7h-1z" /></svg>
);

/** The helm — Career (and the mode cards' fallback emblem). */
export const IconHelm = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a8 8 0 0 0-8 8v5a3 3 0 0 0 3 3h1v3h8v-3h1a3 3 0 0 0 3-3v-5a8 8 0 0 0-8-8zm-3 8h1.5v4H9a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-1.5v-4H15z" /></svg>
);
