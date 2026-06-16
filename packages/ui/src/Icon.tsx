import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  poison: <path fill="currentColor" d="M12 2s6 7 6 11a6 6 0 11-12 0c0-4 6-11 6-11z" />,
  taunt: <path fill="currentColor" d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />,
  shield: <path fill="none" stroke="currentColor" strokeWidth="2.5" d="M12 3l7 2.5v6c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5v-6L12 3z" />,
  cleave: <path fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="M4 6l16 12M20 6L4 18" />,
  sc: <path fill="currentColor" d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />,
  ember: <path fill="currentColor" d="M12 2s5 6 5 11a5 5 0 11-10 0c0-2 1-4 2-5 0 2 1 3 2 3 1-3-1-6 1-9z" />,
  heart: <path fill="currentColor" d="M12 21C5 16 3 11 3 8a4.5 4.5 0 019-1 4.5 4.5 0 019 1c0 3-2 8-9 13z" />,
  anvil: <path fill="currentColor" d="M5 7h9c0 2 1 3 3 3v3l3 1-1 3H7l-1-3 2-1V9H5V7zm1 11h10v2H6v-2z" />,
  refresh: <path fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="M20 11a8 8 0 10-1 5M20 4v5h-5" />,
  freeze: <path fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="M12 2v20M4 7l16 10M20 7L4 17" />,
  up: <path fill="currentColor" d="M12 3l9 10h-6v8H9v-8H3z" />,
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
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name] ?? null}
    </svg>
  );
}
