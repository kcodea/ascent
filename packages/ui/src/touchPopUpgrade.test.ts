// @vitest-environment jsdom
/**
 * R-PHONE-DRAG-01 (owner 2026-10-26: "iphone is running okay, but the drag seems to be low fps/not as smooth or something
 * for some reason. can you clean that up?"). A hand press loaded the popped card's full-resolution art at once, so every
 * hand DRAG (which starts as a press) fetched and decoded ~16 MB of originals and swapped them in mid-flight. The upgrade
 * now waits for the press to settle, and a press that becomes a drag never upgrades.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upgrade = vi.fn((_el: Element | null) => restore);
const restore = vi.fn();
vi.mock('./fullResArt', () => ({ upgradeImages: (el: Element | null) => upgrade(el) }));

const { installTouchInput, POP_UPGRADE_DELAY_MS, TAP_SLOP } = await import('./touchInput');

function pointer(type: string, target: EventTarget, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  Object.defineProperty(e, 'isPrimary', { value: true });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
}

describe('R-PHONE-DRAG-01: a hand press upgrades its art only once it settles', () => {
  let uninstall: () => void = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    upgrade.mockClear(); restore.mockClear();
    document.documentElement.setAttribute('data-phone-zoom', '');
    document.body.innerHTML = '<div class="row hand"><div class="card" data-uid="h" id="h"><img src="/a.webp"></div></div>';
    uninstall = installTouchInput();
  });
  afterEach(() => { uninstall(); vi.useRealTimers(); document.documentElement.removeAttribute('data-phone-zoom'); });

  it('a press that rests upgrades after the delay, and gives the originals back on release', () => {
    const h = document.getElementById('h')!;
    pointer('pointerdown', h, 10, 10);
    vi.advanceTimersByTime(POP_UPGRADE_DELAY_MS - 1);
    expect(upgrade).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(upgrade).toHaveBeenCalledTimes(1);
    pointer('pointerup', h, 10, 10);
    expect(restore).toHaveBeenCalledTimes(1);
  });
  it('a press that becomes a drag before the delay never upgrades', () => {
    const h = document.getElementById('h')!;
    pointer('pointerdown', h, 10, 10);
    vi.advanceTimersByTime(40);
    pointer('pointermove', window, 10 + TAP_SLOP * 3, 10);
    vi.advanceTimersByTime(POP_UPGRADE_DELAY_MS * 3);
    expect(upgrade).not.toHaveBeenCalled();
    pointer('pointerup', h, 200, 10);
  });
  it('a drag that starts after the upgrade gives the originals back at once', () => {
    const h = document.getElementById('h')!;
    pointer('pointerdown', h, 10, 10);
    vi.advanceTimersByTime(POP_UPGRADE_DELAY_MS);
    expect(upgrade).toHaveBeenCalledTimes(1);
    pointer('pointermove', window, 10 + TAP_SLOP * 3, 10);
    expect(restore).toHaveBeenCalledTimes(1);
    pointer('pointerup', h, 200, 10);
  });
});
