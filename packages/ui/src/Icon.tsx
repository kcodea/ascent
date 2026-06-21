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
  fodder: (
    <>
      <path fill="currentColor" d="M12 3l8 4-8 4-8-4z" />
      <path fill="currentColor" opacity="0.65" d="M4 7.4l7.4 3.7v7.9L4 15.3z" />
      <path fill="currentColor" opacity="0.85" d="M20 7.4l-7.4 3.7v7.9L20 15.3z" />
    </>
  ),
  battlecry: (
    <>
      <path fill="currentColor" d="M4 9.5v5h3l6 3.5v-12L7 9.5H4z" />
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M16.5 8.5l2.5-1.5M17.5 12H21M16.5 15.5l2.5 1.5" />
    </>
  ),
  ember: <path fill="currentColor" d="M12 2s5 6 5 11a5 5 0 11-10 0c0-2 1-4 2-5 0 2 1 3 2 3 1-3-1-6 1-9z" />,
  mana: (
    <>
      <path fill="currentColor" d="M12 2.5C12 2.5 5 10 5 14.5a7 7 0 0014 0C19 10 12 2.5 12 2.5z" />
      <path fill="rgba(255,255,255,0.5)" d="M9.3 13.4c.3-1.7 1.4-3.4 2.7-4.9-2 .8-3.6 2.6-3.9 4.7-.1.6.3 1.1.9.9.2-.1.3-.4.3-.7z" />
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
