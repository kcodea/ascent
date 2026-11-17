// @vitest-environment jsdom
/**
 * THE SHOWCASE'S CARD STAGE, ON ITS OWN (docs/superpowers/specs/2026-11-17-hero-select-all-heroes-design.md): the inspect
 * card with its arrows and the Select Hero button render without the tile row, so the "All heroes" window can use the
 * same pieces the three-hero showcase does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef, type ReactNode } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { setPartyHome } from '../partyHome/partyHomeFlag';
import { rememberAncient } from '../HeroAncients';
import { setHeroShowcase } from './heroShowcaseFlag';
import { HeroShowcaseCard, useShowcaseNav, type HeroShowcaseCardProps } from './HeroShowcase';

interface HarnessProps {
  heroId: string;
  count: number;
  selected?: number;
  onSelect?: (i: number) => void;
  blocked?: HeroShowcaseCardProps['blocked'];
  children?: ReactNode;
}

function Harness({ heroId, count, selected = 0, onSelect = () => {}, blocked = null, children }: HarnessProps): JSX.Element {
  const nav = useShowcaseNav(count, selected, onSelect, blocked === 'busy');
  return (
    <div className="heroselect phhs ph-tokens hsb">
      <div className="keys" tabIndex={-1} onKeyDown={nav.onKeyDown}>
        <HeroShowcaseCard
          heroId={heroId}
          count={count}
          nav={nav}
          onConfirm={() => {}}
          onDenied={() => {}}
          blocked={blocked}
          watching={false}
          showDifficulty={false}
          loadout={null}
          artRef={createRef<HTMLDivElement>()}
        >
          {children}
        </HeroShowcaseCard>
      </div>
    </div>
  );
}

let ui: Mounted | null = null;
const show = (p: HarnessProps): HTMLElement => { ui = mount(<Harness {...p} />); return ui.container; };
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const keyOn = (el: EventTarget, key: string): void => { act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); };

beforeEach(() => { act(() => { setPartyHome(true); setHeroShowcase(true); }); rememberAncient('death'); });
afterEach(() => { ui?.unmount(); ui = null; act(() => { setPartyHome(false); setHeroShowcase(false); }); });

describe('HeroShowcaseCard (the card stage without tiles)', () => {
  it('renders the stage and Select Hero with no tile row', () => {
    const el = show({ heroId: 'aster', count: 3 });
    expect(el.querySelector('.hss-stage .hss-card')).not.toBeNull();
    expect(el.querySelector('.hss-confirm')!.textContent).toBe('Select Hero');
    expect(el.querySelector('.hss-tiles')).toBeNull();
  });

  it('arrows call onSelect with the wrapped index', () => {
    const onSelect = vi.fn();
    const el = show({ heroId: 'aster', count: 3, selected: 0, onSelect });
    click(el.querySelector('.phi-nav.is-prev'));
    expect(onSelect).toHaveBeenLastCalledWith(2);
    click(el.querySelector('.phi-nav.is-next'));
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });

  it('Left / Right step through the keys handler', () => {
    const onSelect = vi.fn();
    const el = show({ heroId: 'aster', count: 3, selected: 2, onSelect });
    keyOn(el.querySelector('.keys')!, 'ArrowRight');
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });

  it('one hero has no arrows', () => {
    const el = show({ heroId: 'aster', count: 1 });
    expect(el.querySelector('.phi-nav')).toBeNull();
  });

  it('children render inside the stage', () => {
    const el = show({ heroId: 'aster', count: 3, children: <i className="probe" /> });
    expect(el.querySelector('.hss-stage > .probe')).not.toBeNull();
  });

  it('busy: keys select nothing', () => {
    const onSelect = vi.fn();
    const el = show({ heroId: 'aster', count: 3, onSelect, blocked: 'busy' });
    keyOn(el.querySelector('.keys')!, 'ArrowRight');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
