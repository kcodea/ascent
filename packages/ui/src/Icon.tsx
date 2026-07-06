import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  poison: <path fill="currentColor" d="M12 2s6 7 6 11a6 6 0 11-12 0c0-4 6-11 6-11z" />,
  taunt: <path fill="currentColor" d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />,
  shield: <path fill="none" stroke="currentColor" strokeWidth="2.5" d="M12 3l7 2.5v6c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5v-6L12 3z" />,
  cleave: <path fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="M4 6l16 12M20 6L4 18" />,
  sc: <path fill="currentColor" d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />,
  windfury: <path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M4 6l6 6-6 6M12 6l6 6-6 6" />,
  reborn: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" d="M18.4 8.5A7 7 0 1 0 19 12" />
      <path fill="currentColor" d="M19.9 4.1l1 5.3-5-1.6z" />
    </>
  ),
  magnetic: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="3" d="M6 4.5v6a6 6 0 0 0 12 0v-6" />
      <path fill="currentColor" d="M4.5 4h3.4v3.5H4.5zM16.1 4h3.4v3.5h-3.4z" />
    </>
  ),
  consume: <path fill="currentColor" d="M12 12l8.5-4.8A9.2 9.2 0 1 0 20.5 16.8z" />,
  // Fodder — a little imp head with two curved horns and hollow eyes (the token your minions devour).
  fodder: (
    <>
      <path fill="currentColor" d="M6.6 3.2c1 1.3 1.6 2.8 1.9 4.6l-3.1-1.7C5.2 5 5.6 4 6.6 3.2z" />
      <path fill="currentColor" d="M17.4 3.2c-1 1.3-1.6 2.8-1.9 4.6l3.1-1.7C18.8 5 18.4 4 17.4 3.2z" />
      <path fillRule="evenodd" fill="currentColor" d="M12 6.4c-3.4 0-6 2.5-6 5.7 0 2 1.1 3.8 2.8 4.9l.4 2.9 1.8-1.5c.3.1.7.1 1 .1s.7 0 1-.1l1.8 1.5.4-2.9c1.7-1.1 2.8-2.9 2.8-4.9 0-3.2-2.6-5.7-6-5.7zm-2.5 4.7c.8 0 1.4.7 1.4 1.5s-.6 1.5-1.4 1.5-1.4-.7-1.4-1.5.6-1.5 1.4-1.5zm5 0c.8 0 1.4.7 1.4 1.5s-.6 1.5-1.4 1.5-1.4-.7-1.4-1.5.6-1.5 1.4-1.5z" />
    </>
  ),
  // Slaughter — an upright sword (fires each time this minion kills). Distinct from Rally's diagonal blade.
  slaughter: (
    <>
      <path fill="currentColor" d="M12 2l1.5 12h-3z" />
      <rect x="7" y="12.8" width="10" height="2.1" rx="0.7" fill="currentColor" />
      <rect x="11.1" y="14.9" width="1.8" height="4.6" fill="currentColor" />
      <circle cx="12" cy="20.5" r="1.6" fill="currentColor" />
    </>
  ),
  // Immune — a shield with a bold cross (can't take damage).
  immune: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" d="M12 3l7 2.5v6c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5v-6L12 3z" />
      <path fill="currentColor" d="M10.9 7.2h2.2v2.9H16v2.2h-2.9v3h-2.2v-3H8v-2.2h2.9z" />
    </>
  ),
  // Choose One — an arrow that forks into two directions (pick one of two effects).
  choose1: (
    <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      d="M12 21v-6.2M12 14.8l-4.8-4.8M12 14.8l4.8-4.8M7.2 10l3.4.3M7.2 10l.3 3.4M16.8 10l-3.4.3M16.8 10l-.3 3.4" />
  ),
  // Echo — skull & crossbones (Deathrattle: fires when this minion dies).
  echo: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" d="M6.2 20.4L17.8 12.6M6.2 12.6l11.6 7.8" />
      <path fillRule="evenodd" fill="currentColor" d="M12 2.8c-3.2 0-5.7 2.4-5.7 5.4 0 1.9.9 3.5 2.4 4.5v1.5c0 .6.5 1.1 1.1 1.1h4.4c.6 0 1.1-.5 1.1-1.1v-1.5c1.5-1 2.4-2.6 2.4-4.5 0-3-2.5-5.4-5.7-5.4zm-2.5 4.7c.8 0 1.4.7 1.4 1.5s-.6 1.5-1.4 1.5-1.4-.7-1.4-1.5.6-1.5 1.4-1.5zm5 0c.8 0 1.4.7 1.4 1.5s-.6 1.5-1.4 1.5-1.4-.7-1.4-1.5.6-1.5 1.4-1.5z" />
    </>
  ),
  // Start of Combat — a clenched fist (fires the moment battle begins).
  fist: (
    <>
      <rect x="6.4" y="10.6" width="11.2" height="8.6" rx="2.5" fill="currentColor" />
      <rect x="7.1" y="8" width="2.3" height="4.4" rx="1.15" fill="currentColor" />
      <rect x="9.7" y="7.3" width="2.3" height="5.1" rx="1.15" fill="currentColor" />
      <rect x="12.3" y="7.5" width="2.3" height="4.9" rx="1.15" fill="currentColor" />
      <rect x="14.9" y="8.1" width="2.2" height="4.3" rx="1.1" fill="currentColor" />
      <path fill="currentColor" d="M6.5 12.4c-1.4-.2-2.4.3-2.4 1.5s1 1.7 2.4 1.6z" />
    </>
  ),
  // Rise — a tombstone (left) with a hand reaching up out of the ground (returns once on death).
  rise: (
    <>
      <path fill="currentColor" d="M5 18V9a2.7 2.7 0 015.4 0v9z" />
      <rect x="2.8" y="17.3" width="18.4" height="2.9" rx="0.8" fill="currentColor" />
      <rect x="12.6" y="14.1" width="6.4" height="4.1" rx="1.4" fill="currentColor" />
      <rect x="13" y="11.3" width="1.5" height="3.7" rx="0.75" fill="currentColor" />
      <rect x="15" y="10.4" width="1.5" height="4.6" rx="0.75" fill="currentColor" />
      <rect x="17" y="11.3" width="1.5" height="3.7" rx="0.75" fill="currentColor" />
    </>
  ),
  battlecry: (
    <>
      <path fill="currentColor" d="M4 9.5v5h3l6 3.5v-12L7 9.5H4z" />
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M16.5 8.5l2.5-1.5M17.5 12H21M16.5 15.5l2.5 1.5" />
    </>
  ),
  ember: <path fill="currentColor" d="M12 2s5 6 5 11a5 5 0 11-10 0c0-2 1-4 2-5 0 2 1 3 2 3 1-3-1-6 1-9z" />,
  // Gold coin (the currency was renamed Mana → Gold; the icon key stays `mana`). A gold disc with a
  // stamped rim + sparkle and a top-left shine — reads as a coin at badge size.
  mana: (
    <>
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <circle cx="12" cy="12" r="6.3" fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="1.3" />
      <path fill="rgba(0,0,0,0.22)" d="M12 7.5C12.3 10.3 13.7 11.7 16.5 12 13.7 12.3 12.3 13.7 12 16.5 11.7 13.7 10.3 12.3 7.5 12 10.3 11.7 11.7 10.3 12 7.5Z" />
      <path fill="rgba(255,255,255,0.45)" d="M7.7 8.2A6.6 6.6 0 0 1 11 5.7c-2.1.3-3.9 1.6-4.6 3.4-.2.5.3 1 .8.7.2-.1.4-.3.5-.6z" />
    </>
  ),
  heart: <path fill="currentColor" d="M12 21C5 16 3 11 3 8a4.5 4.5 0 019-1 4.5 4.5 0 019 1c0 3-2 8-9 13z" />,
  anvil: <path fill="currentColor" d="M5 7h9c0 2 1 3 3 3v3l3 1-1 3H7l-1-3 2-1V9H5V7zm1 11h10v2H6v-2z" />,
  refresh: <path fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="M20 11a8 8 0 10-1 5M20 4v5h-5" />,
  freeze: <path fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="M12 2v20M4 7l16 10M20 7L4 17" />,
  up: <path fill="currentColor" d="M12 3l9 10h-6v8H9v-8H3z" />,
  house: <path fill="currentColor" d="M12 3.2L2.8 11H5.2V20.5H10V15H14V20.5H18.8V11H21.2Z" />,
  sword: <path fill="currentColor" d="M14 3h7v7l-3.5-1L9 17l1 3-3 1-1-3 8-8.5L14 6z" />,
  paw: (
    <>
      <ellipse cx="12" cy="16.2" rx="4.3" ry="3.4" fill="currentColor" />
      <circle cx="6.4" cy="11" r="2" fill="currentColor" />
      <circle cx="17.6" cy="11" r="2" fill="currentColor" />
      <circle cx="9.4" cy="7.4" r="1.9" fill="currentColor" />
      <circle cx="14.6" cy="7.4" r="1.9" fill="currentColor" />
    </>
  ),
  flame: <path fill="currentColor" d="M12 2s5 6 5 11a5 5 0 11-10 0c0-2 1-4 2-5 0 2 1 3 2 3 1-3-1-6 1-9z" />,
  gear: <path fill="currentColor" d="M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM10.8 2h2.4l.4 2.3 1.6.7 2-1.2 1.7 1.7-1.2 2 .7 1.6 2.3.4v2.4l-2.3.4-.7 1.6 1.2 2-1.7 1.7-2-1.2-1.6.7-.4 2.3h-2.4l-.4-2.3-1.6-.7-2 1.2-1.7-1.7 1.2-2-.7-1.6L2 13.2v-2.4l2.3-.4.7-1.6-1.2-2L5.5 5l2 1.2 1.6-.7z" />,
  skull: <path fill="currentColor" d="M12 3a7 7 0 017 7c0 2.2-1 4.1-2.6 5.3v2.2a1.5 1.5 0 01-1.5 1.5h-1v-2h-2v2H9.1a1.5 1.5 0 01-1.5-1.5v-2.2A7 7 0 015 10a7 7 0 017-7zm-3 7.5a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2zm6 0a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z" />,
  eye: <path fill="currentColor" d="M2 12c3-4.5 7-6.5 10-6.5S19 7.5 22 12c-3 4.5-7 6.5-10 6.5S5 16.5 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z" />,
  star: <path fill="currentColor" d="M12 2l2.3 7.2H22l-6.1 4.5 2.3 7.3-6.2-4.5-6.2 4.5 2.3-7.3L2 9.2h7.7z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3.5 2" />
    </>
  ),
  crown: (
    <>
      <path fill="currentColor" d="M4 9l3.4 3.3L12 6l4.6 6.3L20 9l-1.4 8.4H5.4L4 9z" />
      <rect x="5.3" y="18.4" width="13.4" height="2.3" rx="0.7" fill="currentColor" />
    </>
  ),
  sound: (
    <>
      <path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z" />
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M15.5 9a4 4 0 010 6M18 6.5a8 8 0 010 11" />
    </>
  ),
  mute: (
    <>
      <path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z" />
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name] ?? null}
    </svg>
  );
}
