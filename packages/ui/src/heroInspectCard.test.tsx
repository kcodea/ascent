// @vitest-environment jsdom
/** The shared hero inspect card (the Compendium's large view and the Hero Select screen render this one component). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { ANCIENT_IDS, getHero } from '@game/sim';
import { HeroInspectCard } from './HeroInspectCard';
import { mount, type Mounted } from './renderedText.mount';

describe('HeroInspectCard', () => {
  let m: Mounted | null = null;
  afterEach(() => { m?.unmount(); m = null; });

  it('renders name, vitals, power, facts and the Ancients row', () => {
    const hero = getHero('aster');
    m = mount(<HeroInspectCard hero={hero} art="x.webp" ancient="death" onAncient={vi.fn()} extraFacts={['Hard']} />);
    const el = m.container;
    expect(el.querySelector('.phi-name')!.textContent).toBe(hero.name);
    expect(el.querySelector('.phi-stat.is-hp b')!.textContent).toBe(String(hero.resolve));
    expect([...el.querySelectorAll('.phi-fact')].at(-1)!.textContent).toBe('Hard');
    expect(el.querySelectorAll('.hanc-med')).toHaveLength(6);
    expect(el.querySelector('.phi-anckeys')!.textContent).toBe('Up / Down: Ancients');
    expect(el.querySelector('.phi-count')!.textContent).not.toMatch(/\d+ \/ \d+/);
  });

  it('shows the counter after the Ancients hint when given', () => {
    m = mount(<HeroInspectCard hero={getHero('aster')} art="x.webp" ancient="death" onAncient={vi.fn()} counter="2 / 42" />);
    expect(m.container.querySelector('.phi-count')!.textContent).toBe('Up / Down: Ancients2 / 42');
  });

  it('clicking an Ancient calls onAncient', () => {
    const fn = vi.fn();
    m = mount(<HeroInspectCard hero={getHero('aster')} art="x.webp" ancient="death" onAncient={fn} />);
    act(() => { (m!.container.querySelectorAll('.hanc-med')[1] as HTMLElement).click(); });
    expect(fn).toHaveBeenCalledWith(ANCIENT_IDS[1]);
  });

  it('renders with no art', () => {
    m = mount(<HeroInspectCard hero={getHero('aster')} art={null} ancient="death" onAncient={vi.fn()} />);
    expect(m.container.querySelector('.phi-art img')).toBeNull();
    expect(m.container.querySelector('.phi-wash')).toBeNull();
    expect(m.container.querySelector('.phi-name')).not.toBeNull();
  });

  it('attaches artRef to .phi-art and passes className and onClick through', () => {
    const ref = { current: null as HTMLDivElement | null };
    const onClick = vi.fn();
    m = mount(<HeroInspectCard hero={getHero('aster')} art="x.webp" ancient="death" onAncient={vi.fn()} artRef={ref} className="extra" onClick={onClick} />);
    expect(ref.current).toBe(m.container.querySelector('.phi-art'));
    const card = m.container.querySelector('article.phi') as HTMLElement;
    expect(card.classList.contains('extra')).toBe(true);
    act(() => { card.click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
