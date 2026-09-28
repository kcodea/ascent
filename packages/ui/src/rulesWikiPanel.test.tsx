// @vitest-environment jsdom
/**
 * The Compendium's RULES panel (spec docs/superpowers/specs/2026-09-28-rules-wiki-design.md): the Rules toggle
 * swaps the book body for the wiki, search narrows it, a question expands to its answer, and See-also opens its
 * target. Mounts the real `MinionBook` from the title.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { MinionBook } from './MinionBook';
import { WIKI_ENTRIES } from './rulesWiki';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

const q = <T extends Element>(el: HTMLElement, sel: string): T => el.querySelector(sel) as T;
const items = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.wiki-item')];

/** React listens for the native `input` event; set the value through the prototype setter so it notices. */
function typeInto(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Compendium Rules panel', () => {
  let m: Mounted;
  let prevShowTitle: boolean;
  beforeEach(() => {
    prevShowTitle = useGame.getState().showTitle;
    useGame.setState({ showTitle: true });
    m = mount(<MinionBook />);
    act(() => q<HTMLButtonElement>(m.container, '.book-rules').click());
  });
  afterEach(() => {
    m.unmount();
    useGame.setState({ showTitle: prevShowTitle });
  });

  it('shows every entry and hides the card-gallery controls', () => {
    expect(q(m.container, '.wiki-body')).not.toBeNull();
    expect(items(m.container)).toHaveLength(WIKI_ENTRIES.length);
    expect(q(m.container, '.book-search')).toBeNull();
    expect(q(m.container, '.book-grid')).toBeNull();
  });

  it('Glossary and Rules are exclusive', () => {
    const gloss = [...m.container.querySelectorAll<HTMLButtonElement>('.book-gloss')].find((b) => !b.classList.contains('book-rules'))!;
    act(() => gloss.click());
    expect(q(m.container, '.wiki-body')).toBeNull();
    expect(q(m.container, '.book-gloss-body')).not.toBeNull();
    act(() => q<HTMLButtonElement>(m.container, '.book-rules').click());
    expect(q(m.container, '.wiki-body')).not.toBeNull();
    expect(q(m.container, '.book-gloss-body')).toBeNull();
  });

  it('search narrows the list and says so when nothing matches', () => {
    const first = WIKI_ENTRIES[0]!;
    typeInto(q<HTMLInputElement>(m.container, '.wiki-search'), first.q);
    expect(items(m.container).length).toBeGreaterThan(0);
    expect(items(m.container)[0]!.textContent).toContain(first.q);
    typeInto(q<HTMLInputElement>(m.container, '.wiki-search'), 'zzqqxx');
    expect(items(m.container)).toHaveLength(0);
    expect(q(m.container, '.wiki-empty')).not.toBeNull();
  });

  it('a question expands to its answer, and See-also opens its target', () => {
    const withSee = WIKI_ENTRIES.find((e) => e.seeAlso?.length)!;
    typeInto(q<HTMLInputElement>(m.container, '.wiki-search'), withSee.q);
    const btn = q<HTMLButtonElement>(items(m.container)[0]!, '.wiki-q');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    act(() => btn.click());
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(q(items(m.container)[0]!, '.wiki-a')).not.toBeNull();
    act(() => q<HTMLButtonElement>(m.container, '.wiki-see-link').click());
    // Search cleared, target open.
    expect(q<HTMLInputElement>(m.container, '.wiki-search').value).toBe('');
    const targetQ = WIKI_ENTRIES.find((e) => e.id === withSee.seeAlso![0])!.q;
    const target = items(m.container).find((el) => el.querySelector('.wiki-q')!.textContent!.includes(targetQ))!;
    expect(target.querySelector('.wiki-q')!.getAttribute('aria-expanded')).toBe('true');
  });
});
