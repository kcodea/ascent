// @vitest-environment jsdom
/**
 * THE RECENT GAMES HERO FILTER is one dropdown (owner 2026-11-07: "remove these buttons and instead have a hero select
 * dropdown"). Pins:
 *  - no chips: one select pill, reading "All heroes" while nothing is filtered;
 *  - its list holds "All heroes" then EVERY loaded hero, most played first, each with its game count;
 *  - picking a hero filters to it and the pill names it; "All heroes" clears the filter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { HEROES, getHero } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { HeroFilterChips } from './HeroFilterChips';
import type { HeroCount } from './heroFilter';

const COUNTS: HeroCount[] = HEROES.slice(0, 12).map((h, i) => ({ id: h.id, n: 20 - i }));

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

function Harness({ onChange }: { onChange?: (id: string | null) => void }) {
  const [v, setV] = useState<string | null>(null);
  return <HeroFilterChips counts={COUNTS} value={v} onChange={(id) => { setV(id); onChange?.(id); }} />;
}
const pill = (): HTMLButtonElement => ui!.container.querySelector<HTMLButtonElement>('.rg-herosel')!;
const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

describe('HeroFilterChips (the hero dropdown)', () => {
  it('is one select, no chips, and lists All heroes then every hero with its count', () => {
    ui = mount(<Harness />);
    expect(ui.container.querySelectorAll('.rg-filters button')).toHaveLength(1);
    expect(pill().textContent).toContain('All heroes');
    click(pill());
    const opts = options();
    expect(opts).toHaveLength(COUNTS.length + 1);
    expect(opts[0]!.textContent).toBe('All heroes');
    expect(opts[1]!.textContent).toBe(`${getHero(COUNTS[0]!.id).name}20 games`);
    expect(document.querySelector('[title]')).toBeNull();
  });

  it('picking a hero filters to it and the pill names it; All heroes clears it', () => {
    const onChange = vi.fn();
    ui = mount(<Harness onChange={onChange} />);
    click(pill());
    const hero = COUNTS[10]!;
    click(options().find((o) => o.textContent?.startsWith(getHero(hero.id).name))!);
    expect(onChange).toHaveBeenLastCalledWith(hero.id);
    expect(pill().textContent).toContain(getHero(hero.id).name);
    click(pill());
    click(options()[0]!);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(pill().textContent).toContain('All heroes');
  });

  it('renders nothing with no games', () => {
    ui = mount(<HeroFilterChips counts={[]} value={null} onChange={() => {}} />);
    expect(ui.container.querySelector('.rg-herosel')).toBeNull();
  });
});
