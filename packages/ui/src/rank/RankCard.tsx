/**
 * THE CAREER RANK CARD (owner 2026-10-29: "make the ranked duos look like the solo rank"): the framed panel (the
 * Compendium's painted frame, `.cv2-panel.cv2-ranked`) with the big crest, the bar and its points, the division and
 * "N MMR" under it. The Career's Seasonal Ranked card and its Ranked Duos card are both this one component, so the two
 * can never drift apart. `header` sits above the crest (the Duos card's team line); `children` stand in for the crest
 * when there is no position yet (the solo card's loading ring / bare MMR).
 */
import type { ReactNode } from 'react';
import { RankBar } from './RankBar';
import { scalarCaption } from './rankFormat';
import type { RankPosition } from './types';

export function RankCard({ position, header, className = '', label, children }: {
  position: RankPosition | null;
  header?: ReactNode;
  className?: string;
  /** The card's accessible name (a region), when it needs one. */
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`cv2-panel cv2-ranked${className ? ` ${className}` : ''}`} {...(label ? { role: 'region', 'aria-label': label } : {})}>
      {header}
      {position ? <RankBar position={position} size="big" layout="stack" caption={`${scalarCaption(position)} MMR`} /> : children}
    </div>
  );
}
