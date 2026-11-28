/**
 * Pack shop drag rules: a pure state machine, no Pixi and no DOM. A pack picked up from the shelf and released
 * strictly below the counter line (when affordable) is bought; anywhere else it returns to the shelf. A pack picked up
 * from the hand and released on the pedestal is played; anywhere else it returns to the hand. The functions mutate `d`
 * in place so a per-frame caller allocates nothing.
 */
import type { ShopLayout } from './shopLayout';

export type DragPhase = 'idle' | 'heldShelf' | 'buying' | 'toHand' | 'toShelf' | 'heldHand' | 'toPedestal' | 'toHandBack';
export type DragZone = 'shelf' | 'hand' | 'pedestal';
export type DropAction = 'buy' | 'return' | 'play' | 'none';
export interface ShopDrag { phase: DragPhase; id: string | null; overLine: boolean }

/** How close to the pedestal's centre (in pedestal heights) still counts as on the pedestal. */
const PEDESTAL_REACH = 0.6;

export const newDrag = (): ShopDrag => ({ phase: 'idle', id: null, overLine: false });

/** `hand` only strictly below the line; `pedestal` within 0.6 pedestal heights of the pedestal's centre; else `shelf`. */
export function zoneAt(L: ShopLayout, x: number, y: number): DragZone {
  const dx = x - L.w / 2, dy = y - L.shelfY, r = PEDESTAL_REACH * L.pedestalH;
  // The pedestal's reach spills past the counter line at this layout; the line still wins, so a drop on it is shelf.
  if (y < L.lineY && dx * dx + dy * dy <= r * r) return 'pedestal';
  return y > L.lineY ? 'hand' : 'shelf';
}

/** False unless idle. */
export function pickUp(d: ShopDrag, from: 'shelf' | 'hand', id: string): boolean {
  if (d.phase !== 'idle') return false;
  d.phase = from === 'shelf' ? 'heldShelf' : 'heldHand';
  d.id = id;
  d.overLine = false;
  return true;
}

export function moveHeld(d: ShopDrag, zone: DragZone, affordable: boolean): void {
  d.overLine = d.phase === 'heldShelf' && zone === 'hand' && affordable;
}

export function release(d: ShopDrag, zone: DragZone, affordable: boolean): DropAction {
  d.overLine = false;
  if (d.phase === 'heldShelf') {
    if (zone === 'hand' && affordable) { d.phase = 'buying'; return 'buy'; }
    d.phase = 'toShelf';
    return 'return';
  }
  if (d.phase === 'heldHand') {
    if (zone === 'pedestal') { d.phase = 'toPedestal'; return 'play'; }
    d.phase = 'toHandBack';
    return 'return';
  }
  return 'none';
}

export function buySettled(d: ShopDrag, ok: boolean): void {
  if (d.phase === 'buying') d.phase = ok ? 'toHand' : 'toShelf';
}

/** A resize / lost pointer: a held pack always returns to where it came from. */
export function cancelHeld(d: ShopDrag): DropAction {
  d.overLine = false;
  if (d.phase === 'heldShelf') { d.phase = 'toShelf'; return 'return'; }
  if (d.phase === 'heldHand') { d.phase = 'toHandBack'; return 'return'; }
  return 'none';
}

export function arrived(d: ShopDrag): void {
  d.phase = 'idle';
  d.id = null;
  d.overLine = false;
}
