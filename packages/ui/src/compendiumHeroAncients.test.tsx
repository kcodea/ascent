// @vitest-environment jsdom
/**
 * THE COMPENDIUM'S HERO ANCIENTS (owner ask 2026-11-16: "an ancients display on the heroes tab ... scan through all of
 * the ancient mechanics both on the compendium itself and the inspected view of the hero"). Every hero tile and the
 * large hero view carry six Ancient medallions; pressing one shows that Ancient's text for THAT hero, read from the
 * sim's pairing table. In the large view Up/Down step the Ancients while Left/Right keep stepping the heroes, and the
 * picked Ancient stays as the hero changes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { ANCIENTS, ANCIENT_IDS, ANCIENT_NOT_WRITTEN, HEROES, ancientOfferText, ancientPairingFor, type AncientId } from '@game/sim';
import { MinionBook } from './MinionBook';
import { HeroAncients, rememberAncient } from './HeroAncients';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

const plain = (md: string): string => md.replace(/\*\*/g, '');

describe('Compendium hero Ancients', () => {
  let m: Mounted;
  let prev: { showTitle: boolean };
  const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
  const key = (k: string): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); }); };
  const shownIn = (root: Element): { id: string; text: string } => {
    const on = root.querySelector('.hanc-text.is-on') as HTMLElement;
    return { id: on.dataset.ancient ?? '', text: on.querySelector('.hanc-body')?.textContent ?? '' };
  };
  const pressed = (root: Element): string[] =>
    [...root.querySelectorAll('.hanc-med[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label') ?? '');
  const med = (root: Element, id: AncientId): Element | null => root.querySelector(`.hanc-med[aria-label="${ANCIENTS[id].name}"]`);

  beforeEach(() => {
    rememberAncient('death');
    try { localStorage.clear(); } catch { /* jsdom */ }
    prev = { showTitle: useGame.getState().showTitle };
    useGame.setState({ showTitle: true });
    m = mount(<MinionBook frame={(p) => <>{p.controls}{p.body}</>} />);
    click(m.container.querySelector('.book-cat[aria-label="Heroes"]'));
  });
  afterEach(() => {
    m.unmount();
    useGame.setState(prev);
  });

  it('every hero tile shows six Ancient medallions, Death first, with no native tooltip', () => {
    const tiles = [...m.container.querySelectorAll('.phh')];
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      const meds = [...t.querySelectorAll('.hanc-med')];
      expect(meds.map((b) => b.getAttribute('aria-label'))).toEqual(ANCIENT_IDS.map((id) => ANCIENTS[id].name));
      for (const b of meds) expect(b.hasAttribute('title')).toBe(false);
      expect(shownIn(t).id).toBe('death');
    }
  });

  it('pressing a medallion on a tile shows that Ancient for that hero, without opening the large view', () => {
    const tile = m.container.querySelector('.phh') as HTMLElement;
    const heroId = HERO_OF(tile);
    click(med(tile, 'war'));
    expect(m.container.querySelector('.phh-pop')).toBeNull();
    expect(pressed(tile)).toEqual([ANCIENTS.war.name]);
    expect(shownIn(tile)).toEqual({ id: 'war', text: plain(ancientOfferText(heroId, 'war')) });
    // Other tiles keep their own pick.
    const other = m.container.querySelectorAll('.phh')[1];
    if (other) expect(shownIn(other).id).toBe('death');
  });

  it('the large view opens on the tile\'s Ancient; Up/Down step Ancients and Left/Right keep the pick', () => {
    const tile = m.container.querySelector('.phh') as HTMLElement;
    click(med(tile, 'genesis'));
    click(tile);
    let pop = m.container.querySelector('.phh-pop') as HTMLElement;
    expect(pop).toBeTruthy();
    expect(pop.querySelectorAll('.hanc-med')).toHaveLength(6);
    expect(shownIn(pop).id).toBe('genesis');
    key('ArrowDown');
    expect(shownIn(pop).id).toBe('time');
    key('ArrowUp'); key('ArrowUp');
    expect(shownIn(pop).id).toBe('war');
    const first = pop.querySelector('.phi-name')?.textContent;
    key('ArrowRight');
    pop = m.container.querySelector('.phh-pop') as HTMLElement;
    expect(pop.querySelector('.phi-name')?.textContent).not.toBe(first);
    expect(shownIn(pop).id).toBe('war');
    click(med(pop, 'bonds'));
    expect(shownIn(pop).id).toBe('bonds');
  });
});

describe('HeroAncients', () => {
  it('shows "Not written yet." for a hero with no written pairing, and the text otherwise', () => {
    const m = mount(<HeroAncients heroId="__no_such_hero__" picked="fortune" onPick={() => {}} />);
    expect(m.container.querySelector('.hanc-text.is-on')?.textContent).toContain(ANCIENT_NOT_WRITTEN);
    expect(m.container.querySelector('.hanc-text.is-on')?.classList.contains('is-unwritten')).toBe(true);
    m.unmount();
    const written = ANCIENT_IDS.find((id) => ancientPairingFor('warden', id));
    if (written) {
      const w = mount(<HeroAncients heroId="warden" picked={written} onPick={() => {}} />);
      expect(w.container.querySelector('.hanc-text.is-on .hanc-body')?.textContent).toBe(plain(ancientOfferText('warden', written)));
      w.unmount();
    }
  });
});

/** The hero a tile shows, by its name. */
function HERO_OF(tile: Element): string {
  const name = tile.querySelector('.phh-name')?.textContent;
  const h = HEROES.find((x) => x.name === name);
  if (!h) throw new Error(`no hero named ${name}`);
  return h.id;
}
