// @vitest-environment jsdom
/**
 * THE PLAY LINEUP'S CARD MENU TAKES ITS OWN PRESSES (fix 2026-11-23). PartyHome closes an open card menu on any press
 * outside the open card, in the CAPTURE phase. Its "inside" test was PhBanner's `.ph-cardwrap.menu`, which the showcase
 * card (`.phs-card.phs-menu`) does not carry, so pressing Change name closed the menu on pointerdown before its click
 * landed and nothing happened. Pinned on the real PartyHome: open your card's menu, press Change name (pointerdown then
 * click), and the Change name window opens; a press outside still closes the menu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

vi.mock('../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../remoteBoards')>()),
  remoteEnabled: () => false,
}));

const { mount } = await import('../renderedText.mount');
const { default: PartyHome, OPEN_CARD_SELECTOR } = await import('./PartyHome');

// jsdom has no PointerEvent; a MouseEvent of the same type reaches the same listeners (they read only target / button).
// Each event in its OWN act(), as a real browser commits the pointerdown's state update before the click arrives (one
// act() would batch a close with the click and hide the bug).
const press = (el: Element): void => {
  act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })); });
  act(() => { el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0 })); });
  act(() => { if (el.isConnected) (el as HTMLElement).click(); });
};
const item = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.ph-cardmenu .ph-menuitem')].find((b) => b.textContent?.trim().startsWith(label));

let ui: ReturnType<typeof mount> | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

describe('the lineup card menu', () => {
  it('the outside-press close knows the showcase card is the open card (and PhBanner while it exists)', () => {
    expect(OPEN_CARD_SELECTOR).toContain('.phs-card.phs-menu');
    expect(OPEN_CARD_SELECTOR).toContain('.ph-cardwrap.menu');
  });

  it('pressing Change name in your open card menu runs it (the pointerdown no longer closes the menu first)', () => {
    ui = mount(<PartyHome onRankedStart={() => undefined} onGuestPortrait={() => undefined} />);
    const mine = document.querySelector('.phs-card.phs-mine > .phs-press');
    expect(mine, 'your showcase card').toBeTruthy();
    press(mine!);
    expect(document.querySelector('.phs-card.phs-menu .ph-cardmenu'), 'the menu opened').toBeTruthy();
    const change = item('Change name');
    expect(change, 'Change name in the menu').toBeTruthy();
    press(change!);
    expect(document.querySelector('.phk-fieldinput'), 'the Change name window opened').toBeTruthy();
  });

  it('a press outside the open card still closes its menu', () => {
    ui = mount(<PartyHome onRankedStart={() => undefined} onGuestPortrait={() => undefined} />);
    press(document.querySelector('.phs-card.phs-mine > .phs-press')!);
    expect(document.querySelector('.ph-cardmenu')).toBeTruthy();
    act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(document.querySelector('.ph-cardmenu')).toBeNull();
  });
});
