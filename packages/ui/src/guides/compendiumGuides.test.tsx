// @vitest-environment jsdom
/**
 * THE COMPENDIUM'S GUIDES TAB (owner ask 2026-10-09: "a guides tab in the compendium that pulls the same guides from
 * the rail but in an expanded/full view"). Pins: the toggle sits in the header beside Glossary (and the Gilded toggle
 * in the tier row); it renders EVERY guide the
 * shared data (`guidesFor`) gives the shown set, each already open with its write-up and Core / Enablers portraits;
 * the tribe pills narrow it; it follows the set picker; and it carries no native `title=` tooltip.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { SETS, activeSet, type SetId } from '@game/content';
import { MinionBook } from '../MinionBook';
import { useGame } from '../store';
import { mount, type Mounted } from '../renderedText.mount';
import { GUIDES, guidesFor } from './guides';

const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
/** The Guides toggle sits in the header beside Glossary (owner 2026-10-09), not in the left rail. */
const guidesTab = (c: HTMLElement): Element => [...c.querySelectorAll('.book-head .book-gloss')].find((b) => b.textContent?.trim() === 'Guides')!;
const shownIds = (c: HTMLElement): string[] => [...c.querySelectorAll('.bookguide')].map((g) => g.getAttribute('data-guide')!);

describe('Compendium Guides tab', () => {
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

  it('renders every guide from the shared data for the active set, each open with its write-up and portraits', () => {
    const live = activeSet();
    click(guidesTab(m.container));
    const expected = guidesFor(live.id, live.tribes).map((g) => g.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(shownIds(m.container)).toEqual(expected);
    for (const g of m.container.querySelectorAll('.bookguide')) {
      const data = GUIDES.find((x) => x.id === g.getAttribute('data-guide'))!;
      expect(g.querySelector('.bookguide-title')!.textContent).toBe(data.title);
      expect(g.querySelector('.lobbyguide-text')!.textContent).toBe(data.body);
      expect(g.querySelectorAll('.lobbyguide-unit .card').length).toBeGreaterThan(0);
    }
    expect(m.container.querySelector('.book-sub')!.textContent).toContain(`${expected.length} guide`);
    expect(m.container.querySelector('[title]')).toBeNull();
  });

  it('the tribe pills narrow the guides (Neutral = the tribe-less ones), and All clears them', () => {
    click(guidesTab(m.container));
    const all = shownIds(m.container);
    const neutral = m.container.querySelector('.book-runetribes button[aria-label="Neutral guides"]')!;
    click(neutral);
    const neutralIds = GUIDES.filter((g) => all.includes(g.id) && g.tribes.length === 0).map((g) => g.id);
    expect(shownIds(m.container)).toEqual(neutralIds);
    click(m.container.querySelector('.book-runetribes button[aria-label="Every guide"]')!);
    expect(shownIds(m.container)).toEqual(all);
  });

  it('Guides sits beside Glossary in the header, Gilded sits in the tier row, and a rail tab leaves Guides', () => {
    const head = [...m.container.querySelectorAll('.book-head button')].map((b) => b.textContent?.trim());
    expect(head.indexOf('Guides')).toBe(head.indexOf('Glossary') + 1);
    expect(m.container.querySelector('.book-rail .book-cat[aria-label="Guides"]')).toBeNull();
    expect(m.container.querySelector('.book-head .book-gilded')).toBeNull();
    const gilded = m.container.querySelector('.book-tiers .book-gilded') as HTMLButtonElement;
    expect(gilded.disabled).toBe(false);
    click(gilded);
    expect(gilded.getAttribute('aria-pressed')).toBe('true');
    expect(m.container.querySelector('.book-grid .card.golden')).not.toBeNull();
    click(guidesTab(m.container));
    expect(guidesTab(m.container).getAttribute('aria-pressed')).toBe('true');
    expect((m.container.querySelector('.book-tiers .book-gilded') as HTMLButtonElement).disabled).toBe(true);
    click(m.container.querySelector('.book-rail .book-cat[aria-label="Heroes"]')!);
    expect(guidesTab(m.container).getAttribute('aria-pressed')).toBe('false');
    expect(m.container.querySelector('.bookguide')).toBeNull();
    expect(m.container.querySelector('.bookhero')).not.toBeNull();
  });

  it('follows the set picker', () => {
    click(guidesTab(m.container));
    const other = (Object.keys(SETS) as SetId[]).find((id) => id !== activeSet().id)!;
    act(() => { (m.container.querySelector('.book-setpick-btn') as HTMLButtonElement).click(); });
    const opt = [...m.container.querySelectorAll<HTMLElement>('.book-setpick-opt')].find((o) => o.textContent?.startsWith(SETS[other].name))!;
    act(() => { opt.click(); });
    expect(shownIds(m.container)).toEqual(guidesFor(other, SETS[other].tribes).map((g) => g.id));
  });
});
