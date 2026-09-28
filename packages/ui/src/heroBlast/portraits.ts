/** The two hero portraits the post-combat attack plays between: yours in the status bar, the foe's combat portrait. */
export interface PortraitGeometry {
  /** Screen-px centres of the striking and the struck hero. */
  a: { x: number; y: number };
  d: { x: number; y: number };
  /** The struck portrait's radius (screen px). */
  radius: number;
  /** The striking portrait's radius (screen px). */
  attackerRadius: number;
  attackerEl: HTMLElement;
  defenderEl: HTMLElement;
}

/** Measure both portraits once (the sequence start). Null when either is missing (a non-lobby run has no foe). */
export function portraitGeometry(side: 'player' | 'opp'): PortraitGeometry | null {
  if (typeof document === 'undefined') return null;
  const playerEl = document.querySelector<HTMLElement>('.statusbar .hero .herolunge');
  const oppEl = document.querySelector<HTMLElement>('.combatopp-body');
  if (!playerEl || !oppEl) return null;
  const pr = playerEl.getBoundingClientRect(), or = oppEl.getBoundingClientRect();
  if (pr.width === 0 || or.width === 0) return null;
  const centre = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const dr = side === 'player' ? or : pr;
  const ar = side === 'player' ? pr : or;
  return {
    a: centre(ar), d: centre(dr), radius: Math.min(dr.width, dr.height) / 2, attackerRadius: Math.min(ar.width, ar.height) / 2,
    attackerEl: side === 'player' ? playerEl : oppEl, defenderEl: side === 'player' ? oppEl : playerEl,
  };
}
