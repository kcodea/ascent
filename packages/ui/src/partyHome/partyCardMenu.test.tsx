// @vitest-environment jsdom
/**
 * THE PLAY LINEUP'S CARD MENU TAKES ITS OWN PRESSES (fix 2026-11-23). PartyHome closes an open card menu on any press
 * outside the open card, in the CAPTURE phase. Its "inside" test was the old flag banner's open class, which the showcase
 * card (`.phs-card.phs-menu`) does not carry, so pressing Change name closed the menu on pointerdown before its click
 * landed and nothing happened. Pinned on the real PartyHome: open your card's menu, press Change name (pointerdown then
 * click), and the Change name window opens; a press outside still closes the menu.
 *
 * THE TABS UNDER YOUR CARD (PR 3 Task 7): your own card (only yours) carries Avatar / Frame / Title / Card plate, and a tab
 * opens the cosmetics window on that tab; the row reserves their height (`phs-tabbed`). A guest gets no tabs. Your menu no
 * longer lists Change portrait (only the tabs open the window).
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
const { useGame } = await import('../store');

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
const prevAccount = useGame.getState().account;
afterEach(() => { ui?.unmount(); ui = null; act(() => { useGame.setState({ account: prevAccount, avatarPickerOpen: false, cosmeticsTab: 'avatar' }); }); });
const signedIn = (): void => { act(() => { useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null } }); }); };
const guest = (): void => { act(() => { useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } }); }); };

describe('the lineup card menu', () => {
  it('the outside-press close knows the showcase card is the open card', () => {
    expect(OPEN_CARD_SELECTOR).toBe('.phs-card.phs-menu');
  });

  it('pressing Change name in your open card menu runs it (the pointerdown no longer closes the menu first)', () => {
    ui = mount(<PartyHome onRankedStart={() => undefined} />);
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
    ui = mount(<PartyHome onRankedStart={() => undefined} />);
    press(document.querySelector('.phs-card.phs-mine > .phs-press')!);
    expect(document.querySelector('.ph-cardmenu')).toBeTruthy();
    act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(document.querySelector('.ph-cardmenu')).toBeNull();
  });

  it('your menu lists Change name and View Career, not Change portrait', () => {
    ui = mount(<PartyHome onRankedStart={() => undefined} />);
    press(document.querySelector('.phs-card.phs-mine > .phs-press')!);
    expect([...document.querySelectorAll('.ph-cardmenu .ph-menuitem')].map((b) => b.textContent?.trim())).toEqual(['Change name', 'View Career']);
  });
});

describe('the tabs under your card', () => {
  const tabs = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.phs-tabs .phs-tab')];

  it('your own card carries the four tabs and its row reserves them; a tab opens the window on that tab', () => {
    signedIn();
    ui = mount(<PartyHome onRankedStart={() => undefined} />);
    expect(document.querySelectorAll('.phs-tabs')).toHaveLength(1);
    expect(document.querySelector('.phs-card.phs-mine .phs-tabs'), 'the tabs hang from YOUR card').toBeTruthy();
    expect(tabs().map((b) => b.querySelector('.phs-tablbl')!.textContent)).toEqual(['Avatar', 'Frame', 'Title', 'Card plate']);
    expect(document.querySelector('.phs-lineup')!.classList.contains('phs-tabbed')).toBe(true);
    act(() => tabs()[2]!.click());
    expect(useGame.getState().avatarPickerOpen).toBe(true);
    expect(useGame.getState().cosmeticsTab).toBe('title');
    // A tab press is not a card press: no menu opened.
    expect(document.querySelector('.ph-cardmenu')).toBeNull();
  });

  it('a guest gets no tabs and the row reserves nothing', () => {
    guest();
    ui = mount(<PartyHome onRankedStart={() => undefined} />);
    expect(document.querySelector('.phs-tabs')).toBeNull();
    expect(document.querySelector('.phs-lineup')!.classList.contains('phs-tabbed')).toBe(false);
  });
});
