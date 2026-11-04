// @vitest-environment jsdom
/**
 * R-COMPENDIUM-GUIDES-FILTER-01: the Compendium's Guides view always shows the guides' own tribe filter. Before, with
 * Runes picked on the rail and then Guides opened, the filter row showed "runes by tribe" and the forge pills.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  remoteEnabled: () => false,
}));

import { MinionBook } from './MinionBook';
import { useGame } from './store';

let ui: Mounted | null = null;
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
afterEach(() => { ui?.unmount(); ui = null; act(() => { useGame.setState({ showBook: false } as never); }); });

describe('R-COMPENDIUM-GUIDES-FILTER-01', () => {
  it('Guides shows its own tribe filter even with Runes lit before it', () => {
    act(() => { useGame.setState({ showTitle: true, showBook: true } as never); });
    ui = mount(<MinionBook />);
    click([...ui.container.querySelectorAll('.book-cat')].find((b) => b.textContent === 'Runes'));
    expect(ui.container.querySelector('.book-chart-cap')?.textContent).toBe('runes by tribe');
    click([...ui.container.querySelectorAll('.book-gloss')].find((b) => b.textContent?.trim() === 'Guides'));
    expect(ui.container.querySelector('.book-chart-cap')?.textContent).toBe('guides by tribe');
    expect(ui.container.querySelector('[aria-label="Filter runes by tribe"]')).toBeNull();
  });
});
