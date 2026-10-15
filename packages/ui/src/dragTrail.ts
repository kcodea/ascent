/**
 * THE DRAGGED CARD'S TRAIL: distance-gated wind wisps behind a held card (gold for Ward, blue for Reborn), one
 * `pixiFx.trail` per `emitSpacing` px of travel. ONE step for every held card: the player's own drag (Recruit's
 * pointer move) and a spectator's view of it (the live drag under the watched player's fist, and the flight ghost),
 * so a watcher sees the same trail the player made (owner 2026-10-15).
 */
import { pixiFx } from './pixiFx';
import { getTrailConfig } from './trailConfig';

export interface DragTrail { last: { x: number; y: number } | null }

export const newDragTrail = (): DragTrail => ({ last: null });

/** The held card is at (x, y) in screen px: emit a wisp once it has travelled far enough since the last one. */
export function dragTrailStep(t: DragTrail, x: number, y: number, keywords: readonly string[]): void {
  if (!t.last) { t.last = { x, y }; return; }
  const dx = x - t.last.x;
  const dy = y - t.last.y;
  if (Math.hypot(dx, dy) < getTrailConfig().emitSpacing) return;
  const variant = keywords.includes('DS') ? 'gold' : keywords.includes('R') ? 'blue' : 'wind';
  pixiFx.trail(x, y, dx, dy, variant);
  t.last = { x, y };
}
