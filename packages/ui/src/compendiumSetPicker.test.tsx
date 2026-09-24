// @vitest-environment jsdom
/**
 * The Compendium's SET PICKER (owner ask 2026-09-24): "add a set drop down ... so you can view any card sets.
 * default to the active set, though."
 *
 * Mounts the real `MinionBook` from the title (the pre-run book) and checks the three promises:
 *   1. it opens on the ACTIVE set,
 *   2. picking another set swaps the listed cards (and the tribe rail) to that set's,
 *   3. it is VIEW-ONLY: the active set and the store's run are untouched afterwards.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { EPIC_RUNES, RUNES, SETS, activeSet, poolFor, type SetId } from '@game/content';
import { MinionBook } from './MinionBook';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

const railLabels = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('.book-rail .book-cat')].map((b) => b.getAttribute('aria-label') ?? '');
const subtitle = (el: HTMLElement): string => el.querySelector('.book-sub')?.textContent ?? '';
const pickerBtn = (el: HTMLElement): HTMLButtonElement => el.querySelector('.book-setpick-btn') as HTMLButtonElement;
const options = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.book-setpick-opt')];
const minionCount = (setId: SetId): number => poolFor(setId).buyable.length;

describe('Compendium set picker', () => {
  let m: Mounted;
  let prevShowTitle: boolean;
  beforeEach(() => {
    prevShowTitle = useGame.getState().showTitle;
    useGame.setState({ showTitle: true });
    m = mount(<MinionBook />);
  });
  afterEach(() => {
    m.unmount();
    useGame.setState({ showTitle: prevShowTitle });
  });

  it('lists every set in the registry and defaults to the ACTIVE set', () => {
    const live = activeSet();
    expect(options(m.container).map((o) => o.textContent?.replace(/Live$/, ''))).toEqual(Object.values(SETS).map((s) => s.name));
    expect(pickerBtn(m.container).getAttribute('aria-label')).toContain(live.name);
    const selected = options(m.container).filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toContain(live.name);
    // Only the live set wears the Live tag.
    expect(options(m.container).filter((o) => o.querySelector('.book-setpick-live')).map((o) => o.textContent)).toEqual([`${live.name}Live`]);
  });

  it("switching sets shows that set's cards and tribes, and leaves the active set and the run alone", () => {
    const live = activeSet().id;
    const runBefore = useGame.getState().run;
    const other = (Object.keys(SETS) as SetId[]).find((id) => id !== live && minionCount(id) > 0 && minionCount(id) !== minionCount(live))!;
    expect(other, 'needs a second non-empty set with a different minion count').toBeTruthy();

    const beforeSub = subtitle(m.container);
    const beforeRail = railLabels(m.container);
    const beforeCells = m.container.querySelectorAll('.book-grid .book-cell').length;

    // Open, then pick the other set.
    act(() => { pickerBtn(m.container).click(); });
    expect(pickerBtn(m.container).getAttribute('aria-expanded')).toBe('true');
    const opt = options(m.container).find((o) => o.textContent?.startsWith(SETS[other].name))!;
    act(() => { opt.click(); });
    expect(pickerBtn(m.container).getAttribute('aria-expanded')).toBe('false');
    expect(pickerBtn(m.container).getAttribute('aria-label')).toContain(SETS[other].name);

    // The gallery and the tribe rail now describe the other set.
    expect(subtitle(m.container)).not.toBe(beforeSub);
    expect(m.container.querySelectorAll('.book-grid .book-cell').length).not.toBe(beforeCells);
    const rail = railLabels(m.container);
    expect(rail).not.toEqual(beforeRail);
    // Rail = the set's tribes, then the six fixed tabs (Neutral, Spells, Gifts, Runes, Rune Rewards, Heroes).
    expect(rail).toHaveLength(SETS[other].tribes.length + 6);

    // View-only: nothing global moved.
    expect(activeSet().id).toBe(live);
    expect(useGame.getState().run).toBe(runBefore);

    // And switching back restores the original listing.
    act(() => { pickerBtn(m.container).click(); });
    act(() => { options(m.container).find((o) => o.textContent?.startsWith(SETS[live].name))!.click(); });
    expect(subtitle(m.container)).toBe(beforeSub);
    expect(railLabels(m.container)).toEqual(beforeRail);
  });

  it('Esc closes the open dropdown without closing the Compendium', () => {
    useGame.setState({ showBook: true });
    let bookClosed = false;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') bookClosed = true; };
    window.addEventListener('keydown', onKey);
    try {
      act(() => { pickerBtn(m.container).click(); });
      act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(pickerBtn(m.container).getAttribute('aria-expanded')).toBe('false');
      expect(bookClosed).toBe(false);
    } finally {
      window.removeEventListener('keydown', onKey);
      useGame.setState({ showBook: false });
    }
  });

  it('the Runes tab has a NEUTRAL pill: exactly the untribed runes, ORed with the tribe pills, scoped to the picked set', () => {
    const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
    const runeCount = (): number => m.container.querySelectorAll('.book-grid .book-cell').length;
    const setRunes = (id: SetId) => [...RUNES, ...EPIC_RUNES].filter((r) => !r.sets || r.sets.includes(id));
    click(m.container.querySelector('.book-rail .book-cat[aria-label="Runes"]'));
    const pills = (): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('.book-runetribe')];
    const neutralPill = (): HTMLElement => pills().find((b) => b.getAttribute('aria-label') === 'Runes with no tribe')!;

    for (const id of [activeSet().id, ...(Object.keys(SETS) as SetId[]).filter((x) => x !== activeSet().id && poolFor(x).buyable.length > 0)]) {
      if (id !== activeSet().id) {
        click(pickerBtn(m.container));
        click(options(m.container).find((o) => o.textContent?.startsWith(SETS[id].name)));
      }
      // The Neutral pill sits LAST, after the set's tribe pills, in the same style.
      expect(pills()).toHaveLength(SETS[id].tribes.length + 1);
      expect(pills().at(-1)).toBe(neutralPill());
      expect(neutralPill().className).toContain('book-runetribe');

      const untribed = setRunes(id).filter((r) => !r.tribes?.length);
      expect(untribed.length, `${id} has untribed runes`).toBeGreaterThan(0);
      click(neutralPill());
      expect(neutralPill().getAttribute('aria-pressed')).toBe('true');
      expect(runeCount(), `${id}: Neutral shows exactly the untribed runes`).toBe(untribed.length);

      // ORs with a tribe pill: Neutral + the first tribe = untribed + that tribe's runes, no tribe-gated extras.
      const t = SETS[id].tribes[0]!;
      click(pills()[0]);
      const both = setRunes(id).filter((r) => !r.tribes?.length || r.tribes.includes(t));
      expect(runeCount(), `${id}: Neutral + ${t}`).toBe(both.length);
      click(pills()[0]);
      click(neutralPill());
      expect(runeCount()).toBe(setRunes(id).length);
    }
  });
});
