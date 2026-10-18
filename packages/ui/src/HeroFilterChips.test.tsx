// @vitest-environment jsdom
/**
 * THE HERO FILTER "MORE" DROPDOWN (owner ask 2026-10-18). Pins:
 *  - "All heroes", up to eight hero chips (most played first), then a "More" chip when more heroes are loaded;
 *  - More opens a listbox of EVERY loaded hero (plus "All heroes" at the top), each with its game count;
 *  - picking a hero without a chip applies it and the More chip shows that hero, active; "All heroes" clears it;
 *  - Esc and a press outside close the list; Esc does not reach the page's own Esc handler.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { HEROES, getHero } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { HeroFilterChips } from './HeroFilterChips';
import type { HeroCount } from './heroFilter';

// Twelve real heroes with descending counts: eight get chips, four live only behind More.
const COUNTS: HeroCount[] = HEROES.slice(0, 12).map((h, i) => ({ id: h.id, n: 20 - i }));

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

function Harness({ onChange }: { onChange?: (id: string | null) => void }) {
  const [v, setV] = useState<string | null>(null);
  return <HeroFilterChips counts={COUNTS} value={v} onChange={(id) => { setV(id); onChange?.(id); }} />;
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => ui!.container.querySelector<T>(sel);
const chipTexts = (): string[] => [...ui!.container.querySelectorAll('.rg-filters > .rg-chip')].map((e) => e.textContent ?? '');
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

describe('HeroFilterChips', () => {
  it('shows All + eight chips + More, and the list holds every hero with its count', () => {
    ui = mount(<Harness />);
    expect(chipTexts()).toEqual(['All heroes', ...COUNTS.slice(0, 8).map((c) => getHero(c.id).name)]);
    const trigger = q<HTMLButtonElement>('.rg-more-trigger')!;
    expect(trigger.textContent).toBe('More');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(q('[role="listbox"]')).toBeNull();
    click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const opts = [...ui.container.querySelectorAll('[role="option"]')];
    expect(opts).toHaveLength(COUNTS.length + 1);
    expect(opts[0]!.textContent).toBe('All heroes');
    expect(opts[1]!.textContent).toBe(`${getHero(COUNTS[0]!.id).name}20 games`);
    // No native browser tooltips anywhere.
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('picking a hero without a chip applies it and shows it as the active More chip; All heroes clears it', () => {
    const onChange = vi.fn();
    ui = mount(<Harness onChange={onChange} />);
    click(q('.rg-more-trigger'));
    const hidden = COUNTS[10]!;
    const opt = [...ui.container.querySelectorAll('[role="option"]')].find((o) => o.textContent?.startsWith(getHero(hidden.id).name));
    click(opt!);
    expect(onChange).toHaveBeenLastCalledWith(hidden.id);
    expect(q('[role="listbox"]')).toBeNull();
    const trigger = q('.rg-more-trigger')!;
    expect(trigger.textContent).toBe(getHero(hidden.id).name);
    expect(trigger.classList.contains('on')).toBe(true);
    click([...ui.container.querySelectorAll('.rg-chip')].find((e) => e.textContent === 'All heroes')!);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(q('.rg-more-trigger')!.textContent).toBe('More');
  });

  it('a visible chip filters directly; Esc and an outside press close the list, and Esc stays inside it', () => {
    const onChange = vi.fn();
    ui = mount(<Harness onChange={onChange} />);
    click([...ui.container.querySelectorAll('.rg-chip')][2]!);
    expect(onChange).toHaveBeenLastCalledWith(COUNTS[1]!.id);
    click(q('.rg-more-trigger'));
    const pageEsc = vi.fn();
    window.addEventListener('keydown', pageEsc);
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    window.removeEventListener('keydown', pageEsc);
    expect(q('[role="listbox"]')).toBeNull();
    expect(pageEsc).not.toHaveBeenCalled();
    click(q('.rg-more-trigger'));
    expect(q('[role="listbox"]')).not.toBeNull();
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(q('[role="listbox"]')).toBeNull();
  });

  it('arrow keys move focus through the options', () => {
    ui = mount(<Harness />);
    click(q('.rg-more-trigger'));
    const opts = [...ui.container.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(document.activeElement).toBe(opts[0]);
    act(() => { opts[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(document.activeElement).toBe(opts[1]);
    act(() => { opts[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
    expect(document.activeElement).toBe(opts[opts.length - 1]);
  });

  it('no More chip when every hero already has a chip', () => {
    ui = mount(<HeroFilterChips counts={COUNTS.slice(0, 3)} value={null} onChange={() => {}} />);
    expect(q('.rg-more-trigger')).toBeNull();
  });
});
