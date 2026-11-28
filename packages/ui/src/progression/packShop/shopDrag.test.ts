import { describe, expect, it } from 'vitest';
import { shopLayout } from './shopLayout';
import { arrived, buySettled, cancelHeld, moveHeld, newDrag, pickUp, release, zoneAt } from './shopDrag';

describe('shopDrag', () => {
  it('starts idle', () => {
    expect(newDrag()).toEqual({ phase: 'idle', id: null, overLine: false });
  });

  it('zoneAt: pedestal near its centre, hand strictly below the line, else shelf', () => {
    const L = shopLayout(1920, 1080);
    expect(zoneAt(L, L.w / 2, L.shelfY)).toBe('pedestal');
    expect(zoneAt(L, L.w / 2 + 0.59 * L.pedestalH, L.shelfY)).toBe('pedestal');
    expect(zoneAt(L, L.w / 2 + 0.61 * L.pedestalH, L.shelfY)).toBe('shelf');
    expect(zoneAt(L, 100, L.handY)).toBe('hand');
    expect(zoneAt(L, 100, 10)).toBe('shelf');
  });

  it('releasing exactly on the line is not a purchase', () => {
    const L = shopLayout(1920, 1080);
    expect(zoneAt(L, 960, L.lineY)).toBe('shelf');
    expect(zoneAt(L, 960, L.lineY + 1)).toBe('hand');
  });

  it('pickUp only works from idle and records the source', () => {
    const a = newDrag();
    expect(pickUp(a, 'shelf', 'a')).toBe(true);
    expect(a).toEqual({ phase: 'heldShelf', id: 'a', overLine: false });
    expect(pickUp(a, 'hand', 'b')).toBe(false);
    const b = newDrag();
    expect(pickUp(b, 'hand', 'p')).toBe(true);
    expect(b).toEqual({ phase: 'heldHand', id: 'p', overLine: false });
  });

  it('moveHeld lights the line only for an affordable shelf pack over the hand', () => {
    const d = newDrag(); pickUp(d, 'shelf', 'a');
    moveHeld(d, 'hand', true); expect(d.overLine).toBe(true);
    moveHeld(d, 'shelf', true); expect(d.overLine).toBe(false);
    const h = newDrag(); pickUp(h, 'hand', 'p');
    moveHeld(h, 'hand', true); expect(h.overLine).toBe(false);
  });

  it('a shelf pack released in the hand when affordable is bought', () => {
    const d = newDrag(); pickUp(d, 'shelf', 'a'); moveHeld(d, 'hand', true);
    expect(release(d, 'hand', true)).toBe('buy');
    expect(d.phase).toBe('buying'); expect(d.overLine).toBe(false); expect(d.id).toBe('a');
  });

  it('a shelf pack released anywhere else returns to the shelf', () => {
    for (const z of ['shelf', 'pedestal'] as const) {
      const d = newDrag(); pickUp(d, 'shelf', 'a');
      expect(release(d, z, true)).toBe('return'); expect(d.phase).toBe('toShelf');
    }
  });

  it('a hand pack released on the pedestal is played', () => {
    const d = newDrag(); pickUp(d, 'hand', 'p');
    expect(release(d, 'pedestal', true)).toBe('play'); expect(d.phase).toBe('toPedestal');
  });

  it('a hand pack released anywhere else returns to the hand', () => {
    for (const z of ['shelf', 'hand'] as const) {
      const d = newDrag(); pickUp(d, 'hand', 'p');
      expect(release(d, z, true)).toBe('return'); expect(d.phase).toBe('toHandBack');
    }
  });

  it('release when not held does nothing', () => {
    const d = newDrag();
    expect(release(d, 'hand', true)).toBe('none'); expect(d.phase).toBe('idle');
    pickUp(d, 'shelf', 'a'); release(d, 'hand', true);
    expect(release(d, 'hand', true)).toBe('none'); expect(d.phase).toBe('buying');
  });

  it('buySettled moves buying to toHand or toShelf, and ignores other phases', () => {
    const a = newDrag(); pickUp(a, 'shelf', 'a'); release(a, 'hand', true);
    buySettled(a, true); expect(a.phase).toBe('toHand');
    const b = newDrag(); pickUp(b, 'shelf', 'a'); release(b, 'hand', true);
    buySettled(b, false); expect(b.phase).toBe('toShelf');
    const c = newDrag(); pickUp(c, 'shelf', 'a');
    buySettled(c, true); expect(c.phase).toBe('heldShelf');
  });

  it('arrived returns a travelling pack to idle', () => {
    const d = newDrag(); pickUp(d, 'hand', 'p'); release(d, 'pedestal', true);
    arrived(d);
    expect(d).toEqual({ phase: 'idle', id: null, overLine: false });
  });

  it('nothing can be picked up while a purchase is pending or a pack is travelling', () => {
    const d = newDrag(); pickUp(d, 'shelf', 'a'); release(d, 'hand', true);
    expect(d.phase).toBe('buying'); expect(pickUp(d, 'shelf', 'b')).toBe(false); expect(pickUp(d, 'hand', 'p')).toBe(false);
    buySettled(d, true); expect(d.phase).toBe('toHand'); expect(pickUp(d, 'shelf', 'b')).toBe(false);
    arrived(d); expect(pickUp(d, 'shelf', 'b')).toBe(true);
  });

  it('a pack that cannot be afforded never lights the line and always returns', () => {
    const d = newDrag(); pickUp(d, 'shelf', 'a'); moveHeld(d, 'hand', false);
    expect(d.overLine).toBe(false); expect(release(d, 'hand', false)).toBe('return'); expect(d.phase).toBe('toShelf');
  });

  it('a cancelled drag returns from either source', () => {
    const a = newDrag(); pickUp(a, 'shelf', 'x'); expect(cancelHeld(a)).toBe('return'); expect(a.phase).toBe('toShelf');
    const b = newDrag(); pickUp(b, 'hand', 'p'); expect(cancelHeld(b)).toBe('return'); expect(b.phase).toBe('toHandBack');
  });

  it('cancelHeld when not held does nothing', () => {
    const d = newDrag();
    expect(cancelHeld(d)).toBe('none'); expect(d.phase).toBe('idle');
  });
});
